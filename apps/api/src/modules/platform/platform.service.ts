import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type ImpersonateResponseDto,
  type PlatformOrgDetailDto,
  type PlatformOrgDto,
  type PlatformStatsDto,
  type PlatformUserDto,
  type Role,
} from '@wolfiax/shared';
import type { AuthUser } from '../../common/auth/auth.types';
import { PasswordService } from '../../common/crypto/password.service';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toOrganizationDto } from '../iam/mappers';
import { AuditService } from '../iam/audit.service';
import type { RequestContext } from '../iam/auth.service';
import { TokensService } from '../iam/tokens.service';

/**
 * Operaciones de Super Admin (staff Wolfiax). Todas las lecturas/escrituras
 * cruzan tenants, por lo que se ejecutan en contexto de SISTEMA (withSystem);
 * el aislamiento por RLS se relaja SOLO aquí y solo tras pasar el
 * PlatformAdminGuard. Cada acción sensible queda auditada.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Métricas globales
  // ---------------------------------------------------------------------------

  async stats(): Promise<PlatformStatsDto> {
    return this.prisma.withSystem(async (tx) => {
      const [
        organizations_total,
        organizations_suspended,
        users_total,
        platform_admins_total,
        channels_total,
        channels_active,
        conversations_total,
        messages_total,
        organizations_deleted,
      ] = await Promise.all([
        tx.organization.count(),
        tx.organization.count({ where: { suspendedAt: { not: null } } }),
        tx.user.count(),
        tx.user.count({ where: { isPlatformAdmin: true } }),
        tx.channel.count(),
        tx.channel.count({ where: { status: 'active' } }),
        tx.conversation.count(),
        tx.message.count(),
        tx.organization.count({ where: { deletedAt: { not: null } } }),
      ]);
      return {
        organizations_total,
        organizations_active:
          organizations_total - organizations_suspended - organizations_deleted,
        organizations_suspended,
        users_total,
        platform_admins_total,
        channels_total,
        channels_active,
        conversations_total,
        messages_total,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Organizaciones
  // ---------------------------------------------------------------------------

  async listOrganizations(q?: string): Promise<PlatformOrgDto[]> {
    const search = q?.trim();
    return this.prisma.withSystem(async (tx) => {
      const orgs = await tx.organization.findMany({
        where: {
          deletedAt: null,
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { slug: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        include: {
          _count: { select: { memberships: true, channels: true, conversations: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return orgs.map((o) => this.toPlatformOrgDto(o));
    });
  }

  async organizationDetail(orgId: string): Promise<PlatformOrgDetailDto> {
    return this.prisma.withSystem(async (tx) => {
      const org = await tx.organization.findFirst({
        where: { id: orgId, deletedAt: null },
        include: {
          _count: { select: { memberships: true, channels: true, conversations: true } },
          memberships: { include: { user: true }, orderBy: { createdAt: 'asc' } },
          channels: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (!org) {
        throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Organización no encontrada.');
      }
      return {
        ...this.toPlatformOrgDto(org),
        members: org.memberships.map((m) => ({
          user_id: m.userId,
          email: m.user.email,
          full_name: m.user.fullName,
          role: m.role as Role,
          joined_at: m.createdAt.toISOString(),
        })),
        channels: org.channels.map((c) => ({
          id: c.id,
          ig_username: c.igUsername,
          status: c.status,
          connection_type: c.connectionType,
        })),
      };
    });
  }

  async setSuspended(
    actor: AuthUser,
    orgId: string,
    suspended: boolean,
    ctx: RequestContext,
  ): Promise<PlatformOrgDto> {
    const org = await this.prisma.withSystem(async (tx) => {
      const existing = await tx.organization.findFirst({ where: { id: orgId, deletedAt: null } });
      if (!existing) {
        throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Organización no encontrada.');
      }
      const updated = await tx.organization.update({
        where: { id: orgId },
        data: { suspendedAt: suspended ? new Date() : null },
        include: {
          _count: { select: { memberships: true, channels: true, conversations: true } },
        },
      });
      // Suspender revoca todas las sesiones activas del tenant
      if (suspended) {
        await tx.refreshToken.updateMany({
          where: { organizationId: orgId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.log(tx, {
        organizationId: orgId,
        userId: actor.userId,
        action: suspended ? 'platform.org_suspended' : 'platform.org_reactivated',
        resource: 'organization',
        resourceId: orgId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { by_platform_admin: actor.email },
      });
      return updated;
    });
    return this.toPlatformOrgDto(org);
  }

  /**
   * Emite un access token con scope al tenant objetivo (rol owner) para que el
   * Super Admin opere dentro de esa organización. El token lleva imp=true para
   * distinguir la sesión; NO se emite refresh token (la impersonación caduca en
   * ~15 min y se vuelve a la sesión propia con /auth/refresh).
   */
  async impersonate(
    actor: AuthUser,
    orgId: string,
    ctx: RequestContext,
  ): Promise<ImpersonateResponseDto> {
    const org = await this.prisma.withSystem(async (tx) => {
      const found = await tx.organization.findFirst({ where: { id: orgId, deletedAt: null } });
      if (!found) {
        throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Organización no encontrada.');
      }
      await this.audit.log(tx, {
        organizationId: orgId,
        userId: actor.userId,
        action: 'platform.impersonate',
        resource: 'organization',
        resourceId: orgId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { by_platform_admin: actor.email },
      });
      return found;
    });

    const accessToken = await this.tokens.signAccessToken({
      userId: actor.userId,
      organizationId: org.id,
      role: 'owner',
      email: actor.email,
      isPlatformAdmin: true,
      impersonating: true,
    });
    return { access_token: accessToken, organization: toOrganizationDto(org) };
  }

  // ---------------------------------------------------------------------------
  // Usuarios y Super Admins
  // ---------------------------------------------------------------------------

  async listUsers(q?: string): Promise<PlatformUserDto[]> {
    const search = q?.trim();
    return this.prisma.withSystem(async (tx) => {
      const users = await tx.user.findMany({
        where: search
          ? {
              OR: [
                { email: { contains: search, mode: 'insensitive' } },
                { fullName: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},
        include: { _count: { select: { memberships: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return users.map((u) => ({
        id: u.id,
        email: u.email,
        full_name: u.fullName,
        is_platform_admin: u.isPlatformAdmin,
        created_at: u.createdAt.toISOString(),
        last_login_at: u.lastLoginAt?.toISOString() ?? null,
        organizations_count: u._count.memberships,
      }));
    });
  }

  async listSuperAdmins(): Promise<PlatformUserDto[]> {
    return this.prisma.withSystem(async (tx) => {
      const users = await tx.user.findMany({
        where: { isPlatformAdmin: true },
        include: { _count: { select: { memberships: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return users.map((u) => ({
        id: u.id,
        email: u.email,
        full_name: u.fullName,
        is_platform_admin: true,
        created_at: u.createdAt.toISOString(),
        last_login_at: u.lastLoginAt?.toISOString() ?? null,
        organizations_count: u._count.memberships,
      }));
    });
  }

  /** Promueve a Super Admin un usuario EXISTENTE (por email). */
  async promote(actor: AuthUser, email: string, ctx: RequestContext): Promise<PlatformUserDto> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.withSystem(async (tx) => {
      const found = await tx.user.findUnique({
        where: { email: normalized },
        include: { _count: { select: { memberships: true } } },
      });
      if (!found) {
        throw new AppError(
          HttpStatus.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
          'No existe ningún usuario con ese email. La persona debe registrarse primero.',
        );
      }
      const updated = await tx.user.update({
        where: { id: found.id },
        data: { isPlatformAdmin: true },
        include: { _count: { select: { memberships: true } } },
      });
      await this.audit.log(tx, {
        userId: actor.userId,
        action: 'platform.admin_promoted',
        resource: 'user',
        resourceId: found.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { promoted_email: normalized, by: actor.email },
      });
      return updated;
    });
    return {
      id: user.id,
      email: user.email,
      full_name: user.fullName,
      is_platform_admin: true,
      created_at: user.createdAt.toISOString(),
      last_login_at: user.lastLoginAt?.toISOString() ?? null,
      organizations_count: user._count.memberships,
    };
  }

  /** Revoca el rol de Super Admin. No permite quedarse sin ningún Super Admin. */
  async demote(actor: AuthUser, userId: string, ctx: RequestContext): Promise<void> {
    if (userId === actor.userId) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.FORBIDDEN,
        'No puedes revocarte a ti mismo el rol de Super Admin.',
      );
    }
    await this.prisma.withSystem(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: userId } });
      if (!target || !target.isPlatformAdmin) {
        throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Super Admin no encontrado.');
      }
      const remaining = await tx.user.count({
        where: { isPlatformAdmin: true, id: { not: userId } },
      });
      if (remaining === 0) {
        throw new AppError(
          HttpStatus.CONFLICT,
          ERROR_CODES.LAST_OWNER,
          'Debe quedar al menos un Super Admin de plataforma.',
        );
      }
      await tx.user.update({ where: { id: userId }, data: { isPlatformAdmin: false } });
      await this.audit.log(tx, {
        userId: actor.userId,
        action: 'platform.admin_demoted',
        resource: 'user',
        resourceId: userId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { demoted_email: target.email, by: actor.email },
      });
    });
  }

  // ---------------------------------------------------------------------------

  private toPlatformOrgDto(org: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    suspendedAt: Date | null;
    createdAt: Date;
    _count: { memberships: number; channels: number; conversations: number };
  }): PlatformOrgDto {
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: org.plan,
      suspended: org.suspendedAt !== null,
      created_at: org.createdAt.toISOString(),
      members_count: org._count.memberships,
      channels_count: org._count.channels,
      conversations_count: org._count.conversations,
    };
  }
}
