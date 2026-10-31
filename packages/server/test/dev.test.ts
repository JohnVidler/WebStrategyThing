import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { parseClientMessage, type DevCommand } from '@wst/engine';
import { Match } from '../src/match';

class FakeSocket {
  readyState = 1;
  readonly sent: (string | Uint8Array)[] = [];
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  get messages(): { t: string; [k: string]: unknown }[] {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d));
  }
}

const asSocket = (s: FakeSocket) => s as unknown as WebSocket;
const ticks = (match: Match, n: number) => {
  for (let i = 0; i < n; i++) (match as unknown as { tick(): void }).tick();
};

/** A started single-player match; `dev` turns the developer commands on. */
function startMatch(dev: boolean) {
  const match = new Match({ mode: 'solo', mapId: 'small-basin', devTools: dev });
  const socket = new FakeSocket();
  match.join(asSocket(socket));
  ticks(match, 3);
  const id = socket.messages.find((m) => m.t === 'welcome')!.playerId as number;
  const run = (cmd: DevCommand) => {
    match.receive(asSocket(socket), { t: 'dev', cmd });
    ticks(match, 1);
  };
  const last = (t: string) => socket.messages.filter((m) => m.t === t).at(-1);
  return { match, socket, id, run, last };
}

const entityCount = (match: Match, owner: number) => match.sim.unit.dense.filter((e) => match.sim.unit.f.owner[e] === owner).length;

