import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, extname, resolve } from 'node:path';

/** Where the (separately distributed) music files and music_manifest.json live. */
export const MUSIC_DIR = resolve(process.env.MUSIC_DIR ?? resolve(import.meta.dirname, '../../../music'));
const MANIFEST = 'music_manifest.json';
const TAGS = ['idle', 'combat', 'menu'] as const;

const TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/ogg',
};

export interface MusicTrack {
  /** File name inside MUSIC_DIR; also the id used in the URL. */
  file: string;
  name: string;
  composer: string;
  url: string;
  license: string;
  licenseUrl: string;
  tags: string[];
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** Manifest entries whose file exists and has a playable type. Missing manifest or folder: no music. */
export async function loadTracks(dir = MUSIC_DIR): Promise<MusicTrack[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(resolve(dir, MANIFEST), 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const tracks: MusicTrack[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    // Manifest paths are relative to the project root ("music/x.mp3"): only the file name matters here.
    const file = basename(text(item?.filename).replaceAll('\\', '/'));
    const tags = Array.isArray(item.tags) ? item.tags.filter((t): t is string => (TAGS as readonly string[]).includes(t as string)) : [];
    if (!file || !tags.length || !TYPES[extname(file).toLowerCase()]) continue;
    try {
      if (!(await stat(resolve(dir, file))).isFile()) continue;
    } catch {
      continue;
    }
    tracks.push({
      file,
      name: text(item.name) || file,
      composer: text(item.composer),
      url: text(item.url),
      license: text(item.license),
      licenseUrl: text(item.licenseUrl),
      tags,
    });
  }
  return tracks;
}

/** Serves one manifest track (with Range support, so the browser can seek). */
export async function sendTrack(req: IncomingMessage, res: ServerResponse, file: string, dir = MUSIC_DIR): Promise<void> {
  // Only files named in the manifest are served: no path can escape the folder.
  const track = (await loadTracks(dir)).find((t) => t.file === file);
  if (!track) {
    res.writeHead(404).end();
    return;
  }
  const path = resolve(dir, track.file);
  const { size } = await stat(path);
  const headers = {
    'content-type': TYPES[extname(track.file).toLowerCase()],
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=86400',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  let start = 0;
  let end = size - 1;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(end, Number(range[2]));
    } else {
      start = Math.max(0, size - Number(range[2])); // suffix range: the last N bytes
    }
    if (start > end || start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
  } else {
    res.writeHead(200, { ...headers, 'content-length': size });
  }
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(path, { start, end }).on('error', () => res.destroy()).pipe(res);
}
