import type { BlueprintInfo } from '../game/blueprint';
import { MAX_DESIGNS, type DesignEntry } from '../game/designs';

export const TICK_RATE = 10;
export const DEFAULT_PORT = 8080;

/*
 * Two channels over one WebSocket:
 *  - binary frames: per-tick world deltas (see codec.ts), server -> client only
 *  - text frames:   rare, low-volume control messages as JSON (below)
 *
 * Entities are referenced by index on the wire; the server re-validates
 * ownership and liveness when it applies each command at the next tick.
 */

export type ClientMessage =
  /** Display name for the scoreboard (the server trims and shortens it). */
  | { t: 'setName'; name: string }
  /** Leave the match immediately instead of entering the reconnect grace period. */
  | { t: 'resign' }
  | { t: 'defineBlueprint'; name: string; parts: string[] }
  | { t: 'setProgram'; blueprint: number; source: string }
  /**
   * Make the player's classes match this set (session restore, uploaded file, or
   * reset to defaults). See Simulation.loadDesigns.
   */
  | { t: 'loadDesigns'; classes: DesignEntry[]; reason: 'session' | 'upload' | 'reset'; merge?: boolean }
  /** Retire (or restore) an own class. */
  | { t: 'retireClass'; blueprint: number; retired: boolean }
  /** Right-click: x/y in tiles, target entity index or -1, queue = queue modifier held. */
  | { t: 'order'; units: number[]; x: number; y: number; target: number; queue: boolean }
  | { t: 'stop'; units: number[]; queue: boolean }
  /** A common action button (task = its TaskType); x/y/target as for 'order' when it is aimed. */
  | { t: 'command'; units: number[]; task: number; x: number; y: number; target: number; queue: boolean }
  /** A class-declared button, by name: applies to the units whose class declares it. */
  | { t: 'button'; units: number[]; name: string; x: number; y: number; target: number; queue: boolean }
  | { t: 'produce'; building: number; blueprint: number }
  /** Switch module `index` on or off on each unit. */
  | { t: 'setModule'; units: number[]; index: number; on: boolean }
  /** Demolish own buildings (cancel sites): refunds go to the common pool. */
  | { t: 'demolish'; units: number[] }
  /** Place a building blueprint with its top-left on tile (x, y); `builders` get a BUILD task. */
  | { t: 'place'; blueprint: number; x: number; y: number; builders: number[]; queue: boolean };

export type ServerMessage =
  | {
      t: 'welcome';
      playerId: number;
      tickRate: number;
      width: number;
      height: number;
      /** Needed to reproduce wind locally. */
      seed: number;
      /** Terrain.encode(): '1' passable, '0' blocked, row-major. */
      terrain: string;
      /** Fog of war: the client only receives what its units and buildings can see. */
      fog: boolean;
    }
  | { t: 'blueprints'; list: BlueprintInfo[] }
  /** Program source is only ever sent to the class owner. */
  | { t: 'program'; blueprint: number; source: string }
  | { t: 'programResult'; blueprint: number; ok: boolean; error?: string }
  /** The common pool: resources in all the player's silos, and their total capacity. */
  | { t: 'credits'; amount: number; capacity: number }
  /**
   * Full task queues of the player's own units whose queues changed:
   * [entity, type, x, y, targetEntity, type, x, y, targetEntity, ...] per unit.
   * Only ever sent to the owner.
   */
  | { t: 'tasks'; updates: number[][] }
  /** The player's own power networks (sent only to the owner, when they change). */
  | { t: 'networks'; list: NetworkInfo[] }
  /**
   * A radar pulse by the player or an ally: the non-allied units and buildings it
   * found, as [x, y, owner, structure(0/1), blueprint] in sub-tile units. Shown as fading blips.
   */
  | { t: 'radar'; x: number; y: number; range: number; contacts: number[][] }
  /** Every present player's score and tallies (broadcast to all, when they change). */
  | { t: 'scoreboard'; players: ScoreEntry[] }
  /** The game is stopped for these reasons; away players include their reconnect deadline. */
  | { t: 'pause'; reasons: string[]; away: { name: string; remainingMs: number }[] }
  /** A resignation has been accepted and the player is being removed immediately. */
  | { t: 'resigned' }
  /** Sent once when the match has a winner: `winner` is their player id. In team matches `winners` lists every winning side (the humans, or the bots). */
  | { t: 'matchOver'; winner: number; reason: MatchEndReason; standings: ScoreEntry[]; winners?: number[] }
  /** Result of a loadDesigns request. */
  | { t: 'designsLoaded'; reason: 'session' | 'upload' | 'reset'; defined: number; updated: number; retired: number; errors: string[] }
  | { t: 'error'; message: string };

/**
 * Why a match ended: every other side was destroyed, every other player left,
 * or only one player still has powered (non-zero energy) units.
 */
export type MatchEndReason = 'eliminated' | 'last-player' | 'no-power';

