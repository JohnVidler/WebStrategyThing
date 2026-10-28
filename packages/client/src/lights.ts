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

/** Size of the round glow texture. */
export const GLOW_SIZE = 64;

/** Brightness (0..1) of a round glow at a fraction `d` (0 centre, 1 edge) of its radius: bright core, long soft tail, exactly 0 at the edge. */
export function glowIntensity(d: number): number {
  if (d >= 1) return 0;
  const f = 1 - d;
  return f * f * f * (0.4 + 0.6 * f);
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
