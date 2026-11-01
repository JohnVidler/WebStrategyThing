import { SimEvent } from './events';
import {
  MAX_SMOKE,
  SMOKE_CANISTERS,
  SMOKE_COOLDOWN,
  SMOKE_RADIUS,
  SMOKE_SPREAD,
  SMOKE_THROW,
  SMOKE_TICKS,
  TILE,
} from './rules';
import type { Simulation } from './simulation';
import { VisionGrid } from './vision';

/*
 * Smoke launcher. A module any unit or building can carry throws a volley of SMOKE_CANISTERS canisters (one along the aimed heading, the
 * others SMOKE_SPREAD to each side). Each lands SMOKE_THROW away as a cloud: an entity with a Position and a Smoke component that sits
 * where it fell for SMOKE_TICKS and then thins out and goes. Smoke costs no matter, only a little energy, and the module rests
 * SMOKE_COOLDOWN ticks after a volley.
 *
 * What a cloud does: it blocks sight like rock does (the fog and the viewers' wedges, via `VisionGrid.setSmoke`), it stops a sensor finding
 * an enemy that is in it or behind it (`smokeBlocks`, used by the sensors and by weapons that already hold a lock), and a laser crossing it
 * does only part of its damage. Radar and radio are not affected: they are the counter. Clouds do not move, so there is nothing random in them.
 * Their tile cover (`Simulation.smokeTiles`) is rebuilt only when a cloud appears or goes.
 */

export interface SmokeCloud {
  x: number;
  y: number;
  /** Ticks left. */
  left: number;
}

/** Sight between two points (sub-tile units) is closer than this to the sensor even through smoke: you see a cloud's near edge. */
const SMOKE_NEAR = 2 * TILE;

/** Is the tile (tx, ty) under smoke? */
export function smokeAt(sim: Simulation, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < sim.terrain.width && ty < sim.terrain.height && sim.smokeTiles[ty * sim.terrain.width + tx] !== 0;
}

/** Does smoke lie between (x0, y0) and (x1, y1), or cover the far point, with the far point further than a couple of tiles away? */
export function smokeBlocks(sim: Simulation, x0: number, y0: number, x1: number, y1: number): boolean {
  if (sim.smokeCount === 0) return false;
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len <= SMOKE_NEAR) return false;
  const steps = Math.ceil(len / (TILE / 2));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (smokeAt(sim, Math.floor((x0 + dx * t) / TILE), Math.floor((y0 + dy * t) / TILE))) return true;
  }
  return false;
}

/** Does smoke lie across the line between two points (for a laser: it loses part of its damage)? */
export function smokeCrosses(sim: Simulation, x0: number, y0: number, x1: number, y1: number): boolean {
  if (sim.smokeCount === 0) return false;
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (TILE / 2)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (smokeAt(sim, Math.floor((x0 + dx * t) / TILE), Math.floor((y0 + dy * t) / TILE))) return true;
  }
  return false;
}

/** Is the smoke launcher of `e` ready (working, rested, energy for a volley)? Returns false and does nothing otherwise. */
export function throwSmoke(sim: Simulation, e: number, degrees: number): boolean {
  const s = sim.stats(e).smoke;
  if (!s || sim.isSite(e) || (sim.smokeReady[e] ?? 0) > sim.tick) return false;
  if (!sim.spend(e, s.use)) return false;
  sim.smokeReady[e] = sim.tick + SMOKE_COOLDOWN;
  const heading = (degrees * Math.PI) / 180;
  for (let i = 0; i < SMOKE_CANISTERS; i++) {
    const a = heading + (i - (SMOKE_CANISTERS - 1) / 2) * SMOKE_SPREAD;
    const x = Math.min(sim.widthSub - 1, Math.max(0, sim.pos.f.x[e] + Math.cos(a) * SMOKE_THROW));
    const y = Math.min(sim.heightSub - 1, Math.max(0, sim.pos.f.y[e] + Math.sin(a) * SMOKE_THROW));
    addCloud(sim, x, y);
  }
  sim.emit(SimEvent.Smoke, e, e);
  return true;
}

/** Dev tool: a volley of clouds round a point (no launcher, no energy, no rest). Returns how many clouds. */
export function dropSmoke(sim: Simulation, x: number, y: number): number {
  for (let i = 0; i < SMOKE_CANISTERS; i++) {
    const a = (i / SMOKE_CANISTERS) * Math.PI * 2;
    addCloud(sim, Math.min(sim.widthSub - 1, Math.max(0, x + Math.cos(a) * 1.2 * TILE)), Math.min(sim.heightSub - 1, Math.max(0, y + Math.sin(a) * 1.2 * TILE)));
  }
  return SMOKE_CANISTERS;
}

function addCloud(sim: Simulation, x: number, y: number): void {
  if (sim.smoke.dense.length >= MAX_SMOKE) sim.destroyEntity(sim.smoke.dense[0]); // the oldest thins out first
  const id = sim.world.create();
  sim.pos.add(id, { x: Math.round(x), y: Math.round(y) });
  sim.smoke.add(id, { radius: Math.round(SMOKE_RADIUS / (TILE / 10)), life: 255 });
  sim.smokeClouds[id] = { x, y, left: SMOKE_TICKS };
  sim.smokeDirty = true;
}

/** Ages every cloud, thins it for the client, and refreshes the tile cover and the vision grid when the set of clouds changed. */
export function smokeSystem(sim: Simulation): void {
  const dense = sim.smoke.dense;
  if (dense.length > 0) {
    for (const e of [...dense]) {
      const c = sim.smokeClouds[e];
      if (!c || --c.left <= 0) {
        sim.destroyEntity(e);
        sim.smokeDirty = true;
        continue;
      }
      if (c.left % 5 === 0) {
        sim.smoke.f.life[e] = Math.ceil((c.left * 255) / SMOKE_TICKS);
        sim.smoke.markChanged(e);
      }
    }
  }
  sim.smokeCount = sim.smoke.dense.length;
  if (!sim.smokeDirty) return;
  sim.smokeDirty = false;
  const w = sim.terrain.width, h = sim.terrain.height;
  if (sim.smokeTiles.length !== w * h) sim.smokeTiles = new Uint8Array(w * h);
  sim.smokeTiles.fill(0);
  const flat: number[] = [];
  for (const e of sim.smoke.dense) {
    const c = sim.smokeClouds[e];
    if (!c) continue;
    flat.push(c.x / TILE, c.y / TILE, SMOKE_RADIUS / TILE);
  }
  VisionGrid.of(sim.terrain).setSmoke(flat, sim.smokeTiles);
}
