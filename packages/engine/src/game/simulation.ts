import { World } from '../ecs/world';
import { configInt, configInts, handles, type FlowProgram } from '../flow/compile';
import { CommsLink, EventId, OrderPolicy } from '../flow/events';
import { FlowError } from '../flow/ir';
import { createFlow, raise, type FlowState } from '../flow/run';
import type { Alert } from '../net/codec';
import { Rng } from '../util/rng';
import { COMMON_ACTION_BY_TASK, compileUnitProgram } from './actions';
import { activitySystem, cancelActivity, type ActivityState } from './activity';
import { VisitReason, type UnitContext } from './api';
import { DEFAULT_DESIGNS, type DesignEntry } from './designs';
import { SimEvent } from './events';
import { BlueprintError, BlueprintRegistry, Caps, CHASSIS_HIT, statsFor, type Blueprint, type BlueprintStats } from './blueprint';
import {
  Builder,
  Repairer,
  Cargo,
  Construction,
  CpuStatus,
  Energy,
  EnergyView,
  GAME_COMPONENTS,
  Harvester,
  Health,
  Missile,
  Modules,
  Motion,
  Position,
  Production,
  Resource,
  ResourcePatch,
  Stockpile,
  Storage,
  Unit,
  Weapon,
} from './components';
import { missileSystem, type MissileFlight } from './missile';
import { PARTS, SWITCHABLE, TILE } from './parts';
import { findPath } from './path';
import { emptyNetwork, powerLinks, powerNetworks, powerTopology, type PowerNetwork, type PowerNode } from './power';
import { factoryCanBuild, FACTORY_TIER_NAMES, BASE_LINK_RANGE, BUILD_RANGE, BUILDING_BUILD_RANGE, BUILDING_TRANSFER_RANGE, DEMOLISH_REFUND, DOCK_RANGE, HARVEST_RANGE, MAX_PRODUCTION_QUEUE, MAX_SITES_PER_PLAYER, RADAR_COOLDOWN_TICKS, RADAR_ENERGY_PER_TILE, SITE_START_HP, UNIT_TRANSFER_RANGE } from './rules';
import { SpatialGrid } from './spatial';
import { inVision, viewersOf } from './vision';
import {
  buildSystem,
  repairSystem,
  chargingSystem,
  combatSystem,
  deathSystem,
  decaySystem,
  energyViewSystem,
  harvestSystem,
  movementSystem,
  cheatSystem,
  powerSystem,
  productionSystem,
  resourceRegenerationSystem,
  scriptSystem,
  separationSystem,
} from './systems';
import { TaskFlag, TaskQueue, TaskType } from './tasks';
import { Terrain } from './terrain';

export interface SimConfig {
  /** Map size in tiles. */
  readonly width: number;
  readonly height: number;
  readonly seed: number;
}

/** A player command the rules refused (not enough credits, not your unit, ...). */
/** What Simulation.loadDesigns did. */
export interface DesignLoadReport {
  /** Classes whose info changed (new, or retired flag), to re-announce. */
  readonly changed: Blueprint[];
  /** Classes whose program changed, to send to the owner. */
  readonly programs: Blueprint[];
  defined: number;
  updated: number;
  retired: number;
  readonly errors: string[];
}

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

/** Per-player counters for the scoreboard (server-side only). */
export interface PlayerTally {
  createdUnits: number;
  createdBuildings: number;
  lostUnits: number;
  lostBuildings: number;
  destroyedUnits: number;
  destroyedBuildings: number;
}

/**
 * The authoritative game simulation. Deterministic given its seed, terrain and
 * the ordered list of commands applied between ticks, so it also supports
 * replays and lockstep-style verification.
 */
/** One thing a radar pulse found (sub-tile units). */
export interface RadarContact {
  x: number;
  y: number;
  owner: number;
  structure: boolean;
  /** The contact's class, so clients can draw its real art. */
  blueprint: number;
}

/** A radar pulse and everything not allied to its owner that it found. */
export interface RadarPulse {
  owner: number;
  x: number;
  y: number;
  /** Sub-tile units. */
  range: number;
  contacts: RadarContact[];
}

/**
 * Makes a player's classes match a set of designs (restoring a saved session, an
 * uploaded file, or the defaults). Each entry is matched by name to an own class:
 * same parts means its program and retired flag are updated in place; different
 * parts means a new class is defined and the old one retired (parts are fixed per
 * class). Own classes not in the set are retired, except defaults the set doesn't
 * mention (new in this build). Units already built carry on with their class.
 */
export function loadDesignsInto(
  host: { readonly blueprints: BlueprintRegistry; setProgram(blueprintId: number, source: string): unknown },
  owner: number,
  entries: readonly DesignEntry[],
  maxActive: number,
  merge = false,
): DesignLoadReport {
  const report: DesignLoadReport = { changed: [], programs: [], defined: 0, updated: 0, retired: 0, errors: [] };
  const changed = new Set<Blueprint>();
  const used = new Set<Blueprint>();
  const active = () => host.blueprints.ownedBy(owner).filter((b) => !b.retired).length;
  const retire = (bp: Blueprint) => {
    if (bp.retired) return;
    bp.retired = true;
    changed.add(bp);
    report.retired++;
  };
  const install = (bp: Blueprint, source: string): boolean => {
    if ((bp.program?.source ?? '') === source) return true;
    if (!source.trim() && !bp.program) return true;
    try {
      host.setProgram(bp.id, source);
      report.programs.push(bp);
      return true;
    } catch (err) {
      if (!(err instanceof FlowError || err instanceof BlueprintError)) throw err;
      report.errors.push(`${bp.name}: ${err.message}`);
      return false;
    }
  };
  const sameParts = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((p, i) => p === b[i]);

  for (const entry of entries) {
    const mine = host.blueprints.ownedBy(owner).filter((b) => b.name === entry.name && !used.has(b));
    const match = mine.find((b) => !b.retired && sameParts(b.parts, entry.parts)) ?? mine.find((b) => sameParts(b.parts, entry.parts));
    const retired = entry.retired === true;
    if (match) {
      used.add(match);
      const before = match.program?.source ?? '';
      if (match.retired !== retired) {
        if (!retired && active() >= maxActive) {
          report.errors.push(`${entry.name}: class limit (${maxActive}) reached`);
          continue;
        }
        match.retired = retired;
        changed.add(match);
        if (retired) report.retired++;
      }
      if (install(match, entry.program) && before !== (match.program?.source ?? '')) report.updated++;
      continue;
    }
    if (!retired && active() >= maxActive) {
      report.errors.push(`${entry.name}: class limit (${maxActive}) reached`);
      continue;
    }
    let bp: Blueprint;
    try {
      bp = host.blueprints.define(owner, entry.name, entry.parts);
    } catch (err) {
      if (!(err instanceof BlueprintError)) throw err;
      report.errors.push(`${entry.name}: ${err.message}`);
      continue;
    }
    bp.retired = retired;
    used.add(bp);
    changed.add(bp);
    report.defined++;
    install(bp, entry.program);
    // The class it replaces (same name, different parts) steps aside.
    for (const old of mine) if (!used.has(old)) (retire(old), used.add(old));
  }
  const named = new Set(entries.map((e) => e.name));
  for (const bp of host.blueprints.ownedBy(owner)) {
    if (used.has(bp) || bp.retired || merge) continue; // merging leaves classes the set doesn't mention alone
    if (!named.has(bp.name) && DEFAULT_DESIGNS.has(bp.name)) continue; // a default this set predates
    retire(bp);
  }
  report.changed.push(...changed);
  return report;
}

export class Simulation {
  readonly world = new World(GAME_COMPONENTS, 1024);
  readonly blueprints = new BlueprintRegistry();
  readonly rng: Rng;
  readonly spatial: SpatialGrid;
  readonly scriptCtx: UnitContext;
  readonly terrain: Terrain;
  tick = 0;
  /** Flat buffer for this tick: [type, a, b, type, a, b, ...]. */
  readonly events: number[] = [];
  /** Speech bubbles raised this tick by `alert()`; the server replicates them, and commit() clears them. */
  readonly alerts: Alert[] = [];
  /** Radar pulses fired this tick; the server reports them to their owners, and commit() clears them. */
  readonly radarPulses: RadarPulse[] = [];
  /** Tick at which each radar-carrying unit (by handle) may pulse again. */
  private readonly radarReady = new Map<number, number>();

