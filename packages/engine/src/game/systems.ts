import { handles } from '../flow/compile';
import { EventId } from '../flow/events';
import { enqueue, hasWork, raise, reboot, runFlow, tickTimers, type RunHooks } from '../flow/run';
import { UNIT_API, VisitReason } from './api';
import { activitySystem } from './activity';
import { sensorSweep, sweepFor } from './sensor';
import { CpuState } from './components';
import { launchMissile, shotHitsMissile } from './missile';
import { SimEvent } from './events';
import { PART_LIST, TILE } from './parts';
import { daylight, routeEnergy, share, StorageMode, wind } from './power';
import { GENERATION_SCALE } from './parts';
import { BUILDER_ENERGY_RESERVE, CLIMB_SPEED_PERMILLE, SEPARATION_GAP, DECAY_TICKS, MAX_TRANSMISSION_LOSS, RESOURCE_REGEN_INTERVAL_TICKS, SOLAR_GENERATION_MULTIPLIER, STORAGE_DISCHARGE_FRACTION, STORAGE_RESERVE_FRACTION, TESLA_SELF_STUN_FACTOR, TESLA_STUN_TICKS, TRANSMISSION_LOSS_PER_TILE, WIND_GENERATION_MULTIPLIER, buildEnergyCost } from './rules';
import { CHARGE_PAD_RATE_MULTIPLIER, CHARGE_RANGE, FLAK_BURST_RADIUS, factoryCanBuild } from './rules';
import type { Simulation } from './simulation';

/** Energy a storage building keeps back from discharging (and refills first), so its script can always run. */
const reserveOf = (capacity: number): number => Math.max(1, Math.ceil(capacity * STORAGE_RESERVE_FRACTION));

