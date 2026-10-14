import { FIELD_BYTES, type ComponentStore, type FieldType } from '../ecs/component';
import type { World } from '../ecs/world';

/*
 * Binary tick packet (little endian). The layout is driven entirely by the
 * component schemas, so new networked components replicate with no codec work.
 *
 *   u8   type            Snapshot | Delta
 *   var  tick
 *   var  despawnCount,   var entity[]
 *   u8   removalStores,  { u8 componentId, var count, var entity[] }[]
 *   u8   upsertStores,   { u8 componentId, var count, { var entity, fields... }[] }[]
 *   var  eventCount,     { u8 type, var a, var b }[]
 *
 * `var` is an unsigned LEB128 varint (1 byte below 128), so small entity ids and
 * counts cost one or two bytes. Fields with a `wireShift` (positions) are sent as
 * u16 at reduced precision. Only *changed networked* fields are written in a Delta.
 * Without a view the same buffer can go to every client; with an Interest view
 * (fog of war) each client gets only what it can see: entities entering view are
 * sent in full, entities leaving view are sent as despawns.
 */

export const PacketType = {
  Snapshot: 1,
  Delta: 2,
} as const;

class Writer {
  private buf = new ArrayBuffer(4096);
  private view = new DataView(this.buf);
  private off = 0;

  reset(): void {
    this.off = 0;
  }

  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.off, v);
    this.off += 1;
  }

  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.off, v, true);
    this.off += 4;
  }

  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.off, v, true);
    this.off += 2;
  }

  /** Unsigned LEB128 (values below 2^32). */
  varu(v: number): void {
    while (v >= 0x80) {
      this.u8((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    this.u8(v);
  }

  i32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.off, v, true);
    this.off += 4;
  }

  field(t: FieldType, v: number): void {
    this.ensure(FIELD_BYTES[t]);
    const o = this.off;
    const d = this.view;
    switch (t) {
      case 'i8': d.setInt8(o, v); break;
      case 'u8': d.setUint8(o, v); break;
      case 'i16': d.setInt16(o, v, true); break;
      case 'u16': d.setUint16(o, v, true); break;
      case 'i32': d.setInt32(o, v, true); break;
      case 'u32': d.setUint32(o, v, true); break;
      case 'f32': d.setFloat32(o, v, true); break;
      case 'f64': d.setFloat64(o, v, true); break;
    }
    this.off += FIELD_BYTES[t];
  }

  finish(): Uint8Array {
    return new Uint8Array(this.buf.slice(0, this.off));
  }

  private ensure(n: number): void {
    if (this.off + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.off + n) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(new Uint8Array(this.buf));
    this.buf = next;
    this.view = new DataView(next);
  }
}

class Reader {
  private readonly view: DataView;
  private off = 0;

  constructor(data: ArrayBuffer | Uint8Array) {
    this.view = data instanceof Uint8Array
      ? new DataView(data.buffer, data.byteOffset, data.byteLength)
      : new DataView(data);
  }

  u8(): number {
    return this.view.getUint8(this.off++);
  }

  u32(): number {
    const v = this.view.getUint32(this.off, true);
    this.off += 4;
    return v;
  }

  u16(): number {
    const v = this.view.getUint16(this.off, true);
    this.off += 2;
    return v;
  }

  varu(): number {
    let v = 0;
    let scale = 1;
    for (;;) {
      const b = this.u8();
      v += (b & 0x7f) * scale;
      if (b < 0x80) return v;
      scale *= 128;
    }
  }

  i32(): number {
    const v = this.view.getInt32(this.off, true);
    this.off += 4;
    return v;
  }

  field(t: FieldType): number {
    const o = this.off;
    const d = this.view;
    this.off += FIELD_BYTES[t];
    switch (t) {
      case 'i8': return d.getInt8(o);
      case 'u8': return d.getUint8(o);
      case 'i16': return d.getInt16(o, true);
      case 'u16': return d.getUint16(o, true);
      case 'i32': return d.getInt32(o, true);
      case 'u32': return d.getUint32(o, true);
      case 'f32': return d.getFloat32(o, true);
      case 'f64': return d.getFloat64(o, true);
    }
  }
}

const writer = new Writer();

/**
 * What one client may see this tick (see Interest). Entities in `enter` are sent
 * in full; entities in `drop` are despawned on the client.
 */
export interface InterestView {
  readonly visible: ReadonlySet<number>;
  readonly enter: readonly number[];
  readonly drop: readonly number[];
}

/**
 * Tracks which entities one client currently holds, and turns each tick's
 * visible set into an InterestView. Call update() once per tick per client.
 */
export class Interest {
  readonly known = new Set<number>();

