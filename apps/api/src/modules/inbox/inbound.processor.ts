import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Channel, Prisma } from '@prisma/client';
import { WS_EVENTS } from '@wolfiax/shared';
import { Worker, type Job } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { TokenCipherService } from '../../common/crypto/token-cipher.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QUEUE_NAMES, REDIS_OPTIONS } from '../../common/queue/queue.module';
import type { Env } from '../../config/configuration';
import { AutomationsEngine } from '../automations/automations.engine';
import { MetaGraphService } from '../channels/meta-graph.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { MetaMessagingEvent } from '../webhooks/meta-webhook.types';
import { toConversationDto, toMessageDto } from './inbox.mappers';

interface InboundJobData {
  webhookEventId: string;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Consumidor de la cola `inbound`: webhook crudo → contacto + conversación +
 * mensaje (tenant-scoped) → evento WS al dashboard.
 *
 * En F1 corre dentro del proceso api (una réplica). El diseño ya soporta
 * extraerlo: MODE=worker levanta solo este consumidor.
 */
@Injectable()
export class InboundProcessor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(InboundProcessor.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: MetaGraphService,
    private readonly cipher: TokenCipherService,
    private readonly gateway: RealtimeGateway,
    private readonly automations: AutomationsEngine,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_OPTIONS) private readonly redisOptions: RedisOptions,
  ) {}

  onModuleInit(): void {
    const mode = this.config.get('MODE', { infer: true });
    if (mode === 'webhook') return; // el ingestor puro no consume
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;

    this.worker = new Worker<InboundJobData>(
      QUEUE_NAMES.inbound,
      (job) => this.process(job),
      { connection: this.redisOptions, concurrency: 5 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} falló: ${err.message}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async process(job: Job<InboundJobData>): Promise<void> {
    const { webhookEventId } = job.data;

    const event = await this.prisma.withSystem((tx) =>
      tx.webhookEvent.findUnique({ where: { id: webhookEventId } }),
    );
    if (!event || event.processedAt) return;

    const payload = event.payload as unknown as {
      entryId: string;
      time: number;
      event: MetaMessagingEvent;
    };

    const channel = await this.prisma.withSystem((tx) =>
      tx.channel.findUnique({ where: { igUserId: payload.entryId } }),
    );

    if (!channel || channel.status === 'disconnected') {
      await this.markProcessed(webhookEventId, 'canal no encontrado o desconectado');
      return;
    }

    try {
      await this.handleEvent(channel, payload.event);
      await this.markProcessed(webhookEventId);
    } catch (err) {
      await this.prisma.withSystem((tx) =>
        tx.webhookEvent.update({
          where: { id: webhookEventId },
          data: { error: (err as Error).message.slice(0, 500) },
        }),
      );
      throw err; // BullMQ reintenta con backoff
    }
  }

  // ---------------------------------------------------------------------------

  private async handleEvent(channel: Channel, event: MetaMessagingEvent): Promise<void> {
    const isEcho = event.message?.is_echo === true;
    // En un echo el "contacto" es el destinatario (el negocio envió el mensaje)
    const contactIgsid = isEcho ? event.recipient.id : event.sender.id;
    const eventDate = new Date(event.timestamp || Date.now());

    // Perfil ANTES de la transacción (llamada externa, best-effort, solo contactos nuevos)
    const existingContact = await this.prisma.withTenant(channel.organizationId, (tx) =>
      tx.contact.findUnique({
        where: { channelId_igScopedId: { channelId: channel.id, igScopedId: contactIgsid } },
        select: { id: true },
      }),
    );
    let profile: Awaited<ReturnType<MetaGraphService['igScopedUserProfile']>> = null;
    if (!existingContact) {
      const token = this.cipher.decrypt(channel.accessTokenEnc);
      profile = await this.graph.igScopedUserProfile(
        contactIgsid,
        token,
        channel.connectionType as 'instagram_login' | 'facebook_login',
      );
    }

    const result = await this.prisma.withTenant(channel.organizationId, async (tx) => {
      const contact = await tx.contact.upsert({
        where: { channelId_igScopedId: { channelId: channel.id, igScopedId: contactIgsid } },
        create: {
          organizationId: channel.organizationId,
          channelId: channel.id,
          igScopedId: contactIgsid,
          username: profile?.username ?? null,
          name: profile?.name ?? null,
          profilePicUrl: profile?.profile_pic ?? null,
          isFollower: profile?.is_user_follow_business ?? null,
        },
        update: { lastSeenAt: eventDate },
      });

      const windowUpdate = isEcho
        ? {}
        : {
            windowExpiresAt: new Date(eventDate.getTime() + WINDOW_MS),
            lastInboundAt: eventDate,
          };

      const conversation = await tx.conversation.upsert({
        where: { channelId_contactId: { channelId: channel.id, contactId: contact.id } },
        create: {
          organizationId: channel.organizationId,
          channelId: channel.id,
          contactId: contact.id,
          status: 'open',
          lastMessageAt: eventDate,
          ...windowUpdate,
        },
        update: {
          lastMessageAt: eventDate,
          // Un mensaje entrante reabre conversaciones resueltas/archivadas
          ...(isEcho ? {} : { status: 'open' }),
          ...windowUpdate,
        },
        include: { contact: true },
      });

      const messageData = this.mapMessage(channel.organizationId, conversation.id, event, isEcho);
      let message;
      try {
        message = await tx.message.create({ data: messageData });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') return null; // mid duplicado
        throw err;
      }
      return { conversation, message };
    });

    if (result) {
      this.gateway.emitToOrg(channel.organizationId, WS_EVENTS.MESSAGE_NEW, {
        conversation_id: result.conversation.id,
        message: toMessageDto(result.message),
      });
      this.gateway.emitToOrg(
        channel.organizationId,
        WS_EVENTS.CONVERSATION_UPDATED,
        toConversationDto({ ...result.conversation, messages: [result.message] }),
      );

      // Motor de automatizaciones: solo sobre mensajes ENTRANTES del usuario
      // (nunca sobre echoes del propio negocio, para no auto-dispararse).
      if (!isEcho) {
        await this.automations.evaluate({
          channel,
          conversation: result.conversation,
          message: result.message,
          isNewContact: !existingContact,
        });
      }
    }
  }

  private mapMessage(
    organizationId: string,
    conversationId: string,
    event: MetaMessagingEvent,
    isEcho: boolean,
  ): Prisma.MessageUncheckedCreateInput {
    const base = {
      organizationId,
      conversationId,
      direction: isEcho ? 'outbound' : 'inbound',
      source: isEcho ? 'system' : 'user',
      status: 'received',
      createdAt: new Date(event.timestamp || Date.now()),
    } as const;

    if (event.reaction) {
      return {
        ...base,
        mid: `${event.reaction.mid}:${event.reaction.action}`,
        type: 'reaction',
        text: event.reaction.emoji ?? event.reaction.reaction ?? null,
        aiMeta: { reacted_to_mid: event.reaction.mid, action: event.reaction.action },
      };
    }

    if (event.postback) {
      return {
        ...base,
        mid: event.postback.mid ?? null,
        type: 'text',
        text: event.postback.title ?? event.postback.payload ?? null,
        aiMeta: { postback_payload: event.postback.payload },
      };
    }

    const msg = event.message!;
    const attachments =
      msg.attachments?.map((a) => ({ type: a.type, url: a.payload?.url ?? null })) ?? [];
    const storyReply = msg.reply_to?.story
      ? { story_id: msg.reply_to.story.id, url: msg.reply_to.story.url }
      : null;

    let type = 'text';
    if (storyReply) type = 'story_reply';
    else if (msg.is_unsupported) type = 'unsupported';
    else if (attachments.length > 0) {
      const first = attachments[0].type;
      type = ['image', 'video', 'audio', 'file', 'share'].includes(first) ? first : 'file';
    }

    return {
      ...base,
      mid: msg.mid,
      type,
      text: msg.text ?? null,
      attachments: attachments as unknown as Prisma.InputJsonValue,
      ...(storyReply ? { replyToStory: storyReply as unknown as Prisma.InputJsonValue } : {}),
    };
  }

  private markProcessed(id: string, error?: string): Promise<unknown> {
    return this.prisma.withSystem((tx) =>
      tx.webhookEvent.update({
        where: { id },
        data: { processedAt: new Date(), ...(error ? { error } : {}) },
      }),
    );
  }
}
