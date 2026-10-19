import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, extname, resolve } from 'node:path';
import { readManifest } from './manifest';

/** Where the sound effect files and sound_manifest.json live. */
export const SOUND_DIR = resolve(process.env.SOUND_DIR ?? resolve(import.meta.dirname, '../../../sound'));
const MANIFEST = 'sound_manifest.json';
const TAG = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

const TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/ogg',
};

/** A sound file that plays on every tag in `tags`. */
export interface SoundFile {
  /** File name inside SOUND_DIR; also the id used in the URL. */
  file: string;
  name: string;
  author: string;
  url: string;
  license: string;
  tags: string[];
  /** 0..1, default 1. */
  volume: number;
  /** Random pitch spread, 0.05 = up to 5% either way. */
  pitchVariance: number;
  loop: boolean;
}

/**
 * Settings and references for one tag. With `use: []` and no sounds of its own it
 * plays nothing, which is how unfilled events are listed in the manifest.
 */
export interface SoundTag {
  tag: string;
  /** Tags whose sounds this one also plays. */
  use: string[];
  /** Ignore this tag's own sounds and play only what `use` names. */
  only: boolean;
  /** Minimum gap between plays of this tag. */
  cooldownMs: number;
  /** How many of this tag may sound at once (0 = no limit). */
  maxVoices: number;
  /** Attenuated and panned by where it happens; undefined = the client's default for the tag's group. */
  positional?: boolean;
}

export interface SoundBank {
  sounds: SoundFile[];
  tags: SoundTag[];
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const tagList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string' && TAG.test(t)) : []);

/**
 * The manifest is an array of two kinds of entry: sound files (with `filename`) and
 * tag entries (with `tag`). Sound entries whose file is missing are dropped; a missing
 * manifest or folder means no sounds at all.
 */
export async function loadSounds(dir = SOUND_DIR): Promise<SoundBank> {
  const bank: SoundBank = { sounds: [], tags: [] };
  const raw = await readManifest(dir, MANIFEST);
  for (const item of raw as Record<string, unknown>[]) {
    if (typeof item !== 'object' || item === null) continue;
    if (typeof item.tag === 'string') {
      if (!TAG.test(item.tag)) continue;
      bank.tags.push({
        tag: item.tag,
        use: tagList(item.use),
        only: item.only === true,
        cooldownMs: num(item.cooldownMs, 0, 0, 60_000),
        maxVoices: Math.floor(num(item.maxVoices, 0, 0, 64)),
        positional: typeof item.positional === 'boolean' ? item.positional : undefined,
      });
      continue;
    }
    // Manifest paths may be relative to the project root ("sound/x.mp3"): only the file name matters here.
    const file = basename(text(item.filename).replaceAll('\\', '/'));
    const tags = tagList(item.tags);
    if (!file || !tags.length || !TYPES[extname(file).toLowerCase()]) continue;
    try {
      if (!(await stat(resolve(dir, file))).isFile()) continue;
    } catch {
      continue;
    }
    bank.sounds.push({
      file,
      name: text(item.name) || file,
      author: text(item.author),
      url: text(item.url),
      license: text(item.license) || text(item.License),
      tags,
      volume: num(item.volume, 1, 0, 1),
      pitchVariance: num(item.pitchVariance, 0, 0, 0.5),
      loop: item.loop === true,
    });
  }
  return bank;
}

/** Serves one manifest sound. Effects are short, so the whole file is sent and cached. */
export async function sendSound(req: IncomingMessage, res: ServerResponse, file: string, dir = SOUND_DIR): Promise<void> {
  // Only files named in the manifest are served: no path can escape the folder.
  const sound = (await loadSounds(dir)).sounds.find((s) => s.file === file);
  if (!sound) {
    res.writeHead(404).end();
    return;
  }
  const body = await readFile(resolve(dir, sound.file));
  res.writeHead(200, {
    'content-type': TYPES[extname(sound.file).toLowerCase()],
    'content-length': body.length,
    'cache-control': 'public, max-age=86400',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}
