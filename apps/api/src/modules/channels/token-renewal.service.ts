import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TokenCipherService } from '../../common/crypto/token-cipher.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MetaGraphService } from './meta-graph.service';

const RENEW_WINDOW_DAYS = 10;

/**
 * Renovación proactiva de tokens de Instagram Login (expiran ~60 días;
 * se renuevan cuando quedan <10). Los Page Access Tokens de facebook_login
 * no expiran y no requieren renovación.
 */
@Injectable()
export class TokenRenewalService {
  private readonly logger = new Logger(TokenRenewalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: MetaGraphService,
    private readonly cipher: TokenCipherService,
  ) {}

  @Cron('0 15 3 * * *') // 03:15 diario
  async renewExpiringTokens(): Promise<void> {
    const threshold = new Date(Date.now() + RENEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const expiring = await this.prisma.withSystem((tx) =>
      tx.channel.findMany({
        where: {
          status: 'active',
          connectionType: 'instagram_login',
          tokenExpiresAt: { not: null, lt: threshold },
        },
      }),
    );
    if (expiring.length === 0) return;
    this.logger.log(`Renovando ${expiring.length} token(s) de Instagram por vencer`);

    for (const channel of expiring) {
      try {
        const current = this.cipher.decrypt(channel.accessTokenEnc);
        const renewed = await this.graph.igRefreshToken(current);
        await this.prisma.withSystem((tx) =>
          tx.channel.update({
            where: { id: channel.id },
            data: {
              accessTokenEnc: new Uint8Array(this.cipher.encrypt(renewed.access_token)),
              tokenExpiresAt: new Date(Date.now() + renewed.expires_in * 1000),
            },
          }),
        );
        this.logger.log(`Token renovado para @${channel.igUsername}`);
      } catch (err) {
        this.logger.error(
          `No se pudo renovar el token de @${channel.igUsername}: ${(err as Error).message}`,
        );
        await this.prisma.withSystem((tx) =>
          tx.channel.update({
            where: { id: channel.id },
            data: { status: 'token_expired' },
          }),
        );
        // TODO(F2): notificar por email/banner al owner del tenant
      }
    }
  }
}
