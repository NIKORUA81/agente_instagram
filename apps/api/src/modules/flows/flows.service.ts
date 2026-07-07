import { HttpStatus, Injectable } from '@nestjs/common';
import type { Flow } from '@prisma/client';
import {
  ERROR_CODES,
  type FlowDto,
  type FlowExecutionDto,
  type FlowGraph,
  type FlowTrigger,
  type FlowValidationResult,
  type FlowVersionDto,
} from '@wolfiax/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth.types';
import { AppError } from '../../common/errors/app-error';
import { PrismaService, type Tx } from '../../common/prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import type { RequestContext } from '../iam/auth.service';
import { graphSchema, parseGraph, parseTrigger, triggerSchema, validateGraph } from './flow-graph.schema';
import { toFlowDto, toFlowExecutionDto, toFlowVersionDto } from './flows.mappers';

export interface FlowInput {
  name: string;
  description?: string | null;
  channel_id?: string | null;
  trigger?: unknown;
  graph?: unknown;
  enabled?: boolean;
}

const FLOW_INCLUDE = {
  versions: { select: { version: true } },
  _count: { select: { versions: true, executions: true } },
} as const;

@Injectable()
export class FlowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser): Promise<FlowDto[]> {
    const flows = await this.prisma.withTenant(actor.organizationId, (tx) =>
      tx.flow.findMany({
        where: { organizationId: actor.organizationId },
        include: FLOW_INCLUDE,
        orderBy: { updatedAt: 'desc' },
      }),
    );
    return flows.map(toFlowDto);
  }

  async get(actor: AuthUser, id: string): Promise<FlowDto> {
    const flow = await this.prisma.withTenant(actor.organizationId, (tx) =>
      tx.flow.findFirst({
        where: { id, organizationId: actor.organizationId },
        include: FLOW_INCLUDE,
      }),
    );
    if (!flow) throw this.notFound();
    return toFlowDto(flow);
  }

  async create(actor: AuthUser, input: FlowInput, ctx: RequestContext): Promise<FlowDto> {
    const graph = input.graph !== undefined ? this.parseGraph(input.graph) : defaultGraph();
    const trigger = input.trigger !== undefined ? this.parseTrigger(input.trigger) : { type: 'manual' as const };

    const flow = await this.prisma.withTenant(actor.organizationId, async (tx) => {
      await this.validateChannel(tx, actor, input.channel_id);
      const created = await tx.flow.create({
        data: {
          organizationId: actor.organizationId,
          channelId: input.channel_id ?? null,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          trigger: trigger as unknown as object,
          graph: graph as unknown as object,
          enabled: false,
          status: 'draft',
        },
        include: FLOW_INCLUDE,
      });
      await this.audit.log(tx, {
        organizationId: actor.organizationId,
        userId: actor.userId,
        action: 'flow.created',
        resource: 'flow',
        resourceId: created.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { name: created.name },
      });
      return created;
    });
    return toFlowDto(flow);
  }

  async update(
    actor: AuthUser,
    id: string,
    input: Partial<FlowInput>,
    ctx: RequestContext,
  ): Promise<FlowDto> {
    const graph = input.graph !== undefined ? this.parseGraph(input.graph) : undefined;
    const trigger = input.trigger !== undefined ? this.parseTrigger(input.trigger) : undefined;

    const flow = await this.prisma.withTenant(actor.organizationId, async (tx) => {
      await this.findOrFail(tx, actor, id);
      if (input.channel_id !== undefined) await this.validateChannel(tx, actor, input.channel_id);
      const updated = await tx.flow.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
          ...(input.channel_id !== undefined ? { channelId: input.channel_id } : {}),
          ...(graph !== undefined ? { graph: graph as unknown as object } : {}),
          ...(trigger !== undefined ? { trigger: trigger as unknown as object } : {}),
        },
        include: FLOW_INCLUDE,
      });
      await this.audit.log(tx, {
        organizationId: actor.organizationId,
        userId: actor.userId,
        action: 'flow.updated',
        resource: 'flow',
        resourceId: id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    });
    return toFlowDto(flow);
  }

  async remove(actor: AuthUser, id: string, ctx: RequestContext): Promise<void> {
    await this.prisma.withTenant(actor.organizationId, async (tx) => {
      const flow = await this.findOrFail(tx, actor, id);
      await tx.flow.delete({ where: { id } });
      await this.audit.log(tx, {
        organizationId: actor.organizationId,
        userId: actor.userId,
        action: 'flow.deleted',
        resource: 'flow',
        resourceId: id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { name: flow.name },
      });
    });
  }

  /** Valida el grafo del borrador (o uno provisto) sin publicar. */
  validate(actor: AuthUser, id: string, graphInput?: unknown): Promise<FlowValidationResult> {
    return this.prisma.withTenant(actor.organizationId, async (tx) => {
      const flow = await this.findOrFail(tx, actor, id);
      const graph = graphInput !== undefined ? this.parseGraph(graphInput) : (flow.graph as unknown as FlowGraph);
      const issues = validateGraph(graph);
      return { valid: issues.length === 0, issues };
    });
  }

  /**
   * Publica el borrador: valida, crea una FlowVersion inmutable con el número
   * siguiente, apunta publishedVersionId, marca el flujo como published/enabled.
   * Las ejecuciones en curso terminan con su versión anterior.
   */
  async publish(actor: AuthUser, id: string, ctx: RequestContext): Promise<FlowDto> {
    const flow = await this.prisma.withTenant(actor.organizationId, async (tx) => {
      const current = await this.findOrFail(tx, actor, id);
      const graph = current.graph as unknown as FlowGraph;
      const issues = validateGraph(graph);
      if (issues.length > 0) {
        throw new AppError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          ERROR_CODES.VALIDATION_ERROR,
          'El flujo tiene errores; corrígelos antes de publicar.',
          issues.map((i) => ({ field: i.node_id ?? 'graph', issue: i.message })),
        );
      }
      const last = await tx.flowVersion.findFirst({
        where: { flowId: id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (last?.version ?? 0) + 1;
      const version = await tx.flowVersion.create({
        data: {
          organizationId: actor.organizationId,
          flowId: id,
          version: nextVersion,
          graph: current.graph as object,
          trigger: current.trigger as object,
        },
      });
      const updated = await tx.flow.update({
        where: { id },
        data: { status: 'published', enabled: true, publishedVersionId: version.id },
        include: FLOW_INCLUDE,
      });
      await this.audit.log(tx, {
        organizationId: actor.organizationId,
        userId: actor.userId,
        action: 'flow.published',
        resource: 'flow',
        resourceId: id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { version: nextVersion },
      });
      return updated;
    });
    return toFlowDto(flow);
  }

  async setEnabled(actor: AuthUser, id: string, enabled: boolean): Promise<FlowDto> {
    const flow = await this.prisma.withTenant(actor.organizationId, async (tx) => {
      const current = await this.findOrFail(tx, actor, id);
      if (enabled && !current.publishedVersionId) {
        throw new AppError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          ERROR_CODES.VALIDATION_ERROR,
          'Publica el flujo antes de activarlo.',
        );
      }
      return tx.flow.update({ where: { id }, data: { enabled }, include: FLOW_INCLUDE });
    });
    return toFlowDto(flow);
  }

  async versions(actor: AuthUser, id: string): Promise<FlowVersionDto[]> {
    const versions = await this.prisma.withTenant(actor.organizationId, async (tx) => {
      await this.findOrFail(tx, actor, id);
      return tx.flowVersion.findMany({ where: { flowId: id }, orderBy: { version: 'desc' } });
    });
    return versions.map(toFlowVersionDto);
  }

  async executions(actor: AuthUser, id: string): Promise<FlowExecutionDto[]> {
    const execs = await this.prisma.withTenant(actor.organizationId, async (tx) => {
      await this.findOrFail(tx, actor, id);
      return tx.flowExecution.findMany({
        where: { flowId: id },
        include: { flow: { select: { name: true } }, contact: { select: { name: true, username: true } } },
        orderBy: { startedAt: 'desc' },
        take: 50,
      });
    });
    return execs.map(toFlowExecutionDto);
  }

  // ---------------------------------------------------------------------------

  private parseGraph(input: unknown): FlowGraph {
    try {
      return parseGraph(input);
    } catch (err) {
      throw this.badGraph(err);
    }
  }

  private parseTrigger(input: unknown): FlowTrigger {
    try {
      return parseTrigger(input);
    } catch (err) {
      throw this.badGraph(err);
    }
  }

  private badGraph(err: unknown): AppError {
    const issues =
      err instanceof z.ZodError
        ? err.issues.map((i) => ({ field: i.path.join('.'), issue: i.message }))
        : undefined;
    return new AppError(
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      'El grafo del flujo no es válido.',
      issues,
    );
  }

  private async validateChannel(tx: Tx, actor: AuthUser, channelId?: string | null): Promise<void> {
    if (!channelId) return;
    const channel = await tx.channel.findFirst({
      where: { id: channelId, organizationId: actor.organizationId },
      select: { id: true },
    });
    if (!channel) {
      throw new AppError(HttpStatus.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Canal inválido.');
    }
  }

  private async findOrFail(tx: Tx, actor: AuthUser, id: string): Promise<Flow> {
    const flow = await tx.flow.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!flow) throw this.notFound();
    return flow;
  }

  private notFound(): AppError {
    return new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Flujo no encontrado.');
  }
}

function defaultGraph(): FlowGraph {
  return {
    nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Inicio' } }],
    edges: [],
  };
}

// Reexport para tests / consistencia de esquema.
export { graphSchema, triggerSchema };
