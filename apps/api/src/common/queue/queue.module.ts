import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import Redis from 'ioredis';
import type { Env } from '../../config/configuration';

export const REDIS_CLIENT = 'REDIS_CLIENT';
export const REDIS_OPTIONS = 'REDIS_OPTIONS';
export const QUEUE_INBOUND = 'QUEUE_INBOUND';
export const QUEUE_OUTBOUND = 'QUEUE_OUTBOUND';
export const QUEUE_INGEST = 'QUEUE_INGEST';
export const QUEUE_FLOW = 'QUEUE_FLOW';

export const QUEUE_NAMES = {
  inbound: 'inbound',
  outbound: 'outbound',
  ingest: 'ingest',
  flow: 'flow',
} as const;

/** redis://[:pass@]host:port[/db] → opciones ioredis (BullMQ exige maxRetriesPerRequest null). */
export function parseRedisUrl(url: string): RedisOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  };
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        parseRedisUrl(config.get('REDIS_URL', { infer: true })),
    },
    {
      provide: REDIS_CLIENT,
      inject: [REDIS_OPTIONS],
      useFactory: (options: RedisOptions) =>
        new Redis({ ...options, lazyConnect: true, enableOfflineQueue: false }),
    },
    {
      provide: QUEUE_INBOUND,
      inject: [REDIS_OPTIONS],
      useFactory: (options: RedisOptions) =>
        new Queue(QUEUE_NAMES.inbound, {
          connection: options,
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: { age: 24 * 3600, count: 5000 },
            removeOnFail: false, // los fallidos quedan visibles (DLQ implícita)
          },
        }),
    },
    {
      provide: QUEUE_OUTBOUND,
      inject: [REDIS_OPTIONS],
      useFactory: (options: RedisOptions) =>
        new Queue(QUEUE_NAMES.outbound, {
          connection: options,
          defaultJobOptions: {
            attempts: 4,
            backoff: { type: 'exponential', delay: 3000 },
            removeOnComplete: { age: 24 * 3600, count: 5000 },
            removeOnFail: false,
          },
        }),
    },
    {
      provide: QUEUE_INGEST,
      inject: [REDIS_OPTIONS],
      useFactory: (options: RedisOptions) =>
        new Queue(QUEUE_NAMES.ingest, {
          connection: options,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 24 * 3600, count: 2000 },
            removeOnFail: false,
          },
        }),
    },
    {
      provide: QUEUE_FLOW,
      inject: [REDIS_OPTIONS],
      useFactory: (options: RedisOptions) =>
        new Queue(QUEUE_NAMES.flow, {
          connection: options,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 3000 },
            removeOnComplete: { age: 24 * 3600, count: 5000 },
            removeOnFail: false,
          },
        }),
    },
  ],
  exports: [REDIS_CLIENT, REDIS_OPTIONS, QUEUE_INBOUND, QUEUE_OUTBOUND, QUEUE_INGEST, QUEUE_FLOW],
})
export class QueueModule {}
