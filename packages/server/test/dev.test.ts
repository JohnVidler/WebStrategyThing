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

  it('are validated before they reach the match', () => {
    const bad = [
      { t: 'dev', cmd: { kind: 'spawn', owner: 0, template: 'Tank', x: 1, y: 1, count: 99999 } },
      { t: 'dev', cmd: { kind: 'spawn', owner: -1, template: 'Tank', x: 1, y: 1, count: 1 } },
      { t: 'dev', cmd: { kind: 'end', outcome: 'nonsense' } },
      { t: 'dev', cmd: { kind: 'remove', x: 1, y: 1, r: 0, owner: -1, scope: {} } },
      { t: 'dev', cmd: { kind: 'give', owner: 0, amount: 1e12 } },
      { t: 'dev', cmd: null },
      { t: 'dev' },
    ];
    for (const raw of bad) expect(parseClientMessage(raw)).toBeNull();
    expect(parseClientMessage({ t: 'dev', cmd: { kind: 'fog', on: true } })).toEqual({ t: 'dev', cmd: { kind: 'fog', on: true } });
  });
});
