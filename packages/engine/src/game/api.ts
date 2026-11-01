import { CommsLink, FLOW_CONSTANT_DOCS } from '../flow/events';
import { MAX_TEXT } from '../flow/check';
import { LIST_MAX } from '../flow/cost';
import { addTimer, textAt } from '../flow/run';
import { ACTIVITY_OUTCOMES, ActivityKind, cancelActivity, resumeActivity, startActivity, suspendActivity } from './activity';
import type { Builtin, CallKind, HostApi } from '../flow/host';
import { Caps, type Blueprint, type BlueprintStats } from './blueprint';
import { PARTS, SLOT_CODES, TIER_NAMES, TILE, type WeaponKind } from './parts';
import { StorageMode } from './power';
import { DEEP_MAX } from './rules';
import type { Simulation } from './simulation';
import { rangeBonus } from './shell';
import { bearingTo, incomingBearing, reachDistance, setShieldAngle, setShieldArc, setShieldRange } from './shield';
import { lightAngleOf, lightBlocked, outwardBearing, setLightAngle, setLightPower } from './light';
import { throwSmoke } from './smoke';
import { launchDrones, recallDrones, setDroneClass } from './hangar';
import { TaskFlag, TaskType } from './tasks';
import { memberOf } from './members';

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

/** Shortest and longest time a speech bubble can stay up, in milliseconds. */
export const MIN_ALERT_MS = 100;
export const MAX_ALERT_MS = 30000;
/** Pop-up alert kinds for `notify()`, by the value of the NOTE_* constants (the client turns the index into a colour). */
export const NOTICE_KINDS = ['ok', 'info', 'warn', 'error'] as const;
/** Ticks a unit must wait between pop-up alerts, and the most one player can raise in a tick (the rest are dropped). */
export const NOTICE_COOLDOWN_TICKS = 20;
export const MAX_NOTICES_PER_OWNER_TICK = 2;
/** Milliseconds per simulation tick (10 ticks per second; protocol.ts cannot be imported here without a cycle). */
const MS_PER_TICK = 100;

/** Visit reasons returned by nextVisitor(). */
export const VisitReason = {
  Produced: 1,
  Docked: 2,
} as const;

/** Documentation groups, in display order. */
export const API_GROUPS = [
  'Self',
  'Orders',
  'Sensing',
  'Lists',
  'Movement',
  'Activities',
  'Actions',
  'Construction & resources',
  'Energy & modules',
  'Power network',
  'Communication',
  'Buildings',
] as const;

/** Weapon kinds as numbers for scripts (W_GUN, W_LASER, ...). Every kind must have one. */
export const WEAPON_KIND_CODES: Readonly<Record<WeaponKind, number>> = {
  gun: 0, cannon: 1, laser: 2, tesla: 3, missile: 4, flak: 5, flame: 6, rail: 7, ion: 8,
};

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
  ['REPAIR', TaskType.Repair, 'Task: mend the target own unit or building'],
  ['FROM_PLAYER', TaskFlag.Player, 'Task flag: issued by the player'],
  ['FROM_BUILDING', TaskFlag.Building, 'Task flag: issued by a building script'],
  ['URGENT', TaskFlag.Urgent, 'Task flag: the player did not hold the queue modifier'],
  ['A_NONE', ActivityKind.None, 'Activity kind: nothing under way'],
  ['A_GOTO', ActivityKind.GoTo, 'Activity kind: goTo'],
  ['A_APPROACH', ActivityKind.Approach, 'Activity kind: approach'],
  ['A_HARVEST', ActivityKind.Harvest, 'Activity kind: harvest'],
  ['A_DOCK', ActivityKind.Dock, 'Activity kind: dock'],
  ['A_TAKE', ActivityKind.Take, 'Activity kind: take'],
  ['A_BUILD', ActivityKind.Build, 'Activity kind: build'],
  ['A_REPAIR', ActivityKind.Repair, 'Activity kind: repair'],
  ['A_CHARGE', ActivityKind.Charge, 'Activity kind: charge'],
  ['A_SUPPLY', ActivityKind.Supply, 'Activity kind: supply'],
  ['A_ENGAGE', ActivityKind.Engage, 'Activity kind: engage'],
  ...NOTICE_KINDS.map((name, kind) => [`NOTE_${name.toUpperCase()}`, kind, `Pop-up alert kind: ${name} (see notify)`] as const),
  ['PRODUCED', VisitReason.Produced, 'Visit reason: just built here'],
  ['DOCKED', VisitReason.Docked, 'Visit reason: just docked here'],
  ['CAN_MOVE', Caps.Move, 'Capability: has a working motor'],
  ['CAN_FIGHT', Caps.Fight, 'Capability: has a working weapon'],
  ['CAN_HARVEST', Caps.Harvest, 'Capability: has a working cargo bay'],
  ['CAN_FLY', Caps.Fly, 'Capability: flies'],
  ['CAN_BUILD', Caps.Build, 'Capability: has a working build arm'],
  ['HAS_RADAR', Caps.Radar, 'Capability: has a working radar module'],
  ['HAS_RADIO', Caps.Radio, 'Capability: has a working radio module'],
  ['HAS_LASER', Caps.Laser, 'Capability: has a working laser link module'],
  ['CAN_REPAIR', Caps.Repair, 'Capability: has a working repair module'],
  ['HAS_SHIELD', Caps.Shield, 'Capability: has a working shield emitter'],
  ['HAS_LIGHT', Caps.Light, 'Capability: has a working spotlight'],
  ['IS_STRUCTURE', Caps.Structure, 'Capability: is a building'],
  ['IS_FACTORY', Caps.Factory, 'Capability: can produce units'],
  ['IS_DEPOT', Caps.Depot, 'Capability: has resource silos (units can fill or take)'],
  ['IS_CHARGER', Caps.Charger, 'Capability: charges units'],
  ['IS_GENERATOR', Caps.Generator, 'Capability: generates power'],
  ['IS_STORAGE', Caps.Storage, 'Capability: has battery banks'],
  ...TIER_NAMES.map((name, tier) => [`SIZE_${name.toUpperCase().replace('-', '_')}`, tier, `Chassis size tier ${tier}: ${name} (compare with size() and unitSize(h))`] as const),
  ['NORMAL', StorageMode.Normal, 'Storage mode: refill first, like any consumer'],
  ['CHARGE_STORE', StorageMode.Charge, 'Storage mode: absorb surplus power only'],
  ['DISCHARGE', StorageMode.Discharge, 'Storage mode: supply the network when short'],
  ['HOLD', StorageMode.Hold, 'Storage mode: neither take nor give'],
  ['M_ANY', 0, 'Aim at any module: a random one each hit'],
  ...Object.entries(SLOT_CODES).map(
    ([slot, code]) => [`M_${slot.toUpperCase()}`, code, `Module kind: ${slot}`] as const,
  ),
  ...(Object.entries(WEAPON_KIND_CODES) as [WeaponKind, number][]).map(([kind, code]) => [`W_${kind.toUpperCase()}`, code, `Weapon kind: ${kind} (compare with weaponKind(i))`] as const),
  ...FLOW_CONSTANT_DOCS,
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
  return c.sim.locate(c.e, h);
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

