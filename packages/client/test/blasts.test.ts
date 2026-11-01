import { describe, expect, it } from 'vitest';
import { drawBlast, energyRadius, hasBatteryPart, makeBlast, shieldRadius, type BlastKind } from '../src/blasts';

/** A repeatable stand-in for Math.random. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A Graphics stand-in that counts what is drawn. */
function recorder() {
  const calls = { shapes: 0, strokes: 0 };
  const g: any = new Proxy(
    {},
    {
      get: (_t, name: string) => {
        if (name === 'stroke') return () => (calls.strokes++, g);
        if (name === 'fill') return () => (calls.shapes++, g);
        return () => g;
      },
    },
  );
  return { g, calls };
}

const KINDS: BlastKind[] = ['fire', 'shell', 'flak', 'missile', 'structure', 'energy', 'shield'];

describe('blasts', () => {
  it('has a distinct shape for each kind', () => {
    const b = Object.fromEntries(KINDS.map((k) => [k, makeBlast(k, 5, 5, 1.5, 0, { power: 1 }, seeded(3))])) as Record<BlastKind, ReturnType<typeof makeBlast>>;
    expect(b.shell.smoke).toHaveLength(0);
    expect(b.structure.pops.length).toBeGreaterThan(0);
    expect(b.energy.discharge.length).toBeGreaterThan(0);
    expect(b.energy.smoke).toHaveLength(0);
    expect(b.energy.debris).toHaveLength(0);
    expect(b.shield.discharge.length).toBeGreaterThan(0);
    expect(b.shield.debris.length).toBeGreaterThan(0);
    expect(b.structure.ms).toBeGreaterThan(b.fire.ms * 1.2);
    expect(new Set(KINDS.map((k) => b[k].palette.light)).size).toBeGreaterThan(3);
  });

  it('gives units three flavours of fire', () => {
    const seen = new Set<number>();
    const rand = seeded(11);
    for (let i = 0; i < 60; i++) seen.add(makeBlast('fire', 0, 0, 1, 0, {}, rand).variant);
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it('makes a fuller battery a bigger, more electric discharge', () => {
    const flat = makeBlast('energy', 0, 0, energyRadius(2, 0), 0, { power: 0 }, seeded(5));
    const full = makeBlast('energy', 0, 0, energyRadius(2, 1), 0, { power: 1 }, seeded(5));
    expect(full.radius).toBeGreaterThan(flat.radius);
    expect(full.discharge.length).toBeGreaterThan(flat.discharge.length);
    expect(full.ms).toBeGreaterThan(flat.ms);
    expect(shieldRadius(100000)).toBe(4.5);
  });

  it('discharges only when batteries are the majority of the modules', () => {
    expect(hasBatteryPart(['frame.small', 'battery.bank'])).toBe(true);
    expect(hasBatteryPart(['frame.small', 'cpu.basic', 'battery.bank', 'battery.bank'])).toBe(true);
    expect(hasBatteryPart(['frame.small', 'cpu.basic', 'battery.bank'])).toBe(false); // a tie is not a majority
    expect(hasBatteryPart(['frame.small', 'cpu.basic', 'sensor.long', 'battery.bank', 'battery.bank'])).toBe(false);
    expect(hasBatteryPart(['frame.small', 'solar.panel'])).toBe(false);
    expect(hasBatteryPart([])).toBe(false);
  });

  it('draws something at every stage of every kind, and nothing before or after', () => {
    for (const kind of KINDS) {
      const b = makeBlast(kind, 3, 3, 1.5, 1000, { power: 0.7 }, seeded(9));
      for (const f of [0, 0.1, 0.3, 0.6, 0.95]) {
        const { g, calls } = recorder();
        drawBlast(g, b, 1000 + f * b.ms, 0, 0, 32);
        expect(calls.shapes + calls.strokes, `${kind} at ${f}`).toBeGreaterThan(0);
      }
      for (const at of [999, 1000 + b.ms]) {
        const { g, calls } = recorder();
        drawBlast(g, b, at, 0, 0, 32);
        expect(calls.shapes + calls.strokes, `${kind} outside its life`).toBe(0);
      }
    }
  });

  it('re-rolls the arcs every flicker frame, unless motion is reduced', () => {
    const b = makeBlast('energy', 0, 0, 2, 0, { power: 1 }, seeded(2));
    const bolt = (still: boolean, now: number): string => {
      const out: string[] = [];
      const g: any = new Proxy({}, { get: (_t, name: string) => (name === 'lineTo' ? (x: number, y: number) => (out.push(`${x.toFixed(3)},${y.toFixed(3)}`), g) : () => g) });
      drawBlast(g, b, now, 0, 0, 32, still);
      return out.join(' ');
    };
    // At 200 ms the live blast is on flicker frame 3; with reduced motion it stays on frame 0, so the kinks differ.
    expect(bolt(true, 200)).not.toBe(bolt(false, 200));
  });
});
