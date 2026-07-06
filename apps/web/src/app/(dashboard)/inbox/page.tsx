'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  WS_EVENTS,
  type ConversationDto,
  type ConversationStatus,
  type MessageDto,
  type NoteDto,
  type PaginatedDto,
  type TagDto,
  type WsMessageNewPayload,
  type WsMessageStatusPayload,
} from '@wolfiax/shared';
import {
  Archive,
  Bot,
  CheckCircle2,
  Clock,
  Inbox as InboxIcon,
  RotateCcw,
  Search,
  Send,
  StickyNote,
  Tag as TagIcon,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiError } from '@/lib/api';
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
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const listKey = ['conversations', statusFilter, debouncedSearch];
  const conversations = useQuery({
    queryKey: listKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (debouncedSearch) params.set('q', debouncedSearch);
      const qs = params.toString();
      return api.get<PaginatedDto<ConversationDto>>(`/conversations${qs ? `?${qs}` : ''}`);
    },
  });

  // Tiempo real
  useEffect(() => {
    const socket = getSocket();
    const invalidate = (conversationId?: string) => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      if (conversationId) {
        void qc.invalidateQueries({ queryKey: ['messages', conversationId] });
      }
    };
    const onMessage = (p: WsMessageNewPayload) => invalidate(p.conversation_id);
    const onStatus = (p: WsMessageStatusPayload) => invalidate(p.conversation_id);
    const onConversation = () => invalidate();
    socket.on(WS_EVENTS.MESSAGE_NEW, onMessage);
    socket.on(WS_EVENTS.MESSAGE_STATUS, onStatus);
    socket.on(WS_EVENTS.CONVERSATION_UPDATED, onConversation);
    return () => {
      socket.off(WS_EVENTS.MESSAGE_NEW, onMessage);
      socket.off(WS_EVENTS.MESSAGE_STATUS, onStatus);
      socket.off(WS_EVENTS.CONVERSATION_UPDATED, onConversation);
    };
  }, [qc]);

  const items = conversations.data?.items ?? [];
  const selected = items.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-0 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex w-96 shrink-0 flex-col border-r border-neutral-200">
        <div className="border-b border-neutral-100 p-3">
          <h1 className="px-1 text-base font-semibold">Inbox</h1>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o texto…"
              className="h-9 pl-8 text-sm"
            />
          </div>
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
              {debouncedSearch
                ? 'Sin resultados para tu búsqueda.'
                : 'Sin conversaciones todavía. Cuando alguien escriba un DM a tu cuenta conectada, aparecerá aquí en tiempo real.'}
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

      {selected ? (
        <ConversationThread key={selected.id} conversation={selected} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">
          Selecciona una conversación
        </div>
      )}
    </div>
  );
}

function contactName(c: ConversationDto): string {
  return c.contact.username != null
    ? `@${c.contact.username}`
    : (c.contact.name ?? c.contact.ig_scoped_id);
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
        <p className="truncate text-sm font-medium">{contactName(conversation)}</p>
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
      {conversation.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {conversation.tags.map((t) => (
            <TagPill key={t.id} tag={t} />
          ))}
        </div>
      )}
    </button>
  );
}

function ConversationThread({ conversation }: { conversation: ConversationDto }) {
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showNotes, setShowNotes] = useState(false);

  const messages = useQuery({
    queryKey: ['messages', conversation.id],
    queryFn: () =>
      api.get<PaginatedDto<MessageDto>>(`/conversations/${conversation.id}/messages`),
  });

  const ordered = useMemo(() => [...(messages.data?.items ?? [])].reverse(), [messages.data]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
  }, [ordered.length]);

  async function setStatus(status: ConversationStatus) {
    await api.patch(`/conversations/${conversation.id}`, { status });
    void qc.invalidateQueries({ queryKey: ['conversations'] });
  }

  async function setMode(action: 'handover' | 'return-to-ai') {
    await api.post(`/conversations/${conversation.id}/${action}`);
    void qc.invalidateQueries({ queryKey: ['conversations'] });
  }

  const windowOpen =
    conversation.window_expires_at != null &&
    new Date(conversation.window_expires_at).getTime() > Date.now();

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
            {contactName(conversation).replace('@', '').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{contactName(conversation)}</p>
          <WindowChip windowExpiresAt={conversation.window_expires_at} />
        </div>
        {conversation.mode === 'ai' ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void setMode('handover')}
            title="Pausar la IA y atender tú"
          >
            <Bot className="size-3.5 text-brand-600" /> IA activa
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void setMode('return-to-ai')}
            title="Devolver a la IA"
          >
            <UserRound className="size-3.5" /> Humano
          </Button>
        )}
        <Button
          variant={showNotes ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setShowNotes((v) => !v)}
          title="Notas internas"
        >
          <StickyNote className="size-3.5" />
        </Button>
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

      <TagBar conversation={conversation} />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
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
          <Composer conversationId={conversation.id} windowOpen={windowOpen} />
        </div>
        {showNotes && <NotesPanel conversationId={conversation.id} />}
      </div>
    </div>
  );
}

