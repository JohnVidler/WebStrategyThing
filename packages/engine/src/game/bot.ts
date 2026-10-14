import type { Blueprint } from './blueprint';
import { CommandError, type Simulation } from './simulation';
import { FIGHTER_PROGRAM, LASER_TURRET_CLASS, type ClassTemplate } from './content';
import { flip, defineClass, type Corner } from './map';
import {
  BOT_FIRST_WAVE_TICKS,
  BOT_MAX_UNITS,
  BOT_QUEUE_DEPTH,
  BOT_THINK_TICKS,
  BOT_WAVE_BASE_SIZE,
  BOT_WAVE_GROWTH,
  BOT_WAVE_INTERVAL_TICKS,
  BOT_STAGING_RADIUS,
  TILE,
} from './rules';
import { Caps } from './blueprint';
import { TaskType } from './tasks';

/**
 * Co-op-mode opponents. A bot owns a small fortified base whose assemblers
 * build each wave's units on demand; it never mines (the simulation keeps its energy and
 * silos full, see Simulation.cheaters) and sends its staged units at its human
 * opponent in waves that grow over time.
 */

/** The bot's headquarters: silos for production, no factory of its own. */
export const BOT_CORE_CLASS: ClassTemplate = {
  name: 'Bot Core',
  parts: ['frame.large', 'sensor.long', 'silo', 'silo', 'battery.bank', 'armor.plate', 'armor.plate', 'armor.plate'],
  program: '',
};

/** The special building: produces units continuously for as long as the match runs. */
export const BOT_ASSEMBLER_CLASS: ClassTemplate = {
  name: 'Assembler',
  parts: ['frame.medium', 'factory.basic', 'battery.cell', 'armor.plate', 'armor.plate'],
  program: '',
};

/** A bot unit class and the wave it first appears in (wave 0 is the first). */
export interface BotUnitClass extends ClassTemplate {
  readonly fromWave: number;
}

export const BOT_UNIT_CLASSES: readonly BotUnitClass[] = [
  { name: 'Grunt', fromWave: 0, parts: ['chassis.light', 'cpu.basic', 'motor.small', 'sensor.short', 'gun.light'], program: FIGHTER_PROGRAM },
  { name: 'Wasp', fromWave: 1, parts: ['chassis.light', 'cpu.basic', 'rotor', 'sensor.short', 'gun.light'], program: FIGHTER_PROGRAM },
  { name: 'Lancer', fromWave: 2, parts: ['chassis.medium', 'cpu.basic', 'motor.small', 'sensor.short', 'laser.beam', 'armor.plate'], program: FIGHTER_PROGRAM },
  { name: 'Bulwark', fromWave: 3, parts: ['chassis.heavy', 'cpu.basic', 'motor.large', 'sensor.short', 'gun.light', 'armor.plate', 'armor.plate'], program: FIGHTER_PROGRAM },
];

/** Base layout for the top-left corner; setUpBot mirrors it for other corners. Tiles, top-left of each building. */
const BOT_LAYOUT: readonly { cls: ClassTemplate; x: number; y: number }[] = [
  { cls: BOT_CORE_CLASS, x: 6, y: 6 },
  { cls: BOT_ASSEMBLER_CLASS, x: 10, y: 5 },
  { cls: BOT_ASSEMBLER_CLASS, x: 10, y: 8 },
  { cls: BOT_ASSEMBLER_CLASS, x: 6, y: 10 },
  { cls: LASER_TURRET_CLASS, x: 13, y: 6 },
  { cls: LASER_TURRET_CLASS, x: 13, y: 9 },
];

export class BotPlayer {
  private wave = 0;
  private nextWave = BOT_FIRST_WAVE_TICKS;
  private rotation = 0;

  constructor(
    private readonly sim: Simulation,
    readonly owner: number,
    /** The human this bot is practice for. */
    readonly enemy: number,
    private readonly units: readonly { cls: BotUnitClass; bp: Blueprint }[],
  ) {}

  /** Number of waves already sent. */
  get wavesSent(): number {
    return this.wave;
  }

  /** Call once per tick, before Simulation.step(). */
  step(): void {
    if (this.sim.tick % BOT_THINK_TICKS !== 0) return;
    this.produce();
    this.dispatch();
    this.press();
  }

  private mobile(): number[] {
    const sim = this.sim;
    return sim.unit.dense.filter((e) => sim.unit.f.owner[e] === this.owner && sim.motion.has(e));
  }

  /** Units the upcoming wave needs: small at first, growing a little each wave. */
  private waveSize(): number {
    return Math.min(BOT_MAX_UNITS, BOT_WAVE_BASE_SIZE + BOT_WAVE_GROWTH * this.wave);
  }

  /** Fighters waiting idle, ready to be sent. */
  private staged(): number[] {
    const sim = this.sim;
    return this.mobile().filter((e) => (sim.stats(e).caps & Caps.Fight) !== 0 && (sim.tasks[e]?.count ?? 1) === 0);
  }

