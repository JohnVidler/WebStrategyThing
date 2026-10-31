import { Graphics } from 'pixi.js';
import { Sky, strikeIsAimed, strikeSpot } from '@wst/engine';
import type { ClientState } from './state';

/**
 * The weather over the map (screen space, above the fog, under the interface). Everything is drawn from the
 * engine's weather mix (`Weather.mix`: how much of each `Sky` is in the air), so as the weather changes every
 * element fades in and out in step with the effects on the game, never switching on or off.
 *
 *  - Rain: a handful of faint, slanted streaks that fall and slide with the wind, so the play area stays
 *    readable, and on a share of them a splash where the drop lands (only on tiles the player can see). A storm
 *    has more of both, a cool grey cast, and lightning: a flash and a jagged bolt where it lands.
 *  - Dust: a tan cast and fast grit blowing with the wind. Heatwave: a warm tint and faint shimmer rising.
 *
 * The engine decides when each happens and where lightning strikes; this only draws it. With Reduce motion
 * nothing moves (streaks stand still, no splashes, shimmer or grit) and there is no flashing at all.
 * Two options trim it further: with full-screen flashes off there is no lightning flash or bolt, and with the weather
 * set to Simple only each weather's base effect is drawn (casts, rain streaks, the lightning flash), without the
 * splashes, grit, shimmer or bolt. Mist is not drawn here: it lives in the world, as soft wisps drifting under the
 * units and a pale fog edge (see `drawMist` and `drawFog` in the renderer).
 */

const RAIN_COLOUR = 0xbcd2e8;
const GLOOM_COLOUR = 0x1c2733;
const FLASH_COLOUR = 0xe8f0ff;
const DUST_COLOUR = 0xc99a52;
const GRIT_COLOUR = 0xe6cc94;
const HEAT_COLOUR = 0xff9a3c;
const SHIMMER_COLOUR = 0xfff0d0;
/** Streaks at full strength: rain, and a storm. Fewer are drawn while it builds up. */
const RAIN_DROPS = 70;
const STORM_DROPS = 150;
const DROP_ALPHA = 0.2;
const STORM_DROP_ALPHA = 0.3;
/** Drops that land and splash, at full strength (part of the same rain, not extra on top of it). */
const RAIN_SPLASHES = 22;
const STORM_SPLASHES = 55;
/**
 * A splash drop falls from this height (pixels) at the same speed as the streaks (`FALL_SPEED`, with the same
 * per-drop variation), then its ring lasts SPLASH_LIFE seconds (growing to SPLASH_RADIUS pixels); each drop repeats
 * about every SPLASH_PERIOD seconds, at a new spot.
 */
const SPLASH_PERIOD = 1.1;
const SPLASH_DROP_HEIGHT = 170;
const SPLASH_LIFE = 0.45;
const SPLASH_RADIUS = 9;
/** Streak length and fall speed, in screen pixels and pixels per second. */
const DROP_LENGTH = 14;
const FALL_SPEED = 900;
/** Sideways drift, in pixels per second at full wind. */
const WIND_DRIFT = 420;
/** Casts over the map at full strength. */
const GLOOM_ALPHA = 0.07;
const STORM_GLOOM_ALPHA = 0.16;
const DUST_ALPHA = 0.2;
const HEAT_ALPHA = 0.07;
/** Dust grit: specks at full strength, their alpha, and their speed in pixels per second (plus the wind's). */
const GRIT = 110;
const GRIT_ALPHA = 0.35;
const GRIT_SPEED = 500;
/** Heat shimmer lines. */
const SHIMMER_LINES = 14;
const SHIMMER_ALPHA = 0.1;
/** Lightning: how long the flash lasts (ms), its brightest alpha, and how long the bolt stays drawn. */
const FLASH_MS = 320;
const FLASH_ALPHA = 0.12;
const BOLT_MS = 140;
/** Strikes older than this many ticks that the client missed (a tab in the background, say) are not replayed. */
const MAX_CATCH_UP_TICKS = 10;
/** A strike out of sight still lights the sky a little. */
const DISTANT_FLASH = 0.3;

