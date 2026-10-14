import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
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
  /** Parsed JSON control messages received so far. */
  get messages(): { t: string; [k: string]: unknown }[] {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d));
  }
}

const asSocket = (s: FakeSocket) => s as unknown as WebSocket;

function ticks(match: Match, n: number): void {
  for (let i = 0; i < n; i++) (match as unknown as { tick(): void }).tick();
}

const ownedBy = (match: Match, id: number) => match.sim.unit.dense.filter((e) => match.sim.unit.f.owner[e] === id);

describe('match', () => {
  afterEach(() => vi.useRealTimers());

  it('creates a room with the selected map dimensions', () => {
    const match = new Match({ mapId: 'twin-ridges' });
    const socket = new FakeSocket();
    match.join(asSocket(socket));
    const welcome = socket.messages.find((message) => message.t === 'welcome')!;
    expect(match.map.id).toBe('twin-ridges');
    expect(welcome.width).toBe(80);
    expect(welcome.height).toBe(56);
  });

  it('lets a dropped player reconnect by token and resends their state', () => {
    const match = new Match();
    const first = new FakeSocket();
    match.join(asSocket(first), 'token-one-1234');
    ticks(match, 3);
    const id = first.messages.find((m) => m.t === 'welcome')!.playerId as number;
    const units = ownedBy(match, id).length;
    expect(units).toBeGreaterThan(0);

    match.leave(asSocket(first));
    ticks(match, 20);
    expect(ownedBy(match, id)).toHaveLength(units); // the base is kept for them
    expect(match.empty).toBe(false);

    const second = new FakeSocket();
    match.join(asSocket(second), 'token-one-1234');
    const kinds = second.messages.map((m) => m.t);
    expect(second.messages.find((m) => m.t === 'welcome')!.playerId).toBe(id);
    expect(kinds).toContain('blueprints');
    expect(kinds).toContain('program');
    expect(kinds).toContain('tasks');
    expect(second.sent.some((d) => typeof d !== 'string')).toBe(true); // a full snapshot
    expect(match.playerCount).toBe(1);
  });

  it('removes a player who does not come back in time', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const match = new Match();
    const socket = new FakeSocket();
    match.join(asSocket(socket), 'token-two-1234');
    ticks(match, 3);
    const id = socket.messages.find((m) => m.t === 'welcome')!.playerId as number;
    match.leave(asSocket(socket));
    ticks(match, 20);
    expect(ownedBy(match, id).length).toBeGreaterThan(0);
    vi.advanceTimersByTime(61_000);
    ticks(match, 3);
    expect(ownedBy(match, id)).toHaveLength(0);
    expect(match.empty).toBe(true);
  });

  it('pauses while only one player is connected, but still sets up their base', () => {
    const match = new Match();
    const socket = new FakeSocket();
    match.join(asSocket(socket));
    ticks(match, 30);
    expect(match.sim.tick).toBe(0);
    expect(ownedBy(match, socket.messages.find((m) => m.t === 'welcome')!.playerId as number).length).toBeGreaterThan(0);
    const pause = socket.messages.filter((m) => m.t === 'pause').at(-1)!;
    expect((pause.reasons as string[]).join(' ')).toMatch(/another player/);
  });

  it('runs with two players, and pauses with the reason when one disconnects', () => {
    const match = new Match();
    const a = new FakeSocket();
    const b = new FakeSocket();
    match.join(asSocket(a), 'token-aaaa-1111');
    match.join(asSocket(b), 'token-bbbb-2222');
    ticks(match, 10);
    expect(match.sim.tick).toBeGreaterThan(0);
    expect(match.pauseReasons).toEqual([]);
    expect(a.messages.filter((m) => m.t === 'pause').at(-1)!.reasons).toEqual([]);

    match.leave(asSocket(b));
    const frozen = match.sim.tick;
    ticks(match, 20);
    expect(match.sim.tick).toBe(frozen);
    const reasons = a.messages.filter((m) => m.t === 'pause').at(-1)!.reasons as string[];
    expect(reasons.some((r) => r.includes('disconnected'))).toBe(true);

    const back = new FakeSocket();
    match.join(asSocket(back), 'token-bbbb-2222');
    ticks(match, 5);
    expect(match.sim.tick).toBeGreaterThan(frozen);
    expect(back.messages.filter((m) => m.t === 'pause').at(-1)!.reasons).toEqual([]);
  });

  it('reports a reconnect countdown for disconnected players', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const match = new Match();
    const connected = new FakeSocket();
    const disconnected = new FakeSocket();
    match.join(asSocket(connected), 'token-live-1111');
    match.join(asSocket(disconnected), 'token-away-2222');
    ticks(match, 5);

    match.leave(asSocket(disconnected));
    ticks(match, 1);
    const pause = connected.messages.filter((m) => m.t === 'pause').at(-1)!;
    expect(pause.away).toEqual([{ name: 'Player 2', remainingMs: 60_000 }]);

    vi.advanceTimersByTime(1100);
    ticks(match, 1);
    const updated = connected.messages.filter((m) => m.t === 'pause').at(-1)!;
    expect((updated.away as { remainingMs: number }[])[0].remainingMs).toBe(58_900);
  });

  it('removes a player immediately when they resign', () => {
    const match = new Match();
    const socket = new FakeSocket();
    match.join(asSocket(socket), 'token-resign-1234');
    ticks(match, 3);
    const id = socket.messages.find((m) => m.t === 'welcome')!.playerId as number;

    match.receive(asSocket(socket), { t: 'resign' });
    expect(match.playerCount).toBe(0);
    expect(match.empty).toBe(true);
    expect(socket.messages.some((m) => m.t === 'resigned')).toBe(true);
    ticks(match, 1);
    expect(ownedBy(match, id)).toHaveLength(0);
  });

  it('reports game time and scores for the room list', () => {
    const match = new Match();
    const a = new FakeSocket();
    const b = new FakeSocket();
    match.join(asSocket(a));
    match.join(asSocket(b));
    ticks(match, 25);
    expect(match.elapsedSeconds).toBe(Math.floor(match.sim.tick / 10));
    const roster = match.roster();
    expect(roster).toHaveLength(2);
    expect(roster.every((p) => p.score > 0 && p.connected)).toBe(true);
  });

  it('players without a token are removed immediately', () => {
    const match = new Match();
    const socket = new FakeSocket();
    match.join(asSocket(socket));
    ticks(match, 3);
    const id = socket.messages.find((m) => m.t === 'welcome')!.playerId as number;
    match.leave(asSocket(socket));
    ticks(match, 2);
    expect(ownedBy(match, id)).toHaveLength(0);
  });

  it('announces the winner once only one side has anything left', () => {
    const match = new Match();
    const a = new FakeSocket();
    const b = new FakeSocket();
    match.join(asSocket(a));
    match.join(asSocket(b));
    ticks(match, 10);
    const idA = a.messages.find((m) => m.t === 'welcome')!.playerId as number;
    const idB = b.messages.find((m) => m.t === 'welcome')!.playerId as number;
    expect(a.messages.some((m) => m.t === 'matchOver')).toBe(false);

    for (const e of ownedBy(match, idB)) match.sim.destroyEntity(e);
    ticks(match, 10);
    const over = a.messages.filter((m) => m.t === 'matchOver');
    expect(over).toHaveLength(1);
    expect(over[0].winner).toBe(idA);
    expect(over[0].reason).toBe('eliminated');
    const standings = over[0].standings as { id: number; eliminated: boolean }[];
    expect(standings.find((p) => p.id === idB)?.eliminated).toBe(true);
    ticks(match, 20);
    expect(a.messages.filter((m) => m.t === 'matchOver')).toHaveLength(1);
  });

  it('names the last remaining player the winner once the others have gone', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const match = new Match();
    const a = new FakeSocket();
    const b = new FakeSocket();
    match.join(asSocket(a), 'token-aaaa-1111');
    match.join(asSocket(b), 'token-bbbb-2222');
    ticks(match, 10);
    const idA = a.messages.find((m) => m.t === 'welcome')!.playerId as number;
    match.leave(asSocket(b));
    ticks(match, 5);
    expect(a.messages.some((m) => m.t === 'matchOver')).toBe(false); // still within the grace period
    vi.advanceTimersByTime(61_000);
    ticks(match, 3);
    const over = a.messages.filter((m) => m.t === 'matchOver');
    expect(over).toHaveLength(1);
    expect(over[0].winner).toBe(idA);
    expect(over[0].reason).toBe('last-player');
  });

  it('does not end a match before any game time has passed', () => {
    const match = new Match();
    const a = new FakeSocket();
    match.join(asSocket(a));
    ticks(match, 5);
    expect(match.sim.tick).toBe(0);
    expect(a.messages.some((m) => m.t === 'matchOver')).toBe(false);
  });

  it('ends the match when only one player still has powered units', () => {
    const match = new Match();
    const a = new FakeSocket();
    const b = new FakeSocket();
    match.join(asSocket(a));
    match.join(asSocket(b));
    ticks(match, 10);
    const idA = a.messages.find((m) => m.t === 'welcome')!.playerId as number;
    const idB = b.messages.find((m) => m.t === 'welcome')!.playerId as number;
    for (const e of ownedBy(match, idB)) if (match.sim.motion.has(e)) match.sim.destroyEntity(e);
    expect(ownedBy(match, idB).length).toBeGreaterThan(0); // buildings remain
    ticks(match, 10);
    const over = a.messages.filter((m) => m.t === 'matchOver');
    expect(over).toHaveLength(1);
    expect(over[0].winner).toBe(idA);
    expect(over[0].reason).toBe('no-power');
  });
});
