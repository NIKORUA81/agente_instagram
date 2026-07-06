import type { Contact, Conversation, ConversationTag, Message, Tag } from '@prisma/client';
import type {
  ContactDto,
  ConversationDto,
  MessageAttachmentDto,
  MessageDto,
  TagDto,
} from '@wolfiax/shared';

export function toContactDto(contact: Contact): ContactDto {
  return {
    id: contact.id,
    ig_scoped_id: contact.igScopedId,
    username: contact.username,
    name: contact.name,
    profile_pic_url: contact.profilePicUrl,
    lifecycle: contact.lifecycle,
    first_seen_at: contact.firstSeenAt.toISOString(),
    last_seen_at: contact.lastSeenAt.toISOString(),
  };
}

export function toMessageDto(message: Message): MessageDto {
  return {
    id: message.id,
    conversation_id: message.conversationId,
    direction: message.direction as MessageDto['direction'],
    source: message.source as MessageDto['source'],
    type: message.type as MessageDto['type'],
    text: message.text,
    attachments: (message.attachments as unknown as MessageAttachmentDto[]) ?? [],
    reply_to_story: (message.replyToStory as MessageDto['reply_to_story']) ?? null,
    status: message.status,
    created_at: message.createdAt.toISOString(),
  };
}

export function toTagDto(tag: Tag): TagDto {
  return { id: tag.id, name: tag.name, color: tag.color };
}

export function toConversationDto(
  conversation: Conversation & {
    contact: Contact;
    messages?: Message[];
    tags?: Array<ConversationTag & { tag: Tag }>;
  },
): ConversationDto {
  const last = conversation.messages?.[0] ?? null;
  const window =
    conversation.windowExpiresAt && conversation.windowExpiresAt.getTime() > Date.now()
      ? conversation.windowExpiresAt.toISOString()
      : null;
  return {
    id: conversation.id,
    channel_id: conversation.channelId,
    status: conversation.status as ConversationDto['status'],
    mode: conversation.mode as ConversationDto['mode'],
    contact: toContactDto(conversation.contact),
    last_message: last ? toMessageDto(last) : null,
    window_expires_at: window,
    last_message_at: conversation.lastMessageAt?.toISOString() ?? null,
    created_at: conversation.createdAt.toISOString(),
    assigned_user_id: conversation.assignedUserId,
    tags: conversation.tags?.map((ct) => toTagDto(ct.tag)) ?? [],
  };
}

/** Cursor keyset opaco: base64("iso|uuid"). */
export function encodeCursor(date: Date, id: string): string {
  return Buffer.from(`${date.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { date: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()) || !id) return null;
    return { date, id };
  } catch {
    return null;
  }
}