/** The unit this building may currently order, or -1: still alive, a unit, and on the building's side. */
function currentVisitor(c: UnitContext): number {
  const v = c.sim.world.resolve(c.sim.visiting[c.e] ?? -1);
  return v >= 0 && c.sim.unit.has(v) && c.sim.unit.f.owner[v] === c.sim.unit.f.owner[c.e] ? v : -1;
}

const handleOf = (c: UnitContext, t: number) => (t < 0 ? -1 : c.sim.world.handle(t));

/** Squared distances of the entries `offer` is holding in `out`, in step with it. */
const NEAR_D = new Float64Array(LIST_MAX);

/**
 * Keeps the `out.length` nearest of the things offered, nearest first (ties by entity index, so the order is the
 * same on every replay). `n` is how many are held; returns the new count. No allocation.
 */
function offer(out: Int32Array, n: number, e: number, d: number): number {
  const cap = out.length;
  let i = n < cap ? n : cap - 1;
  if (n === cap && (d > NEAR_D[i] || (d === NEAR_D[i] && e > out[i]))) return n;
  while (i > 0 && (NEAR_D[i - 1] > d || (NEAR_D[i - 1] === d && out[i - 1] > e))) {
    NEAR_D[i] = NEAR_D[i - 1];
    out[i] = out[i - 1];
    i--;
  }
  NEAR_D[i] = d;
  out[i] = e;
  return n < cap ? n + 1 : n;
}

/** Turns the entity indices `offer` collected into handles. */
function toHandles(c: UnitContext, out: Int32Array, n: number): number {
  for (let i = 0; i < n; i++) out[i] = c.sim.world.handle(out[i]);
  return n;
}

/** Resources with at least `min` matter, nearest to (x, y) first. */
function fillResources(c: UnitContext, out: Int32Array, x: number, y: number, min: number): number {
  const { sim } = c;
  let n = 0;
  for (const r of sim.resource.dense) {
    if (sim.resource.f.amount[r] < min || sim.resource.f.amount[r] <= 0) continue;
    n = offer(out, n, r, (sim.pos.f.x[r] - x) ** 2 + (sim.pos.f.y[r] - y) ** 2);
  }
  return toHandles(c, out, n);
}

/** Own finished buildings with the given capabilities, nearest first. `self` includes the caller (a depot looking for depots). */
function fillOwn(c: UnitContext, out: Int32Array, caps: number, self: boolean, accept?: (b: number) => boolean): number {
  const { sim, e } = c;
  const owner = sim.unit.f.owner[e];
  let n = 0;
  for (const b of sim.unit.dense) {
    if ((b === e && !self) || sim.unit.f.owner[b] !== owner || sim.isSite(b) || (sim.stats(b).caps & caps) !== caps) continue;
    if (accept && !accept(b)) continue;
    n = offer(out, n, b, sim.distSq(e, b));
  }
  return toHandles(c, out, n);
}

/** Own harvesters (other than the caller) within r tiles (at most 20) of the known thing h; 0 if h is not known. */
function crowdAround(c: UnitContext, h: number, r: number): number {
  const t = locate(c, h);
  if (t < 0) return 0;
  const { sim, e } = c;
  const owner = sim.unit.f.owner[e];
  let n = 0;
  sim.spatial.forEachInRadius(sim.pos.f.x[t], sim.pos.f.y[t], Math.max(0, Math.min(20, r)) * TILE, (o) => {
    if (o !== e && sim.harvester.has(o) && sim.unit.f.owner[o] === owner) n++;
  });
  return n;
}

/** Units in sensor range, nearest first: enemies, or own. */
function fillScan(c: UnitContext, out: Int32Array, enemy: boolean): number {
  if (!powerSensor(c)) return 0;
  const { sim, e } = c;
  const mine = sim.unit.f.owner[e];
  const x = sim.pos.f.x[e];
  const y = sim.pos.f.y[e];
  let n = 0;
  sim.spatial.forEachInRadius(x, y, c.stats.sensorRange, (o) => {
    if (o === e || !sim.unit.has(o) || (enemy ? sim.allied(sim.unit.f.owner[o], mine) : sim.unit.f.owner[o] !== mine)) return;
    n = offer(out, n, o, (sim.pos.f.x[o] - x) ** 2 + (sim.pos.f.y[o] - y) ** 2);
  });
  return toHandles(c, out, n);
}

type Fn = (c: UnitContext, a: Int32Array) => number;

/** Declares a builtin from a signature string like 'approach(h, r)'. */
function api(
  group: (typeof API_GROUPS)[number],
  sig: string,
  cost: number,
  doc: string,
  fn: Fn,
  opts: { free?: boolean; outcomes?: readonly string[]; text?: readonly number[]; fill?: Builtin<UnitContext>['fill'] } = {},
): Builtin<UnitContext> {
  const m = /^(\w+)\((.*)\)$/.exec(sig);
  if (!m) throw new Error(`Bad signature ${sig}`);
  const args = m[2] ? m[2].split(',').map((s) => s.trim()) : [];
  return { name: m[1], argc: args.length, cost, doc, group, args, fn, free: opts.free, outcomes: opts.outcomes, text: opts.text, kind: kindOf(m[1]), ...memberOf(m[1]), ...(opts.fill ? { fill: opts.fill, list: true } : {}) };
}