/** Generation, then distribution inside each power network (consumers first, then storage). */
export function powerSystem(sim: Simulation): void {
  if (sim.powerDirty) sim.rebuildNetworks();
  const sun = daylight(sim.tick);
  const air = wind(sim.config.seed, sim.tick);
  const store = sim.energy.f.amount;
  for (const net of sim.networks) {
    let generated = 0;
    const efficiency = 1 - Math.min(MAX_TRANSMISSION_LOSS, net.linkTiles * TRANSMISSION_LOSS_PER_TILE);
    // Indices into net.members.
    const normal: number[] = [];
    const normalRoom: number[] = [];
    const charging: number[] = [];
    const chargingRoom: number[] = [];
    const discharging: number[] = [];
    const gen = net.members.map(() => 0);
    const flow = (net.flow = net.members.map(() => 0));
    for (let i = 0; i < net.members.length; i++) {
      const b = net.members[i];
      if (!sim.world.isAlive(b) || sim.isSite(b)) continue; // sites only carry links
      const s = sim.stats(b);
      // Output is in 1/GENERATION_SCALE energy; the fraction left over carries to the next tick.
      const unit = 100 * GENERATION_SCALE;
      const total =
        s.solar * sun * SOLAR_GENERATION_MULTIPLIER +
        s.wind * air * WIND_GENERATION_MULTIPLIER +
        (sim.genCarry[b] ?? 0);
      gen[i] = Math.floor(total / unit);
      sim.genCarry[b] = total - gen[i] * unit;
      gen[i] = Math.floor(gen[i] * efficiency);
      generated += gen[i];
      const room = s.energyCapacity - store[b];
      // Below a small floor a store takes part as a normal consumer whatever its mode: a store
      // left in DISCHARGE or HOLD that ran dry could never power its CPU to switch back.
      const mode = store[b] < reserveOf(s.energyCapacity) ? StorageMode.Normal : sim.storage.f.mode[b];
      switch (mode) {
        case StorageMode.Charge:
          charging.push(i);
          chargingRoom.push(room);
          break;
        case StorageMode.Discharge:
          discharging.push(i);
          break;
        case StorageMode.Hold:
          break;
        default:
          normal.push(i);
          normalRoom.push(room);
      }
    }
    const demand = normalRoom.reduce((a, b) => a + b, 0);
    const m = net.members;
    // Energy moves freely inside a cluster (short links); long antenna links between clusters are capped.
    const K = net.clusters;
    const cl = net.clusterOf;
    const perCluster = (): number[] => new Array(K).fill(0);
    /** Positions in `list` grouped by cluster of the member each refers to. */
    const bucket = (list: readonly number[]): number[][] => {
      const out: number[][] = Array.from({ length: K }, () => []);
      list.forEach((i, k) => out[cl[i]].push(k));
      return out;
    };
    const normalK = bucket(normal);
    const chargingK = bucket(charging);
    const bridgeFlow = net.bridges.map(() => 0);
    const genK = perCluster();
    gen.forEach((g, i) => (genK[cl[i]] += g));
    const demandK = normalK.map((ks) => ks.reduce((t, k) => t + normalRoom[k], 0));
    const first = routeEnergy(net, bridgeFlow, genK, demandK);
    // Storage in discharge mode covers what generation could not deliver.
    const shortK = demandK.map((d, c) => d - first.got[c]);
    const availK = perCluster();
    const avail = discharging.map((i) => {
      const cap = sim.stats(m[i]).energyCapacity;
      const give = Math.max(0, store[m[i]] - reserveOf(cap)); // keep enough to run the CPU
      const a = Math.min(give, Math.ceil(cap * STORAGE_DISCHARGE_FRACTION));
      availK[cl[i]] += a;
      return a;
    });
    const second = routeEnergy(net, bridgeFlow, availK, shortK);
    const takeK = [...second.gave];
    discharging.forEach((i, k) => {
      const take = Math.min(takeK[cl[i]], avail[k]);
      takeK[cl[i]] -= take;
      store[m[i]] -= take;
      flow[i] -= take;
    });
    let delivered = 0;
    for (let c = 0; c < K; c++) {
      const ks = normalK[c];
      share(first.got[c] + second.got[c], ks.map((k) => normalRoom[k])).forEach((g, j) => {
        const i = normal[ks[j]];
        store[m[i]] += g;
        flow[i] += g;
        delivered += g;
      });
    }
    // Whatever generation is left tops up storage in charge mode.
    const leftK = genK.map((g, c) => g - first.gave[c]);
    const chargeK = chargingK.map((ks) => ks.reduce((t, k) => t + chargingRoom[k], 0));
    const third = routeEnergy(net, bridgeFlow, leftK, chargeK);
    for (let c = 0; c < K; c++) {
      const ks = chargingK[c];
      share(third.got[c], ks.map((k) => chargingRoom[k])).forEach((g, j) => {
        const i = charging[ks[j]];
        store[m[i]] += g;
        flow[i] += g;
      });
      // Generators gave what was used beyond the discharged energy, in proportion to their output.
      const givers = net.byCluster[c];
      share(first.gave[c] + third.gave[c], givers.map((i) => gen[i])).forEach((g, k) => (flow[givers[k]] -= g));
    }

    net.supply = generated;
    net.delivered = delivered;
    net.demand = demand;
    net.stored = 0;
    net.capacity = 0;
    for (const b of net.members) {
      if (!sim.world.isAlive(b) || sim.isSite(b)) continue;
      net.stored += store[b];
      net.capacity += sim.stats(b).energyCapacity;
    }
  }
}

/** Cheating owners (bots) never run short: every energy store and silo is refilled each tick. */
export function cheatSystem(sim: Simulation): void {
  if (sim.cheaters.size === 0) return;
  for (const e of sim.unit.dense) {
    if (!sim.cheaters.has(sim.unit.f.owner[e]) || sim.isSite(e)) continue;
    const s = sim.stats(e);
    if (sim.energy.has(e)) sim.energy.f.amount[e] = s.energyCapacity;
    if (sim.stockpile.has(e) && sim.stockpile.f.amount[e] !== s.resourceCapacity) {
      sim.stockpile.f.amount[e] = s.resourceCapacity;
      sim.stockpile.markChanged(e);
    }
  }
}

/** How far an energy threshold must be crossed back before it can fire again (percent). */
const ENERGY_HYSTERESIS = 5;
/** While a unit stays below its EnergyLow level, the event repeats this often (ticks). */
const LOW_REPEAT_TICKS = 100;

/**
 * Runs every unit's class program with that unit's own CPU: raises the events that are due
 * (timers, sensor sweeps, energy thresholds), then lets the CPU work through its queue.
 * Units with nothing to do are skipped with a couple of checks, so a purely reactive
 * unit costs nothing between events.
 */
