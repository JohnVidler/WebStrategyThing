import type { Builtin, HostApi } from '../vm/types';
import { Caps, type Blueprint, type BlueprintStats } from './blueprint';
import { PARTS, SLOT_CODES, TILE } from './parts';
import { daylight, StorageMode, wind } from './power';
import type { Simulation } from './simulation';
import { TaskFlag, TaskType } from './tasks';

/**
 * Context handed to builtins. A single instance is reused for every unit
 * (the script system just repoints it), so running scripts allocates nothing.
 */
export interface UnitContext {
  readonly sim: Simulation;
  e: number;
  bp: Blueprint;
  /** Effective stats for this unit's current module switches. */
  stats: BlueprintStats;
}

/** Visit reasons returned by nextVisitor(). */
export const VisitReason = {
  Produced: 1,
  Docked: 2,
} as const;

/** Documentation groups, in display order. */
export const API_GROUPS = [
  'Self',
  'Tasks',
  'Sensing',
  'Movement',
  'Actions',
  'Construction & resources',
  'Energy & modules',
  'Power network',
  'Buildings',
] as const;

/** Names usable in scripts as integer constants, with a short description for the docs. */
export const SCRIPT_CONSTANT_DOCS: readonly (readonly [string, number, string])[] = [
  ['MOVE', TaskType.Move, 'Task: travel to (x, y)'],
  ['ATTACK', TaskType.Attack, 'Task: attack the target'],
  ['HARVEST', TaskType.Harvest, 'Task: gather from the target resource'],
  ['DOCK', TaskType.Dock, 'Task: unload at the target depot'],
  ['STOP', TaskType.Stop, 'Task: stop what you are doing'],
  ['CHARGE', TaskType.Charge, 'Task: recharge at the target charging pad'],
  ['BUILD', TaskType.Build, 'Task: construct the target building site'],
  ['SUPPLY', TaskType.Supply, 'Task: give energy to the target (e.g. a unit that ran flat)'],
  ['FROM_PLAYER', TaskFlag.Player, 'Task flag: issued by the player'],
  ['FROM_BUILDING', TaskFlag.Building, 'Task flag: issued by a building script'],
  ['URGENT', TaskFlag.Urgent, 'Task flag: the player did not hold the queue modifier'],
  ['PRODUCED', VisitReason.Produced, 'Visit reason: just built here'],
  ['DOCKED', VisitReason.Docked, 'Visit reason: just docked here'],
  ['CAN_MOVE', Caps.Move, 'Capability: has a working motor'],
  ['CAN_FIGHT', Caps.Fight, 'Capability: has a working weapon'],
  ['CAN_HARVEST', Caps.Harvest, 'Capability: has a working cargo bay'],
  ['CAN_FLY', Caps.Fly, 'Capability: flies'],
  ['CAN_BUILD', Caps.Build, 'Capability: has a working build arm'],
  ['HAS_RADAR', Caps.Radar, 'Capability: has a working radar module'],
  ['IS_STRUCTURE', Caps.Structure, 'Capability: is a building'],
  ['IS_FACTORY', Caps.Factory, 'Capability: can produce units'],
  ['IS_DEPOT', Caps.Depot, 'Capability: has resource silos (units can fill or take)'],
  ['IS_CHARGER', Caps.Charger, 'Capability: charges units'],
  ['IS_GENERATOR', Caps.Generator, 'Capability: generates power'],
  ['IS_STORAGE', Caps.Storage, 'Capability: has battery banks'],
  ['NORMAL', StorageMode.Normal, 'Storage mode: refill first, like any consumer'],
  ['CHARGE_STORE', StorageMode.Charge, 'Storage mode: absorb surplus power only'],
  ['DISCHARGE', StorageMode.Discharge, 'Storage mode: supply the network when short'],
  ['HOLD', StorageMode.Hold, 'Storage mode: neither take nor give'],
  ...Object.entries(SLOT_CODES).map(
    ([slot, code]) => [`M_${slot.toUpperCase()}`, code, `Module kind: ${slot}`] as const,
  ),
];

export const SCRIPT_CONSTANTS: ReadonlyMap<string, number> = new Map(
  SCRIPT_CONSTANT_DOCS.map(([name, value]) => [name, value]),
);

