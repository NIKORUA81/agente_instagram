import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Env } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalInterceptors(new LoggerErrorInterceptor());

  const config = app.get(ConfigService<Env, true>);

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('WEB_ORIGIN', { infer: true }),
    credentials: true,
  });
  // El proxy (Traefik/NGINX) termina TLS; confiamos en X-Forwarded-* solo del primer salto
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.setGlobalPrefix('api/v1', { exclude: ['healthz'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('WOLFIAX SOCIAL AI — API')
        .setDescription('API REST v1. Ver docs/05-API.md para convenciones.')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, doc);
  }

  app.enableShutdownHooks();
  const port = config.get('PORT', { infer: true });
  await app.listen(port);
}

void bootstrap();
