import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readManifest } from '../src/manifest';

describe('readManifest', () => {
  afterEach(() => vi.restoreAllMocks());

  it('warns (once) about unparseable or non-array manifests, and stays quiet for a missing one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dir = await mkdtemp(join(tmpdir(), 'wst-manifest-'));
    expect(await readManifest(dir, 'none.json')).toEqual([]);
    expect(warn).not.toHaveBeenCalled();

    await writeFile(join(dir, 'bad.json'), '[{"a": 1}\n{"b": 2}]');
    expect(await readManifest(dir, 'bad.json')).toEqual([]);
    expect(await readManifest(dir, 'bad.json')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('bad.json');

    await writeFile(join(dir, 'obj.json'), '{}');
    expect(await readManifest(dir, 'obj.json')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);

    await writeFile(join(dir, 'ok.json'), '[1]');
    expect(await readManifest(dir, 'ok.json')).toEqual([1]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