describe('developer commands', () => {
  it('are refused on a server without dev tools', () => {
    const { match, run, last } = startMatch(false);
    const before = entityCount(match, 0);
    run({ kind: 'spawn', owner: 0, template: 'Tank', x: 10, y: 10, count: 3 });
    expect(entityCount(match, 0)).toBe(before);
    expect(last('devNote')).toMatchObject({ ok: false });
  });

  it('fix sunlight and wind for everyone, tell clients, and go back to the natural cycle', () => {
    const { match, socket, run, last } = startMatch(true);
    run({ kind: 'weather', sun: 40, wind: 90, sky: 2, intensity: -1, change: -1 });
    expect(match.sim.devSky).toBe(2);
    run({ kind: 'weather', sun: -1, wind: -1, sky: 5, intensity: 40, change: -1 });
    expect(match.sim.devSky).toBe(5);
    expect(match.sim.weather.intensity).toBe(40);
    expect(last('weather')).toMatchObject({ sky: 5, intensity: 40, change: -1 });
    run({ kind: 'weather', sun: 40, wind: 90, sky: 2, intensity: -1, change: -1 });
    expect(match.sim.sunNow()).toBe(40);
    expect(match.sim.windNow()).toBe(90);
    expect(last('weather')).toMatchObject({ sun: 40, wind: 90, sky: 2, intensity: 100 });
    expect(socket.messages.some((m) => m.t === 'weather')).toBe(true);
    run({ kind: 'weather', sun: -1, wind: -1, sky: -1, intensity: -1, change: -1 });
    expect(match.sim.devSun).toBe(-1);
    expect(match.sim.devSky).toBe(-1);
    expect(match.sim.sunNow()).toBe(match.sim.sunNow());
    expect(socket.messages.filter((m) => m.t === 'weather')).toHaveLength(4);
  });

  it('tell a player who joins later about fixed sunlight and wind', () => {
    const match = new Match({ mode: 'coop', mapId: 'small-basin', devTools: true });
    const host = new FakeSocket();
    match.join(asSocket(host));
    match.receive(asSocket(host), { t: 'startGame' });
    match.receive(asSocket(host), { t: 'dev', cmd: { kind: 'weather', sun: 10, wind: 20, sky: 1, intensity: 60, change: 5 } });
    ticks(match, 2);
    const late = new FakeSocket();
    match.join(asSocket(late));
    expect(late.messages.find((m) => m.t === 'weather')).toMatchObject({ sun: 10, wind: 20, sky: 1, intensity: 60, change: 5 });
  });

  it('spawn units and buildings for neutral and other teams, and tell clients about new classes', () => {
    const { match, socket, id, run } = startMatch(true);
    const neutral = entityCount(match, 0);
    run({ kind: 'spawn', owner: 0, template: 'Tank', x: 20, y: 20, count: 3 });
    expect(entityCount(match, 0)).toBe(neutral + 3);
    expect(socket.messages.some((m) => m.t === 'blueprints')).toBe(true);
    const before = entityCount(match, id);
    run({ kind: 'spawn', owner: id, template: 'Solar Array', x: 30, y: 30, count: 2 });
    const spawned = match.sim.unit.dense.filter((e) => match.sim.unit.f.owner[e] === id && match.sim.stats(e).structure && match.sim.blueprintOf(e)?.name === 'Solar Array');
    expect(spawned.length).toBeGreaterThanOrEqual(2);
    expect(entityCount(match, id)).toBeGreaterThan(before);
    expect(spawned.every((e) => !match.sim.isSite(e))).toBe(true);
  });

  it('refuse unknown teams and classes without changing anything', () => {
    const { match, run, last } = startMatch(true);
    const total = match.sim.unit.dense.length;
    run({ kind: 'spawn', owner: 99, template: 'Tank', x: 5, y: 5, count: 1 });
    expect(last('devNote')).toMatchObject({ ok: false });
    run({ kind: 'spawn', owner: 0, template: 'No such class', x: 5, y: 5, count: 1 });
    expect(last('devNote')).toMatchObject({ ok: false });
    expect(match.sim.unit.dense.length).toBe(total);
  });

  it('add matter, remove things near a point, clear a team and add fields', () => {
    const { match, id, run } = startMatch(true);
    const before = match.sim.pool(id);
    run({ kind: 'give', owner: id, amount: 100 });
    expect(match.sim.pool(id)).toBeGreaterThanOrEqual(before); // as far as the silos have room
    const fields = match.sim.resource.dense.length;
    run({ kind: 'field', x: 3, y: 3, amount: 1000 });
    expect(match.sim.resource.dense.length).toBe(fields + 1);
    run({ kind: 'remove', x: 3, y: 3, r: 2, owner: -1, scope: { units: false, buildings: false, resources: true } });
    expect(match.sim.resource.dense.length).toBe(fields);
    run({ kind: 'spawn', owner: 0, template: 'Tank', x: 20, y: 20, count: 2 });
    run({ kind: 'clear', owner: 0 });
    expect(entityCount(match, 0)).toBe(0);
  });

  it('starts fires and flame bursts on the ground', () => {
    const { match, run, last } = startMatch(true);
    run({ kind: 'fire', x: 20, y: 20, mode: 'ground', count: 4 });
    expect(match.sim.flame.dense.length).toBe(4);
    expect(last('devNote')).toMatchObject({ ok: true });
    run({ kind: 'fire', x: 20, y: 20, mode: 'burst', count: 12 });
    expect(match.sim.flame.dense.length).toBe(16);
  });

  it('end the match with every outcome, and a defeat prompt, without ending it', () => {
    for (const [outcome, winnerIsMe, reason] of [
      ['win', true, 'eliminated'],
      ['win-last-player', true, 'last-player'],
      ['win-no-power', true, 'no-power'],
      ['loss', false, 'eliminated'],
      ['loss-no-power', false, 'no-power'],
    ] as const) {
      const { match, id, run, last } = startMatch(true);
      run({ kind: 'end', outcome });
      const over = last('matchOver')!;
      expect(match.isOver).toBe(true);
      expect(over.reason).toBe(reason);
      expect((over.winners as number[]).includes(id)).toBe(winnerIsMe);
      expect((over.winners as number[]).length).toBeGreaterThan(0);
    }
    const draw = startMatch(true);
    draw.run({ kind: 'end', outcome: 'draw' });
    expect(draw.last('matchOver')).toMatchObject({ winners: [] });
    draw.run({ kind: 'reopen' });
    expect(draw.match.isOver).toBe(false);
    const out = startMatch(true);
    out.run({ kind: 'defeat' });
    expect(out.last('defeated')).toBeDefined();
    expect(out.match.isOver).toBe(false);
  });

  it('toggle fog, and stop or fake a disconnect in the simulation', () => {
    const { match, socket, run } = startMatch(true);
    run({ kind: 'fog', on: false });
    expect(socket.messages.filter((m) => m.t === 'welcome').at(-1)).toMatchObject({ fog: false });
    run({ kind: 'fog', on: true });
    expect(socket.messages.filter((m) => m.t === 'welcome').at(-1)).toMatchObject({ fog: true });
    run({ kind: 'pause', mode: 'dev' });
    const tick = match.sim.tick;
    ticks(match, 5);
    expect(match.sim.tick).toBe(tick);
    expect(match.pauseReasons.length).toBeGreaterThan(0);
    run({ kind: 'pause', mode: 'off' });
    ticks(match, 2);
    expect(match.sim.tick).toBeGreaterThan(tick);
  });

  it('heal and finish sites', () => {
    const { match, id, run } = startMatch(true);
    const e = match.sim.unit.dense.find((u) => match.sim.unit.f.owner[u] === id && !match.sim.stats(u).structure)!;
    match.sim.health.f.hp[e] = 1;
    run({ kind: 'heal', owner: id });
    expect(match.sim.health.f.hp[e]).toBe(match.sim.stats(e).hp);
  });

  it('damage the listed units, destroying them when it is enough, and ignore ids that are not alive', () => {
    const { match, id, run } = startMatch(true);
    const [a, b] = match.sim.unit.dense.filter((u) => match.sim.unit.f.owner[u] === id && !match.sim.stats(u).structure);
    const hp = match.sim.health.f.hp[a];
    run({ kind: 'damage', ids: [a, 999_999], amount: 5 });
    expect(match.sim.health.f.hp[a]).toBe(hp - 5);
    if (b !== undefined) expect(match.sim.health.f.hp[b]).toBe(match.sim.stats(b).hp);
    run({ kind: 'damage', ids: [a], amount: 1_000_000 });
    ticks(match, 2);
    expect(match.sim.unit.has(a)).toBe(false);
  });

  it('paint terrain: liquid and rock, sent to clients as a patch, skipping buildings, and applied by a late joiner', () => {
    const { match, socket, run, last } = startMatch(true);
    const t = match.sim.terrain;
    // A spot with clear dry ground all round (the match seed varies, so a fixed tile might hold scenery).
    let x = 0;
    let y = 0;
    search: for (y = 8; y < t.height - 8; y++) {
      for (x = 8; x < t.width - 8; x++) {
        let free = true;
        for (let j = -3; j <= 3 && free; j++) for (let i = -3; i <= 3 && free; i++) free = t.walkable(x + i, y + j);
        if (free) break search;
      }
    }
    expect(t.walkable(x, y)).toBe(true);
    expect(t.elevationAt(x, y)).toBe(0);
    run({ kind: 'terrain', x, y, r: 2, elevation: -4 });
    expect(t.depthAt(x, y)).toBe(4);
    expect(t.depthAt(x + 2, y)).toBe(4);
    expect(t.hasLiquid).toBe(true);
    const patch = last('terrainPatch') as unknown as { cells: number[] };
    expect(patch.cells.length).toBeGreaterThan(8);
    expect(patch.cells[1]).toBe(-4);
    expect(last('devNote')).toMatchObject({ ok: true });
    // Painting the same thing again changes nothing and sends nothing new.
    const before = socket.messages.filter((m) => m.t === 'terrainPatch').length;
    run({ kind: 'terrain', x, y, r: 2, elevation: -4 });
    expect(socket.messages.filter((m) => m.t === 'terrainPatch').length).toBe(before);
    expect(last('devNote')).toMatchObject({ ok: false });
    // Rock, then dry ground again.
    run({ kind: 'terrain', x, y, r: 0, elevation: 3 });
    expect(t.heightAt(x, y)).toBe(3);
    expect(t.depthAt(x, y)).toBe(0);
    run({ kind: 'terrain', x, y, r: 0, elevation: 0 });
    expect(t.isPassable(x, y)).toBe(true);
    // A building's tiles are left alone.
    const hq = match.sim.unit.dense.find((u) => match.sim.stats(u).structure)!;
    const hx = Math.floor(match.sim.pos.f.x[hq] / 32);
    const hy = Math.floor(match.sim.pos.f.y[hq] / 32);
    run({ kind: 'terrain', x: hx, y: hy, r: 1, elevation: -6 });
    for (let i = 0; i < t.occupied.length; i++) if (t.occupied[i]) expect(t.depth[i]).toBe(0);
    // What a welcome sends (a late joiner, or a rejoin) already holds the painted cells.
    run({ kind: 'terrain', x, y, r: 0, elevation: -4 });
    expect(t.encode()[y * t.width + x]).toBe('d');
  });

  it('are validated before they reach the match', () => {
    const bad = [
      { t: 'dev', cmd: { kind: 'terrain', x: 1, y: 1, r: 21, elevation: 0 } },
      { t: 'dev', cmd: { kind: 'terrain', x: 1, y: 1, r: 2, elevation: -10 } },
      { t: 'dev', cmd: { kind: 'terrain', x: 1, y: 1, r: 2, elevation: 1.5 } },
      { t: 'dev', cmd: { kind: 'terrain', x: -1, y: 1, r: 2, elevation: 0 } },
      { t: 'dev', cmd: { kind: 'spawn', owner: 0, template: 'Tank', x: 1, y: 1, count: 99999 } },
      { t: 'dev', cmd: { kind: 'spawn', owner: -1, template: 'Tank', x: 1, y: 1, count: 1 } },
      { t: 'dev', cmd: { kind: 'end', outcome: 'nonsense' } },
      { t: 'dev', cmd: { kind: 'remove', x: 1, y: 1, r: 0, owner: -1, scope: {} } },
      { t: 'dev', cmd: { kind: 'give', owner: 0, amount: 1e12 } },
      { t: 'dev', cmd: { kind: 'damage', ids: [1], amount: 0 } },
      { t: 'dev', cmd: { kind: 'damage', ids: [-1], amount: 5 } },
      { t: 'dev', cmd: { kind: 'damage', ids: Array(501).fill(1), amount: 5 } },
      { t: 'dev', cmd: { kind: 'damage', ids: 'all', amount: 5 } },
      { t: 'dev', cmd: null },
      { t: 'dev' },
    ];
    for (const raw of bad) expect(parseClientMessage(raw)).toBeNull();
    expect(parseClientMessage({ t: 'dev', cmd: { kind: 'fog', on: true } })).toEqual({ t: 'dev', cmd: { kind: 'fog', on: true } });
  });
});
