import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@wolfiax/shared';
import type { AuthUser } from './auth.types';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marca un endpoint como accesible sin access token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Restringe un endpoint a los roles indicados (evaluado por RolesGuard). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Inyecta el AuthUser de la request en un parámetro del handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return req.user;
  },
);