export function scriptSystem(sim: Simulation): void {
  const ctx = sim.scriptCtx;
  const cpu = sim.cpu;
  const hooks: RunHooks = {
    start(handler, args) {
      const f = sim.flows[ctx.e]!;
      // A visitor handler may order (and ask about) the visiting unit while it runs.
      sim.visiting[ctx.e] = f.program.handlers[handler].event.id === EventId.Visitor && sim.world.resolve(args[1]) >= 0 ? args[1] : -1;
    },
    end() {
      sim.endVisit(ctx.e);
    },
  };
  for (const e of sim.world.query(sim.unit.def)) {
    const bp = sim.blueprintOf(e);
    if (!bp) continue;
    const s = sim.stats(e);
    let state: number = CpuState.Running;
    let used = 0;
    let fs = sim.flows[e];

    if (!bp.program || s.cyclesPerTick === 0 || sim.isSite(e)) state = CpuState.Offline;
    else if (sim.tick < sim.stunUntil[e]) state = CpuState.Stunned;
    else if (sim.energy.f.amount[e] < 1) state = CpuState.NoPower;
    else {
      fs = sim.flowFor(e)!;
      if (fs.fault) {
        // A crashed unit spends one tick rebooting (and forgets any visitor).
        reboot(fs, sim.tick);
        sim.endVisit(e);
      } else {
        raiseDue(sim, e, fs, s);
        if (hasWork(fs, sim.tick)) {
          ctx.e = e;
          ctx.bp = bp;
          ctx.stats = s;
          used = runFlow(fs, UNIT_API, ctx, s.cyclesPerTick, sim.tick, hooks);
          // Processing costs energy in proportion to the work done.
          const owed = sim.cpuDebt[e] + used * s.cpuUse;
          const whole = Math.floor(owed / 100);
          sim.cpuDebt[e] = owed - whole * 100;
          sim.energy.f.amount[e] = Math.max(0, sim.energy.f.amount[e] - whole);
        }
        if (used === 0 && fs.running < 0) state = CpuState.Sleeping;
      }
    }

    const fault = fs?.fault ?? 0;
    if (cpu.f.used[e] !== used || cpu.f.fault[e] !== fault || cpu.f.state[e] !== state) {
      cpu.f.used[e] = used;
      cpu.f.fault[e] = fault;
      cpu.f.state[e] = state;
      cpu.markChanged(e);
    }
  }
}

/** Raises this tick's timer, sensor and energy events for one unit (only for the blocks it has). */
function raiseDue(sim: Simulation, e: number, fs: NonNullable<Simulation['flows'][number]>, s: ReturnType<Simulation['stats']>): void {
  const tick = sim.tick;
  tickTimers(fs, tick);
  const p = fs.program;

  // A unit with nothing to do is told so: when its work ends, and then every `repeat` ticks while it stays free.
  const freeBlocks = p.byEvent[EventId.Free];
  if (freeBlocks) {
    const busy = sim.activities[e] !== undefined || (sim.tasks[e]?.count ?? 0) > 0;
    if (busy) {
      fs.freePending = false;
      fs.freeAt = 0;
    } else if (fs.running < 0 && fs.length === 0) {
      const repeat = (p.handlers[freeBlocks[0]].config.repeat as number | undefined) ?? 0;
      if (fs.freePending || (fs.freeAt > 0 && tick >= fs.freeAt)) {
        fs.freePending = false;
        fs.freeAt = repeat > 0 ? tick + repeat : 0;
        raise(fs, EventId.Free);
      }
    }
  } else {
    fs.freePending = false;
  }

  const sensors = p.byEvent[EventId.Detected];
  if (sensors) {
    for (const h of sensors) {
      if (tick < fs.nextDue[h]) continue;
      const sweep = sweepFor(p.handlers[h], s);
      fs.nextDue[h] = tick + sweep.interval;
      if (s.sensorTier === 0 || sweep.watch.length === 0 || sweep.limit === 0) continue;
      // Each sweep costs the sensor's energy, found or not; a unit that cannot pay does not sweep.
      if (!sim.spend(e, s.sensorUse)) continue;
      const found = sensorSweep(sim, e, sweep);
      for (let i = 0; i < found.length; i += 2) enqueue(fs, h, found[i], found[i + 1], 0, 0);
    }
  }

  const low = p.byEvent[EventId.EnergyLow];
  const full = p.byEvent[EventId.EnergyFull];
  if (low || full) {
    const pct = sim.energyView.f.pct[e];
    if (low) {
      const below = (p.handlers[low[0]].config.below as number | undefined) ?? 25;
      // Fires on crossing and then again every LOW_REPEAT_TICKS while the unit is still low (a recharge that was
      // interrupted must be tried again), until the level recovers.
      if (pct < below && (!fs.lowFired || tick - fs.lowAt >= LOW_REPEAT_TICKS)) {
        fs.lowFired = true;
        fs.lowAt = tick;
        raise(fs, EventId.EnergyLow);
      } else if (pct >= below + ENERGY_HYSTERESIS) fs.lowFired = false;
    }
    if (full) {
      const above = (p.handlers[full[0]].config.above as number | undefined) ?? 95;
      if (pct >= above && !fs.fullFired) {
        fs.fullFired = true;
        raise(fs, EventId.EnergyFull);
      } else if (pct < above - ENERGY_HYSTERESIS) fs.fullFired = false;
    }
  }
}

