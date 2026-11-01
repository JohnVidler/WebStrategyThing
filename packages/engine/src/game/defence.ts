import { SimEvent } from './events';
import { shotHitsMissile } from './missile';
import { PD_COOLDOWN, PD_DAMAGE, PD_RANGE, PD_SHELL_HIT_PERMILLE } from './rules';
import type { Simulation } from './simulation';

/*
 * Point defence. Every working point-defence module shoots at the nearest enemy missile or cannon shell within PD_RANGE of its carrier,
 * once every PD_COOLDOWN ticks, for PD_DAMAGE energy-cheap shots. It needs no program (flak has to be aimed with fire(); this is the passive
 * alternative) and it does not use the carrier's weapon slot. A missile is shot like any other shot at it, with the missile's own chance to
 * be hit; a cannon shell is stopped with PD_SHELL_HIT_PERMILLE in a thousand. Each module shoots once per cooldown and pays its own energy.
 *
 * The carriers are kept in `Simulation.defenders`, and the whole system does nothing while no missile or shell is in the air.
 */

export function defenceSystem(sim: Simulation): void {
  if (sim.defenders.size === 0 || (sim.missile.dense.length === 0 && sim.shell.dense.length === 0)) return;
  for (const e of sim.defenders) {
    const d = sim.stats(e).defence;
    if (!d || sim.isSite(e) || (sim.defenceReady[e] ?? 0) > sim.tick) continue;
    const owner = sim.unit.f.owner[e];
    const x = sim.pos.f.x[e];
    const y = sim.pos.f.y[e];
    let fired = false;
    for (let k = 0; k < d.modules; k++) {
      const t = sim.spatial.nearest(x, y, PD_RANGE, (o) => {
        if (sim.missile.has(o)) return sim.health.f.hp[o] > 0 && !sim.allied(sim.missile.f.owner[o], owner);
        if (sim.shell.has(o)) return sim.shell.f.state[o] === 0 && !sim.allied(sim.shell.f.owner[o], owner) && sim.shellFlights[o]?.spent === false;
        return false;
      });
      if (t < 0) break;
      if (!sim.spend(e, d.use)) break;
      fired = true;
      sim.emit(SimEvent.Intercept, e, t);
      if (sim.missile.has(t)) {
        if (shotHitsMissile(sim, t)) sim.damage(t, PD_DAMAGE, owner);
      } else if (sim.rng.int(1000) < PD_SHELL_HIT_PERMILLE) {
        sim.shellFlights[t]!.spent = true; // the shell system removes it next
      }
    }
    if (fired) sim.defenceReady[e] = sim.tick + PD_COOLDOWN;
  }
}
