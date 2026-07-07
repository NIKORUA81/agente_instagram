'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  FlowExecutionDto,
  FlowGraph,
  FlowSimulationResult,
  FlowSimulationStep,
} from '@wolfiax/shared';
import { Play } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiError } from '@/lib/api';
import { FLOW_NODE_META } from '@/lib/flow-meta';
import { cn } from '@/lib/utils';

const KIND_COLOR: Record<FlowSimulationStep['kind'], string> = {
  send: 'bg-brand-100 text-brand-700',
  wait_input: 'bg-indigo-100 text-indigo-700',
  wait_timer: 'bg-orange-100 text-orange-700',
  ai: 'bg-violet-100 text-violet-700',
  transfer: 'bg-rose-100 text-rose-700',
  end: 'bg-neutral-200 text-neutral-600',
  action: 'bg-neutral-100 text-neutral-500',
  error: 'bg-red-100 text-red-700',
};

export function SimulatePanel({ flowId, graph }: { flowId: string; graph: FlowGraph }) {
  const [tab, setTab] = useState<'sim' | 'runs'>('sim');
  const [messages, setMessages] = useState<string[]>(['Hola']);
  const [result, setResult] = useState<FlowSimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const executions = useQuery({
    queryKey: ['flow-executions', flowId],
    queryFn: () => api.get<FlowExecutionDto[]>(`/flows/${flowId}/executions`),
    enabled: tab === 'runs',
  });

  const simulate = useMutation({
    mutationFn: () =>
      api.post<FlowSimulationResult>(`/flows/${flowId}/simulate`, {
        graph,
        messages: messages.filter((m) => m.trim()),
      }),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo simular.'),
  });

  return (
    <div className="flex h-full w-80 flex-col border-l border-neutral-200 bg-white">
      <div className="flex border-b border-neutral-100 text-sm">
        <button
          className={cn('flex-1 py-2.5 font-medium', tab === 'sim' ? 'border-b-2 border-brand-500 text-brand-700' : 'text-neutral-500')}
          onClick={() => setTab('sim')}
        >
          Simular
        </button>
        <button
          className={cn('flex-1 py-2.5 font-medium', tab === 'runs' ? 'border-b-2 border-brand-500 text-brand-700' : 'text-neutral-500')}
          onClick={() => setTab('runs')}
        >
          Ejecuciones
        </button>
      </div>

      {tab === 'sim' ? (
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-xs text-neutral-500">
            Prueba el flujo con mensajes de ejemplo. No envía nada real; las esperas se saltan.
          </p>
          <div className="space-y-2">
            {messages.map((m, i) => (
              <Input
                key={i}
                value={m}
                onChange={(e) => setMessages((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={`Mensaje ${i + 1} del usuario`}
              />
            ))}
            <button
              className="text-xs text-brand-600 hover:underline"
              onClick={() => setMessages((prev) => [...prev, ''])}
            >
              + Añadir mensaje
            </button>
          </div>
          <Button className="w-full" loading={simulate.isPending} onClick={() => simulate.mutate()}>
            <Play className="size-4" /> Ejecutar simulación
          </Button>
          {error && <p className="text-xs text-red-600">{error}</p>}

          {result && (
            <div className="space-y-2 pt-2">
              <p className="text-xs font-medium text-neutral-600">
                Traza ({result.status}
                {result.awaiting_input ? ', esperando respuesta' : ''})
              </p>
              <ol className="space-y-1.5">
                {result.steps.map((s, i) => (
                  <li key={i} className="rounded-lg border border-neutral-100 p-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', KIND_COLOR[s.kind])}>
                        {FLOW_NODE_META[s.node_type].label}
                      </span>
                      {s.branch && s.branch !== 'default' && (
                        <span className="text-[10px] text-neutral-400">→ {s.branch}</span>
                      )}
                    </div>
                    {s.output && <p className="mt-1 whitespace-pre-wrap text-neutral-600">{s.output}</p>}
                  </li>
                ))}
              </ol>
              {Object.keys(result.steps.at(-1)?.variables ?? {}).length > 0 && (
                <div className="rounded-lg bg-neutral-50 p-2 text-[11px] text-neutral-500">
                  <p className="mb-1 font-medium">Variables finales</p>
                  <pre className="whitespace-pre-wrap break-all">
                    {JSON.stringify(result.steps.at(-1)?.variables, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {executions.isLoading && (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          )}
          {executions.data && executions.data.length === 0 && (
            <p className="py-6 text-center text-xs text-neutral-400">
              Sin ejecuciones todavía. Publica y activa el flujo para que corra con usuarios reales.
            </p>
          )}
          {executions.data?.map((ex) => (
            <div key={ex.id} className="rounded-lg border border-neutral-100 p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium">{ex.contact_name ?? 'Contacto'}</span>
                <span className="text-[10px] text-neutral-400">{ex.status}</span>
              </div>
              <ol className="mt-1.5 space-y-0.5">
                {ex.trace.map((t, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                    <span className={cn('rounded px-1 text-[10px]', KIND_COLOR.action)}>
                      {FLOW_NODE_META[t.node_type]?.label ?? t.node_type}
                    </span>
                    {t.branch && <span className="text-neutral-400">→ {t.branch}</span>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
