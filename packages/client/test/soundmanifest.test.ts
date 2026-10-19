import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import { SoundBank, type SoundFileInfo } from '../src/soundbank';

// The sound folder is distributed separately from the repo, so the manifest may be absent (e.g. in CI).
const manifestFiles = import.meta.glob('../../../sound/sound_manifest.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const manifestText = Object.values(manifestFiles)[0];
const manifest = (manifestText ? JSON.parse(manifestText) : []) as Record<string, unknown>[];
// A tag is listed by its own entry or by a sound that carries it.
const listed = new Set([
  ...manifest.filter((e) => typeof e.tag === 'string').map((e) => e.tag as string),
  ...manifest.flatMap((e) => (Array.isArray(e.tags) ? (e.tags as string[]) : [])),
]);
const sources = import.meta.glob('../src/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Every tag the client code asks for: literal playSound() calls, data-sound attributes and the ones built in code. */
function usedTags(): Set<string> {
  const used = new Set<string>();
  for (const source of [...Object.values(sources), indexHtml]) {
    for (const m of source.matchAll(/(?:playSound|setAmbient)\((?:'bed', |'combat', )?(?:[^'`)?:]*\? )?'([a-z0-9_.]+)'/g)) used.add(m[1]);
    for (const m of source.matchAll(/'([a-z]+\.[a-z0-9_.]+)'/g)) if (/^(ui|menu|lobby|match|select|order|build|produce|module|action|camera|combat|death|unit|building|alert|ambient|sting|music)\./.test(m[1])) used.add(m[1]);
    for (const m of source.matchAll(/data-sound="([a-z0-9_.]+)"/g)) used.add(m[1]);
    for (const m of source.matchAll(/dataset\.sound = '([a-z0-9_.]+)'/g)) used.add(m[1]);
  }
  used.delete('none');
  used.delete('module'); // stands for module.on / module.off
  for (const kind of ['gun', 'cannon', 'laser']) used.add(`combat.shot.${kind}`);
  return used;
}

describe.skipIf(!manifestText)('shipped sound manifest', () => {
  it('lists every event as a tag entry, once', () => {
    const tags = manifest.filter((e) => typeof e.tag === 'string').map((e) => e.tag);
    expect(tags.length).toBeGreaterThan(100);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('has no reference cycles or unknown references', () => {
    const sounds = manifest
      .filter((e) => typeof e.filename === 'string')
      .map((e) => ({ file: e.filename, tags: e.tags, volume: 1, pitchVariance: 0, loop: false }) as unknown as SoundFileInfo);
    const bank = new SoundBank({
      sounds,
      tags: manifest.filter((e) => typeof e.tag === 'string').map((e) => ({ cooldownMs: 0, maxVoices: 0, only: false, ...e }) as never),
    });
    expect(bank.warnings).toEqual([]);
  });

  it('has an entry for every tag the client plays', () => {
    const missing = [...usedTags()].filter((t) => !listed.has(t));
    expect(missing).toEqual([]);
  });
});
