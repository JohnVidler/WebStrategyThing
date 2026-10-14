import { createVm, rebootVm, runVm } from '../vm/vm';
import { UNIT_API, VisitReason } from './api';
import { CpuState } from './components';
import { SimEvent } from './events';
import { TILE } from './parts';
import { daylight, share, StorageMode, wind } from './power';
import { GENERATION_SCALE } from './parts';
import { BUILDER_ENERGY_RESERVE, SEPARATION_RADIUS, DECAY_TICKS, MAX_TRANSMISSION_LOSS, RESOURCE_REGEN_INTERVAL_TICKS, SOLAR_GENERATION_MULTIPLIER, STORAGE_DISCHARGE_FRACTION, TESLA_SELF_STUN_FACTOR, TESLA_STUN_TICKS, TRANSMISSION_LOSS_PER_TILE, WIND_GENERATION_MULTIPLIER, buildEnergyCost } from './rules';
import { CHARGE_PAD_RATE_MULTIPLIER, CHARGE_RANGE } from './rules';
import type { Simulation } from './simulation';

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
      switch (sim.storage.f.mode[b]) {
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
    let pool = generated;
    let discharged = 0;
    for (const i of discharging) {
      if (pool >= demand) break;
      const take = Math.min(demand - pool, store[m[i]], Math.ceil(sim.stats(m[i]).energyCapacity * STORAGE_DISCHARGE_FRACTION));
      store[m[i]] -= take;
      flow[i] -= take;
      pool += take;
      discharged += take;
    }
    let used = 0;
    const served = share(Math.min(pool, demand), normalRoom);
    served.forEach((g, k) => {
      store[m[normal[k]]] += g;
      flow[normal[k]] += g;
      used += g;
    });
    pool -= served.reduce((a, b) => a + b, 0);
    share(pool, chargingRoom).forEach((g, k) => {
      store[m[charging[k]]] += g;
      flow[charging[k]] += g;
      used += g;
    });
    // Generators gave what was used beyond the discharged energy, in proportion to their output.
    share(used - discharged, gen).forEach((g, i) => (flow[i] -= g));

    net.supply = generated;
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

/** Runs every unit's class program with that unit's own CPU budget, memory and energy. */
export function scriptSystem(sim: Simulation): void {
  const ctx = sim.scriptCtx;
  const cpu = sim.cpu;
  for (const e of sim.world.query(sim.unit.def)) {
    const bp = sim.blueprintOf(e);
    if (!bp) continue;
    const s = sim.stats(e);
    let state: number = CpuState.Running;
    let used = 0;
    let vm = sim.vms[e];

    if (!bp.program || s.cyclesPerTick === 0 || sim.isSite(e)) state = CpuState.Offline;
    else if (sim.tick < sim.stunUntil[e]) state = CpuState.Stunned;
    else if (sim.tick < sim.sleepUntil[e]) state = CpuState.Sleeping;
    else if (sim.energy.f.amount[e] < 1) state = CpuState.NoPower;
    else {
      if (!vm || vm.program !== bp.program) {
        vm = sim.vms[e] = createVm(bp.program, s.memorySlots, s.stackDepth);
        sim.endVisit(e);
      }
      if (vm.fault) {
        // A crashed unit spends one tick rebooting (and forgets any visitor).
        rebootVm(vm);
        sim.endVisit(e);
      } else {
        const passes = vm.halts;
        ctx.e = e;
        ctx.bp = bp;
        ctx.stats = s;
        used = runVm(vm, UNIT_API, ctx, s.cyclesPerTick);
        // Finishing a pass ends any visit: buildings get one shot per visitor.
        if (vm.halts !== passes) sim.endVisit(e);
        // Processing costs energy in proportion to the work done (yield and sleep are free).
        const owed = sim.cpuDebt[e] + Math.max(0, used - vm.freeCycles) * s.cpuUse;
        const whole = Math.floor(owed / 100);
        sim.cpuDebt[e] = owed - whole * 100;
        sim.energy.f.amount[e] = Math.max(0, sim.energy.f.amount[e] - whole);
      }
    }

    const fault = vm?.fault ?? 0;
    if (cpu.f.used[e] !== used || cpu.f.fault[e] !== fault || cpu.f.state[e] !== state) {
      cpu.f.used[e] = used;
      cpu.f.fault[e] = fault;
      cpu.f.state[e] = state;
      cpu.markChanged(e);
    }
  }
}

/** `how`: 1 = reached the end of the path, 2 = stopped short by a crowd near the goal. */
function arrive(sim: Simulation, e: number, how: 1 | 2 = 1): void {
  sim.motion.f.moving[e] = 0;
  sim.motion.f.arrived[e] = how;
  sim.paths[e] = undefined;
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

/** Nudges overlapping units apart (ground and air separately), never into blocked cells. */
export function separationSystem(sim: Simulation): void {
  const R = SEPARATION_RADIUS;
  const R2 = R * R;
  const p = sim.pos.f;
  if (pushX.length < sim.world.capacity) {
    pushX = new Int32Array(sim.world.capacity);
    pushY = new Int32Array(sim.world.capacity);
  }
  const touched: number[] = [];
  const touch = (e: number) => {
    if (pushX[e] === 0 && pushY[e] === 0) touched.push(e);
  };
  for (const e of sim.motion.dense) {
    const flying = sim.stats(e).flying;
    sim.spatial.forEachInRadius(p.x[e], p.y[e], R, (o) => {
      if (o <= e || !sim.motion.has(o) || sim.stats(o).flying !== flying) return;
      const dx = p.x[e] - p.x[o];
      const dy = p.y[e] - p.y[o];
      const d2 = dx * dx + dy * dy;
      if (d2 >= R2) return;
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
    const flying = sim.stats(e).flying;
    const ok = (ax: number, ay: number) => flying || t.walkable(Math.floor(ax / TILE), Math.floor(ay / TILE));
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
    if (flying && !sim.motion.f.moving[e]) sim.ensureLanded(e);
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
  const hp = sim.health.f.hp;
  for (const e of sim.world.query(sim.weapon.def)) {
    if (w.cooldown[e] > 0) {
      w.cooldown[e]--;
      continue;
    }
    if (w.target[e] < 0) continue;
    const t = sim.world.resolve(w.target[e]);
    const stats = sim.stats(e).weapon;
    if (t < 0 || !stats || !sim.health.has(t)) {
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
    const damage = stats.kind === 'laser' && stats.use > 0 ? Math.max(1, Math.round((stats.damage * shotEnergy) / stats.use)) : stats.damage;
    hp[t] -= damage;
    sim.lastHitBy[t] = sim.unit.f.owner[e];
    sim.health.markChanged(t);
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
  for (const b of sim.unit.dense) {
    const s = sim.stats(b);
    if (s.chargeRate <= 0 || sim.isSite(b)) continue;
    const reach = (s.footprint * TILE) / 2 + CHARGE_RANGE + TILE;
    sim.spatial.forEachInRadius(sim.pos.f.x[b], sim.pos.f.y[b], reach, (o) => {
      if (!sim.motion.has(o) || owner[o] !== owner[b]) return;
      const room = sim.stats(o).energyCapacity - sim.energy.f.amount[o];
      // Up to the boosted rate, but never more than the pad currently holds.
      const amount = Math.min(s.chargeRate * CHARGE_PAD_RATE_MULTIPLIER, room, sim.energy.f.amount[b]);
      if (amount > 0) sim.transferEnergy(b, o, amount);
    });
  }
}

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
    if (bp && s.factory && sim.spend(b, s.factoryUse)) {
      const ticks = ++sim.productionTicks[b];
      blueprint = bp.id;
      progress = Math.floor((ticks * 100) / bp.stats.buildTime);
      if (ticks >= bp.stats.buildTime) {
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
    if (view.f.blueprint[b] !== blueprint || view.f.progress[b] !== progress || view.f.queued[b] !== queue.length) {
      view.f.blueprint[b] = blueprint;
      view.f.progress[b] = progress;
      view.f.queued[b] = queue.length;
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
    const perMatter = buildEnergyCost(siteStats.footprint) / siteStats.cost;
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