const tileOf = (v: number) => Math.floor(v / TILE);
const tileCentre = (t: number) => t * TILE + TILE / 2;

/**
 * Entity index for handle `h` if this unit knows where it is, else -1.
 * Own units, own buildings and resources are always known; anything else
 * must be within range of a working sensor.
 */
function locate(c: UnitContext, h: number): number {
  const { sim, e } = c;
  const t = sim.world.resolve(h);
  if (t < 0 || t === e) return t;
  if (sim.resource.has(t)) return t;
  if (sim.unit.has(t) && sim.unit.f.owner[t] === sim.unit.f.owner[e]) return t;
  const r = c.stats.sensorRange;
  return sim.distSq(e, t) <= r * r ? t : -1;
}

/** Charges the sensor's energy cost; false if there is no working, powered sensor. */
function powerSensor(c: UnitContext): boolean {
  return c.stats.sensorRange > 0 && c.sim.spend(c.e, c.stats.sensorUse);
}

function scanUnits(c: UnitContext, enemy: boolean): number {
  if (!powerSensor(c)) return -1;
  const { sim, e } = c;
  const unit = sim.unit;
  const mine = unit.f.owner[e];
  const t = sim.spatial.nearest(
    sim.pos.f.x[e],
    sim.pos.f.y[e],
    c.stats.sensorRange,
    (o) => o !== e && unit.has(o) && (enemy ? !sim.allied(unit.f.owner[o], mine) : unit.f.owner[o] === mine),
  );
  return t < 0 ? -1 : sim.world.handle(t);
}

const queue = (c: UnitContext) => c.sim.tasks[c.e]!;

/** The unit this building may currently order, or -1. */
function currentVisitor(c: UnitContext): number {
  return c.sim.world.resolve(c.sim.visiting[c.e] ?? -1);
}

const handleOf = (c: UnitContext, t: number) => (t < 0 ? -1 : c.sim.world.handle(t));

type Fn = (c: UnitContext, a: Int32Array) => number;

/** Declares a builtin from a signature string like 'approach(h, r)'. */
function api(
  group: (typeof API_GROUPS)[number],
  sig: string,
  cost: number,
  doc: string,
  fn: Fn,
  opts: { free?: boolean } = {},
): Builtin<UnitContext> {
  const m = /^(\w+)\((.*)\)$/.exec(sig);
  if (!m) throw new Error(`Bad signature ${sig}`);
  const args = m[2] ? m[2].split(',').map((s) => s.trim()) : [];
  return { name: m[1], argc: args.length, cost, doc, group, args, fn, free: opts.free };
}

/**
 * Everything a script can do. Index in this array is the builtin id baked
 * into bytecode: append only, or recompile all programs.
 * `cost` is CPU cycles charged on top of the 1-cycle CALL. Energy costs come
 * from the module used and are noted in each description.
 */
