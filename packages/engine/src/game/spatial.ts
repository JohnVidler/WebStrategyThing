import type { TypedArray } from '../ecs/component';

/**
 * Uniform grid rebuilt once per tick, stored as intrusive linked lists in
 * typed arrays (no per-cell allocations). Keeps scan() sub-linear as unit
 * counts grow.
 */
export class SpatialGrid {
  private readonly cols: number;
  private readonly rows: number;
  private readonly heads: Int32Array;
  private next = new Int32Array(0);
  private xs: TypedArray = new Int32Array(0);
  private ys: TypedArray = new Int32Array(0);

  constructor(width: number, height: number, private readonly cell: number) {
    this.cols = Math.max(1, Math.ceil(width / cell));
    this.rows = Math.max(1, Math.ceil(height / cell));
    this.heads = new Int32Array(this.cols * this.rows);
  }

  rebuild(xs: TypedArray, ys: TypedArray, entities: readonly number[], capacity: number): void {
    if (this.next.length < capacity) this.next = new Int32Array(capacity);
    this.xs = xs;
    this.ys = ys;
    this.heads.fill(-1);
    for (const e of entities) {
      const c = this.cellIndex(this.cx(xs[e]), this.cy(ys[e]));
      this.next[e] = this.heads[c];
      this.heads[c] = e;
    }
  }

  /** Nearest accepted entity within radius r (ties broken by lowest index), or -1. */
  nearest(x: number, y: number, r: number, accept: (e: number) => boolean): number {
    if (r <= 0) return -1;
    const r2 = r * r;
    let best = -1;
    let bestD = Infinity;
    const x0 = this.cx(x - r), x1 = this.cx(x + r);
    const y0 = this.cy(y - r), y1 = this.cy(y + r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let e = this.heads[this.cellIndex(cx, cy)]; e >= 0; e = this.next[e]) {
          const dx = this.xs[e] - x;
          const dy = this.ys[e] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2 || d2 > bestD || (d2 === bestD && e > best)) continue;
          if (!accept(e)) continue;
          best = e;
          bestD = d2;
        }
      }
    }
    return best;
  }

  /** Calls `visit` for every entity within radius r of (x, y), in deterministic order. */
  forEachInRadius(x: number, y: number, r: number, visit: (e: number) => void): void {
    if (r <= 0) return;
    const r2 = r * r;
    const x0 = this.cx(x - r), x1 = this.cx(x + r);
    const y0 = this.cy(y - r), y1 = this.cy(y + r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let e = this.heads[this.cellIndex(cx, cy)]; e >= 0; e = this.next[e]) {
          const dx = this.xs[e] - x;
          const dy = this.ys[e] - y;
          if (dx * dx + dy * dy <= r2) visit(e);
        }
      }
    }
  }

  private cx(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)));
  }

  private cy(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)));
  }

  private cellIndex(cx: number, cy: number): number {
    return cy * this.cols + cx;
  }
}