/** Calls that change the world now (statements). Everything else is a query unless it is a runtime setting. */
const ACTIONS: ReadonlySet<string> = new Set([
  'after', 'alert', 'notify', 'radioSend', 'laserSend', 'radarPulse', 'moveTo', 'move', 'stop', 'fire', 'weaponFire', 'giveEnergy', 'order', 'queueUnit',
  'goTo', 'approach', 'harvest', 'dock', 'take', 'build', 'repair', 'charge', 'supply', 'engage', 'suspendActivity', 'resumeActivity',
  'nextOrder', 'swapOrder', 'clearOrders', 'smoke', 'launchDrones', 'recallDrones',
]);
/** Runtime settings: persistent standing settings of a module or the CPU, written config.name(...). */
const SETTINGS: ReadonlySet<string> = new Set(['rest', 'laserPower', 'aim', 'weaponLaserPower', 'weaponAim', 'setModule', 'storageMode', 'shieldAngle', 'shieldArc', 'shieldRange', 'lightAngle', 'lightPower', 'droneClass']);
const kindOf = (name: string): CallKind => (SETTINGS.has(name) ? 'config' : ACTIONS.has(name) ? 'action' : 'query');

/**
 * Everything a program can call. `cost` is CPU cycles charged when the call runs, on top
 * of its node and wire costs (see flow/cost.ts). Energy costs come from the module used
 * and are noted in each description.
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
  api('Self', 'calc(x)', 0, 'Returns x. It lets a const hold any expression: in the text form write const best = findResources(10).first(); (a graph shows it as a calc node).', (_c, a) => a[0]),
  api('Self', 'rand(n)', 1, 'Random integer 0..n-1 (deterministic).', (c, a) => c.sim.rng.int(a[0])),
  api('Self', 'credits()', 0, "Owner's common pool: resources held in all their silos.", (c) => c.sim.pool(c.sim.unit.f.owner[c.e])),
  api('Self', 'rest(n)', 0,
    'Pause the Idle event for the next n ticks (max 600). Other events still arrive, and a unit with nothing to do while resting uses no energy. Replaces sleep().',
    (c, a) => {
      const f = c.sim.flows[c.e];
      if (f) f.restUntil = c.sim.tick + 1 + Math.max(0, Math.min(600, a[0]));
      return 1;
    }),
  api('Self', 'after(ticks, id)', 1,
    'Start a one-shot timer: a Timer event with this id is raised in `ticks` ticks (at most 8 timers pending). Returns 1 if set.',
    (c, a) => {
      const f = c.sim.flows[c.e];
      return f && addTimer(f, c.sim.tick + Math.max(1, a[0]), a[1]) ? 1 : 0;
    }),

  // --- Orders -----------------------------------------------------------------
  api('Orders', 'orderCount()', 0, 'Orders waiting. The front one is the order being worked on.', (c) => c.sim.tasks[c.e]?.count ?? 0),
  api('Orders', 'orderType()', 0, 'Type of the order being worked on, as a task constant such as ATTACK or MOVE, or -1 when there is none.',
    (c) => { const t = c.sim.tasks[c.e]; return t && t.count > 0 ? t.type(0) : -1; }),
  api('Orders', 'nextOrder()', 2,
    'Finish the current order: cancels the activity working on it, drops the order and raises Order for the next one (or marks the unit Free when there is none).',
    (c) => (c.sim.nextOrder(c.e), 1)),
  api('Orders', 'swapOrder(type, x, y, target)', 2,
    'Replace the order being worked on by another one (or add it if there is none) and raise Order for it. The way a job hands itself on: a harvester whose field is spent swaps in a harvest order for another field.',
    (c, a) => (c.sim.swapOrder(c.e, a[0], a[1], a[2], a[3]) ? 1 : 0)),
  api('Orders', 'clearOrders()', 1, 'Drop every order and cancel the current activity.', (c) => (c.sim.clearOrders(c.e), 1)),

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
  api('Communication', 'radioSend(channel, value)', 6,
    'Sends a radio message to every allied unit and building within radio range that has a radio: their Message event fires with this channel and value. Costs a little energy. Returns how many received it, or -1 with no working radio or no energy.',
    (c, a) => c.sim.transmit(c.e, CommsLink.Radio, a[0], a[1])),
  api('Communication', 'laserSend(channel, value)', 6,
    'Like radioSend, but over a laser link: much longer range, but only to receivers with a laser link and a clear line of sight (rock blocks it). Returns how many received it, or -1 with no working laser link or no energy.',
    (c, a) => c.sim.transmit(c.e, CommsLink.Laser, a[0], a[1])),
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
  // Lists: each find call returns up to LIST_MAX things, nearest first, and starts a chain (flow/lists.ts).
  api('Lists', 'findResources(min)', 12,
    'List of the resources that hold at least min matter, nearest to you first (at most 32). Resources are known everywhere; no sensor needed. Start of a chain: findResources(10).first().',
    () => -1, { fill: (c, a, out) => fillResources(c, out, c.sim.pos.f.x[c.e], c.sim.pos.f.y[c.e], a[0]) }),
  api('Lists', 'findResourcesNear(h, min)', 12,
    'Like findResources, but nearest to the known thing h first (a depot, say): findResourcesNear(depot, 10).first() is the field closest to the depot. An unknown h gives an empty list.',
    () => -1, {
      fill: (c, a, out) => {
        const t = locate(c, a[0]);
        return t < 0 ? 0 : fillResources(c, out, c.sim.pos.f.x[t], c.sim.pos.f.y[t], a[1]);
      },
    }),
  api('Lists', 'findDepots()', 8,
    'List of your finished buildings with silos, nearest first (at most 32). A depot running this sees itself first. Full silos are included: filter with stock(d) < stockMax(d) for ones with room.',
    () => -1, { fill: (c, _a, out) => fillOwn(c, out, Caps.Depot, true) }),
  api('Lists', 'findChargers()', 8, 'List of your buildings with a working charging pad, nearest first.',
    () => -1, { fill: (c, _a, out) => fillOwn(c, out, Caps.Charger, false) }),
  api('Lists', 'findSites()', 8, 'List of your unfinished construction sites, nearest first.',
    () => -1, {
      fill: (c, _a, out) => {
        const { sim, e } = c;
        const owner = sim.unit.f.owner[e];
        let n = 0;
        for (const s of sim.construction.dense) if (sim.unit.f.owner[s] === owner) n = offer(out, n, s, sim.distSq(e, s));
        return toHandles(c, out, n);
      },
    }),
  api('Lists', 'findDamaged()', 8, 'List of your other finished units and buildings that are missing hit points, nearest first.',
    () => -1, { fill: (c, _a, out) => fillOwn(c, out, 0, false, (b) => c.sim.health.has(b) && c.sim.health.f.hp[b] < c.sim.stats(b).hp) }),
  api('Lists', 'findEnemies()', 16, 'List of the enemies in sensor range, nearest first. Energy: sensor use.',
    () => -1, { fill: (c, _a, out) => fillScan(c, out, true) }),
  api('Lists', 'findAllies()', 16, 'List of your other units in sensor range, nearest first. Energy: sensor use.',
    () => -1, { fill: (c, _a, out) => fillScan(c, out, false) }),
  api('Sensing', 'distBetween(a, b)', 3, 'Tiles between two known things (from edge to edge for buildings), or -1 if either is not known. Handy inside a list function: distBetween(depot, r).',
    (c, a) => {
      const t = locate(c, a[0]);
      const u = locate(c, a[1]);
      return t < 0 || u < 0 ? -1 : Math.floor(c.sim.edgeDistance(t, u) / TILE);
    }),
  api('Sensing', 'crowd(h, r)', 6,
    'How many of your other harvesters (units that can gather) are within r tiles (at most 20) of the known thing h: a measure of how busy a depot or field is. 0 if h is not known.',
    (c, a) => {
      return crowdAround(c, a[0], a[1]);
    }),
  api('Sensing', 'crowdOver(h, r, limit)', 6,
    'How many of your other harvesters within r tiles (at most 20) of the known thing h are beyond the first `limit`: 0 while it is not overcrowded. crowdOver(depot, 6, 4) is 3 when 7 harvesters are round the depot.',
    (c, a) => {
      return Math.max(0, crowdAround(c, a[0], a[1]) - Math.max(0, a[2]));
    }),
  api('Sensing', 'resource(h)', 1, 'Amount left in a resource; 0 if gone.', (c, a) => {
    const t = c.sim.world.resolve(a[0]);
    return t >= 0 && c.sim.resource.has(t) ? c.sim.resource.f.amount[t] : 0;
  }),
  api('Sensing', 'passable(x, y)', 1, '1 if tile (x, y) is dry, open ground with no building (rock, water, lava and voids are all 0: see depthAt, and wade for what this unit itself can enter).',
    (c, a) => (c.sim.terrain.walkable(a[0], a[1]) ? 1 : 0)),

  // --- Movement ---------------------------------------------------------------
  api('Movement', 'moving()', 0, '1 while travelling.', (c) => (c.sim.motion.has(c.e) ? c.sim.motion.f.moving[c.e] : 0)),
  api('Movement', 'flying()', 0, '1 if this unit flies (has a working rotor).', (c) => (c.stats.flying ? 1 : 0)),
  api('Movement', 'moveTo(x, y)', 1, 'Travel to tile (x, y), pathing around obstacles. Energy: motor use per tick moving.',
    (c, a) => c.sim.setDestination(c.e, tileCentre(a[0]), tileCentre(a[1]))),
  api('Movement', 'move(dx, dy)', 1, 'Travel by (dx, dy) tiles.',
    (c, a) => c.sim.setDestination(c.e, c.sim.pos.f.x[c.e] + a[0] * TILE, c.sim.pos.f.y[c.e] + a[1] * TILE)),
  api('Movement', 'stop()', 0, 'Cancel the current activity and stop travelling (flying units still drift to a cell they can land on).',
    (c) => (cancelActivity(c.sim, c.e, true), 0)),

  // --- Activities ---------------------------------------------------------------
  // Long jobs: the engine carries them out every tick and the program only runs again when one ends.
  // Starting a job cancels the current one. Attach chains to the outcomes: harvest(f, { full: () => { ... } }).
  api('Activities', 'goTo(x, y)', 1, 'Walk to tile (x, y), pathing around obstacles, until there (or as close as it can get). Energy: motor use per tick moving.',
    (c, a) => startActivity(c.sim, c.e, ActivityKind.GoTo, -1, a[0], a[1], 0), { outcomes: ACTIVITY_OUTCOMES.goTo }),
  api('Activities', 'approach(h, r)', 2, "Walk until within r tiles of a known unit (a building's edge). Ends `lost` if the target is gone or not known, `blocked` if it cannot be reached.",
    (c, a) => startActivity(c.sim, c.e, ActivityKind.Approach, a[0], 0, 0, a[1]), { outcomes: ACTIVITY_OUTCOMES.approach }),
  api('Activities', 'harvest(h)', 2, 'Walk to a resource field and gather from it until the cargo bay is full (`full`), the field is nearly spent (`empty`) or gone (`lost`). Energy: cargo bay use per tick gathering.',
    (c, a) => startActivity(c.sim, c.e, ActivityKind.Harvest, a[0], 0, 0, 0), { outcomes: ACTIVITY_OUTCOMES.harvest }),
  api('Activities', 'dock(h)', 2, "Walk to an own depot and unload as much cargo as its silos have room for, becoming its visitor. Ends `docked` (all unloaded) or `noRoom` (some cargo left).",
    (c, a) => startActivity(c.sim, c.e, ActivityKind.Dock, a[0], 0, 0, 0), { outcomes: ACTIVITY_OUTCOMES.dock }),
  api('Activities', 'take(h, n)', 2, 'Walk to an own depot and load up to n resources from its silos into the cargo bay.',
    (c, a) => startActivity(c.sim, c.e, ActivityKind.Take, a[0], 0, 0, a[1]), { outcomes: ACTIVITY_OUTCOMES.take }),
  api('Activities', 'build(h)', 2,
    "Walk to an own construction site (1 tile; a building's crane reaches 4) and work on it until it is finished (`built`). Pays from cargo first, then the common pool if the site is supplied; ends `starved` when it is neither. Energy: build-arm use per tick.",
    (c, a) => startActivity(c.sim, c.e, ActivityKind.Build, a[0], 0, 0, 0), { outcomes: ACTIVITY_OUTCOMES.build }),
  api('Activities', 'repair(h)', 2,
    "Walk to a damaged own unit or building and mend it until it is whole (`repaired`). Costs energy plus matter per hit point mended (more for armour): from the cargo bay on a unit (`starved` when it runs out), from the silos on a building.",
    (c, a) => startActivity(c.sim, c.e, ActivityKind.Repair, a[0], 0, 0, 0), { outcomes: ACTIVITY_OUTCOMES.repair }),
  api('Activities', 'charge(h)', 2, 'Walk to an own charging pad and wait beside it until the energy store is at least 95% (`charged`).',
    (c, a) => startActivity(c.sim, c.e, ActivityKind.Charge, a[0], 0, 0, 0), { outcomes: ACTIVITY_OUTCOMES.charge }),
  api('Activities', 'supply(h)', 2, 'Walk to a flat or low own unit and hand it energy (10% of your capacity every other tick) until it is at 50% (`revived`); ends `refused` if that would leave you under half.',
    (c, a) => startActivity(c.sim, c.e, ActivityKind.Supply, a[0], 0, 0, 0), { outcomes: ACTIVITY_OUTCOMES.supply }),
  api('Activities', 'engage(h)', 2, 'Lock the weapon on a unit and close in until it is in range (within 3 tiles if it is not), until it is `destroyed` or out of sensor range (`lost`). Energy: weapon use per shot.',
    (c, a) => startActivity(c.sim, c.e, ActivityKind.Engage, a[0], 0, 0, 0), { outcomes: ACTIVITY_OUTCOMES.engage }),
  api('Activities', 'activity()', 0, 'The kind of activity under way, as an A_* constant (A_NONE when there is none).', (c) => c.sim.activities[c.e]?.kind ?? 0),
  api('Activities', 'suspendActivity()', 1, 'Put the current activity aside and stop moving, to be brought back by resumeActivity(). Returns 1 if there was one.',
    (c) => (suspendActivity(c.sim, c.e) ? 1 : 0)),
  api('Activities', 'resumeActivity()', 1, 'Bring back the activity put aside by suspendActivity(). Returns 1 if there was one.',
    (c) => (resumeActivity(c.sim, c.e) ? 1 : 0)),

  // --- Actions ----------------------------------------------------------------
  api('Actions', 'alert(text, duration_ms)', 2,
    `Show a speech bubble with text (in quotes, up to ${MAX_TEXT} characters) over the unit for duration_ms milliseconds (100 to ${MAX_ALERT_MS}). A newer alert replaces the unit's current one. Everyone who can see the unit sees it.`,
    (c, a) => {
      const text = textAt(a[0]);
      const ticks = Math.min(MAX_ALERT_MS, Math.max(MIN_ALERT_MS, a[1])) / MS_PER_TICK;
      const { alerts } = c.sim;
      const at = alerts.findIndex((x) => x.e === c.e);
      const alert = { e: c.e, ticks: Math.ceil(ticks), text };
      if (at >= 0) alerts[at] = alert;
      else alerts.push(alert);
      return 1;
    },
    { text: [0] }),
  api('Actions', 'notify(text, kind)', 2,
    `Show your player a pop-up alert with text (in quotes, up to ${MAX_TEXT} characters); kind is NOTE_OK, NOTE_INFO, NOTE_WARN or NOTE_ERROR and sets its colour. Only the unit's owner sees it. A unit can raise one every ${NOTICE_COOLDOWN_TICKS / 10} seconds and a player at most ${MAX_NOTICES_PER_OWNER_TICK} a tick; extra ones are dropped. Returns 1 if shown, 0 if dropped.`,
    (c, a) => {
      const { sim, e } = c;
      if (sim.tick < (sim.noticeReady[e] ?? 0)) return 0;
      const owner = sim.unit.f.owner[e];
      let n = 0;
      for (const x of sim.notices) if (x.owner === owner) n++;
      if (n >= MAX_NOTICES_PER_OWNER_TICK) return 0;
      sim.noticeReady[e] = sim.tick + NOTICE_COOLDOWN_TICKS;
      sim.notices.push({ owner, kind: Math.min(NOTICE_KINDS.length - 1, Math.max(0, a[1])), text: textAt(a[0]) });
      return 1;
    },
    { text: [0] }),
  api('Actions', 'fire(h)', 2, 'Lock every weapon on a unit; returns 1 if one is in range. A locked weapon fires automatically and holds fire while it has no lock. Energy: weapon use per shot, from each weapon.',
    (c, a) => fireAt(c, a[0], -1)),
  api('Actions', 'laserPower(energy)', 1,
    "Set the energy a laser spends per shot (1 to the laser's maximum); damage scales in proportion, so half the energy is half the damage. 0 restores the maximum. Returns the energy now in use, or 0 without a laser.",
    (c, a) => setLaserPower(c, a[0], -1)),
  api('Actions', 'aim(kind)', 1,
    "Aim shots at one kind of module of the target (M_MOTOR, M_WEAPON, M_CPU, ...), or at M_ANY (the default) for a random module each hit. A module that takes enough damage breaks and does nothing until it is repaired; legs break easily. If the target has no working module of that kind, the hit lands on a random one. Returns the kind now aimed at, or -1 without a weapon.",
    (c, a) => setAim(c, a[0], -1)),
  // Indexed weapon calls: self.modules.weapon[i].fire(h) acts on weapon i; the plain fire(h), laserPower(n) and aim(k)
  // (self.modules.weapon.fire(h)) act on every weapon. A weapon that is off or broken is skipped; its index stays.
  api('Actions', 'weaponCount()', 0, 'How many weapon modules this unit has, working or not (self.modules.weapon.length).', (c) => weaponCount(c)),
  api('Lists', 'weapons()', 1, 'List of the weapons of this unit, as indices 0 up (self.modules.weapon): self.modules.weapon.filter(w => self.modules.weapon[w].kind === W_LASER).first().',
    () => -1, { fill: (c, _a, out) => { const n = weaponCount(c); for (let i = 0; i < n; i++) out[i] = i; return n; } }),
  api('Actions', 'weaponKind(i)', 0, 'Kind of weapon i as a W_* constant (W_GUN, W_LASER, ...), or -1 if there is no such weapon or it is off or broken.',
    (c, a) => { const w = weaponAt(c, a[0]); return w ? WEAPON_KIND_CODES[w.kind] : -1; }),
  api('Actions', 'weaponRange(i)', 0, 'Reach of weapon i in tiles, or -1 if there is no such weapon or it is off or broken.',
    (c, a) => { const w = weaponAt(c, a[0]); return w ? Math.floor(w.range / TILE) : -1; }),
  api('Actions', 'weaponFire(i, h)', 2, 'Like fire(h), for weapon i only. Returns 0 if there is no such weapon or it is off or broken.',
    (c, a) => (a[0] >= 0 && a[0] < weaponCount(c) ? fireAt(c, a[1], a[0]) : 0)),
  api('Actions', 'weaponLaserPower(i, energy)', 1, 'Like laserPower(energy), for weapon i. Returns 0 if there is no such laser.',
    (c, a) => (a[0] >= 0 && a[0] < weaponCount(c) ? setLaserPower(c, a[1], a[0]) : 0)),
  api('Actions', 'weaponAim(i, kind)', 1, 'Like aim(kind), for weapon i. Returns -1 if there is no such weapon.',
    (c, a) => (a[0] >= 0 && a[0] < weaponCount(c) ? setAim(c, a[1], a[0]) : -1)),
  api('Actions', 'shieldAngle(degrees)', 1,
    'Point the energy shield along an angle in degrees (0 = east, 90 = south, 180 = west, 270 = north). The shield never aims itself: a program (the ShieldGuard block, say) must point it. It turns at a limited speed. Returns the angle, or -1 without a working shield emitter.',
    (c, a) => setShieldAngle(c.sim, c.e, a[0])),
  api('Actions', 'shieldArc(degrees)', 1,
    'Set how wide the energy shield is, in degrees (10 up to what the emitter allows). A wider arc costs more energy every tick. Returns the arc now, or -1 without a working shield emitter.',
    (c, a) => setShieldArc(c.sim, c.e, a[0])),
  api('Actions', 'shieldRange(tiles)', 1,
    'Set how far from the unit or building the energy shield is cast, in tiles (from just outside the hull up to what the emitter allows). A longer reach costs more energy every tick. Returns the tiles now, or -1 without a working shield emitter.',
    (c, a) => setShieldRange(c.sim, c.e, a[0])),
  api('Actions', 'smoke(degrees)', 2,
    'Throw a volley of 3 smoke canisters along an angle in degrees (0 = east, 90 = south): clouds that block sight for a while. Needs a smoke launcher that is rested and has the energy. Returns 1 if thrown, else 0.',
    (c, a) => (throwSmoke(c.sim, c.e, a[0]) ? 1 : 0)),
  api('Sensing', 'smokeReady()', 0, '1 if the smoke launcher is working and rested, else 0.',
    (c) => (c.stats.smoke && (c.sim.smokeReady[c.e] ?? 0) <= c.sim.tick ? 1 : 0)),
  api('Sensing', 'charging(h)', 2, '1 if a unit you know about is charging a railgun right now, else 0. A charge takes 5 seconds and shows to everyone.',
    (c, a) => { const t = locate(c, a[0]); return t >= 0 && c.sim.rails.has(t) ? 1 : 0; }),
  api('Actions', 'droneClass(name)', 2,
    'Choose which of your small (micro or light) unit classes the drone bay builds, by name. Returns 1 if it is such a class of yours and this unit has a drone bay, else 0.',
    (c, a) => (setDroneClass(c.sim, c.e, textAt(a[0])) ? 1 : 0), { text: [0] }),
  api('Actions', 'launchDrones()', 2, 'Launch every docked drone, one at a time. Returns how many are docked, or 0 without a working drone bay.',
    (c) => launchDrones(c.sim, c.e)),
  api('Actions', 'recallDrones()', 2, 'Call every launched drone back: each docks when it reaches this unit. Returns how many are out, or 0 without a working drone bay.',
    (c) => recallDrones(c.sim, c.e)),
  api('Sensing', 'dronesDocked()', 0, 'Drones docked in the bay now.', (c) => c.sim.bays.get(c.e)?.docked.length ?? 0),
  api('Sensing', 'dronesOut()', 0, 'Drones launched from the bay and still alive.', (c) => c.sim.bays.get(c.e)?.out.length ?? 0),
  api('Actions', 'lightAngle(degrees)', 1,
    'Point the spotlight along an angle in degrees (0 = east, 90 = south, 180 = west, 270 = north). The light never aims itself: a program (the Spotlight block, say) must point it. It turns slowly. Returns the angle, or -1 without a working spotlight.',
    (c, a) => setLightAngle(c.sim, c.e, a[0])),
  api('Actions', 'lightPower(energy)', 1,
    'Set the energy per tick the spotlight is given, from 0 (off) up to what the module allows. The beam is 4 tiles long for every point, so more power sees further, and it is paid every tick. Returns the power now, or -1 without a working spotlight.',
    (c, a) => setLightPower(c.sim, c.e, a[0])),
  api('Sensing', 'lightHeading()', 0, 'The angle in degrees (0 = east, 90 = south) the spotlight is turning to, or -1 without a working spotlight.',
    (c) => lightAngleOf(c.sim, c.e)),
  api('Sensing', 'outwardBearing()', 6, 'Angle in degrees (0 = east, 90 = south) that points away from home: opposite the middle of the allied units and buildings within 15 tiles, or away from the middle of the map if there are none. It is where a light should look to see the edge of the fog.',
    (c) => outwardBearing(c.sim, c.e)),
  api('Sensing', 'lightBlocked(degrees)', 6, '1 if a beam pointed along that angle would fall on an allied unit (not a building) within 10 tiles, else 0.',
    (c, a) => (lightBlocked(c.sim, c.e, a[0]) ? 1 : 0)),
  api('Sensing', 'lightOn()', 0, '1 while the spotlight is lit (module on, finished and paid for this tick), else 0.',
    (c) => (c.sim.light.has(c.e) && c.sim.light.f.power[c.e] > 0 ? 1 : 0)),
  api('Sensing', 'shieldUp()', 0, '1 while the energy shield is up (emitter on, unbroken and paid for this tick), else 0.',
    (c) => (c.sim.shields[c.e]?.live ? 1 : 0)),
  api('Sensing', 'incomingBearing()', 6, 'Angle in degrees (0 = east, 90 = south) to the nearest enemy shell or missile in flight within 10 tiles, or -1 if none. No sensor needed: it is what a shield turns to face.',
    (c) => incomingBearing(c.sim, c.e)),
  api('Sensing', 'bearing(h)', 2, 'Angle in degrees (0 = east, 90 = south) from you to a known unit, or -1 if it is not known: pass it to config.shieldAngle to face it.',
    (c, a) => { const t = locate(c, a[0]); return t < 0 ? -1 : bearingTo(c.sim, c.e, t); }),
  api('Actions', 'cargo()', 0, 'Resources carried.', (c) => (c.sim.cargo.has(c.e) ? c.sim.cargo.f.amount[c.e] : 0)),
  api('Actions', 'cargoMax()', 0, 'Cargo capacity (0 if the cargo bay is off).', (c) => c.stats.cargo),
  // --- Construction & resources ---------------------------------------------------
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
  api('Energy & modules', 'moduleOn(i)', 0, '1 if part i is switched on, not broken and not held down by an ion bolt (passive parts are always on).',
    (c, a) => (a[0] >= 0 && a[0] < c.bp.parts.length && !(((c.sim.modules.f.off[c.e] | c.sim.modules.f.broken[c.e] | c.sim.modules.f.ion[c.e]) >>> a[0]) & 1) ? 1 : 0)),
  api('Energy & modules', 'moduleBroken(i)', 0, '1 if part i has been broken by damage: it does nothing until a repair module mends it.',
    (c, a) => (a[0] >= 0 && a[0] < c.bp.parts.length && (c.sim.modules.f.broken[c.e] >>> a[0]) & 1 ? 1 : 0)),
  api('Energy & modules', 'ionLeft()', 0, 'Ticks left before the module an ion bolt is holding down on this unit or building works again (0 if none is held down).',
    (c) => (c.sim.ionActive.has(c.e) ? Math.max(0, (c.sim.ionUntil[c.e] ?? 0) - c.sim.tick) : 0)),
  api('Energy & modules', 'brokenOf(h)', 0, 'Number of broken modules of an own unit or building (0 if none, -1 if it is not yours): worth a visit from a repair module.',
    (c, a) => {
      const t = c.sim.world.resolve(a[0]);
      if (t < 0 || !c.sim.modules.has(t) || c.sim.unit.f.owner[t] !== c.sim.unit.f.owner[c.e]) return -1;
      let n = 0;
      for (let m = c.sim.modules.f.broken[t]; m !== 0; m &= m - 1) n++;
      return n;
    }),
  api('Energy & modules', 'setModule(i, on)', 2,
    'Switch part i on (1) or off (0). Only energy-using modules switch; a script cannot switch off its last CPU. Returns 1 on success.',
    (c, a) => (c.sim.setModule(c.e, a[0], a[1] !== 0, true) ? 1 : 0)),

  api('Sensing', 'lightLevel()', 1,
    'Light 0..100 where this unit stands: bright by day, dim at night (never fully dark), following the time of day. Unlike daylight(), which is the sun for solar power, this is what the unit can see by.',
    (c) => c.sim.lightAt(c.sim.pos.f.x[c.e], c.sim.pos.f.y[c.e])),

  // --- Power network ------------------------------------------------------------
  api('Power network', 'daylight()', 0, 'Sunlight 0..100 (solar output follows it, but weather such as rain, storms and dust cuts what panels get, and a heatwave adds to it).', (c) => c.sim.sunNow()),
  api('Power network', 'wind()', 0, 'Wind 0..100 (turbine output follows it; rain, storms and dust keep it up, a heatwave holds it down).', (c) => c.sim.windNow()),
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
      if (v < 0 || a[0] <= TaskType.None || a[0] > TaskType.Repair) return 0;
      return c.sim.pushOrder(v, a[0], a[1], a[2], a[3], TaskFlag.Building) ? 1 : 0;
    }),
  api('Buildings', 'unitClassCount()', 0, 'Number of your own unit classes (not retired, not buildings) a factory can produce, in the order they were defined.',
    (c) => unitClasses(c).length),
  api('Buildings', 'queueUnit(i)', 4, 'Factory only: queue one unit of your i-th unit class (0 to unitClassCount() - 1), paid from the common pool. Returns 1 if queued.',
    (c, a) => {
      const bp = unitClasses(c)[a[0]];
      return bp && c.sim.tryEnqueueProduction(c.e, bp.id) ? 1 : 0;
    }),
  api('Buildings', 'queueLength()', 0, "Units waiting in this factory's production queue.", (c) => c.sim.productionQueue[c.e]?.length ?? 0),

  api('Sensing', 'nearestDamaged()', 6, 'Nearest other own unit or building that is missing hit points (finished buildings only), or -1.',
    (c) => handleOf(c, c.sim.nearestOwn(c.e, 0, (b) => c.sim.health.has(b) && c.sim.health.f.hp[b] < c.sim.stats(b).hp))),
  api('Sensing', 'hpOf(h)', 0, 'Health percentage of an own unit or building, or -1.', (c, a) => {
    const t = c.sim.world.resolve(a[0]);
    if (t < 0 || !c.sim.health.has(t) || c.sim.unit.f.owner[t] !== c.sim.unit.f.owner[c.e]) return -1;
    return Math.floor((100 * c.sim.health.f.hp[t]) / Math.max(1, c.sim.stats(t).hp));
  }),

  // --- Size tiers and terrain height ----------------------------------------------
  api('Movement', 'size()', 0, 'Chassis size tier of this unit: SIZE_MICRO (0) up to SIZE_COLOSSUS (5); 0 for a building.', (c) => c.stats.size),
  api('Sensing', 'unitSize(h)', 0, 'Chassis size tier of a unit this unit knows about (0 micro to 5 colossus), or -1 (unknown, or a building).', (c, a) => {
    const t = locate(c, a[0]);
    if (t < 0 || !c.sim.unit.has(t)) return -1;
    const s = c.sim.stats(t);
    return s.structure ? -1 : s.size;
  }),
  api('Movement', 'climb()', 0, 'Highest rock this unit can walk onto: 0 on wheels or tracks, 1 light legs, 2 heavy legs, 9 colossus legs (flying units: 0).', (c) => (c.stats.flying ? 0 : c.stats.climb)),
  api('Sensing', 'heightAt(x, y)', 0, 'Terrain height of tile (x, y): 0 open ground (and under any liquid: see depthAt), 1-9 rock (higher deeper inside an outcrop; cliffs are 3 or more from their edge), 10 off the map.',
    (c, a) => c.sim.terrain.heightAt(a[0], a[1])),
  api('Sensing', 'depthAt(x, y)', 0, 'Liquid depth of tile (x, y): 0 on dry ground, rock and off the map; 1-2 shallow water, 3-5 deep water, 6-8 lava, 9 a void (a drop with no floor). heightAt reads 0 over liquid, so check depthAt before assuming open ground can be stood on.',
    (c, a) => c.sim.terrain.depthAt(a[0], a[1])),
  api('Movement', 'escapeX()', 6, 'Tile x of the nearest tile within 8 of this unit that it can stand on and that is not lava or a void (so a hover unit that stopped on lava can step off it), or -1 if there is none. Pair with escapeY().',
    (c) => escapeCell(c)?.[0] ?? -1),
  api('Movement', 'escapeY()', 6, 'Tile y of the tile escapeX() finds, or -1.', (c) => escapeCell(c)?.[1] ?? -1),
  api('Movement', 'wade()', 0, 'Deepest liquid (see depthAt) this unit can enter: 2 (shallow water, slowly) on wheels, tracks and legs, 5 on an amphibious drive, 8 on a hover skirt (which skims at full speed, and is scorched by lava). Flying units: 0.', (c) => (c.stats.flying ? 0 : c.stats.wade)),
];

/** Weapons on this unit (modules, working or not): a script indexes them 0 up. */
const weaponCount = (c: UnitContext): number => c.stats.weapons.length;

