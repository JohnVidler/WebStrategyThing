import { Caps, type Blueprint } from './blueprint';
import { CommandError, type Simulation } from './simulation';
import { flip, NEUTRAL, CORNERS, setUpPlayer, type Corner } from './map';
import { TILE } from './parts';
import { gap, type PowerNode } from './power';
import { factoryCanBuild, MAX_UNITS_PER_PLAYER, STARTING_CREDITS } from './rules';
import { TaskType } from './tasks';
import { inVision, viewersOf } from './vision';

/**
 * A computer opponent that plays the same game a person does, with no cheats: it mines with
 * harvesters, builds power, silos, factories and defences with builders, spreads to new resource
 * fields, scouts, and attacks and defends with the units it trains. It sees only what its own
 * units and buildings see (plus where the map's start corners are, which every player knows).
 *
 * It thinks once a second, from census to plan: count what it has, update what it knows about the
 * enemy, then spend (structures, then units) and then move the army. All of it is deterministic:
 * no random numbers, only the tick counter and entity order.
 */

/** Ticks between decisions (10 ticks = 1 second). Bots are staggered by owner id. */
export const AI_THINK_TICKS = 10;
/** The first attack leaves no earlier than this many ticks in (times `pace`), with at least AI_ATTACK_BASE matter of units. */
export const AI_FIRST_ATTACK_TICKS = 2100;
/** Matter worth of idle fighters needed to launch wave 0; each wave sent adds AI_ATTACK_GROWTH, up to AI_ATTACK_MAX. */
export const AI_ATTACK_BASE = 600;
export const AI_ATTACK_GROWTH = 250;
export const AI_ATTACK_MAX = 9000;
/** Units each factory keeps queued. */
export const AI_QUEUE_DEPTH = 2;
/** Most construction sites open at once (one more per two builders). */
export const AI_MAX_SITES = 3;
/** Tiles around its own buildings in which enemy fighters count as an attack on the base. */
export const AI_DEFEND_RADIUS = 14;
/** Most resource fields beyond the home field the AI will claim. */
export const AI_MAX_EXPANSIONS = 3;
/** Ticks between starting one expansion and the next. */
export const AI_EXPANSION_COOLDOWN = 1800;
/** Ticks after which an expansion that is not finished is given up (and the field tried again much later). */
export const AI_EXPANSION_TIMEOUT = 4800;
/** Longest straight hop of a pylon chain in tiles (a pylon links 12 tiles edge to edge). */
const PYLON_HOP = 10;

/** The AI's view of a player-facing controller: the server only needs to step it. */
export interface BotController {
  step(): void;
  readonly wavesSent: number;
}

interface Seen {
  x: number;
  y: number;
  structure: boolean;
  fighter: boolean;
  armed: boolean;
  cost: number;
  tick: number;
}

interface Cluster {
  x: number;
  y: number;
  patches: number;
  /** Tick before which the cluster must not be tried again (after a failure). */
  blockedUntil: number;
}

interface Expansion {
  cluster: Cluster;
  /** A forward charging post instead of a resource field: a pylon chain, a charging pad and a turret. */
  outpost: boolean;
  stage: 'path' | 'pylon' | 'silo' | 'guard' | 'done';
  site: number;
  guards: number;
  retries: number;
  /** Tick it started; an expansion that takes more than AI_EXPANSION_TIMEOUT ticks is given up. */
  since: number;
}

/** A unit the AI may train, the earliest tick it joins the rotation and how often it is picked relative to the others. */
interface Recipe {
  readonly name: string;
  readonly weight: number;
  readonly from: number;
}

const ARMY: readonly Recipe[] = [
  { name: 'Scout', weight: 3, from: 0 },
  { name: 'Tank', weight: 3, from: 0 },
  { name: 'Dart', weight: 1, from: 1800 },
  { name: 'Rocket Truck', weight: 2, from: 2400 },
  { name: 'Lancer', weight: 1, from: 3000 },
  { name: 'Stormer', weight: 1, from: 4200 },
  { name: 'Rocket Artillery', weight: 1, from: 6000 },
];

export class AiPlayer implements BotController {
  private wave = 0;
  private nextAttack: number;
  private noAttackUntil = 0;
  private lastScoutAt = -Infinity;
  private scoutLeg = 0;
  private expansionAt = 0;
  private readonly credit = new Map<string, number>();

  private readonly classes = new Map<string, Blueprint>();
  private readonly seen = new Map<number, Seen>();
  private readonly allies = new Set<number>();
  private readonly clusters: Cluster[] = [];
  private readonly expansions: Expansion[] = [];
  /** Tiles at or next to a resource field: nothing is built there, so harvesters keep their space. */
  private readonly fieldTiles = new Set<number>();
  /** Where an enemy base may be before anyone has seen one (tile coordinates), and whether sight has shown it empty. */
  private readonly guesses: { x: number; y: number; cleared: boolean }[] = [];

  // Census (rebuilt every think).
  private harvesters: number[] = [];
  private builders: number[] = [];
  private fighters: number[] = [];
  private scouts: number[] = [];
  private structures: number[] = [];
  private readonly have = new Map<string, number>();
  private readonly sites = new Map<string, number>();
  private readonly queued = new Map<string, number>();
  private siteDebt = 0;
  private home = { x: 0, y: 0 };
  private rally = { x: 0, y: 0 };
  private threat: { x: number; y: number; cost: number } | undefined;
  private nodes: PowerNode[] = [];