/** What the renderer tells this about the view: where the camera is, and what the player can see. */
export interface SkyProbe {
  /** Whether the point on the screen (pixels) is on a tile the player can see right now. */
  visible(sx: number, sy: number): boolean;
  /** Whether the tile can be seen right now. */
  tileVisible(tx: number, ty: number): boolean;
  /** The screen position (pixels) of the middle of a tile. */
  tileToScreen(tx: number, ty: number): { x: number; y: number };
}

/** Cheap fixed hash of a drop's number to 0..1, so every streak keeps its own place without storing any. */
export function unit(i: number, salt: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export class Precipitation {
  readonly view = new Graphics();
  private lastTick = -1;
  /** Performance.now() of the latest strike, or -Infinity; where its bolt lands on the screen (NaN: out of sight, flash only), and how bright. */
  private struck = -Infinity;
  private boltX = NaN;
  private boltY = 0;
  private boltSeed = 1;
  private brightness = 1;

  constructor() {
    this.view.eventMode = 'none';
    this.view.visible = false;
  }

  /** Lightning has struck a unit or building at this screen position (a replicated event: the player saw it). */
  strikeAt(sx: number, sy: number, now: number): void {
    this.struck = now;
    this.boltX = sx;
    this.boltY = sy;
    this.boltSeed = Math.floor(sx * 31 + sy * 17) + 1;
    this.brightness = 1;
  }

  /**
   * Draw this frame from the weather in `state`; `now` in ms, `w` x `h` the screen in pixels. `flashes`: whether the
   * full-screen lightning flash may be drawn. `fancy`: the finer touches (splashes, grit, shimmer, the bolt);
   * without it each weather is just its base effect.
   */
  update(state: ClientState, probe: SkyProbe, now: number, w: number, h: number, reduce: boolean, flashes = true, fancy = true): void {
    const weather = state.weather;
    this.catchUp(state, probe, now);
    const g = this.view;
    // Flash and bolt are both lightning: neither with Reduce motion or with flashes off, and the bolt is a fancy touch.
    const flash = reduce || !flashes ? 0 : Math.max(0, 1 - (now - this.struck) / FLASH_MS) * this.brightness;
    const bolt = fancy && flash > 0 && now - this.struck < BOLT_MS && !Number.isNaN(this.boltX);
    if (weather.strength <= 0 && flash <= 0.01) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.clear();
    const mix = weather.mix;
    const rain = mix[Sky.Rain] / 100;
    const storm = mix[Sky.Storm] / 100;
    const dust = mix[Sky.Dust] / 100;
    const heat = mix[Sky.Heat] / 100;
    const t = reduce ? 0 : now / 1000;
    const drift = (state.wind / 100) * WIND_DRIFT;

    const gloom = GLOOM_ALPHA * rain + STORM_GLOOM_ALPHA * storm;
    if (gloom > 0.002) g.rect(0, 0, w, h).fill({ color: GLOOM_COLOUR, alpha: gloom });
    if (dust > 0.01) g.rect(0, 0, w, h).fill({ color: DUST_COLOUR, alpha: DUST_ALPHA * dust });
    if (heat > 0.01) {
      g.rect(0, 0, w, h).fill({ color: HEAT_COLOUR, alpha: HEAT_ALPHA * heat });
      if (fancy && !reduce) this.drawShimmer(g, heat, t, w, h);
    }
    if (fancy && dust > 0.01) this.drawGrit(g, dust, t, drift, w, h);
    const wet = rain + storm;
    if (wet > 0.01) {
      const alpha = (DROP_ALPHA * rain + STORM_DROP_ALPHA * storm) / wet;
      const slant = drift / FALL_SPEED;
      const drops = Math.floor((RAIN_DROPS * rain + STORM_DROPS * storm) * (reduce ? 0.5 : 1));
      for (let i = 0; i < drops; i++) {
        // Each streak falls at its own pace, so they do not move as a sheet, and wraps round the screen.
        const speed = 0.75 + 0.5 * unit(i, 3);
        const y = (unit(i, 1) * (h + DROP_LENGTH) + t * FALL_SPEED * speed) % (h + DROP_LENGTH) - DROP_LENGTH;
        const x = ((unit(i, 2) * w + t * drift * speed) % w + w) % w;
        const len = DROP_LENGTH * (0.6 + 0.8 * unit(i, 4));
        g.moveTo(x, y).lineTo(x + len * slant, y + len);
      }
      g.stroke({ color: RAIN_COLOUR, width: 1, alpha });
      if (fancy && !reduce) this.drawSplashes(g, probe, Math.floor(RAIN_SPLASHES * rain + STORM_SPLASHES * storm), alpha, slant, t, w, h);
    }
    if (flash > 0) {
      // Two quick beats, like real lightning: bright, a dip, bright again, then a fade.
      const beat = flash > 0.75 ? 1 : flash > 0.6 ? 0.35 : flash / 0.6;
      g.rect(0, 0, w, h).fill({ color: FLASH_COLOUR, alpha: FLASH_ALPHA * beat });
    }
    if (bolt) this.drawBolt(g);
  }

  /** Fast specks of grit blowing along the wind. */
  private drawGrit(g: Graphics, level: number, t: number, drift: number, w: number, h: number): void {
    const n = Math.floor(GRIT * level);
    const speed = GRIT_SPEED + drift;
    for (let i = 0; i < n; i++) {
      const v = 0.6 + 0.8 * unit(i, 41);
      const x = (unit(i, 40) * (w + 40) + t * speed * v) % (w + 40) - 20;
      const y = unit(i, 42) * h + Math.sin(t * 2 + i) * 6;
      const len = 6 + 16 * unit(i, 43);
      g.moveTo(x, y).lineTo(x + len, y + len * 0.12);
    }
    g.stroke({ color: GRIT_COLOUR, width: 1, alpha: GRIT_ALPHA * level });
  }

  /** Faint wavy lines rising off the ground. */
  private drawShimmer(g: Graphics, level: number, t: number, w: number, h: number): void {
    for (let i = 0; i < SHIMMER_LINES; i++) {
      const y = h - ((unit(i, 60) * h + t * 28 * (0.5 + unit(i, 61))) % h);
      const x0 = unit(i, 62) * (w - 100);
      g.moveTo(x0, y);
      for (let k = 1; k <= 6; k++) g.lineTo(x0 + k * 16, y + Math.sin(t * 3 + k * 0.9 + i) * 2.2);
    }
    g.stroke({ color: SHIMMER_COLOUR, width: 1, alpha: SHIMMER_ALPHA * level });
  }

  /**
   * A few drops that visibly land: each falls onto a spot, and bursts into a small flattened ring with a couple of
   * droplets thrown up, then fades while the next drop of its cycle picks a new spot. Not every drop splashes, just
   * enough to show the rain reaching the ground. A drop whose spot is out of the player's sight is not drawn at
   * all, so rain never gives away what the fog hides. Motion only, so Reduce motion skips them.
   */
  private drawSplashes(g: Graphics, probe: SkyProbe, count: number, alpha: number, slant: number, t: number, w: number, h: number): void {
    for (let i = 0; i < count; i++) {
      const period = SPLASH_PERIOD * (0.8 + 0.4 * unit(i, 11));
      const phase = t / period + unit(i, 12);
      const cycle = Math.floor(phase);
      const sec = (phase - cycle) * period; // seconds into this drop's cycle
      const key = i * 7919 + cycle; // a new spot each time round
      const x = unit(key, 13) * w;
      const y = h * (0.08 + 0.9 * unit(key, 14));
      // The same pace and look as a streak (see the loop in `update`): its own speed, length, width and alpha.
      const fall = SPLASH_DROP_HEIGHT / (FALL_SPEED * (0.75 + 0.5 * unit(key, 3)));
      if (sec > fall + SPLASH_LIFE || !probe.visible(x, y)) continue;
      if (sec < fall) {
        // Still in the air: a streak coming down the slant onto the spot.
        const dy = (1 - sec / fall) * SPLASH_DROP_HEIGHT;
        const len = DROP_LENGTH * (0.6 + 0.8 * unit(key, 4));
        g.moveTo(x - dy * slant - len * slant, y - dy - len).lineTo(x - dy * slant, y - dy).stroke({ color: RAIN_COLOUR, width: 1, alpha });
        continue;
      }
      const a = (sec - fall) / SPLASH_LIFE;
      const fade = 1 - a;
      const r = 1.5 + SPLASH_RADIUS * a * (0.7 + 0.6 * unit(key, 15));
      g.ellipse(x, y, r, r * 0.45).stroke({ color: RAIN_COLOUR, width: 1, alpha: Math.min(1, alpha * 2.2) * fade });
      if (a < 0.5) {
        // Two or three tiny droplets thrown up and out, falling back.
        const rise = Math.sin((a / 0.5) * Math.PI) * 5;
        for (let k = 0; k < 3; k++) {
          const dir = (unit(key, 20 + k) - 0.5) * 2;
          g.circle(x + dir * (2 + 9 * a), y - rise, 0.9).fill({ color: RAIN_COLOUR, alpha: Math.min(1, alpha * 2.5) * (1 - a * 2) });
        }
      }
    }
  }

  /**
   * Pick up strikes on the ticks since the last frame. A strike that picks out a unit arrives as a replicated event
   * (see `strikeAt`); one that lands on open ground is worked out here from the tick alone, as the server does, and is
   * drawn where it lands if that tile is in view (elsewhere it only lights the sky).
   */
  private catchUp(state: ClientState, probe: SkyProbe, now: number): void {
    const tick = state.tick;
    const from = this.lastTick < 0 || tick - this.lastTick > MAX_CATCH_UP_TICKS ? tick : this.lastTick + 1;
    this.lastTick = tick;
    const weather = state.weather;
    for (let t = from; t <= tick; t++) {
      const s = weather.lightning(state.seed, t);
      if (s === 0 || strikeIsAimed(s)) continue;
      const spot = strikeSpot(s, state.terrain.width, state.terrain.height);
      this.struck = now;
      this.boltSeed = s;
      if (probe.tileVisible(spot.x, spot.y)) {
        const p = probe.tileToScreen(spot.x + 0.5, spot.y + 0.5);
        this.boltX = p.x;
        this.boltY = p.y;
        this.brightness = 1;
      } else {
        this.boltX = NaN;
        this.brightness = DISTANT_FLASH;
      }
    }
  }

  /** A jagged bolt from the top of the screen down to where it lands, with a glow underneath and a spark where it hits. */
  private drawBolt(g: Graphics): void {
    const steps = 10;
    const x1 = this.boltX;
    const y1 = this.boltY;
    let x = x1 + (unit(this.boltSeed, 5) - 0.5) * 160;
    const points: number[] = [x, -10];
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      x = x + (x1 - x) / (steps - i + 1) + (unit(this.boltSeed, 10 + i) - 0.5) * 36 * (1 - f);
      points.push(x, -10 + (y1 + 10) * f);
    }
    points.push(x1, y1);
    g.poly(points, false).stroke({ color: FLASH_COLOUR, width: 6, alpha: 0.12 });
    g.poly(points, false).stroke({ color: 0xffffff, width: 2, alpha: 0.75 });
    g.circle(x1, y1, 8).fill({ color: FLASH_COLOUR, alpha: 0.3 });
  }
}
