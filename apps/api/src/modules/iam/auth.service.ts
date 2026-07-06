import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Organization, User } from '@prisma/client';
import { ERROR_CODES, type InvitationPublicDto, type MeDto, type Role } from '@wolfiax/shared';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors/app-error';
import { generateOpaqueToken, sha256hex } from '../../common/crypto/hash';
import { PasswordService } from '../../common/crypto/password.service';
import { PrismaService, type Tx } from '../../common/prisma/prisma.service';
import { orgSlug } from '../../common/utils/slug';
import type { Env } from '../../config/configuration';
import { AuditService } from './audit.service';
import type { AcceptInvitationDto, LoginDto, RegisterDto } from './dto';
import { toOrganizationDto, toUserDto } from './mappers';
import { TokensService } from './tokens.service';

/** Contexto de request para auditoría y registro de sesiones. */
export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

/** Resultado interno de emitir una sesión (el controller arma cookie + body). */
export interface SessionResult {
  accessToken: string;
  refreshTokenRaw: string;
  refreshMaxAgeMs: number;
  user: User;
  organization: Organization;
  role: Role;
}

@Injectable()
export class AuthService {
  private readonly refreshTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.refreshTtlMs =
      config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24 * 60 * 60 * 1000;
  }

  // -------------------------------------------------------------------------
  // Registro y login
  // -------------------------------------------------------------------------

  async register(dto: RegisterDto, ctx: RequestContext): Promise<SessionResult> {
    const email = dto.email.trim().toLowerCase();
    const passwordHash = await this.passwords.hash(dto.password);

    const { user, organization, refreshTokenRaw } = await this.prisma.withSystem(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) {
        throw new AppError(
          HttpStatus.CONFLICT,
          ERROR_CODES.EMAIL_IN_USE,
          'Ya existe una cuenta con este email.',
        );
      }

      const user = await tx.user.create({
        data: { email, passwordHash, fullName: dto.full_name.trim() },
      });
      const organization = await tx.organization.create({
        data: { name: dto.organization_name.trim(), slug: orgSlug(dto.organization_name) },
      });
      await tx.membership.create({
        data: { organizationId: organization.id, userId: user.id, role: 'owner' },
      });
      const refreshTokenRaw = await this.createRefreshToken(tx, {
        userId: user.id,
        organizationId: organization.id,
        familyId: randomUUID(),
        ctx,
      });

      await this.audit.log(tx, {
        organizationId: organization.id,
        userId: user.id,
        action: 'auth.register',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { user, organization, refreshTokenRaw };
    });

    return this.buildSession(user, organization, 'owner', refreshTokenRaw);
  }

  async login(dto: LoginDto, ctx: RequestContext): Promise<SessionResult> {
    const email = dto.email.trim().toLowerCase();

    const found = await this.prisma.withSystem((tx) =>
      tx.user.findUnique({
        where: { email },
        include: {
          memberships: {
            where: { organization: { deletedAt: null, suspendedAt: null } },
            include: { organization: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
    );

    const invalid = new AppError(
      HttpStatus.UNAUTHORIZED,
      ERROR_CODES.INVALID_CREDENTIALS,
      'Email o contraseña incorrectos.',
    );
    if (!found?.passwordHash) throw invalid;
    const ok = await this.passwords.verify(found.passwordHash, dto.password);
    if (!ok) throw invalid;

    const membership = found.memberships[0];
    if (!membership) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.FORBIDDEN,
        'Tu cuenta no pertenece a ninguna organización activa.',
      );
    }

    const refreshTokenRaw = await this.prisma.withSystem(async (tx) => {
      await tx.user.update({ where: { id: found.id }, data: { lastLoginAt: new Date() } });
      const raw = await this.createRefreshToken(tx, {
        userId: found.id,
        organizationId: membership.organizationId,
        familyId: randomUUID(),
        ctx,
      });
      await this.audit.log(tx, {
        organizationId: membership.organizationId,
        userId: found.id,
        action: 'auth.login',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return raw;
    });

    return this.buildSession(
      found,
      membership.organization,
      membership.role as Role,
      refreshTokenRaw,
    );
  }

  // -------------------------------------------------------------------------
  // Refresh con rotación y detección de reuso
  // -------------------------------------------------------------------------

  async refresh(refreshRaw: string | undefined, ctx: RequestContext): Promise<SessionResult> {
    if (!refreshRaw) {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.INVALID_REFRESH_TOKEN,
        'No hay sesión activa.',
      );
    }
    const tokenHash = sha256hex(refreshRaw);

    const rotated = await this.prisma.withSystem(async (tx) => {
      const row = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });
      if (!row) {
        throw new AppError(
          HttpStatus.UNAUTHORIZED,
          ERROR_CODES.INVALID_REFRESH_TOKEN,
          'Sesión inválida. Inicia sesión de nuevo.',
        );
      }

      // Reuso de un token ya rotado ⇒ posible robo: se revoca toda la familia.
      if (row.revokedAt) {
        await tx.refreshToken.updateMany({
          where: { familyId: row.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit.log(tx, {
          organizationId: row.organizationId,
          userId: row.userId,
          action: 'auth.refresh_reuse_detected',
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          detail: { family_id: row.familyId },
        });
        throw new AppError(
          HttpStatus.UNAUTHORIZED,
          ERROR_CODES.SESSION_REVOKED,
          'La sesión fue revocada por seguridad. Inicia sesión de nuevo.',
        );
      }

      if (row.expiresAt.getTime() < Date.now()) {
        throw new AppError(
          HttpStatus.UNAUTHORIZED,
          ERROR_CODES.INVALID_REFRESH_TOKEN,
          'La sesión expiró. Inicia sesión de nuevo.',
        );
      }

      const membership = await tx.membership.findUnique({
        where: {
          organizationId_userId: { organizationId: row.organizationId, userId: row.userId },
        },
        include: { organization: true },
      });
      if (!membership || membership.organization.deletedAt || membership.organization.suspendedAt) {
        await tx.refreshToken.update({
          where: { id: row.id },
          data: { revokedAt: new Date() },
        });
        throw new AppError(
          HttpStatus.UNAUTHORIZED,
          ERROR_CODES.INVALID_REFRESH_TOKEN,
          'Ya no perteneces a esta organización.',
        );
      }

      // Rotación: revoca el actual y emite uno nuevo en la misma familia.
      await tx.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      const raw = await this.createRefreshToken(tx, {
        userId: row.userId,
        organizationId: row.organizationId,
        familyId: row.familyId,
        ctx,
      });

      return { raw, user: row.user, membership };
    });

    return this.buildSession(
      rotated.user,
      rotated.membership.organization,
      rotated.membership.role as Role,
      rotated.raw,
    );
  }

  async logout(refreshRaw: string | undefined, ctx: RequestContext): Promise<void> {
    if (!refreshRaw) return;
    const tokenHash = sha256hex(refreshRaw);
    await this.prisma.withSystem(async (tx) => {
      const row = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!row) return;
      await tx.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(tx, {
        organizationId: row.organizationId,
        userId: row.userId,
        action: 'auth.logout',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    });
  }

  // -------------------------------------------------------------------------
  // Cambio de organización activa
  // -------------------------------------------------------------------------

  async switchOrg(
    userId: string,
    targetOrgId: string,
    refreshRaw: string | undefined,
    ctx: RequestContext,
  ): Promise<SessionResult> {
    if (!refreshRaw) {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.INVALID_REFRESH_TOKEN,
        'No hay sesión activa.',
      );
    }
    const tokenHash = sha256hex(refreshRaw);

    const result = await this.prisma.withSystem(async (tx) => {
      const row = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });
      if (!row || row.userId !== userId || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
        throw new AppError(
          HttpStatus.UNAUTHORIZED,
          ERROR_CODES.INVALID_REFRESH_TOKEN,
          'Sesión inválida. Inicia sesión de nuevo.',
        );
      }

      const membership = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId: targetOrgId, userId } },
        include: { organization: true },
      });
      if (!membership || membership.organization.deletedAt || membership.organization.suspendedAt) {
        throw new AppError(
          HttpStatus.FORBIDDEN,
          ERROR_CODES.FORBIDDEN,
          'No perteneces a esa organización.',
        );
      }

      await tx.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      const raw = await this.createRefreshToken(tx, {
        userId,
        organizationId: targetOrgId,
        familyId: row.familyId,
        ctx,
      });
      await this.audit.log(tx, {
        organizationId: targetOrgId,
        userId,
        action: 'org.switch',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { raw, user: row.user, membership };
    });

    return this.buildSession(
      result.user,
      result.membership.organization,
      result.membership.role as Role,
      result.raw,
    );
  }

  // -------------------------------------------------------------------------
  // Perfil
  // -------------------------------------------------------------------------

  async me(userId: string, currentOrgId: string, currentRole: Role): Promise<MeDto> {
    const data = await this.prisma.withSystem((tx) =>
      tx.user.findUnique({
        where: { id: userId },
        include: {
          memberships: {
            where: { organization: { deletedAt: null, suspendedAt: null } },
            include: { organization: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
    );
    if (!data) {
      throw new AppError(HttpStatus.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED, 'Cuenta no encontrada.');
    }
    const current = data.memberships.find((m) => m.organizationId === currentOrgId);
    if (!current) {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED,
        'Ya no perteneces a la organización activa.',
      );
    }
    return {
      user: toUserDto(data),
      current_organization: toOrganizationDto(current.organization),
      current_role: currentRole,
      is_platform_admin: data.isPlatformAdmin,
      organizations: data.memberships.map((m) => ({
        organization: toOrganizationDto(m.organization),
        role: m.role as Role,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Invitaciones (lado público: consultar y aceptar)
  // -------------------------------------------------------------------------

  async getInvitationPublic(rawToken: string): Promise<InvitationPublicDto> {
    const tokenHash = sha256hex(rawToken);
    return this.prisma.withSystem(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash },
        include: { organization: true },
      });
      this.assertInvitationUsable(invitation);
      const account = await tx.user.findUnique({ where: { email: invitation!.email } });
      return {
        organization_name: invitation!.organization.name,
        email: invitation!.email,
        role: invitation!.role as Role,
        account_exists: account !== null,
      };
    });
  }

  /**
   * Acepta una invitación. Dos caminos:
   *  - El email no tiene cuenta → requiere full_name + password (se crea).
   *  - El email ya tiene cuenta → requiere estar autenticado como ese usuario
   *    (el controller pasa authUserId si venía un access token válido).
   */
  async acceptInvitation(
    rawToken: string,
    dto: AcceptInvitationDto,
    authUserId: string | undefined,
    ctx: RequestContext,
  ): Promise<SessionResult> {
    const tokenHash = sha256hex(rawToken);
    const passwordHash = dto.password ? await this.passwords.hash(dto.password) : null;

    const outcome = await this.prisma.withSystem(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash },
        include: { organization: true },
      });
      this.assertInvitationUsable(invitation);
      const inv = invitation!;

      let user = await tx.user.findUnique({ where: { email: inv.email } });

      if (user) {
        if (authUserId !== user.id) {
          throw new AppError(
            HttpStatus.UNAUTHORIZED,
            ERROR_CODES.ACCOUNT_EXISTS,
            'Este email ya tiene cuenta. Inicia sesión para aceptar la invitación.',
          );
        }
      } else {
        if (!dto.full_name || !passwordHash) {
          throw new AppError(
            HttpStatus.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
            'full_name y password son obligatorios para crear la cuenta.',
            [
              { field: 'full_name', issue: 'requerido' },
              { field: 'password', issue: 'requerido (mínimo 10 caracteres)' },
            ],
          );
        }
        user = await tx.user.create({
          data: { email: inv.email, passwordHash, fullName: dto.full_name.trim() },
        });
      }

      const existingMembership = await tx.membership.findUnique({
        where: {
          organizationId_userId: { organizationId: inv.organizationId, userId: user.id },
        },
      });
      const membership =
        existingMembership ??
        (await tx.membership.create({
          data: { organizationId: inv.organizationId, userId: user.id, role: inv.role },
        }));

      await tx.invitation.update({
        where: { id: inv.id },
        data: { acceptedAt: new Date() },
      });

      const raw = await this.createRefreshToken(tx, {
        userId: user.id,
        organizationId: inv.organizationId,
        familyId: randomUUID(),
        ctx,
      });
      await this.audit.log(tx, {
        organizationId: inv.organizationId,
        userId: user.id,
        action: 'invitation.accepted',
        resource: 'invitation',
        resourceId: inv.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { user, organization: inv.organization, role: membership.role as Role, raw };
    });

    return this.buildSession(outcome.user, outcome.organization, outcome.role, outcome.raw);
  }

  // -------------------------------------------------------------------------
  // Helpers privados
  // -------------------------------------------------------------------------

  private assertInvitationUsable(
    invitation: {
      acceptedAt: Date | null;
      expiresAt: Date;
      organization: { deletedAt: Date | null };
    } | null,
  ): void {
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.expiresAt.getTime() < Date.now() ||
      invitation.organization.deletedAt
    ) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.INVITATION_INVALID,
        'La invitación no existe, expiró o ya fue usada.',
      );
    }
  }

  private async createRefreshToken(
    tx: Tx,
    input: { userId: string; organizationId: string; familyId: string; ctx: RequestContext },
  ): Promise<string> {
    const { raw, hash } = generateOpaqueToken();
    await tx.refreshToken.create({
      data: {
        userId: input.userId,
        organizationId: input.organizationId,
        tokenHash: hash,
        familyId: input.familyId,
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
        userAgent: input.ctx.userAgent?.slice(0, 300),
        ip: input.ctx.ip,
      },
    });
    return raw;
  }

  private async buildSession(
    user: User,
    organization: Organization,
    role: Role,
    refreshTokenRaw: string,
  ): Promise<SessionResult> {
    const accessToken = await this.tokens.signAccessToken({
      userId: user.id,
      organizationId: organization.id,
      role,
      email: user.email,
      isPlatformAdmin: user.isPlatformAdmin,
    });
    return {
      accessToken,
      refreshTokenRaw,
      refreshMaxAgeMs: this.refreshTtlMs,
      user,
      organization,
      role,
    };
  }
}
