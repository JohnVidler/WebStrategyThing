/**
 * Animated main-menu backdrop: a ground plane of grid lines with some cells filled in like map
 * terrain, seen in perspective and drifting slowly diagonally towards the viewer, fading into
 * blackness at the horizon. Cells are filled from a deterministic value-noise function of their
 * world coordinates, so the scroll is endless without any wrap-around seam or repeat.
 */
/** Cell edge length in world units (the camera is 1 unit above the ground). */
const TILE = 0.14;
/** Camera drift in world units per second, sideways and forwards (so the drift is diagonal). */
const DRIFT_U = 0.04;
const DRIFT_V = 0.04;
/** Nearest and farthest ground distance drawn. */
const V_NEAR = 0.9;
const V_FAR = 9;
/** Where the horizon sits, as a fraction of the screen height from the top. */
const HORIZON = 0.0;
/** Noise scale: smaller is bigger terrain blobs. */
const NOISE_SCALE = 0.17;
const FILL_THRESHOLD = 0.56;

const hash = (x: number, y: number): number => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Smooth value noise in 0..1 at a (fractional) lattice position. */
const noise = (x: number, y: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const top = hash(x0, y0) * (1 - fx) + hash(x0 + 1, y0) * fx;
  const bottom = hash(x0, y0 + 1) * (1 - fx) + hash(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
};

let canvas: HTMLCanvasElement | undefined;
let frame = 0;

/** Starts (or keeps running) the backdrop behind `root`; it pauses itself while `root` is hidden. */
export function startMenuBackground(root: HTMLElement): void {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'menu-bg';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
  }
  const cv = canvas;
  const ctx = cv.getContext('2d');
  if (!ctx || frame) return;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.ceil(window.innerWidth * dpr);
    cv.height = Math.ceil(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const start = performance.now();
  const draw = (now: number): void => {
    if (root.hidden) {
      // The game has taken over: stop until showLobby runs again.
      cv.hidden = true;
      window.removeEventListener('resize', resize);
      frame = 0;
      return;
    }
    cv.hidden = false;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const t = still ? 0 : (now - start) / 1000;
    const camU = t * DRIFT_U;
    const camV = t * DRIFT_V;
    const horizon = h * HORIZON;
    // Screen scale: a point 1 unit ahead and 1 unit down lands on the bottom edge.
    const k = h - horizon;
    const sx = (u: number, v: number): number => w / 2 + (u * k) / v;
    const sy = (v: number): number => horizon + k / v;

    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, w, h);

    const row0 = Math.floor((camV + V_NEAR) / TILE) - 1;
    const row1 = Math.ceil((camV + V_FAR) / TILE);
    const fills = new Path2D();
    const lines = new Path2D();
    for (let iv = row0; iv <= row1; iv++) {
      const v0 = iv * TILE - camV;
      const v1 = v0 + TILE;
      if (v0 < V_NEAR * 0.5 || v1 > V_FAR) continue;
      const y0 = sy(v0);
      const y1 = sy(v1);
      // Lateral range visible at this depth, in world units.
      const half = (w / 2 / k) * v1 + TILE;
      const c0 = Math.floor((camU - half) / TILE);
      const c1 = Math.ceil((camU + half) / TILE);
      lines.moveTo(0, y0);
      lines.lineTo(w, y0);
      for (let ic = c0; ic < c1; ic++) {
        const u0 = ic * TILE - camU;
        const u1 = u0 + TILE;
        // One line per cell column edge, drawn as a segment of this row.
        lines.moveTo(sx(u0, v0), y0);
        lines.lineTo(sx(u0, v1), y1);
        if (noise(ic * NOISE_SCALE, iv * NOISE_SCALE) > FILL_THRESHOLD) {
          fills.moveTo(sx(u0, v0), y0);
          fills.lineTo(sx(u1, v0), y0);
          fills.lineTo(sx(u1, v1), y1);
          fills.lineTo(sx(u0, v1), y1);
          fills.closePath();
        }
      }
    }
    ctx.fillStyle = 'rgba(78, 161, 255, 0.16)';
    ctx.fill(fills);
    // Glow: wide, faint strokes under the crisp line (cheaper than shadowBlur on a big path).
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(78, 161, 255, 0.05)';
    ctx.lineWidth = 7;
    ctx.stroke(lines);
    ctx.strokeStyle = 'rgba(78, 161, 255, 0.09)';
    ctx.lineWidth = 3.5;
    ctx.stroke(lines);
    ctx.strokeStyle = 'rgba(150, 200, 255, 0.28)';
    ctx.lineWidth = 1;
    ctx.stroke(lines);

    // Fade the distance into blackness.
    const fade = ctx.createLinearGradient(0, horizon, 0, h);
    fade.addColorStop(0, 'rgba(4, 6, 10, 1)');
    fade.addColorStop(0.18, 'rgba(4, 6, 10, 0.85)');
    fade.addColorStop(0.55, 'rgba(4, 6, 10, 0.3)');
    fade.addColorStop(1, 'rgba(4, 6, 10, 0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, horizon - 1, w, h - horizon + 1);

    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
}
