import { describe, expect, it } from 'vitest';
import { FLOW_HOST, parseText, printText, serialize, type FlowDoc } from '@wst/engine';
import { buildGraph, slotForInput } from '../src/flow/graphModel';
import { estimateHeight, layout, NODE_WIDTH } from '../src/flow/layout';
import {
  addExpression,
  addHandler,
  addStatement,
  addVariable,
  connectData,
  connectExec,
  deleteNode,
  deleteVariable,
  disconnectData,
  disconnectExec,
  emptyScratch,
  exprNodeId,
  OpError,
  scratchOf,
  setConfig,
  setLiteral,
  withScratch,
  type Program,
} from '../src/flow/graphOps';

const SAMPLE = `let target = -1;

on(Detected, { watch: [ENEMY], range: 6 }, (kind, h) => {
  target = h;
  const near = dist(h);
  if (near <= 3) {
    fire(h);
  } else {
    approach(h, 3);
  }
});
`;

const program = (text: string): Program => {
  const { doc, errors } = parseText(text, FLOW_HOST);
  expect(errors.map((e) => e.message)).toEqual([]);
  return { doc, scratch: emptyScratch };
};
const textOf = (p: Program) => printText(p.doc, FLOW_HOST);
/** The program as the text of the main program, plus how many loose chains and expressions are left over. */
const shape = (p: Program) => `${textOf(p)}|${p.scratch.chains.length} chains|${p.scratch.exprs.length} exprs`;
/** Re-parsing the printed program gives the same program: the graph and the text cannot drift apart. */
const withoutIds = (doc: FlowDoc): string =>
  serialize(JSON.parse(JSON.stringify({ ...doc, views: undefined }, (k, v: unknown) => (k === 'id' ? undefined : v))) as FlowDoc);
const roundTrips = (p: Program) => {
  const again = parseText(textOf(p), FLOW_HOST);
  expect(again.errors.map((e) => e.message)).toEqual([]);
  expect(withoutIds(again.doc)).toBe(withoutIds(p.doc));
};
const ids = (p: Program) => p.doc.handlers[0].body.map((s) => s.id);

describe('graph model', () => {
  it('draws handlers as event blocks, statements as nodes, execution as chains and values as wires', () => {
    const p = program(SAMPLE);
    const g = buildGraph(p, FLOW_HOST);
    const titles = g.nodes.map((n) => n.title);
    expect(titles).toEqual(expect.arrayContaining(['Detected', 'Set', 'dist', 'Branch', 'fire', 'approach', '≤']));
    const [set, dist, branch] = p.doc.handlers[0].body;
    const ev = p.doc.handlers[0].id;
    const exec = g.edges.filter((e) => e.type === 'exec').map((e) => `${e.from.node}.${e.from.key}>${e.to.node}`);
    const fire = (branch as Extract<typeof branch, { k: 'if' }>).then[0].id;
    const approach = (branch as Extract<typeof branch, { k: 'if' }>).else[0].id;
    expect(exec).toEqual(expect.arrayContaining([
      `${ev}.start>${set.id}`, `${set.id}.next>${dist.id}`, `${dist.id}.next>${branch.id}`, `${branch.id}.then>${fire}`, `${branch.id}.else>${approach}`,
    ]));
    const data = g.edges.filter((e) => e.type === 'data').map((e) => `${e.from.node}.${e.from.key}>${e.to.node}.${e.to.key}`);
    // Event parameters and call results are wires; the comparison is a node feeding the branch.
    expect(data).toEqual(expect.arrayContaining([
      `${ev}.p:h>${set.id}.value`, `${ev}.p:h>${dist.id}.arg:0`, `${dist.id}.result>${exprNodeId(branch.id, 'cond')}.a`, `${exprNodeId(branch.id, 'cond')}.out>${branch.id}.cond`,
    ]));
    // Literals are typed-in defaults on the pin, not nodes.
    const approachNode = g.nodes.find((n) => n.id === approach)!;
    expect(approachNode.controls).toEqual([expect.objectContaining({ key: 'arg:1', value: '3' })]);
    expect(approachNode.kind).toBe('action');
    expect(g.nodes.find((n) => n.id === dist.id)!.kind).toBe('query');
    expect(g.nodes.find((n) => n.id === ev)!.controls.map((c) => `${c.label}=${c.value}`)).toEqual(['watch=ENEMY', 'range=6', 'interval=5', 'sort=NEAREST', 'limit=1']);
  });

  it('shows runtime settings, notes and loose pieces for what they are', () => {
    let p = program('on(Idle, () => {\n  // wait\n  config.rest(5);\n});\n');
    const g = buildGraph(p, FLOW_HOST);
    expect(g.nodes.map((n) => n.kind)).toEqual(['event', 'note', 'config']);
    p = addStatement(p, { k: 'call', fn: 'fire', argc: 1 }).program;
    p = addExpression(p, { k: 'bin', op: '+' }).program;
    const loose = buildGraph(p, FLOW_HOST).nodes.filter((n) => n.loose);
    expect(loose.map((n) => n.title)).toEqual(['fire', '+']);
  });

  it('maps input pins back to the slots of the program', () => {
    expect(slotForInput('n5', 'arg:1')).toEqual({ owner: 'n5', path: 'args.1' });
    expect(slotForInput('n5', 'cond')).toEqual({ owner: 'n5', path: 'cond' });
    expect(slotForInput('n5#cond', 'a')).toEqual({ owner: 'n5', path: 'cond.a' });
    expect(slotForInput('n5#args.0.b', 'arg:2')).toEqual({ owner: 'n5', path: 'args.0.b.args.2' });
    expect(slotForInput('n9#', 'b')).toEqual({ owner: 'n9', path: 'b' });
  });
});

