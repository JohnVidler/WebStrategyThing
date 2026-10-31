import { Aim } from './components';
import type { Simulation } from './simulation';
import { coneRange } from './vision';

/*
 * Which way a long-range weapon points. The owner sees a thin wedge along it (see vision.ts), so it
 * matters where it looks: at its target while it has one, along the way it is travelling while it moves,
 * and otherwise where it was last pointing (a new building looks towards the middle of the map).
 */

const TAU = Math.PI * 2;
const quantise = (heading: number): number => Math.round((((heading % TAU) + TAU) % TAU) / TAU * 256) & 255;

/** Gives `e` an aim if its weapon outranges its sight, looking at the middle of the map to begin with. */
export function addAim(sim: Simulation, e: number): void {
  const s = sim.stats(e);
  if (coneRange(s) <= 0 || sim.aim.has(e)) return;
  sim.aim.add(e, { heading: quantise(Math.atan2(sim.heightSub / 2 - sim.pos.f.y[e], sim.widthSub / 2 - sim.pos.f.x[e])) });
}

/** Where each aiming unit was last tick, to tell which way it is moving. */
const lastSeen = new WeakMap<Simulation, { x: number[]; y: number[] }>();

/** Points every long-range weapon at its target, or along its travel, once a tick. */
export function aimSystem(sim: Simulation): void {
  let last = lastSeen.get(sim);
  if (!last) lastSeen.set(sim, (last = { x: [], y: [] }));
  const px = sim.pos.f.x;
  const py = sim.pos.f.y;
  for (const e of sim.aim.dense) {
    let want = -1;
    const t = sim.weapon.has(e) && sim.weapon.f.target[e] >= 0 ? sim.world.resolve(sim.weapon.f.target[e]) : -1;
    if (t >= 0 && sim.pos.has(t)) {
      want = quantise(Math.atan2(py[t] - py[e], px[t] - px[e]));
    } else if (last.x[e] !== undefined) {
      const dx = px[e] - last.x[e];
      const dy = py[e] - last.y[e];
      if (dx * dx + dy * dy > 4) want = quantise(Math.atan2(dy, dx));
    }
    last.x[e] = px[e];
    last.y[e] = py[e];
    if (want >= 0 && want !== sim.aim.f.heading[e]) {
      sim.aim.f.heading[e] = want;
      sim.aim.markChanged(e);
    }
  }
}