  /** Builds only as many units as the upcoming wave needs (staged and queued units count), then stops. */
  private produce(): void {
    const sim = this.sim;
    const unlocked = this.units.filter((u) => u.cls.fromWave <= this.wave);
    let queued = 0;
    for (const b of sim.unit.dense) {
      if (sim.unit.f.owner[b] === this.owner && !sim.isSite(b) && sim.stats(b).factory) queued += sim.productionQueue[b]?.length ?? 0;
    }
    let room = Math.min(this.waveSize() - this.staged().length, BOT_MAX_UNITS - this.mobile().length) - queued;
    if (room <= 0) return;
    for (const b of sim.unit.dense) {
      if (sim.unit.f.owner[b] !== this.owner || sim.isSite(b) || !sim.stats(b).factory) continue;
      const queue = sim.productionQueue[b];
      if (!queue) continue;
      while (queue.length < BOT_QUEUE_DEPTH && room > 0) {
        const pick = unlocked[this.rotation++ % unlocked.length];
        try {
          sim.enqueueProduction(this.owner, b, pick.bp.id);
          room--;
        } catch (err) {
          if (!(err instanceof CommandError)) throw err;
          break;
        }
      }
    }
  }

  /** When the wave is due and enough units are staged, sends every idle fighter to attack-move onto the enemy. */
  private dispatch(): void {
    const sim = this.sim;
    if (sim.tick < this.nextWave) return;
    const staged = this.staged();
    if (staged.length < this.waveSize()) return;
    const goal = this.target();
    if (!goal) return;
    for (const e of staged) {
      try {
        sim.issueCommand(this.owner, e, TaskType.Attack, goal.x, goal.y, -1, false);
      } catch (err) {
        if (!(err instanceof CommandError)) throw err;
      }
    }
    this.wave++;
    this.nextWave = sim.tick + BOT_WAVE_INTERVAL_TICKS;
  }

  /** Fighters that finished a push and sit idle away from home go straight on to the next target. */
  private press(): void {
    const sim = this.sim;
    if (this.wave === 0) return;
    const home = this.home();
    const idle = this.mobile().filter(
      (e) =>
        (sim.stats(e).caps & Caps.Fight) !== 0 &&
        (sim.tasks[e]?.count ?? 1) === 0 &&
        Math.hypot(sim.pos.f.x[e] - home.x, sim.pos.f.y[e] - home.y) > BOT_STAGING_RADIUS * TILE,
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

  /** Centre of the bot's own buildings (sub-tile units). */
  private home(): { x: number; y: number } {
    const sim = this.sim;
    let x = 0, y = 0, n = 0;
    for (const e of sim.unit.dense) {
      if (sim.unit.f.owner[e] !== this.owner || !sim.stats(e).structure) continue;
      x += sim.pos.f.x[e];
      y += sim.pos.f.y[e];
      n++;
    }
    return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
  }

  /** The enemy building closest to the bot's own base, or failing that their nearest unit (tile coordinates). */
  private target(): { x: number; y: number } | undefined {
    const sim = this.sim;
    const { x: ox, y: oy } = this.home();
    let best: number | undefined;
    let bestScore = Infinity;
    for (const e of sim.unit.dense) {
      if (sim.unit.f.owner[e] !== this.enemy || sim.isSite(e)) continue;
      const d = Math.hypot(sim.pos.f.x[e] - ox, sim.pos.f.y[e] - oy);
      const score = d + (sim.stats(e).structure ? 0 : 1000 * TILE);
      if (score < bestScore) {
        best = e;
        bestScore = score;
      }
    }
    return best === undefined ? undefined : { x: sim.tileX(sim.pos.f.x[best]), y: sim.tileY(sim.pos.f.y[best]) };
  }
}

/** Gives `owner` a bot base in `corner` and returns its controller and the classes to announce. */
export function setUpBot(sim: Simulation, owner: number, corner: Corner, enemy: number): { bot: BotPlayer; classes: Blueprint[] } {
  const { width, height } = sim.config;
  const classes = new Map<ClassTemplate, Blueprint>();
  for (const c of [BOT_CORE_CLASS, BOT_ASSEMBLER_CLASS, LASER_TURRET_CLASS, ...BOT_UNIT_CLASSES]) classes.set(c, defineClass(sim, owner, c));
  for (const entry of BOT_LAYOUT) {
    const bp = classes.get(entry.cls)!;
    const size = bp.stats.footprint;
    sim.spawnStructure(bp, flip(corner.flipX, entry.x, size, width), flip(corner.flipY, entry.y, size, height));
  }
  sim.cheaters.add(owner);
  for (const b of sim.stockpile.dense) if (sim.unit.f.owner[b] === owner) sim.addStock(b, sim.stats(b).resourceCapacity);
  const units = BOT_UNIT_CLASSES.map((cls) => ({ cls, bp: classes.get(cls)! }));
  return { bot: new BotPlayer(sim, owner, enemy, units), classes: [...classes.values()] };
}