/** `how`: 1 = reached the end of the path, 2 = stopped short by a crowd near the goal. */
function arrive(sim: Simulation, e: number, how: 1 | 2 = 1): void {
  sim.motion.f.moving[e] = 0;
  sim.motion.f.arrived[e] = how;
  sim.paths[e] = undefined;
  const f = sim.flows[e];
  if (f && handles(f.program, EventId.Arrived)) raise(f, EventId.Arrived);
}

/** Follows each unit's waypoints. Units that stop making progress near the goal count as arrived. */
export function movementSystem(sim: Simulation): void {
  const m = sim.motion.f;
  const p = sim.pos.f;
  for (const e of sim.world.query(sim.motion.def)) {
    if (!m.moving[e]) continue;
    const s = sim.stats(e);
    if (s.speed <= 0) {
      m.moving[e] = 0;
      continue;
    }
    if (!sim.spend(e, s.motorUse)) continue; // out of energy: stranded until recharged
    const path = sim.paths[e];
    if (!path || path.length === 0) {
      arrive(sim, e);
      continue;
    }
    let budget = s.speed;
    let x = p.x[e];
    let y = p.y[e];
    // Legs are slower on rock than on open ground.
    if (s.climb > 0 && !s.flying && sim.terrain.heightAt(Math.floor(x / TILE), Math.floor(y / TILE)) > 0) budget = Math.floor((budget * CLIMB_SPEED_PERMILLE) / 1000);
    while (budget > 0 && path.length) {
      const dx = path[0] - x;
      const dy = path[1] - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= budget) {
        x = path[0];
        y = path[1];
        budget -= d;
        path.splice(0, 2);
      } else {
        x += Math.trunc((dx * budget) / d);
        y += Math.trunc((dy * budget) / d);
        budget = 0;
      }
    }
    p.x[e] = x;
    p.y[e] = y;
    sim.pos.markChanged(e);
    if (!path.length) {
      arrive(sim, e);
      continue;
    }

    // Progress check: crowds at the destination (or blocked routes) shouldn't jitter forever.
    const left = Math.sqrt((m.tx[e] - x) ** 2 + (m.ty[e] - y) ** 2);
    if (left > sim.lastDistance[e] - s.speed / 4) sim.stuckTicks[e]++;
    else sim.stuckTicks[e] = 0;
    sim.lastDistance[e] = Math.min(sim.lastDistance[e], left);
    const stuck = sim.stuckTicks[e];
    if (stuck >= 8 && left < 2.5 * TILE) arrive(sim, e, 2);
    else if (stuck % 25 === 0 && stuck > 0) sim.paths[e] = sim.planPath(e, m.tx[e], m.ty[e], s.flying); // jammed: re-plan
  }
}

let pushX = new Int32Array(0);
let pushY = new Int32Array(0);

/** The biggest hull radius any part gives (the colossus), so neighbour searches reach every unit that could touch. */
let maxRadius = 0;

