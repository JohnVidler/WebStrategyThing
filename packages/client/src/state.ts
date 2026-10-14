import {
  BlueprintRegistry,
  Caps,
  compileUnitProgram,
  Construction,
  daylight,
  GAME_COMPONENTS,
  gap,
  Modules,
  Position,
  powerLinks,
  statsFor,
  Terrain,
  TILE,
  Unit,
  viewersOf,
  wind,
  World,
  type BlueprintStats,
  type NetworkInfo,
  type PowerNode,
  type ProgramButton,
} from '@wst/engine';

/** A power link oriented from the network's sources towards its consumers (for the flow animation). */
export interface PowerFlow {
  readonly from: number;
  readonly to: number;
  /** Energy per tick over the link, from the owner's network reports; null when unknown (other players). */
  readonly amount: number | null;
}

/**
 * Everything the client knows: the replicated mirror world, class registry,
 * terrain, and owner-only task queues. Derived data (building footprints,
 * power links and their flow direction) is recomputed locally with the same
 * engine code the server uses.
 */
export class ClientState {
  readonly world = new World(GAME_COMPONENTS);
  readonly blueprints = new BlueprintRegistry();
  terrain = new Terrain(1, 1);
  myId = -1;
  seed = 0;
  tick = 0;
  tickRate = 10;
  /** The common pool (all own silos) and its capacity. */
  pool = 0;
  poolCapacity = 0;
  /** Program source per own class (sent only to the owner). */
  readonly programs = new Map<number, string>();
  /** Own units' task queues: entity -> [type, x, y, targetEntity, ...]. */
  readonly tasks = new Map<number, number[]>();
  /** Power links as entity pairs. */
  links: [number, number][] = [];
  /** Links with a known flow direction (networks with a generator or storage). */
  flows: PowerFlow[] = [];
  /** Every known building as a power node (footprint and link reach). */
  powerNodes: PowerNode[] = [];
  /** Bumped when buildings (footprints, links) change, so the renderer can redraw. */
  structureVersion = 0;
  /** Own power networks (owner-only reports from the server). */
  networks: NetworkInfo[] = [];
  /** Whether the server filters by vision (fog of war). */
  fog = false;
  /** Per tile: 2 = in view now, 1 = seen before, 0 = never seen. Updated by updateVision(). */
  vision = new Uint8Array(0);
  visionVersion = 0;

  private readonly unit = this.world.store(Unit);
  private readonly modules = this.world.store(Modules);
  private readonly construction = this.world.store(Construction);
  private readonly buttonCache = new Map<number, { source: string; buttons: readonly ProgramButton[] }>();

  /** Buttons declared by an own class's program (compiled locally from the source the server sent). */
  buttonsOf(blueprint: number): readonly ProgramButton[] {
    const source = this.programs.get(blueprint);
    if (!source) return [];
    const cached = this.buttonCache.get(blueprint);
    if (cached?.source === source) return cached.buttons;
    let buttons: readonly ProgramButton[] = [];
    try {
      buttons = compileUnitProgram(source).buttons;
    } catch {
      // The server only accepts programs that compile; ignore anything else.
    }
    this.buttonCache.set(blueprint, { source, buttons });
    return buttons;
  }

  stats(e: number): BlueprintStats | undefined {
    if (!this.unit.has(e)) return undefined;
    const bp = this.blueprints.get(this.unit.f.blueprint[e]);
    return bp ? statsFor(bp, this.modules.has(e) ? this.modules.f.off[e] : 0) : undefined;
  }

  isStructure(e: number): boolean {
    return this.stats(e)?.structure ?? false;
  }

  isSite(e: number): boolean {
    return this.construction.has(e);
  }

  isMine(e: number): boolean {
    return this.unit.has(e) && this.unit.f.owner[e] === this.myId;
  }

