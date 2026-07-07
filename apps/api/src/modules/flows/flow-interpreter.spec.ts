import type { FlowGraph, FlowNode } from '@wolfiax/shared';
import {
  evaluateCondition,
  FlowInterpreter,
  interpolate,
  validateAnswer,
  type FlowAiResult,
  type FlowEffects,
} from './flow-interpreter';

function makeEffects(overrides: Partial<FlowEffects> = {}) {
  const sent: string[] = [];
  const tags: string[] = [];
  const transfers: (string | null)[] = [];
  const effects: FlowEffects = {
    send: (t) => void sent.push(t),
    addTag: (id) => void tags.push(id),
    transfer: (note) => void transfers.push(note),
    http: () => ({ ok: true }),
    windowOpen: () => true,
    ai: (): FlowAiResult => ({
      reply: '[ia]',
      intent: null,
      confidence: 0.9,
      handover: false,
      extracted: {},
    }),
    ...overrides,
  };
  return { effects, sent, tags, transfers };
}

describe('helpers', () => {
  it('interpola variables {{ }}', () => {
    expect(interpolate('Hola {{nombre}}', { nombre: 'Ana' })).toBe('Hola Ana');
    expect(interpolate('Hola {{falta}}', {})).toBe('Hola ');
  });

  it('valida respuestas por tipo', () => {
    expect(validateAnswer('number', '12,5', undefined)).toEqual({ ok: true, value: 12.5, branch: 'default' });
    expect(validateAnswer('number', 'abc', undefined)).toEqual({ ok: false });
    expect(validateAnswer('email', 'a@b.com', undefined).ok).toBe(true);
    expect(validateAnswer('email', 'nope', undefined).ok).toBe(false);
    expect(validateAnswer('option', 'sí', ['Sí', 'No'])).toEqual({ ok: true, value: 'Sí', branch: 'Sí' });
    expect(validateAnswer('option', 'quizá', ['Sí', 'No']).ok).toBe(false);
  });

  it('evalúa condiciones', () => {
    const node = (data: FlowNode['data']): FlowNode => ({ id: 'c', type: 'condition', position: { x: 0, y: 0 }, data });
    expect(evaluateCondition(node({ variable: 'v', op: 'is_set' }), { v: 'x' })).toBe(true);
    expect(evaluateCondition(node({ variable: 'v', op: 'is_set' }), {})).toBe(false);
    expect(evaluateCondition(node({ variable: 'v', op: 'equals', value: 'Sí' }), { v: 'sí' })).toBe(true);
    expect(evaluateCondition(node({ variable: 'n', op: 'gt', value: '5' }), { n: 8 })).toBe(true);
  });
});

// Criterio de aceptación F4: bienvenida → pregunta → rama por respuesta → IA → transferir
const criterionGraph: FlowGraph = {
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
    { id: 'welcome', type: 'message', position: { x: 0, y: 0 }, data: { text: 'Bienvenido {{contact_name}}' } },
    {
      id: 'q',
      type: 'question',
      position: { x: 0, y: 0 },
      data: { text: '¿Eres cliente? (sí/no)', answer_type: 'option', options: ['sí', 'no'], save_as: 'es_cliente' },
    },
    { id: 'ai', type: 'ai', position: { x: 0, y: 0 }, data: {} },
    { id: 'bye', type: 'message', position: { x: 0, y: 0 }, data: { text: 'Gracias, hasta luego' } },
    { id: 'transfer', type: 'transfer', position: { x: 0, y: 0 }, data: { note: 'cliente existente' } },
    { id: 'end', type: 'end', position: { x: 0, y: 0 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'welcome' },
    { id: 'e2', source: 'welcome', target: 'q' },
    { id: 'e3', source: 'q', target: 'ai', sourceHandle: 'sí' },
    { id: 'e4', source: 'q', target: 'bye', sourceHandle: 'no' },
    { id: 'e5', source: 'ai', target: 'transfer' },
    { id: 'e6', source: 'bye', target: 'end' },
  ],
};

