import type {
  FlowAnswerType,
  FlowExecutionStatus,
  FlowGraph,
  FlowNode,
  FlowTraceEntry,
} from '@wolfiax/shared';

export type FlowVars = Record<string, unknown>;

/**
 * Efectos secundarios que el intérprete delega en el orquestador. La ejecución
 * real los conecta a messaging/ai-service; el sandbox de simulación los graba
 * sin enviar nada.
 */
export interface FlowEffects {
  send(text: string): Promise<void> | void;
  ai(node: FlowNode, vars: FlowVars): Promise<FlowAiResult> | FlowAiResult;
  addTag(tagId: string): Promise<void> | void;
  http(node: FlowNode, vars: FlowVars): Promise<unknown> | unknown;
  transfer(note: string | null): Promise<void> | void;
  /** Al despertar de un "esperar" se re-verifica la ventana de 24h (cumplimiento Meta). */
  windowOpen(): boolean;
  onStep?(entry: FlowTraceEntry): void;
}

export interface FlowAiResult {
  reply: string | null;
  intent: string | null;
  confidence: number;
  handover: boolean;
  extracted: Record<string, unknown>;
}

export interface StepResult {
  status: FlowExecutionStatus;
  currentNodeId: string | null;
  variables: FlowVars;
  trace: FlowTraceEntry[];
  /** segundos a esperar cuando status === 'waiting_timer'. */
  waitSeconds?: number;
  error?: string;
}

const MAX_STEPS = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Intérprete puro del grafo. No conoce Prisma ni Nest: recibe grafo, variables
 * y efectos, y avanza hasta que el flujo se suspende (pregunta/espera) o
 * termina. La ejecución se persiste fuera de aquí.
 */
export class FlowInterpreter {
  private readonly byId = new Map<string, FlowNode>();
  private readonly trace: FlowTraceEntry[] = [];
  private steps = 0;

  constructor(
    private readonly graph: FlowGraph,
    private readonly effects: FlowEffects,
    private readonly startingSteps = 0,
  ) {
    for (const n of graph.nodes) this.byId.set(n.id, n);
    this.steps = startingSteps;
  }

  /** Pasos acumulados (incluye los previos a esta reanudación). */
  get stepCount(): number {
    return this.steps;
  }

  /** Arranca desde el nodo `start`. */
  async start(vars: FlowVars): Promise<StepResult> {
    const start = this.graph.nodes.find((n) => n.type === 'start');
    if (!start) {
      return this.fail(vars, 'El flujo no tiene nodo de inicio.');
    }
    const next = this.nextNode(start.id, 'default');
    return this.walk(next, vars);
  }

  /**
   * Reanuda un flujo en espera de respuesta: valida el texto contra el tipo
   * esperado, guarda la variable y rutea por la rama correspondiente.
   */
  async resumeWithAnswer(nodeId: string, answer: string, vars: FlowVars): Promise<StepResult> {
    const node = this.byId.get(nodeId);
    if (!node || node.type !== 'question') {
      return this.fail(vars, 'Nodo de pregunta inválido al reanudar.');
    }
    const validated = validateAnswer(node.data.answer_type ?? 'text', answer, node.data.options);
    if (!validated.ok) {
      const retry = node.data.retry_text ?? 'No entendí tu respuesta, ¿puedes repetirla?';
      await this.effects.send(interpolate(retry, vars));
      this.record(node, 'respuesta inválida', 'invalid');
      // Sigue esperando en el mismo nodo
      return {
        status: 'waiting_input',
        currentNodeId: node.id,
        variables: vars,
        trace: this.trace,
      };
    }
    const nextVars = { ...vars };
    if (node.data.save_as) nextVars[node.data.save_as] = validated.value;
    this.record(node, `respuesta: ${answer}`, validated.branch);
    const next = this.nextNode(node.id, validated.branch);
    return this.walk(next, nextVars);
  }

