/**
 * Power-network rules shared by server and client (the client uses them to
 * draw links and the sun/wind readout without any extra network traffic).
 * Everything is integer maths so the simulation stays deterministic.
 */

import { DAY_LENGTH, WIND_CHANGE_TICKS } from './rules';

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

/** Wind strength 0..100, drifting smoothly between random values every WIND_CHANGE_TICKS. */
export function wind(seed: number, tick: number): number {
  const span = WIND_CHANGE_TICKS;
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

/** A long link between two clusters, carrying at most `cap` energy per tick in total, both ways. */
export interface PowerBridge {
  readonly a: number;
  readonly b: number;
  readonly cap: number;
}

/** How one cluster reaches the others: clusters nearest first, and the bridge each is reached by. */
export interface PowerRoute {
  readonly order: number[];
  /** Per cluster, the bridge taken to get from the route's origin to it (-1 for the origin or if unreachable). */
  readonly via: number[];
}

/**
 * A network split into clusters: members joined by short (uncapped) links move energy freely
 * inside a cluster, and capped long links (bridges) join the clusters. Because the links are a
 * spanning forest (`powerLinks`), the bridges always form a tree over the clusters, so two clusters
 * never share more than one bridge. Built once per rebuild, not per tick.
 */
export interface PowerTopology {
  /** Per member (same order as the network's `members`), its cluster. */
  readonly clusterOf: number[];
  readonly clusters: number;
  readonly bridges: PowerBridge[];
  /** Per cluster, how to reach every other one. */
  readonly routes: PowerRoute[];
  /** Per cluster, the member indices in it. */
  readonly byCluster: number[][];
}

/** A network with nothing in it yet: one cluster, no bridges. */
export function emptyNetwork(): PowerNetwork {
  return {
    members: [],
    supply: 0,
    demand: 0,
    stored: 0,
    capacity: 0,
    depot: false,
    linkTiles: 0,
    clusterOf: [],
    clusters: 1,
    bridges: [],
    routes: [{ order: [0], via: [-1] }],
    byCluster: [[]],
    delivered: 0,
    flow: [],
  };
}

/**
 * Splits every network (`ids[i]` is node i's network) into clusters and bridges. Links no longer
 * than `shortGap` tiles, and links to construction sites, join clusters; longer ones become bridges
 * whose capacity is `capOf(i, j, gap)`. Also returns each network's total link gap. Members are
 * indexed in node order within their network.
 */
export function powerTopology(
  nodes: readonly PowerNode[],
  ids: readonly number[],
  links: readonly [number, number][],
  shortGap: number,
  capOf: (i: number, j: number, gap: number) => number,
): { topologies: PowerTopology[]; linkTiles: number[] } {
  const count = ids.reduce((m, id) => Math.max(m, id + 1), 0);
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const linkTiles: number[] = new Array(count).fill(0);
  const long: { i: number; j: number; cap: number }[] = [];
  for (const [i, j] of links) {
    const g = gap(nodes[i], nodes[j]);
    linkTiles[ids[i]] += g;
    if (g <= shortGap || nodes[i].site || nodes[j].site) parent[find(i)] = find(j);
    else long.push({ i, j, cap: capOf(i, j, g) });
  }
  // Number each network's members and clusters in node order.
  const local: number[] = [];
  const sizes: number[] = new Array(count).fill(0);
  const clusterOf: number[][] = Array.from({ length: count }, () => []);
  const numbering: Map<number, number>[] = Array.from({ length: count }, () => new Map());
  nodes.forEach((_, i) => {
    const net = ids[i];
    local[i] = sizes[net]++;
    const root = find(i);
    let c = numbering[net].get(root);
    if (c === undefined) numbering[net].set(root, (c = numbering[net].size));
    clusterOf[net].push(c);
  });
  const bridges: PowerBridge[][] = Array.from({ length: count }, () => []);
  for (const l of long) {
    const net = ids[l.i];
    const a = clusterOf[net][local[l.i]];
    const b = clusterOf[net][local[l.j]];
    if (a !== b) bridges[net].push({ a, b, cap: l.cap });
  }
  const topologies = clusterOf.map((cl, net): PowerTopology => {
    const clusters = Math.max(1, numbering[net].size);
    const adjacent: number[][] = Array.from({ length: clusters }, () => []);
    bridges[net].forEach((br, bi) => {
      adjacent[br.a].push(bi);
      adjacent[br.b].push(bi);
    });
    const routes = Array.from({ length: clusters }, (_, t): PowerRoute => {
      const via: number[] = new Array(clusters).fill(-1);
      const seen = new Set<number>([t]);
      const order = [t];
      for (let n = 0; n < order.length; n++) {
        for (const bi of adjacent[order[n]]) {
          const other = bridges[net][bi].a === order[n] ? bridges[net][bi].b : bridges[net][bi].a;
          if (seen.has(other)) continue;
          seen.add(other);
          via[other] = bi;
          order.push(other);
        }
      }
      return { order, via };
    });
    const byCluster: number[][] = Array.from({ length: clusters }, () => []);
    cl.forEach((c, i) => byCluster[c].push(i));
    return { clusterOf: cl, clusters, bridges: bridges[net], routes, byCluster };
  });
  return { topologies, linkTiles };
}

/**
 * Moves energy between clusters over capped bridges. Each cluster is first given the share of the
 * total supply it would get on an uncapped network (in proportion to what it wants), served from its
 * own supply and then from the nearest others, limited by what every bridge on the way still has
 * free. A second pass then lets any cluster still short take what is left, from its own supply first,
 * so a cap on one path never leaves energy idle that a consumer could have used. `used` holds each
 * bridge's total flow this tick (both directions count) and persists across calls, so a bridge's cap
 * is shared by everything that crosses it in one tick.
 */
export function routeEnergy(
  topo: Pick<PowerTopology, 'bridges' | 'routes'>,
  used: number[],
  supply: readonly number[],
  want: readonly number[],
): { got: number[]; gave: number[] } {
  const { bridges, routes } = topo;
  const got = supply.map(() => 0);
  const gave = supply.map(() => 0);
  const left = [...supply];
  const need = [...want];
  const take = (t: number, s: number, amount: number): void => {
    got[t] += amount;
    gave[s] += amount;
    left[s] -= amount;
    need[t] -= amount;
  };
  /** Serves up to `target` of cluster t's need: from itself, then from the nearest clusters. */
  const serve = (t: number, target: number): void => {
    const local = Math.min(target, left[t]);
    take(t, t, local);
    target -= local;
    if (bridges.length === 0) return;
    const { order, via } = routes[t];
    for (let n = 1; n < order.length && target > 0; n++) {
      const s = order[n];
      if (left[s] <= 0) continue;
      // Free capacity along the way from s to t.
      let free = Math.min(target, left[s]);
      for (let c = s; c !== t; ) {
        const br = bridges[via[c]];
        free = Math.min(free, br.cap - used[via[c]]);
        c = br.a === c ? br.b : br.a;
      }
      if (free <= 0) continue;
      for (let c = s; c !== t; ) {
        const br = bridges[via[c]];
        used[via[c]] += free;
        c = br.a === c ? br.b : br.a;
      }
      take(t, s, free);
      target -= free;
    }
  };
  const targets = share(supply.reduce((a, b) => a + b, 0), want);
  for (let t = 0; t < need.length; t++) if (targets[t] > 0) serve(t, targets[t]);
  if (bridges.length > 0) for (let t = 0; t < need.length; t++) if (need[t] > 0 && left.some((l) => l > 0)) serve(t, need[t]);
  return { got, gave };
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
export interface PowerNetwork extends Omit<PowerTopology, never> {
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
  /** Energy normal consumers actually received last tick (generation and discharged storage). */
  delivered: number;
  /**
   * Per member (same order as `members`), energy moved last tick: taken from the
   * network minus given to it. Negative for sources (generators, discharging
   * storage); the values sum to zero. Used to animate power over the links.
   */
  flow: number[];
}
