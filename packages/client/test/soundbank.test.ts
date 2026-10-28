import { describe, expect, it } from 'vitest';
import { pick, rollVolume, SoundBank, spatialise, type SoundFileInfo, type SoundManifest } from '../src/soundbank';

const file = (name: string, tags: string[]): SoundFileInfo => ({ file: name, name, author: '', url: '', license: '', tags, volume: 1, pitchVariance: 0, loop: false });
const tag = (t: string, use: string[] = [], extra: Partial<SoundManifest['tags'][number]> = {}) => ({ tag: t, use, only: false, cooldownMs: 0, maxVoices: 0, ...extra });
const names = (bank: SoundBank, t: string) => bank.pool(t).sounds.map((s) => s.file).sort();

describe('spatialise', () => {
  it('is full, centred and unfiltered right at the listener', () => {
    expect(spatialise(0, 0, 40)).toEqual({ gain: 1, pan: 0, cutoff: 0 });
  });

  it('is silent out of earshot', () => {
    expect(spatialise(40, 0, 40)).toBeUndefined();
    expect(spatialise(30, 30, 40)).toBeUndefined();
  });

  it('fades faster than linearly and gets duller with distance', () => {
    const half = spatialise(20, 0, 40)!;
    const near = spatialise(5, 0, 40)!;
    expect(half.gain).toBeLessThan(0.25);
    expect(half.cutoff).toBeLessThan(near.cutoff || Infinity);
    expect(spatialise(39, 0, 40)!.cutoff).toBeLessThan(1000);
  });

  it('pans to the side it is on, fully by the screen edge', () => {
    expect(spatialise(-30, 0, 40)!.pan).toBeCloseTo(-0.9);
    expect(spatialise(10, 0, 40)!.pan).toBeGreaterThan(0);
    expect(spatialise(0, 15, 40)!.pan).toBe(0);
  });
});

describe('rollVolume', () => {
  it('returns a fixed volume as it is', () => {
    expect(rollVolume(0.4)).toBe(0.4);
  });

  it('draws from min to max', () => {
    expect(rollVolume({ min: 0.2, max: 0.6 }, () => 0)).toBeCloseTo(0.2);
    expect(rollVolume({ min: 0.2, max: 0.6 }, () => 0.5)).toBeCloseTo(0.4);
    expect(rollVolume({ min: 0.2, max: 0.6 }, () => 1)).toBeCloseTo(0.6);
  });
});

describe('SoundBank', () => {
  it('plays nothing for a placeholder tag', () => {
    const bank = new SoundBank({ sounds: [], tags: [tag('ui.click')] });
    expect(bank.pool('ui.click').sounds).toEqual([]);
    expect(pick(bank.pool('ui.click'))).toBeUndefined();
    expect(bank.pool('never.heard.of').sounds).toEqual([]);
  });

  it('merges own sounds with referenced ones, through chains', () => {
    const bank = new SoundBank({
      sounds: [file('a', ['ui.click']), file('b', ['ui.cancel']), file('c', ['base'])],
      tags: [tag('ui.cancel', ['ui.click']), tag('x', ['ui.cancel']), tag('ui.click', ['base'])],
    });
    expect(names(bank, 'ui.click')).toEqual(['a', 'c']);
    expect(names(bank, 'ui.cancel')).toEqual(['a', 'b', 'c']);
    expect(names(bank, 'x')).toEqual(['a', 'b', 'c']);
  });

  it('ignores own sounds when a tag is "only" a reference', () => {
    const bank = new SoundBank({ sounds: [file('a', ['one']), file('b', ['two'])], tags: [tag('two', ['one'], { only: true })] });
    expect(names(bank, 'two')).toEqual(['a']);
  });

  it('cuts reference cycles and reports them', () => {
    const bank = new SoundBank({ sounds: [file('a', ['p'])], tags: [tag('p', ['q']), tag('q', ['p'])] });
    expect(names(bank, 'q')).toEqual(['a']);
    expect(bank.warnings.some((w) => w.includes('cycle'))).toBe(true);
  });

  it('falls back to the parent tag when a tag has nothing', () => {
    const bank = new SoundBank({ sounds: [file('shot', ['combat.shot']), file('laser', ['combat.shot.laser'])], tags: [tag('combat.shot.gun')] });
    expect(names(bank, 'combat.shot.gun')).toEqual(['shot']);
    expect(names(bank, 'combat.shot.laser')).toEqual(['laser']);
    expect(names(bank, 'combat.shot.cannon')).toEqual(['shot']); // unlisted
  });

  it('takes settings from the tag or its nearest parent, with a group default for position', () => {
    const bank = new SoundBank({
      sounds: [],
      tags: [tag('combat.shot', [], { cooldownMs: 50, maxVoices: 8 }), tag('combat.shot.laser'), tag('building.silo_full', [], { positional: false }), tag('ui.click')],
    });
    expect(bank.pool('combat.shot.laser')).toMatchObject({ cooldownMs: 50, maxVoices: 8, positional: true });
    expect(bank.pool('building.silo_full').positional).toBe(false);
    expect(bank.pool('ui.click').positional).toBe(false);
    expect(bank.pool('unit.spawn').positional).toBe(true);
  });

  it('picks at random without repeating the last choice', () => {
    const bank = new SoundBank({ sounds: [file('a', ['t']), file('b', ['t']), file('c', ['t'])], tags: [] });
    const pool = bank.pool('t');
    let last = '';
    for (let i = 0; i < 200; i++) {
      const s = pick(pool)!.file;
      expect(s).not.toBe(last);
      last = s;
    }
    const seen = new Set(Array.from({ length: 60 }, () => pick(pool)!.file));
    expect(seen.size).toBe(3);
  });
});
