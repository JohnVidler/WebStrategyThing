import { SimEvent } from './events';
import { DRONE_BAY_CAPACITY, DRONE_BUILD_PERCENT, DRONE_DOCK_RANGE, DRONE_LAUNCH_GAP, DRONE_RECHARGE, DRONE_REPAIR, TILE } from './rules';
import type { Simulation } from './simulation';

/*
 * Drone bay. A carrier with drone-bay modules holds up to DRONE_BAY_CAPACITY small drones (micro or light units) for each. The bay builds them itself, from the
 * carrier's cargo (matter) and battery (energy), at DRONE_BUILD_PERCENT of the normal build time, one at a time, up to its capacity (drones
 * out in the field count towards it).
 *
 * A docked drone is not an entity at all: the bay keeps a record of it (class, hit points, energy), so it is invisible, cannot be targeted
 * or hurt, and costs the tick nothing. It is recharged and mended while docked. Launching turns a record into a real unit beside the carrier,
 * running its class's program from the start; recalling sends every launched drone back, and one within DRONE_DOCK_RANGE docks again (its
 * hit points and energy go back in the record). If the carrier dies, the docked drones die with it; drones out in the field stay.
 * Programs drive it with config.droneClass("Name"), launchDrones() and recallDrones().
 */

interface DockedDrone {
  bp: number;
  hp: number;
  energy: number;
}

export interface Bay {
  /** Blueprint id of the class the bay builds, or -1. */
  droneClass: number;
  docked: DockedDrone[];
  /** Handles of launched drones. */
  out: number[];
  /** Build time spent in thousandths of a tick on the drone being built (-1 = nothing under way). */
  progress: number;
  launching: boolean;
  recalling: boolean;
  nextLaunch: number;
}

export function addHangar(sim: Simulation, e: number): void {
  sim.bays.set(e, { droneClass: -1, docked: [], out: [], progress: -1, launching: false, recalling: false, nextLaunch: 0 });
  sim.hangar.add(e, { docked: 0, capacity: 0 });
}

export const bayCapacity = (sim: Simulation, e: number): number => (sim.stats(e).hangar?.modules ?? 0) * DRONE_BAY_CAPACITY;

/** Chooses the class the bay builds; it must be one of the owner's micro or light unit classes. Returns false if not. */
export function setDroneClass(sim: Simulation, e: number, name: string): boolean {
  const bay = sim.bays.get(e);
  const bp = sim.blueprints.find(sim.unit.f.owner[e], name);
  if (!bay || !bp || bp.retired || bp.stats.structure || bp.stats.size > 1) return false;
  if (bay.droneClass !== bp.id) bay.progress = -1;
  bay.droneClass = bp.id;
  return true;
}

/** Dev tool: fills every free place in the bay with the chosen drone class (or a Wasp), free of charge. Returns false if there is no class to build. */
export function fillBay(sim: Simulation, e: number): boolean {
  const bay = sim.bays.get(e);
  if (!bay) return false;
  if (bay.droneClass < 0) setDroneClass(sim, e, 'Wasp');
  const bp = bay.droneClass >= 0 ? sim.blueprints.get(bay.droneClass) : undefined;
  if (!bp) return false;
  while (bay.docked.length + bay.out.length < bayCapacity(sim, e)) bay.docked.push({ bp: bp.id, hp: bp.stats.hp, energy: bp.stats.energyCapacity });
  return true;
}

export function launchDrones(sim: Simulation, e: number): number {
  const bay = sim.bays.get(e);
  if (!bay || bayCapacity(sim, e) === 0) return 0;
  bay.recalling = false;
  bay.launching = bay.docked.length > 0;
  return bay.docked.length;
}

export function recallDrones(sim: Simulation, e: number): number {
  const bay = sim.bays.get(e);
  if (!bay || bayCapacity(sim, e) === 0) return 0;
  bay.launching = false;
  bay.recalling = bay.out.length > 0;
  return bay.out.length;
}

