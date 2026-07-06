'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  WS_EVENTS,
  type ConversationDto,
  type ConversationStatus,
  type MessageDto,
  type PaginatedDto,
  type WsMessageNewPayload,
} from '@wolfiax/shared';
import { Archive, CheckCircle2, Clock, Inbox as InboxIcon, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';

const STATUS_FILTERS: Array<{ value: ConversationStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'open', label: 'Abiertas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'resolved', label: 'Resueltas' },
  { value: 'archived', label: 'Archivadas' },
];

export default function InboxPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const conversations = useQuery({
    queryKey: ['conversations', statusFilter],
    queryFn: () =>
      api.get<PaginatedDto<ConversationDto>>(
        statusFilter === 'all' ? '/conversations' : `/conversations?status=${statusFilter}`,
      ),
  });

  // Tiempo real: nuevos mensajes/actualizaciones refrescan las listas
  useEffect(() => {
    const socket = getSocket();
    const onMessage = (payload: WsMessageNewPayload) => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['messages', payload.conversation_id] });
    };
    const onConversation = () => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    };
    socket.on(WS_EVENTS.MESSAGE_NEW, onMessage);
    socket.on(WS_EVENTS.CONVERSATION_UPDATED, onConversation);
    return () => {
      socket.off(WS_EVENTS.MESSAGE_NEW, onMessage);
      socket.off(WS_EVENTS.CONVERSATION_UPDATED, onConversation);
    };
  }, [qc]);

  const items = conversations.data?.items ?? [];
  const selected = items.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-0 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      {/* Lista */}
      <div className="flex w-96 shrink-0 flex-col border-r border-neutral-200">
        <div className="border-b border-neutral-100 p-3">
          <h1 className="px-1 text-base font-semibold">Inbox</h1>
          <div className="mt-2 flex flex-wrap gap-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                  statusFilter === f.value
                    ? 'bg-brand-600 text-white'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.isLoading && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
          {!conversations.isLoading && items.length === 0 && (
            <div className="px-6 py-12 text-center text-sm text-neutral-400">
              <InboxIcon className="mx-auto mb-2 size-8" />
              Sin conversaciones todavía. Cuando alguien escriba un DM a tu cuenta conectada,
              aparecerá aquí en tiempo real.
            </div>
          )}
          {items.map((c) => (
            <ConversationRow
              key={c.id}
              conversation={c}
              active={c.id === selectedId}
              onClick={() => setSelectedId(c.id)}
            />
          ))}
        </div>
      </div>

      {/* Hilo */}
      {selected ? (
        <ConversationThread conversation={selected} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">
          Selecciona una conversación
        </div>
      )}
    </div>
  );
}

