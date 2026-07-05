import type { Role } from '@wolfiax/shared';

/** Claims del access token (RS256, 15 min). */
export interface AccessTokenPayload {
  /** userId */
  sub: string;
  /** organización activa */
  org: string;
  role: Role;
  email: string;
  iat?: number;
  exp?: number;
}

/** Usuario autenticado adjuntado a la request por JwtAuthGuard. */
export interface AuthUser {
  userId: string;
  organizationId: string;
  role: Role;
  email: string;
}

export const REFRESH_COOKIE = 'wsai_rt';
/** El cookie solo viaja a los endpoints de auth (rotación/logout/switch). */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
