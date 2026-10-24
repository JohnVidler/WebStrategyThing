import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completedLevels, completeLevel, unlockedLevels } from '../src/campaignProgress';

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('campaign progress', () => {
  it('starts with only the first level unlocked', () => {
    expect(completedLevels('a')).toBe(0);
    expect(unlockedLevels('a', 3)).toBe(1);
  });

  it('winning a level unlocks the next, up to the campaign length', () => {
    completeLevel('a', 0);
    expect(unlockedLevels('a', 3)).toBe(2);
    completeLevel('a', 1);
    completeLevel('a', 2);
    expect(completedLevels('a')).toBe(3);
    expect(unlockedLevels('a', 3)).toBe(3);
  });

  it('replaying an earlier level never lowers progress, and campaigns are separate', () => {
    completeLevel('a', 1);
    completeLevel('a', 0);
    expect(completedLevels('a')).toBe(2);
    expect(completedLevels('b')).toBe(0);
  });

  it('survives unreadable storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(completedLevels('a')).toBe(0);
    expect(() => completeLevel('a', 0)).not.toThrow();
  });
});