/** Weapon i if it exists and works, else null. */
const weaponAt = (c: UnitContext, i: number) => (i >= 0 && i < c.stats.weapons.length ? c.stats.weapons[i] : null);

/** Runs `each` for weapon i that works (every working weapon when i is -1); the sum of what it returns. */
function eachWeapon(c: UnitContext, i: number, each: (slot: number, w: NonNullable<ReturnType<typeof weaponAt>>) => number): number {
  let sum = 0;
  const { weapons } = c.stats;
  for (let k = i < 0 ? 0 : i; k < (i < 0 ? weapons.length : Math.min(i + 1, weapons.length)); k++) {
    const w = weapons[k];
    if (w && c.sim.weaponStores[k].has(c.e)) sum += each(k, w);
  }
  return sum;
}

/** Locks weapon i (every weapon when -1) on a known unit; 1 if one of them has it in range. */
function fireAt(c: UnitContext, h: number, i: number): number {
  const { sim, e } = c;
  const t = locate(c, h);
  const ok = t >= 0 && t !== e && sim.health.has(t);
  return eachWeapon(c, i, (slot, w) => {
    const f = sim.weaponStores[slot].f;
    if (!ok) {
      f.target[e] = -1;
      return 0;
    }
    f.target[e] = sim.world.handle(t);
    return reachDistance(sim, e, t) <= w.range + rangeBonus(sim, e, t, w.kind) ? 1 : 0;
  }) > 0 ? 1 : 0;
}

