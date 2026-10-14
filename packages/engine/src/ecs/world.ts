import { ComponentStore, type ComponentDef, type Schema } from './component';

const INDEX_BITS = 20;
export const MAX_ENTITIES = 1 << INDEX_BITS;
const INDEX_MASK = MAX_ENTITIES - 1;
const GEN_MASK = 0x7ff;

/**
 * A packed (generation << 20 | index) reference that is safe to hold across
 * ticks, e.g. in a unit's script memory. Always a non-negative int32, so it
 * round-trips through the VM unchanged. Stale handles resolve to -1.
 */
export type EntityHandle = number;

export class World {
  readonly stores: ComponentStore[] = [];
  /** Entities destroyed since the last flush. */
  readonly despawned: number[] = [];
  capacity: number;

  private readonly byDef = new Map<ComponentDef<any>, ComponentStore<any>>();
  private alive: Uint8Array;
  private gen: Uint16Array;
  private free: number[] = [];
  /** Indices freed this tick; recycled on flush so a despawn and a spawn never share an index within one delta. */
  private pendingFree: number[] = [];
  private next = 0;
  private live = 0;

  /** Component ids are the index in `defs`, so server and client must pass the same list. */
  constructor(defs: readonly ComponentDef<any>[], capacity = 1024) {
    this.capacity = capacity;
    this.alive = new Uint8Array(capacity);
    this.gen = new Uint16Array(capacity);
    defs.forEach((def, id) => {
      const s = new ComponentStore(id, def, capacity);
      this.stores.push(s);
      this.byDef.set(def, s);
    });
  }

  get entityCount(): number {
    return this.live;
  }

  store<S extends Schema>(def: ComponentDef<S>): ComponentStore<S> {
    const s = this.byDef.get(def);
    if (!s) throw new Error(`Component '${def.name}' is not registered in this world`);
    return s;
  }

  create(): number {
    const e = this.free.length ? this.free.pop()! : this.next++;
    if (e >= MAX_ENTITIES) throw new Error('Entity limit reached');
    this.ensureCapacity(e + 1);
    this.alive[e] = 1;
    this.live++;
    return e;
  }

  /** Mirror worlds (clients) materialise entities at server-assigned indices. Never mix with create(). */
  adopt(e: number): void {
    this.ensureCapacity(e + 1);
    if (this.alive[e]) return;
    this.alive[e] = 1;
    this.live++;
    if (e >= this.next) this.next = e + 1;
  }

  destroy(e: number): void {
    if (!this.isAlive(e)) return;
    for (const s of this.stores) s.remove(e, true);
    this.alive[e] = 0;
    this.live--;
    this.gen[e] = (this.gen[e] + 1) & GEN_MASK;
    this.pendingFree.push(e);
    this.despawned.push(e);
  }

  clear(): void {
    for (let e = 0; e < this.next; e++) this.destroy(e);
  }

  isAlive(e: number): boolean {
    return e >= 0 && e < this.capacity && this.alive[e] === 1;
  }

  handle(e: number): EntityHandle {
    return (this.gen[e] << INDEX_BITS) | e;
  }

  resolve(h: EntityHandle): number {
    if (h < 0) return -1;
    const e = h & INDEX_MASK;
    return this.isAlive(e) && this.gen[e] === h >>> INDEX_BITS ? e : -1;
  }

  /**
   * Entities having all of `defs`, in deterministic order. Returns a fresh
   * array so callers may destroy entities while iterating.
   * (Upgrade path if this shows up in profiles: cached queries / archetype tables.)
   */
  query(...defs: ComponentDef<any>[]): number[] {
    const stores = defs.map((d) => this.store(d));
    let smallest = stores[0];
    for (const s of stores) if (s.size < smallest.size) smallest = s;
    const out: number[] = [];
    outer: for (const e of smallest.dense) {
      for (const s of stores) if (s !== smallest && !s.has(e)) continue outer;
      out.push(e);
    }
    return out;
  }

  /** End of tick: drop change tracking and recycle freed indices. */
  flush(): void {
    for (const s of this.stores) s.clearChanges();
    this.despawned.length = 0;
    for (const e of this.pendingFree) this.free.push(e);
    this.pendingFree.length = 0;
  }

  private ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    let cap = this.capacity;
    while (cap < n) cap *= 2;
    const alive = new Uint8Array(cap);
    alive.set(this.alive);
    this.alive = alive;
    const gen = new Uint16Array(cap);
    gen.set(this.gen);
    this.gen = gen;
    for (const s of this.stores) s.grow(cap);
    this.capacity = cap;
  }
}
