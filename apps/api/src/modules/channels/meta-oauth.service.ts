import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES, type ConnectionType } from '@wolfiax/shared';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { TokenCipherService } from '../../common/crypto/token-cipher.service';
import { AppError } from '../../common/errors/app-error';
import { REDIS_CLIENT } from '../../common/queue/queue.module';
import type { Env } from '../../config/configuration';
import { TokensService } from '../iam/tokens.service';
import { MetaGraphService } from './meta-graph.service';

const SESSION_TTL_SECONDS = 900; // 15 min para elegir cuenta

/** Candidato guardado en Redis durante la selección de cuenta. */
export interface StoredCandidate {
  igUserId: string;
  igUsername: string;
  name: string | null;
  profilePicUrl: string | null;
  fbPageId: string | null;
  fbPageName: string | null;
  /** token cifrado (base64 del Buffer AES-GCM) */
  tokenEncB64: string;
  tokenExpiresAt: string | null;
  grantedScopes: string[];
}

export interface StoredConnectSession {
  organizationId: string;
  userId: string;
  connectionType: ConnectionType;
  candidates: StoredCandidate[];
}

export type CallbackOutcome =
  | { kind: 'single'; session: StoredConnectSession; organizationId: string }
  | { kind: 'selection'; sessionId: string; organizationId: string };

/**
 * Flujo OAuth de conexión de Instagram (ambas vías oficiales).
 * El resultado del callback se guarda en Redis (tokens SIEMPRE cifrados)
 * hasta que el usuario elige cuenta o se crea el canal directamente.
 */
@Injectable()
export class MetaOAuthService {
  private readonly logger = new Logger(MetaOAuthService.name);
  private readonly redirectUri: string;

  constructor(
    private readonly graph: MetaGraphService,
    private readonly tokens: TokensService,
    private readonly cipher: TokenCipherService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService<Env, true>,
  ) {
    const base = this.config.get('API_PUBLIC_URL', { infer: true }).replace(/\/$/, '');
    this.redirectUri = `${base}/api/v1/channels/instagram/callback`;
  }

  // ---------------------------------------------------------------------------
  // Paso 1: URL de autorización
  // ---------------------------------------------------------------------------

  async buildAuthorizationUrl(
    organizationId: string,
    userId: string,
    connectionType: ConnectionType,
  ): Promise<string> {
    const state = await this.tokens.signOAuthState({ organizationId, userId, connectionType });

    if (connectionType === 'instagram_login') {
      const clientId = this.config.get('META_IG_APP_ID', { infer: true });
      if (!clientId) {
        throw new AppError(
          HttpStatus.SERVICE_UNAVAILABLE,
          ERROR_CODES.INTERNAL,
          'La conexión con Instagram no está configurada (META_IG_APP_ID).',
        );
      }
      return this.graph.igAuthorizeUrl(clientId, this.redirectUri, state);
    }

    const clientId = this.config.get('META_APP_ID', { infer: true });
    if (!clientId) {
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        ERROR_CODES.INTERNAL,
        'La conexión con Facebook no está configurada (META_APP_ID).',
      );
    }
    return this.graph.fbAuthorizeUrl(clientId, this.redirectUri, state);
  }

  // ---------------------------------------------------------------------------
  // Paso 2: callback → candidatos
  // ---------------------------------------------------------------------------

  async handleCallback(code: string, state: string): Promise<CallbackOutcome> {
    const ctx = await this.tokens.verifyOAuthState(state);

    const candidates =
      ctx.connectionType === 'instagram_login'
        ? await this.candidatesViaInstagramLogin(code)
        : await this.candidatesViaFacebookLogin(code);

    if (candidates.length === 0) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ERROR_CODES.VALIDATION_ERROR,
        'No se encontró ninguna cuenta profesional de Instagram en esa autorización.',
      );
    }

    const session: StoredConnectSession = {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      connectionType: ctx.connectionType,
      candidates,
    };

    if (candidates.length === 1) {
      return { kind: 'single', session, organizationId: ctx.organizationId };
    }

    const sessionId = randomUUID();
    await this.redis.set(
      this.sessionKey(sessionId),
      JSON.stringify(session),
      'EX',
      SESSION_TTL_SECONDS,
    );
    return { kind: 'selection', sessionId, organizationId: ctx.organizationId };
  }

  async getSession(sessionId: string): Promise<StoredConnectSession | null> {
    const raw = await this.redis.get(this.sessionKey(sessionId));
    return raw ? (JSON.parse(raw) as StoredConnectSession) : null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.del(this.sessionKey(sessionId));
  }

  // ---------------------------------------------------------------------------

  private async candidatesViaInstagramLogin(code: string): Promise<StoredCandidate[]> {
    const short = await this.graph.igExchangeCode(code, this.redirectUri);
    const long = await this.graph.igLongLivedToken(short.access_token);
    const me = await this.graph.igMe(long.access_token);

    const igUserId = String(me.user_id ?? me.id ?? short.user_id ?? '');
    if (!igUserId) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ERROR_CODES.VALIDATION_ERROR,
        'Meta no devolvió el identificador de la cuenta de Instagram.',
      );
    }

    return [
      {
        igUserId,
        igUsername: me.username,
        name: me.name ?? null,
        profilePicUrl: me.profile_picture_url ?? null,
        fbPageId: null,
        fbPageName: null,
        tokenEncB64: this.cipher.encrypt(long.access_token).toString('base64'),
        tokenExpiresAt: new Date(Date.now() + long.expires_in * 1000).toISOString(),
        grantedScopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
      },
    ];
  }

  private async candidatesViaFacebookLogin(code: string): Promise<StoredCandidate[]> {
    const short = await this.graph.fbExchangeCode(code, this.redirectUri);
    const long = await this.graph.fbLongLivedToken(short.access_token);
    const pages = await this.graph.fbPagesWithInstagram(long.access_token);

    return pages.map((page) => ({
      igUserId: page.instagram_business_account!.id,
      igUsername: page.instagram_business_account!.username ?? page.name,
      name: page.instagram_business_account!.name ?? null,
      profilePicUrl: page.instagram_business_account!.profile_picture_url ?? null,
      fbPageId: page.id,
      fbPageName: page.name,
      // El Page Access Token derivado de un user token long-lived no expira
      tokenEncB64: this.cipher.encrypt(page.access_token).toString('base64'),
      tokenExpiresAt: null,
      grantedScopes: [
        'instagram_basic',
        'instagram_manage_messages',
        'pages_show_list',
        'pages_manage_metadata',
      ],
    }));
  }

  private sessionKey(id: string): string {
    return `connect:${id}`;
  }
}