/** Nudges overlapping units apart (ground and air separately), never into blocked cells. Two units keep their hull radii plus a small gap apart. */
export function separationSystem(sim: Simulation): void {
  const p = sim.pos.f;
  if (maxRadius === 0) for (const d of PART_LIST) maxRadius = Math.max(maxRadius, Math.round((d.radius ?? 0) * TILE));
  if (pushX.length < sim.world.capacity) {
    pushX = new Int32Array(sim.world.capacity);
    pushY = new Int32Array(sim.world.capacity);
  }
  const touched: number[] = [];
  const touch = (e: number) => {
    if (pushX[e] === 0 && pushY[e] === 0) touched.push(e);
  };
  for (const e of sim.motion.dense) {
    const se = sim.stats(e);
    const flying = se.flying;
    sim.spatial.forEachInRadius(p.x[e], p.y[e], se.radius + maxRadius + SEPARATION_GAP, (o) => {
      if (o <= e || !sim.motion.has(o)) return;
      const so = sim.stats(o);
      if (so.flying !== flying) return;
      const R = se.radius + so.radius + SEPARATION_GAP;
      const dx = p.x[e] - p.x[o];
      const dy = p.y[e] - p.y[o];
      const d2 = dx * dx + dy * dy;
      if (d2 >= R * R) return;
      let px: number;
      let py: number;
      if (d2 === 0) {
        px = TILE / 8;
        py = 0;
      } else {
        const d = Math.sqrt(d2);
        const k = (R - d) / 2 / d;
        px = Math.trunc(dx * k);
        py = Math.trunc(dy * k);
      }
      if (px === 0 && py === 0) return;
      touch(e);
      touch(o);
      pushX[e] += px;
      pushY[e] += py;
      pushX[o] -= px;
      pushY[o] -= py;
    });
  }
  const t = sim.terrain;
  const maxX = sim.widthSub - 1;
  const maxY = sim.heightSub - 1;
  for (const e of touched) {
    const x = p.x[e];
    const y = p.y[e];
    const nx = Math.min(maxX, Math.max(0, x + pushX[e]));
    const ny = Math.min(maxY, Math.max(0, y + pushY[e]));
    pushX[e] = 0;
    pushY[e] = 0;
    const s = sim.stats(e);
    // Pushes never move a unit onto ground it could not walk to (clearance aside: crowds may squeeze a big hull).
    const ok = (ax: number, ay: number) => s.flying || t.enterable(Math.floor(ax / TILE), Math.floor(ay / TILE), s.climb);
    if (ok(nx, ny)) {
      p.x[e] = nx;
      p.y[e] = ny;
    } else if (ok(nx, y)) {
      p.x[e] = nx;
    } else if (ok(x, ny)) {
      p.y[e] = ny;
    } else {
      continue;
    }
    sim.pos.markChanged(e);
    if (s.flying && !sim.motion.f.moving[e]) sim.ensureLanded(e);
  }
}

/** Harvesters keep gathering from their chosen resource while adjacent, not full, and powered. */
export function harvestSystem(sim: Simulation): void {
  const cargo = sim.cargo;
  const res = sim.resource;
  for (const e of sim.world.query(sim.harvester.def, sim.cargo.def)) {
    if (!sim.canHarvest(e)) continue;
    const s = sim.stats(e);
    if (!sim.spend(e, s.cargoUse)) continue;
    const t = sim.world.resolve(sim.harvester.f.target[e]);
    const take = Math.min(s.harvestRate, s.cargo - cargo.f.amount[e], res.f.amount[t]);
    cargo.f.amount[e] += take;
    res.f.amount[t] -= take;
    cargo.markChanged(e);
    res.markChanged(t);
    if (take > 0 && sim.tick % 2 === 0) sim.emit(SimEvent.Harvest, e, t);
    if (res.f.amount[t] === 0 && !sim.resourcePatch.has(t)) sim.destroyEntity(t);
  }
}

/** Natural matter patches slowly regrow to the amount they started with. */
export function resourceRegenerationSystem(sim: Simulation): void {
  if (sim.tick % RESOURCE_REGEN_INTERVAL_TICKS !== 0) return;
  const amount = sim.resource.f.amount;
  const patches = sim.resourcePatch;
  for (const e of patches.dense) {
    if (amount[e] >= patches.f.maximum[e]) continue;
    amount[e]++;
    sim.resource.markChanged(e);
  }
}

