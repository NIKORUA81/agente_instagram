import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WS_EVENTS, type WsMessageStatusPayload } from '@wolfiax/shared';
import { Worker, type Job } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { TokenCipherService } from '../../common/crypto/token-cipher.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QUEUE_NAMES, REDIS_OPTIONS } from '../../common/queue/queue.module';
import type { Env } from '../../config/configuration';
import { MetaGraphService } from '../channels/meta-graph.service';
import { MetaApiError } from '../channels/meta.types';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { isWindowOpen } from './messaging.service';

interface OutboundJobData {
  messageId: string;
}

/**
 * Consumidor de la cola `outbound`: entrega mensajes a la Graph API.
 * Limiter global de 10 msg/s hacia Meta (muy por debajo de los límites
 * oficiales; se refina por-canal cuando haya volumen real).
 */
@Injectable()
export class OutboundProcessor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboundProcessor.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: MetaGraphService,
    private readonly cipher: TokenCipherService,
    private readonly gateway: RealtimeGateway,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_OPTIONS) private readonly redisOptions: RedisOptions,
  ) {}

  onModuleInit(): void {
    if (this.config.get('MODE', { infer: true }) === 'webhook') return;
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;

    this.worker = new Worker<OutboundJobData>(
      QUEUE_NAMES.outbound,
      (job) => this.process(job),
      {
        connection: this.redisOptions,
        concurrency: 5,
        limiter: { max: 10, duration: 1000 },
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`Envío ${job?.id} falló: ${err.message}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async process(job: Job<OutboundJobData>): Promise<void> {
    const data = await this.prisma.withSystem(async (tx) => {
      const message = await tx.message.findUnique({ where: { id: job.data.messageId } });
      if (!message || message.status !== 'queued') return null;
      const conversation = await tx.conversation.findUnique({
        where: { id: message.conversationId },
        include: { contact: true, channel: true },
      });
      return conversation ? { message, conversation } : null;
    });
    if (!data) return;
    const { message, conversation } = data;
    const channel = conversation.channel;

    // Re-verificación de ventana: pudo expirar mientras el job esperaba
    if (!isWindowOpen(conversation)) {
      await this.fail(message.id, conversation.organizationId, conversation.id, 'window_closed', false);
      return;
    }
    if (channel.status !== 'active') {
      await this.fail(message.id, conversation.organizationId, conversation.id, `channel_${channel.status}`, false);
      return;
    }

    try {
      const token = this.cipher.decrypt(channel.accessTokenEnc);
      const attachments = message.attachments as unknown as Array<{ type: string; url: string }>;
      const result = await this.graph.sendMessage({
        connectionType: channel.connectionType as 'instagram_login' | 'facebook_login',
        token,
        recipientIgsid: conversation.contact.igScopedId,
        text: message.text ?? undefined,
        attachment:
          attachments.length > 0
            ? { type: attachments[0].type as 'image' | 'video' | 'audio', url: attachments[0].url }
            : undefined,
      });

      await this.prisma.withTenant(conversation.organizationId, async (tx) => {
        await tx.message.update({
          where: { id: message.id },
          data: { status: 'sent', mid: result.message_id ?? undefined },
        });
        await tx.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt: new Date(),
            // Métrica: tiempo hasta la primera respuesta humana/automática
            ...(conversation.firstResponseMs === null && conversation.lastInboundAt
              ? { firstResponseMs: Date.now() - conversation.lastInboundAt.getTime() }
              : {}),
          },
        });
      });
      this.emitStatus(conversation.organizationId, conversation.id, message.id, 'sent');
    } catch (err) {
      if (err instanceof MetaApiError && err.isTokenInvalid) {
        await this.prisma.withSystem((tx) =>
          tx.channel.update({ where: { id: channel.id }, data: { status: 'token_expired' } }),
        );
        await this.fail(message.id, conversation.organizationId, conversation.id, 'token_expired', false);
        return;
      }
      // Errores transitorios: se marca el intento y BullMQ reintenta
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isLastAttempt) {
        await this.fail(
          message.id,
          conversation.organizationId,
          conversation.id,
          (err as Error).message.slice(0, 300),
          false,
        );
      }
      throw err;
    }
  }

  private async fail(
    messageId: string,
    organizationId: string,
    conversationId: string,
    error: string,
    rethrow: boolean,
  ): Promise<void> {
    await this.prisma.withTenant(organizationId, (tx) =>
      tx.message.update({ where: { id: messageId }, data: { status: 'failed', error } }),
    );
    this.emitStatus(organizationId, conversationId, messageId, 'failed', error);
    if (rethrow) throw new Error(error);
  }

  private emitStatus(
    organizationId: string,
    conversationId: string,
    messageId: string,
    status: string,
    error?: string,
  ): void {
    const payload: WsMessageStatusPayload = {
      conversation_id: conversationId,
      message_id: messageId,
      status,
      error: error ?? null,
    };
    this.gateway.emitToOrg(organizationId, WS_EVENTS.MESSAGE_STATUS, payload);
  }
}
