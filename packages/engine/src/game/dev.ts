import type { Blueprint } from './blueprint';
import { deriveStats } from './blueprint';
import { NEUTRAL_CLASS, STARTER_CLASSES, type ClassTemplate } from './content';
import { defineClass } from './map';
import { TILE } from './parts';
import type { Simulation } from './simulation';
import type { DevRemoveScope } from '../net/dev';
import { flameBurstAt, lobFlame } from './flame';
import { dropSmoke } from './smoke';
import { startRail } from './rail';
import { ionHold } from './ion';
import { bayCapacity, fillBay, launchDrones, recallDrones } from './hangar';
import type { DevWeaponAction } from '../net/dev';

/*
 * Developer tools on the simulation: instant spawning, removal, healing and the like, for the Dev Options menu
 * of a development build. They bypass costs, caps and fog, so only a server started with WST_DEV_TOOLS=1
 * calls them (see Match). They are deterministic (no randomness) but not part of normal play.
 */

/** Everything the menu can spawn: the starter classes plus the neutral Wanderer. */
export const DEV_TEMPLATES: readonly { readonly name: string; readonly structure: boolean }[] = [...STARTER_CLASSES, NEUTRAL_CLASS].map((c) => ({
  name: c.name,
  structure: deriveStats(c.parts).structure,
}));

const SEARCH_RADIUS = 14;

const templateByName = (name: string): ClassTemplate | undefined => (name === NEUTRAL_CLASS.name ? NEUTRAL_CLASS : STARTER_CLASSES.find((c) => c.name === name));

/** The owner's class of this starter name; defined for them on first use. `created` is set when a new class was made (so clients need it). */
export function devBlueprint(sim: Simulation, owner: number, name: string): { bp: Blueprint; created: boolean } | undefined {
  const existing = sim.blueprints.find(owner, name);
  if (existing) return { bp: existing, created: false };
  const template = templateByName(name);
  return template ? { bp: defineClass(sim, owner, template), created: true } : undefined;
}

/** The closest top-left tile to (tx, ty) where a building of this size fits, searching outwards in square rings. */
function freeFootprint(sim: Simulation, bp: Blueprint, tx: number, ty: number): [number, number] | undefined {
  const size = bp.stats.footprint;
  for (let r = 0; r <= SEARCH_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx;
        const y = ty + dy;
        if (x >= 0 && y >= 0 && sim.terrain.footprintFree(x, y, size, bp.stats.shape)) return [x, y];
      }
    }
  }
  return undefined;
}

/** Spawns up to `count` of a starter class for `owner` near tile (tx, ty); returns the entities made and the class (with whether it is new). */
export function devSpawn(
  sim: Simulation,
  owner: number,
  template: string,
  tx: number,
  ty: number,
  count: number,
): { entities: number[]; bp: Blueprint; created: boolean } | undefined {
  const found = devBlueprint(sim, owner, template);
  if (!found) return undefined;
  const { bp, created } = found;
  const entities: number[] = [];
  for (let i = 0; i < count; i++) {
    if (bp.stats.structure) {
      const spot = freeFootprint(sim, bp, tx, ty);
      if (!spot) break;
      entities.push(sim.spawnStructure(bp, spot[0], spot[1]));
    } else {
      try {
        entities.push(sim.spawnUnit(bp, tx * TILE + TILE / 2, ty * TILE + TILE / 2));
      } catch {
        break; // No room left near this spot.
      }
    }
  }
  return { entities, bp, created };
}

/** Matter into the owner's silos, as far as they have room; returns what fitted. */
export function devGive(sim: Simulation, owner: number, amount: number): number {
  let left = amount;
  for (const b of [...sim.stockpile.dense]) {
    if (left <= 0) break;
    if (sim.unit.f.owner[b] === owner) left -= sim.addStock(b, left);
  }
  return amount - left;
}

/** Removes units, buildings and resource fields within `r` tiles of (tx, ty); `owner` -1 matches anyone's. Returns how many went. */
export function devRemove(sim: Simulation, tx: number, ty: number, r: number, owner: number, scope: DevRemoveScope): number {
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;
  const reach = r * TILE;
  const near = (e: number): boolean => Math.hypot(sim.pos.f.x[e] - cx, sim.pos.f.y[e] - cy) <= reach;
  const doomed: number[] = [];
  for (const e of sim.unit.dense) {
    if (owner >= 0 && sim.unit.f.owner[e] !== owner) continue;
    const structure = sim.stats(e).structure;
    if ((structure ? scope.buildings : scope.units) && near(e)) doomed.push(e);
  }
  if (scope.resources) for (const e of sim.resource.dense) if (near(e)) doomed.push(e);
  for (const e of doomed) sim.destroyEntity(e);
  return doomed.length;
}

/** Destroys every unit and building of an owner (0 = the neutral ones). */
export function devClear(sim: Simulation, owner: number): number {
  const doomed = sim.unit.dense.filter((e) => sim.unit.f.owner[e] === owner);
  for (const e of doomed) sim.destroyEntity(e);
  return doomed.length;
}