  footprint(e: number): { x: number; y: number; size: number } {
    const size = this.stats(e)?.footprint ?? 1;
    const pos = this.world.store(Position);
    return { x: Math.round(pos.f.x[e] / TILE - size / 2), y: Math.round(pos.f.y[e] / TILE - size / 2), size };
  }

  get daylight(): number {
    return daylight(this.tick);
  }

  get wind(): number {
    return wind(this.seed, this.tick);
  }

  /** Recomputes which tiles own units and buildings can see (same rule the server uses). */
  updateVision(): void {
    const { width, height } = this.terrain;
    if (this.vision.length !== width * height) this.vision = new Uint8Array(width * height);
    const v = this.vision;
    for (let i = 0; i < v.length; i++) if (v[i] === 2) v[i] = 1;
    for (const { x, y, r } of viewersOf(this.world, this.myId, (e) => this.stats(e))) {
      const cx = x / TILE;
      const cy = y / TILE;
      const rt = r / TILE;
      for (let ty = Math.max(0, Math.floor(cy - rt)); ty <= Math.min(height - 1, Math.floor(cy + rt)); ty++) {
        for (let tx = Math.max(0, Math.floor(cx - rt)); tx <= Math.min(width - 1, Math.floor(cx + rt)); tx++) {
          if ((tx + 0.5 - cx) ** 2 + (ty + 0.5 - cy) ** 2 <= rt * rt) v[ty * width + tx] = 2;
        }
      }
    }
    this.visionVersion++;
  }

  /**
   * The own buildings a building placed at (x, y) would link to: the same rule
   * (`gap` within either side's reach) the server uses for power networks.
   */
  linksFor(x: number, y: number, size: number, reach: number): number[] {
    const node: PowerNode = { e: -1, owner: this.myId, x, y, size, reach };
    return this.powerNodes.filter((n) => n.owner === this.myId && gap(node, n) <= Math.max(reach, n.reach)).map((n) => n.e);
  }

  /** The own power network a building belongs to. */
  networkOf(e: number): NetworkInfo | undefined {
    return this.networks.find((n) => n.members.includes(e));
  }

  /** Called on every (re)welcome: owner-only data is about to be resent. */
  resetSession(): void {
    this.tasks.clear();
    this.programs.clear();
    this.setNetworks([]);
  }

  applyTasks(updates: number[][]): void {
    for (const [e, ...queue] of updates) this.tasks.set(e, queue);
  }

  /** Call after applying a tick, before world.flush(): updates occupancy and links if buildings changed. */
  afterTick(): void {
    for (const e of this.world.despawned) this.tasks.delete(e);
    const changed =
      this.world.despawned.length > 0 ||
      this.construction.removed.length > 0 ||
      this.unit.changed.some((e) => this.isStructure(e)) ||
      this.modules.changed.some((e) => this.isStructure(e));
    if (changed) this.refreshStructures();
  }

  /** Blueprint info can arrive after the buildings themselves. */
  refreshStructures(): void {
    this.terrain.clearOccupancy();
    const nodes: PowerNode[] = [];
    for (const e of [...this.unit.dense].sort((a, b) => a - b)) {
      const s = this.stats(e);
      if (!s?.structure) continue;
      const f = this.footprint(e);
      this.terrain.occupy(f.x, f.y, f.size, 1);
      nodes.push({ e, owner: this.unit.f.owner[e], x: f.x, y: f.y, size: f.size, reach: s.linkRange, site: this.isSite(e) });
    }
    this.powerNodes = nodes;
    this.links = powerLinks(nodes).map(([i, j]) => [nodes[i].e, nodes[j].e]);
    this.flows = this.orientFlows(nodes.map((n) => n.e));
    this.structureVersion++;
  }

  /** New owner-only network reports: they carry the energy each building moved. */
  setNetworks(list: NetworkInfo[]): void {
    this.networks = list;
    this.flows = this.orientFlows(this.powerNodes.map((n) => n.e));
  }