function Composer({ conversationId, windowOpen }: { conversationId: string; windowOpen: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: (body: string) =>
      api.post(`/conversations/${conversationId}/messages`, { text: body }),
    onSuccess: () => {
      setText('');
      setError(null);
      void qc.invalidateQueries({ queryKey: ['messages', conversationId] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo enviar.'),
  });

  if (!windowOpen) {
    return (
      <div className="border-t border-neutral-100 bg-amber-50 px-5 py-3 text-center text-xs text-amber-700">
        La ventana de 24 horas está cerrada. Meta no permite escribir hasta que el cliente vuelva a
        enviarte un mensaje.
      </div>
    );
  }

  function submit() {
    const body = text.trim();
    if (!body || send.isPending) return;
    send.mutate(body);
  }

  return (
    <div className="border-t border-neutral-100 px-4 py-3">
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Escribe una respuesta…  (Enter para enviar, Shift+Enter salto de línea)"
          className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline focus:outline-2 focus:outline-brand-100"
        />
        <Button onClick={submit} loading={send.isPending} disabled={!text.trim()}>
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function TagBar({ conversation }: { conversation: ConversationDto }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const allTags = useQuery({
    queryKey: ['tags'],
    queryFn: () => api.get<TagDto[]>('/tags'),
    enabled: adding,
  });

  const addTag = useMutation({
    mutationFn: (tagId: string) =>
      api.post(`/conversations/${conversation.id}/tags`, { tag_id: tagId }),
    onSuccess: () => {
      setAdding(false);
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const removeTag = useMutation({
    mutationFn: (tagId: string) => api.delete(`/conversations/${conversation.id}/tags/${tagId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['conversations'] }),
  });

  const available = (allTags.data ?? []).filter(
    (t) => !conversation.tags.some((ct) => ct.id === t.id),
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-100 px-5 py-2">
      <TagIcon className="size-3.5 text-neutral-400" />
      {conversation.tags.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ backgroundColor: `${t.color}20`, color: t.color }}
        >
          {t.name}
          <button
            onClick={() => removeTag.mutate(t.id)}
            className="hover:opacity-70"
            aria-label={`Quitar ${t.name}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {adding ? (
        <select
          autoFocus
          className="h-6 rounded border border-neutral-200 text-xs"
          onChange={(e) => e.target.value && addTag.mutate(e.target.value)}
          onBlur={() => setAdding(false)}
          defaultValue=""
        >
          <option value="" disabled>
            {available.length ? 'Elegir etiqueta…' : 'No hay más etiquetas'}
          </option>
          {available.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="rounded-full border border-dashed border-neutral-300 px-2 py-0.5 text-xs text-neutral-500 hover:border-brand-400 hover:text-brand-600"
        >
          + etiqueta
        </button>
      )}
    </div>
  );
}

function NotesPanel({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const notesKey = ['notes', conversationId];

  const notes = useQuery({
    queryKey: notesKey,
    queryFn: () => api.get<NoteDto[]>(`/conversations/${conversationId}/notes`),
  });

  const addNote = useMutation({
    mutationFn: (text: string) =>
      api.post(`/conversations/${conversationId}/notes`, { body: text }),
    onSuccess: () => {
      setBody('');
      void qc.invalidateQueries({ queryKey: notesKey });
    },
  });

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-neutral-100 bg-amber-50/40">
      <div className="border-b border-amber-100 px-4 py-2 text-xs font-semibold text-amber-800">
        Notas internas · solo tu equipo
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {notes.data?.length === 0 && (
          <p className="text-xs text-neutral-400">Sin notas todavía.</p>
        )}
        {notes.data?.map((n) => (
          <div key={n.id} className="rounded-lg bg-white p-2.5 text-xs shadow-sm">
            <p className="whitespace-pre-wrap text-neutral-700">{n.body}</p>
            <p className="mt-1 text-[10px] text-neutral-400">
              {n.user_name} · {new Date(n.created_at).toLocaleString('es')}
            </p>
          </div>
        ))}
      </div>
      <div className="border-t border-amber-100 p-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Añadir nota…"
          className="w-full resize-none rounded-lg border border-neutral-200 px-2 py-1.5 text-xs focus:border-amber-400 focus:outline-none"
        />
        <Button
          size="sm"
          className="mt-2 w-full"
          loading={addNote.isPending}
          disabled={!body.trim()}
          onClick={() => addNote.mutate(body.trim())}
        >
          Guardar nota
        </Button>
      </div>
    </aside>
  );
}

function TagPill({ tag }: { tag: TagDto }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
      style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
    >
      {tag.name}
    </span>
  );
}

function MessageBubble({ message }: { message: MessageDto }) {
  const inbound = message.direction === 'inbound';
  const failed = message.status === 'failed';
  return (
    <div className={cn('flex', inbound ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[70%] rounded-2xl px-3.5 py-2 text-sm',
          inbound ? 'bg-white shadow-sm' : failed ? 'bg-red-100 text-red-800' : 'bg-brand-600 text-white',
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
                    className={cn('mt-1 block text-xs underline', inbound ? 'text-brand-600' : 'text-white')}
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
            'mt-1 flex items-center justify-end gap-1 text-[10px]',
            inbound ? 'text-neutral-400' : failed ? 'text-red-600' : 'text-white/70',
          )}
        >
          {message.status === 'queued' && !inbound && 'enviando… '}
          {failed && 'no enviado · '}
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
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
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
