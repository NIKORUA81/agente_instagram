import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  ImpersonateResponseDto,
  PlatformOrgDetailDto,
  PlatformOrgDto,
  PlatformStatsDto,
  PlatformUserDto,
} from '@wolfiax/shared';
import { IsBoolean, IsEmail } from 'class-validator';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth/auth.types';
import { CurrentUser, PlatformAdmin } from '../../common/auth/decorators';
import type { RequestContext } from '../iam/auth.service';
import { PlatformService } from './platform.service';

class SuspendDto {
  @IsBoolean()
  suspended!: boolean;
}

class PromoteDto {
  @IsEmail()
  email!: string;
}

/** Panel de Super Admin. Todo el controller exige @PlatformAdmin(). */
@ApiTags('platform')
@ApiBearerAuth()
@PlatformAdmin()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Métricas globales de la plataforma' })
  stats(): Promise<PlatformStatsDto> {
    return this.platform.stats();
  }

  @Get('organizations')
  @ApiOperation({ summary: 'Todas las organizaciones' })
  listOrganizations(@Query('q') q?: string): Promise<PlatformOrgDto[]> {
    return this.platform.listOrganizations(q);
  }

  @Get('organizations/:id')
  @ApiOperation({ summary: 'Detalle de una organización (miembros y canales)' })
  organizationDetail(@Param('id', ParseUUIDPipe) id: string): Promise<PlatformOrgDetailDto> {
    return this.platform.organizationDetail(id);
  }

  @Patch('organizations/:id/suspension')
  @ApiOperation({ summary: 'Suspende o reactiva una organización' })
  setSuspension(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendDto,
    @Req() req: Request,
  ): Promise<PlatformOrgDto> {
    return this.platform.setSuspended(user, id, dto.suspended, this.ctx(req));
  }

  @Post('organizations/:id/impersonate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Emite un token para operar dentro de esa organización' })
  impersonate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<ImpersonateResponseDto> {
    return this.platform.impersonate(user, id, this.ctx(req));
  }

  @Get('users')
  @ApiOperation({ summary: 'Todos los usuarios de la plataforma' })
  listUsers(@Query('q') q?: string): Promise<PlatformUserDto[]> {
    return this.platform.listUsers(q);
  }

  @Get('super-admins')
  @ApiOperation({ summary: 'Lista de Super Admins' })
  listSuperAdmins(): Promise<PlatformUserDto[]> {
    return this.platform.listSuperAdmins();
  }

  @Post('super-admins')
  @ApiOperation({ summary: 'Promueve a Super Admin a un usuario existente (por email)' })
  promote(
    @CurrentUser() user: AuthUser,
    @Body() dto: PromoteDto,
    @Req() req: Request,
  ): Promise<PlatformUserDto> {
    return this.platform.promote(user, dto.email, this.ctx(req));
  }

  @Delete('super-admins/:userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoca el rol de Super Admin' })
  demote(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.platform.demote(user, userId, this.ctx(req));
  }

  private ctx(req: Request): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }
}
