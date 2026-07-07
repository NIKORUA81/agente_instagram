import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { QUEUE_NAMES, REDIS_OPTIONS } from '../../common/queue/queue.module';
import type { Env } from '../../config/configuration';
import { FlowEngineService } from './flow-engine.service';

interface FlowWakeJob {
  executionId: string;
}

/**
 * Consumidor de la cola `flow`: despierta ejecuciones en espera de timer
 * (nodo "esperar"). El job se encoló con `delay` = duración de la espera.
 */
@Injectable()
export class FlowProcessor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(FlowProcessor.name);
  private worker?: Worker;

  constructor(
    private readonly engine: FlowEngineService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_OPTIONS) private readonly redisOptions: RedisOptions,
  ) {}

  onModuleInit(): void {
    if (this.config.get('MODE', { infer: true }) === 'webhook') return;
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;

    this.worker = new Worker<FlowWakeJob>(
      QUEUE_NAMES.flow,
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

  async process(job: Job<FlowWakeJob>): Promise<void> {
    if (job.name !== 'wake') return;
    await this.engine.wake(job.data.executionId);
  }
}
