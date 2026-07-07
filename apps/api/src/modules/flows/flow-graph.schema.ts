import {
  FLOW_ANSWER_TYPES,
  FLOW_CONDITION_OPS,
  FLOW_NODE_TYPES,
  type FlowGraph,
  type FlowTrigger,
  type FlowValidationIssue,
} from '@wolfiax/shared';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Validación estructural del grafo (zod). La validación *semántica* (grafo
// conexo, un único start, sin ramas colgantes) vive en validateGraph().
// ---------------------------------------------------------------------------

const nodeDataSchema = z
  .object({
    label: z.string().max(120).optional(),
    text: z.string().max(2000).optional(),
    answer_type: z.enum(FLOW_ANSWER_TYPES).optional(),
    save_as: z.string().max(60).optional(),
    options: z.array(z.string().min(1).max(80)).max(10).optional(),
    retry_text: z.string().max(2000).optional(),
    variable: z.string().max(60).optional(),
    op: z.enum(FLOW_CONDITION_OPS).optional(),
    value: z.string().max(500).optional(),
    set_name: z.string().max(60).optional(),
    set_value: z.string().max(500).optional(),
    tag_id: z.string().uuid().optional(),
    prompt: z.string().max(2000).optional(),
    route_by_intent: z.boolean().optional(),
    intents: z.array(z.string().min(1).max(60)).max(10).optional(),
    seconds: z.number().int().min(1).max(604800).optional(), // hasta 7 días
    url: z.string().url().max(2000).optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().max(8000).optional(),
    response_map: z.record(z.string(), z.string()).optional(),
    note: z.string().max(500).optional(),
  })
  .strip();

const nodeSchema = z.object({
  id: z.string().min(1).max(120),
  type: z.enum(FLOW_NODE_TYPES),
  position: z.object({ x: z.number(), y: z.number() }),
  data: nodeDataSchema.default({}),
});

const edgeSchema = z.object({
  id: z.string().min(1).max(200),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().max(120).nullish(),
  label: z.string().max(120).optional(),
});

export const graphSchema = z.object({
  nodes: z.array(nodeSchema).max(200),
  edges: z.array(edgeSchema).max(400),
});

export const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual') }),
  z.object({
    type: z.literal('keyword'),
    keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
    match: z.enum(['contains', 'exact']).optional(),
  }),
  z.object({ type: z.literal('new_contact') }),
  z.object({ type: z.literal('any_message') }),
]);

export function parseGraph(input: unknown): FlowGraph {
  return graphSchema.parse(input) as FlowGraph;
}

export function parseTrigger(input: unknown): FlowTrigger {
  return triggerSchema.parse(input) as FlowTrigger;
}

/**
 * Validación semántica del grafo, previa a publicar. Devuelve problemas que
 * impiden una ejecución sana (grafo desconectado, ramas obligatorias sin
 * destino, referencias vacías). No corta la edición: el borrador puede estar
 * incompleto; solo publicar exige un grafo válido.
 */
export function validateGraph(graph: FlowGraph): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  const nodes = graph.nodes;
  const edges = graph.edges;

  const starts = nodes.filter((n) => n.type === 'start');
  if (starts.length === 0) {
    issues.push({ node_id: null, code: 'NO_START', message: 'El flujo necesita un nodo de inicio.' });
  } else if (starts.length > 1) {
    issues.push({
      node_id: null,
      code: 'MULTIPLE_START',
      message: 'Solo puede haber un nodo de inicio.',
    });
  }

  const ids = new Set(nodes.map((n) => n.id));
  const outByNode = new Map<string, typeof edges>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      issues.push({
        node_id: e.source,
        code: 'DANGLING_EDGE',
        message: 'Una conexión apunta a un nodo inexistente.',
      });
      continue;
    }
    const list = outByNode.get(e.source) ?? [];
    list.push(e);
    outByNode.set(e.source, list);
  }

  for (const node of nodes) {
    const out = outByNode.get(node.id) ?? [];
    const handles = new Set(out.map((e) => e.sourceHandle ?? 'default'));

    switch (node.type) {
      case 'end':
      case 'transfer':
        break; // nodos terminales: no requieren salida
      case 'condition': {
        if (!node.data.variable) {
          issues.push({ node_id: node.id, code: 'CONDITION_NO_VAR', message: 'La condición no tiene variable.' });
        }
        if (!handles.has('true') && !handles.has('default')) {
          issues.push({ node_id: node.id, code: 'CONDITION_NO_TRUE', message: 'La condición necesita una rama "sí".' });
        }
        break;
      }
      case 'question': {
        if (!node.data.text?.trim()) {
          issues.push({ node_id: node.id, code: 'QUESTION_NO_TEXT', message: 'La pregunta no tiene texto.' });
        }
        if (out.length === 0) {
          issues.push({ node_id: node.id, code: 'QUESTION_NO_NEXT', message: 'La pregunta no continúa a ningún nodo.' });
        }
        if (node.data.answer_type === 'option') {
          for (const opt of node.data.options ?? []) {
            if (!handles.has(opt)) {
              issues.push({
                node_id: node.id,
                code: 'OPTION_NO_BRANCH',
                message: `La opción "${opt}" no tiene rama conectada.`,
              });
            }
          }
        }
        break;
      }
      case 'message': {
        if (!node.data.text?.trim()) {
          issues.push({ node_id: node.id, code: 'MESSAGE_NO_TEXT', message: 'El mensaje no tiene texto.' });
        }
        if (out.length === 0) {
          issues.push({ node_id: node.id, code: 'MESSAGE_NO_NEXT', message: 'El mensaje no continúa a ningún nodo.' });
        }
        break;
      }
      case 'wait': {
        if (!node.data.seconds) {
          issues.push({ node_id: node.id, code: 'WAIT_NO_TIME', message: 'La espera no tiene duración.' });
        }
        if (out.length === 0) {
          issues.push({ node_id: node.id, code: 'WAIT_NO_NEXT', message: 'La espera no continúa a ningún nodo.' });
        }
        break;
      }
      case 'ai':
      case 'variable':
      case 'tag':
      case 'webhook':
      case 'api':
      case 'start': {
        if (out.length === 0) {
          issues.push({
            node_id: node.id,
            code: 'NODE_NO_NEXT',
            message: 'El nodo no continúa a ningún nodo.',
          });
        }
        break;
      }
    }
  }

  // Alcanzabilidad desde el start (detecta nodos huérfanos)
  if (starts.length === 1) {
    const reachable = new Set<string>();
    const stack = [starts[0].id];
    while (stack.length) {
      const id = stack.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const e of outByNode.get(id) ?? []) stack.push(e.target);
    }
    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        issues.push({
          node_id: node.id,
          code: 'UNREACHABLE',
          message: 'Este nodo no es alcanzable desde el inicio.',
        });
      }
    }
  }

  return issues;
}