  // Server-only per-entity side tables (never replicated).
  readonly flows: (FlowState | undefined)[] = [];
  /** Each unit's current activity (a long job the engine carries out), and the ones put aside for later. */
  readonly activities: (ActivityState | undefined)[] = [];
  readonly suspended: (ActivityState[] | undefined)[] = [];
  /** Units that have an activity, in the order they started (so ticking them is deterministic). */
  readonly activeUnits = new Set<number>();
  readonly tasks: (TaskQueue | undefined)[] = [];
  /** Remaining waypoints in sub-tile units [x, y, ...]. */
  readonly paths: (number[] | undefined)[] = [];
  readonly stuckTicks: number[] = [];
  readonly lastDistance: number[] = [];
  /** CPU energy owed, in hundredths of an energy unit (cycles × use, billed per 100). */
  readonly cpuDebt: number[] = [];
  /** Building -> handle of the unit it may currently order (-1 = none). */
  readonly visiting: number[] = [];
  /** Factory -> queued blueprint ids, and ticks spent on the front one. */
  readonly productionQueue: (number[] | undefined)[] = [];
  readonly productionTicks: number[] = [];
  /** Construction site -> resources invested so far. */
  readonly invested: number[] = [];
  readonly tallies = new Map<number, PlayerTally>();
  /** Missile entity -> the parts of its flight that are not replicated (see missile.ts). */
  readonly flights: (MissileFlight | undefined)[] = [];
  /** Entity -> owner of the last weapon that damaged it (0 = none). */
  readonly lastHitBy: number[] = [];
  /** Building -> generation left over from last tick (in 1/100 of 1/GENERATION_SCALE energy). */
  readonly genCarry: number[] = [];
  /** Matter each repair module has paid for but not yet used (matter is bought in whole units). */
  readonly repairCarry: number[] = [];
  /** Entity -> damage each of its modules has taken (by part index); made on the first hit that lands on a module. */
  readonly moduleDamage: (Uint16Array | undefined)[] = [];
  /** Hits that have landed on a module, to vary the roll between hits in one tick. */
  private hitCount = 0;
  /** Team per owner (co-op mode: the humans share one, the bots another). Owners without a team are only allied to themselves. */
  readonly teams = new Map<number, number>();
  /** Buildings may only be placed within the owner's (or their team's) vision; off when fog of war is. */
  requirePlacementVision = false;
  /** Owners kept at full energy with full silos (co-op mode bots). */
  readonly cheaters = new Set<number>();
  /** Entity -> tick until which its CPU is stunned. */
  readonly stunUntil: number[] = [];
  /** Entity -> consecutive ticks spent without energy (units decay after DECAY_TICKS). */
  readonly flatTicks: number[] = [];
  /** Power networks (rebuilt when buildings or antennas change). */
  networks: PowerNetwork[] = [];
  readonly networkOf: number[] = [];
  powerDirty = true;

  // Store objects are stable for the world's lifetime, so cache them.
  readonly pos = this.world.store(Position);
  readonly unit = this.world.store(Unit);
  readonly health = this.world.store(Health);
  readonly cpu = this.world.store(CpuStatus);
  readonly resource = this.world.store(Resource);
  readonly resourcePatch = this.world.store(ResourcePatch);
  readonly cargo = this.world.store(Cargo);
  readonly production = this.world.store(Production);
  readonly energyView = this.world.store(EnergyView);
  readonly modules = this.world.store(Modules);
  readonly motion = this.world.store(Motion);
  readonly weapon = this.world.store(Weapon);
  readonly harvester = this.world.store(Harvester);
  readonly energy = this.world.store(Energy);
  readonly storage = this.world.store(Storage);
  readonly stockpile = this.world.store(Stockpile);
  readonly construction = this.world.store(Construction);
  readonly builder = this.world.store(Builder);
  readonly repairer = this.world.store(Repairer);
  readonly missile = this.world.store(Missile);

  constructor(
    readonly config: SimConfig,
    terrain?: Terrain,
  ) {
    this.rng = new Rng(config.seed);
    this.terrain = terrain ?? new Terrain(config.width, config.height);
    this.spatial = new SpatialGrid(this.widthSub, this.heightSub, 4 * TILE);
    this.scriptCtx = { sim: this, e: -1, bp: undefined!, stats: undefined! };
  }

  get widthSub(): number {
    return this.config.width * TILE;
  }

  get heightSub(): number {
    return this.config.height * TILE;
  }

  // --- setup -----------------------------------------------------------------

  /** Compiles and installs a class program. Throws FlowError / BlueprintError. */
  setProgram(blueprintId: number, source: string): FlowProgram {
    if (!this.blueprints.get(blueprintId)) throw new BlueprintError(`No blueprint ${blueprintId}`);
    const program = compileUnitProgram(source);
    this.blueprints.setProgram(blueprintId, program);
    return program;
  }

  /** Spawns a mobile unit at (or as near as possible to) sub-tile coordinates. */
  spawnUnit(bp: Blueprint, x: number, y: number): number {
    if (bp.stats.structure) throw new BlueprintError(`${bp.name} is a building: use spawnStructure`);
    // On open ground, with room for the hull if there is any nearby.
    const cell = this.terrain.nearestFit(this.tileX(x), this.tileY(y), { climb: 0, clearance: bp.stats.clearance }, 20) ?? this.terrain.nearestWalkable(this.tileX(x), this.tileY(y), 20);
    if (!cell) throw new CommandError('No room to place a unit');
    if (cell[0] !== this.tileX(x) || cell[1] !== this.tileY(y)) {
      x = cell[0] * TILE + TILE / 2;
      y = cell[1] * TILE + TILE / 2;
    }
    const e = this.addCommon(bp, x, y);
    this.motion.add(e);
    if (bp.stats.weapon) this.weapon.add(e, { target: -1 });
    if (bp.stats.cargo > 0) {
      this.cargo.add(e);
      this.harvester.add(e, { target: -1 });
    }
    if (bp.stats.buildRate > 0) this.builder.add(e, { target: -1 });
    if (bp.stats.repairRate > 0) this.repairer.add(e, { target: -1 });
    this.tally(bp.owner).createdUnits++;
    return e;
  }

  tally(owner: number): PlayerTally {
    let t = this.tallies.get(owner);
    if (!t) {
      t = { createdUnits: 0, createdBuildings: 0, lostUnits: 0, lostBuildings: 0, destroyedUnits: 0, destroyedBuildings: 0 };
      this.tallies.set(owner, t);
    }
    return t;
  }

  /** Resources in the player's silos plus the cost of every finished building and unit they own. */
  score(owner: number): number {
    let sum = this.pool(owner);
    for (const e of this.unit.dense) {
      if (this.unit.f.owner[e] !== owner || this.isSite(e)) continue;
      sum += this.blueprintOf(e)?.stats.cost ?? 0;
    }
    return sum;
  }

  /** Books a death in the tallies: a loss for the owner and a kill for whoever last hit it. */
  recordDeath(e: number): void {
    if (!this.unit.has(e) || this.isSite(e)) return;
    const building = this.stats(e).structure;
    const owner = this.unit.f.owner[e];
    const killer = this.lastHitBy[e] ?? 0;
    if (building) {
      this.tally(owner).lostBuildings++;
      if (killer) this.tally(killer).destroyedBuildings++;
    } else {
      this.tally(owner).lostUnits++;
      if (killer) this.tally(killer).destroyedUnits++;
    }
  }

  /**
   * Places a building with its top-left corner on tile (tx, ty). With `built` false it
   * becomes a construction site: it blocks its footprint and can be attacked, but does
   * nothing until builders have invested its full cost.
   */
  spawnStructure(bp: Blueprint, tx: number, ty: number, energyFraction = 1, built = true): number {
    const size = bp.stats.footprint;
    if (!bp.stats.structure) throw new BlueprintError(`${bp.name} is not a building`);
    if (!this.terrain.footprintFree(tx, ty, size, bp.stats.shape)) throw new CommandError(`No room for ${bp.name} at ${tx},${ty}`);
    const e = this.addCommon(bp, (tx + size / 2) * TILE, (ty + size / 2) * TILE);
    this.energy.f.amount[e] = built ? Math.floor(bp.stats.energyCapacity * energyFraction) : 0;
    this.storage.add(e);
    this.terrain.occupy(tx, ty, size, 1, bp.stats.shape);
    if (built) this.finishConstruction(e);
    else {
      this.construction.add(e);
      this.invested[e] = 0;
      this.health.f.hp[e] = Math.max(1, Math.floor(bp.stats.hp * SITE_START_HP));
    }
    this.powerDirty = true;
    return e;
  }

