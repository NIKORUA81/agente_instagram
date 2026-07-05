import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@wolfiax/shared';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';
import { IS_PUBLIC_KEY } from './decorators';
import { TokensService } from '../../modules/iam/tokens.service';
import type { AuthUser } from './auth.types';

/** Guard global: exige access token válido salvo endpoints @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED,
        'Se requiere un access token.',
      );
    }

    const payload = await this.tokens.verifyAccessToken(header.slice('Bearer '.length));
    req.user = {
      userId: payload.sub,
      organizationId: payload.org,
      role: payload.role,
      email: payload.email,
    };
    return true;
  }
}
