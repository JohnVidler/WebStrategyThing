import { CompileError } from '../vm/compiler';
import type { ProgramButton } from '../vm/types';
import { FAULT_NAMES } from '../vm/vm';
import { BlueprintError } from './blueprint';
import { SCOUT_CLASS } from './content';
import { SimEvent } from './events';
import { CORNERS, createMatch, defineClass, setUpPlayer } from './map';
import { TILE } from './parts';
import { CommandError } from './simulation';
import { TaskType } from './tasks';

/*
 * Scratch test runs for the designer: a private, throwaway simulation with the
 * player's starter base in one corner and one instance of the class being
 * designed, stepped for a few hundred ticks. Nothing touches the real match.
 */

export interface TestRunOptions {
  /** Ticks to simulate (10 per second of game time). Default 300. */
  readonly ticks?: number;
  /** Put an enemy scout a few tiles away. */
  readonly enemy?: boolean;
  /** A player order given at the start. */
  readonly order?: 'none' | 'move' | 'attack';
  readonly seed?: number;
}

export interface TestSample {
  readonly tick: number;
  /** Tile coordinates. */
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  /** Energy, percent of capacity. */
  readonly energy: number;
  readonly cpu: string;
  readonly cycles: number;
  readonly tasks: number;
  readonly cargo: number;
}

export interface TestRunResult {
  /** Set when the design or program was rejected (nothing ran). */
  readonly error?: string;
  readonly samples: TestSample[];
  readonly notes: string[];
  readonly buttons: readonly ProgramButton[];
}

const CPU_STATE_NAMES = ['running', 'asleep', 'no power', 'offline', 'stunned'];
const SAMPLE_EVERY = 10;

export function testRun(parts: readonly string[], source: string, options: TestRunOptions = {}): TestRunResult {
  const ticks = Math.min(3000, Math.max(1, options.ticks ?? 300));
  const sim = createMatch(options.seed ?? 1);
  setUpPlayer(sim, 1, CORNERS[0], 500);
  let e: number;
  let buttons: readonly ProgramButton[] = [];
  try {
    const bp = sim.blueprints.define(1, 'Test subject', parts);
    if (source.trim()) buttons = sim.setProgram(bp.id, source).buttons;
    if (bp.stats.structure) {
      const spot = freeSpot(sim, bp.stats.footprint);
      if (!spot) return { error: 'No room for the building in the sandbox', samples: [], notes: [], buttons };
      e = sim.spawnStructure(bp, spot[0], spot[1]);
    } else {
      e = sim.spawnUnit(bp, 14 * TILE + TILE / 2, 11 * TILE + TILE / 2);
    }
  } catch (err) {
    if (err instanceof BlueprintError || err instanceof CompileError || err instanceof CommandError) {
      return { error: err.message, samples: [], notes: [], buttons };
    }
    throw err;
  }

  const notes: string[] = [];
  let enemy = -1;
  if (options.enemy || options.order === 'attack') {
    const scout = defineClass(sim, 2, SCOUT_CLASS);
    enemy = sim.spawnUnit(scout, sim.pos.f.x[e] + 6 * TILE, sim.pos.f.y[e] + 2 * TILE);
  }
  const at = (v: number) => Math.round((v / TILE) * 10) / 10;
  try {
    if (options.order === 'move') {
      sim.issueOrder(1, e, 32, 32, -1, false);
      notes.push('Ordered: MOVE to tile 32,32 (urgent).');
    } else if (options.order === 'attack') {
      sim.issueCommand(1, e, TaskType.Attack, 0, 0, enemy, false);
      notes.push('Ordered: ATTACK the enemy scout (urgent).');
    }
  } catch (err) {
    if (!(err instanceof CommandError)) throw err;
    notes.push(`The order was refused: ${err.message}.`);
  }

  const samples: TestSample[] = [];
  const s = sim.stats(e);
  let faults = 0;
  let lastFault = '';
  let shots = 0;
  let cycles = 0;
  let flatAt = -1;
  let diedAt = -1;
  let enemyDiedAt = -1;
  const startX = sim.pos.f.x[e];
  const startY = sim.pos.f.y[e];
  let travelled = 0;
  let px = startX;
  let py = startY;
  const sample = (tick: number) =>
    samples.push({
      tick,
      x: at(sim.pos.f.x[e]),
      y: at(sim.pos.f.y[e]),
      hp: sim.health.f.hp[e],
      energy: s.energyCapacity ? Math.round((100 * sim.energy.f.amount[e]) / s.energyCapacity) : 0,
      cpu: CPU_STATE_NAMES[sim.cpu.f.state[e]] ?? '?',
      cycles: sim.cpu.f.used[e],
      tasks: sim.tasks[e]?.count ?? 0,
      cargo: sim.cargo.has(e) ? sim.cargo.f.amount[e] : 0,
    });
  sample(0);
  for (let t = 1; t <= ticks; t++) {
    sim.step();
    const ev = sim.events;
    for (let i = 0; i < ev.length; i += 3) {
      if (ev[i] === SimEvent.Shot && ev[i + 1] === e) shots++;
      if (ev[i] === SimEvent.Death && ev[i + 1] === enemy && enemyDiedAt < 0) enemyDiedAt = t;
    }
    if (!sim.world.isAlive(e)) {
      diedAt = t;
      sim.commit();
      break;
    }
    if (sim.cpu.f.fault[e]) {
      faults++;
      lastFault = FAULT_NAMES[sim.cpu.f.fault[e]] ?? 'fault';
    }
    cycles += sim.cpu.f.used[e];
    if (flatAt < 0 && s.energyCapacity && sim.energy.f.amount[e] <= 0) flatAt = t;
    travelled += Math.hypot(sim.pos.f.x[e] - px, sim.pos.f.y[e] - py);
    px = sim.pos.f.x[e];
    py = sim.pos.f.y[e];
    if (t % SAMPLE_EVERY === 0) sample(t);
    sim.commit();
  }

  const ran = diedAt > 0 ? diedAt : ticks;
  notes.push(`Simulated ${ran} ticks (${(ran / 10).toFixed(1)}s of game time).`);
  if (s.cyclesPerTick) notes.push(`CPU: ${(cycles / ran).toFixed(1)} of ${s.cyclesPerTick} cycles per tick on average.`);
  else notes.push('No CPU: the program never runs.');
  if (!s.structure) notes.push(`Travelled ${at(travelled)} tiles; ended ${at(Math.hypot(px - startX, py - startY))} tiles from the start.`);
  if (shots) notes.push(`Fired ${shots} shot(s).`);
  if (enemyDiedAt > 0) notes.push(`The enemy scout was destroyed at tick ${enemyDiedAt}.`);
  if (faults) notes.push(`⚠ Faulted ${faults} time(s) (last: ${lastFault}). Each fault reboots the program.`);
  if (flatAt > 0) notes.push(`⚠ Ran out of energy at tick ${flatAt}.`);
  if (diedAt > 0) notes.push(`⚠ Destroyed at tick ${diedAt}.`);
  return { samples, notes, buttons };
}

/** A free spot for a building near the starting base (top-left corner). */
function freeSpot(sim: ReturnType<typeof createMatch>, size: number): [number, number] | null {
  for (let r = 0; r < 20; r++) {
    for (let y = 12 - r; y <= 12 + r; y++) {
      for (let x = 12 - r; x <= 12 + r; x++) {
        if (x >= 1 && y >= 1 && sim.terrain.footprintFree(x, y, size)) return [x, y];
      }
    }
  }
  return null;
}