  /** Turns a site into a working building (also used for buildings placed ready-made). */
  private finishConstruction(e: number): void {
    const s = this.stats(e);
    if (this.construction.has(e)) {
      this.construction.remove(e);
      this.health.f.hp[e] = s.hp;
      this.health.markChanged(e);
    }
    if (s.factory) {
      this.production.add(e);
      this.productionQueue[e] = [];
      this.productionTicks[e] = 0;
    }
    if (s.resourceCapacity > 0) this.stockpile.add(e);
    if (s.buildRate > 0) this.builder.add(e, { target: -1 });
    if (s.repairRate > 0) this.repairer.add(e, { target: -1 });
    if (s.weapon) this.weapon.add(e, { target: -1 });
    this.tally(this.unit.f.owner[e]).createdBuildings++;
    this.powerDirty = true;
  }

  /** How far e's build arm/crane reaches (from the site's edge). */
  buildRange(e: number): number {
    return this.stats(e).structure ? BUILDING_BUILD_RANGE : BUILD_RANGE;
  }

  /**
   * Retires (or restores) an own class: retired classes can't be produced or placed,
   * and don't count towards the class limit. Units already built carry on.
   */
  retireClass(owner: number, blueprintId: number, retired: boolean): Blueprint {
    const bp = this.blueprints.get(blueprintId);
    if (!bp || bp.owner !== owner) throw new CommandError('Not your class');
    bp.retired = retired;
    return bp;
  }

  /**
   * Makes a player's classes match a set of designs (restoring a saved session, an
   * uploaded file, or the defaults). Each entry is matched by name to an own class:
   * same parts means its program and retired flag are updated in place; different
   * parts means a new class is defined and the old one retired (parts are fixed per
   * class). Own classes not in the set are retired, except defaults the set doesn't
   * mention (new in this build). Units already built carry on with their class.
   */
  loadDesigns(owner: number, entries: readonly DesignEntry[], maxActive: number, merge = false): DesignLoadReport {
    return loadDesignsInto(this, owner, entries, maxActive, merge);
  }

  /**
   * Best own construction site for e, or -1. Sites no other builder has claimed come
   * first (nearest of those); builders only pile onto a shared site once every site
   * has someone, then they pick the least crowded, nearest first.
   */
  nearestSite(e: number): number {
    const owner = this.unit.f.owner[e];
    const claims = new Map<number, number>();
    for (const b of this.builder.dense) {
      if (b === e || this.unit.f.owner[b] !== owner) continue;
      const q = this.tasks[b];
      let site = -1;
      if (q && q.count > 0 && q.type(0) === TaskType.Build) site = this.world.resolve(q.target(0));
      else site = this.world.resolve(this.builder.f.target[b]);
      if (site >= 0) claims.set(site, (claims.get(site) ?? 0) + 1);
    }
    let best = -1;
    let bestC = Infinity;
    let bestD = Infinity;
    for (const s of this.construction.dense) {
      if (this.unit.f.owner[s] !== owner) continue;
      const c = claims.get(s) ?? 0;
      const d = this.edgeDistance(e, s);
      if (c < bestC || (c === bestC && d < bestD)) {
        best = s;
        bestC = c;
        bestD = d;
      }
    }
    return best;
  }

  /**
   * Player demolishes an own building. A construction site is cancelled and
   * refunds everything invested; a finished building refunds part of its cost.
   * A demolished silo's contents move to the other silos where they fit.
   * Refunds go into the common pool (as far as the silos have room).
   */
  demolish(owner: number, e: number): number {
    const bp = this.ownedBlueprint(owner, e);
    if (!bp.stats.structure) throw new CommandError(`${bp.name} is not a building`);
    let refund = this.isSite(e) ? this.invested[e] : Math.floor(bp.stats.cost * DEMOLISH_REFUND);
    if (this.stockpile.has(e)) refund += this.stockpile.f.amount[e];
    this.destroyEntity(e);
    let returned = 0;
    for (const b of this.silos(owner)) {
      if (returned >= refund) break;
      returned += this.addStock(b, refund - returned);
    }
    return returned;
  }

  /** True while e is an unfinished construction site. */
  isSite(e: number): boolean {
    return this.construction.has(e);
  }

  /** Invests resources into a site; finishes it when fully paid. Returns the amount accepted. */
  investIn(site: number, amount: number): number {
    const s = this.stats(site);
    const take = Math.max(0, Math.min(amount, s.cost - this.invested[site]));
    if (take <= 0) return 0;
    this.invested[site] += take;
    const done = this.invested[site] / s.cost;
    const hp = Math.max(1, Math.floor(s.hp * (SITE_START_HP + (1 - SITE_START_HP) * done)));
    if (hp > this.health.f.hp[site]) {
      this.health.f.hp[site] = hp;
      this.health.markChanged(site);
    }
    const pct = Math.min(100, Math.floor(done * 100));
    if (this.construction.f.progress[site] !== pct) {
      this.construction.f.progress[site] = pct;
      this.construction.markChanged(site);
    }
    if (this.invested[site] >= s.cost) this.finishConstruction(site);
    return take;
  }

  /** Energy stored in the finished buildings of the network a site is linked to. */
  gridEnergy(site: number): number {
    let sum = 0;
    for (const b of this.networkFor(site)?.members ?? []) {
      if (this.world.isAlive(b) && !this.isSite(b)) sum += this.energy.f.amount[b];
    }
    return sum;
  }

  /** Takes up to `amount` energy from the network a site is linked to; returns how much was taken. */
  drawGridEnergy(site: number, amount: number): number {
    let taken = 0;
    for (const b of this.networkFor(site)?.members ?? []) {
      if (taken >= amount) break;
      if (!this.world.isAlive(b) || this.isSite(b)) continue;
      const t = Math.min(amount - taken, this.energy.f.amount[b]);
      this.energy.f.amount[b] -= t;
      taken += t;
    }
    return taken;
  }

  /** A site draws from the common pool only if it is linked into a network with a finished silo. */
  siteSupplied(site: number): boolean {
    return this.networkFor(site)?.depot ?? false;
  }

  private addCommon(bp: Blueprint, x: number, y: number): number {
    const e = this.world.create();
    this.pos.add(e, { x: this.clamp(x, this.widthSub), y: this.clamp(y, this.heightSub) });
    this.unit.add(e, { blueprint: bp.id, owner: bp.owner });
    this.health.add(e, { hp: bp.stats.hp });
    this.cpu.add(e);
    this.modules.add(e);
    this.energy.add(e, { amount: bp.stats.energyCapacity });
    this.energyView.add(e, { pct: 100 });
    this.tasks[e] = new TaskQueue();
    this.lastHitBy[e] = 0;
    this.genCarry[e] = 0;
    this.stunUntil[e] = 0;
    this.flatTicks[e] = 0;
    this.cpuDebt[e] = 0;
    return e;
  }

  spawnResource(x: number, y: number, amount: number): number {
    const e = this.world.create();
    this.pos.add(e, { x: this.clamp(x, this.widthSub), y: this.clamp(y, this.heightSub) });
    this.resource.add(e, { amount: Math.min(0xffff, amount) });
    return e;
  }

  spawnResourcePatch(x: number, y: number, amount: number): number {
    const e = this.spawnResource(x, y, amount);
    this.resourcePatch.add(e, { maximum: this.resource.f.amount[e] });
    return e;
  }

  destroyEntity(e: number): void {
    const s = this.unit.has(e) ? this.stats(e) : undefined;
    if (s?.structure) {
      const f = this.footprintOf(e);
      this.terrain.occupy(f.x, f.y, f.size, -1, s.shape);
      this.powerDirty = true;
    }
    this.flows[e] = undefined;
    this.flights[e] = undefined;
    this.activities[e] = undefined;
    this.suspended[e] = undefined;
    this.activeUnits.delete(e);
    this.tasks[e] = undefined;
    this.paths[e] = undefined;
    this.visiting[e] = -1;
    this.productionQueue[e] = undefined;
    this.invested[e] = 0;
    this.repairCarry[e] = 0;
    this.moduleDamage[e] = undefined;
    this.radarReady.delete(this.world.handle(e));
    this.world.destroy(e);
  }

  /**
   * Hurts `t` by `amount` for the player `owner` (a shot, a missile burst): raises its Damaged event and notes who to credit.
   * The hit also lands on one of its modules: one of class `aim` (a SLOT_CODES value) if it has a working one,
   * otherwise any module at random (`aim` 0).
   */
  damage(t: number, amount: number, owner: number, aim = 0): void {
    this.health.f.hp[t] -= amount;
    this.lastHitBy[t] = owner;
    if (this.health.f.hp[t] > 0) this.hitModule(t, amount, aim);
    const victim = this.flows[t];
    if (victim && handles(victim.program, EventId.Damaged)) {
      raise(victim, EventId.Damaged, amount, owner, 0, 0, (h) => amount >= ((victim.program.handlers[h].config.minAmount as number | undefined) ?? 0));
    }
    this.health.markChanged(t);
  }

