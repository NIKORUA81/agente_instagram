import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Channel, Contact, Conversation, FlowExecution } from '@prisma/client';
import { WS_EVENTS, type FlowGraph, type FlowNode, type FlowTraceEntry } from '@wolfiax/shared';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QUEUE_FLOW } from '../../common/queue/queue.module';
import { AiClientService } from '../ai/ai-client.service';
import { toConversationDto } from '../inbox/inbox.mappers';
import { isWindowOpen, MessagingService } from '../messaging/messaging.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  FlowInterpreter,
  interpolate,
  type FlowEffects,
  type FlowVars,
  type StepResult,
} from './flow-interpreter';
import { toFlowExecutionDto } from './flows.mappers';

const HISTORY_LIMIT = 8;

type ConversationWithContact = Conversation & { contact: Contact };

export interface StartFlowInput {
  flowId: string;
  flowVersionId: string;
  graph: FlowGraph;
  channel: Channel;
  conversation: ConversationWithContact;
  initialText?: string;
}

/**
 * Orquesta la ejecución de flujos (F4): persiste el estado en `flow_executions`
 * y conecta el intérprete a messaging / ai-service / timers BullMQ. Un flujo
 * nunca vive en memoria: cada suspensión (pregunta/espera) queda en la BD y se
 * reanuda desde ahí.
 */
@Injectable()
export class FlowEngineService {
  private readonly logger = new Logger(FlowEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly ai: AiClientService,
    private readonly gateway: RealtimeGateway,
    @Inject(QUEUE_FLOW) private readonly flowQueue: Queue,
  ) {}

  /** ¿Hay una ejecución suspendida esperando el próximo mensaje del contacto? */
  async findWaitingInput(orgId: string, conversationId: string): Promise<FlowExecution | null> {
    return this.prisma.withTenant(orgId, (tx) =>
      tx.flowExecution.findFirst({
        where: { conversationId, status: 'waiting_input' },
        orderBy: { startedAt: 'desc' },
      }),
    );
  }

  async startFlow(input: StartFlowInput): Promise<FlowExecution> {
    const orgId = input.channel.organizationId;
    const execution = await this.prisma.withTenant(orgId, (tx) =>
      tx.flowExecution.create({
        data: {
          organizationId: orgId,
          flowId: input.flowId,
          flowVersionId: input.flowVersionId,
          conversationId: input.conversation.id,
          contactId: input.conversation.contactId,
          status: 'running',
          variables: initialVars(input),
        },
      }),
    );

    const interpreter = new FlowInterpreter(input.graph, this.effects(input.conversation, input.channel), 0);
    const result = await interpreter.start(execution.variables as FlowVars);
    await this.commit(orgId, execution.id, input.conversation, result, interpreter.stepCount, []);
    return execution;
  }

  /** Reanuda una ejecución en espera de respuesta con el texto entrante. */
  async resumeWithMessage(
    execution: FlowExecution,
    conversation: ConversationWithContact,
    channel: Channel,
    text: string,
  ): Promise<void> {
    if (!execution.currentNodeId) return;
    const graph = await this.loadGraph(execution);
    if (!graph) return;
    const interpreter = new FlowInterpreter(graph, this.effects(conversation, channel), execution.steps);
    const result = await interpreter.resumeWithAnswer(
      execution.currentNodeId,
      text,
      execution.variables as FlowVars,
    );
    await this.commit(
      channel.organizationId,
      execution.id,
      conversation,
      result,
      interpreter.stepCount,
      execution.trace as unknown as FlowTraceEntry[],
    );
  }

  /** Despierta una ejecución en espera de timer (job BullMQ retrasado). */
  async wake(executionId: string): Promise<void> {
    const execution = await this.prisma.withSystem((tx) =>
      tx.flowExecution.findUnique({ where: { id: executionId } }),
    );
    if (!execution || execution.status !== 'waiting_timer' || !execution.currentNodeId) return;
    const orgId = execution.organizationId;

    const conversation = await this.prisma.withTenant(orgId, (tx) =>
      tx.conversation.findUnique({ where: { id: execution.conversationId }, include: { contact: true } }),
    );
    const channel = await this.prisma.withSystem((tx) =>
      tx.channel.findUnique({ where: { id: conversation?.channelId ?? '' } }),
    );
    if (!conversation || !channel) return;

    const graph = await this.loadGraph(execution);
    if (!graph) return;
    const interpreter = new FlowInterpreter(graph, this.effects(conversation, channel), execution.steps);
    const result = await interpreter.resumeAfterWait(
      execution.currentNodeId,
      execution.variables as FlowVars,
    );
    await this.commit(
      orgId,
      execution.id,
      conversation,
      result,
      interpreter.stepCount,
      execution.trace as unknown as FlowTraceEntry[],
    );
  }

  // ---------------------------------------------------------------------------

  private async loadGraph(execution: FlowExecution): Promise<FlowGraph | null> {
    const version = await this.prisma.withTenant(execution.organizationId, (tx) =>
      tx.flowVersion.findUnique({ where: { id: execution.flowVersionId } }),
    );
    return version ? (version.graph as unknown as FlowGraph) : null;
  }

