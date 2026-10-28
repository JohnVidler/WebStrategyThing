import { DAY_LENGTH } from '@wst/engine';

/**
 * Words for the world readout in the Energy drop-down. The day runs sunrise (phase 0), midday (a quarter
 * of the cycle), sunset (half) and then a dark half, matching `daylight()`.
 */

/** Time of day from the game tick and sunlight 0..100. `fixed`: the dev tools hold the sunlight, so only the level is used. */
export function timeOfDay(tick: number, sun: number, fixed = false): string {
  const phase = tick % DAY_LENGTH;
  const half = DAY_LENGTH / 2;
  if (fixed) return sun <= 0 ? 'Night' : sun < 30 ? 'Dusk' : sun < 80 ? 'Afternoon' : 'Midday';
  if (phase >= half) return 'Night';
  if (phase < half / 2) return sun < 30 ? 'Dawn' : sun < 80 ? 'Morning' : 'Midday';
  return sun > 80 ? 'Midday' : sun > 40 ? 'Afternoon' : sun > 12 ? 'Evening' : 'Dusk';
}

/** Weather from wind strength 0..100. */
export function weatherOf(wind: number): string {
  return wind < 10 ? 'Calm' : wind < 25 ? 'Light breeze' : wind < 45 ? 'Breezy' : wind < 65 ? 'Windy' : wind < 85 ? 'Blustery' : 'Gale';
}
