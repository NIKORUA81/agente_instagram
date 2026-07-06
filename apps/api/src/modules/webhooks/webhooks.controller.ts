import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/auth/decorators';
import type { Env } from '../../config/configuration';
import { verifyMetaSignature } from './meta-signature.util';
import type { MetaWebhookBody } from './meta-webhook.types';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks/meta')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly verifyToken?: string;
  private readonly appSecrets: string[];

  constructor(
    private readonly webhooks: WebhooksService,
    config: ConfigService<Env, true>,
  ) {
    this.verifyToken = config.get('META_WEBHOOK_VERIFY_TOKEN', { infer: true });
    this.appSecrets = [
      config.get('META_APP_SECRET', { infer: true }),
      config.get('META_IG_APP_SECRET', { infer: true }),
    ].filter((s): s is string => Boolean(s));
  }

  /** Verificación de suscripción (la hace Meta al configurar el webhook). */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Verificación hub.challenge de Meta' })
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    if (mode === 'subscribe' && this.verifyToken && token === this.verifyToken && challenge) {
      return challenge;
    }
    throw new ForbiddenException();
  }

  /**
   * Recepción de eventos. Verifica la firma HMAC contra el cuerpo crudo,
   * persiste + encola y responde 200 de inmediato (objetivo <200ms).
   */
  @Public()
  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Recepción de eventos de mensajería de Instagram' })
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature?: string,
  ): Promise<string> {
    if (!verifyMetaSignature(req.rawBody, signature, this.appSecrets)) {
      this.logger.warn('Webhook con firma inválida rechazado');
      throw new ForbiddenException();
    }
    try {
      await this.webhooks.ingest(req.body as MetaWebhookBody);
    } catch (err) {
      // Nunca hacemos fallar el ACK a Meta por errores internos: el evento
      // crudo queda en webhook_events para replay manual.
      this.logger.error(`Error en ingesta de webhook: ${(err as Error).message}`);
    }
    return 'EVENT_RECEIVED';
  }
}
