import type { Invitation, Membership, Organization, User } from '@prisma/client';
import type {
  InvitationDto,
  MemberDto,
  OrganizationDto,
  Role,
  UserDto,
} from '@wolfiax/shared';

export function toOrganizationDto(org: Organization): OrganizationDto {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    plan: org.plan,
    created_at: org.createdAt.toISOString(),
  };
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    full_name: user.fullName,
    created_at: user.createdAt.toISOString(),
  };
}

export function toMemberDto(membership: Membership & { user: User }): MemberDto {
  return {
    user_id: membership.userId,
    email: membership.user.email,
    full_name: membership.user.fullName,
    role: membership.role as Role,
    joined_at: membership.createdAt.toISOString(),
  };
}

export function toInvitationDto(
  invitation: Invitation & { invitedBy?: User | null },
  acceptUrl?: string,
): InvitationDto {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role as Role,
    expires_at: invitation.expiresAt.toISOString(),
    created_at: invitation.createdAt.toISOString(),
    invited_by: invitation.invitedBy?.fullName ?? null,
    ...(acceptUrl ? { accept_url: acceptUrl } : {}),
  };
}
