import type { FlowGraph } from '@wolfiax/shared';
import { validateGraph } from './flow-graph.schema';

const base = (): FlowGraph => ({
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
    { id: 'm', type: 'message', position: { x: 0, y: 0 }, data: { text: 'hola' } },
    { id: 'end', type: 'end', position: { x: 0, y: 0 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'm' },
    { id: 'e2', source: 'm', target: 'end' },
  ],
});

describe('validateGraph', () => {
  it('acepta un flujo simple y conexo', () => {
    expect(validateGraph(base())).toEqual([]);
  });

  it('exige un nodo de inicio', () => {
    const g = base();
    g.nodes = g.nodes.filter((n) => n.type !== 'start');
    expect(validateGraph(g).some((i) => i.code === 'NO_START')).toBe(true);
  });

  it('detecta nodos inalcanzables', () => {
    const g = base();
    g.nodes.push({ id: 'orphan', type: 'message', position: { x: 0, y: 0 }, data: { text: 'x' } });
    g.edges.push({ id: 'e3', source: 'orphan', target: 'end' });
    expect(validateGraph(g).some((i) => i.code === 'UNREACHABLE')).toBe(true);
  });

  it('exige texto en mensajes y continuación', () => {
    const g = base();
    g.nodes[1].data = {};
    const issues = validateGraph(g);
    expect(issues.some((i) => i.code === 'MESSAGE_NO_TEXT')).toBe(true);
  });

  it('exige que las opciones de una pregunta tengan rama', () => {
    const g: FlowGraph = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'q',
          type: 'question',
          position: { x: 0, y: 0 },
          data: { text: '¿?', answer_type: 'option', options: ['a', 'b'] },
        },
        { id: 'end', type: 'end', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'q' },
        { id: 'e2', source: 'q', target: 'end', sourceHandle: 'a' },
      ],
    };
    expect(validateGraph(g).some((i) => i.code === 'OPTION_NO_BRANCH')).toBe(true);
  });
});
