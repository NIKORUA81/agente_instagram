import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { InvitationDto, MemberDto, OrganizationDto } from '@wolfiax/shared';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth/auth.types';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { RequestContext } from './auth.service';
import { CreateInvitationDto, UpdateMemberDto, UpdateOrgDto } from './dto';
import { InvitationsService } from './invitations.service';
import { OrgsService } from './orgs.service';

@ApiTags('orgs')
@ApiBearerAuth()
@Controller('orgs')
export class OrgsController {
  constructor(
    private readonly orgs: OrgsService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de la organización activa' })
  getOrganization(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrganizationDto> {
    return this.orgs.getOrganization(user, id);
  }

  @Patch(':id')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Actualiza datos de la organización' })
  updateOrganization(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrgDto,
    @Req() req: Request,
  ): Promise<OrganizationDto> {
    return this.orgs.updateOrganization(user, id, dto, this.ctx(req));
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Lista de miembros' })
  listMembers(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MemberDto[]> {
    return this.orgs.listMembers(user, id);
  }

  @Patch(':id/members/:userId')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Cambia el rol de un miembro' })
  updateMember(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberDto,
    @Req() req: Request,
  ): Promise<MemberDto> {
    return this.orgs.updateMemberRole(user, id, userId, dto.role, this.ctx(req));
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Quita un miembro (o abandona la organización si es uno mismo)' })
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.orgs.removeMember(user, id, userId, this.ctx(req));
  }

  @Get(':id/invitations')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Invitaciones pendientes' })
  listInvitations(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvitationDto[]> {
    return this.invitations.list(user, id);
  }

  @Post(':id/invitations')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Crea una invitación y devuelve el enlace de aceptación' })
  createInvitation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInvitationDto,
    @Req() req: Request,
  ): Promise<InvitationDto> {
    return this.invitations.create(user, id, dto, this.ctx(req));
  }

  @Delete(':id/invitations/:invitationId')
  @Roles('owner', 'admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoca una invitación pendiente' })
  revokeInvitation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.invitations.revoke(user, id, invitationId, this.ctx(req));
  }

  private ctx(req: Request): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }
}
