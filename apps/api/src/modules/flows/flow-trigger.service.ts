import { Injectable, Logger } from '@nestjs/common';
import type { Channel, Contact, Conversation } from '@prisma/client';
import type { FlowGraph, FlowTrigger } from '@wolfiax/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FlowEngineService } from './flow-engine.service';

export interface FlowTriggerInput {
  channel: Channel;
  conversation: Conversation & { contact: Contact };
  text: string;
  isNewContact: boolean;
}

/**
 * Evalúa los flujos publicados y activos de un canal sobre un mensaje entrante.
 * Se ejecuta en el enrutamiento del inbound (doc 04 §2, paso 10): si un flujo
 * dispara, arranca su ejecución y el mensaje se considera manejado.
 */
@Injectable()
export class FlowTriggerService {
  private readonly logger = new Logger(FlowTriggerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: FlowEngineService,
  ) {}

  /** Devuelve true si un flujo arrancó (para que la IA no responda encima). */
  async maybeStart(input: FlowTriggerInput): Promise<boolean> {
    const { channel, conversation } = input;
    const orgId = channel.organizationId;

    const flows = await this.prisma.withTenant(orgId, (tx) =>
      tx.flow.findMany({
        where: {
          organizationId: orgId,
          enabled: true,
          status: 'published',
          publishedVersionId: { not: null },
          OR: [{ channelId: null }, { channelId: channel.id }],
        },
        orderBy: { updatedAt: 'desc' },
      }),
    );

    for (const flow of flows) {
      if (!matchesFlowTrigger(flow.trigger as unknown as FlowTrigger, input)) continue;
      try {
        const version = await this.prisma.withTenant(orgId, (tx) =>
          tx.flowVersion.findUnique({ where: { id: flow.publishedVersionId! } }),
        );
        if (!version) continue;
        await this.engine.startFlow({
          flowId: flow.id,
          flowVersionId: version.id,
          graph: version.graph as unknown as FlowGraph,
          channel,
          conversation,
          initialText: input.text,
        });
        this.logger.log(`Flujo "${flow.name}" arrancó en conv ${conversation.id}`);
        return true;
      } catch (err) {
        this.logger.error(`Flujo ${flow.id} falló al arrancar: ${(err as Error).message}`);
        return true; // manejado: no queremos que la IA responda sobre un flujo roto
      }
    }
    return false;
  }
}

export function matchesFlowTrigger(trigger: FlowTrigger, input: FlowTriggerInput): boolean {
  switch (trigger.type) {
    case 'manual':
      return false;
    case 'new_contact':
      return input.isNewContact;
    case 'any_message':
      return true;
    case 'keyword': {
      const text = (input.text ?? '').toLowerCase();
      if (!text) return false;
      return trigger.keywords.some((kw) => {
        const k = kw.toLowerCase();
        return (trigger.match ?? 'contains') === 'exact' ? text === k : text.includes(k);
      });
    }
    default:
      return false;
  }
}
