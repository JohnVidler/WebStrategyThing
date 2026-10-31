/** Size of the headlight texture and where its lamp sits: the beam runs up from (BEAM_W / 2, BEAM_LAMP_Y). */
export const BEAM_W = 128;
export const BEAM_H = 256;
export const BEAM_LAMP_Y = 224;

const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Headlight brightness (0..1) at a texel: strongest at the lamp, fading smoothly along the beam, soft
 * at its sides (the cone widens with distance), plus a small pool of spill round the lamp itself.
 */
export function beamIntensity(x: number, y: number): number {
  const dx = x - BEAM_W / 2;
  const ahead = BEAM_LAMP_Y - y; // texels in front of the lamp (negative: behind it)
  const reach = BEAM_LAMP_Y; // length of the beam in texels
  const dist = Math.hypot(dx, ahead);
  const pool = Math.pow(1 - smooth(0, 34, dist), 1.6) * 0.8;
  if (ahead <= 0) return pool;
  const t = ahead / reach; // 0 at the lamp, 1 at the far end
  const half = 10 + 54 * t; // half-width of the lit cone
  const across = 1 - smooth(0.25, 1, Math.abs(dx) / half); // bright core, feathered edge
  const along = Math.pow(1 - t, 1.4) * smooth(0, 0.06, t); // long falloff
  return Math.min(1, pool + across * across * along * 0.85);
}

/** How much haze (0..100) counts against the daylight when deciding if lamps come on: murky air needs lights even by day. */
export const HAZE_LAMP_FACTOR = 1.4;

/** The daylight (0..100) that decides when headlights are on: the sun, cut by haze, so in mist or dust they come on in the middle of the day. */
export function lampDaylight(sun: number, haze: number): number {
  return Math.max(0, Math.min(sun, 100 - haze * HAZE_LAMP_FACTOR));
}

/** Blend two 0xRRGGBB colours: `a` at t = 0, `b` at t = 1. */
export function mixColour(a: number, b: number, t: number): number {
  const ch = (shift: number): number => {
    const x = (a >> shift) & 255;
    return Math.round(x + (((b >> shift) & 255) - x) * t);
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Size of the round glow texture. */
export const GLOW_SIZE = 64;

/** Brightness (0..1) of a round glow at a fraction `d` (0 centre, 1 edge) of its radius: bright core, long soft tail, exactly 0 at the edge. */
export function glowIntensity(d: number): number {
  if (d >= 1) return 0;
  const f = 1 - d;
  return f * f * f * (0.4 + 0.6 * f);
}

/** Brightness (0..1) of a puff of mist at a fraction `d` (0 centre, 1 edge) of its radius: flat in the middle and easing to exactly 0 at the edge, with no visible rim. */
export function mistIntensity(d: number): number {
  if (d >= 1) return 0;
  const s = 1 - d;
  return s * s * (3 - 2 * s);
}

/** A white round puff with a very soft edge (see `mistIntensity`); the renderer tints and scales sprites made from it into drifting wisps of mist. */
export function makeMistTexture(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = GLOW_SIZE;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(GLOW_SIZE, GLOW_SIZE);
  const c = GLOW_SIZE / 2;
  for (let y = 0; y < GLOW_SIZE; y++) {
    for (let x = 0; x < GLOW_SIZE; x++) {
      const i = (y * GLOW_SIZE + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(mistIntensity(Math.hypot(x + 0.5 - c, y + 0.5 - c) / c) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** A white round glow with a soft falloff; sprites made from it are tinted, scaled and drawn additively for muzzle flashes, engines and explosions. */
export function makeGlowTexture(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = GLOW_SIZE;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(GLOW_SIZE, GLOW_SIZE);
  const c = GLOW_SIZE / 2;
  for (let y = 0; y < GLOW_SIZE; y++) {
    for (let x = 0; x < GLOW_SIZE; x++) {
      const i = (y * GLOW_SIZE + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(glowIntensity(Math.hypot(x + 0.5 - c, y + 0.5 - c) / c) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Builds the white-with-alpha headlight texture once; the renderer tints and scales sprites made from it. */
export function makeBeamTexture(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = BEAM_W;
  canvas.height = BEAM_H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(BEAM_W, BEAM_H);
  for (let y = 0; y < BEAM_H; y++) {
    for (let x = 0; x < BEAM_W; x++) {
      const i = (y * BEAM_W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(beamIntensity(x + 0.5, y + 0.5) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** How long lamps stutter when they switch on or off, in milliseconds. */
export const FLICKER_MS = 700;
const FLICKER_SLOT_MS = 60;

/** A cheap deterministic hash of two integers to 0..1. */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/**
 * Brightness (0..1) of a lamp `sinceMs` after it was switched `on` or off. Before the switch (negative time) it still
 * shows its old state; then it stutters in short slots, each lit or dark at random (`seed` makes each lamp its own),
 * lit ever more often when switching on and ever less often when switching off; after FLICKER_MS it is settled.
 */
export function lampLevel(sinceMs: number, on: boolean, seed: number): number {
  if (sinceMs <= 0) return on ? 0 : 1;
  if (sinceMs >= FLICKER_MS) return on ? 1 : 0;
  const slot = Math.floor(sinceMs / FLICKER_SLOT_MS);
  const progress = sinceMs / FLICKER_MS;
  const lit = hash01(seed, slot) < (on ? progress : 1 - progress);
  return lit ? 0.5 + 0.5 * hash01(seed + 1, slot) : 0;
}
