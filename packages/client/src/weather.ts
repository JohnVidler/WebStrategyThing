import { DAY_LENGTH, DAYLIGHT_TICKS, Sky } from '@wst/engine';

/**
 * Words for the world readout in the Energy drop-down. The day runs sunrise (phase 0), midday (a quarter
 * of the sunlit part), sunset (end of it) and then night, matching `daylight()`.
 */

/** Time of day from the game tick and sunlight 0..100. `fixed`: the dev tools hold the sunlight, so only the level is used. */
export function timeOfDay(tick: number, sun: number, fixed = false): string {
  const phase = tick % DAY_LENGTH;
  const half = DAYLIGHT_TICKS;
  if (fixed) return sun <= 0 ? 'Night' : sun < 30 ? 'Dusk' : sun < 80 ? 'Afternoon' : 'Midday';
  if (phase >= half) return 'Night';
  if (phase < half / 2) return sun < 30 ? 'Dawn' : sun < 80 ? 'Morning' : 'Midday';
  return sun > 80 ? 'Midday' : sun > 40 ? 'Afternoon' : sun > 12 ? 'Evening' : 'Dusk';
}

/** The sky on its own: '' when dry, else Rain, Storm (Thunderstorm with a strong wind), Heatwave, Dust storm or Mist. */
export function skyWord(sky: number, wind: number): string {
  switch (sky) {
    case Sky.Storm:
      return wind >= 65 ? 'Thunderstorm' : 'Storm';
    case Sky.Rain:
      return 'Rain';
    case Sky.Heat:
      return 'Heatwave';
    case Sky.Dust:
      return 'Dust storm';
    case Sky.Mist:
      return 'Mist';
    default:
      return '';
  }
}

/** The icon, bar colour and tooltip for the sky row of the Energy drop-down. */
export function skyLook(sky: number): { icon: string; colour: string; title: string } {
  switch (sky) {
    case Sky.Storm:
      return { icon: '⛈', colour: '#9aa8ff', title: 'A storm: heavy rain and lightning that briefly stuns what it hits, much less sunlight and a stronger wind' };
    case Sky.Rain:
      return { icon: '🌧', colour: '#8fb4d6', title: 'Rain: less sunlight, a steadier wind and slightly shorter sight' };
    case Sky.Heat:
      return { icon: '🔥', colour: '#ff9f43', title: 'A heatwave: solar panels make more, but the wind drops away' };
    case Sky.Dust:
      return { icon: '🌪', colour: '#d1a35d', title: 'A dust storm: much shorter sight, less sunlight and a strong wind' };
    default:
      return { icon: '🌫', colour: '#c9d3d9', title: 'Mist: much shorter sight, a little less sunlight' };
  }
}

/** Weather from wind strength 0..100, led by the sky while it rains: "Rain, breezy". */
export function weatherOf(wind: number, sky: number = Sky.Dry): string {
  const w = windWord(wind);
  const s = skyWord(sky, wind);
  return s ? `${s}, ${w.toLowerCase()}` : w;
}

function windWord(wind: number): string {
  return wind < 10 ? 'Calm' : wind < 25 ? 'Light breeze' : wind < 45 ? 'Breezy' : wind < 65 ? 'Windy' : wind < 85 ? 'Blustery' : 'Gale';
}