  /**
   * Reanuda tras un "esperar": re-verifica la ventana de 24h. Si está cerrada,
   * toma la rama 'closed' si existe; si no, termina sin enviar.
   */
  async resumeAfterWait(nodeId: string, vars: FlowVars): Promise<StepResult> {
    const node = this.byId.get(nodeId);
    if (!node || node.type !== 'wait') {
      return this.fail(vars, 'Nodo de espera inválido al reanudar.');
    }
    if (!this.effects.windowOpen()) {
      const closed = this.nextNode(node.id, 'closed');
      this.record(node, 'ventana de 24h cerrada al despertar', 'closed');
      if (closed) return this.walk(closed, vars);
      return { status: 'completed', currentNodeId: null, variables: vars, trace: this.trace };
    }
    const next = this.nextNode(node.id, 'default');
    return this.walk(next, vars);
  }

  // ---------------------------------------------------------------------------

  private async walk(nodeId: string | null, vars: FlowVars): Promise<StepResult> {
    let currentVars = vars;
    let current = nodeId;

    while (current) {
      if (this.steps >= MAX_STEPS) {
        return this.fail(currentVars, `Se superó el máximo de ${MAX_STEPS} pasos (posible bucle).`);
      }
      const node = this.byId.get(current);
      if (!node) {
        return this.fail(currentVars, `Nodo "${current}" no encontrado.`);
      }
      this.steps += 1;

      switch (node.type) {
        case 'message': {
          await this.effects.send(interpolate(node.data.text ?? '', currentVars));
          this.record(node, 'mensaje enviado');
          current = this.nextNode(node.id, 'default');
          break;
        }
        case 'question': {
          await this.effects.send(interpolate(node.data.text ?? '', currentVars));
          this.record(node, 'pregunta enviada');
          return {
            status: 'waiting_input',
            currentNodeId: node.id,
            variables: currentVars,
            trace: this.trace,
          };
        }
        case 'condition': {
          const branch = evaluateCondition(node, currentVars) ? 'true' : 'false';
          this.record(node, `condición: ${branch}`, branch);
          current = this.nextNode(node.id, branch);
          break;
        }
        case 'variable': {
          if (node.data.set_name) {
            currentVars = {
              ...currentVars,
              [node.data.set_name]: interpolate(node.data.set_value ?? '', currentVars),
            };
          }
          this.record(node, `variable ${node.data.set_name ?? ''} asignada`);
          current = this.nextNode(node.id, 'default');
          break;
        }
        case 'tag': {
          if (node.data.tag_id) await this.effects.addTag(node.data.tag_id);
          this.record(node, 'etiqueta aplicada');
          current = this.nextNode(node.id, 'default');
          break;
        }
        case 'ai': {
          const result = await this.effects.ai(node, currentVars);
          if (result.extracted) {
            for (const [k, v] of Object.entries(result.extracted)) {
              if (v != null && v !== '') currentVars = { ...currentVars, [k]: v };
            }
          }
          if (result.intent) currentVars = { ...currentVars, _intent: result.intent };
          if (result.handover) {
            await this.effects.transfer(result.reply ?? null);
            this.record(node, 'IA solicitó handover', 'handover');
            return { status: 'completed', currentNodeId: null, variables: currentVars, trace: this.trace };
          }
          if (result.reply) await this.effects.send(result.reply);
          const branch = node.data.route_by_intent && result.intent ? result.intent : 'default';
          this.record(node, `IA respondió (intención: ${result.intent ?? 'n/a'})`, branch);
          current = this.nextNode(node.id, branch) ?? this.nextNode(node.id, 'default');
          break;
        }
        case 'wait': {
          this.record(node, `esperando ${node.data.seconds ?? 0}s`);
          return {
            status: 'waiting_timer',
            currentNodeId: node.id,
            variables: currentVars,
            trace: this.trace,
            waitSeconds: node.data.seconds ?? 0,
          };
        }
        case 'webhook': {
          try {
            await this.effects.http(node, currentVars);
            this.record(node, 'webhook enviado');
          } catch (err) {
            this.record(node, `webhook falló: ${(err as Error).message}`);
          }
          current = this.nextNode(node.id, 'default');
          break;
        }
        case 'api': {
          try {
            const resp = await this.effects.http(node, currentVars);
            currentVars = applyResponseMap(currentVars, node.data.response_map, resp);
            this.record(node, 'API respondió');
          } catch (err) {
            this.record(node, `API falló: ${(err as Error).message}`, 'error');
          }
          current = this.nextNode(node.id, 'default');
          break;
        }
        case 'transfer': {
          await this.effects.transfer(node.data.note ?? null);
          this.record(node, 'transferido a un agente');
          return { status: 'completed', currentNodeId: null, variables: currentVars, trace: this.trace };
        }
        case 'end': {
          this.record(node, 'fin del flujo');
          return { status: 'completed', currentNodeId: null, variables: currentVars, trace: this.trace };
        }
        case 'start': {
          current = this.nextNode(node.id, 'default');
          break;
        }
        default: {
          return this.fail(currentVars, `Tipo de nodo desconocido: ${(node as FlowNode).type}`);
        }
      }
    }

    // Sin siguiente nodo: rama muerta → fin natural
    return { status: 'completed', currentNodeId: null, variables: currentVars, trace: this.trace };
  }

