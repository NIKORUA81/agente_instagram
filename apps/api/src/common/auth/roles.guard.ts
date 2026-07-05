import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES, type Role } from '@wolfiax/shared';
import { AppError } from '../errors/app-error';
import { ROLES_KEY } from './decorators';
import type { AuthUser } from './auth.types';

/** Evalúa @Roles(...) después de JwtAuthGuard. Sin metadata → cualquier rol. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    // Endpoint @Public: sin user, no aplica restricción de rol
    if (!user) return true;

    if (!required.includes(user.role)) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.FORBIDDEN,
        'Tu rol no tiene permisos para esta acción.',
      );
    }
    return true;
  }
}
