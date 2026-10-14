/** Maximum number of arguments a host builtin may take. */
export const MAX_ARGS = 8;

/** The compile-time view of a host builtin: enough to resolve names and check arity. */
export interface BuiltinSig {
  readonly name: string;
  readonly argc: number;
  /** Extra cycles charged on top of the 1-cycle CALL dispatch. */
  readonly cost: number;
  readonly doc?: string;
  /** Cycles spent calling this builtin are not billed as CPU energy (e.g. sleep). */
  readonly free?: boolean;
  /** Documentation metadata. */
  readonly group?: string;
  readonly args?: readonly string[];
}

/**
 * A host function exposed to unit scripts. The VM knows nothing about the
 * game; all game interaction goes through a HostApi supplied by the caller.
 */
export interface Builtin<Ctx> extends BuiltinSig {
  readonly fn: (ctx: Ctx, args: Int32Array) => number;
}

export type HostApi<Ctx> = readonly Builtin<Ctx>[];

/**
 * Compiled bytecode. Immutable and shared by every unit of a class
 * (the flyweight's intrinsic state); per-unit state lives in VmState.
 */
export interface Program {
  readonly code: Int32Array;
  /** Number of memory slots the program needs. */
  readonly slots: number;
  /** Boot values for each slot. */
  readonly init: Int32Array;
  readonly names: readonly string[];
  readonly source: string;
  /** UI buttons declared with `button` (player-facing metadata; no code). */
  readonly buttons: readonly ProgramButton[];
}

/**
 * A player-facing action button declared by a program:
 *   button name "Label" [key "K"] [aim]
 * `name` becomes a compile-time constant (the task type pushed when the button is pressed).
 */
export interface ProgramButton {
  readonly name: string;
  readonly label: string;
  /** Hotkey: one upper-case letter, or ''. */
  readonly key: string;
  /** The player picks a point or unit on the map after pressing it. */
  readonly aim: boolean;
  /** Task type pushed onto the unit's queue. */
  readonly task: number;
}
