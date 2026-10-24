import { describe, expect, it } from 'vitest';
import { FLOW_HOST, HARVESTER_CLASS, parseText, type CpuProfile } from '@wst/engine';
import { cpuLines } from '../src/cpuPanel';
import { FlowDocument } from '../src/flow/FlowDocument';
import { buildGraph, handlerWorstCase } from '../src/flow/graphModel';
import { emptyScratch, type Program } from '../src/flow/graphOps';

const SAMPLE = `on(Arrived, () => {
  if (hp() < 50) {
    fire(-1);
  }
  stop();
});
`;

const program = (text: string): Program => {
  const { doc, errors } = parseText(text, FLOW_HOST);
  expect(errors.map((e) => e.message)).toEqual([]);
  return { doc, scratch: emptyScratch };
};

describe('cost feedback in the graph', () => {
  it('event blocks and block cards show their worst-case cost', () => {
    const p = program(SAMPLE);
    const g = buildGraph(p, FLOW_HOST);
    const event = g.nodes.find((n) => n.kind === 'event')!;
    expect(event.worst).toBe(handlerWorstCase(p.doc.handlers[0], FLOW_HOST));
    expect(event.worst).toBeGreaterThan(0);
    const blocks = buildGraph(program(HARVESTER_CLASS.text!), FLOW_HOST).nodes.filter((n) => n.kind === 'block');
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect(b.worst, b.title).toBeGreaterThan(0);
  });

  it('a heat map marks how often nodes and execution wires ran, scaled to the busiest', () => {
    const p = program(SAMPLE);
    const [branch, say] = p.doc.handlers[0].body;
    const inner = branch.k === 'if' ? branch.then[0] : branch;
    const heat = new Map([[p.doc.handlers[0].id, 4], [branch.id, 4], [say.id, 4], [inner.id, 1]]);
    const g = buildGraph(p, FLOW_HOST, new Map(), heat);
    const node = (id: string) => g.nodes.find((n) => n.id === id)!;
    expect([node(branch.id).hits, node(branch.id).heat, node(inner.id).hits, node(inner.id).heat]).toEqual([4, 1, 1, 0.25]);
    const into = g.edges.find((e) => e.type === 'exec' && e.to.node === inner.id)!;
    expect([into.hits, into.heat]).toEqual([1, 0.25]);
    // Without a test run nothing carries heat.
    expect(buildGraph(p, FLOW_HOST).nodes.some((n) => n.hits !== undefined)).toBe(false);
  });

  it('the heat map is dropped when the program changes, but not when nodes move', () => {
    const d = new FlowDocument(FLOW_HOST);
    d.loadText(SAMPLE);
    d.setHeat(new Map([['x', 1]]));
    d.setViews({ graph: { pos: { a: [1, 2] } } });
    expect(d.heat?.get('x')).toBe(1);
    d.setText(SAMPLE.replace('50', '40'));
    expect(d.heat).toBeNull();
  });
});

describe('CPU panel', () => {
  const profile = (cycles: number[], runs: number[], dropped = 0): CpuProfile => ({
    handlers: cycles.map((c, i) => ({ id: `h${i}`, label: ['Order · TakeOrders', 'Detected · EngageEnemies', 'Spawned'][i], cycles: c, runs: runs[i] })),
    dropped,
    handled: 0,
    queued: 1,
    capacity: 8,
  });

  it('shows cycles per second by event block between two answers, busiest first', () => {
    const lines = cpuLines({ tick: 110, profile: profile([30, 120, 2], [3, 12, 1], 2) }, { tick: 100, profile: profile([10, 20, 2], [1, 2, 1]) }, 10);
    expect(lines[0]).toBe('CPU by event (last 1s): 120.0 c/s');
    expect(lines[1]).toBe('  Detected · EngageEnemies: 100.0 c/s (83%) · 10 runs');
    expect(lines[2]).toBe('  Order · TakeOrders: 20.0 c/s (17%) · 2 runs');
    expect(lines).toHaveLength(4);
    expect(lines[3]).toMatch(/^Events dropped: 2 \(2 lately\) · queue 1\/8$/);
  });

  it('with one answer, shows totals since the program started', () => {
    expect(cpuLines({ tick: 5, profile: profile([0, 0, 3], [0, 0, 1]) }, undefined, 10)).toEqual(['CPU by event (since start): 3 c', '  Spawned: 3 c (100%) · 1 run']);
    expect(cpuLines({ tick: 5, profile: null }, undefined, 10)).toEqual([]);
  });
});
