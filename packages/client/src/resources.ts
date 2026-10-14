import { Cargo, Construction, CpuStatus, EnergyView, Health, Stockpile, Unit } from '@wst/engine';
import type { ClientState } from './state';

/** A resource shown for a selection: the current amount out of a maximum. */
export interface Metric {
  readonly key: string;
  readonly label: string;
  readonly colour: string;
  /** Current amount and capacity for one entity, or undefined if it doesn't have this resource. */
  read(state: ClientState, e: number): { value: number; max: number } | undefined;
}

export const METRICS: readonly Metric[] = [
  {
    key: 'hp', label: 'Health', colour: '#5bd68a',
    read: (st, e) => {
      const hp = st.world.store(Health);
      const s = st.stats(e);
      return hp.has(e) && s ? { value: hp.f.hp[e], max: s.hp } : undefined;
    },
  },
  {
    key: 'energy', label: 'Energy', colour: '#f5c542',
    read: (st, e) => {
      const en = st.world.store(EnergyView);
      const s = st.stats(e);
      return en.has(e) && s?.energyCapacity ? { value: Math.round((en.f.pct[e] * s.energyCapacity) / 100), max: s.energyCapacity } : undefined;
    },
  },
  {
    key: 'cargo', label: 'Cargo', colour: '#7ee0b5',
    read: (st, e) => {
      const c = st.world.store(Cargo);
      const s = st.stats(e);
      return c.has(e) && s?.cargo ? { value: c.f.amount[e], max: s.cargo } : undefined;
    },
  },
  {
    key: 'silos', label: 'Silos', colour: '#7ee0b5',
    read: (st, e) => {
      const k = st.world.store(Stockpile);
      const s = st.stats(e);
      return k.has(e) && s?.resourceCapacity ? { value: k.f.amount[e], max: s.resourceCapacity } : undefined;
    },
  },
  {
    key: 'built', label: 'Built', colour: '#4fd1c5',
    read: (st, e) => {
      const c = st.world.store(Construction);
      return c.has(e) ? { value: c.f.progress[e], max: 100 } : undefined;
    },
  },
  {
    key: 'cpu', label: 'CPU', colour: '#82aaff',
    read: (st, e) => {
      const c = st.world.store(CpuStatus);
      const s = st.stats(e);
      return c.has(e) && s?.cyclesPerTick && !st.isSite(e) ? { value: c.f.used[e], max: s.cyclesPerTick } : undefined;
    },
  },
];

/** Samples kept per series, and ticks between samples (10 ticks per second). */
export const HISTORY_SAMPLES = 150;
export const HISTORY_EVERY = 2;

/**
 * A rolling history of every own entity's resources, so a selection can show
 * recent trends straight away. One ring buffer per entity and metric, sharing a
 * head index; NaN marks "didn't exist / didn't have it" at that time.
 */
export class ResourceHistory {
  private readonly series = new Map<string, Map<number, Float32Array>>(METRICS.map((m) => [m.key, new Map()]));
  /** Index of the newest sample. */
  private head = -1;
  private samples = 0;

  sample(state: ClientState): void {
    if (state.tick % HISTORY_EVERY !== 0) return;
    this.head = (this.head + 1) % HISTORY_SAMPLES;
    this.samples++;
    const unit = state.world.store(Unit);
    const own = unit.dense.filter((e) => state.isMine(e));
    const alive = new Set(own);
    for (const m of METRICS) {
      const byEntity = this.series.get(m.key)!;
      for (const e of byEntity.keys()) if (!alive.has(e)) byEntity.delete(e);
      for (const e of own) {
        const v = m.read(state, e)?.value;
        let ring = byEntity.get(e);
        if (v === undefined) {
          if (ring) ring[this.head] = NaN;
          continue;
        }
        if (!ring) byEntity.set(e, (ring = new Float32Array(HISTORY_SAMPLES).fill(NaN)));
        ring[this.head] = v;
      }
    }
  }

  /** Summed history for a set of entities, oldest first (NaN where none of them had a value). */
  total(key: string, entities: readonly number[]): number[] {
    const byEntity = this.series.get(key)!;
    const n = Math.min(this.samples, HISTORY_SAMPLES);
    const out: number[] = [];
    for (let k = n - 1; k >= 0; k--) {
      const i = (this.head - k + HISTORY_SAMPLES) % HISTORY_SAMPLES;
      let sum = NaN;
      for (const e of entities) {
        const v = byEntity.get(e)?.[i];
        if (v !== undefined && !Number.isNaN(v)) sum = (Number.isNaN(sum) ? 0 : sum) + v;
      }
      out.push(sum);
    }
    return out;
  }
}

/** A small inline SVG line chart of `values` on a 0..max scale; gaps (NaN) break the line. */
export function sparkline(values: readonly number[], max: number, colour: string, width = 90, height = 20): string {
  const top = Math.max(max, ...values.filter((v) => !Number.isNaN(v)), 1);
  const step = width / Math.max(1, HISTORY_SAMPLES - 1);
  // Right-align: the newest sample sits at the right edge even while history fills up.
  const x0 = width - (values.length - 1) * step;
  const y = (v: number) => (height - 1 - (v / top) * (height - 2)).toFixed(1);
  const runs: string[][] = [[]];
  values.forEach((v, i) => {
    if (Number.isNaN(v)) {
      if (runs.at(-1)!.length) runs.push([]);
    } else runs.at(-1)!.push(`${(x0 + i * step).toFixed(1)},${y(v)}`);
  });
  const lines = runs
    .filter((r) => r.length)
    .map((r) => {
      const pts = r.length === 1 ? [r[0], r[0]] : r;
      const first = pts[0].split(',')[0];
      const last = pts.at(-1)!.split(',')[0];
      return (
        `<polygon points="${first},${height} ${pts.join(' ')} ${last},${height}" fill="${colour}" fill-opacity="0.15"/>` +
        `<polyline points="${pts.join(' ')}" fill="none" stroke="${colour}" stroke-width="1.5" stroke-linejoin="round"/>`
      );
    })
    .join('');
  return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${lines}</svg>`;
}
