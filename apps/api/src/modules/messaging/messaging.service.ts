import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Conversation, Message, Prisma } from '@prisma/client';
import { ERROR_CODES, WS_EVENTS, type SendMessageRequest } from '@wolfiax/shared';
import type { Queue } from 'bullmq';
import type { AuthUser } from '../../common/auth/auth.types';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QUEUE_OUTBOUND } from '../../common/queue/queue.module';
import { toMessageDto } from '../inbox/inbox.mappers';
import { RealtimeGateway } from '../realtime/realtime.gateway';

/** La ventana de 24h está abierta si el último inbound fue hace <24h. */
export function isWindowOpen(conversation: Pick<Conversation, 'windowExpiresAt'>): boolean {
  return (
    conversation.windowExpiresAt !== null &&
    conversation.windowExpiresAt.getTime() > Date.now()
  );
}

/**
 * Envío saliente. Crea el mensaje en estado `queued` y lo encola; el
 * OutboundProcessor hace la llamada real a Meta (con re-verificación de
 * ventana: pudo cerrarse mientras el job esperaba en la cola).
 */
@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RealtimeGateway,
    @Inject(QUEUE_OUTBOUND) private readonly outboundQueue: Queue,
  ) {}

  async sendAsAgent(
    actor: AuthUser,
    conversationId: string,
    dto: SendMessageRequest,
  ): Promise<Message> {
    this.validatePayload(dto);

    const conversation = await this.prisma.withTenant(actor.organizationId, (tx) =>
      tx.conversation.findFirst({
        where: { id: conversationId, organizationId: actor.organizationId },
      }),
    );
    if (!conversation) {
      throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Conversación no encontrada.');
    }
    if (!isWindowOpen(conversation)) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'CONVERSATION_WINDOW_CLOSED',
        'La ventana de 24 horas expiró: Meta no permite enviar mensajes hasta que el cliente vuelva a escribir.',
      );
    }

    return this.enqueue(conversation, {
      source: 'agent',
      sentByUserId: actor.userId,
      text: dto.text ?? null,
      attachment: dto.attachment_url
        ? { type: dto.attachment_type ?? 'image', url: dto.attachment_url }
        : null,
    });
  }

  /** Usado por el motor de automatizaciones (la ventana ya fue verificada por el caller entrante, pero se revalida). */
  async sendAsAutomation(conversation: Conversation, text: string): Promise<Message | null> {
    if (!isWindowOpen(conversation)) return null;
    return this.enqueue(conversation, {
      source: 'automation',
      sentByUserId: null,
      text,
      attachment: null,
    });
  }

  /** Usado por el motor de IA (F3). */
  async sendAsAi(conversation: Conversation, text: string): Promise<Message | null> {
    if (!isWindowOpen(conversation)) return null;
    return this.enqueue(conversation, {
      source: 'ai',
      sentByUserId: null,
      text,
      attachment: null,
    });
  }

  /** Usado por el motor de flujos (F4). */
  async sendAsFlow(conversation: Conversation, text: string): Promise<Message | null> {
    if (!isWindowOpen(conversation)) return null;
    return this.enqueue(conversation, {
      source: 'flow',
      sentByUserId: null,
      text,
      attachment: null,
    });
  }

  // ---------------------------------------------------------------------------

  private async enqueue(
    conversation: Conversation,
    input: {
      source: 'agent' | 'automation' | 'ai' | 'flow';
      sentByUserId: string | null;
      text: string | null;
      attachment: { type: string; url: string } | null;
    },
  ): Promise<Message> {
    const message = await this.prisma.withTenant(conversation.organizationId, (tx) =>
      tx.message.create({
        data: {
          organizationId: conversation.organizationId,
          conversationId: conversation.id,
          direction: 'outbound',
          source: input.source,
          type: input.attachment ? input.attachment.type : 'text',
          text: input.text,
          attachments: (input.attachment
            ? [{ type: input.attachment.type, url: input.attachment.url }]
            : []) as unknown as Prisma.InputJsonValue,
          status: 'queued',
          sentByUserId: input.sentByUserId,
        },
      }),
    );

    await this.outboundQueue.add('send', { messageId: message.id }, { jobId: message.id });

    this.gateway.emitToOrg(conversation.organizationId, WS_EVENTS.MESSAGE_NEW, {
      conversation_id: conversation.id,
      message: toMessageDto(message),
    });
    return message;
  }

  private validatePayload(dto: SendMessageRequest): void {
    const hasText = Boolean(dto.text?.trim());
    const hasAttachment = Boolean(dto.attachment_url);
    if (!hasText && !hasAttachment) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
        'El mensaje necesita texto o un adjunto.',
        [{ field: 'text', issue: 'texto o attachment_url requerido' }],
      );
    }
    if (hasText && hasAttachment) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
        'Meta no permite texto y adjunto en el mismo mensaje: envíalos por separado.',
      );
    }
  }
}
