import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';
import {
  MetaApiError,
  type FbPage,
  type FbPagesResponse,
  type FbTokenResponse,
  type IgLongLivedTokenResponse,
  type IgMeResponse,
  type IgTokenResponse,
  type IgUserProfile,
} from './meta.types';

/**
 * Cliente HTTP hacia las APIs oficiales de Meta.
 * Hosts según la vía de conexión:
 *  - facebook_login:   graph.facebook.com
 *  - instagram_login:  api.instagram.com (OAuth) + graph.instagram.com (Graph)
 * Los tokens NUNCA se loguean (solo host + path).
 */
@Injectable()
export class MetaGraphService {
  private readonly logger = new Logger(MetaGraphService.name);
  private readonly version: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.version = this.config.get('META_GRAPH_VERSION', { infer: true });
  }

  // ---------------------------------------------------------------------------
  // Facebook Login (página + IG vinculado)
  // ---------------------------------------------------------------------------

  fbAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
    const scopes = [
      'instagram_basic',
      'instagram_manage_messages',
      'pages_show_list',
      'pages_manage_metadata',
      'business_management',
    ].join(',');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: scopes,
    });
    return `https://www.facebook.com/${this.version}/dialog/oauth?${params}`;
  }

  fbExchangeCode(code: string, redirectUri: string): Promise<FbTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.required('META_APP_ID'),
      client_secret: this.required('META_APP_SECRET'),
      redirect_uri: redirectUri,
      code,
    });
    return this.request<FbTokenResponse>(
      `https://graph.facebook.com/${this.version}/oauth/access_token?${params}`,
    );
  }

  fbLongLivedToken(shortToken: string): Promise<FbTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.required('META_APP_ID'),
      client_secret: this.required('META_APP_SECRET'),
      fb_exchange_token: shortToken,
    });
    return this.request<FbTokenResponse>(
      `https://graph.facebook.com/${this.version}/oauth/access_token?${params}`,
    );
  }

  async fbPagesWithInstagram(userToken: string): Promise<FbPage[]> {
    const params = new URLSearchParams({
      fields: 'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}',
      limit: '100',
      access_token: userToken,
    });
    const res = await this.request<FbPagesResponse>(
      `https://graph.facebook.com/${this.version}/me/accounts?${params}`,
    );
    return res.data.filter((p) => p.instagram_business_account);
  }

  async fbSubscribePageToWebhooks(pageId: string, pageToken: string): Promise<void> {
    const params = new URLSearchParams({
      subscribed_fields: 'messages,messaging_postbacks,message_reactions',
      access_token: pageToken,
    });
    await this.request(
      `https://graph.facebook.com/${this.version}/${pageId}/subscribed_apps`,
      { method: 'POST', body: params },
    );
  }

  // ---------------------------------------------------------------------------
  // Instagram Login (sin página de Facebook)
  // ---------------------------------------------------------------------------

  igAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
    const scopes = ['instagram_business_basic', 'instagram_business_manage_messages'].join(',');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: scopes,
    });
    return `https://www.instagram.com/oauth/authorize?${params}`;
  }

  igExchangeCode(code: string, redirectUri: string): Promise<IgTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.required('META_IG_APP_ID'),
      client_secret: this.required('META_IG_APP_SECRET'),
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    });
    return this.request<IgTokenResponse>('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body,
    });
  }

  igLongLivedToken(shortToken: string): Promise<IgLongLivedTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: this.required('META_IG_APP_SECRET'),
      access_token: shortToken,
    });
    return this.request<IgLongLivedTokenResponse>(
      `https://graph.instagram.com/access_token?${params}`,
    );
  }

  igRefreshToken(token: string): Promise<IgLongLivedTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'ig_refresh_token',
      access_token: token,
    });
    return this.request<IgLongLivedTokenResponse>(
      `https://graph.instagram.com/refresh_access_token?${params}`,
    );
  }

  igMe(token: string): Promise<IgMeResponse> {
    const params = new URLSearchParams({
      fields: 'user_id,username,name,account_type,profile_picture_url',
      access_token: token,
    });
    return this.request<IgMeResponse>(`https://graph.instagram.com/${this.version}/me?${params}`);
  }

  async igSubscribeToWebhooks(igUserId: string, token: string): Promise<void> {
    const params = new URLSearchParams({
      subscribed_fields: 'messages,messaging_postbacks,message_reactions',
      access_token: token,
    });
    await this.request(
      `https://graph.instagram.com/${this.version}/${igUserId}/subscribed_apps`,
      { method: 'POST', body: params },
    );
  }

  /** Sondeo barato de salud para canales facebook_login (lanza si el token murió). */
  async fbProbeIgAccount(igUserId: string, pageToken: string): Promise<void> {
    const params = new URLSearchParams({ fields: 'username', access_token: pageToken });
    await this.request(`https://graph.facebook.com/${this.version}/${igUserId}?${params}`);
  }

  // ---------------------------------------------------------------------------
  // Perfil del usuario final (para contactos del inbox)
  // ---------------------------------------------------------------------------

  async igScopedUserProfile(
    igsid: string,
    channelToken: string,
    connectionType: 'instagram_login' | 'facebook_login',
  ): Promise<IgUserProfile | null> {
    const host =
      connectionType === 'instagram_login' ? 'graph.instagram.com' : 'graph.facebook.com';
    const params = new URLSearchParams({
      fields: 'name,username,profile_pic,is_user_follow_business',
      access_token: channelToken,
    });
    try {
      return await this.request<IgUserProfile>(
        `https://${host}/${this.version}/${igsid}?${params}`,
      );
    } catch (err) {
      // El perfil puede no estar disponible (privacidad/ventana): no es fatal
      this.logger.warn(`No se pudo obtener perfil de ${igsid}: ${(err as Error).message}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------

  private required(key: 'META_APP_ID' | 'META_APP_SECRET' | 'META_IG_APP_ID' | 'META_IG_APP_SECRET'): string {
    const value = this.config.get(key, { infer: true });
    if (!value) {
      throw new Error(
        `${key} no está configurada. Crea la app en developers.facebook.com y define las credenciales en el entorno.`,
      );
    }
    return value;
  }

  private async request<T = unknown>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(15_000),
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }

    const errorBody = (body as { error?: { message?: string; code?: number; error_subcode?: number } })
      ?.error;
    if (!res.ok || errorBody) {
      const parsed = new URL(url);
      this.logger.warn(
        `Meta API ${init?.method ?? 'GET'} ${parsed.host}${parsed.pathname} → ${res.status} ` +
          `code=${errorBody?.code ?? '-'} sub=${errorBody?.error_subcode ?? '-'}`,
      );
      throw new MetaApiError(
        res.status,
        errorBody?.code,
        errorBody?.error_subcode,
        errorBody?.message ?? `Meta API respondió HTTP ${res.status}`,
      );
    }
    return body as T;
  }
}
