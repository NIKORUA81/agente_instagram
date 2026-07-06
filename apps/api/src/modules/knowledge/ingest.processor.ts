import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QUEUE_NAMES, REDIS_OPTIONS } from '../../common/queue/queue.module';
import type { Env } from '../../config/configuration';
import { AiClientService } from '../ai/ai-client.service';
import type { IngestJobData } from './ingest.types';

/** Consume la cola `ingest`: entrega el contenido al ai-service para trocearlo,
 * generar embeddings e insertar chunks. El ai-service marca la fuente
 * ready/failed en la BD. */
@Injectable()
export class IngestProcessor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(IngestProcessor.name);
  private worker?: Worker;

  constructor(
    private readonly ai: AiClientService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_OPTIONS) private readonly redisOptions: RedisOptions,
  ) {}

  onModuleInit(): void {
    if (this.config.get('MODE', { infer: true }) === 'webhook') return;
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;

    this.worker = new Worker<IngestJobData>(
      QUEUE_NAMES.ingest,
      (job) => this.process(job),
      { connection: this.redisOptions, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`Ingesta ${job?.id} falló: ${err.message}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async process(job: Job<IngestJobData>): Promise<void> {
    const data = job.data;
    try {
      const result = await this.ai.ingest({
        organization_id: data.organizationId,
        source_id: data.sourceId,
        source_type: data.sourceType,
        name: data.name,
        text: data.text,
        content_base64: data.contentBase64,
        url: data.url,
      });
      this.logger.log(
        `Fuente ${data.sourceId} → ${result.status} (${result.chunk_count} chunks)`,
      );
    } catch (err) {
      const isLast = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isLast) {
        // El ai-service no pudo procesar (p. ej. inalcanzable): marca la fuente
        await this.prisma
          .withTenant(data.organizationId, (tx) =>
            tx.knowledgeSource.update({
              where: { id: data.sourceId },
              data: { status: 'failed', error: (err as Error).message.slice(0, 300) },
            }),
          )
          .catch(() => undefined);
      }
      throw err;
    }
  }
}