/** Full health, mended modules and full energy for the finished units and buildings of an owner (-1 = anyone's). */
export function devHeal(sim: Simulation, owner: number): number {
  let n = 0;
  for (const e of sim.unit.dense) {
    if ((owner >= 0 && sim.unit.f.owner[e] !== owner) || sim.isSite(e)) continue;
    const s = sim.stats(e);
    sim.health.f.hp[e] = s.hp;
    sim.health.markChanged(e);
    sim.repairModules(e, Number.MAX_SAFE_INTEGER);
    sim.energy.f.amount[e] = s.energyCapacity;
    sim.energy.markChanged(e);
    n++;
  }
  return n;
}

/** Hurts each of these entities that is a live unit or building by `amount`, as an unattributed hit (so enough of it destroys them). Returns how many were hit. */
export function devDamage(sim: Simulation, ids: readonly number[], amount: number): number {
  let n = 0;
  for (const e of ids) {
    if (!sim.unit.has(e)) continue;
    sim.damage(e, amount, 0);
    n++;
  }
  return n;
}

/**
 * The new weapons and modules on demand (see DevCommand 'weapons'): a volley of smoke round a tile, or an action on each listed unit
 * (an ion hold, an instant railgun shot, full drone bays, launching or recalling drones). Returns how many things it acted on.
 */
export function devWeapons(sim: Simulation, action: DevWeaponAction, ids: readonly number[], tx: number, ty: number): number {
  if (action === 'smoke') return dropSmoke(sim, tx * TILE + TILE / 2, ty * TILE + TILE / 2);
  let n = 0;
  for (const e of ids) {
    if (!sim.unit.has(e) || sim.isSite(e)) continue;
    if (action === 'ion') {
      if (ionHold(sim, e)) n++;
    } else if (action === 'rail') {
      const w = sim.stats(e).weapon;
      const t = sim.weapon.has(e) ? sim.world.resolve(sim.weapon.f.target[e]) : -1;
      if (!w || w.kind !== 'rail' || t < 0) continue;
      sim.energy.f.amount[e] = Math.max(sim.energy.f.amount[e], w.use);
      startRail(sim, e, t, w.use, 0);
      const r = sim.rails.get(e);
      if (r) {
        r.left = 1;
        n++;
      }
    } else if (action === 'fill') {
      if (bayCapacity(sim, e) > 0 && fillBay(sim, e)) n++;
    } else if (action === 'launch') {
      if (launchDrones(sim, e) > 0) n++;
    } else if (recallDrones(sim, e) > 0) {
      n++;
    }
  }
  return n;
}

/** Completes every construction site of an owner (-1 = anyone's) for free. */
export function devFinishSites(sim: Simulation, owner: number): number {
  const sites = sim.unit.dense.filter((e) => sim.isSite(e) && (owner < 0 || sim.unit.f.owner[e] === owner));
  for (const e of sites) sim.investIn(e, Number.MAX_SAFE_INTEGER);
  return sites.length;
}

/**
 * Paints the terrain: every cell within `r` tiles of (tx, ty) that has no building gets `elevation` (above 0 rock of that height,
 * 0 dry ground, below 0 liquid). Returns the cells that changed as flat [index, elevation, ...] pairs (what a `terrainPatch` carries).
 * The rock heights round the painted area are not recomputed, so the client and server stay identical by sending exact values.
 */
export function devPaintTerrain(sim: Simulation, tx: number, ty: number, r: number, elevation: number): number[] {
  const t = sim.terrain;
  const changed: number[] = [];
  for (let y = ty - r; y <= ty + r; y++) {
    for (let x = tx - r; x <= tx + r; x++) {
      if (!t.inBounds(x, y) || (x - tx) ** 2 + (y - ty) ** 2 > r * r + r) continue;
      const i = y * t.width + x;
      if (t.occupied[i] !== 0 || t.elevationAt(x, y) === elevation) continue;
      t.setElevation(x, y, elevation);
      changed.push(i, elevation);
    }
  }
  if (changed.length) t.version++;
  return changed;
}

/** Starts fires on the ground (`ground`: `count` of them scattered round the tile) or throws `count` fireballs all round it (`burst`). Returns how many it made. */
export function devFire(sim: Simulation, tx: number, ty: number, mode: 'ground' | 'burst', count: number): number {
  const x = tx * TILE + TILE / 2;
  const y = ty * TILE + TILE / 2;
  const before = sim.flame.dense.length;
  if (mode === 'burst') flameBurstAt(sim, x, y, count, 0);
  else {
    for (let i = 0; i < count; i++) {
      const angle = sim.rng.int(1000) * 0.00628;
      const dist = count > 1 ? (sim.rng.int(1000) / 1000) * 2.5 * TILE : 0;
      lobFlame(sim, x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, 0);
    }
  }
  return sim.flame.dense.length - before;
}