describe('graph operations keep the program expressible as text', () => {
  const base = () => program('on(Idle, () => {\n  fire(0);\n  stop();\n  moveTo(1, 2);\n});\n');

  it('wiring an exec output to a node moves that chain there and parks what was displaced', () => {
    let p = base();
    const [a, b, c] = ids(p);
    // a -> c: b is left over, loose.
    p = connectExec(p, { k: 'next', stmt: a }, c);
    expect(shape(p)).toBe('on(Idle, () => {\n  fire(0);\n  moveTo(1, 2);\n});\n|1 chains|0 exprs'.replace('|1 chains', '|1 chains'));
    expect(p.scratch.chains[0].map((s) => s.id)).toEqual([b]);
    roundTrips(p);
    // Wire the loose node back in after a: the former follower (c) becomes loose instead.
    p = connectExec(p, { k: 'next', stmt: a }, b);
    expect(textOf(p)).toBe('on(Idle, () => {\n  fire(0);\n  stop();\n});\n');
    expect(p.scratch.chains).toHaveLength(1);
    expect(p.scratch.chains[0].map((s) => s.id)).toEqual([c]);
    roundTrips(p);
  });

  it('cutting a wire parks the rest of the chain, and deleting a node closes the chain up', () => {
    let p = base();
    const [a, b, c] = ids(p);
    p = disconnectExec(p, { k: 'next', stmt: a });
    expect(textOf(p)).toBe('on(Idle, () => {\n  fire(0);\n});\n');
    expect(p.scratch.chains[0].map((s) => s.id)).toEqual([b, c]);
    p = base();
    p = deleteNode(p, b);
    expect(textOf(p)).toBe('on(Idle, () => {\n  fire(0);\n  moveTo(1, 2);\n});\n');
    expect(p.scratch.chains).toHaveLength(0);
    roundTrips(p);
  });

  it('refuses a wire that would make the program loop back on itself', () => {
    const p = base();
    const [a, , c] = ids(p);
    expect(() => connectExec(p, { k: 'next', stmt: c }, a)).toThrow(OpError);
    expect(() => connectExec(p, { k: 'next', stmt: c }, a)).toThrow(/loop/);
  });

  it('branches own their chains: True, False, Done and a loop body are separate outputs', () => {
    let p = program('on(Idle, () => {\n  if (energy() > 5) {\n    fire(0);\n  }\n  stop();\n});\n');
    const [branch, after] = ids(p);
    const added = addStatement(p, { k: 'call', fn: 'fire', argc: 1 });
    p = connectExec(added.program, { k: 'else', stmt: branch }, added.id);
    expect(textOf(p)).toContain('} else {\n    fire(0);\n  }');
    const w = addStatement(p, { k: 'while', });
    p = connectExec(w.program, { k: 'next', stmt: after }, w.id);
    const body = addStatement(p, { k: 'call', fn: 'fire', argc: 1 });
    p = connectExec(body.program, { k: 'body', stmt: w.id }, body.id);
    expect(textOf(p)).toContain('while (0) {\n    fire(0);\n  }');
    roundTrips(p);
    // Deleting a branch keeps its chains as loose pieces.
    p = deleteNode(p, branch);
    expect(p.scratch.chains.length).toBe(2);
  });

  it('gives a long-running call a pin for each way it can end, and wires follow-ups to them', () => {
    let p = program('on(Order, { types: [MOVE] }, (type, tx, ty) => {\n  goTo(tx, ty, {\n    arrived: () => {\n      stop();\n    },\n  });\n});\n');
    let g = buildGraph(p, FLOW_HOST);
    const go = g.nodes.find((n) => n.title === 'goTo')!;
    expect(go.outputs.map((o) => o.key)).toEqual(['next', 'out:arrived', 'out:blocked', 'result']);
    expect(g.edges.some((e) => e.from.node === go.id && e.from.key === 'out:arrived')).toBe(true);
    const next = addStatement(p, { k: 'call', fn: 'fire', argc: 1 });
    p = connectExec(next.program, { k: 'outcome', stmt: go.id, name: 'blocked' }, next.id);
    expect(textOf(p)).toContain('blocked: () => {\n      fire(0);\n    },');
    roundTrips(p);
    // Cutting the only wire out of a pin drops the empty chain from the text.
    p = deleteNode(p, p.doc.handlers[0].body[0].k === 'call' ? Object.values(p.doc.handlers[0].body[0].outcomes!)[1][0].id : '');
    expect(textOf(p)).not.toContain('blocked');
    g = buildGraph(p, FLOW_HOST);
    expect(g.nodes.some((n) => n.title === 'fire' && !n.loose)).toBe(false);
  });

  it('wires a data source into an input: parameters and results fan out, nodes feed exactly one input', () => {
    let p = program('on(Order, (type, tx, ty, target) => {\n  const d = dist(target);\n  moveTo(tx, ty);\n  stop();\n});\n');
    const [dist, move] = ids(p);
    // Event parameter into a literal input, and the call result into another: both become references.
    p = connectData(p, { k: 'local', name: 'ty' }, { owner: move, path: 'args.0' });
    p = connectData(p, { k: 'local', name: 'd' }, { owner: move, path: 'args.1' });
    expect(textOf(p)).toContain('moveTo(ty, d);');
    // A value is only available after the node that makes it.
    const early = addStatement(p, { k: 'call', fn: 'fire', argc: 1 });
    expect(() => connectData(early.program, { k: 'local', name: 'd' }, { owner: early.id, path: 'args.0' })).toThrow(/not available here/);
    expect(dist).toBeDefined();
    // A new operator node: wire it in, then try to feed a second input.
    const plus = addExpression(p, { k: 'bin', op: '+' });
    p = connectData(plus.program, { k: 'local', name: 'tx' }, { owner: parsePlus(plus.id), path: 'a' });
    p = connectData(p, { k: 'node', id: plus.id }, { owner: move, path: 'args.0' });
    expect(textOf(p)).toContain('moveTo(tx + 0, d);');
    expect(p.scratch.exprs).toHaveLength(0);
    roundTrips(p);
    const stop = ids(p)[2];
    p = addStatement(p, { k: 'call', fn: 'fire', argc: 1 }).program;
    expect(() => connectData(p, { k: 'node', id: exprNodeId(move, 'args.0') }, { owner: stop, path: 'args.0' })).toThrow(/already feeds/);
  });

  it('cutting a data wire parks the node, and a picked-up wire can be dropped on another input', () => {
    let p = program('on(Idle, () => {\n  moveTo(1 + 2, 3);\n  fire(4);\n});\n');
    const [move, drop] = ids(p);
    const cut = disconnectData(p, { owner: move, path: 'args.0' });
    p = cut.program;
    expect(textOf(p)).toContain('moveTo(0, 3);');
    expect(p.scratch.exprs).toHaveLength(1);
    expect(cut.detached).toBeDefined();
    p = connectData(p, { k: 'node', id: cut.detached! }, { owner: drop, path: 'args.0' });
    expect(textOf(p)).toContain('fire(1 + 2);');
    expect(p.scratch.exprs).toHaveLength(0);
    roundTrips(p);
    expect(() => connectData(p, { k: 'node', id: exprNodeId(drop, 'args.0') }, { owner: drop, path: 'args.0.a' })).toThrow(/feed itself/);
  });

  it('typed-in values are whole numbers or named constants, and settings are checked by the schema when printed', () => {
    let p = program('on(Idle, () => {\n  fire(0);\n});\n');
    const [drop] = ids(p);
    p = setLiteral(p, { owner: drop, path: 'args.0' }, '7', FLOW_HOST);
    expect(textOf(p)).toContain('fire(7);');
    p = setLiteral(p, { owner: drop, path: 'args.0' }, 'MOVE', FLOW_HOST);
    expect(textOf(p)).toContain('fire(MOVE);');
    expect(() => setLiteral(p, { owner: drop, path: 'args.0' }, 'banana', FLOW_HOST)).toThrow(/not a whole number/);
    p = setConfig(p, p.doc.handlers[0].id, 'interval', 4);
    expect(textOf(p)).toContain('on(Idle, { interval: 4 }');
    roundTrips(p);
  });

  it('adds variables and event blocks under the same rules as the text', () => {
    let p = program('on(Idle, () => {});\n');
    expect(() => addHandler(p, 'Idle')).toThrow(/only have one Idle/);
    expect(() => addHandler(p, 'Nope')).toThrow(/Unknown event/);
    p = addHandler(p, 'Order').program;
    expect(p.doc.handlers.map((h) => h.event)).toEqual(['Idle', 'Order']);
    expect(p.doc.handlers[1].params).toEqual(['type', 'tx', 'ty', 'target']);
    p = addVariable(p, 'count', 3, FLOW_HOST);
    expect(() => addVariable(p, 'count', 0, FLOW_HOST)).toThrow(/already/);
    expect(() => addVariable(p, 'hp', 0, FLOW_HOST)).toThrow(/cannot be used/);
    const set = addStatement(p, { k: 'set', name: 'count' });
    p = connectExec(set.program, { k: 'start', handler: p.doc.handlers[0].id }, set.id);
    expect(() => deleteVariable(p, 'count')).toThrow(/still used/);
    p = deleteNode(p, set.id);
    p = deleteVariable(p, 'count');
    expect(p.doc.vars).toEqual([]);
    roundTrips(p);
  });

  it('keeps the scratch area in the editor-only views and out of the stored program when empty', () => {
    const p = addStatement(program('on(Idle, () => {});\n'), { k: 'call', fn: 'stop', argc: 0 }).program;
    const views = withScratch({}, p.scratch);
    expect(scratchOf(views).chains).toHaveLength(1);
    expect(withScratch(views, emptyScratch).graph).toEqual({});
  });
});

function parsePlus(id: string): string {
  return id.slice(0, id.indexOf('#'));
}

describe('layout', () => {
  it('lays the sample out without overlaps, left to right, the same way every time', () => {
    const p = program(SAMPLE);
    const g = buildGraph(p, FLOW_HOST);
    const a = layout(g);
    expect(layout(g)).toEqual(a);
    const boxes = g.nodes.map((n) => ({ id: n.id, x: a[n.id][0], y: a[n.id][1], h: estimateHeight(n) }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const p1 = boxes[i];
        const p2 = boxes[j];
        const apartX = p1.x + NODE_WIDTH <= p2.x || p2.x + NODE_WIDTH <= p1.x;
        const apartY = p1.y + p1.h <= p2.y || p2.y + p2.h <= p1.y;
        expect(apartX || apartY, `${p1.id} overlaps ${p2.id}`).toBe(true);
      }
    }
    const ev = p.doc.handlers[0].id;
    const set = p.doc.handlers[0].body[0].id;
    expect(a[set][0]).toBeGreaterThan(a[ev][0]);
  });
});
