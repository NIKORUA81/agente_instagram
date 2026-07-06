import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PasswordService } from '../../common/crypto/password.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { orgSlug } from '../../common/utils/slug';
import type { Env } from '../../config/configuration';

/**
 * Auto-seed del Super Admin de plataforma al arrancar.
 *
 * Si SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD están definidos:
 *  - Si el email NO existe → crea el usuario (platform admin) + una
 *    organización personal "Wolfiax Platform" (para que pueda iniciar sesión
 *    con el flujo normal, que exige una org activa).
 *  - Si el email YA existe → lo promueve a platform admin y actualiza su
 *    contraseña con el valor del entorno (cuenta de emergencia gobernada por
 *    las env del stack).
 *
 * Es idempotente: seguro en cada reinicio del contenedor.
 */
@Injectable()
export class SuperAdminSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(SuperAdminSeeder.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.get('SUPERADMIN_EMAIL', { infer: true });
    const password = this.config.get('SUPERADMIN_PASSWORD', { infer: true });
    if (!email || !password) return;

    const normalized = email.trim().toLowerCase();
    const name = this.config.get('SUPERADMIN_NAME', { infer: true }) ?? 'Wolfiax Super Admin';
    const passwordHash = await this.passwords.hash(password);

    try {
      await this.prisma.withSystem(async (tx) => {
        const existing = await tx.user.findUnique({ where: { email: normalized } });

        if (existing) {
          await tx.user.update({
            where: { id: existing.id },
            data: { isPlatformAdmin: true, passwordHash },
          });
          this.logger.log(`Super Admin existente promovido/actualizado: ${normalized}`);
          return;
        }

        const user = await tx.user.create({
          data: {
            email: normalized,
            passwordHash,
            fullName: name,
            isPlatformAdmin: true,
          },
        });
        const org = await tx.organization.create({
          data: { name: 'Wolfiax Platform', slug: orgSlug('wolfiax-platform'), plan: 'enterprise' },
        });
        await tx.membership.create({
          data: { organizationId: org.id, userId: user.id, role: 'owner' },
        });
        await tx.auditLog.create({
          data: {
            organizationId: org.id,
            userId: user.id,
            action: 'platform.super_admin_seeded',
            detail: { email: normalized },
          },
        });
        this.logger.log(`Super Admin creado desde el entorno: ${normalized}`);
      });
    } catch (err) {
      // Nunca impedir el arranque del API por el seeder
      this.logger.error(`No se pudo sembrar el Super Admin: ${(err as Error).message}`);
    }
  }
}
