import { mkdtemp, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTracks, sendTrack } from '../src/music';

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wst-music-'));
  await writeFile(join(dir, 'a.mp3'), Buffer.from('0123456789'));
  await writeFile(
    join(dir, 'music_manifest.json'),
    JSON.stringify([
      { filename: 'music/a.mp3', name: 'A', composer: 'C', tags: ['idle', 'menu', 'bogus'] },
      { filename: 'music/missing.mp3', name: 'Missing', tags: ['idle'] },
      { filename: 'music/a.mp3', name: 'Untagged', tags: [] },
      { filename: 'music/../../etc/passwd', name: 'Evil', tags: ['idle'] },
    ]),
  );
  return dir;
}

function fakeResponse() {
  const out = { status: 0, headers: {} as Record<string, unknown> };
  const res = {
    writeHead(status: number, headers: Record<string, unknown> = {}) {
      out.status = status;
      out.headers = headers;
      return res;
    },
    end() {
      return res;
    },
  };
  return { res: res as unknown as ServerResponse, out };
}

describe('music', () => {
  it('lists only existing, tagged, playable tracks', async () => {
    const tracks = await loadTracks(await folder());
    expect(tracks.map((t) => t.file)).toEqual(['a.mp3']);
    expect(tracks[0].tags).toEqual(['idle', 'menu']);
  });

  it('returns nothing when there is no manifest', async () => {
    expect(await loadTracks(await mkdtemp(join(tmpdir(), 'wst-empty-')))).toEqual([]);
  });

  it('refuses files that are not in the manifest', async () => {
    const dir = await folder();
    const { res, out } = fakeResponse();
    await sendTrack({ method: 'GET', headers: {} } as IncomingMessage, res, '../manifest.json', dir);
    expect(out.status).toBe(404);
  });

  it('serves byte ranges', async () => {
    const dir = await folder();
    const { res, out } = fakeResponse();
    await sendTrack({ method: 'HEAD', headers: { range: 'bytes=2-5' } } as IncomingMessage, res, 'a.mp3', dir);
    expect(out.status).toBe(206);
    expect(out.headers['content-range']).toBe('bytes 2-5/10');
  });
});