  /** `despawned`: entities destroyed this tick (their ids may already be reused). */
  update(visible: ReadonlySet<number>, despawned: readonly number[]): InterestView {
    const drop: number[] = [];
    for (const e of despawned) {
      if (this.known.delete(e)) drop.push(e);
    }
    for (const e of this.known) {
      if (!visible.has(e)) {
        this.known.delete(e);
        drop.push(e);
      }
    }
    const enter: number[] = [];
    for (const e of visible) {
      if (!this.known.has(e)) {
        this.known.add(e);
        enter.push(e);
      }
    }
    return { visible, enter, drop };
  }

  /** For a full snapshot: the client starts from exactly the visible set. */
  reset(visible: ReadonlySet<number>): InterestView {
    this.known.clear();
    for (const e of visible) this.known.add(e);
    return { visible, enter: [...visible], drop: [] };
  }
}

/** Encodes the world's pending changes (Delta) or its full networked state (Snapshot), optionally for one client's view. */
export function encodeTick(world: World, tick: number, events: readonly number[], full: boolean, view?: InterestView): Uint8Array {
  const w = writer;
  w.reset();
  w.u8(full ? PacketType.Snapshot : PacketType.Delta);
  w.varu(tick);

  const despawned = full ? [] : view ? view.drop : world.despawned;
  w.varu(despawned.length);
  for (const e of despawned) w.varu(e);

  const networked = world.stores.filter((s) => s.def.networked);
  const entering = view ? new Set(view.enter) : undefined;
  // Changes are only sent for entities the client already holds and still sees.
  const keep = (e: number) => !view || (view.visible.has(e) && !entering!.has(e));

  const removals: [ComponentStore, number[]][] = [];
  if (!full) {
    for (const s of networked) {
      const list = s.removed.filter(keep);
      if (list.length) removals.push([s, list]);
    }
  }
  w.u8(removals.length);
  for (const [s, list] of removals) {
    w.u8(s.id);
    w.varu(list.length);
    for (const e of list) w.varu(e);
  }

  const upserts: [ComponentStore, readonly number[]][] = [];
  for (const s of networked) {
    let list: number[];
    if (full) list = view ? s.dense.filter((e) => view.visible.has(e)) : [...s.dense];
    else {
      list = s.changed.filter((e) => s.has(e) && keep(e));
      if (view) for (const e of view.enter) if (s.has(e)) list.push(e);
    }
    if (list.length) upserts.push([s, list]);
  }
  w.u8(upserts.length);
  for (const [s, list] of upserts) {
    w.u8(s.id);
    w.varu(list.length);
    for (const e of list) {
      w.varu(e);
      for (const k of s.keys) {
        const shift = s.def.wireShift[k];
        if (shift) w.u16(Math.min(0xffff, Math.max(0, Math.round(s.f[k][e] / (1 << shift)))));
        else w.field(s.def.schema[k], s.f[k][e]);
      }
    }
  }

  // Events carry entity indices: send those involving something the client can see.
  let count = 0;
  for (let i = 0; i < events.length; i += 3) if (!view || view.visible.has(events[i + 1]) || view.visible.has(events[i + 2])) count++;
  w.varu(count);
  for (let i = 0; i < events.length; i += 3) {
    if (view && !view.visible.has(events[i + 1]) && !view.visible.has(events[i + 2])) continue;
    w.u8(events[i]);
    w.varu(events[i + 1]);
    w.varu(events[i + 2]);
  }
  return w.finish();
}

export interface TickInfo {
  readonly tick: number;
  readonly full: boolean;
  /** Flat [type, a, b, ...] like Simulation.events. */
  readonly events: number[];
}

/**
 * Applies a tick packet to a mirror world. Afterwards the world's change
 * lists (store.changed, world.despawned) describe what changed, so the
 * renderer can sync incrementally; call world.flush() when done.
 */
export function applyTick(world: World, data: ArrayBuffer | Uint8Array): TickInfo {
  const r = new Reader(data);
  const type = r.u8();
  const full = type === PacketType.Snapshot;
  const tick = r.varu();
  if (full) world.clear();

  for (let n = r.varu(); n > 0; n--) world.destroy(r.varu());

  for (let s = r.u8(); s > 0; s--) {
    const store = world.stores[r.u8()];
    for (let n = r.varu(); n > 0; n--) store.remove(r.varu());
  }

  for (let s = r.u8(); s > 0; s--) {
    const store = world.stores[r.u8()];
    for (let n = r.varu(); n > 0; n--) {
      const e = r.varu();
      world.adopt(e);
      if (!store.has(e)) store.add(e);
      for (const k of store.keys) {
        const shift = store.def.wireShift[k];
        store.f[k][e] = shift ? r.u16() << shift : r.field(store.def.schema[k]);
      }
      store.markChanged(e);
    }
  }

  const events: number[] = [];
  for (let n = r.varu(); n > 0; n--) events.push(r.u8(), r.varu(), r.varu());
  return { tick, full, events };
}
