import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QUEUE_INBOUND } from '../../common/queue/queue.module';
import {
  eventExternalId,
  eventType,
  type MetaWebhookBody,
} from './meta-webhook.types';

/**
 * Ingesta de webhooks: persistir crudo (idempotente) + encolar. NADA de lógica
 * de negocio aquí — el objetivo es responder 200 a Meta en milisegundos.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(QUEUE_INBOUND) private readonly inboundQueue: Queue,
  ) {}

  async ingest(body: MetaWebhookBody): Promise<void> {
    if (body.object !== 'instagram' || !Array.isArray(body.entry)) return;

    for (const entry of body.entry) {
      const events = entry.messaging ?? [];
      for (const event of events) {
        const externalId = eventExternalId(event);
        const type = eventType(event);
        // Los eventos de lectura no aportan al inbox F1
        if (type === 'read' || type === 'unknown') continue;

        // Idempotencia: Meta reintenta webhooks; el UNIQUE (external_id, event_type)
        // hace que los duplicados se descarten aquí.
        const stored = await this.prisma.withSystem(async (tx) => {
          const channel = await tx.channel.findUnique({
            where: { igUserId: entry.id },
            select: { id: true },
          });
          try {
            return await tx.webhookEvent.create({
              data: {
                channelId: channel?.id ?? null,
                externalId,
                eventType: type,
                payload: { entryId: entry.id, time: entry.time, event } as unknown as Prisma.InputJsonValue,
              },
              select: { id: true },
            });
          } catch (err) {
            const code = (err as { code?: string }).code;
            if (code === 'P2002') return null; // duplicado: ya lo procesamos
            throw err;
          }
        });

        if (stored) {
          await this.inboundQueue.add(
            'process',
            { webhookEventId: stored.id },
            // Orden por conversación: un solo job activo por (canal, remitente)
            { jobId: stored.id },
          );
        }
      }
    }
  }
}
