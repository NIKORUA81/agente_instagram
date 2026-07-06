import { Injectable, Logger } from '@nestjs/common';
import type { Channel, Contact, Conversation, Prisma } from '@prisma/client';
import { WS_EVENTS } from '@wolfiax/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toConversationDto } from '../inbox/inbox.mappers';
import { isWindowOpen, MessagingService } from '../messaging/messaging.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AiClientService } from './ai-client.service';

const HISTORY_LIMIT = 10;

export interface AiReplyInput {
  channel: Channel;
  conversation: Conversation & { contact: Contact };
  /** id del mensaje entrante recién persistido (para no incluirlo en el historial) */
  messageId: string;
  text: string;
}

/**
 * Orquesta la respuesta automática de la IA para un mensaje entrante.
 * Reglas: solo si el ai_profile está habilitado, la conversación está en modo
 * 'ai' y la ventana de 24h sigue abierta. La IA propone; si pide handover o hay
 * baja confianza, se transfiere a un humano en vez de responder.
 */
@Injectable()
export class AiReplyService {
  private readonly logger = new Logger(AiReplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClientService,
    private readonly messaging: MessagingService,
    private readonly gateway: RealtimeGateway,
  ) {}

  async maybeReply(input: AiReplyInput): Promise<void> {
    const { channel, conversation } = input;
    if (conversation.mode !== 'ai') return;
    if (!isWindowOpen(conversation)) return; // fuera de la ventana no se responde
    if (!input.text.trim()) return; // reacciones/adjuntos sin texto: no dispara IA

    const orgId = channel.organizationId;

    const ctx = await this.prisma.withTenant(orgId, async (tx) => {
      const profile = await tx.aiProfile.findUnique({ where: { channelId: channel.id } });
      if (!profile || !profile.enabled) return null;

      // Presupuesto mensual de tokens
      if (
        profile.monthlyTokenBudget !== null &&
        profile.tokensUsedMonth >= profile.monthlyTokenBudget
      ) {
        this.logger.warn(`Presupuesto de tokens agotado para canal ${channel.id}; se deriva.`);
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { status: 'pending' },
        });
        return null;
      }

      const history = await tx.message.findMany({
        where: { conversationId: conversation.id, id: { not: input.messageId }, type: 'text' },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
        select: { direction: true, text: true },
      });
      const priorAi = await tx.message.count({
        where: { conversationId: conversation.id, source: 'ai' },
      });

      return { profile, history: history.reverse(), includeDisclosure: priorAi === 0 };
    });

    if (!ctx) return;

    const response = await this.ai.reply({
      organization_id: orgId,
      profile: {
        system_prompt: ctx.profile.systemPrompt,
        tone: ctx.profile.tone,
        language_policy: ctx.profile.languagePolicy,
        disclosure_message: ctx.profile.disclosureMessage,
        confidence_threshold: ctx.profile.confidenceThreshold,
        business_hours: ctx.profile.businessHours,
        guardrails: ctx.profile.guardrails,
        handover_keywords: ctx.profile.handoverKeywords,
      },
      message: input.text,
      history: ctx.history
        .filter((h) => h.text)
        .map((h) => ({ role: h.direction === 'inbound' ? 'user' : 'assistant', text: h.text! })),
      contact_name: conversation.contact.name ?? conversation.contact.username,
      include_disclosure: ctx.includeDisclosure,
    });

    // Contabilidad de tokens + datos extraídos + señales de conversación
    await this.prisma.withTenant(orgId, async (tx) => {
      await tx.aiProfile.update({
        where: { channelId: channel.id },
        data: {
          tokensUsedMonth: { increment: response.input_tokens + response.output_tokens },
        },
      });
      const extracted = response.extracted ?? {};
      const hasExtracted = extracted.name || extracted.phone || extracted.email || extracted.interest;
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          ...(response.intent ? { intent: response.intent } : {}),
          ...(response.language ? { language: response.language } : {}),
          ...(response.sentiment ? { sentiment: response.sentiment } : {}),
        },
      });
      if (hasExtracted) {
        await tx.contact.update({
          where: { id: conversation.contactId },
          data: { extracted: extracted as unknown as Prisma.InputJsonValue },
        });
      }
    });

    if (response.handover) {
      await this.handover(orgId, conversation, response.reason);
      return;
    }

    if (response.reply) {
      await this.messaging.sendAsAi(conversation, response.reply);
    }
  }

  private async handover(
    orgId: string,
    conversation: Conversation & { contact: Contact },
    reason: string | null,
  ): Promise<void> {
    const updated = await this.prisma.withTenant(orgId, (tx) =>
      tx.conversation.update({
        where: { id: conversation.id },
        data: { mode: 'human', status: 'pending' },
        include: {
          contact: true,
          tags: { include: { tag: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
    );
    // Nota interna del sistema explicando por qué se derivó
    await this.prisma.withTenant(orgId, (tx) =>
      tx.message.create({
        data: {
          organizationId: orgId,
          conversationId: conversation.id,
          direction: 'outbound',
          source: 'system',
          type: 'text',
          status: 'received',
          text: `🤖→👤 Derivado a un agente${reason ? `: ${reason}` : '.'}`,
        },
      }),
    );
    this.gateway.emitToOrg(orgId, WS_EVENTS.CONVERSATION_UPDATED, toConversationDto(updated));
    this.logger.log(`Conversación ${conversation.id} derivada a humano.`);
  }
}