describe('FlowInterpreter — criterio de aceptación', () => {
  it('bienvenida → pregunta y queda esperando input', async () => {
    const { effects, sent } = makeEffects();
    const interp = new FlowInterpreter(criterionGraph, effects);
    const res = await interp.start({ contact_name: 'Ana' });
    expect(sent[0]).toBe('Bienvenido Ana');
    expect(sent[1]).toBe('¿Eres cliente? (sí/no)');
    expect(res.status).toBe('waiting_input');
    expect(res.currentNodeId).toBe('q');
  });

  it('rama "sí" → IA responde → transfiere a humano', async () => {
    const { effects, sent, transfers } = makeEffects();
    const interp = new FlowInterpreter(criterionGraph, effects);
    const res = await interp.resumeWithAnswer('q', 'sí', { contact_name: 'Ana' });
    expect(res.variables.es_cliente).toBe('sí');
    expect(sent).toContain('[ia]'); // respuesta de la IA
    expect(transfers.length).toBe(1);
    expect(res.status).toBe('completed');
  });

  it('rama "no" → despedida → fin', async () => {
    const { effects, sent, transfers } = makeEffects();
    const interp = new FlowInterpreter(criterionGraph, effects);
    const res = await interp.resumeWithAnswer('q', 'no', { contact_name: 'Ana' });
    expect(sent).toContain('Gracias, hasta luego');
    expect(transfers.length).toBe(0);
    expect(res.status).toBe('completed');
  });

  it('respuesta inválida no avanza y reintenta', async () => {
    const { effects, sent } = makeEffects();
    const interp = new FlowInterpreter(criterionGraph, effects);
    const res = await interp.resumeWithAnswer('q', 'quizá', {});
    expect(res.status).toBe('waiting_input');
    expect(res.currentNodeId).toBe('q');
    expect(sent.some((s) => /repet/i.test(s))).toBe(true);
  });

  it('IA con handover transfiere sin seguir la rama normal', async () => {
    const { effects, transfers } = makeEffects({
      ai: () => ({ reply: 'te paso con un agente', intent: null, confidence: 0.2, handover: true, extracted: {} }),
    });
    const interp = new FlowInterpreter(criterionGraph, effects);
    const res = await interp.resumeWithAnswer('q', 'sí', {});
    expect(transfers).toEqual(['te paso con un agente']);
    expect(res.status).toBe('completed');
  });
});

describe('FlowInterpreter — esperas y ventana 24h', () => {
  const waitGraph: FlowGraph = {
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'w', type: 'wait', position: { x: 0, y: 0 }, data: { seconds: 3600 } },
      { id: 'after', type: 'message', position: { x: 0, y: 0 }, data: { text: 'seguimos' } },
      { id: 'closed', type: 'message', position: { x: 0, y: 0 }, data: { text: 'ventana cerrada' } },
      { id: 'end', type: 'end', position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'w' },
      { id: 'e2', source: 'w', target: 'after', sourceHandle: 'default' },
      { id: 'e3', source: 'w', target: 'closed', sourceHandle: 'closed' },
      { id: 'e4', source: 'after', target: 'end' },
      { id: 'e5', source: 'closed', target: 'end' },
    ],
  };

  it('el nodo esperar suspende con waiting_timer', async () => {
    const { effects } = makeEffects();
    const interp = new FlowInterpreter(waitGraph, effects);
    const res = await interp.start({});
    expect(res.status).toBe('waiting_timer');
    expect(res.waitSeconds).toBe(3600);
    expect(res.currentNodeId).toBe('w');
  });

  it('al despertar con ventana abierta continúa', async () => {
    const { effects, sent } = makeEffects({ windowOpen: () => true });
    const interp = new FlowInterpreter(waitGraph, effects);
    const res = await interp.resumeAfterWait('w', {});
    expect(sent).toContain('seguimos');
    expect(res.status).toBe('completed');
  });

  it('al despertar con ventana cerrada toma la rama "closed" y nunca envía "seguimos"', async () => {
    const { effects, sent } = makeEffects({ windowOpen: () => false });
    const interp = new FlowInterpreter(waitGraph, effects);
    const res = await interp.resumeAfterWait('w', {});
    expect(sent).toContain('ventana cerrada');
    expect(sent).not.toContain('seguimos');
    expect(res.status).toBe('completed');
  });
});

describe('FlowInterpreter — anti-bucle', () => {
  it('corta un ciclo infinito con status failed', async () => {
    const loop: FlowGraph = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'a', type: 'variable', position: { x: 0, y: 0 }, data: { set_name: 'x', set_value: '1' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'a' },
        { id: 'e2', source: 'a', target: 'a' },
      ],
    };
    const { effects } = makeEffects();
    const interp = new FlowInterpreter(loop, effects);
    const res = await interp.start({});
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/bucle|pasos/i);
  });
});
