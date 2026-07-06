import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { PlatformAdminGuard } from './common/auth/platform-admin.guard';
import { RolesGuard } from './common/auth/roles.guard';
import { GlobalExceptionFilter } from './common/errors/http-exception.filter';
import { PrismaModule } from './common/prisma/prisma.module';
import { QueueModule } from './common/queue/queue.module';
import { validateEnv } from './config/configuration';
import { AiModule } from './modules/ai/ai.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { HealthModule } from './modules/health/health.module';
import { IamModule } from './modules/iam/iam.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { PlatformModule } from './modules/platform/platform.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
        // Nunca loguear credenciales ni cookies de sesión
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          censor: '[redacted]',
        },
        autoLogging: { ignore: (req) => req.url === '/healthz' },
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),
    // Límite global; los endpoints de credenciales llevan @Throttle más estricto
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    QueueModule,
    IamModule,
    ChannelsModule,
    WebhooksModule,
    MessagingModule,
    AutomationsModule,
    AiModule,
    KnowledgeModule,
    InboxModule,
    PlatformModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    // Orden de guards: rate limit → autenticación → roles → plataforma
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PlatformAdminGuard },
  ],
})
export class AppModule {}
