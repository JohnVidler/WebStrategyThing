import type { GNode, GraphModel } from './graphModel';
import { isExprNodeId } from './graphOps';

/** Where a node sits (its top-left corner), in graph units. */
export type Positions = Record<string, readonly [number, number]>;

/** Node width; heights are estimated from the number of rows and controls. */
export const NODE_WIDTH = 230;
const GAP_X = 70;
const GAP_Y = 36;
const ROW = 26;

export function estimateHeight(n: GNode): number {
  const rows = Math.max(n.inputs.length, n.outputs.length);
  const extra = n.controls.filter((c) => !n.inputs.some((i) => i.key === c.key)).length;
  const lines = n.controls.some((c) => c.type === 'multiline') ? 3 : 0;
  return 38 + rows * ROW + extra * 28 + lines * 14 + (n.actions?.length ? 30 : 0) + (n.emits?.length ? 18 : 0) + (n.kind === 'block' ? 40 : 0) + 12;
}

/**
 * A tidy layout: each event block (or loose chain) is a row, execution flows left to right, a
 * branch's other chains go underneath it, and the data nodes feeding a node sit to its left.
 * Pure and deterministic, so the same program always lays out the same.
 */
export function layout(model: GraphModel): Positions {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const execOut = new Map<string, { key: string; to: string }[]>();
  const execIn = new Set<string>();
  const dataIn = new Map<string, { key: string; from: string }[]>();
  for (const e of model.edges) {
    if (e.type === 'exec') {
      const list = execOut.get(e.from.node) ?? [];
      list.push({ key: e.from.key, to: e.to.node });
      execOut.set(e.from.node, list);
      execIn.add(e.to.node);
    } else {
      const list = dataIn.get(e.to.node) ?? [];
      list.push({ key: e.to.key, from: e.from.node });
      dataIn.set(e.to.node, list);
    }
  }
  // Exec outputs in the order the node declares them, so True comes before False before Done.
  for (const [id, list] of execOut) {
    const order = byId.get(id)?.outputs.map((o) => o.key) ?? [];
    list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }

  const pos: Record<string, [number, number]> = {};
  const placed = new Set<string>();

  /** Data nodes feeding `id` through expression nodes: [node, level] in depth-first order. */
  const feeders = (id: string, level = 1, out: { id: string; level: number }[] = []): { id: string; level: number }[] => {
    for (const { from } of dataIn.get(id) ?? []) {
      if (!isExprNodeId(from) || placed.has(from)) continue;
      out.push({ id: from, level });
      feeders(from, level + 1, out);
    }
    return out;
  };

  /** Places a node and the data nodes feeding it; returns the bottom edge of what it used. */
  const placeWithData = (id: string, x: number, y: number): number => {
    const node = byId.get(id)!;
    pos[id] = [x, y];
    placed.add(id);
    let bottom = y + estimateHeight(node);
    const cursors = new Map<number, number>();
    // Value nodes sit below the execution wire that leads into a statement, not on top of it.
    const top = node.inputs.some((i) => i.type === 'exec') ? y + 76 : y;
    for (const f of feeders(id)) {
      if (placed.has(f.id)) continue;
      const fy = cursors.get(f.level) ?? top;
      const fx = x - f.level * (NODE_WIDTH + 40);
      pos[f.id] = [fx, fy];
      placed.add(f.id);
      const nextY = fy + estimateHeight(byId.get(f.id)!) + 14;
      cursors.set(f.level, nextY);
      bottom = Math.max(bottom, nextY - 14);
    }
    return bottom;
  };

  const levels = (id: string): number => Math.max(0, ...feeders(id).map((f) => f.level));

  /** Places an execution chain starting at `id`; returns its right and bottom edges. */
  const chain = (id: string, x0: number, y: number): { right: number; bottom: number } => {
    if (placed.has(id)) return { right: x0, bottom: y };
    const x = x0 + levels(id) * (NODE_WIDTH + 40);
    let bottom = placeWithData(id, x, y);
    let right = x + NODE_WIDTH;
    const children = execOut.get(id) ?? [];
    let rowY = y;
    children.forEach((c, i) => {
      const at = i === 0 ? y : bottom + GAP_Y;
      rowY = at;
      const sub = chain(c.to, x + NODE_WIDTH + GAP_X, rowY);
      right = Math.max(right, sub.right);
      bottom = Math.max(bottom, sub.bottom);
    });
    void rowY;
    return { right, bottom };
  };

  let y = 40;
  // Built-in blocks come first, as a row of cards; what they raise is what the event blocks below hook.
  const cards = model.nodes.filter((n) => n.kind === 'block');
  for (let start = 0; start < cards.length; start += 3) {
    const row = cards.slice(start, start + 3);
    row.forEach((c, col) => {
      pos[c.id] = [40 + col * (NODE_WIDTH + 60), y];
      placed.add(c.id);
    });
    y += Math.max(...row.map((n) => estimateHeight(n))) + GAP_Y;
  }
  const heads = model.nodes.filter((n) => n.kind === 'event');
  for (const h of heads) {
    const r = chain(h.id, 40, y);
    y = r.bottom + GAP_Y * 2;
  }
  // Loose chains: heads are statements with no way in.
  for (const n of model.nodes) {
    if (placed.has(n.id) || isExprNodeId(n.id)) continue;
    if (n.inputs.some((i) => i.type === 'exec') && !execIn.has(n.id)) {
      const r = chain(n.id, 40, y);
      y = r.bottom + GAP_Y * 2;
    }
  }
  // Loose data nodes (and anything left over).
  for (const n of model.nodes) {
    if (placed.has(n.id)) continue;
    const bottom = placeWithData(n.id, 40 + levels(n.id) * (NODE_WIDTH + 40), y);
    y = bottom + GAP_Y;
  }
  return pos;
}