  /**
   * Orients each link away from the nearest source: generators, or (in networks
   * without generators) storage. Breadth-first distance from the sources decides
   * which end is "upstream"; links between equally distant buildings get no dots.
   */
  private orientFlows(buildings: number[]): PowerFlow[] {
    const neighbours = new Map<number, number[]>();
    for (const e of buildings) neighbours.set(e, []);
    for (const [a, b] of this.links) {
      neighbours.get(a)!.push(b);
      neighbours.get(b)!.push(a);
    }
    const working = (e: number) => !this.isSite(e);
    const isGenerator = (e: number) => working(e) && (this.stats(e)!.caps & Caps.Generator) !== 0;
    const isStorage = (e: number) => working(e) && (this.stats(e)!.caps & Caps.Storage) !== 0;

    // Group into networks, then pick each network's sources.
    const distance = new Map<number, number>();
    const seen = new Set<number>();
    for (const start of buildings) {
      if (seen.has(start)) continue;
      const members: number[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const e = stack.pop()!;
        members.push(e);
        for (const n of neighbours.get(e)!) if (!seen.has(n)) (seen.add(n), stack.push(n));
      }
      let sources = members.filter(isGenerator);
      if (!sources.length) sources = members.filter(isStorage);
      const queue = [...sources];
      for (const s of sources) distance.set(s, 0);
      while (queue.length) {
        const e = queue.shift()!;
        for (const n of neighbours.get(e)!) {
          if (distance.has(n)) continue;
          distance.set(n, distance.get(e)! + 1);
          queue.push(n);
        }
      }
    }

    const flows: PowerFlow[] = [];
    const measured = new Set<number>();
    for (const net of this.networks) {
      if (net.members.every((e) => neighbours.has(e))) {
        flows.push(...measureFlows(net, neighbours));
        for (const e of net.members) measured.add(e);
      }
    }
    for (const [a, b] of this.links) {
      if (measured.has(a)) continue;
      const da = distance.get(a);
      const db = distance.get(b);
      if (da === undefined || db === undefined || da === db) continue;
      flows.push(da < db ? { from: a, to: b, amount: null } : { from: b, to: a, amount: null });
    }
    return flows;
  }
}

/**
 * Energy over each link of an own network, from what each member took (positive)
 * or gave (negative) last tick. Power is routed back towards the givers along
 * shortest paths: each building's draw, plus whatever it passes on, is split
 * evenly between its neighbours one step closer to a giver.
 */
export function measureFlows(net: Pick<NetworkInfo, 'members' | 'flow'>, neighbours: ReadonlyMap<number, readonly number[]>): PowerFlow[] {
  const inNet = new Set(net.members);
  const sources = net.members.filter((_, i) => (net.flow[i] ?? 0) < 0);
  if (!sources.length) return [];
  const distance = new Map<number, number>(sources.map((e) => [e, 0]));
  const order = [...sources];
  for (let k = 0; k < order.length; k++) {
    const e = order[k];
    for (const n of neighbours.get(e) ?? []) {
      if (!inNet.has(n) || distance.has(n)) continue;
      distance.set(n, distance.get(e)! + 1);
      order.push(n);
    }
  }
  const carry = new Map<number, number>(net.members.map((e, i) => [e, Math.max(0, net.flow[i] ?? 0)]));
  const flows: PowerFlow[] = [];
  // Furthest first, so each building knows everything it passes on before splitting it.
  for (let k = order.length - 1; k >= 0; k--) {
    const e = order[k];
    const d = distance.get(e)!;
    if (d === 0) continue;
    const amount = carry.get(e)!;
    const parents = (neighbours.get(e) ?? []).filter((n) => distance.get(n) === d - 1);
    for (const p of parents) {
      flows.push({ from: p, to: e, amount: amount / parents.length });
      carry.set(p, carry.get(p)! + amount / parents.length);
    }
  }
  return flows;
}
