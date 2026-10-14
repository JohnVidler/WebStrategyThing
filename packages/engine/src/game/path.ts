import { TILE } from './parts';
import type { Terrain } from './terrain';

const STRAIGHT = 10;
const DIAGONAL = 14;
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;

// Scratch buffers reused between searches (the pathfinder is not re-entrant).
let cap = 0;
let g = new Int32Array(0);
let parent = new Int32Array(0);
let stamp = new Uint32Array(0);
let closed = new Uint32Array(0);
let search = 0;
let heap: number[] = [];
let fOf = new Int32Array(0);
let hOf = new Int32Array(0);

function ensure(n: number): void {
  if (n <= cap) return;
  cap = n;
  g = new Int32Array(n);
  parent = new Int32Array(n);
  stamp = new Uint32Array(n);
  closed = new Uint32Array(n);
  fOf = new Int32Array(n);
  hOf = new Int32Array(n);
}

const better = (a: number, b: number) =>
  fOf[a] !== fOf[b] ? fOf[a] < fOf[b] : hOf[a] !== hOf[b] ? hOf[a] < hOf[b] : a < b;

function push(n: number): void {
  heap.push(n);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!better(heap[i], heap[p])) break;
    [heap[i], heap[p]] = [heap[p], heap[i]];
    i = p;
  }
}

function pop(): number {
  const top = heap[0];
  const last = heap.pop()!;
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && better(heap[l], heap[m])) m = l;
      if (r < heap.length && better(heap[r], heap[m])) m = r;
      if (m === i) break;
      [heap[i], heap[m]] = [heap[m], heap[i]];
      i = m;
    }
  }
  return top;
}

const octile = (dx: number, dy: number) => {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return STRAIGHT * Math.max(ax, ay) + (DIAGONAL - STRAIGHT) * Math.min(ax, ay);
};

/**
 * A* over walkable cells, 8-way without corner cutting. Returns tile
 * waypoints [x, y, ...] excluding the start. If the goal is blocked or
 * unreachable, the path ends at the reachable cell closest to it.
 * The result is string-pulled so units walk straight wherever they can.
 */
export function findPath(t: Terrain, sx: number, sy: number, gx: number, gy: number): number[] {
  const w = t.width;
  ensure(w * t.height);
  if (++search === 0xffffffff) {
    stamp.fill(0);
    closed.fill(0);
    search = 1;
  }
  heap = [];
  const start = sy * w + sx;
  g[start] = 0;
  hOf[start] = octile(gx - sx, gy - sy);
  fOf[start] = hOf[start];
  parent[start] = -1;
  stamp[start] = search;
  push(start);
  let best = start;

  while (heap.length) {
    const n = pop();
    if (closed[n] === search) continue;
    closed[n] = search;
    if (hOf[n] < hOf[best] || (hOf[n] === hOf[best] && g[n] < g[best])) best = n;
    const x = n % w;
    const y = (n - x) / w;
    if (x === gx && y === gy) break;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!t.walkable(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!t.walkable(x + dx, y) || !t.walkable(x, y + dy))) continue;
      const m = ny * w + nx;
      if (closed[m] === search) continue;
      const cost = g[n] + (dx !== 0 && dy !== 0 ? DIAGONAL : STRAIGHT);
      if (stamp[m] === search && cost >= g[m]) continue;
      stamp[m] = search;
      g[m] = cost;
      parent[m] = n;
      hOf[m] = octile(gx - nx, gy - ny);
      fOf[m] = cost + hOf[m];
      push(m);
    }
  }

  const cells: number[] = [];
  for (let n = best; n !== start && n >= 0; n = parent[n]) cells.push(n);
  cells.reverse();
  return smooth(t, sx, sy, cells);
}

function smooth(t: Terrain, sx: number, sy: number, cells: number[]): number[] {
  const w = t.width;
  const centre = (n: number) => [(n % w) * TILE + TILE / 2, Math.floor(n / w) * TILE + TILE / 2];
  const out: number[] = [];
  let ax = sx * TILE + TILE / 2;
  let ay = sy * TILE + TILE / 2;
  let i = 0;
  while (i < cells.length) {
    // Skip ahead to the furthest cell visible in a straight line from the anchor.
    let j = i;
    while (j + 1 < cells.length) {
      const [nx, ny] = centre(cells[j + 1]);
      if (!t.lineWalkable(ax, ay, nx, ny)) break;
      j++;
    }
    const n = cells[j];
    out.push(n % w, Math.floor(n / w));
    [ax, ay] = centre(n);
    i = j + 1;
  }
  return out;
}
