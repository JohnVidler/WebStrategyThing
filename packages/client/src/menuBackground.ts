/**
 * Main-menu backdrop: a flat grid with some cells filled in like map terrain, drifting slowly
 * diagonally, with the edges darkened.
 *
 * It is deliberately cheap: one seamless texture is painted once, then the browser's compositor
 * scrolls it (a CSS transform animation). There is no per-frame JavaScript or canvas drawing, and
 * `display: none` (the game has taken over) stops the animation. Occasional sparks run along the grid
 * lines: a timer launches one every fraction of a second while the menu is showing (compositor-
 * animated elements, no per-frame work), and the timer is stopped whenever the backdrop is hidden.
 * Layout lives in style.css under `#menu-bg`.
 */
import { onReduceMotionChange, reduceMotion } from './settings';

/** Cell edge length in texture pixels, and cells per texture side (the texture repeats seamlessly). */
const CELL = 48;
const CELLS = 24;
const SIZE = CELL * CELLS;
/** Noise lattice period in cells: the terrain blobs repeat every CELLS, so this must divide it. */
const NOISE_CELLS = 6;
const FILL_THRESHOLD = 0.56;

const hash = (x: number, y: number): number => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Smooth value noise in 0..1 that wraps every `period` lattice steps, so the texture tiles. */
const noise = (x: number, y: number, period: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const at = (ix: number, iy: number): number => hash(((ix % period) + period) % period, ((iy % period) + period) % period);
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
};

/** Paints the seamless grid-and-terrain texture once and returns it as a data URL. */
function paintTexture(): string | undefined {
  const cv = document.createElement('canvas');
  cv.width = SIZE;
  cv.height = SIZE;
  const ctx = cv.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = 'rgba(78, 161, 255, 0.16)';
  const per = NOISE_CELLS / CELLS;
  for (let iy = 0; iy < CELLS; iy++) {
    for (let ix = 0; ix < CELLS; ix++) {
      if (noise(ix * per + 0.5, iy * per + 0.5, NOISE_CELLS) > FILL_THRESHOLD) ctx.fillRect(ix * CELL, iy * CELL, CELL, CELL);
    }
  }
  // Grid lines sit on the texture edge, so each is split between opposite sides and rejoins when tiled.
  const lines = new Path2D();
  for (let i = 0; i <= CELLS; i++) {
    lines.moveTo(i * CELL, 0);
    lines.lineTo(i * CELL, SIZE);
    lines.moveTo(0, i * CELL);
    lines.lineTo(SIZE, i * CELL);
  }
  ctx.strokeStyle = 'rgba(78, 161, 255, 0.09)';
  ctx.lineWidth = 8;
  ctx.stroke(lines);
  ctx.strokeStyle = 'rgba(150, 200, 255, 0.3)';
  ctx.lineWidth = 2;
  ctx.stroke(lines);
  return cv.toDataURL('image/png');
}

/** Sparks: bright points that occasionally run along grid lines (at most MAX_SPARKS at once). */
const MAX_SPARKS = 30;
const SPARK_GAP_MS: [number, number] = [80, 220];
/** Travel speed in px/s and run length in cells. */
const SPARK_SPEED = 180;
const SPARK_CELLS: [number, number] = [10, 25];
/** Length of a spark's fading tail in px (its whole visible length; the bright end is the head). */
const SPARK_TAIL = 148;

const between = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

/**
 * Starts the spark spawner and returns `wake`, which restarts it after the backdrop was hidden.
 * Sparks live inside the scrolling layer, so they stay on their grid line as the grid drifts; each is
 * one element animated by the compositor and removed when it finishes. While the backdrop (or the
 * tab) is hidden the timer stops altogether instead of ticking for nothing.
 */
function startSparks(host: HTMLElement, scroll: HTMLElement): () => void {
  let live = 0;
  let timer: number | undefined;
  const wake = (): void => {
    if (timer === undefined && !host.hidden && !document.hidden && !reduceMotion()) timer = window.setTimeout(spawn, between(...SPARK_GAP_MS));
  };
  const spawn = (): void => {
    timer = undefined;
    if (host.hidden || document.hidden || reduceMotion()) return; // wake() restarts it when the menu shows again
    if (live < MAX_SPARKS) launch();
    wake();
  };
  document.addEventListener('visibilitychange', wake);
  onReduceMotionChange(wake);
  const launch = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // The layer starts one tile up-left of the screen and slides by up to one tile over its loop.
    const loop = scroll.getAnimations()[0];
    const period = Number(loop?.effect?.getTiming().duration ?? 0);
    const drift = loop && period > 0 ? ((Number(loop.currentTime ?? 0) % period) / period) * SIZE : 0;
    const left = SIZE - drift;
    const top = SIZE - drift;
    const horizontal = Math.random() < 0.5;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const run = Math.round(between(...SPARK_CELLS)) * CELL;
    const spark = document.createElement('div');
    spark.className = `menu-bg-spark ${horizontal ? 'h' : 'v'} ${dir > 0 ? 'fwd' : 'back'}`;
    // Pick a grid line crossing the screen and a start point on it.
    const along = horizontal ? w : h;
    const across = horizontal ? h : w;
    const lineAt = Math.round(((horizontal ? top : left) + Math.random() * across) / CELL) * CELL;
    const start = (horizontal ? left : top) + Math.random() * along;
    const x = horizontal ? start : lineAt;
    const y = horizontal ? lineAt : start;
    spark.style.setProperty('--spark-tail', `${SPARK_TAIL}px`);
    spark.style.left = `${x}px`;
    spark.style.top = `${y}px`;
    scroll.appendChild(spark);
    live++;
    const to = dir * run;
    const move = horizontal ? (d: number) => `translate(${d}px, 0)` : (d: number) => `translate(0, ${d}px)`;
    const anim = spark.animate(
      [
        { transform: move(0), opacity: 0 },
        { transform: move(to * 0.15), opacity: 1, offset: 0.15 },
        { transform: move(to * 0.8), opacity: 1, offset: 0.8 },
        { transform: move(to), opacity: 0 },
      ],
      { duration: (run / SPARK_SPEED) * 1000, easing: 'linear' },
    );
    anim.onfinish = () => {
      spark.remove();
      live--;
    };
  };
  wake();
  return wake;
}

let backdrop: HTMLElement | undefined;
let wakeSparks: () => void = () => undefined;

/** Starts (or keeps running) the backdrop behind `root`; it is hidden whenever `root` is hidden. */
export function startMenuBackground(root: HTMLElement): void {
  if (backdrop) {
    backdrop.hidden = root.hidden;
    wakeSparks();
    return;
  }
  const url = paintTexture();
  if (!url) return;
  const el = document.createElement('div');
  el.id = 'menu-bg';
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--menu-bg-tile', `${SIZE}px`);
  el.innerHTML = '<div class="menu-bg-scroll"></div>';
  el.querySelector<HTMLElement>('.menu-bg-scroll')!.style.backgroundImage = `url(${url})`;
  document.body.prepend(el);
  backdrop = el;
  wakeSparks = startSparks(el, el.querySelector<HTMLElement>('.menu-bg-scroll')!);
  // The game takes over by hiding the lobby; follow that without polling.
  new MutationObserver(() => {
    el.hidden = root.hidden;
    wakeSparks();
  }).observe(root, { attributes: true, attributeFilter: ['hidden'] });
}
