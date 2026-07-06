import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Automation, Channel, Contact, Conversation, Message } from '@prisma/client';
import { WS_EVENTS, type AutomationAction, type AutomationTrigger } from '@wolfiax/shared';
import type Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/queue/queue.module';
import { toConversationDto } from '../inbox/inbox.mappers';
import { MessagingService } from '../messaging/messaging.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { matchesTrigger, type TriggerContext } from './matcher';

export interface EngineInput {
  channel: Channel;
  conversation: Conversation & { contact: Contact };
  message: Message;
  isNewContact: boolean;
}

/**
 * Motor de automatizaciones (F2): evalúa reglas por prioridad sobre cada
 * mensaje entrante; la PRIMERA regla que dispara ejecuta todas sus acciones
 * y detiene la evaluación (doc 04 §2, paso 10c). Cooldown por contacto en
 * Redis para evitar spam en ráfagas.
 */
@Injectable()
export class AutomationsEngine {
  private readonly logger = new Logger(AutomationsEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly gateway: RealtimeGateway,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async evaluate(input: EngineInput): Promise<void> {
    const { channel, conversation, message } = input;
    const ctx: TriggerContext = {
      kind:
        message.type === 'reaction'
          ? 'reaction'
          : message.type === 'story_reply'
            ? 'story_reply'
            : 'message',
      text: message.text,
      isNewContact: input.isNewContact,
    };

    const automations = await this.prisma.withTenant(channel.organizationId, (tx) =>
      tx.automation.findMany({
        where: {
          organizationId: channel.organizationId,
          enabled: true,
          OR: [{ channelId: null }, { channelId: channel.id }],
        },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      }),
    );

    for (const automation of automations) {
      try {
        if (!matchesTrigger(automation.trigger as unknown as AutomationTrigger, ctx)) continue;
        if (!(await this.passesCooldown(automation, conversation.contactId))) continue;

        await this.execute(automation, input);
        return; // primera coincidencia gana
      } catch (err) {
        // Una automatización rota jamás debe tumbar el procesamiento del mensaje
        this.logger.error(
          `Automatización ${automation.id} (${automation.name}) falló: ${(err as Error).message}`,
        );
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------

  private async passesCooldown(automation: Automation, contactId: string): Promise<boolean> {
    if (automation.cooldownSeconds <= 0) return true;
    try {
      const key = `autocd:${automation.id}:${contactId}`;
      const result = await this.redis
        .connect()
        .catch(() => undefined) // ya conectado
        .then(() => this.redis.set(key, '1', 'EX', automation.cooldownSeconds, 'NX'));
      return result === 'OK';
    } catch {
      // Redis caído: preferimos disparar de más a perder la automatización
      return true;
    }
  }

  private async execute(automation: Automation, input: EngineInput): Promise<void> {
    const { conversation } = input;
    const actions = automation.actions as unknown as AutomationAction[];
    const updates: Record<string, unknown> = {};

    for (const action of actions) {
      switch (action.type) {
        case 'reply':
          await this.messaging.sendAsAutomation(conversation, action.text);
          break;
        case 'add_tag':
          await this.prisma.withTenant(conversation.organizationId, async (tx) => {
            const tag = await tx.tag.findFirst({
              where: { id: action.tag_id, organizationId: conversation.organizationId },
            });
            if (!tag) return;
            await tx.conversationTag.upsert({
              where: {
                conversationId_tagId: { conversationId: conversation.id, tagId: tag.id },
              },
              create: {
                conversationId: conversation.id,
                tagId: tag.id,
                organizationId: conversation.organizationId,
              },
              update: {},
            });
          });
          break;
        case 'assign':
          updates.assignedUserId = action.user_id;
          break;
        case 'set_status':
          updates.status = action.status;
          break;
      }
    }

    const updated = await this.prisma.withTenant(conversation.organizationId, async (tx) => {
      await tx.automation.update({
        where: { id: automation.id },
        data: { fireCount: { increment: 1 }, lastFiredAt: new Date() },
      });
      return tx.conversation.update({
        where: { id: conversation.id },
        data: updates,
        include: {
          contact: true,
          tags: { include: { tag: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
    });

    this.gateway.emitToOrg(
      conversation.organizationId,
      WS_EVENTS.CONVERSATION_UPDATED,
      toConversationDto(updated),
    );
    this.logger.log(`Automatización "${automation.name}" disparada en conv ${conversation.id}`);
  }
}
