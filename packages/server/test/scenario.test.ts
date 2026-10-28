import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { HORDE_FIRST_TICKS } from '@wst/engine';
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
const ownedBy = (match: Match, id: number) => match.sim.unit.dense.filter((e) => match.sim.unit.f.owner[e] === id);
const wipe = (match: Match, id: number) => {
  for (const e of ownedBy(match, id)) match.sim.destroyEntity(e);
};

function singlePlayer(scenario: 'standard' | 'horde' | 'surrounded') {
  const match = new Match({ mode: 'solo', mapId: 'small-basin', scenario });
  const socket = new FakeSocket();
  match.join(asSocket(socket));
  const id = socket.messages.find((m) => m.t === 'welcome')!.playerId as number;
  return { match, socket, id };
}

describe('single-player scenarios', () => {
  it('apply to Single Player, and to Co-op only on a map made for them', () => {
    expect(new Match({ mode: 'solo', scenario: 'horde' }).scenario).toBe('horde');
    expect(new Match({ mode: 'coop', scenario: 'horde' }).scenario).toBe('standard');
    expect(new Match({ mode: 'versus', scenario: 'surrounded' }).scenario).toBe('standard');
    expect(new Match({ mode: 'solo' }).scenario).toBe('standard');
  });

  describe('surrounded', () => {
    it('starts the human in the middle against four corner bots, and holds nobody else', () => {
      const { match, socket, id } = singlePlayer('surrounded');
      ticks(match, 60);
      expect(match.roster()).toHaveLength(5);
      const { width, height } = match.sim.config;
      const mine = ownedBy(match, id).filter((e) => match.sim.stats(e).structure);
      expect(mine.length).toBeGreaterThan(3);
      for (const e of mine) {
        expect(Math.abs(match.sim.tileX(match.sim.pos.f.x[e]) - width / 2)).toBeLessThan(width / 4);
        expect(Math.abs(match.sim.tileY(match.sim.pos.f.y[e]) - height / 2)).toBeLessThan(height / 4);
      }
      for (let b = 1; b <= 4; b++) expect(ownedBy(match, id + b).length).toBeGreaterThan(0);
      expect(match.sim.allied(id + 1, id + 4)).toBe(true);
      expect(match.sim.allied(id, id + 1)).toBe(false);
      const other = new FakeSocket();
      match.join(asSocket(other));
      expect(other.readyState).toBe(3); // full
      expect(socket.messages.some((m) => m.t === 'matchOver')).toBe(false);
    });

    it('is won only when all four bots are destroyed', () => {
      const { match, socket, id } = singlePlayer('surrounded');
      ticks(match, 60);
      for (let b = 1; b <= 3; b++) wipe(match, id + b);
      ticks(match, 10);
      expect(socket.messages.some((m) => m.t === 'matchOver')).toBe(false);
      wipe(match, id + 4);
      ticks(match, 10);
      expect(socket.messages.find((m) => m.t === 'matchOver')!.winners).toEqual([id]);
    });

    it('is lost when the human falls', () => {
      const { match, socket, id } = singlePlayer('surrounded');
      ticks(match, 60);
      wipe(match, id);
      ticks(match, 10);
      const over = socket.messages.find((m) => m.t === 'matchOver')!;
      expect(over.winners).not.toContain(id);
    });
  });

  describe('horde', () => {
    it('has no enemy base, only units that start arriving after a while', () => {
      const { match, id } = singlePlayer('horde');
      ticks(match, 60);
      expect(match.roster().map((r) => r.name)).toContain('The Horde');
      expect(ownedBy(match, id + 1)).toHaveLength(0);
      ticks(match, HORDE_FIRST_TICKS + 300);
      const horde = ownedBy(match, id + 1);
      expect(horde.length).toBeGreaterThan(0);
      expect(horde.every((e) => match.sim.motion.has(e))).toBe(true);
    });

    it('never ends because the horde ran out of units', () => {
      const { match, socket, id } = singlePlayer('horde');
      ticks(match, HORDE_FIRST_TICKS + 300);
      wipe(match, id + 1);
      ticks(match, 20);
      expect(socket.messages.some((m) => m.t === 'matchOver')).toBe(false);
      const entry = socket.messages.filter((m) => m.t === 'scoreboard').at(-1)!.players as { id: number; eliminated: boolean }[];
      expect(entry.find((p) => p.id === id + 1)!.eliminated).toBe(false);
    });

    it('ends when the human falls', () => {
      const { match, socket, id } = singlePlayer('horde');
      ticks(match, 60);
      wipe(match, id);
      ticks(match, 10);
      expect(socket.messages.find((m) => m.t === 'matchOver')!.winners).toEqual([id + 1]);
    });

    it('removes the horde with its human', () => {
      const { match, socket } = singlePlayer('horde');
      ticks(match, 60);
      match.leave(asSocket(socket));
      ticks(match, 3);
      expect(match.roster()).toHaveLength(0);
    });
  });
});

