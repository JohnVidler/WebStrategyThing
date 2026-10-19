/** What the server lists at /api/v1/sound (see server/src/sound.ts). */
export interface SoundFileInfo {
  file: string;
  name: string;
  author: string;
  url: string;
  license: string;
  tags: string[];
  volume: number;
  pitchVariance: number;
  loop: boolean;
}

export interface SoundTagInfo {
  tag: string;
  use: string[];
  only: boolean;
  cooldownMs: number;
  maxVoices: number;
  positional?: boolean;
}

export interface SoundManifest {
  sounds: SoundFileInfo[];
  tags: SoundTagInfo[];
}

/** Groups that sound where they happen, unless a tag entry says otherwise. */
const POSITIONAL_GROUPS = new Set(['combat', 'death', 'unit', 'building']);

/**
 * Everything needed to play one tag, resolved ahead of time: the sounds to choose
 * from plus the tag's settings and the small amount of state that rate-limits it.
 */
export interface Pool {
  readonly tag: string;
  readonly sounds: readonly SoundFileInfo[];
  readonly cooldownMs: number;
  readonly maxVoices: number;
  readonly positional: boolean;
  lastIndex: number;
  lastPlayed: number;
  voices: number;
}

const EMPTY: readonly SoundFileInfo[] = [];

/**
 * A tag's sounds are its own files, plus those of every tag it `use`s (chained), or just
 * those when it is `only`. A tag left with nothing falls back to its parent (`a.b.c` -> `a.b`).
 * All of this is worked out once here, so playing is a single map lookup.
 */
export class SoundBank {
  /** Problems found while loading (reference cycles, references to unknown tags). */
  readonly warnings: string[] = [];
  private readonly pools = new Map<string, Pool>();
  private readonly own = new Map<string, SoundFileInfo[]>();
  private readonly entries = new Map<string, SoundTagInfo>();
  private readonly flat = new Map<string, readonly SoundFileInfo[]>();

  constructor(manifest: SoundManifest) {
    for (const sound of manifest.sounds) {
      for (const tag of sound.tags) {
        const list = this.own.get(tag);
        if (list) list.push(sound);
        else this.own.set(tag, [sound]);
      }
    }
    for (const entry of manifest.tags) {
      // Repeated entries for one tag combine: references add up, settings from later ones win.
      const before = this.entries.get(entry.tag);
      this.entries.set(
        entry.tag,
        before
          ? {
              tag: entry.tag,
              use: [...before.use, ...entry.use],
              only: before.only || entry.only,
              cooldownMs: entry.cooldownMs || before.cooldownMs,
              maxVoices: entry.maxVoices || before.maxVoices,
              positional: entry.positional ?? before.positional,
            }
          : entry,
      );
    }
    const known = new Set<string>([...this.own.keys(), ...this.entries.keys()]);
    for (const entry of this.entries.values()) for (const u of entry.use) known.add(u);
    for (const tag of known) this.pools.set(tag, this.build(tag));
  }

  /** The pool for a tag; tags nobody listed fall back to their nearest listed parent, or play nothing. */
  pool(tag: string): Pool {
    let pool = this.pools.get(tag);
    if (!pool) this.pools.set(tag, (pool = this.build(tag)));
    return pool;
  }

  /** Every tag the manifest knows, for tools and tests. */
  tags(): string[] {
    return [...this.pools.keys()];
  }

  private build(tag: string): Pool {
    const settings = this.settings(tag);
    return {
      tag,
      sounds: this.withFallback(tag),
      cooldownMs: settings.cooldownMs,
      maxVoices: settings.maxVoices,
      positional: settings.positional ?? POSITIONAL_GROUPS.has(tag.split('.', 1)[0]),
      lastIndex: -1,
      lastPlayed: -Infinity,
      voices: 0,
    };
  }

  /** A tag's sounds, or its parent's (and so on up) when it has none. */
  private withFallback(tag: string): readonly SoundFileInfo[] {
    const own = this.sounds(tag, []);
    const dot = tag.lastIndexOf('.');
    return own.length || dot < 0 ? own : this.withFallback(tag.slice(0, dot));
  }

  /** The tag's own settings, else those of the nearest parent that has them. */
  private settings(tag: string): { cooldownMs: number; maxVoices: number; positional?: boolean } {
    let cooldownMs = 0;
    let maxVoices = 0;
    let positional: boolean | undefined;
    for (let t = tag; ; t = t.slice(0, t.lastIndexOf('.'))) {
      const e = this.entries.get(t);
      if (e) {
        cooldownMs ||= e.cooldownMs;
        maxVoices ||= e.maxVoices;
        positional ??= e.positional;
      }
      if (!t.includes('.')) break;
    }
    return { cooldownMs, maxVoices, positional };
  }

  /** Own plus referenced sounds, without the parent fallback; `path` is the chain being followed. */
  private sounds(tag: string, path: string[]): readonly SoundFileInfo[] {
    const done = this.flat.get(tag);
    if (done) return done;
    if (path.includes(tag)) {
      this.warnings.push(`sound tag reference cycle: ${[...path, tag].join(' -> ')}`);
      return EMPTY;
    }
    const entry = this.entries.get(tag);
    const list = new Set<SoundFileInfo>(entry?.only ? [] : this.own.get(tag));
    for (const u of entry?.use ?? []) {
      const referenced = this.sounds(u, [...path, tag]);
      // A reference to a tag with no sounds is fine (it may be filled in later), but worth a hint when it is unlisted.
      if (!referenced.length && !this.entries.has(u) && !this.own.has(u)) this.warnings.push(`sound tag "${tag}" uses unknown tag "${u}"`);
      for (const s of referenced) list.add(s);
    }
    const result = [...list];
    // Only cache results that did not depend on a cycle being cut.
    if (!path.length) this.flat.set(tag, result);
    return result;
  }
}

/** Picks a sound at random, never the one chosen last time when there is a choice. Returns undefined for an empty pool. */
export function pick(pool: Pool, random: () => number = Math.random): SoundFileInfo | undefined {
  const n = pool.sounds.length;
  if (n === 0) return undefined;
  let i = Math.floor(random() * n);
  if (n > 1 && i === pool.lastIndex) i = (i + 1 + Math.floor(random() * (n - 1))) % n;
  pool.lastIndex = i;
  return pool.sounds[i];
}
