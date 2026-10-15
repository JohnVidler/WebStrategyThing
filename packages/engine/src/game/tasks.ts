/** High-level instructions. Scripts decide how (and whether) to carry them out. */
export const TaskType = {
  None: 0,
  Move: 1,
  Attack: 2,
  Harvest: 3,
  Dock: 4,
  Stop: 5,
  Charge: 6,
  Build: 7,
  /** Give energy to the target (e.g. a unit that ran flat). */
  Supply: 8,
  /** Mend the target own unit or building with the repair module. */
  Repair: 9,
} as const;

/** Who issued a task, plus the player's intent. Bit flags. */
export const TaskFlag = {
  Player: 1,
  Building: 2,
  /** Issued without Shift: the player wants this instead of the current plan. */
  Urgent: 4,
} as const;

export const MAX_TASKS = 16;
const STRIDE = 5; // type, x, y, target, flags
const F_TYPE = 0, F_X = 1, F_Y = 2, F_TARGET = 3, F_FLAGS = 4;

/**
 * Fixed-capacity task queue backed by one Int32Array, allocated once per
 * unit at spawn. Index 0 is the front. x/y are tiles; target is an entity handle.
 */
export class TaskQueue {
  private readonly data = new Int32Array(MAX_TASKS * STRIDE);
  count = 0;
  /** Set on every mutation; cleared once the owner has been sent the new queue. */
  dirty = true;

  push(type: number, x: number, y: number, target: number, flags: number): boolean {
    if (this.count >= MAX_TASKS) return false;
    const o = this.count * STRIDE;
    this.data[o + F_TYPE] = type;
    this.data[o + F_X] = x;
    this.data[o + F_Y] = y;
    this.data[o + F_TARGET] = target;
    this.data[o + F_FLAGS] = flags;
    this.count++;
    this.dirty = true;
    return true;
  }

  type(i: number): number {
    return this.field(i, F_TYPE, TaskType.None);
  }

  x(i: number): number {
    return this.field(i, F_X, 0);
  }

  y(i: number): number {
    return this.field(i, F_Y, 0);
  }

  target(i: number): number {
    return this.field(i, F_TARGET, -1);
  }

  flags(i: number): number {
    return this.field(i, F_FLAGS, 0);
  }

  remove(i: number): boolean {
    if (i < 0 || i >= this.count) return false;
    this.data.copyWithin(i * STRIDE, (i + 1) * STRIDE, this.count * STRIDE);
    this.count--;
    this.dirty = true;
    return true;
  }

  /** Clears flag bits on task i. */
  clearFlags(i: number, bits: number): boolean {
    if (i < 0 || i >= this.count) return false;
    this.data[i * STRIDE + F_FLAGS] &= ~bits;
    this.dirty = true;
    return true;
  }

  /** Moves task i to the front, keeping the others in order. */
  toFront(i: number): boolean {
    if (i < 0 || i >= this.count) return false;
    if (i === 0) return true;
    const task = this.data.slice(i * STRIDE, (i + 1) * STRIDE);
    this.data.copyWithin(STRIDE, 0, i * STRIDE);
    this.data.set(task, 0);
    this.dirty = true;
    return true;
  }

  /** Owner wire form: [type, x, y, targetEntityIndex] per task. */
  toWire(resolve: (handle: number) => number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) {
      const o = i * STRIDE;
      out.push(this.data[o + F_TYPE], this.data[o + F_X], this.data[o + F_Y], resolve(this.data[o + F_TARGET]));
    }
    return out;
  }

  clear(): void {
    this.count = 0;
    this.dirty = true;
  }

  private field(i: number, f: number, fallback: number): number {
    return i >= 0 && i < this.count ? this.data[i * STRIDE + f] : fallback;
  }
}
