import type { Flow, FlowExecution, FlowVersion } from '@prisma/client';
import type {
  FlowDto,
  FlowExecutionDto,
  FlowExecutionStatus,
  FlowGraph,
  FlowStatus,
  FlowTraceEntry,
  FlowTrigger,
  FlowVersionDto,
} from '@wolfiax/shared';

type FlowWithCounts = Flow & {
  _count?: { versions?: number; executions?: number };
  versions?: Array<Pick<FlowVersion, 'version'>>;
};

export function toFlowDto(flow: FlowWithCounts): FlowDto {
  const publishedVersion =
    flow.versions?.find((v) => v.version === maxVersion(flow.versions)) ?? null;
  return {
    id: flow.id,
    name: flow.name,
    description: flow.description,
    channel_id: flow.channelId,
    enabled: flow.enabled,
    status: flow.status as FlowStatus,
    trigger: flow.trigger as unknown as FlowTrigger,
    graph: flow.graph as unknown as FlowGraph,
    published_version: flow.publishedVersionId ? (publishedVersion?.version ?? null) : null,
    version_count: flow._count?.versions ?? flow.versions?.length ?? 0,
    execution_count: flow._count?.executions ?? 0,
    updated_at: flow.updatedAt.toISOString(),
    created_at: flow.createdAt.toISOString(),
  };
}

function maxVersion(versions?: Array<Pick<FlowVersion, 'version'>>): number {
  return versions && versions.length ? Math.max(...versions.map((v) => v.version)) : 0;
}

export function toFlowVersionDto(version: FlowVersion): FlowVersionDto {
  return {
    id: version.id,
    version: version.version,
    graph: version.graph as unknown as FlowGraph,
    trigger: version.trigger as unknown as FlowTrigger,
    created_at: version.createdAt.toISOString(),
  };
}

export function toFlowExecutionDto(
  exec: FlowExecution & { flow?: { name: string }; contact?: { name: string | null; username: string | null } },
): FlowExecutionDto {
  return {
    id: exec.id,
    flow_id: exec.flowId,
    flow_name: exec.flow?.name ?? '',
    conversation_id: exec.conversationId,
    contact_name: exec.contact?.name ?? exec.contact?.username ?? null,
    status: exec.status as FlowExecutionStatus,
    current_node_id: exec.currentNodeId,
    variables: exec.variables as Record<string, unknown>,
    steps: exec.steps,
    trace: exec.trace as unknown as FlowTraceEntry[],
    error: exec.error,
    wake_at: exec.wakeAt?.toISOString() ?? null,
    started_at: exec.startedAt.toISOString(),
    ended_at: exec.endedAt?.toISOString() ?? null,
  };
}
