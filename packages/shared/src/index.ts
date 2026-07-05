/**
 * Contratos compartidos entre la API (NestJS) y el frontend (Next.js).
 * Los payloads de la API pública usan snake_case (ver docs/05-API.md).
 */

// ---------------------------------------------------------------------------
// Roles y permisos
// ---------------------------------------------------------------------------

export const ROLES = ['owner', 'admin', 'agent', 'analyst'] as const;
export type Role = (typeof ROLES)[number];

/** Jerarquía para comparaciones "puede gestionar a" (mayor gestiona a menor). */
export const ROLE_RANK: Record<Role, number> = {
  owner: 4,
  admin: 3,
  agent: 2,
  analyst: 1,
};

/** Roles que se pueden asignar por invitación (owner solo por transferencia). */
export const INVITABLE_ROLES = ['admin', 'agent', 'analyst'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

// ---------------------------------------------------------------------------
// Códigos de error de la API (contrato estable para el frontend)
// ---------------------------------------------------------------------------

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  SESSION_REVOKED: 'SESSION_REVOKED',
  FORBIDDEN: 'FORBIDDEN',
  ORG_MISMATCH: 'ORG_MISMATCH',
  NOT_FOUND: 'NOT_FOUND',
  EMAIL_IN_USE: 'EMAIL_IN_USE',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  ACCOUNT_EXISTS: 'ACCOUNT_EXISTS',
  INVITATION_INVALID: 'INVITATION_INVALID',
  LAST_OWNER: 'LAST_OWNER',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorBody {
  error: {
    code: ErrorCode | string;
    message: string;
    details?: Array<{ field?: string; issue: string }>;
    request_id?: string;
  };
}

// ---------------------------------------------------------------------------
// DTOs de respuesta (snake_case, tal como viajan por HTTP)
// ---------------------------------------------------------------------------

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  plan: string;
  created_at: string;
}

export interface UserDto {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
}

export interface MembershipDto {
  organization: OrganizationDto;
  role: Role;
}

export interface MeDto {
  user: UserDto;
  /** Organización activa según el access token actual. */
  current_organization: OrganizationDto;
  current_role: Role;
  organizations: MembershipDto[];
}

export interface AuthResponseDto {
  access_token: string;
  user: UserDto;
  organization: OrganizationDto;
  role: Role;
}

export interface MemberDto {
  user_id: string;
  email: string;
  full_name: string;
  role: Role;
  joined_at: string;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: Role;
  expires_at: string;
  created_at: string;
  invited_by: string | null;
  /** Solo presente en la respuesta de creación (el token no se persiste en claro). */
  accept_url?: string;
}

export interface InvitationPublicDto {
  organization_name: string;
  email: string;
  role: Role;
  account_exists: boolean;
}
