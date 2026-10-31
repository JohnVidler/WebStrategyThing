import { describe, expect, it } from 'vitest';
import { daylight, DAY_LENGTH, Sky } from '@wst/engine';
import { skyWord, timeOfDay, weatherOf } from '../src/weather';

describe('world readout', () => {
  it('walks through the day in order and ends the cycle in the dark', () => {
    const seen: string[] = [];
    for (let t = 0; t < DAY_LENGTH; t += 10) {
      const w = timeOfDay(t, daylight(t));
      if (seen[seen.length - 1] !== w) seen.push(w);
    }
    expect(seen).toEqual(['Dawn', 'Morning', 'Midday', 'Afternoon', 'Evening', 'Dusk', 'Night']);
  });

  it('uses only the sunlight level when it is held by the dev tools', () => {
    expect(timeOfDay(900, 0, true)).toBe('Night');
    expect(timeOfDay(900, 100, true)).toBe('Midday');
  });

  it('names the wind', () => {
    expect([0, 15, 30, 50, 70, 95].map((w) => weatherOf(w))).toEqual(['Calm', 'Light breeze', 'Breezy', 'Windy', 'Blustery', 'Gale']);
  });

  it('names rain and storms over the wind', () => {
    expect(weatherOf(30, Sky.Rain)).toBe('Rain, breezy');
    expect(weatherOf(50, Sky.Storm)).toBe('Storm, windy');
    expect(weatherOf(80, Sky.Storm)).toBe('Thunderstorm, blustery');
    expect(skyWord(Sky.Dry, 80)).toBe('');
    expect(weatherOf(10, Sky.Heat)).toBe('Heatwave, light breeze');
    expect(weatherOf(60, Sky.Dust)).toBe('Dust storm, windy');
    expect(weatherOf(5, Sky.Mist)).toBe('Mist, calm');
  });
});
