import type { FlowNodeData, FlowNodeType } from '@wolfiax/shared';
import {
  Bot,
  Braces,
  CircleDot,
  Clock,
  Flag,
  GitBranch,
  MessageSquare,
  MessageSquareQuote,
  PhoneForwarded,
  Send,
  Tag,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

export interface FlowNodeMeta {
  type: FlowNodeType;
  label: string;
  description: string;
  icon: LucideIcon;
  /** clase de color del acento (borde/encabezado) */
  color: string;
  bg: string;
  /** salidas por defecto del nodo (handles). 'default' = salida única. */
  handles: string[];
  defaultData: FlowNodeData;
  /** no aparece en la paleta (start es único y ya existe). */
  hidden?: boolean;
}

export const FLOW_NODE_META: Record<FlowNodeType, FlowNodeMeta> = {
  start: {
    type: 'start',
    label: 'Inicio',
    description: 'Punto de entrada del flujo',
    icon: CircleDot,
    color: 'border-emerald-400',
    bg: 'bg-emerald-50 text-emerald-700',
    handles: ['default'],
    defaultData: { label: 'Inicio' },
    hidden: true,
  },
  message: {
    type: 'message',
    label: 'Mensaje',
    description: 'Envía un mensaje y continúa',
    icon: Send,
    color: 'border-brand-400',
    bg: 'bg-brand-50 text-brand-700',
    handles: ['default'],
    defaultData: { text: 'Hola 👋' },
  },
  question: {
    type: 'question',
    label: 'Pregunta',
    description: 'Pregunta y espera respuesta',
    icon: MessageSquareQuote,
    color: 'border-indigo-400',
    bg: 'bg-indigo-50 text-indigo-700',
    handles: ['default'],
    defaultData: { text: '¿Cuál es tu nombre?', answer_type: 'text', save_as: 'nombre' },
  },
  condition: {
    type: 'condition',
    label: 'Condición',
    description: 'Ramifica según una variable',
    icon: GitBranch,
    color: 'border-amber-400',
    bg: 'bg-amber-50 text-amber-700',
    handles: ['true', 'false'],
    defaultData: { variable: 'nombre', op: 'is_set', value: '' },
  },
  variable: {
    type: 'variable',
    label: 'Variable',
    description: 'Asigna una variable',
    icon: Braces,
    color: 'border-cyan-400',
    bg: 'bg-cyan-50 text-cyan-700',
    handles: ['default'],
    defaultData: { set_name: 'variable', set_value: '' },
  },
  tag: {
    type: 'tag',
    label: 'Etiqueta',
    description: 'Etiqueta la conversación',
    icon: Tag,
    color: 'border-pink-400',
    bg: 'bg-pink-50 text-pink-700',
    handles: ['default'],
    defaultData: {},
  },
  ai: {
    type: 'ai',
    label: 'IA',
    description: 'Responde con la IA (RAG)',
    icon: Bot,
    color: 'border-violet-400',
    bg: 'bg-violet-50 text-violet-700',
    handles: ['default'],
    defaultData: { prompt: '', route_by_intent: false },
  },
  wait: {
    type: 'wait',
    label: 'Esperar',
    description: 'Pausa (re-verifica ventana 24h)',
    icon: Clock,
    color: 'border-orange-400',
    bg: 'bg-orange-50 text-orange-700',
    handles: ['default', 'closed'],
    defaultData: { seconds: 3600 },
  },
  webhook: {
    type: 'webhook',
    label: 'Webhook',
    description: 'POST saliente (fire-and-forget)',
    icon: Webhook,
    color: 'border-slate-400',
    bg: 'bg-slate-50 text-slate-700',
    handles: ['default'],
    defaultData: { url: '', method: 'POST', body: '{}' },
  },
  api: {
    type: 'api',
    label: 'API',
    description: 'Llamada HTTP mapeada a variables',
    icon: Webhook,
    color: 'border-slate-400',
    bg: 'bg-slate-50 text-slate-700',
    handles: ['default'],
    defaultData: { url: '', method: 'GET', response_map: {} },
  },
  transfer: {
    type: 'transfer',
    label: 'Transferir',
    description: 'Pasa a un agente humano',
    icon: PhoneForwarded,
    color: 'border-rose-400',
    bg: 'bg-rose-50 text-rose-700',
    handles: [],
    defaultData: { note: '' },
  },
  end: {
    type: 'end',
    label: 'Fin',
    description: 'Finaliza el flujo',
    icon: Flag,
    color: 'border-neutral-400',
    bg: 'bg-neutral-100 text-neutral-600',
    handles: [],
    defaultData: {},
  },
};

/** Nodos disponibles en la paleta (excluye start). */
export const PALETTE_NODES = Object.values(FLOW_NODE_META).filter((m) => !m.hidden);

export { MessageSquare };
