import type { CpuProfile } from '@wst/engine';

/** One CPU profile answer: cumulative counters at a server tick. */
export interface ProfileSample {
  readonly tick: number;
  readonly profile: CpuProfile | null;
}

/** Most event blocks listed in the panel (the rest are summed into "others"). */
const SHOWN = 4;

/**
 * Lines for the info panel's CPU section: cycles per second by event block over the time between the two
 * answers (or since the program started when there is only one), and dropped events. Empty when there is
 * nothing to show.
 */
export function cpuLines(now: ProfileSample, before: ProfileSample | undefined, tickRate: number): string[] {
  const p = now.profile;
  if (!p) return [];
  const prev = before?.profile && before.profile.handlers.length === p.handlers.length ? before : undefined;
  const span = prev ? now.tick - prev.tick : 0;
  const rows = p.handlers.map((h, i) => {
    const old = prev?.profile?.handlers[i];
    return { label: h.label, cycles: h.cycles - (old?.cycles ?? 0), runs: h.runs - (old?.runs ?? 0) };
  });
  const total = rows.reduce((n, r) => n + r.cycles, 0);
  const out: string[] = [];
  const perSecond = (v: number) => (span > 0 ? (v * tickRate) / span : v);
  const unit = span > 0 ? 'c/s' : 'c';
  out.push(span > 0 ? `CPU by event (last ${(span / tickRate).toFixed(0)}s): ${perSecond(total).toFixed(1)} ${unit}` : `CPU by event (since start): ${Math.round(total)} c`);
  const busy = rows.filter((r) => r.cycles > 0).sort((a, b) => b.cycles - a.cycles);
  if (busy.length === 0) out.push('  nothing ran: no event needed this unit');
  for (const r of busy.slice(0, SHOWN)) {
    const share = total > 0 ? Math.round((100 * r.cycles) / total) : 0;
    out.push(`  ${r.label}: ${perSecond(r.cycles).toFixed(span > 0 ? 1 : 0)} ${unit} (${share}%) · ${r.runs} run${r.runs === 1 ? '' : 's'}`);
  }
  if (busy.length > SHOWN) {
    const rest = busy.slice(SHOWN).reduce((n, r) => n + r.cycles, 0);
    out.push(`  ${busy.length - SHOWN} other(s): ${perSecond(rest).toFixed(span > 0 ? 1 : 0)} ${unit}`);
  }
  const dropped = p.dropped - (prev?.profile?.dropped ?? 0);
  if (p.dropped) out.push(`Events dropped: ${p.dropped}${prev && dropped ? ` (${dropped} lately)` : ''} · queue ${p.queued}/${p.capacity}`);
  return out;
}
