import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  ROLE_RANK,
  type MemberDto,
  type OrganizationDto,
  type Role,
} from '@wolfiax/shared';
import type { AuthUser } from '../../common/auth/auth.types';
import { AppError } from '../../common/errors/app-error';
import { PrismaService, type Tx } from '../../common/prisma/prisma.service';
import type { RequestContext } from './auth.service';
import { AuditService } from './audit.service';
import type { UpdateOrgDto } from './dto';
import { toMemberDto, toOrganizationDto } from './mappers';

@Injectable()
export class OrgsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Toda ruta /orgs/:id exige que :id sea la organización del token. */
  assertOrgAccess(actor: AuthUser, orgId: string): void {
    if (actor.organizationId !== orgId) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.ORG_MISMATCH,
        'El recurso no pertenece a tu organización activa.',
      );
    }
  }

  async getOrganization(actor: AuthUser, orgId: string): Promise<OrganizationDto> {
    this.assertOrgAccess(actor, orgId);
    const org = await this.prisma.withTenant(orgId, (tx) =>
      tx.organization.findFirst({ where: { id: orgId, deletedAt: null } }),
    );
    if (!org) {
      throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Organización no encontrada.');
    }
    return toOrganizationDto(org);
  }

  async updateOrganization(
    actor: AuthUser,
    orgId: string,
    dto: UpdateOrgDto,
    ctx: RequestContext,
  ): Promise<OrganizationDto> {
    this.assertOrgAccess(actor, orgId);
    const org = await this.prisma.withTenant(orgId, async (tx) => {
      const updated = await tx.organization.update({
        where: { id: orgId },
        data: { ...(dto.name ? { name: dto.name.trim() } : {}) },
      });
      await this.audit.log(tx, {
        organizationId: orgId,
        userId: actor.userId,
        action: 'org.updated',
        resource: 'organization',
        resourceId: orgId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { name: dto.name },
      });
      return updated;
    });
    return toOrganizationDto(org);
  }

  async listMembers(actor: AuthUser, orgId: string): Promise<MemberDto[]> {
    this.assertOrgAccess(actor, orgId);
    const memberships = await this.prisma.withTenant(orgId, (tx) =>
      tx.membership.findMany({
        where: { organizationId: orgId },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return memberships.map(toMemberDto);
  }

  async updateMemberRole(
    actor: AuthUser,
    orgId: string,
    targetUserId: string,
    newRole: Role,
    ctx: RequestContext,
  ): Promise<MemberDto> {
    this.assertOrgAccess(actor, orgId);
    if (targetUserId === actor.userId) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.FORBIDDEN,
        'No puedes cambiar tu propio rol.',
      );
    }

    const updated = await this.prisma.withTenant(orgId, async (tx) => {
      const target = await this.findMembershipOrFail(tx, orgId, targetUserId);
      this.assertCanManage(actor, target.role as Role);
      // Otorgar un rol: nadie asigna un rol superior al suyo; solo un owner
      // puede nombrar a otro owner.
      if (ROLE_RANK[newRole] > ROLE_RANK[actor.role] || (newRole === 'owner' && actor.role !== 'owner')) {
        throw new AppError(
          HttpStatus.FORBIDDEN,
          ERROR_CODES.FORBIDDEN,
          'No puedes asignar un rol superior al tuyo.',
        );
      }
      if (target.role === 'owner' && newRole !== 'owner') {
        await this.assertNotLastOwner(tx, orgId, targetUserId);
      }

      const membership = await tx.membership.update({
        where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
        data: { role: newRole },
        include: { user: true },
      });
      await this.audit.log(tx, {
        organizationId: orgId,
        userId: actor.userId,
        action: 'member.role_changed',
        resource: 'user',
        resourceId: targetUserId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { from: target.role, to: newRole },
      });
      return membership;
    });

    return toMemberDto(updated);
  }

  async removeMember(
    actor: AuthUser,
    orgId: string,
    targetUserId: string,
    ctx: RequestContext,
  ): Promise<void> {
    this.assertOrgAccess(actor, orgId);
    const leavingSelf = targetUserId === actor.userId;

    await this.prisma.withTenant(orgId, async (tx) => {
      const target = await this.findMembershipOrFail(tx, orgId, targetUserId);
      if (!leavingSelf) {
        this.assertCanManage(actor, target.role as Role);
      }
      if (target.role === 'owner') {
        await this.assertNotLastOwner(tx, orgId, targetUserId);
      }
      await tx.membership.delete({
        where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
      });
      await this.audit.log(tx, {
        organizationId: orgId,
        userId: actor.userId,
        action: leavingSelf ? 'member.left' : 'member.removed',
        resource: 'user',
        resourceId: targetUserId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    });

    // Las sesiones del usuario en esta organización dejan de servir: se revocan
    // sus refresh tokens (contexto de sistema: refresh_tokens no es tenant-scoped).
    // Su access token vigente muere solo en ≤15 min.
    await this.prisma.withSystem((tx) =>
      tx.refreshToken.updateMany({
        where: { userId: targetUserId, organizationId: orgId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  // ---------------------------------------------------------------------------

  private async findMembershipOrFail(tx: Tx, orgId: string, userId: string) {
    const membership = await tx.membership.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!membership) {
      throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Miembro no encontrado.');
    }
    return membership;
  }

  /** Un actor solo gestiona miembros de rango inferior; el owner gestiona a todos. */
  private assertCanManage(actor: AuthUser, targetRole: Role): void {
    const allowed = actor.role === 'owner' || ROLE_RANK[actor.role] > ROLE_RANK[targetRole];
    if (!allowed) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.FORBIDDEN,
        'No puedes gestionar a un miembro con rol igual o superior al tuyo.',
      );
    }
  }

  private async assertNotLastOwner(tx: Tx, orgId: string, excludingUserId: string): Promise<void> {
    const otherOwners = await tx.membership.count({
      where: { organizationId: orgId, role: 'owner', userId: { not: excludingUserId } },
    });
    if (otherOwners === 0) {
      throw new AppError(
        HttpStatus.CONFLICT,
        ERROR_CODES.LAST_OWNER,
        'La organización debe conservar al menos un owner.',
      );
    }
  }
}
