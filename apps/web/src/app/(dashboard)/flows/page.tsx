'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FlowDto } from '@wolfiax/shared';
import { Plus, Trash2, Workflow } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function FlowsPage() {
  const { me } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const canManage = me?.current_role === 'owner' || me?.current_role === 'admin';

  const flows = useQuery({ queryKey: ['flows'], queryFn: () => api.get<FlowDto[]>('/flows') });

  const toggle = useMutation({
    mutationFn: (f: FlowDto) => api.post(`/flows/${f.id}/toggle`, { enabled: !f.enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['flows'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/flows/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['flows'] }),
  });

  if (!me) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Flujos</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Construye conversaciones guiadas: bienvenida, preguntas, ramas, IA y transferencia a un
            agente. Se ejecutan sobre mensajes entrantes dentro de la ventana de 24h.
          </p>
        </div>
        {canManage && !creating && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Nuevo flujo
          </Button>
        )}
      </div>

      {creating && (
        <CreateFlowForm
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/flows/${id}`)}
        />
      )}

      {flows.isLoading && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}

      {flows.data && flows.data.length === 0 && !creating && (
        <Card>
          <CardBody className="py-10 text-center text-sm text-neutral-400">
            <Workflow className="mx-auto mb-2 size-8" />
            Aún no tienes flujos. Crea el primero, por ejemplo: «bienvenida → pregunta → rama por
            respuesta → IA → transferir».
          </CardBody>
        </Card>
      )}

      {flows.data && flows.data.length > 0 && (
        <Card>
          <CardHeader title="Tus flujos" description="Haz clic para editar en el constructor visual" />
          <CardBody>
            <ul className="divide-y divide-neutral-100">
              {flows.data.map((f) => (
                <li key={f.id} className="flex items-center gap-4 py-3">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => router.push(`/flows/${f.id}`)}
                  >
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {f.name}
                      {f.status === 'published' ? (
                        <Badge tone="agent">v{f.published_version}</Badge>
                      ) : (
                        <Badge>borrador</Badge>
                      )}
                      {f.enabled && f.status === 'published' && <Badge tone="admin">activo</Badge>}
                    </p>
                    <p className="truncate text-xs text-neutral-500">
                      {f.description || 'Sin descripción'} · {f.execution_count} ejecuciones
                    </p>
                  </button>
                  {canManage && (
                    <>
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-500">
                        <input
                          type="checkbox"
                          checked={f.enabled}
                          disabled={f.status !== 'published'}
                          onChange={() => toggle.mutate(f)}
                          className="size-4 accent-brand-600 disabled:opacity-40"
                        />
                        {f.enabled ? 'On' : 'Off'}
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Eliminar ${f.name}`}
                        onClick={() => {
                          if (confirm(`¿Eliminar el flujo "${f.name}"?`)) remove.mutate(f.id);
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

function CreateFlowForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<FlowDto>('/flows', { name: name.trim(), description: description.trim() || undefined }),
    onSuccess: (flow) => {
      void qc.invalidateQueries({ queryKey: ['flows'] });
      onCreated(flow.id);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo crear el flujo.'),
  });

  return (
    <Card>
      <CardHeader title="Nuevo flujo" />
      <CardBody>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (name.trim().length < 2) {
              setError('El nombre es demasiado corto.');
              return;
            }
            create.mutate();
          }}
          className="space-y-4"
        >
          {error && <Alert>{error}</Alert>}
          <div>
            <Label htmlFor="name">Nombre</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Bienvenida y calificación"
              required
            />
          </div>
          <div>
            <Label htmlFor="desc">Descripción (opcional)</Label>
            <Input
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Qué hace este flujo"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={create.isPending}>
              Crear y editar
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
