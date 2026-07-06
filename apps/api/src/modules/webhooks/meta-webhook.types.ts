/** Payload de webhooks de mensajería de Instagram (campos que consumimos). */

export interface MetaWebhookBody {
  object: string;
  entry?: MetaWebhookEntry[];
}

export interface MetaWebhookEntry {
  /** IGSID de la cuenta profesional (nuestro canal) */
  id: string;
  time: number;
  messaging?: MetaMessagingEvent[];
}

export interface MetaMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    is_unsupported?: boolean;
    attachments?: Array<{
      type: string;
      payload?: { url?: string; title?: string; sticker_id?: number };
    }>;
    reply_to?: {
      mid?: string;
      story?: { id?: string; url?: string };
    };
  };
  reaction?: {
    mid: string;
    action: 'react' | 'unreact';
    reaction?: string;
    emoji?: string;
  };
  postback?: {
    mid?: string;
    title?: string;
    payload?: string;
  };
  read?: { mid: string };
}

/** Identificador estable de un evento para dedupe. */
export function eventExternalId(event: MetaMessagingEvent): string {
  if (event.message?.mid) return event.message.mid;
  if (event.reaction?.mid) return `${event.reaction.mid}:${event.reaction.action}`;
  if (event.postback?.mid) return event.postback.mid;
  if (event.read?.mid) return `${event.read.mid}:read`;
  return `${event.sender.id}:${event.recipient.id}:${event.timestamp}`;
}

export function eventType(event: MetaMessagingEvent): string {
  if (event.message?.is_echo) return 'message_echo';
  if (event.message) return 'message';
  if (event.reaction) return 'reaction';
  if (event.postback) return 'postback';
  if (event.read) return 'read';
  return 'unknown';
}