export function combatSystem(sim: Simulation): void {
  const w = sim.weapon.f;
  for (const e of sim.world.query(sim.weapon.def)) {
    if (w.cooldown[e] > 0) {
      w.cooldown[e]--;
      continue;
    }
    if (w.target[e] < 0) continue;
    const t = sim.world.resolve(w.target[e]);
    const stats = sim.stats(e).weapon;
    if (t < 0 || !stats || !sim.health.has(t) || (stats.kind === 'flak' && !sim.missile.has(t))) {
      w.target[e] = -1;
      continue;
    }
    if (sim.edgeDistance(e, t) > stats.range) continue;
    if (!sim.canSpendMatter(e, stats.matter)) continue;
    // A laser's script may choose the energy per shot (laserPower); damage scales with it.
    const shotEnergy = stats.kind === 'laser' && w.power[e] > 0 ? Math.min(w.power[e], stats.use) : stats.use;
    if (!sim.spend(e, shotEnergy)) continue;
    sim.spendMatter(e, stats.matter);
    w.cooldown[e] = stats.cooldown;
    sim.emit(SimEvent.Shot, e, t);
    if (stats.kind === 'tesla') {
      teslaDischarge(sim, e, stats.range);
      continue;
    }
    if (stats.kind === 'missile') {
      launchMissile(sim, e, t, stats);
      continue;
    }
    if (stats.kind === 'flak') {
      // Air-burst: every enemy missile around the target is hit, with no roll to connect.
      const owner = sim.unit.f.owner[e];
      sim.spatial.forEachInRadius(sim.pos.f.x[t], sim.pos.f.y[t], FLAK_BURST_RADIUS, (o) => {
        if (sim.missile.has(o) && !sim.allied(sim.missile.f.owner[o], owner) && sim.health.f.hp[o] > 0) sim.damage(o, stats.damage, owner);
      });
      continue;
    }
    // Small missiles are hard to hit: the shot (and its energy) is simply wasted.
    if (sim.missile.has(t) && !shotHitsMissile(sim, t)) continue;
    const damage = stats.kind === 'laser' && stats.use > 0 ? Math.max(1, Math.round((stats.damage * shotEnergy) / stats.use)) : stats.damage;
    sim.damage(t, damage, sim.unit.f.owner[e], w.aim[e]);
  }
}

/** Stuns every unit and building in range, friend or foe; the weapon's own vehicle gets a shorter stun. */
function teslaDischarge(sim: Simulation, e: number, range: number): void {
  sim.emit(SimEvent.Pulse, e, e);
  sim.spatial.forEachInRadius(sim.pos.f.x[e], sim.pos.f.y[e], range, (o) => {
    if (o !== e && sim.unit.has(o)) sim.stun(o, TESLA_STUN_TICKS);
  });
  if (!sim.stats(e).structure) sim.stun(e, Math.round(TESLA_STUN_TICKS * TESLA_SELF_STUN_FACTOR));
}

/**
 * Charging pads: buildings that automatically transfer energy from their own
 * store (topped up by the grid) to nearby own units, using the same transfer
 * rule as scripts — building-scale reach, and only what the pad actually has.
 */
export function chargingSystem(sim: Simulation): void {
  const owner = sim.unit.f.owner;
  let flow = chargeFlow.get(sim);
  if (!flow) chargeFlow.set(sim, (flow = new Map()));
  for (const b of sim.unit.dense) {
    const s = sim.stats(b);
    if (s.chargeRate <= 0 || sim.isSite(b)) continue;
    let delivered = 0;
    const reach = (s.footprint * TILE) / 2 + CHARGE_RANGE + TILE;
    sim.spatial.forEachInRadius(sim.pos.f.x[b], sim.pos.f.y[b], reach, (o) => {
      if (!sim.motion.has(o) || owner[o] !== owner[b]) return;
      const room = sim.stats(o).energyCapacity - sim.energy.f.amount[o];
      // Up to the boosted rate, but never more than the pad currently holds.
      const amount = Math.min(s.chargeRate * CHARGE_PAD_RATE_MULTIPLIER, room, sim.energy.f.amount[b]);
      if (amount > 0) delivered += sim.transferEnergy(b, o, amount);
    });
    // Only a pad that is really working shows it: a smoothed delivery rate must clear the
    // threshold, so a unit sipping the last few points doesn't keep the pulse running.
    const smooth = (flow.get(b) ?? 0) * (1 - CHARGE_FLOW_SMOOTHING) + delivered * CHARGE_FLOW_SMOOTHING;
    flow.set(b, smooth);
    if (smooth >= CHARGE_PULSE_THRESHOLD && sim.tick % CHARGE_PULSE_TICKS === 0) sim.emit(SimEvent.Charge, b, b);
  }
}