export function hangarSystem(sim: Simulation): void {
  if (sim.bays.size === 0) return;
  for (const [e, bay] of sim.bays) {
    if (sim.isSite(e)) continue;
    const capacity = bayCapacity(sim, e);
    // Forget drones that died.
    for (let i = bay.out.length - 1; i >= 0; i--) if (sim.world.resolve(bay.out[i]) < 0) bay.out.splice(i, 1);
    if (capacity > 0) {
      build(sim, e, bay, capacity);
      for (const d of bay.docked) upkeep(sim, e, d);
      if (bay.launching) launchOne(sim, e, bay);
      if (bay.recalling) recall(sim, e, bay);
    }
    const docked = Math.min(255, bay.docked.length);
    const cap = Math.min(255, capacity);
    if (sim.hangar.f.docked[e] !== docked || sim.hangar.f.capacity[e] !== cap) {
      sim.hangar.f.docked[e] = docked;
      sim.hangar.f.capacity[e] = cap;
      sim.hangar.markChanged(e);
    }
  }
}

function build(sim: Simulation, e: number, bay: Bay, capacity: number): void {
  const bp = bay.droneClass >= 0 ? sim.blueprints.get(bay.droneClass) : undefined;
  if (!bp || bp.retired || bp.stats.size > 1 || bay.docked.length + bay.out.length >= capacity) {
    bay.progress = -1;
    return;
  }
  if (bay.progress < 0) {
    // Start a drone: its matter comes from the carrier's cargo and its energy from the battery, all at once.
    if (!sim.canSpendMatter(e, bp.stats.cost) || sim.energy.f.amount[e] < bp.stats.buildEnergy) return;
    sim.spendMatter(e, bp.stats.cost);
    sim.spend(e, bp.stats.buildEnergy);
    bay.progress = 0;
  }
  bay.progress += 1000;
  if (bay.progress >= bp.stats.buildTime * 10 * DRONE_BUILD_PERCENT) {
    bay.docked.push({ bp: bp.id, hp: bp.stats.hp, energy: bp.stats.energyCapacity });
    bay.progress = -1;
  }
}

function upkeep(sim: Simulation, e: number, d: DockedDrone): void {
  const bp = sim.blueprints.get(d.bp);
  if (!bp) return;
  const room = bp.stats.energyCapacity - d.energy;
  if (room > 0) {
    const give = Math.min(room, DRONE_RECHARGE);
    if (sim.spend(e, give)) d.energy += give;
  }
  if (d.hp < bp.stats.hp) d.hp = Math.min(bp.stats.hp, d.hp + DRONE_REPAIR);
}

function launchOne(sim: Simulation, e: number, bay: Bay): void {
  if (sim.tick < bay.nextLaunch) return;
  const d = bay.docked.shift();
  if (!d) {
    bay.launching = false;
    return;
  }
  const bp = sim.blueprints.get(d.bp);
  if (bp) {
    const side = bay.out.length % 2 === 0 ? 1 : -1;
    const u = sim.spawnUnit(bp, sim.pos.f.x[e] + side * 0.6 * TILE, sim.pos.f.y[e] + 0.6 * TILE);
    sim.health.f.hp[u] = d.hp;
    sim.health.markChanged(u);
    sim.energy.f.amount[u] = d.energy;
    bay.out.push(sim.world.handle(u));
    sim.emit(SimEvent.DroneLaunch, e, u);
  }
  bay.nextLaunch = sim.tick + DRONE_LAUNCH_GAP;
  if (bay.docked.length === 0) bay.launching = false;
}

function recall(sim: Simulation, e: number, bay: Bay): void {
  const cx = sim.pos.f.x[e], cy = sim.pos.f.y[e];
  for (let i = bay.out.length - 1; i >= 0; i--) {
    const u = sim.world.resolve(bay.out[i]);
    if (u < 0) continue;
    if (Math.hypot(sim.pos.f.x[u] - cx, sim.pos.f.y[u] - cy) <= DRONE_DOCK_RANGE + (sim.stats(e).footprint * TILE) / 2) {
      bay.docked.push({ bp: sim.unit.f.blueprint[u], hp: sim.health.f.hp[u], energy: sim.energy.f.amount[u] });
      bay.out.splice(i, 1);
      sim.destroyEntity(u);
      sim.emit(SimEvent.DroneDock, e, e);
    } else if ((sim.tick + u) % 10 === 0) {
      sim.setDestination(u, cx, cy);
    }
  }
  if (bay.out.length === 0) bay.recalling = false;
}
