/*
 * Developer commands: the Dev Options menu of a development build (see client/src/devTools.ts) sends these
 * to a server started with WST_DEV_TOOLS=1. A production server refuses them all, and the client menu is
 * not compiled into a production build.
 */

/** How a dev "end the match" button ends it. */
export type DevOutcome = 'win' | 'win-last-player' | 'win-no-power' | 'loss' | 'loss-no-power' | 'draw';

export const DEV_OUTCOMES: readonly DevOutcome[] = ['win', 'win-last-player', 'win-no-power', 'loss', 'loss-no-power', 'draw'];

/** What to remove near a point: any mix of units, buildings and resource fields. */
export interface DevRemoveScope {
  readonly units: boolean;
  readonly buildings: boolean;
  readonly resources: boolean;
}

export type DevCommand =
  /** Fog of war on or off for everyone in the room. */
  | { kind: 'fog'; on: boolean }
  /** Spawn `count` of the starter class `template` for `owner` (0 = neutral) around tile (x, y), fully built and charged. */
  | { kind: 'spawn'; owner: number; template: string; x: number; y: number; count: number }
  /** A matter field (neutral) at tile (x, y). */
  | { kind: 'field'; x: number; y: number; amount: number }
  /** Matter into the owner's silos (as far as they have room). */
  | { kind: 'give'; owner: number; amount: number }
  /** Remove things within `r` tiles of (x, y); `owner` -1 means anyone's. */
  | { kind: 'remove'; x: number; y: number; r: number; owner: number; scope: DevRemoveScope }
  /** Destroy everything an owner has (0 = neutral units and buildings). */
  | { kind: 'clear'; owner: number }
  /** Full health, repaired modules and full energy for an owner's forces (-1 = everyone's). */
  | { kind: 'heal'; owner: number }
  /** Finish every construction site of an owner (-1 = everyone's) without paying for it. */
  | { kind: 'finish'; owner: number }
  /** Stop or resume the simulation; the "disconnect" kind shows the waiting-for-a-player notice instead. */
  | { kind: 'pause'; mode: 'off' | 'dev' | 'disconnect' }
  /** End the match now with the given outcome, for the sender's side. */
  | { kind: 'end'; outcome: DevOutcome }
  /** The sender is out: shows the defeat choice (spectate or leave) without ending the match. */
  | { kind: 'defeat' }
  /** Let the normal victory check end the match again after a dev "end". */
  | { kind: 'reopen' };

export const DEV_LIMITS = { spawnCount: 50, removeRadius: 200, amount: 1_000_000, coordinate: 4096 } as const;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const inRange = (v: unknown, lo: number, hi: number): v is number => isInt(v) && v >= lo && v <= hi;
const isTile = (v: unknown): v is number => inRange(v, 0, DEV_LIMITS.coordinate);

/** Validates a dev command from a socket; null if malformed. */
export function parseDevCommand(raw: unknown): DevCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.kind) {
    case 'fog':
      return typeof m.on === 'boolean' ? { kind: 'fog', on: m.on } : null;
    case 'spawn':
      if (!inRange(m.owner, 0, 1_000_000) || typeof m.template !== 'string' || m.template.length > 64) return null;
      if (!isTile(m.x) || !isTile(m.y) || !inRange(m.count, 1, DEV_LIMITS.spawnCount)) return null;
      return { kind: 'spawn', owner: m.owner, template: m.template, x: m.x, y: m.y, count: m.count };
    case 'field':
      if (!isTile(m.x) || !isTile(m.y) || !inRange(m.amount, 1, 0xffff)) return null;
      return { kind: 'field', x: m.x, y: m.y, amount: m.amount };
    case 'give':
      if (!inRange(m.owner, 0, 1_000_000) || !inRange(m.amount, 1, DEV_LIMITS.amount)) return null;
      return { kind: 'give', owner: m.owner, amount: m.amount };
    case 'remove': {
      const scope = m.scope as Record<string, unknown> | null;
      if (!isTile(m.x) || !isTile(m.y) || !inRange(m.r, 1, DEV_LIMITS.removeRadius) || !inRange(m.owner, -1, 1_000_000)) return null;
      if (typeof scope !== 'object' || scope === null) return null;
      return { kind: 'remove', x: m.x, y: m.y, r: m.r, owner: m.owner, scope: { units: scope.units === true, buildings: scope.buildings === true, resources: scope.resources === true } };
    }
    case 'clear':
      return inRange(m.owner, 0, 1_000_000) ? { kind: 'clear', owner: m.owner } : null;
    case 'heal':
    case 'finish':
      return inRange(m.owner, -1, 1_000_000) ? { kind: m.kind, owner: m.owner } : null;
    case 'pause':
      return m.mode === 'off' || m.mode === 'dev' || m.mode === 'disconnect' ? { kind: 'pause', mode: m.mode } : null;
    case 'end':
      return typeof m.outcome === 'string' && (DEV_OUTCOMES as readonly string[]).includes(m.outcome) ? { kind: 'end', outcome: m.outcome as DevOutcome } : null;
    case 'defeat':
    case 'reopen':
      return { kind: m.kind };
    default:
      return null;
  }
}
