import { describe, expect, it } from 'vitest';
import { daylight, DAY_LENGTH } from '@wst/engine';
import { timeOfDay, weatherOf } from '../src/weather';

describe('world readout', () => {
  it('walks through the day in order and is dark for the second half', () => {
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
    expect([0, 15, 30, 50, 70, 95].map(weatherOf)).toEqual(['Calm', 'Light breeze', 'Breezy', 'Windy', 'Blustery', 'Gale']);
  });
});
