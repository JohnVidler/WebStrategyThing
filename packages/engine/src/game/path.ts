import { TILE } from './parts';
import { WHEELS, type Mobility, type Terrain } from './terrain';

const STRAIGHT = 10;
const DIAGONAL = 14;
/** How far (in tiles) from a blocked goal to look for a cell to stand on; a building's footprint is at most a few tiles across. */
const BLOCKED_GOAL_RADIUS = 8;
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
let expanded = 0;

/** Work done by every search so far (cells expanded, plus the length of each straight-line test while smoothing): a deterministic measure of planning cost. The difference across a call is that call's cost. */
export function searchWork(): number {
  return expanded;
}

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
 *
 * `m` is the unit's mobility: legs may cross rock up to their climb, and a big hull only uses cells
 * it fits in. A unit that starts somewhere too tight for it may squeeze out through tight cells, but
 * never steps from a cell it fits in into one it does not.
 *
 * A goal the unit cannot stand on (the middle of a building, a rock) is replaced by the nearest cell it
 * can, so the search ends there instead of flooding every reachable cell before giving up.
 */
export function findPath(t: Terrain, sx: number, sy: number, goalX: number, goalY: number, m: Mobility = WHEELS): number[] {
  const w = t.width;
  let gx = goalX;
  let gy = goalY;
  if (!t.fits(gx, gy, m)) {
    const near = t.nearestFit(gx, gy, m, BLOCKED_GOAL_RADIUS);
    if (near) [gx, gy] = near;
  }
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
  const big = m.clearance > 0;
  const loose: Mobility = { climb: m.climb, clearance: 0 };
  // From a cell it fits in, a unit only goes where it fits; from a tight one it may also squeeze through cells it can enter.
  const ok = (x: number, y: number, tight: boolean) => (m.climb === 0 && !big ? t.walkable(x, y) : t.fits(x, y, m) || (tight && t.fits(x, y, loose)));

  while (heap.length) {
    const n = pop();
    if (closed[n] === search) continue;
    closed[n] = search;
    expanded++;
    if (hOf[n] < hOf[best] || (hOf[n] === hOf[best] && g[n] < g[best])) best = n;
    const x = n % w;
    const y = (n - x) / w;
    if (x === gx && y === gy) break;
    const tight = big && !t.fits(x, y, m);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!ok(nx, ny, tight)) continue;
      if (dx !== 0 && dy !== 0 && (!ok(x + dx, y, tight) || !ok(x, y + dy, tight))) continue;
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
  // Smoothed with the real mobility: while squeezing out of a tight spot no shortcut fits, so those steps stay cell by cell.
  return smooth(t, sx, sy, cells, m);
}

function smooth(t: Terrain, sx: number, sy: number, cells: number[], m: Mobility): number[] {
  const w = t.width;
  const centre = (n: number) => [(n % w) * TILE + TILE / 2, Math.floor(n / w) * TILE + TILE / 2];
  const out: number[] = [];
  let ax = sx * TILE + TILE / 2;
  let ay = sy * TILE + TILE / 2;
  let i = 0;
  while (i < cells.length) {
    // Furthest cell visible in a straight line from the anchor: gallop ahead while it stays clear, then bisect the last gap
    // (a line test costs its length, so testing every cell in turn made smoothing the main cost of a long path).
    const visible = (k: number) => {
      const [nx, ny] = centre(cells[k]);
      expanded += 1 + Math.ceil(Math.hypot(nx - ax, ny - ay) / TILE);
      return t.lineWalkable(ax, ay, nx, ny, m);
    };
    let lo = i;
    let hi = cells.length;
    for (let step = 1; lo + step < hi; step *= 2) {
      if (visible(lo + step)) lo += step;
      else hi = lo + step;
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (visible(mid)) lo = mid;
      else hi = mid;
    }
    const n = cells[lo];
    out.push(n % w, Math.floor(n / w));
    [ax, ay] = centre(n);
    i = lo + 1;
  }
  return out;
}
