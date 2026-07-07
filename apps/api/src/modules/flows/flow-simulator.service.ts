import { Injectable, Logger } from '@nestjs/common';
import type {
  FlowGraph,
  FlowNode,
  FlowSimulationResult,
  FlowSimulationStep,
  FlowTraceEntry,
} from '@wolfiax/shared';
import { AiClientService } from '../ai/ai-client.service';
import { FlowInterpreter, type FlowEffects, type FlowVars, type StepResult } from './flow-interpreter';

/**
 * Sandbox de simulación (F4): ejecuta el grafo sin enviar nada real ni tocar la
 * conversación. Los nodos de espera se saltan (no bloquean la prueba) y la IA
 * usa el ai-service si está disponible, con respuesta simulada si falla.
 */
@Injectable()
export class FlowSimulatorService {
  private readonly logger = new Logger(FlowSimulatorService.name);

  constructor(private readonly ai: AiClientService) {}

  async simulate(
    orgId: string,
    graph: FlowGraph,
    userMessages: string[],
  ): Promise<FlowSimulationResult> {
    const steps: FlowSimulationStep[] = [];
    let vars: FlowVars = { contact_name: 'Contacto de prueba' };
    const pendingSends: string[] = [];
    let consumed = 0;

    const effects: FlowEffects = {
      send: (text) => {
        pendingSends.push(text);
      },
      addTag: () => {},
      transfer: () => {},
      http: () => ({}),
      windowOpen: () => true, // en simulación la ventana se considera abierta
      ai: async (node: FlowNode) => {
        try {
          const last = String(vars.last_message ?? '');
          const res = await this.ai.reply({
            organization_id: orgId,
            profile: {
              system_prompt: node.data.prompt ?? '',
              tone: 'professional',
              language_policy: 'mirror',
              disclosure_message: '',
              confidence_threshold: 0.35,
              business_hours: null,
              guardrails: {},
              handover_keywords: [],
            },
            message: node.data.prompt ? `${node.data.prompt}\n\n${last}` : last,
            history: [],
            include_disclosure: false,
          });
          return {
            reply: res.reply,
            intent: res.intent,
            confidence: res.confidence,
            handover: res.handover,
            extracted: res.extracted ?? {},
          };
        } catch (err) {
          this.logger.warn(`Simulación IA sin ai-service: ${(err as Error).message}`);
          return {
            reply: '[respuesta simulada de la IA]',
            intent: null,
            confidence: 0.5,
            handover: false,
            extracted: {},
          };
        }
      },
      onStep: (entry: FlowTraceEntry) => {
        const step = mapStep(entry, vars);
        if (pendingSends.length > consumed) {
          step.output = pendingSends[pendingSends.length - 1];
          consumed = pendingSends.length;
        }
        steps.push(step);
      },
    };

    let interpreter = new FlowInterpreter(graph, effects, 0);
    let result: StepResult = await interpreter.start(vars);
    vars = result.variables;

    // Consume los mensajes del usuario mientras el flujo espere input
    for (const msg of userMessages) {
      if (result.status !== 'waiting_input' || !result.currentNodeId) break;
      vars = { ...vars, last_message: msg };
      interpreter = new FlowInterpreter(graph, effects, result.status === 'waiting_input' ? 0 : 0);
      result = await interpreter.resumeWithAnswer(result.currentNodeId, msg, vars);
      vars = result.variables;
    }

    // Rellena las variables finales en cada paso (snapshot al terminar)
    for (const s of steps) s.variables = vars;

    return {
      steps,
      status: result.status,
      awaiting_input: result.status === 'waiting_input',
    };
  }
}

function mapStep(entry: FlowTraceEntry, vars: FlowVars): FlowSimulationStep {
  const kindByType: Record<string, FlowSimulationStep['kind']> = {
    message: 'send',
    question: 'wait_input',
    ai: 'ai',
    transfer: 'transfer',
    end: 'end',
    wait: 'wait_timer',
    condition: 'action',
    variable: 'action',
    tag: 'action',
    webhook: 'action',
    api: 'action',
    start: 'action',
  };
  return {
    node_id: entry.node_id,
    node_type: entry.node_type,
    kind: kindByType[entry.node_type] ?? 'action',
    branch: entry.branch,
    variables: vars,
  };
}
