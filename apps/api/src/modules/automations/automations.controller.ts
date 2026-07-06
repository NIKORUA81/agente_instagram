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
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AutomationDto } from '@wolfiax/shared';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth/auth.types';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { RequestContext } from '../iam/auth.service';
import { AutomationsService } from './automations.service';

class AutomationBodyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsUUID()
  channel_id?: string | null;

  /** Validado estructuralmente con zod en el servicio */
  trigger!: unknown;
  actions!: unknown;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  cooldown_seconds?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class AutomationPatchDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsUUID()
  channel_id?: string | null;

  @IsOptional()
  trigger?: unknown;

  @IsOptional()
  actions?: unknown;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  cooldown_seconds?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class AutomationTestDto {
  @IsString()
  @MaxLength(1000)
  text!: string;
}

@ApiTags('automations')
@ApiBearerAuth()
@Controller('automations')
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get()
  @ApiOperation({ summary: 'Automatizaciones de la organización' })
  list(@CurrentUser() user: AuthUser): Promise<AutomationDto[]> {
    return this.automations.list(user);
  }

  @Post()
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Crea una automatización' })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: AutomationBodyDto,
    @Req() req: Request,
  ): Promise<AutomationDto> {
    return this.automations.create(user, dto, this.ctx(req));
  }

  @Patch(':id')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Actualiza una automatización' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AutomationPatchDto,
    @Req() req: Request,
  ): Promise<AutomationDto> {
    return this.automations.update(user, id, dto, this.ctx(req));
  }

  @Post(':id/toggle')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Activa/desactiva' })
  toggle(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AutomationDto> {
    return this.automations.toggle(user, id);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Elimina una automatización' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.automations.remove(user, id, this.ctx(req));
  }

  @Post('test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sandbox: qué regla dispararía un texto de ejemplo' })
  test(
    @CurrentUser() user: AuthUser,
    @Body() dto: AutomationTestDto,
  ): Promise<{ matched: AutomationDto | null }> {
    return this.automations.test(user, { text: dto.text });
  }

  private ctx(req: Request): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }
}
