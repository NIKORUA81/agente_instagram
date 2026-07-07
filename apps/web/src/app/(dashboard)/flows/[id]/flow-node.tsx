'use client';

import type { FlowNodeData, FlowNodeType } from '@wolfiax/shared';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FLOW_NODE_META } from '@/lib/flow-meta';
import { cn } from '@/lib/utils';

/** Calcula las salidas (handles) de un nodo según su tipo y configuración. */
export function outHandles(type: FlowNodeType, data: FlowNodeData): string[] {
  switch (type) {
    case 'condition':
      return ['true', 'false'];
    case 'question':
      return data.answer_type === 'option' && data.options?.length
        ? [...data.options, 'invalid']
        : ['default'];
    case 'wait':
      return ['default', 'closed'];
    case 'ai':
      return data.route_by_intent && data.intents?.length
        ? [...data.intents, 'default']
        : ['default'];
    case 'transfer':
    case 'end':
      return [];
    default:
      return ['default'];
  }
}

const HANDLE_LABEL: Record<string, string> = {
  default: '',
  true: 'sí',
  false: 'no',
  closed: 'ventana cerrada',
  invalid: 'inválida',
};

function summary(type: FlowNodeType, data: FlowNodeData): string {
  switch (type) {
    case 'message':
    case 'question':
      return data.text ?? '';
    case 'condition':
      return `${data.variable ?? '?'} ${data.op ?? ''} ${data.value ?? ''}`;
    case 'variable':
      return `${data.set_name ?? '?'} = ${data.set_value ?? ''}`;
    case 'ai':
      return data.prompt || 'Responde con la base de conocimiento';
    case 'wait':
      return `${data.seconds ?? 0}s`;
    case 'webhook':
    case 'api':
      return `${data.method ?? 'POST'} ${data.url ?? ''}`;
    case 'transfer':
      return data.note || 'Deriva a un agente';
    default:
      return '';
  }
}

export function FlowNodeCard({ type, data, selected }: NodeProps & { type: FlowNodeType }) {
  const meta = FLOW_NODE_META[type];
  const Icon = meta.icon;
  const handles = outHandles(type, data as FlowNodeData);
  const text = summary(type, data as FlowNodeData);

  return (
    <div
      className={cn(
        'w-56 rounded-xl border-2 bg-white shadow-sm transition-shadow',
        meta.color,
        selected && 'ring-2 ring-brand-400 ring-offset-1',
      )}
    >
      {type !== 'start' && (
        <Handle type="target" position={Position.Left} className="!size-2.5 !bg-neutral-400" />
      )}

      <div className={cn('flex items-center gap-2 rounded-t-lg px-3 py-1.5 text-xs font-semibold', meta.bg)}>
        <Icon className="size-3.5" />
        {(data as FlowNodeData).label || meta.label}
      </div>
      {text && (
        <p className="line-clamp-3 whitespace-pre-wrap px-3 py-2 text-[11px] leading-snug text-neutral-600">
          {text}
        </p>
      )}

      {handles.map((h, i) => (
        <div key={h} className="relative">
          {handles.length > 1 && (
            <span className="block px-3 py-0.5 text-right text-[10px] text-neutral-400">
              {HANDLE_LABEL[h] ?? h}
            </span>
          )}
          <Handle
            id={h}
            type="source"
            position={Position.Right}
            style={
              handles.length > 1
                ? { top: `${38 + (text ? 34 : 0) + i * 20}px` }
                : undefined
            }
            className="!size-2.5 !bg-brand-500"
          />
        </div>
      ))}
    </div>
  );
}