  private nextNode(sourceId: string, handle: string): string | null {
    const edges = this.graph.edges.filter((e) => e.source === sourceId);
    // 1) coincidencia exacta de handle
    const exact = edges.find((e) => (e.sourceHandle ?? 'default') === handle);
    if (exact) return exact.target;
    // 2) para 'true'/'default' se aceptan salidas sin handle explícito
    if (handle === 'default' || handle === 'true') {
      const fallback = edges.find((e) => !e.sourceHandle || e.sourceHandle === 'default');
      if (fallback) return fallback.target;
    }
    return null;
  }

  private record(node: FlowNode, detail: string, branch?: string): void {
    const entry: FlowTraceEntry = {
      node_id: node.id,
      node_type: node.type,
      at: new Date().toISOString(),
      detail,
      ...(branch ? { branch } : {}),
    };
    this.trace.push(entry);
    this.effects.onStep?.(entry);
  }

  private fail(vars: FlowVars, error: string): StepResult {
    return { status: 'failed', currentNodeId: null, variables: vars, trace: this.trace, error };
  }
}

// ---------------------------------------------------------------------------
// Helpers puros (exportados para tests)
// ---------------------------------------------------------------------------

export function interpolate(template: string, vars: FlowVars): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const value = vars[key];
    return value == null ? '' : String(value);
  });
}

export function validateAnswer(
  type: FlowAnswerType,
  raw: string,
  options?: string[],
): { ok: true; value: unknown; branch: string } | { ok: false } {
  const answer = raw.trim();
  if (!answer) return { ok: false };
  switch (type) {
    case 'text':
      return { ok: true, value: answer, branch: 'default' };
    case 'number': {
      const n = Number(answer.replace(',', '.'));
      return Number.isFinite(n) ? { ok: true, value: n, branch: 'default' } : { ok: false };
    }
    case 'email':
      return EMAIL_RE.test(answer) ? { ok: true, value: answer, branch: 'default' } : { ok: false };
    case 'phone': {
      const digits = answer.replace(/[^\d+]/g, '');
      return digits.replace(/\D/g, '').length >= 7
        ? { ok: true, value: digits, branch: 'default' }
        : { ok: false };
    }
    case 'option': {
      const match = (options ?? []).find((o) => o.toLowerCase() === answer.toLowerCase());
      return match ? { ok: true, value: match, branch: match } : { ok: false };
    }
    default:
      return { ok: true, value: answer, branch: 'default' };
  }
}

export function evaluateCondition(node: FlowNode, vars: FlowVars): boolean {
  const left = node.data.variable ? vars[node.data.variable] : undefined;
  const right = node.data.value ?? '';
  const leftStr = left == null ? '' : String(left);
  switch (node.data.op ?? 'equals') {
    case 'equals':
      return leftStr.toLowerCase() === right.toLowerCase();
    case 'not_equals':
      return leftStr.toLowerCase() !== right.toLowerCase();
    case 'contains':
      return leftStr.toLowerCase().includes(right.toLowerCase());
    case 'gt':
      return Number(left) > Number(right);
    case 'lt':
      return Number(left) < Number(right);
    case 'is_set':
      return left != null && leftStr !== '';
    case 'is_empty':
      return left == null || leftStr === '';
    default:
      return false;
  }
}

/** Mapea campos de una respuesta JSON a variables usando rutas simples "a.b.c". */
export function applyResponseMap(
  vars: FlowVars,
  map: Record<string, string> | undefined,
  response: unknown,
): FlowVars {
  if (!map) return vars;
  const next = { ...vars };
  for (const [varName, path] of Object.entries(map)) {
    next[varName] = getPath(response, path);
  }
  return next;
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}
