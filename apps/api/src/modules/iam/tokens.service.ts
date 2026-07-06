import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ERROR_CODES, type Role } from '@wolfiax/shared';
import { AppError } from '../../common/errors/app-error';
import type { AccessTokenPayload } from '../../common/auth/auth.types';
import type { Env } from '../../config/configuration';

/** Emisión y verificación de access tokens (RS256). */
@Injectable()
export class TokensService {
  private readonly accessTtlSeconds: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtlSeconds = config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
  }

  signAccessToken(input: {
    userId: string;
    organizationId: string;
    role: Role;
    email: string;
    isPlatformAdmin?: boolean;
    impersonating?: boolean;
  }): Promise<string> {
    const payload: Omit<AccessTokenPayload, 'iat' | 'exp'> = {
      sub: input.userId,
      org: input.organizationId,
      role: input.role,
      email: input.email,
      ...(input.isPlatformAdmin ? { pa: true } : {}),
      ...(input.impersonating ? { imp: true } : {}),
    };
    return this.jwt.signAsync(payload, { expiresIn: this.accessTtlSeconds });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED,
        'Access token inválido o expirado.',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // State de OAuth con Meta (anti-CSRF del flujo de conexión, un solo uso lógico)
  // ---------------------------------------------------------------------------

  signOAuthState(input: {
    organizationId: string;
    userId: string;
    connectionType: 'instagram_login' | 'facebook_login';
  }): Promise<string> {
    return this.jwt.signAsync(
      {
        purpose: 'meta_oauth',
        org: input.organizationId,
        sub: input.userId,
        ct: input.connectionType,
      },
      { expiresIn: 600 },
    );
  }

  async verifyOAuthState(state: string): Promise<{
    organizationId: string;
    userId: string;
    connectionType: 'instagram_login' | 'facebook_login';
  }> {
    try {
      const payload = await this.jwt.verifyAsync<{
        purpose?: string;
        org: string;
        sub: string;
        ct: 'instagram_login' | 'facebook_login';
      }>(state);
      if (payload.purpose !== 'meta_oauth') throw new Error('purpose inválido');
      return {
        organizationId: payload.org,
        userId: payload.sub,
        connectionType: payload.ct,
      };
    } catch {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED,
        'El state de OAuth es inválido o expiró. Reinicia la conexión.',
      );
    }
  }
}
