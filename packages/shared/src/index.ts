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
  /** Staff de Wolfiax (Super Admin de plataforma). */
  is_platform_admin: boolean;
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

// ---------------------------------------------------------------------------
// F1 — Canales (conexión Meta)
// ---------------------------------------------------------------------------

export const CONNECTION_TYPES = ['instagram_login', 'facebook_login'] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const CHANNEL_STATUSES = [
  'active',
  'token_expired',
  'revoked',
  'disconnected',
  'error',
] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export interface ChannelDto {
  id: string;
  type: 'instagram';
  connection_type: ConnectionType;
  ig_user_id: string;
  ig_username: string;
  fb_page_id: string | null;
  status: ChannelStatus;
  webhook_subscribed: boolean;
  granted_scopes: string[];
  token_expires_at: string | null;
  last_health_check_at: string | null;
  created_at: string;
}

export interface ConnectStartResponseDto {
  authorization_url: string;
}

export interface ConnectCandidateDto {
  ig_user_id: string;
  ig_username: string;
  name: string | null;
  profile_pic_url: string | null;
  fb_page_id: string | null;
  fb_page_name: string | null;
}

export interface ConnectSessionDto {
  id: string;
  connection_type: ConnectionType;
  candidates: ConnectCandidateDto[];
}

// ---------------------------------------------------------------------------
// F1 — Inbox (lectura)
// ---------------------------------------------------------------------------

export const CONVERSATION_STATUSES = ['open', 'pending', 'resolved', 'archived'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_TYPES = [
  'text',
  'image',
  'video',
  'audio',
  'file',
  'story_reply',
  'story_mention',
  'reaction',
  'share',
  'unsupported',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface ContactDto {
  id: string;
  ig_scoped_id: string;
  username: string | null;
  name: string | null;
  profile_pic_url: string | null;
  lifecycle: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface MessageAttachmentDto {
  type: string;
  url: string | null;
}

export interface MessageDto {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  source: 'user' | 'ai' | 'flow' | 'agent' | 'automation' | 'system';
  type: MessageType;
  text: string | null;
  attachments: MessageAttachmentDto[];
  reply_to_story: { story_id?: string; url?: string } | null;
  status: string;
  created_at: string;
}

export interface ConversationDto {
  id: string;
  channel_id: string;
  status: ConversationStatus;
  mode: 'ai' | 'human' | 'flow';
  contact: ContactDto;
  last_message: MessageDto | null;
  /** null = ventana de 24h cerrada o nunca abierta */
  window_expires_at: string | null;
  last_message_at: string | null;
  created_at: string;
  /** F2 */
  assigned_user_id: string | null;
  tags: TagDto[];
}

export interface PaginatedDto<T> {
  items: T[];
  /** Pasar como ?cursor= para la siguiente página; null = no hay más */
  next_cursor: string | null;
}

/** Eventos WebSocket (namespace /realtime, sala org:{id}) */
export const WS_EVENTS = {
  MESSAGE_NEW: 'message.new',
  MESSAGE_STATUS: 'message.status',
  CONVERSATION_UPDATED: 'conversation.updated',
  CHANNEL_STATUS: 'channel.status',
} as const;

export interface WsMessageNewPayload {
  conversation_id: string;
  message: MessageDto;
}

// ---------------------------------------------------------------------------
// F2 - Etiquetas, notas, envio y automatizaciones
// ---------------------------------------------------------------------------

export interface TagDto {
  id: string;
  name: string;
  color: string;
}

export interface NoteDto {
  id: string;
  conversation_id: string;
  body: string;
  user_id: string;
  user_name: string;
  created_at: string;
}

export interface SendMessageRequest {
  text?: string;
  /** Envio de media por URL publica (image|video|audio) */
  attachment_type?: 'image' | 'video' | 'audio';
  attachment_url?: string;
}

export const AUTOMATION_TRIGGER_TYPES = [
  'any_message',
  'keyword',
  'story_reply',
  'reaction',
  'new_contact',
] as const;
export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];

export type AutomationTrigger =
  | { type: 'any_message' }
  | { type: 'keyword'; keywords: string[]; match?: 'contains' | 'exact' }
  | { type: 'story_reply' }
  | { type: 'reaction' }
  | { type: 'new_contact' };

export const AUTOMATION_ACTION_TYPES = ['reply', 'add_tag', 'assign', 'set_status'] as const;
export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

export type AutomationAction =
  | { type: 'reply'; text: string }
  | { type: 'add_tag'; tag_id: string }
  | { type: 'assign'; user_id: string }
  | { type: 'set_status'; status: ConversationStatus };

export interface AutomationDto {
  id: string;
  name: string;
  channel_id: string | null;
  enabled: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  priority: number;
  cooldown_seconds: number;
  fire_count: number;
  last_fired_at: string | null;
  created_at: string;
}

export interface WsMessageStatusPayload {
  conversation_id: string;
  message_id: string;
  status: string;
  error?: string | null;
}

// ---------------------------------------------------------------------------
// Super Admin de plataforma (staff Wolfiax)
// ---------------------------------------------------------------------------

export interface PlatformStatsDto {
  organizations_total: number;
  organizations_active: number;
  organizations_suspended: number;
  users_total: number;
  platform_admins_total: number;
  channels_total: number;
  channels_active: number;
  conversations_total: number;
  messages_total: number;
}

export interface PlatformOrgDto {
  id: string;
  name: string;
  slug: string;
  plan: string;
  suspended: boolean;
  created_at: string;
  members_count: number;
  channels_count: number;
  conversations_count: number;
}

export interface PlatformOrgDetailDto extends PlatformOrgDto {
  members: Array<{
    user_id: string;
    email: string;
    full_name: string;
    role: Role;
    joined_at: string;
  }>;
  channels: Array<{
    id: string;
    ig_username: string;
    status: string;
    connection_type: string;
  }>;
}

export interface PlatformUserDto {
  id: string;
  email: string;
  full_name: string;
  is_platform_admin: boolean;
  created_at: string;
  last_login_at: string | null;
  organizations_count: number;
}

/** Respuesta de impersonación: token de acceso con scope al tenant objetivo. */
export interface ImpersonateResponseDto {
  access_token: string;
  organization: OrganizationDto;
}