/** Smoothed energy/tick each pad has been delivering (cosmetic: only drives the Charge event). */
const chargeFlow = new WeakMap<Simulation, Map<number, number>>();
const CHARGE_FLOW_SMOOTHING = 0.1;
/** Smoothed delivery needed to show the pulse: about a quarter of one unit's full charge rate. */
const CHARGE_PULSE_THRESHOLD = 5;
/** Ticks between pulses while the pad is working. */
const CHARGE_PULSE_TICKS = 20;

/** Factories build their queue front to back; each new unit becomes the factory's visitor. */
export function productionSystem(sim: Simulation): void {
  const view = sim.production;
  for (const b of sim.world.query(view.def)) {
    const queue = sim.productionQueue[b];
    if (!queue) continue;
    let blueprint = 0;
    let progress = view.f.progress[b];
    const bp = queue.length ? sim.blueprints.get(queue[0]) : undefined;
    const s = sim.stats(b);
    // Work is counted in thousandths of a build tick: a factory with too few modules for the unit
    // advances more slowly. The unit's own energy cost is spread evenly over the work (exact total,
    // whole numbers per tick).
    const rate = bp && factoryCanBuild(s.factoryTiers, bp.stats.size) ? 1000 : 0;
    const before = sim.productionTicks[b];
    const after = before + rate;
    const total = bp?.stats.buildEnergy ?? 0;
    const time = (bp?.stats.buildTime ?? 1) * 1000;
    const step = Math.floor((total * after) / time) - Math.floor((total * before) / time);
    if (bp && s.factory && sim.spend(b, s.factoryUse + step)) {
      sim.productionTicks[b] = after;
      blueprint = bp.id;
      progress = Math.min(100, Math.floor((after * 100) / time));
      if (after >= time) {
        const x = sim.pos.f.x[b] + (sim.rng.int(3) - 1) * TILE;
        const y = sim.pos.f.y[b] + (s.footprint / 2 + 0.5) * TILE;
        const e = sim.spawnUnit(bp, x, y);
        sim.addVisitor(b, e, VisitReason.Produced);
        queue.shift();
        sim.productionTicks[b] = 0;
        progress = 0;
      }
    } else if (bp) {
      blueprint = bp.id; // stalled: no power or factory switched off
    } else {
      progress = 0;
    }
    // The queue behind the front item is replicated too, so clients can draw every slot.
    const f = view.f;
    const behind = [f.q1, f.q2, f.q3, f.q4, f.q5, f.q6, f.q7];
    let changed = f.blueprint[b] !== blueprint || f.progress[b] !== progress || f.queued[b] !== queue.length;
    for (let i = 0; i < behind.length; i++) {
      const id = queue[i + 1] ?? 0;
      if (behind[i][b] !== id) {
        behind[i][b] = id;
        changed = true;
      }
    }
    if (changed) {
      f.blueprint[b] = blueprint;
      f.progress[b] = progress;
      f.queued[b] = queue.length;
      view.markChanged(b);
    }
  }
}

export function deathSystem(sim: Simulation): void {
  const hp = sim.health.f.hp;
  for (const e of sim.world.query(sim.health.def)) {
    if (hp[e] > 0) continue;
    sim.emit(SimEvent.Death, e, 0);
    sim.recordDeath(e);
    sim.destroyEntity(e);
  }
}

/** Replicates energy as a whole percentage, so small drains don't cost bandwidth every tick. */
export function energyViewSystem(sim: Simulation): void {
  const view = sim.energyView;
  for (const e of sim.energy.dense) {
    const cap = sim.stats(e).energyCapacity;
    const pct = cap > 0 ? Math.floor((sim.energy.f.amount[e] * 100) / cap) : 0;
    if (view.f.pct[e] !== pct) {
      view.f.pct[e] = pct;
      view.markChanged(e);
    }
  }
}

/**
 * Repair modules restore hit points to the own unit or building chosen with repair(),
 * once it is within reach, for energy per tick and matter per hit point (armour costs more). Works both ways: units mend buildings
 * and buildings mend units.
 */
