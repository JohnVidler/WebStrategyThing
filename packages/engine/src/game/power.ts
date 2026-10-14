/**
 * Power-network rules shared by server and client (the client uses them to
 * draw links and the sun/wind readout without any extra network traffic).
 * Everything is integer maths so the simulation stays deterministic.
 */

/** Ticks in one day/night cycle (2 minutes at 10 Hz). Daylight during the first half. */
export const DAY_LENGTH = 1200;

/** Sunlight 0..100: rises and falls across the day, 0 at night. */
export function daylight(tick: number): number {
  const half = DAY_LENGTH / 2;
  const phase = tick % DAY_LENGTH;
  if (phase >= half) return 0;
  const quarter = half / 2;
  return Math.floor(((phase < quarter ? phase : half - phase) * 100) / quarter);
}

function hash(seed: number, k: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** Wind strength 0..100, drifting smoothly between random values every 10 seconds. */
export function wind(seed: number, tick: number): number {
  const span = 100;
  const k = Math.floor(tick / span);
  const f = tick % span;
  const a = hash(seed, k) % 101;
  const b = hash(seed, k + 1) % 101;
  return Math.floor(a + ((b - a) * f) / span);
}

/** A building as far as power linking is concerned: its tile rectangle and link reach. */
export interface PowerNode {
  readonly e: number;
  readonly owner: number;
  /** Top-left tile and footprint size. */
  readonly x: number;
  readonly y: number;
  readonly size: number;
  /** Tiles a link reaches from this building's edge. */
  readonly reach: number;
  /** An unfinished construction site: it hangs off one finished building and never links others. */
  readonly site?: boolean;
}

/** Edge-to-edge gap in tiles (Chebyshev): 0 when touching. */
export function gap(a: PowerNode, b: PowerNode): number {
  const gx = Math.max(0, b.x - (a.x + a.size), a.x - (b.x + b.size));
  const gy = Math.max(0, b.y - (a.y + a.size), a.y - (b.y + b.size));
  return Math.max(gx, gy);
}

/**
 * Pairs [i, j] of nodes (indices into `nodes`) that link. Any same-owner pair within either
 * one's reach *could* link, but only the shortest links that keep everything connected are
 * kept (a minimum spanning forest), so each node joins its nearest neighbours rather than
 * everything in range. Recomputed when buildings change, so a broken link re-routes.
 */
export function powerLinks(nodes: readonly PowerNode[]): [number, number][] {
  const candidates: { i: number; j: number; gap: number; dist: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const g = gap(a, b);
      if (a.owner !== b.owner || g > Math.max(a.reach, b.reach)) continue;
      const dx = a.x + a.size / 2 - (b.x + b.size / 2);
      const dy = a.y + a.size / 2 - (b.y + b.size / 2);
      candidates.push({ i, j, gap: g, dist: dx * dx + dy * dy });
    }
  }
  candidates.sort((p, q) => p.gap - q.gap || p.dist - q.dist || p.i - q.i || p.j - q.j);
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const links: [number, number][] = [];
  const attached = new Set<number>();
  for (const c of candidates) {
    const aSite = nodes[c.i].site === true;
    const bSite = nodes[c.j].site === true;
    if (aSite && bSite) continue;
    if (aSite || bSite) {
      // A site takes only its best link, to a finished building (candidates are sorted best first).
      const site = aSite ? c.i : c.j;
      if (attached.has(site)) continue;
      attached.add(site);
      links.push([c.i, c.j]);
      continue;
    }
    const a = find(c.i);
    const b = find(c.j);
    if (a === b) continue;
    parent[a] = b;
    links.push([c.i, c.j]);
  }
  return links;
}

/** Connected components: returns, for each node, the index of its network (in order of first member). */
export function powerNetworks(nodes: readonly PowerNode[]): number[] {
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [i, j] of powerLinks(nodes)) {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  }
  const ids = new Map<number, number>();
  return nodes.map((_, i) => {
    const root = find(i);
    let id = ids.get(root);
    if (id === undefined) ids.set(root, (id = ids.size));
    return id;
  });
}

/**
 * Splits `total` between `wants` in proportion, never exceeding any want;
 * rounding leftovers go to the earliest entries. Returns the grants.
 */
export function share(total: number, wants: readonly number[]): number[] {
  const sum = wants.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return wants.map(() => 0);
  if (total >= sum) return [...wants];
  const grants = wants.map((w) => Math.floor((total * w) / sum));
  let left = total - grants.reduce((a, b) => a + b, 0);
  for (let i = 0; i < grants.length && left > 0; i++) {
    if (grants[i] < wants[i]) {
      grants[i]++;
      left--;
    }
  }
  return grants;
}

/** How a power network treats a building's own energy store. Set by scripts with storageMode(). */
export const StorageMode = {
  /** Default: topped up from the network first, like any consumer. */
  Normal: 0,
  /** Absorb only surplus power, after normal consumers are served. */
  Charge: 1,
  /** Supply the network when generation falls short. */
  Discharge: 2,
  /** Neither take nor give. */
  Hold: 3,
} as const;

/** Per-network totals from the last power tick, readable by building scripts. */
export interface PowerNetwork {
  readonly members: number[];
  /** Generated this tick. */
  supply: number;
  /** Energy normal consumers wanted this tick. */
  demand: number;
  /** Energy held by all members. */
  stored: number;
  capacity: number;
  /** True if a finished building with silos is on this network (sites here draw from the common pool). */
  depot: boolean;
  /** Total edge-to-edge gap, in tiles, across the network's links: long links lose energy in transit. */
  linkTiles: number;
  /**
   * Per member (same order as `members`), energy moved last tick: taken from the
   * network minus given to it. Negative for sources (generators, discharging
   * storage); the values sum to zero. Used to animate power over the links.
   */
  flow: number[];
}
