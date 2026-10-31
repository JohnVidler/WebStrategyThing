/**
 * The cycle cost of running a program, in one place so it is easy to rebalance. Defined on
 * the IR (nodes executed and wires followed), never on bytecode or on a view, so a graph
 * and its text cost exactly the same.
 *
 * An event with no handler costs nothing (it is never queued). Inside a handler:
 *  - every statement that runs costs its node (`NODE`) plus the exec wire that led to it (`ARC`);
 *    a branch not taken costs nothing;
 *  - every expression feeding a wire costs the wire (`ARC`) plus its node (`NODE`), operands included;
 *  - inline literals and named constants are free (they are pin defaults, not nodes);
 *  - reading an event parameter or a call result is just the wire (`ARC`);
 *  - a call adds the builtin's own `cost` when it runs (e.g. a scan).
 */
export const COST = {
  /** A node that runs. */
  NODE: 1,
  /** A wire followed. */
  ARC: 1,
  /** Cycles one handler may run in total before it faults (guards runaway loops). */
  HANDLER_LIMIT: 4096,
} as const;

/** Cost of a statement that runs: its node and the exec wire into it. */
export const STATEMENT_COST = COST.NODE + COST.ARC;
/** Cost of a node whose output feeds a wire. */
export const WIRED_NODE_COST = COST.NODE + COST.ARC;
/** Cost of reading a variable (a Get Variable node on a wire). */
export const VARIABLE_READ_COST = COST.NODE + COST.ARC;
/** Cost of reading an event parameter or call result (just the wire). */
export const LOCAL_READ_COST = COST.ARC;

/**
 * Lists exist only inside a chain (`findResources(10).filter(r => ...).first()`). They hold at most this many
 * entries (a source keeps the nearest ones), so a chain's cost is bounded: each step visits each entry at
 * most once, at `LIST_ELEMENT_COST` plus whatever its function costs.
 */
export const LIST_MAX = 32;
/** Cost of visiting one list entry in a step (the node and the wire into its function). */
export const LIST_ELEMENT_COST = WIRED_NODE_COST;
/** Most steps one chain may have after its source. */
export const MAX_CHAIN_STEPS = 8;

/** Literals that take no memory slot, so trivial programs fit a bare chassis (decision P1). */
export const FREE_LITERALS: ReadonlySet<number> = new Set([-1, 0, 1]);