export function repairSystem(sim: Simulation): void {
  for (const e of sim.world.query(sim.repairer.def)) {
    const t = sim.world.resolve(sim.repairer.f.target[e]);
    if (t < 0 || t === e || !sim.health.has(t) || sim.isSite(e) || sim.isSite(t)) continue;
    if (sim.unit.f.owner[t] !== sim.unit.f.owner[e]) continue;
    const s = sim.stats(e);
    if (s.repairRate <= 0 || sim.edgeDistance(e, t) > sim.buildRange(e)) continue;
    const missing = sim.stats(t).hp - sim.health.f.hp[t];
    // Damaged modules come first (a broken pair of legs or a gun is worth more than the same hit points of hull), then the hull.
    const moduleDamage = sim.moduleDamageOf(t);
    if (missing <= 0 && moduleDamage <= 0) continue;
    // Energy plus matter: the matter comes from the cargo bay of a unit or the silos of a building.
    const modules = Math.min(s.repairRate, moduleDamage);
    const gain = Math.min(s.repairRate - modules, Math.max(0, missing));
    const owed = (gain + modules) * sim.stats(t).repairMatterPerHp;
    const credit = sim.repairCarry[e] ?? 0; // matter already paid but not yet used (whole units are bought)
    const buy = credit >= owed ? 0 : Math.ceil(owed - credit);
    if (!sim.canSpendMatter(e, buy) || !sim.spend(e, s.repairUse)) continue;
    sim.spendMatter(e, buy);
    sim.repairCarry[e] = credit + buy - owed;
    if (modules > 0) sim.repairModules(t, modules);
    if (gain > 0) {
      sim.health.f.hp[t] += gain;
      sim.health.markChanged(t);
    }
    if (sim.tick % 2 === 0) sim.emit(SimEvent.Repair, e, t);
  }
}

/**
 * Builders next to their chosen site invest resources each tick: from their own
 * cargo first, then from the common pool if the site is linked to a silo. Building
 * also costs energy in proportion to the matter invested: taken from the site's
 * power network when it is supplied, otherwise from the builder, which stops at
 * its reserve so it can still retreat to a charger.
 */
export function buildSystem(sim: Simulation): void {
  const cargo = sim.cargo;
  for (const e of sim.world.query(sim.builder.def)) {
    const site = sim.world.resolve(sim.builder.f.target[e]);
    if (site < 0 || !sim.isSite(site) || sim.isSite(e) || sim.edgeDistance(e, site) > sim.buildRange(e)) continue;
    const s = sim.stats(e);
    if (s.buildRate <= 0) continue;
    const siteStats = sim.stats(site);
    const perMatter = buildEnergyCost(siteStats.area) / siteStats.cost;
    const supplied = sim.siteSupplied(site);
    const energyRoom = supplied
      ? sim.gridEnergy(site)
      : Math.max(0, sim.energy.f.amount[e] - Math.floor(s.energyCapacity * BUILDER_ENERGY_RESERVE));
    let budget = Math.min(s.buildRate, siteStats.cost - sim.invested[site], Math.floor(energyRoom / perMatter));
    if (budget <= 0 || !sim.spend(e, s.builderUse)) continue;
    let used = 0;
    if (cargo.has(e) && cargo.f.amount[e] > 0) {
      const done = sim.investIn(site, Math.min(budget, cargo.f.amount[e]));
      cargo.f.amount[e] -= done;
      cargo.markChanged(e);
      budget -= done;
      used += done;
    }
    if (budget > 0 && sim.isSite(site) && supplied) {
      const owner = sim.unit.f.owner[e];
      const need = Math.min(budget, siteStats.cost - sim.invested[site]);
      used += sim.investIn(site, sim.drawPool(owner, need));
    }
    if (used > 0 && sim.tick % 2 === 0) sim.emit(SimEvent.Build, e, site);
    const energy = Math.ceil(used * perMatter);
    if (supplied) sim.drawGridEnergy(site, energy);
    else sim.energy.f.amount[e] = Math.max(0, sim.energy.f.amount[e] - energy);
  }
}

/** Units that stay without energy for DECAY_TICKS break down into a matter block worth their cost. */
export function decaySystem(sim: Simulation): void {
  for (const e of [...sim.unit.dense]) {
    if (!sim.motion.has(e)) continue;
    if (sim.energy.f.amount[e] >= 1) {
      sim.flatTicks[e] = 0;
      continue;
    }
    if (++sim.flatTicks[e] < DECAY_TICKS) continue;
    const bp = sim.blueprintOf(e);
    sim.spawnResource(sim.pos.f.x[e], sim.pos.f.y[e], bp?.stats.cost ?? 0);
    sim.lastHitBy[e] = 0;
    sim.emit(SimEvent.Death, e, 0);
    sim.recordDeath(e);
    sim.destroyEntity(e);
  }
}