function ConversationRow({
  conversation,
  active,
  onClick,
}: {
  conversation: ConversationDto;
  active: boolean;
  onClick: () => void;
}) {
  const name =
    conversation.contact.username != null
      ? `@${conversation.contact.username}`
      : (conversation.contact.name ?? conversation.contact.ig_scoped_id);
  const preview = messagePreview(conversation.last_message);
  return (
    <button
      onClick={onClick}
      className={cn(
        'block w-full border-b border-neutral-50 px-4 py-3 text-left transition-colors',
        active ? 'bg-brand-50' : 'hover:bg-neutral-50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium">{name}</p>
        {conversation.last_message_at && (
          <span className="shrink-0 text-[11px] text-neutral-400">
            {timeAgo(conversation.last_message_at)}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <p className="truncate text-xs text-neutral-500">{preview}</p>
        <WindowChip windowExpiresAt={conversation.window_expires_at} compact />
      </div>
    </button>
  );
}

function ConversationThread({ conversation }: { conversation: ConversationDto }) {
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = useQuery({
    queryKey: ['messages', conversation.id],
    queryFn: () =>
      api.get<PaginatedDto<MessageDto>>(`/conversations/${conversation.id}/messages`),
  });

  // La API entrega descendente; el hilo se pinta ascendente
  const ordered = useMemo(
    () => [...(messages.data?.items ?? [])].reverse(),
    [messages.data],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
  }, [ordered.length]);

  async function setStatus(status: ConversationStatus) {
    await api.patch(`/conversations/${conversation.id}`, { status });
    void qc.invalidateQueries({ queryKey: ['conversations'] });
  }

  const name =
    conversation.contact.username != null
      ? `@${conversation.contact.username}`
      : (conversation.contact.name ?? conversation.contact.ig_scoped_id);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-neutral-100 px-5 py-3">
        {conversation.contact.profile_pic_url ? (
          <img
            src={conversation.contact.profile_pic_url}
            alt=""
            className="size-9 rounded-full object-cover"
          />
        ) : (
          <div className="flex size-9 items-center justify-center rounded-full bg-neutral-100 text-sm font-semibold text-neutral-500">
            {name.replace('@', '').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{name}</p>
          <WindowChip windowExpiresAt={conversation.window_expires_at} />
        </div>
        {conversation.status === 'resolved' || conversation.status === 'archived' ? (
          <Button variant="secondary" size="sm" onClick={() => void setStatus('open')}>
            <RotateCcw className="size-3.5" /> Reabrir
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={() => void setStatus('resolved')}>
              <CheckCircle2 className="size-3.5" /> Resolver
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void setStatus('archived')}>
              <Archive className="size-3.5" /> Archivar
            </Button>
          </>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto bg-neutral-50/60 px-5 py-4">
        {messages.isLoading && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}
        {ordered.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-neutral-100 px-5 py-3 text-center text-xs text-neutral-400">
        El envío de respuestas se habilita en la fase F2.
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: MessageDto }) {
  const inbound = message.direction === 'inbound';
  return (
    <div className={cn('flex', inbound ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[70%] rounded-2xl px-3.5 py-2 text-sm',
          inbound ? 'bg-white shadow-sm' : 'bg-brand-600 text-white',
        )}
      >
        {message.type === 'story_reply' && (
          <p className={cn('mb-1 text-[11px]', inbound ? 'text-neutral-400' : 'text-white/70')}>
            ↩ Respondió a tu historia
          </p>
        )}
        {message.type === 'reaction' ? (
          <p className="text-xl">{message.text ?? '❤'}</p>
        ) : (
          <>
            {message.text && <p className="whitespace-pre-wrap break-words">{message.text}</p>}
            {message.attachments.map((a, i) =>
              a.url ? (
                a.type === 'image' ? (
                  <img key={i} src={a.url} alt="" className="mt-1 max-h-64 rounded-lg" />
                ) : (
                  <a
                    key={i}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      'mt-1 block text-xs underline',
                      inbound ? 'text-brand-600' : 'text-white',
                    )}
                  >
                    Adjunto ({a.type})
                  </a>
                )
              ) : (
                <p key={i} className="mt-1 text-xs italic opacity-70">
                  Adjunto {a.type} no disponible
                </p>
              ),
            )}
          </>
        )}
        <p
          className={cn(
            'mt-1 text-right text-[10px]',
            inbound ? 'text-neutral-400' : 'text-white/70',
          )}
        >
          {new Date(message.created_at).toLocaleTimeString('es', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  );
}

function WindowChip({
  windowExpiresAt,
  compact = false,
}: {
  windowExpiresAt: string | null;
  compact?: boolean;
}) {
  if (!windowExpiresAt) {
    return compact ? null : (
      <span className="text-[11px] text-neutral-400">Ventana de 24h cerrada</span>
    );
  }
  const msLeft = new Date(windowExpiresAt).getTime() - Date.now();
  if (msLeft <= 0) return null;
  const hours = Math.floor(msLeft / 3_600_000);
  const minutes = Math.floor((msLeft % 3_600_000) / 60_000);
  const label = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700',
      )}
      title="Tiempo restante de la ventana de mensajería de 24 horas"
    >
      <Clock className="size-3" />
      {compact ? label : `Ventana abierta · ${label}`}
    </span>
  );
}

function messagePreview(message: MessageDto | null): string {
  if (!message) return 'Sin mensajes';
  const prefix = message.direction === 'outbound' ? 'Tú: ' : '';
  switch (message.type) {
    case 'reaction':
      return `${prefix}Reaccionó ${message.text ?? ''}`;
    case 'story_reply':
      return `${prefix}${message.text ?? 'Respondió a tu historia'}`;
    case 'image':
      return `${prefix}📷 Imagen`;
    case 'video':
      return `${prefix}🎬 Video`;
    case 'audio':
      return `${prefix}🎙 Audio`;
    default:
      return `${prefix}${message.text ?? 'Mensaje'}`;
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