  /** Persiste el resultado de un segmento y agenda el timer si corresponde. */
  private async commit(
    orgId: string,
    executionId: string,
    conversation: ConversationWithContact,
    result: StepResult,
    steps: number,
    priorTrace: FlowTraceEntry[],
  ): Promise<void> {
    const trace = [...priorTrace, ...result.trace];
    const ended = ['completed', 'failed', 'aborted'].includes(result.status);
    const wakeAt =
      result.status === 'waiting_timer' && result.waitSeconds
        ? new Date(Date.now() + result.waitSeconds * 1000)
        : null;

    const updated = await this.prisma.withTenant(orgId, (tx) =>
      tx.flowExecution.update({
        where: { id: executionId },
        data: {
          status: result.status,
          currentNodeId: result.currentNodeId,
          variables: result.variables as object,
          trace: trace as unknown as object,
          steps,
          error: result.error ?? null,
          wakeAt,
          endedAt: ended ? new Date() : null,
        },
        include: { flow: { select: { name: true } }, contact: { select: { name: true, username: true } } },
      }),
    );

    if (wakeAt && result.waitSeconds) {
      await this.flowQueue.add(
        'wake',
        { executionId },
        { delay: result.waitSeconds * 1000, jobId: `wake:${executionId}:${Date.now()}` },
      );
    }

    this.gateway.emitToOrg(orgId, WS_EVENTS.FLOW_EXECUTION, {
      conversation_id: conversation.id,
      execution: toFlowExecutionDto(updated),
    });
    if (result.error) {
      this.logger.error(`Ejecución ${executionId} falló: ${result.error}`);
    }
  }

  /** Efectos reales conectados a messaging / ai-service / conversación. */
  private effects(conversation: ConversationWithContact, channel: Channel): FlowEffects {
    const orgId = channel.organizationId;
    return {
      send: async (text: string) => {
        if (text.trim()) await this.messaging.sendAsFlow(conversation, text);
      },
      addTag: async (tagId: string) => {
        await this.prisma.withTenant(orgId, async (tx) => {
          const tag = await tx.tag.findFirst({ where: { id: tagId, organizationId: orgId } });
          if (!tag) return;
          await tx.conversationTag.upsert({
            where: { conversationId_tagId: { conversationId: conversation.id, tagId: tag.id } },
            create: { conversationId: conversation.id, tagId: tag.id, organizationId: orgId },
            update: {},
          });
        });
      },
      ai: async (node: FlowNode, _vars: FlowVars) => {
        const profile = await this.prisma.withTenant(orgId, (tx) =>
          tx.aiProfile.findUnique({ where: { channelId: channel.id } }),
        );
        const history = await this.prisma.withTenant(orgId, (tx) =>
          tx.message.findMany({
            where: { conversationId: conversation.id, type: 'text' },
            orderBy: { createdAt: 'desc' },
            take: HISTORY_LIMIT,
            select: { direction: true, text: true },
          }),
        );
        const lastUser = history.find((h) => h.direction === 'inbound')?.text ?? '';
        const res = await this.ai.reply({
          organization_id: orgId,
          profile: {
            system_prompt: [profile?.systemPrompt ?? '', node.data.prompt ?? ''].filter(Boolean).join('\n\n'),
            tone: profile?.tone ?? 'professional',
            language_policy: profile?.languagePolicy ?? 'mirror',
            disclosure_message: profile?.disclosureMessage ?? '',
            confidence_threshold: profile?.confidenceThreshold ?? 0.35,
            business_hours: profile?.businessHours ?? null,
            guardrails: profile?.guardrails ?? {},
            handover_keywords: profile?.handoverKeywords ?? [],
          },
          message: node.data.prompt ? `${node.data.prompt}\n\n${lastUser}` : lastUser,
          history: history
            .reverse()
            .filter((h) => h.text)
            .map((h) => ({ role: h.direction === 'inbound' ? 'user' : 'assistant', text: h.text! }) as const),
          contact_name: conversation.contact.name ?? conversation.contact.username,
          include_disclosure: false,
        });
        return {
          reply: res.reply,
          intent: res.intent,
          confidence: res.confidence,
          handover: res.handover,
          extracted: res.extracted ?? {},
        };
      },
      http: (node: FlowNode, httpVars: FlowVars) => callHttp(node, httpVars),
      transfer: async (note: string | null) => {
        const updated = await this.prisma.withTenant(orgId, (tx) =>
          tx.conversation.update({
            where: { id: conversation.id },
            data: { mode: 'human', status: 'pending' },
            include: {
              contact: true,
              tags: { include: { tag: true } },
              messages: { orderBy: { createdAt: 'desc' }, take: 1 },
            },
          }),
        );
        await this.prisma.withTenant(orgId, (tx) =>
          tx.message.create({
            data: {
              organizationId: orgId,
              conversationId: conversation.id,
              direction: 'outbound',
              source: 'system',
              type: 'text',
              status: 'received',
              text: `🔀 Flujo transfirió a un agente${note ? `: ${note}` : '.'}`,
            },
          }),
        );
        this.gateway.emitToOrg(orgId, WS_EVENTS.CONVERSATION_UPDATED, toConversationDto(updated));
      },
      windowOpen: () => isWindowOpen(conversation),
    };
  }
}

function initialVars(input: StartFlowInput): object {
  return {
    contact_name: input.conversation.contact.name ?? input.conversation.contact.username ?? '',
    ...(input.initialText ? { last_message: input.initialText } : {}),
  };
}

/** Llamada HTTP saliente para nodos webhook/api (timeout 10s, sanitizada). */
export async function callHttp(node: FlowNode, vars: FlowVars): Promise<unknown> {
  const url = interpolate(node.data.url ?? '', vars);
  if (!/^https?:\/\//.test(url)) throw new Error('URL inválida');
  const method = node.data.method ?? 'POST';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(node.data.headers ?? {}) };
  const body =
    method === 'GET' || method === 'DELETE' ? undefined : interpolate(node.data.body ?? '{}', vars);
  const res = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 2000) };
  }
}
