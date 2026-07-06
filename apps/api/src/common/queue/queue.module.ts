import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import Redis from 'ioredis';
import type { Env } from '../../config/configuration';

export const REDIS_CLIENT = 'REDIS_CLIENT';
export const REDIS_OPTIONS = 'REDIS_OPTIONS';
export const QUEUE_INBOUND = 'QUEUE_INBOUND';

export const QUEUE_NAMES = {
  inbound: 'inbound',
} as const;

/** redis://[:pass@]host:port[/db] → opciones ioredis (BullMQ exige maxRetriesPerRequest null). */
export function parseRedisUrl(url: string): RedisOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    password: u.password || undefined,
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
  ],
  exports: [REDIS_CLIENT, REDIS_OPTIONS, QUEUE_INBOUND],
})
export class QueueModule {}