export const UNIT_API: HostApi<UnitContext> = [
  // --- Self -------------------------------------------------------------------
  api('Self', 'x()', 0, 'Own tile x.', (c) => tileOf(c.sim.pos.f.x[c.e])),
  api('Self', 'y()', 0, 'Own tile y.', (c) => tileOf(c.sim.pos.f.y[c.e])),
  api('Self', 'hp()', 0, 'Own hit points.', (c) => c.sim.health.f.hp[c.e]),
  api('Self', 'hpMax()', 0, 'Own maximum hit points.', (c) => c.stats.hp),
  api('Self', 'me()', 0, 'Own handle.', (c) => c.sim.world.handle(c.e)),
  api('Self', 'caps()', 0, 'Own capability bits (CAN_*, IS_*), reflecting switched-off modules.', (c) => c.stats.caps),
  api('Self', 'tick()', 0, 'Current simulation tick (10 per second).', (c) => c.sim.tick),
  api('Self', 'rand(n)', 1, 'Random integer 0..n-1 (deterministic).', (c, a) => c.sim.rng.int(a[0])),
  api('Self', 'credits()', 0, "Owner's common pool: resources held in all their silos.", (c) => c.sim.pool(c.sim.unit.f.owner[c.e])),
  api('Self', 'sleep(n)', 0,
    'Skip the next n ticks (max 600): the CPU uses no energy while asleep, and calling sleep() is free. Takes effect after the current tick.',
    (c, a) => ((c.sim.sleepUntil[c.e] = c.sim.tick + 1 + Math.max(0, Math.min(600, a[0]))), 1),
    { free: true }),

  // --- Tasks ------------------------------------------------------------------
  api('Tasks', 'taskCount()', 0, 'Number of queued tasks.', (c) => queue(c).count),
  api('Tasks', 'taskType(i)', 0, 'Type of task i (0 = none). Index 0 is the front.', (c, a) => queue(c).type(a[0])),
  api('Tasks', 'taskX(i)', 0, 'Tile x of task i.', (c, a) => queue(c).x(a[0])),
  api('Tasks', 'taskY(i)', 0, 'Tile y of task i.', (c, a) => queue(c).y(a[0])),
  api('Tasks', 'taskTarget(i)', 0, 'Target handle of task i, or -1.', (c, a) => queue(c).target(a[0])),
  api('Tasks', 'taskFlags(i)', 0, 'FROM_PLAYER / FROM_BUILDING / URGENT bits of task i.', (c, a) => queue(c).flags(a[0])),
  api('Tasks', 'taskDrop(i)', 1, 'Remove task i. Returns 1 if it existed.', (c, a) => (queue(c).remove(a[0]) ? 1 : 0)),
  api('Tasks', 'taskFirst(i)', 1, 'Move task i to the front. Returns 1 if it existed.', (c, a) => (queue(c).toFront(a[0]) ? 1 : 0)),
  api('Tasks', 'taskAck(i)', 0, 'Acknowledge task i: clears its URGENT flag, so it is no longer mistaken for a new order.',
    (c, a) => (queue(c).clearFlags(a[0], TaskFlag.Urgent) ? 1 : 0)),
  api('Tasks', 'taskPush(type, x, y, target)', 1, 'Append a task to your own queue (no flags). Returns 1 if there was room.',
    (c, a) => (queue(c).push(a[0], a[1], a[2], a[3], 0) ? 1 : 0)),

  // --- Sensing ----------------------------------------------------------------
  api('Sensing', 'scan()', 8, 'Nearest enemy in sensor range, or -1. Energy: sensor use.', (c) => scanUnits(c, true)),
  api('Sensing', 'scanAlly()', 8, 'Nearest own unit in sensor range, or -1. Energy: sensor use.', (c) => scanUnits(c, false)),
  api('Sensing', 'scanResource()', 8, 'Nearest resource in sensor range, or -1. Energy: sensor use.', (c) => {
    if (!powerSensor(c)) return -1;
    const { sim, e } = c;
    return handleOf(c, sim.spatial.nearest(sim.pos.f.x[e], sim.pos.f.y[e], c.stats.sensorRange, (o) => sim.resource.has(o) && sim.resource.f.amount[o] > 0));
  }),
  api('Sensing', 'radarPulse(energy)', 10,
    'One-off radar scan: spends `energy` (at most the module allows; 25 per tile of range) and reveals every non-allied unit and building in that radius to you as fading blips on the map. Returns the number of contacts, or -1 with no radar, while it rests, or if the energy is not there.',
    (c, a) => c.sim.radarPulse(c.e, a[0])),
  api('Sensing', 'radarCooldown()', 0, 'Ticks until the radar can pulse again; 0 when ready (or if there is no radar).',
    (c) => c.sim.radarCooldown(c.e)),
  api('Sensing', 'nearestDepot()', 4, 'Nearest own finished building with silo space to spare, or -1.',
    (c) => handleOf(c, c.sim.nearestOwn(c.e, Caps.Depot, (b) => c.sim.stockpile.f.amount[b] < c.sim.stats(b).resourceCapacity))),
  api('Sensing', 'nearestStock()', 4, 'Nearest own finished building with resources in its silos, or -1.',
    (c) => handleOf(c, c.sim.nearestOwn(c.e, Caps.Depot, (b) => c.sim.stockpile.f.amount[b] > 0))),
  api('Sensing', 'nearestCharger()', 4, 'Nearest own building with a working charging pad, or -1.',
    (c) => handleOf(c, c.sim.nearestOwn(c.e, Caps.Charger))),
  api('Sensing', 'posx(h)', 1, 'Tile x of a known unit, or -1. Enemies must be in sensor range.',
    (c, a) => { const t = locate(c, a[0]); return t < 0 ? -1 : tileOf(c.sim.pos.f.x[t]); }),
  api('Sensing', 'posy(h)', 1, 'Tile y of a known unit, or -1.',
    (c, a) => { const t = locate(c, a[0]); return t < 0 ? -1 : tileOf(c.sim.pos.f.y[t]); }),
  api('Sensing', 'dist(h)', 2, "Tiles to a known unit (to a building's edge), or -1.",
    (c, a) => { const t = locate(c, a[0]); return t < 0 ? -1 : Math.floor(c.sim.edgeDistance(c.e, t) / TILE); }),
  api('Sensing', 'nearestStorage()', 4, 'Nearest own finished building with silos, even if they are full, or -1.',
    (c) => handleOf(c, c.sim.nearestOwn(c.e, Caps.Depot))),
  api('Sensing', 'randomResource(k, min)', 6,
    'One of the k nearest resources that hold at least min matter, picked at random so workers spread out instead of farming one field, or -1. Resources are known everywhere; no sensor needed.',
    (c, a) => {
      const { sim, e } = c;
      const x = sim.pos.f.x[e];
      const y = sim.pos.f.y[e];
      const near: { d: number; r: number }[] = [];
      for (const r of sim.resource.dense) {
        if (sim.resource.f.amount[r] < a[1]) continue;
        near.push({ d: (sim.pos.f.x[r] - x) ** 2 + (sim.pos.f.y[r] - y) ** 2, r });
      }
      near.sort((p, q) => p.d - q.d || p.r - q.r);
      const pool = near.slice(0, Math.max(1, Math.min(16, a[0])));
      return pool.length ? handleOf(c, pool[sim.rng.int(pool.length)].r) : -1;
    }),
  api('Sensing', 'resource(h)', 1, 'Amount left in a resource; 0 if gone.', (c, a) => {
    const t = c.sim.world.resolve(a[0]);
    return t >= 0 && c.sim.resource.has(t) ? c.sim.resource.f.amount[t] : 0;
  }),
  api('Sensing', 'passable(x, y)', 1, '1 if ground units can enter tile (x, y): passable terrain with no building.',
    (c, a) => (c.sim.terrain.walkable(a[0], a[1]) ? 1 : 0)),

  // --- Movement ---------------------------------------------------------------
  api('Movement', 'moving()', 0, '1 while travelling.', (c) => (c.sim.motion.has(c.e) ? c.sim.motion.f.moving[c.e] : 0)),
  api('Movement', 'flying()', 0, '1 if this unit flies (has a working rotor).', (c) => (c.stats.flying ? 1 : 0)),
  api('Movement', 'moveTo(x, y)', 1, 'Travel to tile (x, y), pathing around obstacles. Energy: motor use per tick moving.',
    (c, a) => c.sim.setDestination(c.e, tileCentre(a[0]), tileCentre(a[1]))),
  api('Movement', 'move(dx, dy)', 1, 'Travel by (dx, dy) tiles.',
    (c, a) => c.sim.setDestination(c.e, c.sim.pos.f.x[c.e] + a[0] * TILE, c.sim.pos.f.y[c.e] + a[1] * TILE)),
  api('Movement', 'goTo(x, y)', 1,
    '1 once at tile (x, y) — or as close as it can get — 0 while travelling, -1 if it cannot move.',
    (c, a) => {
      const { sim, e } = c;
      const tx = tileCentre(a[0]);
      const ty = tileCentre(a[1]);
      const dx = tx - sim.pos.f.x[e];
      const dy = ty - sim.pos.f.y[e];
      if (dx * dx + dy * dy <= (TILE / 2) ** 2) {
        if (sim.motion.f.moving[e]) sim.halt(e);
        return 1;
      }
      const m = sim.motion.f;
      if (sim.motion.has(e) && m.arrived[e] && m.tx[e] === tx && m.ty[e] === ty) return 1;
      return sim.setDestination(e, tx, ty) < 0 ? -1 : 0;
    }),
  api('Movement', 'approach(h, r)', 2,
    "1 once within r tiles of a known unit (a building's edge), 0 while travelling, -1 if unknown or unreachable.",
    (c, a) => {
      const { sim, e } = c;
      const t = locate(c, a[0]);
      if (t < 0) return -1;
      if (sim.edgeDistance(e, t) <= a[1] * TILE) {
        if (sim.motion.has(e) && sim.motion.f.moving[e]) sim.halt(e);
        return 1;
      }
      const m = sim.motion.f;
      const tx = sim.pos.f.x[t];
      const ty = sim.pos.f.y[t];
      if (sim.motion.has(e) && m.arrived[e] && m.tx[e] === tx && m.ty[e] === ty) {
        // End of the path but still out of range: unreachable. Stopped by a crowd: try again.
        if (m.arrived[e] === 1) return -1;
        m.arrived[e] = 0;
      }
      return sim.setDestination(e, tx, ty) < 0 ? -1 : 0;
    }),
  api('Movement', 'stop()', 0, 'Stop travelling (flying units still drift to a cell they can land on).', (c) => (c.sim.halt(c.e), 0)),

  // --- Actions ----------------------------------------------------------------
  api('Actions', 'fire(h)', 2, 'Lock the weapon on a unit; returns 1 if in range. The weapon fires automatically. Energy: weapon use per shot.',
    (c, a) => {
      const { sim, e } = c;
      const w = c.stats.weapon;
      if (!w || !sim.weapon.has(e)) return 0;
      const t = locate(c, a[0]);
      if (t < 0 || t === e || !sim.health.has(t)) {
        sim.weapon.f.target[e] = -1;
        return 0;
      }
      sim.weapon.f.target[e] = sim.world.handle(t);
      return sim.edgeDistance(e, t) <= w.range ? 1 : 0;
    }),
  api('Actions', 'laserPower(energy)', 1,
    "Set the energy a laser spends per shot (1 to the laser's maximum); damage scales in proportion, so half the energy is half the damage. 0 restores the maximum. Returns the energy now in use, or 0 without a laser.",
    (c, a) => {
      const { sim, e } = c;
      const w = c.stats.weapon;
      if (!w || w.kind !== 'laser' || !sim.weapon.has(e)) return 0;
      const p = a[0] <= 0 ? 0 : Math.min(Math.max(1, Math.floor(a[0])), c.stats.weapon!.use);
      sim.weapon.f.power[e] = p;
      return p > 0 ? p : w.use;
    }),
  api('Actions', 'cargo()', 0, 'Resources carried.', (c) => (c.sim.cargo.has(c.e) ? c.sim.cargo.f.amount[c.e] : 0)),
  api('Actions', 'cargoMax()', 0, 'Cargo capacity (0 if the cargo bay is off).', (c) => c.stats.cargo),
  api('Actions', 'harvest(h)', 1, 'Gather from an adjacent resource each tick until full; 1 if gathering. Energy: cargo bay use per tick.',
    (c, a) => {
      const { sim, e } = c;
      if (!sim.harvester.has(e)) return 0;
      sim.harvester.f.target[e] = a[0];
      return sim.canHarvest(e) ? 1 : 0;
    }),
  api('Actions', 'dock(h)', 2, "Unload cargo into an adjacent own depot's silos (as much as fits) and become its visitor; 1 on success.", (c, a) => {
    const t = c.sim.world.resolve(a[0]);
    return t >= 0 && c.sim.dock(c.e, t) ? 1 : 0;
  }),

  // --- Construction & resources ---------------------------------------------------
  api('Construction & resources', 'build(h)', 1,
    'Work on an own construction site every tick until it is finished; 1 if in range (1.5 tiles for build arms, 4 for a building\'s build crane). Pays from cargo first, then the common pool if the site is supplied. Energy: build-arm use per tick.',
    (c, a) => {
      const { sim, e } = c;
      if (!sim.builder.has(e) || c.stats.buildRate <= 0) return 0;
      const t = sim.world.resolve(a[0]);
      if (t < 0 || !sim.isSite(t) || sim.unit.f.owner[t] !== sim.unit.f.owner[e]) return 0;
      sim.builder.f.target[e] = a[0];
      return sim.edgeDistance(e, t) <= sim.buildRange(e) ? 1 : 0;
    }),
  api('Construction & resources', 'nearestSite()', 4, 'Nearest own construction site, or -1. A construction tower can pass it straight to build().',
    (c) => handleOf(c, c.sim.nearestSite(c.e))),
  api('Construction & resources', 'buildProgress(h)', 0, 'Percent built of a construction site; 100 if finished, -1 if gone.',
    (c, a) => {
      const t = c.sim.world.resolve(a[0]);
      if (t < 0 || !c.sim.unit.has(t)) return -1;
      return c.sim.isSite(t) ? c.sim.construction.f.progress[t] : 100;
    }),
  api('Construction & resources', 'siteSupplied(h)', 1,
    "1 if a construction site is linked (via the power grid) to a silo, so builders can draw from the common pool; 0 means resources must be carried there.",
    (c, a) => { const t = c.sim.world.resolve(a[0]); return t >= 0 && c.sim.isSite(t) && c.sim.siteSupplied(t) ? 1 : 0; }),
  api('Construction & resources', 'take(h, n)', 2, 'Load up to n resources from an adjacent own depot into your cargo bay; returns the amount taken.',
    (c, a) => { const t = c.sim.world.resolve(a[0]); return t < 0 ? 0 : c.sim.take(c.e, t, a[1]); }),
  api('Construction & resources', 'stock(h)', 0, "Resources held in an own building's silos (-1 if not an own depot).",
    (c, a) => {
      const t = c.sim.world.resolve(a[0]);
      return t >= 0 && c.sim.stockpile.has(t) && c.sim.unit.f.owner[t] === c.sim.unit.f.owner[c.e] ? c.sim.stockpile.f.amount[t] : -1;
    }),
  api('Construction & resources', 'stockMax(h)', 0, "Silo capacity of an own building (-1 if not an own depot).",
    (c, a) => {
      const t = c.sim.world.resolve(a[0]);
      return t >= 0 && c.sim.stockpile.has(t) && c.sim.unit.f.owner[t] === c.sim.unit.f.owner[c.e] ? c.sim.stats(t).resourceCapacity : -1;
    }),

  // --- Energy & modules ---------------------------------------------------------
  api('Energy & modules', 'energy()', 0, 'Stored energy.', (c) => c.sim.energy.f.amount[c.e]),
  api('Energy & modules', 'energyMax()', 0, 'Energy capacity.', (c) => c.stats.energyCapacity),
  api('Energy & modules', 'energyOf(h)', 0, "Energy percentage of an own unit or building, or -1.", (c, a) => {
    const t = c.sim.world.resolve(a[0]);
    return t >= 0 && c.sim.energy.has(t) && c.sim.unit.f.owner[t] === c.sim.unit.f.owner[c.e] ? c.sim.energyView.f.pct[t] : -1;
  }),
  api('Energy & modules', 'giveEnergy(h, n)', 2,
    "Transfer n energy to an own unit or building — only if you have at least n, and within reach (units: 1 tile; buildings: 3 tiles from their edge). Returns the amount the receiver took.",
    (c, a) => { const t = c.sim.world.resolve(a[0]); return t < 0 ? 0 : c.sim.transferEnergy(c.e, t, a[1]); }),
  api('Energy & modules', 'moduleCount()', 0, 'Number of parts, including the chassis (index 0..n-1).', (c) => c.bp.parts.length),
  api('Energy & modules', 'moduleKind(i)', 0, 'Kind of part i as an M_* constant (0 if out of range).',
    (c, a) => { const id = c.bp.parts[a[0]]; return id ? SLOT_CODES[PARTS[id].slot] : 0; }),
  api('Energy & modules', 'moduleOn(i)', 0, '1 if part i is switched on (passive parts are always on).',
    (c, a) => (a[0] >= 0 && a[0] < c.bp.parts.length && !((c.sim.modules.f.off[c.e] >>> a[0]) & 1) ? 1 : 0)),
  api('Energy & modules', 'setModule(i, on)', 2,
    'Switch part i on (1) or off (0). Only energy-using modules switch; a script cannot switch off its last CPU. Returns 1 on success.',
    (c, a) => (c.sim.setModule(c.e, a[0], a[1] !== 0, true) ? 1 : 0)),

  // --- Power network ------------------------------------------------------------
  api('Power network', 'daylight()', 0, 'Sunlight 0..100 (solar output follows it).', (c) => daylight(c.sim.tick)),
  api('Power network', 'wind()', 0, 'Wind 0..100 (turbine output follows it).', (c) => wind(c.sim.config.seed, c.sim.tick)),
  api('Power network', 'netSupply()', 0, "This building's network: energy generated last tick (0 for units).",
    (c) => c.sim.networkFor(c.e)?.supply ?? 0),
  api('Power network', 'netDemand()', 0, "This building's network: energy normal consumers wanted last tick.",
    (c) => c.sim.networkFor(c.e)?.demand ?? 0),
  api('Power network', 'netStored()', 0, "This building's network: total energy stored.", (c) => c.sim.networkFor(c.e)?.stored ?? 0),
  api('Power network', 'netCapacity()', 0, "This building's network: total storage capacity.", (c) => c.sim.networkFor(c.e)?.capacity ?? 0),
  api('Power network', 'storageMode(m)', 1, "Set how the network treats this building's store: NORMAL, CHARGE_STORE, DISCHARGE or HOLD.",
    (c, a) => {
      if (!c.sim.storage.has(c.e) || a[0] < StorageMode.Normal || a[0] > StorageMode.Hold) return 0;
      c.sim.storage.f.mode[c.e] = a[0];
      return 1;
    }),

  // --- Buildings ------------------------------------------------------------------
  api('Buildings', 'nextVisitor()', 2, 'Take the next visiting unit: returns PRODUCED, DOCKED or 0. Ends any previous visit.',
    (c) => c.sim.takeVisitor(c.e)),
  api('Buildings', 'visitor()', 0, 'Handle of the current visitor, or -1.', (c) => (currentVisitor(c) < 0 ? -1 : c.sim.visiting[c.e])),
  api('Buildings', 'visitorCaps()', 0, "Current visitor's CAN_* / IS_* bits.",
    (c) => { const v = currentVisitor(c); return v < 0 ? 0 : c.sim.stats(v).caps; }),
  api('Buildings', 'visitorEnergy()', 0, "Current visitor's energy as a percentage, or -1.",
    (c) => { const v = currentVisitor(c); return v < 0 ? -1 : c.sim.energyView.f.pct[v]; }),
  api('Buildings', 'visitorLastHarvest()', 0, 'Resource the current visitor last worked, or -1.', (c) => {
    const v = currentVisitor(c);
    return v >= 0 && c.sim.harvester.has(v) ? c.sim.harvester.f.target[v] : -1;
  }),
  api('Buildings', 'order(type, x, y, target)', 2, 'Queue a task on the current visitor (flagged FROM_BUILDING). Returns 1 if accepted.',
    (c, a) => {
      const v = currentVisitor(c);
      if (v < 0 || a[0] <= TaskType.None || a[0] > TaskType.Supply) return 0;
      return c.sim.tasks[v]!.push(a[0], a[1], a[2], a[3], TaskFlag.Building) ? 1 : 0;
    }),
  api('Buildings', 'unitClassCount()', 0, 'Number of your own unit classes (not retired, not buildings) a factory can produce, in the order they were defined.',
    (c) => unitClasses(c).length),
  api('Buildings', 'queueUnit(i)', 4, 'Factory only: queue one unit of your i-th unit class (0 to unitClassCount() - 1), paid from the common pool. Returns 1 if queued.',
    (c, a) => {
      const bp = unitClasses(c)[a[0]];
      return bp && c.sim.tryEnqueueProduction(c.e, bp.id) ? 1 : 0;
    }),
  api('Buildings', 'queueLength()', 0, "Units waiting in this factory's production queue.", (c) => c.sim.productionQueue[c.e]?.length ?? 0),
];

/** The owner's producible classes, in definition order. */
function unitClasses(c: UnitContext) {
  return c.sim.blueprints.ownedBy(c.sim.unit.f.owner[c.e]).filter((b) => !b.stats.structure && !b.retired);
}
