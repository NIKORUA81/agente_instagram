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
import type {
  FlowDto,
  FlowExecutionDto,
  FlowSimulationResult,
  FlowValidationResult,
  FlowVersionDto,
} from '@wolfiax/shared';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth/auth.types';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import type { RequestContext } from '../iam/auth.service';
import { parseGraph } from './flow-graph.schema';
import { FlowSimulatorService } from './flow-simulator.service';
import { FlowsService } from './flows.service';

class CreateFlowDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsUUID() channel_id?: string | null;
  @IsOptional() trigger?: unknown;
  @IsOptional() graph?: unknown;
}

class UpdateFlowDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsUUID() channel_id?: string | null;
  @IsOptional() trigger?: unknown;
  @IsOptional() graph?: unknown;
}

class ValidateFlowDto {
  @IsOptional() graph?: unknown;
}

class ToggleFlowDto {
  @IsBoolean() enabled!: boolean;
}

class SimulateFlowDto {
  @IsOptional() graph?: unknown;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) messages!: string[];
}

@ApiTags('flows')
@ApiBearerAuth()
@Controller('flows')
export class FlowsController {
  constructor(
    private readonly flows: FlowsService,
    private readonly simulator: FlowSimulatorService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Flujos de la organización' })
  list(@CurrentUser() user: AuthUser): Promise<FlowDto[]> {
    return this.flows.list(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un flujo (incluye grafo borrador)' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<FlowDto> {
    return this.flows.get(user, id);
  }

  @Post()
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Crea un flujo' })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFlowDto,
    @Req() req: Request,
  ): Promise<FlowDto> {
    return this.flows.create(user, dto, this.ctx(req));
  }

  @Patch(':id')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Actualiza el flujo (nombre, disparador, grafo borrador)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFlowDto,
    @Req() req: Request,
  ): Promise<FlowDto> {
    return this.flows.update(user, id, dto, this.ctx(req));
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Elimina un flujo' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.flows.remove(user, id, this.ctx(req));
  }

  @Post(':id/validate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Valida el grafo (borrador o provisto) sin publicar' })
  validate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValidateFlowDto,
  ): Promise<FlowValidationResult> {
    return this.flows.validate(user, id, dto.graph);
  }

  @Post(':id/publish')
  @Roles('owner', 'admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publica una versión inmutable y activa el flujo' })
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<FlowDto> {
    return this.flows.publish(user, id, this.ctx(req));
  }

  @Post(':id/toggle')
  @Roles('owner', 'admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activa o desactiva un flujo publicado' })
  toggle(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ToggleFlowDto,
  ): Promise<FlowDto> {
    return this.flows.setEnabled(user, id, dto.enabled);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'Historial de versiones publicadas' })
  versions(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FlowVersionDto[]> {
    return this.flows.versions(user, id);
  }

  @Get(':id/executions')
  @ApiOperation({ summary: 'Ejecuciones recientes con traza' })
  executions(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FlowExecutionDto[]> {
    return this.flows.executions(user, id);
  }

  @Post(':id/simulate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sandbox: simula el flujo con mensajes de ejemplo' })
  async simulate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SimulateFlowDto,
  ): Promise<FlowSimulationResult> {
    const flow = await this.flows.get(user, id);
    const graph = dto.graph !== undefined ? parseGraph(dto.graph) : flow.graph;
    return this.simulator.simulate(user.organizationId, graph, dto.messages ?? []);
  }

  private ctx(req: Request): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }
}