  /** Deterministic roll in [0, n): a hash of the tick, the victim and a counter, so it never disturbs the match's random stream. */
  private hitRoll(t: number, n: number): number {
    let h = Math.imul(this.tick + 1, 0x9e3779b1) ^ Math.imul(t + 1, 0x85ebca6b) ^ Math.imul(++this.hitCount, 0xc2b2ae35);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) % n;
  }

  /** Picks the module a hit lands on and wears it down; a module that has taken its integrity breaks. */
  private hitModule(t: number, amount: number, aim: number): void {
    const bp = this.blueprintOf(t);
    if (!bp || amount <= 0) return;
    const { slot, integrity } = bp.hit;
    const broken = this.modules.f.broken[t];
    const live = (i: number) => slot[i] !== CHASSIS_HIT && !((broken >>> i) & 1);
    let pick = -1;
    if (aim > 0) {
      let n = 0;
      for (let i = 0; i < slot.length; i++) if (slot[i] === aim && live(i)) n++;
      if (n > 0) {
        let k = n > 1 ? this.hitRoll(t, n) : 0;
        for (let i = 0; i < slot.length; i++) if (slot[i] === aim && live(i) && k-- === 0) { pick = i; break; }
      }
    }
    if (pick < 0) {
      // Any: every part but the chassis is as likely as any other, so armour and batteries shield what is behind them.
      let n = 0;
      for (let i = 0; i < slot.length; i++) if (live(i)) n++;
      if (n === 0) return;
      let k = n > 1 ? this.hitRoll(t, n) : 0;
      for (let i = 0; i < slot.length; i++) if (live(i) && k-- === 0) { pick = i; break; }
    }
    if (pick < 0 || slot[pick] === 0) return; // soaked up
    const dmg = (this.moduleDamage[t] ??= new Uint16Array(slot.length));
    dmg[pick] = Math.min(0xffff, dmg[pick] + amount);
    if (dmg[pick] < integrity[pick]) return;
    dmg[pick] = integrity[pick];
    this.modules.f.broken[t] = (broken | (1 << pick)) >>> 0;
    this.modulesChanged(t);
    this.emit(SimEvent.Break, t, pick);
  }

  /** Total damage the modules of `t` have taken (0 for an undamaged unit). */
  moduleDamageOf(t: number): number {
    const dmg = this.moduleDamage[t];
    if (!dmg) return 0;
    let sum = 0;
    for (let i = 0; i < dmg.length; i++) sum += dmg[i];
    return sum;
  }

  /** Mends up to `points` of module damage on `t`, broken modules first; returns the points used. */
  repairModules(t: number, points: number): number {
    const dmg = this.moduleDamage[t];
    if (!dmg || points <= 0) return 0;
    const broken = this.modules.f.broken[t];
    let left = points;
    let mended = 0;
    for (let pass = 0; pass < 2 && left > 0; pass++) {
      for (let i = 0; i < dmg.length && left > 0; i++) {
        if (dmg[i] === 0 || (((broken >>> i) & 1) === 1) !== (pass === 0)) continue;
        const use = Math.min(left, dmg[i]);
        dmg[i] -= use;
        left -= use;
        mended += use;
        if (dmg[i] === 0 && pass === 0) {
          this.modules.f.broken[t] = (this.modules.f.broken[t] & ~(1 << i)) >>> 0;
          this.modulesChanged(t);
        }
      }
    }
    return mended;
  }

  /** The set of working modules of `t` changed (switched or broken or mended): refresh what depends on it. */
  private modulesChanged(t: number): void {
    this.modules.markChanged(t);
    if (this.stats(t).structure) this.powerDirty = true;
    if (this.motion.has(t) && this.stats(t).speed <= 0) this.halt(t);
  }

  emit(type: number, a: number, b: number): void {
    this.events.push(type, a, b);
  }

  // --- per-unit derived state ----------------------------------------------------

  blueprintOf(e: number): Blueprint | undefined {
    return this.unit.has(e) ? this.blueprints.get(this.unit.f.blueprint[e]) : undefined;
  }

  /** Effective stats: the class stats with this unit's switched-off modules removed (shared, memoised). */
  stats(e: number): BlueprintStats {
    return statsFor(this.blueprintOf(e)!, (this.modules.f.off[e] | this.modules.f.broken[e]) >>> 0);
  }

  /** Building footprint: top-left tile and size. */
  footprintOf(e: number): { x: number; y: number; size: number } {
    const size = this.stats(e).footprint;
    return {
      x: Math.round(this.pos.f.x[e] / TILE - size / 2),
      y: Math.round(this.pos.f.y[e] / TILE - size / 2),
      size,
    };
  }

  distSq(a: number, b: number): number {
    const dx = this.pos.f.x[b] - this.pos.f.x[a];
    const dy = this.pos.f.y[b] - this.pos.f.y[a];
    return dx * dx + dy * dy;
  }

  /**
   * Distance from a's centre to b's edge (buildings), hull (units bigger than a tile) or centre (everything
   * else), in sub-tile units. Hulls up to a tile across count as points, as they always have.
   */
  edgeDistance(a: number, b: number): number {
    let half = 0;
    if (this.unit.has(b)) {
      const s = this.stats(b);
      half = s.structure ? (s.footprint * TILE) / 2 : Math.max(0, s.radius - TILE / 2);
    }
    return Math.max(0, Math.sqrt(this.distSq(a, b)) - half);
  }

  /** Same owner, or on the same team: allies never count as enemies. */
  allied(a: number, b: number): boolean {
    if (a === b) return true;
    const team = this.teams.get(a);
    return team !== undefined && team === this.teams.get(b);
  }

  /** Takes `amount` energy if available. */
  spend(e: number, amount: number): boolean {
    if (amount <= 0) return true;
    const store = this.energy.f.amount;
    if (store[e] < amount) return false;
    store[e] -= amount;
    return true;
  }

  /** True if `e` can pay `amount` matter: from its cargo bay (vehicles) or its owner's silos (buildings). */
  canSpendMatter(e: number, amount: number): boolean {
    if (amount <= 0) return true;
    if (this.stats(e).structure) return this.pool(this.unit.f.owner[e]) >= amount;
    return this.cargo.has(e) && this.cargo.f.amount[e] >= amount;
  }

  /** Pays matter as checked by canSpendMatter. */
  spendMatter(e: number, amount: number): void {
    if (amount <= 0) return;
    if (this.stats(e).structure) this.drawPool(this.unit.f.owner[e], amount);
    else {
      this.cargo.f.amount[e] -= amount;
      this.cargo.markChanged(e);
    }
  }

  /** Stuns the CPU of e for `ticks` from now (never shortens an existing stun). */
  stun(e: number, ticks: number): void {
    this.stunUntil[e] = Math.max(this.stunUntil[e] ?? 0, this.tick + ticks);
  }

  energyFraction(e: number): number {
    const cap = this.stats(e).energyCapacity;
    return cap > 0 ? this.energy.f.amount[e] / cap : 0;
  }

  /** Adds up to `amount` energy (capped at capacity); returns how much was added. */
  addEnergy(e: number, amount: number): number {
    const room = this.stats(e).energyCapacity - this.energy.f.amount[e];
    const given = Math.max(0, Math.min(room, amount));
    this.energy.f.amount[e] += given;
    return given;
  }

  /**
   * Moves `amount` energy from one own unit/building to another — only if the giver
   * has at least that much, and only within the giver's reach (units: 1 tile,
   * buildings: 3 tiles from their edge). The receiver takes what fits.
   * Returns the amount moved. Charging pads and scripts' giveEnergy() both use this rule.
   */
  transferEnergy(from: number, to: number, amount: number): number {
    if (amount <= 0 || from === to || !this.energy.has(from) || !this.energy.has(to)) return 0;
    if (this.unit.f.owner[from] !== this.unit.f.owner[to] || this.isSite(from)) return 0;
    if (this.energy.f.amount[from] < amount) return 0;
    const fromBuilding = this.stats(from).structure;
    const reach = fromBuilding ? BUILDING_TRANSFER_RANGE : UNIT_TRANSFER_RANGE;
    // Distance from the giver's edge to the receiver's edge.
    const halfFrom = fromBuilding ? (this.stats(from).footprint * TILE) / 2 : 0;
    if (this.edgeDistance(from, to) - halfFrom > reach) return 0;
    const moved = this.addEnergy(to, amount);
    this.energy.f.amount[from] -= moved;
    return moved;
  }

  /**
   * Switches parts[index] on or off. Only modules that use or make energy can
   * be switched; a script may not switch off its own last running CPU.
   */
  setModule(e: number, index: number, on: boolean, byScript: boolean): boolean {
    const bp = this.blueprintOf(e);
    if (!bp || index < 0 || index >= bp.parts.length) return false;
    const def = PARTS[bp.parts[index]];
    if (!SWITCHABLE.has(def.slot)) return false;
    const bit = (1 << index) >>> 0;
    const mask = this.modules.f.off[e];
    const broken = this.modules.f.broken[e];
    if (on && ((broken >>> index) & 1)) return false; // a broken module stays out until it is repaired
    const next = (on ? mask & ~bit : mask | bit) >>> 0;
    if (next === mask) return true;
    if (byScript && def.slot === 'cpu' && statsFor(bp, (next | broken) >>> 0).cyclesPerTick === 0) return false;
    this.modules.f.off[e] = next;
    this.modulesChanged(e);
    return true;
  }

  // --- movement ----------------------------------------------------------------

  /**
   * Starts travel to a sub-tile point. Ground units follow an A* path around
   * terrain and buildings; flying units go straight. Re-issuing the current
   * destination is free. Returns -1 if the unit cannot move.
   */
  setDestination(e: number, x: number, y: number): number {
    const s = this.stats(e);
    if (!this.motion.has(e) || s.speed <= 0) return -1;
    x = this.clamp(x, this.widthSub);
    y = this.clamp(y, this.heightSub);
    const m = this.motion.f;
    if (m.tx[e] === x && m.ty[e] === y && (m.moving[e] || m.arrived[e])) return 1;
    m.tx[e] = x;
    m.ty[e] = y;
    m.moving[e] = 1;
    m.arrived[e] = 0;
    this.stuckTicks[e] = 0;
    this.lastDistance[e] = Infinity;
    this.paths[e] = this.planPath(e, x, y, s.flying);
    return 1;
  }

  halt(e: number): void {
    if (!this.motion.has(e)) return;
    const m = this.motion.f;
    m.moving[e] = 0;
    m.arrived[e] = 0;
    this.paths[e] = undefined;
    this.ensureLanded(e);
  }

  /** Flying units may only stop over a cell that is passable and free: drift to the nearest one. */
  ensureLanded(e: number): void {
    const tx = this.tileX(this.pos.f.x[e]);
    const ty = this.tileY(this.pos.f.y[e]);
    if (this.terrain.walkable(tx, ty)) return;
    const cell = this.terrain.nearestWalkable(tx, ty, 30);
    if (!cell) return;
    const m = this.motion.f;
    m.tx[e] = cell[0] * TILE + TILE / 2;
    m.ty[e] = cell[1] * TILE + TILE / 2;
    m.moving[e] = 1;
    m.arrived[e] = 0;
    this.paths[e] = [m.tx[e], m.ty[e]];
  }

  planPath(e: number, x: number, y: number, flying: boolean): number[] {
    const gx = this.tileX(x);
    const gy = this.tileY(y);
    if (flying) {
      if (this.terrain.walkable(gx, gy)) return [x, y];
      const cell = this.terrain.nearestWalkable(gx, gy, 30);
      return cell ? [cell[0] * TILE + TILE / 2, cell[1] * TILE + TILE / 2] : [x, y];
    }
    const s = this.stats(e);
    const tiles = findPath(this.terrain, this.tileX(this.pos.f.x[e]), this.tileY(this.pos.f.y[e]), gx, gy, s);
    const out: number[] = [];
    for (let i = 0; i < tiles.length; i += 2) out.push(tiles[i] * TILE + TILE / 2, tiles[i + 1] * TILE + TILE / 2);
    const n = out.length;
    if (n === 0) {
      if (this.terrain.fits(gx, gy, s)) out.push(x, y);
    } else if (tiles[tiles.length - 2] === gx && tiles[tiles.length - 1] === gy) {
      out[n - 2] = x;
      out[n - 1] = y;
    }
    return out;
  }

  // --- player commands (applied between ticks) --------------------------------

  /**
   * Right-click: queue the context-appropriate task on one unit. The unit's
   * script decides what to do with it; `queue` only changes the URGENT flag.
   */
  issueOrder(owner: number, e: number, x: number, y: number, target: number, queue: boolean): boolean {
    this.ownedBlueprint(owner, e);
    const s = this.stats(e);
    let type: number = TaskType.Move;
    let handle = -1;
    if (target >= 0 && target !== e && this.world.isAlive(target) && !s.structure) {
      if (this.resource.has(target)) {
        if (s.caps & Caps.Harvest) type = TaskType.Harvest;
      } else if (this.missile.has(target)) {
        // An enemy missile in flight: shoot it down.
        if (s.caps & Caps.Fight && !this.allied(this.missile.f.owner[target], owner)) type = TaskType.Attack;
      } else if (this.unit.has(target)) {
        const theirs = !this.allied(this.unit.f.owner[target], owner);
        const targetCaps = this.stats(target).caps;
        if (theirs && s.caps & Caps.Fight) type = TaskType.Attack;
        else if (theirs) type = TaskType.Move;
        else if (this.isSite(target)) type = s.caps & Caps.Build ? TaskType.Build : TaskType.Move;
        else if (s.caps & Caps.Repair && this.health.has(target) && this.health.f.hp[target] < this.stats(target).hp) type = TaskType.Repair;
        else if (targetCaps & Caps.Depot && s.caps & Caps.Harvest) type = TaskType.Dock;
        else if (targetCaps & Caps.Charger) type = TaskType.Charge;
        else if (!this.stats(target).structure && this.energyFraction(target) < 0.25) type = TaskType.Supply;
      }
      if (type !== TaskType.Move) {
        handle = this.world.handle(target);
        x = this.tileX(this.pos.f.x[target]);
        y = this.tileY(this.pos.f.y[target]);
      }
    }
    const flags = TaskFlag.Player | (queue ? 0 : TaskFlag.Urgent);
    x = this.clampTile(x, this.config.width);
    y = this.clampTile(y, this.config.height);
    if (type === TaskType.Move && handle < 0) [x, y] = this.freeMoveTile(e, x, y);
    return this.pushOrder(e, type, x, y, handle, flags);
  }

  /**
   * Nearest walkable tile to (x, y) that no other unit is parked on or already
   * ordered to, so a group sent to one point spreads out around it.
   */
  freeMoveTile(e: number, x: number, y: number): [number, number] {
    const taken = new Set<number>();
    const w = this.config.width;
    for (const o of this.unit.dense) {
      if (o === e || this.stats(o).structure) continue;
      const q = this.tasks[o];
      if (q) {
        for (let i = 0; i < q.count; i++) if (q.type(i) === TaskType.Move && q.target(i) < 0) taken.add(q.y(i) * w + q.x(i));
      }
      if (this.motion.has(o) && !this.motion.f.moving[o]) taken.add(this.tileY(this.pos.f.y[o]) * w + this.tileX(this.pos.f.x[o]));
    }
    const s = this.stats(e);
    const fits = (i: number, j: number) => (s.flying ? this.terrain.walkable(i, j) : this.terrain.fits(i, j, s));
    const free = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < this.config.height && fits(i, j) && !taken.has(j * w + i);
    if (free(x, y)) return [x, y];
    const max = 30;
    for (let r = 1; r <= max; r++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let j = y - r; j <= y + r; j++) {
        for (let i = x - r; i <= x + r; i++) {
          if (Math.max(Math.abs(i - x), Math.abs(j - y)) !== r || !free(i, j)) continue;
          const d = (i - x) ** 2 + (j - y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = [i, j];
          }
        }
      }
      if (best) return best;
    }
    return [x, y];
  }

  issueStop(owner: number, e: number, queue: boolean): boolean {
    this.ownedBlueprint(owner, e);
    const flags = TaskFlag.Player | (queue ? 0 : TaskFlag.Urgent);
    return this.pushOrder(e, TaskType.Stop, 0, 0, -1, flags);
  }

  /**
   * A common action button (move, attack, stop, harvest, unload, repair, recharge).
   * Unlike a right-click, the task type is fixed; units without the modules for
   * it refuse. Targets are filled in where the button needs one (nearest field,
   * depot or charging pad).
   */
  issueCommand(owner: number, e: number, task: number, x: number, y: number, target: number, queue: boolean): boolean {
    const bp = this.ownedBlueprint(owner, e);
    const action = COMMON_ACTION_BY_TASK.get(task);
    if (!action) throw new CommandError('Unknown command');
    if (this.isSite(e)) throw new CommandError(`${bp.name} is still under construction`);
    if (!action.can(this.stats(e))) throw new CommandError(`${bp.name} cannot ${action.label.toLowerCase()}`);
    if (task === TaskType.Stop) return this.issueStop(owner, e, queue);
    const valid = target >= 0 && target !== e && this.world.isAlive(target);
    let goal = -1;
    if (task === TaskType.Attack) {
      // An enemy, or nothing: attack-move to the point.
      if (valid && this.unit.has(target) && !this.allied(this.unit.f.owner[target], owner)) goal = target;
      else if (valid && this.missile.has(target) && !this.allied(this.missile.f.owner[target], owner)) goal = target;
    } else if (task === TaskType.Harvest) {
      goal = valid && this.resource.has(target) ? target : this.nearestResource(x, y);
      if (goal < 0) throw new CommandError('No resources left');
    } else if (task === TaskType.Repair) {
      const ok = (b: number) => b !== e && this.health.has(b) && !this.isSite(b) && this.unit.f.owner[b] === owner;
      goal = valid && this.unit.has(target) && ok(target) ? target : this.nearestDamagedOwn(e, x, y);
      if (goal < 0) throw new CommandError('Nothing of yours needs repair');
    } else if (task === TaskType.Dock) {
      goal = this.nearestOwn(e, Caps.Depot);
      if (goal < 0) throw new CommandError('No depot to unload at');
    } else if (task === TaskType.Charge) {
      goal = this.nearestOwn(e, Caps.Charger);
      if (goal < 0) throw new CommandError('No charging pad');
    }
    if (goal >= 0) {
      x = this.tileX(this.pos.f.x[goal]);
      y = this.tileY(this.pos.f.y[goal]);
    }
    const flags = TaskFlag.Player | (queue ? 0 : TaskFlag.Urgent);
    const handle = goal >= 0 ? this.world.handle(goal) : -1;
    x = this.clampTile(x, this.config.width);
    y = this.clampTile(y, this.config.height);
    if (task === TaskType.Move) [x, y] = this.freeMoveTile(e, x, y);
    return this.pushOrder(e, task, x, y, handle, flags);
  }

  /**
   * The unit's running program state, created on first use (and again when its class gets a new
   * program, which reboots it). Undefined without a program, without a working CPU, or while a site.
   */
  flowFor(e: number): FlowState | undefined {
    const bp = this.blueprintOf(e);
    if (!bp?.program || this.isSite(e)) return undefined;
    const have = this.flows[e];
    if (have && have.program === bp.program) return have;
    const s = this.stats(e);
    if (s.cyclesPerTick === 0) return undefined;
    const f = (this.flows[e] = createFlow(bp.program, s.memorySlots, s.stackDepth, this.tick, have ? 1 : 0));
    this.endVisit(e);
    return f;
  }

  /**
   * Gives the unit an order (the player or a building). Orders wait in a list; the one at the front is the
   * order being worked on, and reaching the front raises Order. Without an Order block nothing would ever
   * take the order, so it is not kept. An urgent order replaces the plan if an Order block asks for it
   * (`urgent: REPLACE`): older orders go and the current activity stops.
   */
  pushOrder(e: number, type: number, x: number, y: number, handle: number, flags: number): boolean {
    const q = this.tasks[e]!;
    const f = this.flowFor(e);
    if (!f || !handles(f.program, EventId.Order)) return true;
    if (flags & TaskFlag.Urgent && f.program.byEvent[EventId.Order]!.some((h) => configInt(f.program.handlers[h], 'urgent') === OrderPolicy.Replace)) {
      q.clear();
      cancelActivity(this, e, true, true);
    }
    if (!q.push(type, x, y, handle, flags)) return false;
    if (q.count === 1) this.raiseFrontOrder(e);
    return true;
  }

  /** Raises Order for the order at the front of the list. An order no block wants is dropped and the next one tried. */
  raiseFrontOrder(e: number): void {
    const q = this.tasks[e];
    const f = this.flowFor(e);
    while (q && q.count > 0) {
      if (!f || !handles(f.program, EventId.Order)) {
        q.clear();
        break;
      }
      const type = q.type(0);
      const flags = q.flags(0);
      const taken = raise(f, EventId.Order, type, q.x(0), q.y(0), q.target(0), (h) => {
        const cfg = f.program.handlers[h];
        const types = configInts(cfg, 'types');
        const from = (cfg.config.from as number | undefined) ?? 0;
        return (types.length === 0 || types.includes(type)) && (from === 0 || (from & flags) !== 0);
      });
      if (taken > 0) return;
      q.remove(0);
    }
    if (f) f.freePending = true;
  }

  /** Finishes the order being worked on: stops its activity, drops it, and raises the next one (or Free). */
  nextOrder(e: number): void {
    cancelActivity(this, e);
    this.tasks[e]?.remove(0);
    this.raiseFrontOrder(e);
  }

  /** Replaces the order being worked on by another (or just adds one if there is none) and raises it. */
  swapOrder(e: number, type: number, x: number, y: number, handle: number): boolean {
    const q = this.tasks[e];
    if (!q || !this.flowFor(e)) return false;
    cancelActivity(this, e);
    if (q.count > 0) q.remove(0);
    if (!q.push(type, x, y, handle, 0)) return false;
    q.toFront(q.count - 1);
    this.raiseFrontOrder(e);
    return true;
  }

  /** Drops every order and stops the current activity. */
  clearOrders(e: number): void {
    cancelActivity(this, e, true, true);
    this.tasks[e]?.clear();
    const f = this.flows[e];
    if (f) f.freePending = true;
  }

  /**
   * The entity index of handle `h` if unit `e` knows where it is: own units, own buildings and resources always,
   * anything else only within its sensor range. Otherwise -1.
   */
  locate(e: number, h: number): number {
    const t = this.world.resolve(h);
    if (t < 0 || t === e) return t;
    if (this.resource.has(t)) return t;
    if (this.unit.has(t) && this.unit.f.owner[t] === this.unit.f.owner[e]) return t;
    const r = this.stats(e).sensorRange;
    return this.distSq(e, t) <= r * r ? t : -1;
  }

  /**
   * A class button (a `Button` block in its program): raises that block's event. Aimed
   * buttons carry the picked tile and target; others the unit's own tile.
   */
  issueButton(owner: number, e: number, name: string, x: number, y: number, target: number, _queue: boolean): boolean {
    const bp = this.ownedBlueprint(owner, e);
    const button = bp.program?.buttons.find((b) => b.name === name);
    if (!button) throw new CommandError(`${bp.name} has no '${name}' button`);
    if (this.isSite(e)) throw new CommandError(`${bp.name} is still under construction`);
    let handle = -1;
    if (!button.aim) {
      x = this.tileX(this.pos.f.x[e]);
      y = this.tileY(this.pos.f.y[e]);
    } else if (target >= 0 && this.world.isAlive(target) && (this.unit.has(target) || this.resource.has(target))) {
      handle = this.world.handle(target);
      x = this.tileX(this.pos.f.x[target]);
      y = this.tileY(this.pos.f.y[target]);
    }
    const f = this.flowFor(e);
    if (!f) throw new CommandError(`${bp.name} has no CPU running`);
    // Straight to the one handler behind this button, whatever the queue holds.
    raise(f, EventId.Button, this.clampTile(x, this.config.width), this.clampTile(y, this.config.height), handle, 0, (h) => h === button.handler);
    return true;
  }

  /** Resource field nearest to tile (x, y), or -1. */
  nearestResource(x: number, y: number): number {
    const px = x * TILE + TILE / 2;
    const py = y * TILE + TILE / 2;
    let best = -1;
    let bestD = Infinity;
    for (const r of this.resource.dense) {
      if (this.resource.f.amount[r] <= 0) continue;
      const d = (this.pos.f.x[r] - px) ** 2 + (this.pos.f.y[r] - py) ** 2;
      if (d < bestD) {
        best = r;
        bestD = d;
      }
    }
    return best;
  }

  /** Player toggle from the UI (players may switch any switchable module, CPUs included). */
  issueModule(owner: number, e: number, index: number, on: boolean): boolean {
    this.ownedBlueprint(owner, e);
    return this.setModule(e, index, on, false);
  }

  /** Script version of enqueueProduction: false instead of an error when refused. */
  tryEnqueueProduction(building: number, blueprintId: number): boolean {
    try {
      this.enqueueProduction(this.unit.f.owner[building], building, blueprintId);
      return true;
    } catch (err) {
      if (!(err instanceof CommandError)) throw err;
      return false;
    }
  }

  enqueueProduction(owner: number, building: number, blueprintId: number): void {
    const host = this.ownedBlueprint(owner, building);
    const queue = this.productionQueue[building];
    if (!this.stats(building).factory || !queue) throw new CommandError(`${host.name} cannot produce units`);
    const bp = this.blueprints.get(blueprintId);
    if (!bp || bp.owner !== owner) throw new CommandError('Not your class');
    if (bp.stats.structure) throw new CommandError('Buildings cannot be produced by a factory');
    if (bp.retired) throw new CommandError(`${bp.name} is retired`);
    if (!factoryCanBuild(this.stats(building).factoryTiers, bp.stats.size)) {
      const tier = FACTORY_TIER_NAMES[bp.stats.size] ?? `tier ${bp.stats.size}`;
      throw new CommandError(`${bp.name} is a ${tier} unit: ${host.name} has no ${tier} factory module`);
    }
    if (queue.length >= MAX_PRODUCTION_QUEUE) throw new CommandError('Production queue is full');
    if (!this.spendPool(owner, bp.stats.cost)) {
      throw new CommandError(`${bp.name} costs ${bp.stats.cost}, you have ${this.pool(owner)}`);
    }
    queue.push(bp.id);
  }

  /** Removes the item at `index` of a factory's queue (0 = the one being built) and gives its matter back. */
  dequeueProduction(owner: number, building: number, index: number): void {
    this.ownedBlueprint(owner, building);
    const queue = this.productionQueue[building];
    if (!queue || !Number.isInteger(index) || index < 0 || index >= queue.length) throw new CommandError('Nothing queued there');
    const [id] = queue.splice(index, 1);
    if (index === 0) this.productionTicks[building] = 0; // the work on it is lost
    const bp = this.blueprints.get(id);
    if (bp) this.refundPool(owner, bp.stats.cost);
  }

  /** Whether a point (in tiles) is inside the vision of `owner` or their team; unfinished sites don't count. */
  private canSeeTile(owner: number, x: number, y: number): boolean {
    const team = this.teams.get(owner);
    const owners = new Set([owner]);
    if (team !== undefined) for (const [o, t] of this.teams) if (t === team) owners.add(o);
    return inVision(viewersOf(this.world, owners, (e) => this.stats(e), (e) => this.isSite(e)), x * TILE, y * TILE);
  }

  /**
   * Player places a building blueprint: a construction site appears and each
   * listed builder gets a BUILD task for it. Nothing is paid until builders work.
   */
  placeBlueprint(owner: number, blueprintId: number, tx: number, ty: number, builders: readonly number[], queue: boolean): number {
    const bp = this.blueprints.get(blueprintId);
    if (!bp || bp.owner !== owner) throw new CommandError('Not your class');
    if (!bp.stats.structure) throw new CommandError(`${bp.name} is not a building`);
    if (bp.retired) throw new CommandError(`${bp.name} is retired`);
    const sites = this.construction.dense.filter((e) => this.unit.f.owner[e] === owner).length;
    if (sites >= MAX_SITES_PER_PLAYER) throw new CommandError(`At most ${MAX_SITES_PER_PLAYER} construction sites at once`);
    if (this.requirePlacementVision && !this.canSeeTile(owner, tx + bp.stats.footprint / 2, ty + bp.stats.footprint / 2)) {
      throw new CommandError('You can only build where you have vision');
    }
    const site = this.spawnStructure(bp, tx, ty, 0, false);
    for (const b of builders) {
      try {
        this.issueOrder(owner, b, tx, ty, site, queue);
      } catch (err) {
        if (!(err instanceof CommandError)) throw err;
      }
    }
    return site;
  }

  // --- resources: the common pool is everything stored in a player's silos ------

  /** Finished own buildings with silos, in entity order. */
  private silos(owner: number): number[] {
    return this.stockpile.dense.filter((b) => this.unit.f.owner[b] === owner).sort((a, b) => a - b);
  }

  /** Total resources in a player's silos. */
  pool(owner: number): number {
    let sum = 0;
    for (const b of this.silos(owner)) sum += this.stockpile.f.amount[b];
    return sum;
  }

  poolCapacity(owner: number): number {
    let sum = 0;
    for (const b of this.silos(owner)) sum += this.stats(b).resourceCapacity;
    return sum;
  }

  /** Takes exactly `amount` from the pool (silo by silo), or nothing if there isn't enough. */
  /** Puts matter back into the common pool, as far as the silos have room. Returns what fitted. */
  refundPool(owner: number, amount: number): number {
    let returned = 0;
    for (const b of this.silos(owner)) {
      if (returned >= amount) break;
      returned += this.addStock(b, amount - returned);
    }
    return returned;
  }
  spendPool(owner: number, amount: number): boolean {
    if (this.pool(owner) < amount) return false;
    this.drawPool(owner, amount);
    return true;
  }

  /** Takes up to `amount` from the pool; returns how much was taken. */
  drawPool(owner: number, amount: number): number {
    let taken = 0;
    for (const b of this.silos(owner)) {
      if (taken >= amount) break;
      const t = Math.min(amount - taken, this.stockpile.f.amount[b]);
      if (t <= 0) continue;
      this.stockpile.f.amount[b] -= t;
      this.stockpile.markChanged(b);
      taken += t;
    }
    return taken;
  }

  /** Adds to one silo, up to its free space; returns how much fitted. */
  addStock(b: number, amount: number): number {
    if (!this.stockpile.has(b)) return 0;
    const room = this.stats(b).resourceCapacity - this.stockpile.f.amount[b];
    const put = Math.max(0, Math.min(room, amount));
    if (put > 0) {
      this.stockpile.f.amount[b] += put;
      this.stockpile.markChanged(b);
    }
    return put;
  }

  // --- rules used by builtins and systems ------------------------------------

  canHarvest(e: number): boolean {
    const t = this.world.resolve(this.harvester.f.target[e]);
    if (t < 0 || !this.resource.has(t) || this.resource.f.amount[t] === 0) return false;
    if (this.cargo.f.amount[e] >= this.stats(e).cargo) return false;
    return this.distSq(e, t) <= HARVEST_RANGE * HARVEST_RANGE;
  }

  /** An own, finished building with silos, adjacent to e. */
  private adjacentDepot(e: number, depot: number): boolean {
    return (
      this.stockpile.has(depot) &&
      this.unit.f.owner[depot] === this.unit.f.owner[e] &&
      this.edgeDistance(e, depot) <= DOCK_RANGE
    );
  }

  /**
   * Unloads as much cargo as the depot's silos have room for and becomes that
   * building's visitor. Returns false if not docked (not a depot, not own, too far).
   */
  dock(e: number, depot: number): boolean {
    if (!this.adjacentDepot(e, depot)) return false;
    if (this.cargo.has(e) && this.cargo.f.amount[e] > 0) {
      this.cargo.f.amount[e] -= this.addStock(depot, this.cargo.f.amount[e]);
      this.cargo.markChanged(e);
    }
    this.addVisitor(depot, e, VisitReason.Docked);
    return true;
  }

  /** Loads up to `amount` from an adjacent own depot into e's cargo bay; returns how much. */
  take(e: number, depot: number, amount: number): number {
    if (!this.cargo.has(e) || !this.adjacentDepot(e, depot)) return 0;
    const room = this.stats(e).cargo - this.cargo.f.amount[e];
    const t = Math.max(0, Math.min(amount, room, this.stockpile.f.amount[depot]));
    if (t <= 0) return 0;
    this.stockpile.f.amount[depot] -= t;
    this.stockpile.markChanged(depot);
    this.cargo.f.amount[e] += t;
    this.cargo.markChanged(e);
    return t;
  }

  /** The own unit or building missing hit points that is nearest the point (tile x, y), or -1. */
  nearestDamagedOwn(e: number, tx: number, ty: number): number {
    const owner = this.unit.f.owner[e];
    const px = tx * TILE + TILE / 2;
    const py = ty * TILE + TILE / 2;
    let best = -1;
    let bestD = Infinity;
    for (const b of this.unit.dense) {
      if (b === e || this.unit.f.owner[b] !== owner || this.isSite(b) || !this.health.has(b)) continue;
      if (this.health.f.hp[b] >= this.stats(b).hp) continue;
      const d = (this.pos.f.x[b] - px) ** 2 + (this.pos.f.y[b] - py) ** 2;
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  /** Nearest own finished building with all of `caps` (and passing `accept`), or -1. */
  nearestOwn(e: number, caps: number, accept?: (b: number) => boolean): number {
    const owner = this.unit.f.owner[e];
    let best = -1;
    let bestD = Infinity;
    for (const b of this.unit.dense) {
      if (b === e || this.unit.f.owner[b] !== owner || this.isSite(b) || (this.stats(b).caps & caps) !== caps) continue;
      if (accept && !accept(b)) continue;
      const d = this.distSq(e, b);
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  /** The power network a building belongs to, if any. */
  networkFor(e: number): PowerNetwork | undefined {
    return this.unit.has(e) && this.stats(e).structure ? this.networks[this.networkOf[e]] : undefined;
  }

  rebuildNetworks(): void {
    const nodes = this.powerNodes();
    const ids = powerNetworks(nodes);
    this.networks = [];
    nodes.forEach((n, i) => {
      const net = (this.networks[ids[i]] ??= emptyNetwork());
      net.members.push(n.e);
      if (this.stockpile.has(n.e)) net.depot = true;
      this.networkOf[n.e] = ids[i];
    });
    // Short links (and links to construction sites) join clusters; long antenna links are capped bridges.
    // A long link exists because an end's reach covers it, and carries what the stronger such end can.
    const through = (n: PowerNode, g: number) => (n.reach >= g ? this.stats(n.e).linkThroughput : 0);
    const { topologies, linkTiles } = powerTopology(nodes, ids, powerLinks(nodes), BASE_LINK_RANGE, (i, j, g) =>
      Math.max(through(nodes[i], g), through(nodes[j], g)),
    );
    this.networks.forEach((net, id) => {
      Object.assign(net, topologies[id]);
      net.linkTiles = linkTiles[id];
    });
    this.powerDirty = false;
  }

  powerNodes(): PowerNode[] {
    const nodes: PowerNode[] = [];
    for (const e of [...this.unit.dense].sort((a, b) => a - b)) {
      const s = this.stats(e);
      if (!s.structure) continue;
      const f = this.footprintOf(e);
      nodes.push({ e, owner: this.unit.f.owner[e], x: f.x, y: f.y, size: f.size, reach: s.linkRange, site: this.isSite(e) });
    }
    return nodes;
  }

  // --- building <-> unit visits ---------------------------------------------
  //
  // A building's program can only give orders to a unit while it is "visiting": the unit
  // was just produced there, or just docked there. Each visit raises a Visitor event; while
  // that handler runs, order() and the visitor queries apply to that unit. Holding on to the
  // handle grants nothing, because order() only ever targets the current visitor.

  addVisitor(building: number, e: number, reason: number): void {
    const f = this.flowFor(building);
    if (!f || !handles(f.program, EventId.Visitor)) return;
    raise(f, EventId.Visitor, reason, this.world.handle(e), 0, 0, (h) => {
      const reasons = configInts(f.program.handlers[h], 'reasons');
      return reasons.length === 0 || reasons.includes(reason);
    });
  }

  endVisit(building: number): void {
    this.visiting[building] = -1;
  }

  // --- stepping --------------------------------------------------------------

  /** Advance one tick. Read world changes / events afterwards, then call commit(). */
  step(): void {
    this.spatial.rebuild(this.pos.f.x, this.pos.f.y, this.pos.dense, this.world.capacity);
    cheatSystem(this);
    powerSystem(this);
    scriptSystem(this);
    activitySystem(this);
    movementSystem(this);
    separationSystem(this);
    harvestSystem(this);
    resourceRegenerationSystem(this);
    combatSystem(this);
    missileSystem(this);
    buildSystem(this);
    repairSystem(this);
    chargingSystem(this);
    productionSystem(this);
    decaySystem(this);
    deathSystem(this);
    energyViewSystem(this);
    this.tick++;
  }

  /** Clears change tracking and events once they have been replicated. */
  commit(): void {
    this.world.flush();
    this.events.length = 0;
    this.alerts.length = 0;
    this.radarPulses.length = 0;
  }

  /** Is there open ground (no rock) all the way between two points (sub-tile units)? Buildings and units do not block it. */
  clearLine(x0: number, y0: number, x1: number, y1: number): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (TILE / 2)));
    for (let i = 0; i <= steps; i++) {
      const x = this.tileX(x0 + ((x1 - x0) * i) / steps);
      const y = this.tileY(y0 + ((y1 - y0) * i) / steps);
      if (!this.terrain.isPassable(x, y)) return false;
    }
    return true;
  }

  /**
   * Sends a message over a radio or laser link to every allied unit and building in range that has
   * the same kind of module (and, for a laser, a clear line to it) and a Message block that accepts it.
   * Returns how many received it, or -1 if there is no working module or the energy is not there.
   */
  transmit(e: number, link: number, channel: number, value: number): number {
    const s = this.stats(e);
    const laser = link === CommsLink.Laser;
    const range = laser ? s.laserRange : s.radioRange;
    const use = laser ? s.laserUse : s.radioUse;
    if (range <= 0 || !this.spend(e, use)) return -1;
    const owner = this.unit.f.owner[e];
    const x = this.pos.f.x[e];
    const y = this.pos.f.y[e];
    const sender = this.world.handle(e);
    let heard = 0;
    this.spatial.forEachInRadius(x, y, range, (o) => {
      if (o === e || !this.unit.has(o) || this.isSite(o) || !this.allied(this.unit.f.owner[o], owner)) return;
      const f = this.flows[o];
      if (!f || !handles(f.program, EventId.Message) || (laser ? this.stats(o).laserRange : this.stats(o).radioRange) <= 0) return;
      if (laser && !this.clearLine(x, y, this.pos.f.x[o], this.pos.f.y[o])) return;
      const taken = raise(f, EventId.Message, channel, value, sender, link, (h) => {
        const cfg = f.program.handlers[h];
        const channels = configInts(cfg, 'channels');
        const only = configInt(cfg, 'link');
        return (channels.length === 0 || channels.includes(channel)) && (only === 0 || only === link);
      });
      if (taken) heard++;
    });
    return heard;
  }

  /** Ticks until `e`'s radar can pulse again (0 when ready). */
  radarCooldown(e: number): number {
    return Math.max(0, (this.radarReady.get(this.world.handle(e)) ?? 0) - this.tick);
  }

  /**
   * Fires a one-off radar pulse spending `energy` (capped by the module). Range is
   * RADAR_ENERGY_PER_TILE energy per tile. Returns the number of contacts, or -1 if
   * there is no working radar, it is still resting, or the unit cannot pay.
   */
  radarPulse(e: number, energy: number): number {
    const max = this.stats(e).radarMaxEnergy;
    if (max <= 0 || this.radarCooldown(e) > 0) return -1;
    const spend = Math.min(max, Math.floor(energy));
    if (spend < RADAR_ENERGY_PER_TILE || !this.spend(e, spend)) return -1;
    this.radarReady.set(this.world.handle(e), this.tick + RADAR_COOLDOWN_TICKS);
    const owner = this.unit.f.owner[e];
    const x = this.pos.f.x[e];
    const y = this.pos.f.y[e];
    const range = Math.floor(spend / RADAR_ENERGY_PER_TILE) * TILE;
    const contacts: RadarContact[] = [];
    this.spatial.forEachInRadius(x, y, range, (o) => {
      if (o === e || !this.unit.has(o) || this.isSite(o) || this.allied(this.unit.f.owner[o], owner)) return;
      contacts.push({ x: Math.round(this.pos.f.x[o]), y: Math.round(this.pos.f.y[o]), owner: this.unit.f.owner[o], structure: this.stats(o).structure, blueprint: this.unit.f.blueprint[o] });
    });
    this.radarPulses.push({ owner, x: Math.round(x), y: Math.round(y), range, contacts });
    return contacts.length;
  }

  tileX(x: number): number {
    return Math.min(this.config.width - 1, Math.max(0, Math.floor(x / TILE)));
  }

  tileY(y: number): number {
    return Math.min(this.config.height - 1, Math.max(0, Math.floor(y / TILE)));
  }

  private ownedBlueprint(owner: number, e: number): Blueprint {
    const bp = this.world.isAlive(e) && this.unit.f.owner[e] === owner ? this.blueprintOf(e) : undefined;
    if (!bp || !this.tasks[e]) throw new CommandError('Not your unit');
    return bp;
  }

  private clamp(v: number, max: number): number {
    return Math.min(max - 1, Math.max(0, Math.floor(v)));
  }

  private clampTile(t: number, max: number): number {
    return Math.min(max - 1, Math.max(0, Math.floor(t)));
  }
}
