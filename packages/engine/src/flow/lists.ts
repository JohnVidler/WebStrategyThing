/**
 * List chains: `findResources(10).filter(r => resource(r) > 50).minBy(r => dist(r))`.
 *
 * A list is the result of a "find" call (a list source: the nearest few things of a kind). It lives only
 * inside the chain that uses it, so a program never stores a list and the VM needs no per-unit list memory:
 * one shared scratch buffer does for every unit, because a chain always runs to the end inside one statement.
 * Steps change the list (filter, map, sortBy, take) and the last step turns it into one number (first, count,
 * minBy, reduce, ...). Functions are written `r => expression`: one expression, no blocks, no nested chains.
 * They are compiled inline as loops, so there are no closures and the cost is plain: every entry visited by a
 * function step costs `LIST_ELEMENT_COST` plus what the function costs, and a list never holds more than
 * `LIST_MAX` entries.
 */

export interface ListOp {
  readonly name: string;
  /** Number of function parameters (`r => ...` is 1, `(acc, r) => ...` is 2); 0 means no function. */
  readonly params: number;
  /** Plain arguments before the function (`take(n)`, `at(i)`, `reduce(start, ...)`). */
  readonly args: number;
  /** True if it ends the chain with one number; false if it passes a list on. */
  readonly terminal: boolean;
  readonly doc: string;
}

export const LIST_OPS: readonly ListOp[] = [
  { name: 'filter', params: 1, args: 0, terminal: false, doc: 'Keeps the entries for which the function is not 0: filter(r => resource(r) > 50).' },
  { name: 'map', params: 1, args: 0, terminal: false, doc: 'Replaces each entry by the function of it: map(r => dist(r)) turns a list of things into a list of distances.' },
  { name: 'sortBy', params: 1, args: 0, terminal: false, doc: 'Orders the list by the function, smallest first (equal ones stay in order): sortBy(r => dist(r)).' },
  { name: 'sortByDesc', params: 1, args: 0, terminal: false, doc: 'Like sortBy, largest first.' },
  { name: 'take', params: 0, args: 1, terminal: false, doc: 'Keeps only the first n entries: take(3).' },
  { name: 'first', params: 0, args: 0, terminal: true, doc: 'The first entry, or -1 if the list is empty.' },
  { name: 'last', params: 0, args: 0, terminal: true, doc: 'The last entry, or -1 if the list is empty.' },
  { name: 'at', params: 0, args: 1, terminal: true, doc: 'The entry at position i (0 is the first), or -1 if there is none.' },
  { name: 'random', params: 0, args: 0, terminal: true, doc: 'A random entry (the same on every replay), or -1 if the list is empty.' },
  { name: 'count', params: 0, args: 0, terminal: true, doc: 'How many entries are in the list.' },
  { name: 'sum', params: 0, args: 0, terminal: true, doc: 'The entries added up (0 if empty). Use map first to add up something about them.' },
  { name: 'min', params: 0, args: 0, terminal: true, doc: 'The smallest entry (0 if empty).' },
  { name: 'max', params: 0, args: 0, terminal: true, doc: 'The largest entry (0 if empty).' },
  { name: 'minBy', params: 1, args: 0, terminal: true, doc: 'The entry for which the function is smallest (the first of equals), or -1 if empty: minBy(r => dist(r)).' },
  { name: 'maxBy', params: 1, args: 0, terminal: true, doc: 'The entry for which the function is largest (the first of equals), or -1 if empty.' },
  { name: 'reduce', params: 2, args: 1, terminal: true, doc: 'Folds the list to one number: reduce(0, (total, r) => total + resource(r)) starts at 0 and passes on what the function returns.' },
];

export const LIST_OP_BY_NAME: ReadonlyMap<string, ListOp> = new Map(LIST_OPS.map((o) => [o.name, o]));

/** One step of a chain after its source, as stored in the IR: the function (if any) is the last of `args`. */
export interface ChainStepLike {
  readonly op: string;
  readonly params: readonly string[];
  readonly args: readonly unknown[];
}

/** Codes of the terminal operations the VM runs directly (the others compile to loops). */
export const ListTerm = { First: 0, Last: 1, At: 2, Count: 3, Sum: 4, Min: 5, Max: 6 } as const;
