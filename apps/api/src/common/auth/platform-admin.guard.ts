import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@wolfiax/shared';
import { AppError } from '../errors/app-error';
import { PLATFORM_ADMIN_KEY } from './decorators';
import type { AuthUser } from './auth.types';

/**
 * Solo permite el acceso a endpoints @PlatformAdmin() si el token pertenece a
 * un Super Admin de plataforma (staff Wolfiax). Corre después de JwtAuthGuard.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!user?.isPlatformAdmin) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.FORBIDDEN,
        'Requiere permisos de Super Admin de plataforma.',
      );
    }
    return true;
  }
}
