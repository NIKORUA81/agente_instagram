'use client';

import { useQuery } from '@tanstack/react-query';
import {
  FLOW_ANSWER_TYPES,
  FLOW_CONDITION_OPS,
  type FlowNode,
  type FlowNodeData,
  type TagDto,
} from '@wolfiax/shared';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { api } from '@/lib/api';
import { FLOW_NODE_META } from '@/lib/flow-meta';

const ANSWER_LABELS: Record<string, string> = {
  text: 'Texto libre',
  number: 'Número',
  email: 'Email',
  phone: 'Teléfono',
  option: 'Opciones',
};

const OP_LABELS: Record<string, string> = {
  equals: 'es igual a',
  not_equals: 'es distinto de',
  contains: 'contiene',
  gt: 'mayor que',
  lt: 'menor que',
  is_set: 'tiene valor',
  is_empty: 'está vacía',
};

function Field({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1">{children}</div>;
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className="w-full resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline focus:outline-2 focus:outline-brand-100"
    />
  );
}

export function ConfigPanel({
  node,
  onChange,
  onDelete,
  onClose,
}: {
  node: FlowNode;
  onChange: (data: FlowNodeData) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const meta = FLOW_NODE_META[node.type];
  const data = node.data;
  const set = (patch: Partial<FlowNodeData>) => onChange({ ...data, ...patch });
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api.get<TagDto[]>('/tags') });

  return (
    <div className="flex h-full w-80 flex-col border-l border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
        <p className="text-sm font-semibold">{meta.label}</p>
        <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-700">
          Cerrar
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Field>
          <Label>Etiqueta (opcional)</Label>
          <Input
            value={data.label ?? ''}
            onChange={(e) => set({ label: e.target.value })}
            placeholder={meta.label}
          />
        </Field>

        {(node.type === 'message' || node.type === 'question') && (
          <Field>
            <Label>Mensaje</Label>
            <TextArea
              rows={3}
              value={data.text ?? ''}
              onChange={(e) => set({ text: e.target.value })}
              placeholder="Puedes usar {{variable}}"
            />
          </Field>
        )}

        {node.type === 'question' && (
          <>
            <Field>
              <Label>Tipo de respuesta</Label>
              <Select
                className="w-full"
                value={data.answer_type ?? 'text'}
                onChange={(e) => set({ answer_type: e.target.value as FlowNodeData['answer_type'] })}
              >
                {FLOW_ANSWER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ANSWER_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>Guardar en variable</Label>
              <Input
                value={data.save_as ?? ''}
                onChange={(e) => set({ save_as: e.target.value })}
                placeholder="nombre"
              />
            </Field>
            {data.answer_type === 'option' && (
              <Field>
                <Label>Opciones (una por línea)</Label>
                <TextArea
                  rows={3}
                  value={(data.options ?? []).join('\n')}
                  onChange={(e) =>
                    set({ options: e.target.value.split('\n').map((o) => o.trim()).filter(Boolean) })
                  }
                  placeholder={'Sí\nNo'}
                />
                <p className="text-[11px] text-neutral-400">Cada opción crea una rama de salida.</p>
              </Field>
            )}
            <Field>
              <Label>Mensaje si la respuesta es inválida</Label>
              <Input
                value={data.retry_text ?? ''}
                onChange={(e) => set({ retry_text: e.target.value })}
                placeholder="No entendí, ¿puedes repetirlo?"
              />
            </Field>
          </>
        )}

        {node.type === 'condition' && (
          <>
            <Field>
              <Label>Variable</Label>
              <Input
                value={data.variable ?? ''}
                onChange={(e) => set({ variable: e.target.value })}
                placeholder="nombre"
              />
            </Field>
            <Field>
              <Label>Operador</Label>
              <Select
                className="w-full"
                value={data.op ?? 'equals'}
                onChange={(e) => set({ op: e.target.value as FlowNodeData['op'] })}
              >
                {FLOW_CONDITION_OPS.map((op) => (
                  <option key={op} value={op}>
                    {OP_LABELS[op]}
                  </option>
                ))}
              </Select>
            </Field>
            {data.op !== 'is_set' && data.op !== 'is_empty' && (
              <Field>
                <Label>Valor</Label>
                <Input value={data.value ?? ''} onChange={(e) => set({ value: e.target.value })} />
              </Field>
            )}
          </>
        )}

        {node.type === 'variable' && (
          <>
            <Field>
              <Label>Nombre de la variable</Label>
              <Input value={data.set_name ?? ''} onChange={(e) => set({ set_name: e.target.value })} />
            </Field>
            <Field>
              <Label>Valor</Label>
              <Input
                value={data.set_value ?? ''}
                onChange={(e) => set({ set_value: e.target.value })}
                placeholder="Puedes usar {{otra_variable}}"
              />
            </Field>
          </>
        )}

        {node.type === 'tag' && (
          <Field>
            <Label>Etiqueta a aplicar</Label>
            <Select
              className="w-full"
              value={data.tag_id ?? ''}
              onChange={(e) => set({ tag_id: e.target.value })}
            >
              <option value="">— Selecciona —</option>
              {tags.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {node.type === 'ai' && (
          <>
            <Field>
              <Label>Instrucción adicional (opcional)</Label>
              <TextArea
                rows={3}
                value={data.prompt ?? ''}
                onChange={(e) => set({ prompt: e.target.value })}
                placeholder="Ej: responde sobre disponibilidad de citas"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-neutral-600">
              <input
                type="checkbox"
                checked={data.route_by_intent ?? false}
                onChange={(e) => set({ route_by_intent: e.target.checked })}
                className="size-4 accent-brand-600"
              />
              Ramificar por intención detectada
            </label>
            {data.route_by_intent && (
              <Field>
                <Label>Intenciones (una por línea)</Label>
                <TextArea
                  rows={3}
                  value={(data.intents ?? []).join('\n')}
                  onChange={(e) =>
                    set({ intents: e.target.value.split('\n').map((o) => o.trim()).filter(Boolean) })
                  }
                  placeholder={'compra\nsoporte'}
                />
              </Field>
            )}
          </>
        )}

        {node.type === 'wait' && (
          <Field>
            <Label>Esperar (segundos)</Label>
            <Input
              type="number"
              min={1}
              value={data.seconds ?? 0}
              onChange={(e) => set({ seconds: Number(e.target.value) })}
            />
            <p className="text-[11px] text-neutral-400">
              Al despertar se re-verifica la ventana de 24h; si está cerrada, toma la rama «ventana
              cerrada».
            </p>
          </Field>
        )}

        {(node.type === 'webhook' || node.type === 'api') && (
          <>
            <Field>
              <Label>URL</Label>
              <Input
                value={data.url ?? ''}
                onChange={(e) => set({ url: e.target.value })}
                placeholder="https://…"
              />
            </Field>
            <Field>
              <Label>Método</Label>
              <Select
                className="w-full"
                value={data.method ?? (node.type === 'api' ? 'GET' : 'POST')}
                onChange={(e) => set({ method: e.target.value as FlowNodeData['method'] })}
              >
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            {data.method !== 'GET' && data.method !== 'DELETE' && (
              <Field>
                <Label>Cuerpo (JSON)</Label>
                <TextArea
                  rows={3}
                  value={data.body ?? ''}
                  onChange={(e) => set({ body: e.target.value })}
                  placeholder='{"nombre": "{{nombre}}"}'
                />
              </Field>
            )}
            {node.type === 'api' && (
              <Field>
                <Label>Mapear respuesta a variables</Label>
                <TextArea
                  rows={2}
                  value={Object.entries(data.response_map ?? {})
                    .map(([k, v]) => `${k}=${v}`)
                    .join('\n')}
                  onChange={(e) =>
                    set({
                      response_map: Object.fromEntries(
                        e.target.value
                          .split('\n')
                          .map((l) => l.split('='))
                          .filter((p) => p.length === 2)
                          .map(([k, v]) => [k.trim(), v.trim()]),
                      ),
                    })
                  }
                  placeholder={'variable=ruta.en.json'}
                />
              </Field>
            )}
          </>
        )}

        {node.type === 'transfer' && (
          <Field>
            <Label>Nota para el agente (opcional)</Label>
            <Input value={data.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
          </Field>
        )}
      </div>

      {node.type !== 'start' && (
        <div className="border-t border-neutral-100 p-4">
          <Button variant="danger" size="sm" className="w-full" onClick={onDelete}>
            <Trash2 className="size-4" /> Eliminar nodo
          </Button>
        </div>
      )}
    </div>
  );
}
