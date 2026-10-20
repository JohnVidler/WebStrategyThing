/** Maximum number of arguments a host builtin may take. */
export const MAX_ARGS = 8;

/**
 * What a call is, which decides where it may appear and how the editor shows it:
 *  - query: reads state (may cost energy, e.g. a scan); usable inside expressions;
 *  - action: a one-shot effect now; a statement (its result can be bound with `const`);
 *  - config: a runtime standing setting of a module or the CPU; a statement, written `config.name(...)`.
 */
export type CallKind = 'query' | 'action' | 'config';

/** The compile-time view of a host builtin: enough to resolve names and check arity. */
export interface BuiltinSig {
  readonly name: string;
  readonly argc: number;
  readonly kind: CallKind;
  /** Extra cycles charged when the call runs, on top of its node and arc costs. */
  readonly cost: number;
  readonly doc?: string;
  /**
   * Long-running (latent) calls: the engine carries the job out and reports how it ended. The names are the
   * outcomes a program can attach chains to (`harvest(field, { full: () => { ... } })`), in display order.
   */
  readonly outcomes?: readonly string[];
  /** Indices of the arguments that are text in quotes rather than numbers (`alert("hi", 2000)`). */
  readonly text?: readonly number[];
  /** Cycles spent in this builtin are not billed as CPU energy (e.g. rest). */
  readonly free?: boolean;
  /** Documentation metadata. */
  readonly group?: string;
  readonly args?: readonly string[];
}

/** A host function exposed to programs. Flow knows nothing about the game; it only calls these. */
export interface Builtin<Ctx> extends BuiltinSig {
  readonly fn: (ctx: Ctx, args: Int32Array) => number;
}

export type HostApi<Ctx> = readonly Builtin<Ctx>[];

/** Everything the compiler needs to know about the host. */
export interface FlowHost {
  readonly api: readonly BuiltinSig[];
  /** Named integer constants (MOVE, ENEMY, ...). */
  readonly constants: ReadonlyMap<string, number>;
  /** Hotkeys that Button blocks may not use, with what uses them. */
  readonly reservedKeys?: ReadonlyMap<string, string>;
}
