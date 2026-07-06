import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Channel } from '@prisma/client';
import { ERROR_CODES, type ChannelDto, type ConnectSessionDto } from '@wolfiax/shared';
import type { AuthUser } from '../../common/auth/auth.types';
import { TokenCipherService } from '../../common/crypto/token-cipher.service';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import type { RequestContext } from '../iam/auth.service';
import { MetaGraphService } from './meta-graph.service';
import {
  MetaOAuthService,
  type StoredCandidate,
  type StoredConnectSession,
} from './meta-oauth.service';
import { MetaApiError } from './meta.types';

export function toChannelDto(channel: Channel): ChannelDto {
  return {
    id: channel.id,
    type: 'instagram',
    connection_type: channel.connectionType as ChannelDto['connection_type'],
    ig_user_id: channel.igUserId,
    ig_username: channel.igUsername,
    fb_page_id: channel.fbPageId,
    status: channel.status as ChannelDto['status'],
    webhook_subscribed: channel.webhookSubscribed,
    granted_scopes: channel.grantedScopes,
    token_expires_at: channel.tokenExpiresAt?.toISOString() ?? null,
    last_health_check_at: channel.lastHealthCheckAt?.toISOString() ?? null,
    created_at: channel.createdAt.toISOString(),
  };
}

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: TokenCipherService,
    private readonly graph: MetaGraphService,
    private readonly oauth: MetaOAuthService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lectura
  // ---------------------------------------------------------------------------

  async list(actor: AuthUser): Promise<ChannelDto[]> {
    const channels = await this.prisma.withTenant(actor.organizationId, (tx) =>
      tx.channel.findMany({
        where: { organizationId: actor.organizationId },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return channels.map(toChannelDto);
  }

  async getOrFail(actor: AuthUser, channelId: string): Promise<Channel> {
    const channel = await this.prisma.withTenant(actor.organizationId, (tx) =>
      tx.channel.findFirst({ where: { id: channelId, organizationId: actor.organizationId } }),
    );
    if (!channel) {
      throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Canal no encontrado.');
    }
    return channel;
  }

  async getSessionDto(actor: AuthUser, sessionId: string): Promise<ConnectSessionDto> {
    const session = await this.requireSession(actor, sessionId);
    return {
      id: sessionId,
      connection_type: session.connectionType,
      candidates: session.candidates.map((c) => ({
        ig_user_id: c.igUserId,
        ig_username: c.igUsername,
        name: c.name,
        profile_pic_url: c.profilePicUrl,
        fb_page_id: c.fbPageId,
        fb_page_name: c.fbPageName,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Creación (desde el callback o desde la selección)
  // ---------------------------------------------------------------------------

  /** Crea el canal a partir de una sesión con un único candidato. */
  createFromSingleSession(session: StoredConnectSession, ctx: RequestContext): Promise<ChannelDto> {
    return this.createChannel(session, session.candidates[0], ctx);
  }

  async selectAccount(
    actor: AuthUser,
    sessionId: string,
    igUserId: string,
    ctx: RequestContext,
  ): Promise<ChannelDto> {
    const session = await this.requireSession(actor, sessionId);
    const candidate = session.candidates.find((c) => c.igUserId === igUserId);
    if (!candidate) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
        'Esa cuenta no está entre las opciones de la conexión.',
      );
    }
    const dto = await this.createChannel(session, candidate, ctx);
    await this.oauth.deleteSession(sessionId);
    return dto;
  }

  private async createChannel(
    session: StoredConnectSession,
    candidate: StoredCandidate,
    ctx: RequestContext,
  ): Promise<ChannelDto> {
    // Unicidad global: una cuenta IG solo puede estar conectada a un tenant
    const existing = await this.prisma.withSystem((tx) =>
      tx.channel.findUnique({ where: { igUserId: candidate.igUserId } }),
    );
    if (existing && existing.organizationId !== session.organizationId) {
      throw new AppError(
        HttpStatus.CONFLICT,
        ERROR_CODES.ALREADY_MEMBER,
        `@${candidate.igUsername} ya está conectada en otra organización.`,
      );
    }

    const tokenEnc = new Uint8Array(Buffer.from(candidate.tokenEncB64, 'base64'));
    const data = {
      connectionType: session.connectionType,
      igUsername: candidate.igUsername,
      fbPageId: candidate.fbPageId,
      accessTokenEnc: tokenEnc,
      tokenExpiresAt: candidate.tokenExpiresAt ? new Date(candidate.tokenExpiresAt) : null,
      grantedScopes: candidate.grantedScopes,
      status: 'active',
    };

    const channel = await this.prisma.withTenant(session.organizationId, async (tx) => {
      const saved = existing
        ? await tx.channel.update({ where: { id: existing.id }, data })
        : await tx.channel.create({
            data: {
              ...data,
              organizationId: session.organizationId,
              igUserId: candidate.igUserId,
            },
          });
      await this.audit.log(tx, {
        organizationId: session.organizationId,
        userId: session.userId,
        action: existing ? 'channel.reconnected' : 'channel.connected',
        resource: 'channel',
        resourceId: saved.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { ig_username: candidate.igUsername, connection_type: session.connectionType },
      });
      return saved;
    });

    // Suscripción a webhooks (fuera de la transacción: llamada externa)
    const subscribed = await this.subscribeWebhooks(channel);
    const final = await this.prisma.withTenant(session.organizationId, (tx) =>
      tx.channel.update({ where: { id: channel.id }, data: { webhookSubscribed: subscribed } }),
    );
    return toChannelDto(final);
  }

  private async subscribeWebhooks(channel: Channel): Promise<boolean> {
    try {
      const token = this.cipher.decrypt(channel.accessTokenEnc);
      if (channel.connectionType === 'instagram_login') {
        await this.graph.igSubscribeToWebhooks(channel.igUserId, token);
      } else if (channel.fbPageId) {
        await this.graph.fbSubscribePageToWebhooks(channel.fbPageId, token);
      }
      return true;
    } catch (err) {
      this.logger.error(
        `Fallo al suscribir webhooks del canal ${channel.id}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Salud, renovación y desconexión
  // ---------------------------------------------------------------------------

  async healthCheck(actor: AuthUser, channelId: string): Promise<ChannelDto> {
    const channel = await this.getOrFail(actor, channelId);
    const result = await this.probeChannel(channel);
    const updated = await this.prisma.withTenant(actor.organizationId, (tx) =>
      tx.channel.update({
        where: { id: channel.id },
        data: { status: result.status, lastHealthCheckAt: new Date() },
      }),
    );
    return toChannelDto(updated);
  }

  /** Sondeo barato del token; usado por el health-check manual y el cron. */
  async probeChannel(channel: Channel): Promise<{ status: string }> {
    try {
      const token = this.cipher.decrypt(channel.accessTokenEnc);
      if (channel.connectionType === 'instagram_login') {
        await this.graph.igMe(token);
      } else {
        await this.graph.fbProbeIgAccount(channel.igUserId, token);
      }
      return { status: 'active' };
    } catch (err) {
      if (err instanceof MetaApiError && err.isTokenInvalid) {
        return { status: 'token_expired' };
      }
      return { status: 'error' };
    }
  }

  async disconnect(actor: AuthUser, channelId: string, ctx: RequestContext): Promise<void> {
    const channel = await this.getOrFail(actor, channelId);
    await this.prisma.withTenant(actor.organizationId, async (tx) => {
      await tx.channel.update({
        where: { id: channel.id },
        data: { status: 'disconnected', webhookSubscribed: false },
      });
      await this.audit.log(tx, {
        organizationId: actor.organizationId,
        userId: actor.userId,
        action: 'channel.disconnected',
        resource: 'channel',
        resourceId: channel.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: { ig_username: channel.igUsername },
      });
    });
  }

  // ---------------------------------------------------------------------------

  private async requireSession(actor: AuthUser, sessionId: string): Promise<StoredConnectSession> {
    const session = await this.oauth.getSession(sessionId);
    if (!session || session.organizationId !== actor.organizationId) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
        'La sesión de conexión no existe o expiró. Reinicia la conexión.',
      );
    }
    return session;
  }
}
