import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flashesAllowed,
  flickerAllowed,
  holdFlashingEffects,
  setFullScreenFlashes,
  setLightFlicker,
  setReduceMotion,
  setWeatherDetail,
  weatherDetail,
} from '../src/settings';

/** A tiny localStorage and window, enough for the settings module (the tests run in Node). */
function stubBrowser(): void {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), dispatchEvent: () => true, addEventListener: () => {} });
  vi.stubGlobal('document', { documentElement: { toggleAttribute: () => {} } });
  vi.stubGlobal('Event', class {});
}

describe('flash and flicker settings', () => {
  beforeEach(stubBrowser);
  afterEach(() => vi.unstubAllGlobals());

  it('flashes, flicker and fancy weather are on until the player turns them off', () => {
    expect(flashesAllowed()).toBe(true);
    expect(flickerAllowed()).toBe(true);
    expect(weatherDetail()).toBe('fancy');
    setFullScreenFlashes(false);
    setLightFlicker(false);
    setWeatherDetail('simple');
    expect(flashesAllowed()).toBe(false);
    expect(flickerAllowed()).toBe(false);
    expect(weatherDetail()).toBe('simple');
  });

  it('the flashing-lights warning holds every flash and flicker until it is released, whatever the options say', () => {
    const release = holdFlashingEffects();
    expect(flashesAllowed()).toBe(false);
    expect(flickerAllowed()).toBe(false);
    release();
    release(); // releasing twice does not release someone else's hold
    expect(flashesAllowed()).toBe(true);
    const a = holdFlashingEffects();
    const b = holdFlashingEffects();
    a();
    expect(flashesAllowed()).toBe(false);
    b();
    expect(flickerAllowed()).toBe(true);
  });

  it('Reduce motion still wins', () => {
    setReduceMotion(true);
    expect(flashesAllowed()).toBe(false);
    expect(flickerAllowed()).toBe(false);
  });
});
