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
  }): Promise<string> {
    const payload: Omit<AccessTokenPayload, 'iat' | 'exp'> = {
      sub: input.userId,
      org: input.organizationId,
      role: input.role,
      email: input.email,
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
}