  constructor(
    private readonly sim: Simulation,
    readonly owner: number,
    classes: readonly Blueprint[],
    /** Stretches the time before attacks (1 = normal; more is slower and gentler). */
    private readonly pace = 1,
  ) {
    for (const bp of classes) this.classes.set(bp.name, bp);
    this.nextAttack = Math.round(AI_FIRST_ATTACK_TICKS * pace);
    this.survey();
  }

  /** Number of attacks launched so far. */
  get wavesSent(): number {
    return this.wave;
  }

  /** Call once per tick, before Simulation.step(). */
  step(): void {
    const sim = this.sim;
    if ((sim.tick + this.owner) % AI_THINK_TICKS !== 0) return;
    this.census();
    if (this.structures.length === 0) return;
    this.observe();
    this.plan();
    this.produce();
    this.command();
  }

  // --- set-up: the map as the AI knows it ----------------------------------------------

  /** Resource clusters, the tiles to keep clear of buildings and the places an enemy base may be. */
  private survey(): void {
    const sim = this.sim;
    for (const e of sim.resource.dense) {
      const x = sim.tileX(sim.pos.f.x[e]);
      const y = sim.tileY(sim.pos.f.y[e]);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) this.fieldTiles.add((y + j) * sim.config.width + x + i);
      if (!sim.resourcePatch.has(e) || sim.resourcePatch.f.maximum[e] < 500) continue;
      const near = this.clusters.find((c) => Math.hypot(c.x - x, c.y - y) <= 7);
      if (near) {
        near.x = (near.x * near.patches + x) / (near.patches + 1);
        near.y = (near.y * near.patches + y) / (near.patches + 1);
        near.patches++;
      } else this.clusters.push({ x, y, patches: 1, blockedUntil: 0 });
    }
    const hq = sim.unit.dense.find((e) => sim.unit.f.owner[e] === this.owner && sim.stats(e).structure && sim.stats(e).factory);
    if (hq !== undefined) this.home = { x: sim.tileX(sim.pos.f.x[hq]), y: sim.tileY(sim.pos.f.y[hq]) };
    const { width, height } = sim.config;
    const points = CORNERS.map((c) => ({ x: flip(c.flipX, 7, 1, width), y: flip(c.flipY, 8, 1, height) }));
    points.push({ x: Math.floor(width / 2), y: Math.floor(height / 2) });
    for (const p of points) if (Math.hypot(p.x - this.home.x, p.y - this.home.y) > 20) this.guesses.push({ ...p, cleared: false });
    // The cluster by home is the one already being mined.
    const own = this.clusters.reduce<Cluster | undefined>((b, c) => (!b || this.dist(c, this.home) < this.dist(b, this.home) ? c : b), undefined);
    if (own) this.expansions.push({ cluster: own, outpost: false, stage: 'done', site: -1, guards: 0, retries: 0, since: 0 });
  }

  private dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // --- census and knowledge ------------------------------------------------------------

  private census(): void {
    const sim = this.sim;
    this.harvesters = [];
    this.builders = [];
    this.fighters = [];
    this.scouts = [];
    this.structures = [];
    this.have.clear();
    this.sites.clear();
    this.queued.clear();
    this.allies.clear();
    this.allies.add(this.owner);
    this.siteDebt = 0;
    this.nodes = [];
    let hx = 0, hy = 0;
    for (const e of sim.unit.dense) {
      const o = sim.unit.f.owner[e];
      if (o !== this.owner) {
        if (o !== NEUTRAL && sim.allied(this.owner, o)) this.allies.add(o);
        continue;
      }
      const s = sim.stats(e);
      const name = sim.blueprintOf(e)?.name ?? '';
      if (s.structure) {
        if (sim.isSite(e)) {
          this.sites.set(name, (this.sites.get(name) ?? 0) + 1);
          this.siteDebt += Math.max(0, s.cost - (sim.invested[e] ?? 0));
          continue;
        }
        this.have.set(name, (this.have.get(name) ?? 0) + 1);
        this.structures.push(e);
        const f = sim.footprintOf(e);
        this.nodes.push({ e, owner: o, x: f.x, y: f.y, size: f.size, reach: s.linkRange });
        hx += f.x + f.size / 2;
        hy += f.y + f.size / 2;
        const queue = sim.productionQueue[e];
        if (queue) {
          for (const id of queue) {
            const qn = sim.blueprints.get(id)?.name ?? '';
            this.queued.set(qn, (this.queued.get(qn) ?? 0) + 1);
          }
        }
      } else if (name === 'Harvester') this.harvesters.push(e);
      else if (name === 'Builder') this.builders.push(e);
      else if (name === 'Pathfinder' || name === 'Mite') this.scouts.push(e);
      else if (s.caps & Caps.Fight && s.caps & Caps.Move) this.fighters.push(e);
    }
    if (this.structures.length) this.home = { x: Math.round(hx / this.structures.length), y: Math.round(hy / this.structures.length) };
  }

  /** What is in sight: remembers enemy buildings (until they die) and fresh sightings of units; finds the nearest attack on the base. */
  private observe(): void {
    const sim = this.sim;
    const viewers = viewersOf(sim.world, this.allies, (e) => sim.stats(e), (e) => sim.isSite(e), sim.sunNow());
    const own = this.structures.map((e) => sim.footprintOf(e));
    let tx = 0, ty = 0, tc = 0, tn = 0;
    for (const e of sim.unit.dense) {
      const o = sim.unit.f.owner[e];
      if (o === NEUTRAL || this.allies.has(o)) continue;
      const x = sim.pos.f.x[e];
      const y = sim.pos.f.y[e];
      if (!inVision(viewers, x, y)) continue;
      const s = sim.stats(e);
      const fighter = !s.structure && (s.caps & Caps.Fight) !== 0;
      this.seen.set(sim.world.handle(e), {
        x: sim.tileX(x),
        y: sim.tileY(y),
        structure: s.structure,
        fighter,
        armed: s.weapon !== null,
        cost: s.cost,
        tick: sim.tick,
      });
      if (!fighter) continue;
      const px = sim.tileX(x);
      const py = sim.tileY(y);
      if (own.some((f) => Math.hypot(f.x + f.size / 2 - px, f.y + f.size / 2 - py) <= AI_DEFEND_RADIUS)) {
        tx += px;
        ty += py;
        tc += s.cost;
        tn++;
      }
    }
    if (sim.tick % 300 < AI_THINK_TICKS) this.learnStarts();
    this.threat = tn ? { x: Math.round(tx / tn), y: Math.round(ty / tn), cost: tc } : undefined;
    for (const [h, s] of this.seen) {
      if (sim.world.resolve(h) < 0 || (!s.structure && sim.tick - s.tick > 300)) this.seen.delete(h);
    }
    for (const g of this.guesses) {
      if (g.cleared || !inVision(viewers, g.x * TILE, g.y * TILE)) continue;
      let any = false;
      for (const s of this.seen.values()) if (s.structure && Math.hypot(s.x - g.x, s.y - g.y) <= 10) any = true;
      if (!any) g.cleared = true;
    }
    this.rally = this.rallyPoint();
  }

  /**
   * Where each opponent started. Who is playing and where the start positions are is known to everyone before the
   * match (the lobby shows it), so this reads the enemy headquarters' places, not what is inside the fog.
   */
  private learnStarts(): void {
    const sim = this.sim;
    const found: { x: number; y: number; cleared: boolean }[] = [];
    for (const e of sim.unit.dense) {
      const o = sim.unit.f.owner[e];
      if (o === NEUTRAL || this.allies.has(o)) continue;
      const s = sim.stats(e);
      if (!s.structure || !s.factory || !s.depot || sim.isSite(e)) continue;
      const g = { x: sim.tileX(sim.pos.f.x[e]), y: sim.tileY(sim.pos.f.y[e]), cleared: false };
      if (!found.some((f) => this.dist(f, g) < 20)) found.push(g);
    }
    if (!found.length) return;
    if (!this.knowsStarts) this.guesses.length = 0;
    this.knowsStarts = true;
    for (const g of found) if (!this.guesses.some((x) => this.dist(x, g) < 20)) this.guesses.push(g);
  }

  private knowsStarts = false;

  /** The own charging pad nearest the enemy (the army waits where it can recharge), else home, as a tile position. */
  private forwardPost(): { x: number; y: number } {
    const focus = this.focus();
    let best = this.home;
    let bestD = this.dist(this.home, focus);
    for (const n of this.nodes) {
      if (this.sim.blueprintOf(n.e)?.name !== 'Charging Pad') continue;
      const c = { x: n.x + n.size / 2, y: n.y + n.size / 2 };
      const d = this.dist(c, focus);
      if (d < bestD && d > 14) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  /** A few tiles out from the forward-most building on the side the enemy is on. */
  private rallyPoint(): { x: number; y: number } {
    const post = this.forwardPost();
    const p = this.toward(this.focus(), post === this.home ? 9 : 5, post);
    const cell = this.sim.terrain.nearestWalkable(p.x, p.y, 8);
    return cell ? { x: cell[0], y: cell[1] } : this.home;
  }

  /** The enemy position that matters most right now: its nearest known building, else the nearest place a base may be. */
  private focus(): { x: number; y: number } {
    let best: { x: number; y: number } | undefined;
    let bestD = Infinity;
    for (const s of this.seen.values()) {
      if (!s.structure) continue;
      const d = this.dist(s, this.home);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    for (const g of this.guesses) {
      if (g.cleared) continue;
      const d = this.dist(g, this.home);
      if (d < bestD && !best) {
        best = g;
        bestD = d;
      }
    }
    return best ?? { x: this.sim.config.width / 2, y: this.sim.config.height / 2 };
  }

  // --- helpers --------------------------------------------------------------------------

  private count(name: string): number {
    return (this.have.get(name) ?? 0) + (this.sites.get(name) ?? 0);
  }

  private idle(e: number): boolean {
    const sim = this.sim;
    if ((sim.tasks[e]?.count ?? 1) !== 0) return false;
    return !(sim.builder.has(e) && sim.world.resolve(sim.builder.f.target[e]) >= 0);
  }

  private tryCommand(fn: () => unknown): boolean {
    try {
      fn();
      return true;
    } catch (err) {
      if (!(err instanceof CommandError)) throw err;
      return false;
    }
  }

  private move(e: number, x: number, y: number): void {
    this.tryCommand(() => this.sim.issueCommand(this.owner, e, TaskType.Move, x, y, -1, false));
  }

  private attackMove(e: number, x: number, y: number): void {
    this.tryCommand(() => this.sim.issueCommand(this.owner, e, TaskType.Attack, x, y, -1, false));
  }

  /** Whether a building of this size and reach, put here, would be linked into the base's power network (and so be paid from the pool). */
  private supplied(tx: number, ty: number, size: number, reach: number): boolean {
    const site: PowerNode = { e: -1, owner: this.owner, x: tx, y: ty, size, reach, site: true };
    return this.nodes.some((n) => gap(site, n) <= Math.max(site.reach, n.reach));
  }

  /** The nearest free spot (top-left tile) to (ax, ay) with a tile of space round it, clear of resource fields and, if asked, linked to the base's power. */
  private findSpot(bp: Blueprint, ax: number, ay: number, maxR: number, needSupply = true): [number, number] | undefined {
    const sim = this.sim;
    const size = bp.stats.footprint;
    const w = sim.config.width;
    const off = size >> 1;
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        const edge = dy === -r || dy === r;
        for (let dx = -r; dx <= r; dx += edge ? 1 : 2 * r) {
          const x = ax + dx - off;
          const y = ay + dy - off;
          if (!sim.terrain.footprintFree(x - 1, y - 1, size + 2)) continue;
          let onField = false;
          for (let j = 0; j < size && !onField; j++) for (let i = 0; i < size; i++) if (this.fieldTiles.has((y + j) * w + x + i)) onField = true;
          if (onField) continue;
          if (needSupply && !this.supplied(x, y, size, bp.stats.linkRange)) continue;
          return [x, y];
        }
      }
    }
    return undefined;
  }

  /** Puts down a construction site near (ax, ay); idle builders (the nearest two) are sent to it. Returns the site, or -1. */
  private buildNear(name: string, ax: number, ay: number, maxR = 8): number {
    const bp = this.classes.get(name);
    if (!bp || bp.retired) return -1;
    const spot = this.findSpot(bp, ax, ay, maxR);
    return spot ? this.buildAt(bp, spot) : -1;
  }

  /** Puts down a construction site with its top-left tile at `spot`. */
  private buildAt(bp: Blueprint, spot: readonly [number, number]): number {
    const sim = this.sim;
    const name = bp.name;
    this.blind = false;
    const crew = this.builders
      .filter((b) => this.idle(b))
      .sort((a, b) => Math.hypot(sim.tileX(sim.pos.f.x[a]) - spot[0], sim.tileY(sim.pos.f.y[a]) - spot[1]) - Math.hypot(sim.tileX(sim.pos.f.x[b]) - spot[0], sim.tileY(sim.pos.f.y[b]) - spot[1]) || a - b)
      .slice(0, 2);
    try {
      const site = sim.placeBlueprint(this.owner, bp.id, spot[0], spot[1], crew, false);
      this.siteDebt += bp.stats.cost;
      this.sites.set(name, (this.sites.get(name) ?? 0) + 1);
      return site;
    } catch (err) {
      if (!(err instanceof CommandError)) throw err;
      // Fog: you can only build where you can see. Walk a builder over, and try again next time.
      if (/vision/.test(err.message)) {
        this.blind = true;
        const scout = crew[0] ?? this.builders[0];
        if (scout !== undefined) this.move(scout, spot[0], spot[1]);
      }
      return -1;
    }
  }

  /** Set when the last placement failed for want of vision (a builder has been sent to look). */
  private blind = false;

  /** The point `d` tiles from `home` towards `to`. */
  private toward(to: { x: number; y: number }, d: number, from = this.home): { x: number; y: number } {
    const len = Math.max(1, this.dist(to, from));
    return { x: Math.round(from.x + ((to.x - from.x) / len) * d), y: Math.round(from.y + ((to.y - from.y) / len) * d) };
  }

  // --- the plan: what to build ------------------------------------------------------------

  /** Matter in the silos that is not already promised to open sites. */
  private free(): number {
    return this.sim.pool(this.owner) - this.siteDebt;
  }

  /** True when the buildings' batteries hold less than the given share of their capacity. */
  private energyBelow(share: number): boolean {
    const sim = this.sim;
    let have = 0, cap = 0;
    for (const e of this.structures) {
      cap += sim.stats(e).energyCapacity;
      have += sim.energy.f.amount[e];
    }
    return cap > 0 && have < cap * share;
  }

  private openSites(): number {
    let n = 0;
    for (const c of this.sites.values()) n += c;
    return n;
  }

  /** Whether to hold matter back for something not yet affordable instead of training more army. */
  private saving = false;

  private plan(): void {
    const sim = this.sim;
    const t = sim.tick;
    const pool = sim.pool(this.owner);
    const cap = sim.poolCapacity(this.owner);
    const h = this.harvesters.length;
    const maxSites = AI_MAX_SITES + (this.builders.length >> 1);
    this.saving = false;
    if (this.builders.length === 0) return;
    const front = this.toward(this.focus(), 8);
    const back = this.toward(this.focus(), -5);
    const can = (name: string, share = 1): boolean => {
      const bp = this.classes.get(name);
      if (!bp || this.openSites() >= maxSites) return false;
      if (this.free() >= bp.stats.cost * share) return true;
      this.saving = !this.threat;
      return false;
    };

    // Storage: a full silo wastes every load a harvester brings.
    if (pool > cap * 0.7 && !this.sites.get('Resource Silo') && can('Resource Silo', 0.5)) this.buildNear('Resource Silo', back.x, back.y, 10);

    // Power: enough generators for what is running, more when the batteries run low.
    const factories = this.count('Light Factory') + this.count('Vehicle Factory');
    const turrets = this.count('Laser Turret') + this.count('Flak Turret');
    const gens = this.count('Wind Turbine') + this.count('Solar Array');
    const wantGens = 3 + factories + (turrets >> 1) + (h >> 2) + (this.energyBelow(0.35) ? 2 : 0);
    if (gens < wantGens && !this.sites.get('Wind Turbine') && !this.sites.get('Solar Array')) {
      const kind = this.count('Wind Turbine') <= this.count('Solar Array') * 2 ? 'Wind Turbine' : 'Solar Array';
      if (can(kind, 0.5)) this.buildNear(kind, back.x, back.y, 10);
    }
    const stores = this.count('Small Energy Storage') + this.count('Energy Storage');
    if (stores < 1 + (gens >> 2) && gens >= 4 && !this.sites.get('Small Energy Storage') && can('Small Energy Storage')) this.buildNear('Small Energy Storage', back.x, back.y, 10);

    // A second field is worth more than another factory: it comes right after the basics.
    this.expand(t, h);

    // Production: another factory as the income grows.
    const wantFactories = h >= 11 ? 4 : h >= 8 ? 3 : h >= 5 ? 2 : h >= 3 ? 1 : 0;
    if (factories < wantFactories && !this.sites.get('Vehicle Factory') && !this.sites.get('Light Factory')) {
      const kind = this.count('Vehicle Factory') <= this.count('Light Factory') ? 'Vehicle Factory' : 'Light Factory';
      if (can(kind)) this.buildNear(kind, this.home.x, this.home.y, 10);
    }

    // Defences: turrets between the base and the enemy, more as the game goes on or when attacked.
    const wantTurrets = Math.min(8, 1 + Math.floor(t / 2400) + (this.threat ? 2 : 0));
    if (turrets < wantTurrets && t > 900 && !this.sites.get('Laser Turret') && can('Laser Turret')) {
      this.buildNear('Laser Turret', front.x, front.y, 8);
    }
    if (this.seenMissiles() && this.count('Flak Turret') < 2 && !this.sites.get('Flak Turret') && can('Flak Turret')) this.buildNear('Flak Turret', this.home.x, this.home.y, 9);

    // Upkeep: a tower to mend the base, and charging pads for the army.
    if (t > 2400 && h >= 5 && this.count('Construction Tower') < 1 && can('Construction Tower')) this.buildNear('Construction Tower', this.home.x, this.home.y, 8);
    if (this.count('Charging Pad') < 2 + Math.floor(this.fighters.length / 10) && !this.sites.get('Charging Pad') && t > 1200 && can('Charging Pad')) {
      const post = this.forwardPost();
      const at = this.toward(this.focus(), -3, post);
      this.buildNear('Charging Pad', at.x, at.y, 6);
    }
  }

  private seenMissiles(): boolean {
    return this.sim.missile.dense.some((m) => !this.allies.has(this.sim.missile.f.owner[m]));
  }

  // --- expansion: a pylon chain, a silo and turrets at a new field -------------------------

  private expand(t: number, h: number): void {
    const sim = this.sim;
    let cur = this.expansions.find((x) => x.stage !== 'done');
    if (!cur) {
      if (h < 5 || t < this.expansionAt || this.expansions.length > AI_MAX_EXPANSIONS + 2) return;
      const c = this.nextCluster(t);
      const post = this.needForward ? this.outpostSite() : undefined;
      const outpost = !!post && (!c || this.needForward);
      const aim = outpost ? { x: post!.x, y: post!.y, patches: 0, blockedUntil: 0 } : c;
      if (!aim) return;
      if (this.free() < (outpost ? 250 : 300)) {
        this.saving = !this.threat;
        return;
      }
      cur = { cluster: aim, outpost, stage: 'path', site: -1, guards: 0, retries: 0, since: t };
      this.expansions.push(cur);
      this.expansionAt = t + AI_EXPANSION_COOLDOWN;
    }
    const target = cur.cluster;
    const kind = cur.outpost ? 'Charging Pad' : 'Resource Silo';
    const alive = cur.site >= 0 ? sim.world.resolve(cur.site) : -1;
    const fail = () => {
      target.blockedUntil = t + 6000;
      if (cur!.outpost) this.outpostBlockedUntil = t + 3000;
      cur!.stage = 'done';
      this.expansions.splice(this.expansions.indexOf(cur!), 1);
    };
    if (cur.stage !== 'guard' && t - cur.since > AI_EXPANSION_TIMEOUT) return fail();
    switch (cur.stage) {
      case 'pylon':
      case 'silo':
        if (alive < 0) {
          if (cur.stage === 'silo') fail();
          else cur.stage = 'path';
          return;
        }
        if (sim.isSite(alive)) return;
        cur.stage = cur.stage === 'pylon' ? 'path' : 'guard';
        if (cur.stage === 'path') this.expand(t, h);
        return;
      case 'path': {
        const bp = this.classes.get(kind);
        if (!bp || this.free() < bp.stats.cost * 0.5 || this.openSites() >= AI_MAX_SITES + 1) return;
        const spot = this.findSpot(bp, Math.round(target.x), Math.round(target.y), 6);
        if (spot) {
          const site = this.buildAt(bp, spot);
          if (site >= 0) {
            cur.site = sim.world.handle(site);
            cur.stage = 'silo';
          } else if (!this.blind && ++cur.retries > 12) fail();
          return;
        }
        // Not reachable by power yet: extend the chain with a pylon towards the field.
        let near: PowerNode | undefined;
        let nearD = Infinity;
        for (const n of this.nodes) {
          const d = this.dist({ x: n.x + n.size / 2, y: n.y + n.size / 2 }, target);
          if (d < nearD) {
            near = n;
            nearD = d;
          }
        }
        if (!near) return;
        const from = { x: near.x + near.size / 2, y: near.y + near.size / 2 };
        let site = -1;
        for (const hop of [PYLON_HOP, 7, 4]) {
          const p = this.toward(target, Math.min(hop, nearD), from);
          site = this.buildNear('Power Pylon', p.x, p.y, 5);
          if (site >= 0 || this.blind) break;
        }
        if (site >= 0) {
          cur.site = sim.world.handle(site);
          cur.stage = 'pylon';
        } else if (!this.blind && ++cur.retries > 12) fail();
        return;
      }
      case 'guard': {
        // Two turrets guard a new field; an outpost gets one, and wind turbines of its own so its pads can charge.
        const kinds = cur.outpost ? ['Laser Turret', 'Wind Turbine', 'Wind Turbine'] : ['Laser Turret', 'Laser Turret'];
        if (cur.guards < kinds.length) {
          const kind = kinds[cur.guards];
          if (this.free() >= (this.classes.get(kind)?.stats.cost ?? 0) && this.buildNear(kind, Math.round(target.x), Math.round(target.y), 7) >= 0) cur.guards++;
          else if (++cur.retries > 24) cur.guards = kinds.length;
          return;
        }
        cur.stage = 'done';
        return;
      }
    }
  }

  private needForward = false;
  private outpostBlockedUntil = 0;

  /** Where a forward charging post would go: part of the way from the forward-most building to the enemy, as far as the army can still return from. */
  private outpostSite(): { x: number; y: number } | undefined {
    if (this.sim.tick < this.outpostBlockedUntil) return undefined;
    const post = this.forwardPost();
    const focus = this.focus();
    const left = this.dist(post, focus);
    const hop = Math.min(45, left - 25);
    if (hop < 12) return undefined;
    const p = this.toward(focus, hop, post);
    const cell = this.sim.terrain.nearestWalkable(p.x, p.y, 10);
    return cell ? { x: cell[0], y: cell[1] } : undefined;
  }

  /** The best field to claim next: near us, and not closer to the enemy than to us. */
  private nextCluster(t: number): Cluster | undefined {
    const focus = this.focus();
    let best: Cluster | undefined;
    let bestD = Infinity;
    for (const c of this.clusters) {
      if (c.blockedUntil > t || this.expansions.some((x) => x.cluster === c)) continue;
      const d = this.dist(c, this.home);
      if (d > 80 || d > this.dist(c, focus) * 1.1 || d >= bestD) continue;
      best = c;
      bestD = d;
    }
    return best;
  }

  // --- units -------------------------------------------------------------------------------

  private produce(): void {
    const sim = this.sim;
    const t = sim.tick;
    let free = this.free();
    const claimed = this.expansions.filter((x) => x.stage === 'done').length - 1;
    const wantHarvesters = Math.min(18, 6 + 3 * Math.max(0, claimed) + Math.floor(t / 1800));
    const wantBuilders = Math.min(4, 1 + (this.harvesters.length >= 4 ? 1 : 0) + (claimed > 0 ? 1 : 0) + (t > 6000 ? 1 : 0));
    const wantScout = t >= 300 && t - this.lastScoutAt >= 900 && this.scouts.length === 0;
    const armySize = this.fighters.length;
    for (const b of this.structures) {
      const queue = sim.productionQueue[b];
      const s = sim.stats(b);
      if (!queue || !s.factory || queue.length >= AI_QUEUE_DEPTH) continue;
      for (let slot = queue.length; slot < AI_QUEUE_DEPTH; slot++) {
        const pick = this.pick(s.factoryTiers, free, wantHarvesters, wantBuilders, wantScout, armySize);
        if (!pick) break;
        if (!this.tryCommand(() => sim.enqueueProduction(this.owner, b, pick.id))) break;
        free -= pick.stats.cost;
        this.queued.set(pick.name, (this.queued.get(pick.name) ?? 0) + 1);
        if (pick.name === 'Pathfinder') this.lastScoutAt = t;
      }
    }
  }

  private pick(tiers: number, free: number, wantH: number, wantB: number, wantScout: boolean, army: number): Blueprint | undefined {
    const ok = (name: string): Blueprint | undefined => {
      const bp = this.classes.get(name);
      return bp && !bp.retired && factoryCanBuild(tiers, bp.stats.size) && free >= bp.stats.cost ? bp : undefined;
    };
    const total = (name: string, mine: number) => mine + (this.queued.get(name) ?? 0);
    if (total('Harvester', this.harvesters.length) < wantH) {
      const bp = ok('Harvester');
      if (bp) return bp;
    }
    if (total('Builder', this.builders.length) < wantB) {
      const bp = ok('Builder');
      if (bp) return bp;
    }
    if (wantScout && !(this.queued.get('Pathfinder') ?? 0)) {
      const bp = ok('Pathfinder');
      if (bp) return bp;
    }
    if ((this.saving && army + this.queuedArmy() >= this.armyFloor()) || army + this.queuedArmy() >= MAX_UNITS_PER_PLAYER - 40) return undefined;
    // Weighted round robin over the units this factory can build and that have joined the rotation.
    const eligible: Recipe[] = [];
    let best: Recipe | undefined;
    let bestCredit = -Infinity;
    let sum = 0;
    const t = this.sim.tick;
    const flak = this.seenMissiles();
    const roster = flak ? [...ARMY, { name: 'Flak Truck', weight: 2, from: 0 }] : ARMY;
    for (const r of roster) {
      const bp = this.classes.get(r.name);
      if (r.from > t || !bp || bp.retired || !factoryCanBuild(tiers, bp.stats.size)) continue;
      eligible.push(r);
      sum += r.weight;
      const c = (this.credit.get(r.name) ?? 0) + r.weight;
      if (c > bestCredit) {
        best = r;
        bestCredit = c;
      }
    }
    if (!best) return undefined;
    // Credit only changes on a purchase, so an expensive pick is saved for rather than skipped for cheap ones.
    const bp = ok(best.name);
    if (bp) {
      for (const r of eligible) this.credit.set(r.name, (this.credit.get(r.name) ?? 0) + r.weight);
      this.credit.set(best.name, (this.credit.get(best.name) ?? 0) - sum);
    }
    return bp;
  }

  /** Fighters the AI trains whatever else it is saving for. */
  private armyFloor(): number {
    return Math.min(14, 2 + Math.floor(this.sim.tick / 500));
  }

  private queuedArmy(): number {
    let n = 0;
    for (const [name, c] of this.queued) if (name !== 'Harvester' && name !== 'Builder' && name !== 'Pathfinder') n += c;
    return n;
  }

  // --- orders: scouting, harvesting, defending and attacking ---------------------------------

  private command(): void {
    this.scout();
    this.assignHarvesters();
    this.military();
  }

  private scout(): void {
    for (const e of this.scouts) {
      if (!this.idle(e)) continue;
      const legs = this.guesses.filter((g) => !g.cleared);
      const dests: { x: number; y: number }[] = legs.length ? legs : this.clusters;
      if (!dests.length) return;
      const d = dests[this.scoutLeg++ % dests.length];
      this.move(e, d.x, d.y);
    }
  }

  /** Spreads harvesters over the claimed fields: a new field gets a few of the base's harvesters. */
  private assignHarvesters(): void {
    const sim = this.sim;
    const done = this.expansions.filter((x) => x.stage === 'done' || x.stage === 'guard');
    if (done.length < 2 || this.harvesters.length < 6) return;
    const per = Math.max(2, Math.floor(this.harvesters.length / done.length));
    const near = (e: number, c: Cluster): boolean => {
      const f = sim.world.resolve(sim.harvester.f.target[e]);
      return f >= 0 && this.dist({ x: sim.tileX(sim.pos.f.x[f]), y: sim.tileY(sim.pos.f.y[f]) }, c) <= 9;
    };
    for (const x of done) {
      if (x === done[0]) continue;
      const have = this.harvesters.filter((e) => near(e, x.cluster));
      if (have.length >= per) continue;
      const donors = this.harvesters.filter((e) => near(e, done[0].cluster));
      if (donors.length <= per) continue;
      let field = -1;
      let fd = Infinity;
      for (const r of sim.resource.dense) {
        if (sim.resource.f.amount[r] < 40) continue;
        const d = this.dist({ x: sim.tileX(sim.pos.f.x[r]), y: sim.tileY(sim.pos.f.y[r]) }, x.cluster);
        if (d < fd) {
          field = r;
          fd = d;
        }
      }
      if (field < 0) continue;
      const e = donors[0];
      this.tryCommand(() => sim.issueCommand(this.owner, e, TaskType.Harvest, 0, 0, field, false));
      return;
    }
  }

  /** How many tiles the unit can still travel on the energy it holds. */
  private range(e: number): number {
    const s = this.sim.stats(e);
    return s.motorUse > 0 ? ((this.sim.energy.f.amount[e] / s.motorUse) * s.speed) / TILE : Infinity;
  }

  private cost(list: readonly number[]): number {
    let c = 0;
    for (const e of list) c += this.sim.stats(e).cost;
    return c;
  }

  private military(): void {
    const sim = this.sim;
    const t = sim.tick;
    const near = (e: number, p: { x: number; y: number }, tiles: number): boolean =>
      Math.hypot(sim.tileX(sim.pos.f.x[e]) - p.x, sim.tileY(sim.pos.f.y[e]) - p.y) <= tiles;
    const idle = this.fighters.filter((e) => this.idle(e));
    const attacking = this.fighters.filter((e) => (sim.tasks[e]?.count ?? 0) > 0 && sim.tasks[e]!.type(0) === TaskType.Attack);

    // Defend: fighters nearby go for whatever is attacking a building of ours.
    const threat = this.threat;
    if (threat) {
      const homeArmy = this.cost(idle);
      if (attacking.length && threat.cost > homeArmy * 0.5 && this.dist(threat, this.home) < AI_DEFEND_RADIUS) {
        for (const e of attacking) if (!near(e, threat, 6)) this.attackMove(e, threat.x, threat.y);
      }
      for (const e of idle) this.attackMove(e, threat.x, threat.y);
      return;
    }

    // Retreat a failing attack: more enemy firepower round the group than the group has.
    if (attacking.length >= 3) {
      let cx = 0, cy = 0;
      for (const e of attacking) {
        cx += sim.tileX(sim.pos.f.x[e]);
        cy += sim.tileY(sim.pos.f.y[e]);
      }
      const c = { x: cx / attacking.length, y: cy / attacking.length };
      let enemy = 0;
      for (const s of this.seen.values()) if (s.armed && this.dist(s, c) <= 14 && t - s.tick < 100) enemy += s.cost;
      if (enemy > this.cost(attacking) * 1.8) {
        for (const e of attacking) this.move(e, this.rally.x, this.rally.y);
        this.noAttackUntil = t + 600;
        return;
      }
    }

    // Gather new units at the rally point.
    const gathered: number[] = [];
    for (const e of idle) {
      if (near(e, this.rally, 7)) {
        gathered.push(e);
        if (sim.energyFraction(e) < 0.5) this.tryCommand(() => sim.issueCommand(this.owner, e, TaskType.Charge, 0, 0, -1, false));
      } else if (near(e, this.home, 20) || near(e, this.rally, 20)) this.move(e, this.rally.x, this.rally.y);
    }

    // Units that finished an attack carry on to the next target.
    for (const e of idle) {
      if (near(e, this.home, 20) || near(e, this.rally, 20)) continue;
      const goal = this.pickTarget();
      if (goal) this.attackMove(e, goal.x, goal.y);
      else this.move(e, this.rally.x, this.rally.y);
    }

    // Launch the next wave when enough has gathered and it outweighs what is known of the enemy.
    if (t < this.nextAttack || t < this.noAttackUntil || !gathered.length) return;
    let need = Math.min(AI_ATTACK_MAX, AI_ATTACK_BASE + AI_ATTACK_GROWTH * this.wave) * this.pace;
    let enemy = 0;
    for (const s of this.seen.values()) if (s.armed) enemy += s.cost;
    need = Math.max(need, Math.min(AI_ATTACK_MAX, enemy * 1.2));
    if (this.cost(gathered) < need) return;
    const goal = this.pickTarget();
    if (!goal) return;
    // Batteries decide how far a unit gets: charge first, and only send those that can make the trip.
    const trip = this.dist(this.rally, goal) * 1.25;
    const ready: number[] = [];
    for (const e of gathered) {
      if (sim.energyFraction(e) < 0.6) this.tryCommand(() => sim.issueCommand(this.owner, e, TaskType.Charge, 0, 0, -1, false));
      else if (this.range(e) >= trip) ready.push(e);
    }
    this.needForward = ready.length < gathered.length * 0.4 && gathered.every((e) => sim.energyFraction(e) >= 0.6 || this.range(e) < trip);
    if (this.cost(ready) < need * 0.8) return;
    for (const e of ready) this.attackMove(e, goal.x, goal.y);
    this.wave++;
  }

  /** The place to hit: the enemy building that is closest and least covered by turrets; failing that, where a base may be. */
  private pickTarget(): { x: number; y: number } | undefined {
    let best: { x: number; y: number } | undefined;
    let bestScore = Infinity;
    const seen = [...this.seen.values()];
    for (const s of seen) {
      if (!s.structure) continue;
      let guns = 0;
      for (const o of seen) if (o.structure && o.armed && this.dist(o, s) <= 9) guns++;
      const score = this.dist(s, this.rally) + guns * 10;
      if (score < bestScore) {
        best = s;
        bestScore = score;
      }
    }
    if (best) return { x: best.x, y: best.y };
    for (const g of this.guesses) {
      if (g.cleared) continue;
      const d = this.dist(g, this.rally);
      if (d < bestScore) {
        best = g;
        bestScore = d;
      }
    }
    if (best) return { x: best.x, y: best.y };
    for (const s of seen) {
      const d = this.dist(s, this.rally);
      if (d < bestScore) {
        best = s;
        bestScore = d;
      }
    }
    return best && { x: best.x, y: best.y };
  }
}

/** Gives `owner` a full starting base in `corner` (the same one a person gets) and an AI to run it. */
export function setUpAi(sim: Simulation, owner: number, corner: Corner, pace = 1): { bot: AiPlayer; classes: Blueprint[] } {
  const classes = setUpPlayer(sim, owner, corner, STARTING_CREDITS);
  return { bot: new AiPlayer(sim, owner, classes, pace), classes };
}
