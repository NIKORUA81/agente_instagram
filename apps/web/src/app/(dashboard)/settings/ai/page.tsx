'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiProfileDto, AiTone, ChannelDto, TestReplyResult } from '@wolfiax/shared';
import { Bot, Send, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function AiSettingsPage() {
  const { me } = useAuth();
  const [channelId, setChannelId] = useState<string | null>(null);
  const canManage = me?.current_role === 'owner' || me?.current_role === 'admin';

  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.get<ChannelDto[]>('/channels'),
  });

  useEffect(() => {
    if (!channelId && channels.data && channels.data.length > 0) {
      setChannelId(channels.data[0].id);
    }
  }, [channels.data, channelId]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <Bot className="size-6 text-brand-600" />
        <div>
          <h1 className="text-xl font-semibold">Inteligencia Artificial</h1>
          <p className="text-sm text-neutral-500">
            Configura cómo responde la IA en cada cuenta conectada.
          </p>
        </div>
      </div>

      {channels.isLoading && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}
      {channels.data && channels.data.length === 0 && (
        <Alert tone="info">
          Primero conecta una cuenta de Instagram en <b>Canales</b> para configurar la IA.
        </Alert>
      )}

      {channels.data && channels.data.length > 1 && (
        <div>
          <Label htmlFor="ch">Cuenta</Label>
          <Select id="ch" value={channelId ?? ''} onChange={(e) => setChannelId(e.target.value)}>
            {channels.data.map((c) => (
              <option key={c.id} value={c.id}>
                @{c.ig_username}
              </option>
            ))}
          </Select>
        </div>
      )}

      {channelId && <ProfileEditor channelId={channelId} canManage={canManage} />}
      {channelId && <Sandbox channelId={channelId} />}
    </div>
  );
}

function ProfileEditor({ channelId, canManage }: { channelId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<Partial<AiProfileDto>>({});

  const profile = useQuery({
    queryKey: ['ai-profile', channelId],
    queryFn: () => api.get<AiProfileDto>(`/channels/${channelId}/ai-profile`),
  });

  useEffect(() => {
    if (profile.data) setForm(profile.data);
  }, [profile.data]);

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api.patch<AiProfileDto>(`/channels/${channelId}/ai-profile`, patch),
    onSuccess: (data) => {
      setForm(data);
      setSaved(true);
      setError(null);
      setTimeout(() => setSaved(false), 2000);
      void qc.invalidateQueries({ queryKey: ['ai-profile', channelId] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo guardar.'),
  });

  if (profile.isLoading || !profile.data) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate({
      enabled: form.enabled,
      tone: form.tone,
      system_prompt: form.system_prompt,
      disclosure_message: form.disclosure_message,
      handover_keywords: form.handover_keywords,
      confidence_threshold: form.confidence_threshold,
      monthly_token_budget: form.monthly_token_budget,
    });
  }

  return (
    <Card>
      <CardHeader
        title="Configuración de la IA"
        actions={
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand-600"
              disabled={!canManage}
              checked={form.enabled ?? false}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            {form.enabled ? 'IA activada' : 'IA desactivada'}
          </label>
        }
      />
      <CardBody>
        {error && <Alert className="mb-4">{error}</Alert>}
        {saved && (
          <Alert tone="success" className="mb-4">
            Cambios guardados.
          </Alert>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="tone">Tono</Label>
              <Select
                id="tone"
                value={form.tone ?? 'professional'}
                onChange={(e) => setForm((f) => ({ ...f, tone: e.target.value as AiTone }))}
                className="w-full"
                disabled={!canManage}
              >
                <option value="professional">Profesional</option>
                <option value="friendly">Cercano</option>
                <option value="casual">Casual</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="conf">Umbral de confianza para responder</Label>
              <Input
                id="conf"
                type="number"
                step="0.05"
                min={0}
                max={1}
                disabled={!canManage}
                value={form.confidence_threshold ?? 0.35}
                onChange={(e) =>
                  setForm((f) => ({ ...f, confidence_threshold: Number(e.target.value) }))
                }
              />
            </div>
          </div>

          <div>
            <Label htmlFor="sp">Instrucciones del negocio (system prompt)</Label>
            <textarea
              id="sp"
              rows={4}
              disabled={!canManage}
              value={form.system_prompt ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
              placeholder="Ej: Somos una tienda de café de especialidad. Sé cálido, invita a visitar la tienda…"
              className="w-full resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline focus:outline-2 focus:outline-brand-100 disabled:bg-neutral-100"
            />
          </div>

          <div>
            <Label htmlFor="disc">Aviso de bot (primer mensaje)</Label>
            <Input
              id="disc"
              disabled={!canManage}
              value={form.disclosure_message ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, disclosure_message: e.target.value }))}
            />
            <p className="mt-1 text-xs text-neutral-400">
              Se antepone a la primera respuesta automática (requerido por las políticas de Meta).
            </p>
          </div>

          <div>
            <Label htmlFor="kw">Palabras que derivan a un humano (separadas por coma)</Label>
            <Input
              id="kw"
              disabled={!canManage}
              value={(form.handover_keywords ?? []).join(', ')}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  handover_keywords: e.target.value
                    .split(',')
                    .map((k) => k.trim())
                    .filter(Boolean),
                }))
              }
            />
          </div>

          {canManage && (
            <div className="flex justify-end">
              <Button type="submit" loading={save.isPending}>
                Guardar
              </Button>
            </div>
          )}
        </form>
      </CardBody>
    </Card>
  );
}

function Sandbox({ channelId }: { channelId: string }) {
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<TestReplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const test = useMutation({
    mutationFn: () => api.post<TestReplyResult>('/ai/test-reply', { channel_id: channelId, message }),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo probar la IA.'),
  });

  return (
    <Card>
      <CardHeader
        title="Probar la IA (sandbox)"
        description="Simula un mensaje de cliente. No se envía nada a Instagram."
      />
      <CardBody>
        {error && <Alert className="mb-4">{error}</Alert>}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (message.trim()) test.mutate();
          }}
        >
          <div className="flex-1">
            <Label htmlFor="test-msg">Mensaje de prueba</Label>
            <Input
              id="test-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="¿Cuánto cuesta el envío?"
            />
          </div>
          <Button type="submit" loading={test.isPending} disabled={!message.trim()}>
            <Send className="size-4" /> Probar
          </Button>
        </form>

        {result && (
          <div className="mt-4 space-y-2">
            {result.handover ? (
              <Alert tone="info">
                <span className="flex items-center gap-2 font-medium">
                  <ShieldAlert className="size-4" /> La IA derivaría a un humano.
                </span>
                {result.reason && <p className="mt-1 text-xs">{result.reason}</p>}
              </Alert>
            ) : (
              <div className="rounded-lg bg-neutral-50 p-3">
                <p className="text-xs font-medium text-neutral-500">Respuesta de la IA:</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{result.reply}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2 text-xs">
              {result.intent && <Badge>intención: {result.intent}</Badge>}
              {result.language && <Badge>idioma: {result.language}</Badge>}
              {result.sentiment && <Badge>sentimiento: {result.sentiment}</Badge>}
              <Badge tone={result.confidence >= 0.5 ? 'agent' : 'analyst'}>
                confianza: {(result.confidence * 100).toFixed(0)}%
              </Badge>
              {result.used_sources.length > 0 && (
                <Badge>{result.used_sources.length} fuente(s) usadas</Badge>
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
