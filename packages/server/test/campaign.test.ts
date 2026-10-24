import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { campaignMap, loadCampaigns, parseLevel, refreshCampaigns } from '../src/campaign';
import { Match } from '../src/match';

const level = (extra: Record<string, unknown> = {}) => ({
  name: 'One',
  briefing: { title: 'Chapter One', story: ['Hello.'], objectives: ['Win'] },
  map: { layout: 'open', width: 48, height: 48, seed: 7 },
  triggers: [],
  ...extra,
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wst-campaigns-'));
  const write = async (path: string, data: unknown) => {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), typeof data === 'string' ? data : JSON.stringify(data));
  };
  await write('b-second/campaign.json', { name: 'Second', order: 2, maps: ['one'] });
  await write('b-second/maps/one.json', level());
  await write('a-first/campaign.json', { name: 'First', order: 1, summary: 'S', story: ['Intro'], maps: ['one', 'two', 'missing', 'bad-layout', 'broken', '../evil'] });
  await write('a-first/maps/one.json', level());
  await write('a-first/maps/two.json', level({ name: 'Two' }));
  await write('a-first/maps/bad-layout.json', level({ map: { layout: 'swamp' } }));
  await write('a-first/maps/broken.json', '{ nope');
  await write('empty/campaign.json', { name: 'Empty', maps: [] });
  await write('not a valid id/campaign.json', { name: 'Skipped', maps: ['one'] });
  return dir;
}

describe('campaign loading', () => {
  it('lists campaigns by order, with levels in the manifest order, skipping unusable ones', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { info, levels } = await loadCampaigns(await folder());
    expect(info.map((c) => c.id)).toEqual(['a-first', 'b-second']);
    expect(info[0]).toMatchObject({ name: 'First', summary: 'S', story: ['Intro'] });
    expect(info[0].levels.map((l) => l.id)).toEqual(['one', 'two']);
    expect(info[0].levels[0].briefing).toMatchObject({ title: 'Chapter One', story: ['Hello.'], objectives: ['Win'], tips: [] });
    expect([...levels.keys()].sort()).toEqual(['a-first/one', 'a-first/two', 'b-second/one']);
  });

  it('turns a level file into a map definition and keeps triggers server-side', () => {
    const parsed = parseLevel('c', 'one', level({ triggers: [{ id: 't1' }, { nope: true }] }))!;
    expect(parsed.level.map).toMatchObject({ id: 'c/one', width: 48, height: 48, layout: 'open' });
    expect(parsed.level.seed).toBe(7);
    expect(parsed.level.triggers).toEqual([{ id: 't1' }]);
    expect(JSON.stringify(parsed.info)).not.toContain('t1');
  });

  it('a missing folder means no campaigns', async () => {
    expect((await loadCampaigns(join(tmpdir(), 'wst-does-not-exist'))).info).toEqual([]);
  });

  it('the campaigns shipped in the repository all load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    warn.mockClear();
    const { info } = await loadCampaigns();
    expect(info.map((c) => c.id)).toEqual(expect.arrayContaining(['tutorial', 'storyline']));
    for (const c of info) expect(c.levels.length).toBeGreaterThan(0);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('campaign match', () => {
  it('is a private one-human room on the level’s own map, with a bot to beat', async () => {
    const { levels } = await loadCampaigns();
    const lvl = levels.get('tutorial/01-first-steps')!;
    const match = new Match({ mode: 'campaign', level: lvl });
    expect(match.capacity).toBe(1);
    expect(match.map).toMatchObject({ id: 'tutorial/01-first-steps', width: 48, height: 48 });
    const sent: string[] = [];
    const socket = { readyState: 1, send: (d: string) => sent.push(d), close: () => undefined } as unknown as WebSocket;
    match.join(socket);
    expect(match.inLobby).toBe(false);
    expect(match.roster()).toHaveLength(2);
  });

  it('builds the same terrain every time for a fixed seed', async () => {
    const { levels } = await loadCampaigns();
    const lvl = levels.get('storyline/01-landfall')!;
    const a = new Match({ mode: 'campaign', level: lvl });
    const b = new Match({ mode: 'campaign', level: lvl });
    expect(a.sim.unit.dense.length).toBe(b.sim.unit.dense.length);
    expect(a.sim.terrain.encode()).toBe(b.sim.terrain.encode());
  });
});

describe('campaign levels as multiplayer maps', () => {
  it('names the map after its campaign and level, and only finds real levels', async () => {
    await refreshCampaigns();
    const found = campaignMap('tutorial/01-first-steps')!;
    expect(found.map).toMatchObject({ id: 'tutorial/01-first-steps', width: 48, height: 48 });
    expect(found.map.name).toMatch(/^.+\/.+$/);
    expect(campaignMap('tutorial/nope')).toBeUndefined();
    expect(campaignMap('crossroads')).toBeUndefined();
    expect(campaignMap('tutorial/01-first-steps/extra')).toBeUndefined();
  });

  it('runs as a free-for-all and as co-op, not as a private room', async () => {
    await refreshCampaigns();
    const level = campaignMap('storyline/01-landfall')!;
    const versus = new Match({ mode: 'versus', level });
    expect(versus.map.id).toBe('storyline/01-landfall');
    expect(versus.capacity).toBe(4);
    expect(versus.inLobby).toBe(true);
    expect(new Match({ mode: 'coop', level }).capacity).toBe(2);
  });
});

describe('hand-drawn levels', () => {
  const rows = (w: number, h: number, cell = '0') => Array.from({ length: h }, () => cell.repeat(w));

  it('uses the drawn terrain and its size', () => {
    const grid = rows(30, 26);
    grid[5] = '0'.repeat(15) + '5' + '0'.repeat(14);
    const parsed = parseLevel('c', 'drawn', level({ map: { terrain: grid, seed: 3 } }))!;
    expect(parsed.info).toMatchObject({ width: 30, height: 26 });
    expect(parsed.level.map.terrain).toBe(grid.join(''));
    const match = new Match({ mode: 'campaign', level: parsed.level });
    expect(match.sim.terrain.heightAt(15, 5)).toBe(5);
  });

  it('forces the start areas open', () => {
    const parsed = parseLevel('c', 'walled', level({ map: { terrain: rows(48, 48, '4') } }))!;
    const { terrain } = new Match({ mode: 'campaign', level: parsed.level }).sim;
    expect(terrain.heightAt(8, 9)).toBe(0);
    expect(terrain.heightAt(24, 24)).toBe(4);
  });

  it('skips a level whose terrain is ragged, too small or not digits', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(parseLevel('c', 'a', level({ map: { terrain: [...rows(30, 29), '000'] } }))).toBeUndefined();
    expect(parseLevel('c', 'b', level({ map: { terrain: rows(10, 10) } }))).toBeUndefined();
    expect(parseLevel('c', 'c', level({ map: { terrain: rows(30, 30, 'x') } }))).toBeUndefined();
  });
});