/** One player's line on the scoreboard. */
export interface ScoreEntry {
  readonly id: number;
  readonly name: string;
  /** No units or buildings left. */
  readonly eliminated: boolean;
  /** Stored resources plus the cost of finished buildings and living units. */
  readonly score: number;
  readonly createdUnits: number;
  readonly createdBuildings: number;
  readonly lostUnits: number;
  readonly lostBuildings: number;
  readonly destroyedUnits: number;
  readonly destroyedBuildings: number;
}

/** Owner-only summary of one power network. */
export interface NetworkInfo {
  /** Member buildings (entity indices). */
  readonly members: number[];
  /** Generated last tick. */
  readonly supply: number;
  /** Wanted by normal consumers last tick. */
  readonly demand: number;
  readonly stored: number;
  readonly capacity: number;
  /** A finished silo is on the network (sites on it draw from the common pool). */
  readonly depot: boolean;
  /** Per member: energy taken from the network last tick minus energy given (sources negative). */
  readonly flow: readonly number[];
}

export const LIMITS = {
  nameLength: 24,
  partsPerClass: 32,
  sourceLength: 8000,
  unitsPerOrder: 200,
} as const;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isUnitList = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.length <= LIMITS.unitsPerOrder && v.every((e) => isInt(e) && e >= 0);

/** Validates untrusted input from a socket. Returns null if malformed. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'setName':
      if (typeof m.name !== 'string') return null;
      return { t: m.t, name: m.name.slice(0, 64) };
    case 'resign':
      return { t: m.t };
    case 'defineBlueprint':
      if (typeof m.name !== 'string' || m.name.length < 1 || m.name.length > LIMITS.nameLength) return null;
      if (!Array.isArray(m.parts) || m.parts.length > LIMITS.partsPerClass) return null;
      if (!m.parts.every((p) => typeof p === 'string')) return null;
      return { t: m.t, name: m.name, parts: m.parts as string[] };
    case 'setProgram':
      if (!isInt(m.blueprint) || typeof m.source !== 'string' || m.source.length > LIMITS.sourceLength) return null;
      return { t: m.t, blueprint: m.blueprint, source: m.source };
    case 'loadDesigns': {
      if (!Array.isArray(m.classes) || m.classes.length > MAX_DESIGNS) return null;
      if (m.reason !== 'session' && m.reason !== 'upload' && m.reason !== 'reset') return null;
      const classes: DesignEntry[] = [];
      for (const c of m.classes as Record<string, unknown>[]) {
        if (typeof c !== 'object' || c === null) return null;
        if (typeof c.name !== 'string' || c.name.length < 1 || c.name.length > LIMITS.nameLength) return null;
        if (!Array.isArray(c.parts) || c.parts.length > LIMITS.partsPerClass || !c.parts.every((p) => typeof p === 'string')) return null;
        if (typeof c.program !== 'string' || c.program.length > LIMITS.sourceLength) return null;
        classes.push({ name: c.name, parts: c.parts as string[], program: c.program, retired: c.retired === true });
      }
      return { t: m.t, classes, reason: m.reason, merge: m.merge === true };
    }
    case 'retireClass':
      if (!isInt(m.blueprint) || typeof m.retired !== 'boolean') return null;
      return { t: m.t, blueprint: m.blueprint, retired: m.retired };
    case 'order':
      if (!isUnitList(m.units) || !isInt(m.x) || !isInt(m.y) || !isInt(m.target)) return null;
      return { t: m.t, units: m.units, x: m.x, y: m.y, target: m.target, queue: m.queue === true };
    case 'command':
      if (!isUnitList(m.units) || !isInt(m.task) || !isInt(m.x) || !isInt(m.y) || !isInt(m.target)) return null;
      return { t: m.t, units: m.units, task: m.task, x: m.x, y: m.y, target: m.target, queue: m.queue === true };
    case 'button':
      if (!isUnitList(m.units) || typeof m.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(m.name)) return null;
      if (!isInt(m.x) || !isInt(m.y) || !isInt(m.target)) return null;
      return { t: m.t, units: m.units, name: m.name, x: m.x, y: m.y, target: m.target, queue: m.queue === true };
    case 'stop':
      if (!isUnitList(m.units)) return null;
      return { t: m.t, units: m.units, queue: m.queue === true };
    case 'demolish':
      if (!isUnitList(m.units)) return null;
      return { t: m.t, units: m.units };
    case 'produce':
      if (!isInt(m.building) || !isInt(m.blueprint)) return null;
      return { t: m.t, building: m.building, blueprint: m.blueprint };
    case 'place':
      if (!isInt(m.blueprint) || !isInt(m.x) || !isInt(m.y)) return null;
      // Builders are optional: a site can be placed and assigned later.
      if (!Array.isArray(m.builders) || (m.builders.length > 0 && !isUnitList(m.builders))) return null;
      return { t: m.t, blueprint: m.blueprint, x: m.x, y: m.y, builders: m.builders as number[], queue: m.queue === true };
    case 'setModule':
      if (!isUnitList(m.units) || !isInt(m.index) || typeof m.on !== 'boolean') return null;
      return { t: m.t, units: m.units, index: m.index, on: m.on };
    default:
      return null;
  }
}