/** Sets the energy per shot of weapon i (every laser when -1); the power now in use, or 0 without a laser. */
function setLaserPower(c: UnitContext, energy: number, i: number): number {
  let now = 0;
  eachWeapon(c, i, (slot, w) => {
    if (w.kind !== 'laser') return 0;
    const p = energy <= 0 ? 0 : Math.min(Math.max(1, Math.floor(energy)), w.use);
    c.sim.weaponStores[slot].f.power[c.e] = p;
    now = p > 0 ? p : w.use;
    return 1;
  });
  return now;
}

/** Aims weapon i (every weapon when -1) at one kind of module; the kind now aimed at, or -1 without a weapon. */
function setAim(c: UnitContext, module: number, i: number): number {
  const kind = module > 0 && module <= 255 ? Math.floor(module) : 0;
  return eachWeapon(c, i, (slot) => ((c.sim.weaponStores[slot].f.aim[c.e] = kind), 1)) > 0 ? kind : -1;
}

/** The nearest cell round the unit that it fits in and that is neither lava nor a void: ground it can leave lava for. */
function escapeCell(c: UnitContext): [number, number] | null {
  const s = c.stats;
  const tx = Math.floor(c.sim.pos.f.x[c.e] / TILE);
  const ty = Math.floor(c.sim.pos.f.y[c.e] / TILE);
  return c.sim.terrain.nearestFit(tx, ty, { climb: s.climb, clearance: s.clearance, wade: Math.min(s.wade, DEEP_MAX), hover: s.hover }, 8);
}

/** The owner's producible classes, in definition order. */
function unitClasses(c: UnitContext) {
  return c.sim.blueprints.ownedBy(c.sim.unit.f.owner[c.e]).filter((b) => !b.stats.structure && !b.retired);
}
