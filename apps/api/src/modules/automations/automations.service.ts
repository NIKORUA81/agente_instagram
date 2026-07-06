import { HttpStatus, Injectable } from '@nestjs/common';
import type { Automation } from '@prisma/client';
import {
  ERROR_CODES,
  type AutomationAction,
  type AutomationDto,
  type AutomationTrigger,
} from '@wolfiax/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth.types';
import { AppError } from '../../common/errors/app-error';
import { PrismaService, type Tx } from '../../common/prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import type { RequestContext } from '../iam/auth.service';
import { matchesTrigger, type TriggerContext } from './matcher';

// Validación estructural de trigger/actions (JSON polimórfico → zod)
const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('any_message') }),
  z.object({
    type: z.literal('keyword'),
    keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
    match: z.enum(['contains', 'exact']).optional(),
  }),
  z.object({ type: z.literal('story_reply') }),
  z.object({ type: z.literal('reaction') }),
  z.object({ type: z.literal('new_contact') }),
]);

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reply'), text: z.string().trim().min(1).max(1000) }),
  z.object({ type: z.literal('add_tag'), tag_id: z.string().uuid() }),
  z.object({ type: z.literal('assign'), user_id: z.string().uuid() }),
  z.object({
    type: z.literal('set_status'),
    status: z.enum(['open', 'pending', 'resolved', 'archived']),
  }),
]);

const definitionSchema = z.object({
  trigger: triggerSchema,
  actions: z.array(actionSchema).min(1).max(5),
});

export function toAutomationDto(automation: Automation): AutomationDto {
  return {
    id: automation.id,
    name: automation.name,
    channel_id: automation.channelId,
    enabled: automation.enabled,
    trigger: automation.trigger as unknown as AutomationTrigger,
    actions: automation.actions as unknown as AutomationAction[],
    priority: automation.priority,
    cooldown_seconds: automation.cooldownSeconds,
    fire_count: Number(automation.fireCount),
    last_fired_at: automation.lastFiredAt?.toISOString() ?? null,
    created_at: automation.createdAt.toISOString(),
  };
}

export interface AutomationInput {
  name: string;
  channel_id?: string | null;
  trigger: unknown;
  actions: unknown;
  priority?: number;
  cooldown_seconds?: number;
  enabled?: boolean;
}