/** A co-op room on a map made for a scenario, with `n` humans, started by the host. */
function coopRoom(mapId: string, n: number) {
  const match = new Match({ mode: 'coop', mapId });
  const sockets = Array.from({ length: n }, () => new FakeSocket());
  for (const s of sockets) match.join(asSocket(s));
  match.receive(asSocket(sockets[0]), { t: 'startGame' });
  ticks(match, 5);
  const ids = sockets.map((s) => s.messages.find((m) => m.t === 'welcome')!.playerId as number);
  return { match, sockets, ids };
}

describe('multiplayer scenarios', () => {
  it('a map made for a scenario sets it in a Co-op room, and Free for all falls back to the default map', () => {
    expect(new Match({ mode: 'coop', mapId: 'last-redoubt' }).scenario).toBe('horde');
    expect(new Match({ mode: 'coop', mapId: 'crossfire' }).scenario).toBe('surrounded');
    expect(new Match({ mode: 'coop', mapId: 'crossfire' }).capacity).toBe(4);
    expect(new Match({ mode: 'coop', mapId: 'crossroads' }).capacity).toBe(2);
    const versus = new Match({ mode: 'versus', mapId: 'last-redoubt' });
    expect(versus.scenario).toBe('standard');
    expect(versus.map.scenario).toBeUndefined();
  });

  describe('horde', () => {
    it('seats up to four humans together against one horde', () => {
      const { match, sockets, ids } = coopRoom('last-redoubt', 4);
      const extra = new FakeSocket();
      match.join(asSocket(extra));
      expect(extra.readyState).toBe(3); // full
      expect(match.roster().filter((r) => r.name === 'The Horde')).toHaveLength(1);
      expect(match.roster()).toHaveLength(5);
      const hqs = ids.map((id) => ownedBy(match, id).filter((e) => match.sim.stats(e).structure));
      for (const list of hqs) expect(list.length).toBeGreaterThan(3);
      const first = hqs.map((list) => ({ x: match.sim.tileX(match.sim.pos.f.x[list[0]]), y: match.sim.tileY(match.sim.pos.f.y[list[0]]) }));
      for (const a of first) for (const b of first) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(40);
      expect(match.sim.allied(ids[0], ids[3])).toBe(true);
      expect(match.sim.allied(ids[0], ids[0] + 1)).toBe(false);
      expect(sockets).toHaveLength(4);
    });

    it('feeds one horde from the far side of the map, and ends only when every human has fallen', () => {
      const { match, sockets, ids } = coopRoom('last-redoubt', 2);
      const horde = ids[0] + 1; // the opposition is made when the first human joins
      ticks(match, HORDE_FIRST_TICKS + 200);
      expect(ownedBy(match, horde).length).toBeGreaterThan(0);
      wipe(match, ids[0]);
      ticks(match, 10);
      expect(sockets[1].messages.some((m) => m.t === 'matchOver')).toBe(false);
      wipe(match, ids[1]);
      ticks(match, 10);
      expect(sockets[1].messages.find((m) => m.t === 'matchOver')!.winners).toEqual([horde]);
    });

    it('is taken down with the last human, and a new room fills from the first seat again', () => {
      const { match, sockets } = coopRoom('last-redoubt', 2);
      match.leave(asSocket(sockets[0]));
      ticks(match, 3);
      expect(match.roster().filter((r) => r.name === 'The Horde')).toHaveLength(1);
      match.leave(asSocket(sockets[1]));
      ticks(match, 3);
      expect(match.roster()).toHaveLength(0);
    });
  });

  describe('surrounded', () => {
    it('puts the humans together in the middle with one bot in each corner, shared by all', () => {
      const { match, ids } = coopRoom('crossfire', 3);
      expect(match.roster()).toHaveLength(3 + 4);
      const { width, height } = match.sim.config;
      for (const id of ids) {
        const mine = ownedBy(match, id).filter((e) => match.sim.stats(e).structure);
        expect(mine.length).toBeGreaterThan(3);
        for (const e of mine) {
          expect(Math.abs(match.sim.tileX(match.sim.pos.f.x[e]) - width / 2)).toBeLessThan(width / 3);
          expect(Math.abs(match.sim.tileY(match.sim.pos.f.y[e]) - height / 2)).toBeLessThan(height / 3);
        }
      }
      const bots = [ids[0] + 1, ids[0] + 2, ids[0] + 3, ids[0] + 4];
      for (const b of bots) expect(ownedBy(match, b).length).toBeGreaterThan(0);
      expect(match.sim.allied(bots[0], bots[3])).toBe(true);
      expect(match.sim.allied(ids[0], bots[0])).toBe(false);
    });

    it('is won by the humans together once all four bots are destroyed', () => {
      const { match, sockets, ids } = coopRoom('pincer', 2);
      for (let b = 1; b <= 4; b++) wipe(match, ids[0] + b);
      ticks(match, 10);
      expect(sockets[0].messages.find((m) => m.t === 'matchOver')!.winners).toEqual(ids);
    });
  });
});
