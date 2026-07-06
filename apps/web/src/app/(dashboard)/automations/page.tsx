'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AutomationAction,
  AutomationDto,
  AutomationTrigger,
  TagDto,
} from '@wolfiax/shared';
import { Plus, Trash2, Zap } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const TRIGGER_LABELS: Record<string, string> = {
  any_message: 'Cualquier mensaje',
  keyword: 'Palabra clave',
  story_reply: 'Respuesta a historia',
  reaction: 'Reacción',
  new_contact: 'Cliente nuevo',
};

function triggerSummary(trigger: AutomationTrigger): string {
  if (trigger.type === 'keyword') {
    return `Palabra clave: ${trigger.keywords.join(', ')}`;
  }
  return TRIGGER_LABELS[trigger.type] ?? trigger.type;
}

function actionSummary(action: AutomationAction): string {
  switch (action.type) {
    case 'reply':
      return `Responder: "${action.text.slice(0, 40)}${action.text.length > 40 ? '…' : ''}"`;
    case 'add_tag':
      return 'Añadir etiqueta';
    case 'assign':
      return 'Asignar a agente';
    case 'set_status':
      return `Marcar como ${action.status}`;
  }
}

export default function AutomationsPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const canManage = me?.current_role === 'owner' || me?.current_role === 'admin';

  const automations = useQuery({
    queryKey: ['automations'],
    queryFn: () => api.get<AutomationDto[]>('/automations'),
  });

  const toggle = useMutation({
    mutationFn: (id: string) => api.post(`/automations/${id}/toggle`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['automations'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/automations/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['automations'] }),
  });

  if (!me) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Automatizaciones</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Reglas que responden y organizan conversaciones automáticamente. Solo actúan dentro de
            la ventana de 24h y sobre mensajes entrantes.
          </p>
        </div>
        {canManage && !creating && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Nueva regla
          </Button>
        )}
      </div>

      {creating && <AutomationForm onClose={() => setCreating(false)} />}

      {automations.isLoading && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}

      {automations.data && automations.data.length === 0 && !creating && (
        <Card>
          <CardBody className="py-10 text-center text-sm text-neutral-400">
            <Zap className="mx-auto mb-2 size-8" />
            Aún no tienes automatizaciones. Crea tu primera regla, por ejemplo: «si el mensaje
            contiene ‘precio’ → responder con tu lista de precios y etiquetar como ventas».
          </CardBody>
        </Card>
      )}

      {automations.data && automations.data.length > 0 && (
        <Card>
          <CardHeader title="Reglas activas" description="Se evalúan por prioridad; la primera que coincide gana" />
          <CardBody>
            <ul className="divide-y divide-neutral-100">
              {automations.data.map((a) => (
                <li key={a.id} className="flex items-center gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {a.name}
                      {!a.enabled && (
                        <span className="ml-2 text-xs font-normal text-neutral-400">(inactiva)</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-neutral-500">
                      {triggerSummary(a.trigger)} → {a.actions.map(actionSummary).join(' · ')}
                    </p>
                    <p className="mt-0.5 text-[11px] text-neutral-400">
                      Disparada {a.fire_count} {a.fire_count === 1 ? 'vez' : 'veces'} · prioridad{' '}
                      {a.priority}
                    </p>
                  </div>
                  {canManage && (
                    <>
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-500">
                        <input
                          type="checkbox"
                          checked={a.enabled}
                          onChange={() => toggle.mutate(a.id)}
                          className="size-4 accent-brand-600"
                        />
                        {a.enabled ? 'On' : 'Off'}
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Eliminar ${a.name}`}
                        onClick={() => {
                          if (confirm(`¿Eliminar la automatización "${a.name}"?`)) remove.mutate(a.id);
                        }}
                      >
                        <Trash2 className="size-4 text-neutral-400 hover:text-red-600" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function AutomationForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<AutomationTrigger['type']>('keyword');
  const [keywords, setKeywords] = useState('');
  const [replyText, setReplyText] = useState('');
  const [tagId, setTagId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api.get<TagDto[]>('/tags') });

  const create = useMutation({
    mutationFn: () => {
      const trigger: AutomationTrigger =
        triggerType === 'keyword'
          ? {
              type: 'keyword',
              keywords: keywords
                .split(',')
                .map((k) => k.trim())
                .filter(Boolean),
            }
          : ({ type: triggerType } as AutomationTrigger);

      const actions: AutomationAction[] = [];
      if (replyText.trim()) actions.push({ type: 'reply', text: replyText.trim() });
      if (tagId) actions.push({ type: 'add_tag', tag_id: tagId });

      return api.post<AutomationDto>('/automations', { name: name.trim(), trigger, actions });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['automations'] });
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo crear la automatización.'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (triggerType === 'keyword' && !keywords.trim()) {
      setError('Indica al menos una palabra clave.');
      return;
    }
    if (!replyText.trim() && !tagId) {
      setError('Añade al menos una acción (respuesta o etiqueta).');
      return;
    }
    create.mutate();
  }

  return (
    <Card>
      <CardHeader title="Nueva automatización" />
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div>
            <Label htmlFor="name">Nombre</Label>
            <Input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Consulta de precios"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="trigger">Cuando…</Label>
              <Select
                id="trigger"
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as AutomationTrigger['type'])}
                className="w-full"
              >
                {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            {triggerType === 'keyword' && (
              <div>
                <Label htmlFor="keywords">Palabras clave (separadas por coma)</Label>
                <Input
                  id="keywords"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="precio, cuánto, cotización"
                />
              </div>
            )}
          </div>

          <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
            <p className="mb-2 text-xs font-medium text-neutral-600">Acciones</p>
            <div className="space-y-3">
              <div>
                <Label htmlFor="reply">Responder con (opcional)</Label>
                <textarea
                  id="reply"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={2}
                  placeholder="Texto de respuesta automática…"
                  className="w-full resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline focus:outline-2 focus:outline-brand-100"
                />
              </div>
              <div>
                <Label htmlFor="tag">Añadir etiqueta (opcional)</Label>
                <Select
                  id="tag"
                  value={tagId}
                  onChange={(e) => setTagId(e.target.value)}
                  className="w-full"
                >
                  <option value="">— Ninguna —</option>
                  {tags.data?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={create.isPending}>
              Crear regla
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