@Injectable()
export class AutomationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser): Promise<AutomationDto[]> {
    const automations = await this.prisma.withTenant(actor.organizationId, (tx) =>
      tx.automation.findMany({
        where: { organizationId: actor.organizationId },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      }),
    );
    return automations.map(toAutomationDto);
  }

  async create(actor: AuthUser, input: AutomationInput, ctx: RequestContext): Promise<AutomationDto> {
    const definition = this.validateDefinition(input);
    const automation = await this.prisma.withTenant(actor.organizationId, async (tx) => {
      await this.validateReferences(tx, actor, input, definition.actions);
      const created = await tx.automation.create({
        data: {
          organizationId: actor.organizationId,
          channelId: input.channel_id ?? null,
          name: input.name.trim(),
          trigger: definition.trigger,
          actions: definition.actions,
          priority: input.priority ?? 100,
          cooldownSeconds: input.cooldown_seconds ?? 60,
          enabled: input.enabled ?? true,
        },
      });
      await this.audit.log(tx, {
        organizationId: actor.organizationId,
        userId: actor.userId,
        action: 'automation.created',
        resource: 'automation',
        resourceId: created.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { name: created.name },
      });
      return created;
    });
    return toAutomationDto(automation);
  }

  async update(
    actor: AuthUser,
    id: string,
    input: Partial<AutomationInput>,
    ctx: RequestContext,
  ): Promise<AutomationDto> {
    const definition =
      input.trigger !== undefined || input.actions !== undefined
        ? this.validateDefinition({
            trigger: input.trigger,
            actions: input.actions,
          } as AutomationInput)
        : null;

    const automation = await this.prisma.withTenant(actor.organizationId, async (tx) => {
      await this.findOrFail(tx, actor, id);
      if (definition) await this.validateReferences(tx, actor, input, definition.actions);
      const updated = await tx.automation.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.channel_id !== undefined ? { channelId: input.channel_id } : {}),
          ...(definition ? { trigger: definition.trigger, actions: definition.actions } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.cooldown_seconds !== undefined
            ? { cooldownSeconds: input.cooldown_seconds }
            : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      });
      await this.audit.log(tx, {
        organizationId: actor.organizationId,
        userId: actor.userId,
        action: 'automation.updated',
        resource: 'automation',
        resourceId: id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    });
    return toAutomationDto(automation);
  }

  async toggle(actor: AuthUser, id: string): Promise<AutomationDto> {
    const automation = await this.prisma.withTenant(actor.organizationId, async (tx) => {
      const current = await this.findOrFail(tx, actor, id);
      return tx.automation.update({ where: { id }, data: { enabled: !current.enabled } });
    });
    return toAutomationDto(automation);
  }

  async remove(actor: AuthUser, id: string, ctx: RequestContext): Promise<void> {
    await this.prisma.withTenant(actor.organizationId, async (tx) => {
      const automation = await this.findOrFail(tx, actor, id);
      await tx.automation.delete({ where: { id } });
      await this.audit.log(tx, {
        organizationId: actor.organizationId,
        userId: actor.userId,
        action: 'automation.deleted',
        resource: 'automation',
        resourceId: id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { name: automation.name },
      });
    });
  }

  /** Sandbox: qué automatización dispararía este mensaje de ejemplo. */
  async test(
    actor: AuthUser,
    sample: { text: string; kind?: 'message' | 'story_reply' | 'reaction'; is_new_contact?: boolean },
  ): Promise<{ matched: AutomationDto | null }> {
    const ctx: TriggerContext = {
      kind: sample.kind ?? 'message',
      text: sample.text,
      isNewContact: sample.is_new_contact ?? false,
    };
    const automations = await this.prisma.withTenant(actor.organizationId, (tx) =>
      tx.automation.findMany({
        where: { organizationId: actor.organizationId, enabled: true },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      }),
    );
    const matched = automations.find((a) =>
      matchesTrigger(a.trigger as unknown as AutomationTrigger, ctx),
    );
    return { matched: matched ? toAutomationDto(matched) : null };
  }

  // ---------------------------------------------------------------------------

  private validateDefinition(input: Pick<AutomationInput, 'trigger' | 'actions'>): {
    trigger: AutomationTrigger;
    actions: AutomationAction[];
  } {
    const parsed = definitionSchema.safeParse({ trigger: input.trigger, actions: input.actions });
    if (!parsed.success) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
        'El disparador o las acciones no son válidos.',
        parsed.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message })),
      );
    }
    return parsed.data as { trigger: AutomationTrigger; actions: AutomationAction[] };
  }

  /** Verifica que tag/usuario/canal referenciados pertenezcan al tenant. */
  private async validateReferences(
    tx: Tx,
    actor: AuthUser,
    input: Partial<AutomationInput>,
    actions: AutomationAction[],
  ): Promise<void> {
    if (input.channel_id) {
      const channel = await tx.channel.findFirst({
        where: { id: input.channel_id, organizationId: actor.organizationId },
      });
      if (!channel) {
        throw new AppError(HttpStatus.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Canal inválido.');
      }
    }
    for (const action of actions) {
      if (action.type === 'add_tag') {
        const tag = await tx.tag.findFirst({
          where: { id: action.tag_id, organizationId: actor.organizationId },
        });
        if (!tag) {
          throw new AppError(
            HttpStatus.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
            'La etiqueta de la acción no existe.',
          );
        }
      }
      if (action.type === 'assign') {
        const membership = await tx.membership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: actor.organizationId,
              userId: action.user_id,
            },
          },
        });
        if (!membership) {
          throw new AppError(
            HttpStatus.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
            'El usuario de la acción de asignación no es miembro.',
          );
        }
      }
    }
  }

  private async findOrFail(tx: Tx, actor: AuthUser, id: string): Promise<Automation> {
    const automation = await tx.automation.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!automation) {
      throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Automatización no encontrada.');
    }
    return automation;
  }
}
