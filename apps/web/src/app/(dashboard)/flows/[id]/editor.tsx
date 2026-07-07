'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FLOW_NODE_TYPES,
  type FlowDto,
  type FlowGraph,
  type FlowNodeData,
  type FlowNodeType,
  type FlowTrigger,
  type FlowValidationResult,
} from '@wolfiax/shared';
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlertTriangle, ArrowLeft, CheckCircle2, Save, Send, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { FLOW_NODE_META, PALETTE_NODES } from '@/lib/flow-meta';
import { useAuth } from '@/lib/auth-context';
import { ConfigPanel } from './config-panel';
import { FlowNodeCard } from './flow-node';
import { SimulatePanel } from './simulate-panel';

// React Flow exige data: Record<string, unknown>; adaptamos FlowNodeData en los bordes.
type RFData = FlowNodeData & Record<string, unknown>;
type RFNode = Node<RFData>;

let nodeSeq = 0;
function newNodeId(type: string): string {
  nodeSeq += 1;
  return `${type}_${Date.now().toString(36)}_${nodeSeq}`;
}

export function FlowEditor({ flow }: { flow: FlowDto }) {
  return (
    <ReactFlowProvider>
      <EditorInner flow={flow} />
    </ReactFlowProvider>
  );
}

function EditorInner({ flow }: { flow: FlowDto }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { me } = useAuth();
  const canManage = me?.current_role === 'owner' || me?.current_role === 'admin';

  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(
    flow.graph.nodes as unknown as RFNode[],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(flow.graph.edges as Edge[]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<FlowTrigger>(flow.trigger);
  const [dirty, setDirty] = useState(false);
  const [validation, setValidation] = useState<FlowValidationResult | null>(null);
  const [showSim, setShowSim] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const markDirty = useCallback(() => {
    setDirty(true);
    setValidation(null);
  }, []);

  const nodeTypes = useMemo(
    () =>
      Object.fromEntries(
        FLOW_NODE_TYPES.map((t) => [
          t,
          (props: NodeProps) => <FlowNodeCard {...props} type={t as FlowNodeType} />,
        ]),
      ),
    [],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      setEdges((eds) => addEdge({ ...conn, id: `e_${conn.source}_${conn.target}_${Date.now()}` }, eds));
      markDirty();
    },
    [setEdges, markDirty],
  );

  const addNode = useCallback(
    (type: FlowNodeType) => {
      const meta = FLOW_NODE_META[type];
      const id = newNodeId(type);
      const node: RFNode = {
        id,
        type,
        position: { x: 320 + Math.random() * 120, y: 120 + nodes.length * 30 },
        data: { ...meta.defaultData } as RFData,
      };
      setNodes((nds) => [...nds, node]);
      setSelectedId(id);
      markDirty();
    },
    [nodes.length, setNodes, markDirty],
  );

  const updateNodeData = useCallback(
    (id: string, data: FlowNodeData) => {
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: data as RFData } : n)));
      markDirty();
    },
    [setNodes, markDirty],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedId(null);
      markDirty();
    },
    [setNodes, setEdges, markDirty],
  );

  const currentGraph = useCallback(
    (): FlowGraph => ({
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type as FlowNodeType,
        position: n.position,
        data: n.data,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
      })),
    }),
    [nodes, edges],
  );

  const save = useMutation({
    mutationFn: () => api.patch<FlowDto>(`/flows/${flow.id}`, { graph: currentGraph(), trigger }),
    onSuccess: () => {
      setDirty(false);
      setBanner({ tone: 'ok', text: 'Borrador guardado.' });
      void qc.invalidateQueries({ queryKey: ['flows'] });
    },
    onError: (err) => setBanner({ tone: 'err', text: err instanceof ApiError ? err.message : 'Error al guardar.' }),
  });

  const validate = useMutation({
    mutationFn: () => api.post<FlowValidationResult>(`/flows/${flow.id}/validate`, { graph: currentGraph() }),
    onSuccess: (r) => setValidation(r),
  });

  const publish = useMutation({
    mutationFn: async () => {
      await api.patch(`/flows/${flow.id}`, { graph: currentGraph(), trigger });
      return api.post<FlowDto>(`/flows/${flow.id}/publish`);
    },
    onSuccess: () => {
      setDirty(false);
      setBanner({ tone: 'ok', text: 'Flujo publicado y activado.' });
      void qc.invalidateQueries({ queryKey: ['flows'] });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'No se pudo publicar.';
      setBanner({ tone: 'err', text: msg });
      if (err instanceof ApiError) validate.mutate();
    },
  });

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="fixed inset-0 left-64 flex flex-col bg-neutral-50">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => router.push('/flows')}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-sm font-semibold">
            {flow.name}
            {flow.status === 'published' ? (
              <Badge tone="agent">publicado v{flow.published_version}</Badge>
            ) : (
              <Badge>borrador</Badge>
            )}
            {dirty && <span className="text-xs font-normal text-amber-600">· sin guardar</span>}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2 py-1">
            <span className="text-xs text-neutral-500">Disparador</span>
            <Select
              className="h-7 border-0 py-0 text-xs"
              value={trigger.type}
              onChange={(e) => {
                const type = e.target.value as FlowTrigger['type'];
                setTrigger(type === 'keyword' ? { type, keywords: [] } : ({ type } as FlowTrigger));
                markDirty();
              }}
            >
              <option value="manual">Manual</option>
              <option value="new_contact">Cliente nuevo</option>
              <option value="keyword">Palabra clave</option>
              <option value="any_message">Cualquier mensaje</option>
            </Select>
            {trigger.type === 'keyword' && (
              <Input
                className="h-7 w-40 py-0 text-xs"
                placeholder="hola, info"
                defaultValue={trigger.keywords.join(', ')}
                onChange={(e) => {
                  setTrigger({
                    type: 'keyword',
                    keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean),
                  });
                  markDirty();
                }}
              />
            )}
          </div>

          <Button variant="secondary" size="sm" onClick={() => setShowSim((s) => !s)}>
            <Send className="size-4" /> Probar
          </Button>
          {canManage && (
            <>
              <Button variant="secondary" size="sm" loading={validate.isPending} onClick={() => validate.mutate()}>
                <CheckCircle2 className="size-4" /> Validar
              </Button>
              <Button variant="secondary" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
                <Save className="size-4" /> Guardar
              </Button>
              <Button size="sm" loading={publish.isPending} onClick={() => publish.mutate()}>
                <Upload className="size-4" /> Publicar
              </Button>
            </>
          )}
        </div>
      </div>

      {banner && (
        <div
          className={cn(
            'flex items-center justify-between px-4 py-1.5 text-xs',
            banner.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
          )}
        >
          {banner.text}
          <button onClick={() => setBanner(null)} className="opacity-60 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {validation && !validation.valid && (
        <div className="max-h-28 overflow-y-auto border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <p className="mb-1 flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-3.5" /> {validation.issues.length} problema(s) por corregir:
          </p>
          <ul className="list-inside list-disc space-y-0.5">
            {validation.issues.map((i, idx) => (
              <li key={idx}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}
      {validation?.valid && (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-1.5 text-xs text-emerald-700">
          <CheckCircle2 className="mr-1 inline size-3.5" /> El flujo es válido y se puede publicar.
        </div>
      )}

      {/* Cuerpo: paleta + canvas + panel */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-44 space-y-1 overflow-y-auto border-r border-neutral-200 bg-white p-2">
          <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
            Nodos
          </p>
          {PALETTE_NODES.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.type}
                onClick={() => addNode(m.type)}
                disabled={!canManage}
                className="flex w-full items-start gap-2 rounded-lg border border-neutral-100 px-2 py-1.5 text-left hover:border-brand-200 hover:bg-brand-50 disabled:opacity-50"
                title={m.description}
              >
                <span className={cn('mt-0.5 rounded p-1', m.bg)}>
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium">{m.label}</span>
                  <span className="block truncate text-[10px] text-neutral-400">{m.description}</span>
                </span>
              </button>
            );
          })}
        </aside>

        <div className="relative flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable className="!bg-neutral-100" />
          </ReactFlow>
        </div>

        {selectedNode && !showSim && (
          <ConfigPanel
            node={{
              id: selectedNode.id,
              type: selectedNode.type as FlowNodeType,
              position: selectedNode.position,
              data: selectedNode.data,
            }}
            onChange={(data) => updateNodeData(selectedNode.id, data)}
            onDelete={() => deleteNode(selectedNode.id)}
            onClose={() => setSelectedId(null)}
          />
        )}
        {showSim && <SimulatePanel flowId={flow.id} graph={currentGraph()} />}
      </div>
    </div>
  );
}

function cn(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
