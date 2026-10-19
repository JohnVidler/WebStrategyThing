import { mkdtemp, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSounds, sendSound } from '../src/sound';

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wst-sound-'));
  await writeFile(join(dir, 'a.mp3'), Buffer.from('0123456789'));
  await writeFile(
    join(dir, 'sound_manifest.json'),
    JSON.stringify([
      { filename: 'sound/a.mp3', name: 'A', author: 'Au', License: 'L', tags: ['ui.click', 'Bad Tag', 'ui.confirm'], volume: 3 },
      { filename: 'sound/missing.mp3', name: 'Missing', tags: ['ui.click'] },
      { filename: 'sound/a.mp3', name: 'Untagged', tags: [] },
      { filename: 'sound/../../etc/passwd', name: 'Evil', tags: ['ui.click'] },
      { tag: 'ui.cancel', use: ['ui.click', 'Bad Tag'], only: true, cooldownMs: 50 },
      { tag: 'Not A Tag', use: [] },
      { tag: 'ui.hover', use: [] },
    ]),
  );
  return dir;
}

function fakeResponse() {
  const out = { status: 0, headers: {} as Record<string, unknown>, body: undefined as unknown };
  const res = {
    writeHead(status: number, headers: Record<string, unknown> = {}) {
      out.status = status;
      out.headers = headers;
      return res;
    },
    end(body?: unknown) {
      out.body = body;
      return res;
    },
  };
  return { res: res as unknown as ServerResponse, out };
}

describe('sound', () => {
  it('lists existing, tagged sounds and valid tag entries', async () => {
    const bank = await loadSounds(await folder());
    expect(bank.sounds.map((s) => s.file)).toEqual(['a.mp3']);
    expect(bank.sounds[0]).toMatchObject({ tags: ['ui.click', 'ui.confirm'], license: 'L', volume: 1 });
    expect(bank.tags.map((t) => t.tag)).toEqual(['ui.cancel', 'ui.hover']);
    expect(bank.tags[0]).toMatchObject({ use: ['ui.click'], only: true, cooldownMs: 50 });
  });

  it('returns nothing when there is no manifest', async () => {
    expect(await loadSounds(await mkdtemp(join(tmpdir(), 'wst-empty-')))).toEqual({ sounds: [], tags: [] });
  });

  it('serves only files named in the manifest', async () => {
    const dir = await folder();
    const bad = fakeResponse();
    await sendSound({ method: 'GET', headers: {} } as IncomingMessage, bad.res, '../sound_manifest.json', dir);
    expect(bad.out.status).toBe(404);
    const ok = fakeResponse();
    await sendSound({ method: 'GET', headers: {} } as IncomingMessage, ok.res, 'a.mp3', dir);
    expect(ok.out.status).toBe(200);
    expect(ok.out.headers['content-length']).toBe(10);
  });
});
