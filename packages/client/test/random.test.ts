import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomHex } from '../src/random';

afterEach(() => vi.unstubAllGlobals());

describe('randomHex', () => {
  it('returns the requested number of hexadecimal bytes', () => {
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(randomHex(6)).toMatch(/^[0-9a-f]{12}$/);
  });

  it('falls back when Web Crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
  });
});