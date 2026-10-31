import type { Blueprint } from './blueprint';
import { botUnitClasses, type BotUnitClass } from './bot';
import { defineClass, type Corner } from './map';
import {
  BOT_STAGING_RADIUS,
  BOT_THINK_TICKS,
  HORDE_FIRST_TICKS,
  HORDE_GROUP_BASE,
  HORDE_GROWTH_TICKS,
  HORDE_INTERVAL_TICKS,
  HORDE_MAX_ALIVE,
  HORDE_TIER_TICKS,
  TILE,
} from './rules';
import { Caps } from './blueprint';
import { CommandError, type Simulation } from './simulation';
import { TaskType } from './tasks';

/**
 * The horde scenario's opposition. It owns no buildings: every so often it puts a small group of
 * units on the ground at its spawn point and sends them at the nearest thing its enemy owns. The
 * groups grow slowly and stronger classes join the mix as time passes, so the pressure never lets up.
 * It never runs out (the match has no victory), and the owner is a cheater like any bot: its
 * units never run flat.
 */
export class HordeSpawner {
  private next = HORDE_FIRST_TICKS;
  private spawned = 0;
  /** Everyone under siege (more than one in a multiplayer room); the groups go for whichever building is nearest. */
  private readonly enemies = new Set<number>();

  constructor(
    private readonly sim: Simulation,
    readonly owner: number,
    /** The first human under siege (see `addEnemy`). */
    enemy: number,
    /** Tile the units appear at. */
    private readonly spawn: { readonly x: number; readonly y: number },
    private readonly units: readonly { cls: BotUnitClass; bp: Blueprint }[],
  ) {
    this.enemies.add(enemy);
  }

  addEnemy(owner: number): void {
    this.enemies.add(owner);
  }

  removeEnemy(owner: number): void {
    this.enemies.delete(owner);
  }

  /** Units spawned so far. */
  get total(): number {
    return this.spawned;
  }

  /** Call once per tick, before Simulation.step(). */
  step(): void {
    const sim = this.sim;
    if (sim.tick % BOT_THINK_TICKS !== 0) return;
    const alive = this.alive();
    if (sim.tick >= this.next) {
      this.next = sim.tick + HORDE_INTERVAL_TICKS;
      this.spawnGroup(alive.length);
    }
    this.press();
  }

  private alive(): number[] {
    const sim = this.sim;
    return sim.unit.dense.filter((e) => sim.unit.f.owner[e] === this.owner);
  }

  private groupSize(): number {
    return HORDE_GROUP_BASE + Math.floor(Math.max(0, this.sim.tick - HORDE_FIRST_TICKS) / HORDE_GROWTH_TICKS);
  }

  /** Classes in the mix right now: the roster opens up one class per HORDE_TIER_TICKS. */
  private unlocked(): readonly { cls: BotUnitClass; bp: Blueprint }[] {
    return this.units.slice(0, Math.min(this.units.length, 1 + Math.floor(this.sim.tick / HORDE_TIER_TICKS)));
  }

  private spawnGroup(alive: number): void {
    const sim = this.sim;
    const goal = this.target();
    if (!goal) return;
    const pool = this.unlocked();
    const count = Math.min(this.groupSize(), HORDE_MAX_ALIVE - alive);
    for (let i = 0; i < count; i++) {
      const bp = pool[this.spawned % pool.length].bp;
      // Spread across a few tiles so a group does not stack on one spot; spawnUnit finds the nearest open ground.
      const dx = ((this.spawned * 7) % 5) - 2;
      const dy = ((this.spawned * 3) % 5) - 2;
      this.spawned++;
      try {
        const e = sim.spawnUnit(bp, (this.spawn.x + dx + 0.5) * TILE, (this.spawn.y + dy + 0.5) * TILE);
        sim.issueCommand(this.owner, e, TaskType.Attack, goal.x, goal.y, -1, false);
      } catch (err) {
        if (!(err instanceof CommandError)) throw err;
      }
    }
  }

  /** Units that finished their attack and stand idle away from the spawn go straight on to the next target. */
  private press(): void {
    const sim = this.sim;
    const idle = this.alive().filter(
      (e) =>
        (sim.stats(e).caps & Caps.Fight) !== 0 &&
        (sim.tasks[e]?.count ?? 1) === 0 &&
        Math.hypot(sim.pos.f.x[e] - (this.spawn.x + 0.5) * TILE, sim.pos.f.y[e] - (this.spawn.y + 0.5) * TILE) > BOT_STAGING_RADIUS * TILE,
    );
    const goal = idle.length ? this.target() : undefined;
    if (!goal) return;
    for (const e of idle) {
      try {
        sim.issueCommand(this.owner, e, TaskType.Attack, goal.x, goal.y, -1, false);
      } catch (err) {
        if (!(err instanceof CommandError)) throw err;
      }
    }
  }

  /** The enemy building closest to the spawn point, or failing that their nearest unit (tile coordinates). */
  private target(): { x: number; y: number } | undefined {
    const sim = this.sim;
    const ox = (this.spawn.x + 0.5) * TILE;
    const oy = (this.spawn.y + 0.5) * TILE;
    let best: number | undefined;
    let bestScore = Infinity;
    for (const e of sim.unit.dense) {
      if (!this.enemies.has(sim.unit.f.owner[e]) || sim.isSite(e)) continue;
      const score = Math.hypot(sim.pos.f.x[e] - ox, sim.pos.f.y[e] - oy) + (sim.stats(e).structure ? 0 : 1000 * TILE);
      if (score < bestScore) {
        best = e;
        bestScore = score;
      }
    }
    return best === undefined ? undefined : { x: sim.tileX(sim.pos.f.x[best]), y: sim.tileY(sim.pos.f.y[best]) };
  }
}

/** Where a corner's units appear: its clear patch on the way out of the base (see `clearAreas` in map.ts). */
export function hordeSpawnTile(corner: Corner, width: number, height: number): { x: number; y: number } {
  return { x: corner.flipX ? width - 16 : 16, y: corner.flipY ? height - 16 : 16 };
}

/** Gives `owner` the horde: its classes (announce them so clients can draw the units) and a spawner at `corner`. */
export function setUpHorde(
  sim: Simulation,
  owner: number,
  corner: Corner,
  enemy: number,
  /** Tile the groups appear at, instead of the corner's own spawn tile (maps made for the horde name one). */
  at?: { readonly x: number; readonly y: number },
): { horde: HordeSpawner; classes: Blueprint[] } {
  const units = botUnitClasses(sim).map((cls) => ({ cls, bp: defineClass(sim, owner, cls) }));
  sim.cheaters.add(owner);
  const spawn = at ?? hordeSpawnTile(corner, sim.config.width, sim.config.height);
  return { horde: new HordeSpawner(sim, owner, enemy, spawn, units), classes: units.map((u) => u.bp) };
}
