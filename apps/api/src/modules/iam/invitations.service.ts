import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES, type InvitationDto } from '@wolfiax/shared';
import type { AuthUser } from '../../common/auth/auth.types';
import { generateOpaqueToken } from '../../common/crypto/hash';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Env } from '../../config/configuration';
import { AuditService } from './audit.service';
import type { RequestContext } from './auth.service';
import type { CreateInvitationDto } from './dto';
import { toInvitationDto } from './mappers';
import { OrgsService } from './orgs.service';

const INVITATION_TTL_DAYS = 7;

@Injectable()
export class InvitationsService {
  private readonly webOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrgsService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.webOrigin = config.get('WEB_ORIGIN', { infer: true });
  }

  /**
   * Crea (o reemplaza) la invitación pendiente para un email.
   * F0 no envía correos: la respuesta incluye accept_url para compartirla
   * manualmente. El mailer llega en una fase posterior.
   */
  async create(
    actor: AuthUser,
    orgId: string,
    dto: CreateInvitationDto,
    ctx: RequestContext,
  ): Promise<InvitationDto> {
    this.orgs.assertOrgAccess(actor, orgId);
    const email = dto.email.trim().toLowerCase();
    const { raw, hash } = generateOpaqueToken();

    const invitation = await this.prisma.withTenant(orgId, async (tx) => {
      // ¿Ya es miembro? (el join a users está limitado por RLS a usuarios del tenant)
      const existingMember = await tx.membership.findFirst({
        where: { organizationId: orgId, user: { email } },
      });
      if (existingMember) {
        throw new AppError(
          HttpStatus.CONFLICT,
          ERROR_CODES.ALREADY_MEMBER,
          'Ese email ya es miembro de la organización.',
        );
      }

      // Reemplaza cualquier invitación previa (pendiente o expirada) para el email
      await tx.invitation.deleteMany({ where: { organizationId: orgId, email } });
      const created = await tx.invitation.create({
        data: {
          organizationId: orgId,
          email,
          role: dto.role,
          tokenHash: hash,
          invitedById: actor.userId,
          expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
        },
        include: { invitedBy: true },
      });
      await this.audit.log(tx, {
        organizationId: orgId,
        userId: actor.userId,
        action: 'invitation.created',
        resource: 'invitation',
        resourceId: created.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { email, role: dto.role },
      });
      return created;
    });

    return toInvitationDto(invitation, `${this.webOrigin}/invite/${raw}`);
  }

  async list(actor: AuthUser, orgId: string): Promise<InvitationDto[]> {
    this.orgs.assertOrgAccess(actor, orgId);
    const invitations = await this.prisma.withTenant(orgId, (tx) =>
      tx.invitation.findMany({
        where: { organizationId: orgId, acceptedAt: null },
        include: { invitedBy: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return invitations.map((i) => toInvitationDto(i));
  }

  async revoke(actor: AuthUser, orgId: string, invitationId: string, ctx: RequestContext): Promise<void> {
    this.orgs.assertOrgAccess(actor, orgId);
    await this.prisma.withTenant(orgId, async (tx) => {
      const invitation = await tx.invitation.findFirst({
        where: { id: invitationId, organizationId: orgId },
      });
      if (!invitation) {
        throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Invitación no encontrada.');
      }
      await tx.invitation.delete({ where: { id: invitationId } });
      await this.audit.log(tx, {
        organizationId: orgId,
        userId: actor.userId,
        action: 'invitation.revoked',
        resource: 'invitation',
        resourceId: invitationId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { email: invitation.email },
      });
    });
  }
}
