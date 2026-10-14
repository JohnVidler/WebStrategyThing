/**
 * Components are declared as flat schemas of numeric fields and stored as
 * Structure-of-Arrays (one typed array per field, indexed by entity index).
 *
 * Why SoA:
 *  - no per-entity objects, so no GC churn and cache-friendly iteration
 *  - the schema doubles as the wire format, so replication is generic
 *  - change tracking is a per-store list, so deltas cost O(changed), not O(world)
 */

export type FieldType = 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'f32' | 'f64';
export type Schema = Readonly<Record<string, FieldType>>;

export type TypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

type TypedArrayCtor = new (length: number) => TypedArray;

const ARRAY_CTORS: Record<FieldType, TypedArrayCtor> = {
  i8: Int8Array,
  u8: Uint8Array,
  i16: Int16Array,
  u16: Uint16Array,
  i32: Int32Array,
  u32: Uint32Array,
  f32: Float32Array,
  f64: Float64Array,
};

export const FIELD_BYTES: Record<FieldType, number> = {
  i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, f64: 8,
};

export interface ComponentDef<S extends Schema = Schema> {
  readonly name: string;
  readonly schema: S;
  /**
   * Networked components are change-tracked and replicated to clients.
   * Everything else (intents, cooldowns, VM state) never leaves the server.
   */
  readonly networked: boolean;
  /**
   * Fields sent at reduced precision: wire value = round(value / 2^shift) as a u16,
   * restored as wire << shift. Only for non-negative values the client merely draws.
   */
  readonly wireShift: Readonly<Record<string, number>>;
}

export function defineComponent<S extends Schema>(
  name: string,
  schema: S,
  opts: { networked?: boolean; wireShift?: Readonly<Partial<Record<keyof S & string, number>>> } = {},
): ComponentDef<S> {
  return Object.freeze({ name, schema, networked: opts.networked ?? false, wireShift: Object.freeze({ ...opts.wireShift }) as Readonly<Record<string, number>> });
}

export type Fields<S extends Schema> = { [K in keyof S]: TypedArray };
export type Values<S extends Schema> = { [K in keyof S]?: number };

export class ComponentStore<S extends Schema = Schema> {
  readonly keys: ReadonlyArray<keyof S & string>;
  /** Field arrays indexed by entity index. Re-allocated on growth: don't cache across ticks. */
  f: Fields<S>;
  /** Entity indices that currently have this component (iteration order is deterministic). */
  readonly dense: number[] = [];
  /** Entities whose networked fields changed since the last flush. */
  readonly changed: number[] = [];
  /** Entities that lost this component since the last flush (networked only). */
  readonly removed: number[] = [];

  private sparse: Int32Array;
  private changedFlag: Uint8Array;

  constructor(
    readonly id: number,
    readonly def: ComponentDef<S>,
    capacity: number,
  ) {
    this.keys = Object.keys(def.schema) as (keyof S & string)[];
    this.sparse = new Int32Array(capacity).fill(-1);
    this.changedFlag = new Uint8Array(capacity);
    this.f = {} as Fields<S>;
    for (const k of this.keys) this.f[k] = new ARRAY_CTORS[def.schema[k]](capacity);
  }

  get size(): number {
    return this.dense.length;
  }

  grow(capacity: number): void {
    const sparse = new Int32Array(capacity).fill(-1);
    sparse.set(this.sparse);
    this.sparse = sparse;
    const flags = new Uint8Array(capacity);
    flags.set(this.changedFlag);
    this.changedFlag = flags;
    for (const k of this.keys) {
      const next = new ARRAY_CTORS[this.def.schema[k]](capacity);
      next.set(this.f[k]);
      this.f[k] = next;
    }
  }

  has(e: number): boolean {
    return this.sparse[e] >= 0;
  }

  add(e: number, init?: Values<S>): void {
    if (this.sparse[e] < 0) {
      this.sparse[e] = this.dense.length;
      this.dense.push(e);
    }
    for (const k of this.keys) this.f[k][e] = init?.[k] ?? 0;
    this.markChanged(e);
  }

  /** `silent` skips removal replication (used when the whole entity is despawned). */
  remove(e: number, silent = false): void {
    const i = this.sparse[e];
    if (i === undefined || i < 0) return;
    const last = this.dense.pop()!;
    if (last !== e) {
      this.dense[i] = last;
      this.sparse[last] = i;
    }
    this.sparse[e] = -1;
    for (const k of this.keys) this.f[k][e] = 0;
    if (!silent && this.def.networked) this.removed.push(e);
  }

  /** Systems write the raw arrays directly, then call this so the change is replicated. */
  markChanged(e: number): void {
    if (!this.def.networked || this.changedFlag[e]) return;
    this.changedFlag[e] = 1;
    this.changed.push(e);
  }

  clearChanges(): void {
    for (const e of this.changed) this.changedFlag[e] = 0;
    this.changed.length = 0;
    this.removed.length = 0;
  }
}
