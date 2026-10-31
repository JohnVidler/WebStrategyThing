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

/** The host (first to join) starts the match. */
const begin = (match: Match, host: FakeSocket) => match.receive(asSocket(host), { t: 'startGame' });

/** The computer players of a Single Player or Co-op match (team 2). */
const botIdsOf = (match: Match) => [...match.sim.teams].filter(([, team]) => team === 2).map(([id]) => id);

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

  describe('co-op mode', () => {
    it('runs with one human against a bot and holds two humans at most', () => {
      const match = new Match({ mode: 'coop', mapId: 'small-basin' });
      expect(match.capacity).toBe(2);
      const a = new FakeSocket();
      match.join(asSocket(a));
      begin(match, a);
      ticks(match, 3);
      expect(match.pauseReasons).toHaveLength(0); // one human is enough
      const roster = match.roster();
      expect(roster.map((r) => r.name)).toContain('Bot 1');
      const botId = botIdsOf(match)[0];
      expect(ownedBy(match, botId).length).toBeGreaterThan(0);
      expect(match.sim.cheaters.has(botId)).toBe(false); // it plays by the same rules: it mines and pays for everything
      ticks(match, 600);
      expect(ownedBy(match, botId).filter((e) => match.sim.motion.has(e)).length).toBeGreaterThanOrEqual(5); // its starting units and what it has trained since

      const b = new FakeSocket();
      match.join(asSocket(b));
      ticks(match, 3);
      expect(match.roster()).toHaveLength(3); // two humans and the one bot
      const c = new FakeSocket();
      match.join(asSocket(c));
      expect(c.readyState).toBe(3); // full
    });

    it('does not end at once, and the humans win together when every bot is destroyed', () => {
      const match = new Match({ mode: 'coop', mapId: 'small-basin' });
      const a = new FakeSocket();
      const b = new FakeSocket();
      match.join(asSocket(a));
      match.join(asSocket(b));
      begin(match, a);
      ticks(match, 60);
      expect(a.messages.some((m) => m.t === 'matchOver')).toBe(false);
      const ids = [a, b].map((s) => s.messages.find((m) => m.t === 'welcome')!.playerId as number);
      expect(match.sim.allied(ids[0], ids[1])).toBe(true);
      expect(match.sim.allied(ids[0], botIdsOf(match)[0])).toBe(false);
      for (const id of botIdsOf(match)) for (const e of ownedBy(match, id)) match.sim.destroyEntity(e);
      ticks(match, 10);
      const over = a.messages.find((m) => m.t === 'matchOver')!;
      expect(over.winners).toEqual(ids);
    });

    it('single-player holds one human with one bot, and ends when the bot or the human falls', () => {
      const match = new Match({ mode: 'solo', mapId: 'small-basin' });
      expect(match.capacity).toBe(1);
      const a = new FakeSocket();
      match.join(asSocket(a));
      begin(match, a);
      ticks(match, 60);
      expect(match.pauseReasons).toHaveLength(0);
      expect(match.roster()).toHaveLength(2);
      const b = new FakeSocket();
      match.join(asSocket(b));
      expect(b.readyState).toBe(3); // full
      const id = a.messages.find((m) => m.t === 'welcome')!.playerId as number;
      for (const e of ownedBy(match, botIdsOf(match)[0])) match.sim.destroyEntity(e);
      ticks(match, 10);
      expect(a.messages.find((m) => m.t === 'matchOver')!.winners).toEqual([id]);
    });

    it('takes the human away and empties the room when the last human leaves', () => {
      const match = new Match({ mode: 'coop' });
      const a = new FakeSocket();
      match.join(asSocket(a));
      begin(match, a);
      ticks(match, 3);
      const id = a.messages.find((m) => m.t === 'welcome')!.playerId as number;
      expect(ownedBy(match, botIdsOf(match)[0]).length).toBeGreaterThan(0);
      match.leave(asSocket(a));
      ticks(match, 3);
      expect(ownedBy(match, id)).toHaveLength(0);
      expect(match.empty).toBe(true);
    });

    it('takes the opponents from the room options: names and levels, and a global difficulty for Surrounded', () => {
      const solo = new Match({ mode: 'solo', mapId: 'small-basin', bots: [{ name: 'Ann', level: 0 }, { name: 'Bo', level: 5 }] });
      const a = new FakeSocket();
      solo.join(asSocket(a));
      ticks(solo, 3);
      expect(solo.roster().map((r) => r.name)).toEqual(expect.arrayContaining(['Ann', 'Bo']));
      expect(botIdsOf(solo).every((id) => ownedBy(solo, id).length > 0)).toBe(true);

      const ring = new Match({ mode: 'solo', scenario: 'surrounded', mapId: 'small-basin', difficulty: 5 });
      const b = new FakeSocket();
      ring.join(asSocket(b));
      ticks(ring, 3);
      expect(ring.roster()).toHaveLength(5); // the human and four corner bots
    });
  });

  it('lets a dropped player reconnect by token and resends their state', () => {
    const match = new Match({ mode: 'coop' });
    const first = new FakeSocket();
    match.join(asSocket(first), 'token-one-1234');
    begin(match, first);
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
    const match = new Match({ mode: 'coop' });
    const socket = new FakeSocket();
    match.join(asSocket(socket), 'token-two-1234');
    begin(match, socket);
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

  describe('lobby', () => {
    it('holds players without bases or game time until the host starts', () => {
      const match = new Match();
      const a = new FakeSocket();
      const b = new FakeSocket();
      match.join(asSocket(a));
      match.join(asSocket(b));
      ticks(match, 30);
      expect(match.inLobby).toBe(true);
      expect(match.sim.tick).toBe(0);
      expect(ownedBy(match, 1)).toHaveLength(0);
      expect(a.messages.find((m) => m.t === 'welcome')!.lobby).toBe(true);
      const lobby = b.messages.filter((m) => m.t === 'lobby').at(-1)!;
      expect((lobby.players as { id: number }[]).map((p) => p.id)).toEqual([1, 2]);
      expect(lobby.hostId).toBe(1);
      expect(lobby.minPlayers).toBe(2);
      expect(match.roster()).toHaveLength(2);
    });

    it('only the host can start, and a free-for-all needs two players', () => {
      const match = new Match();
      const a = new FakeSocket();
      const b = new FakeSocket();
      match.join(asSocket(a));
      begin(match, a);
      ticks(match, 3);
      expect(match.inLobby).toBe(true); // alone
      match.join(asSocket(b));
      begin(match, b);
      ticks(match, 3);
      expect(match.inLobby).toBe(true); // not the host
      begin(match, a);
      ticks(match, 3);
      expect(match.inLobby).toBe(false);
      expect(a.messages.some((m) => m.t === 'started')).toBe(true);
      expect(ownedBy(match, 1).length).toBeGreaterThan(0);
      expect(ownedBy(match, 2).length).toBeGreaterThan(0);
      expect(match.sim.tick).toBeGreaterThan(0);
    });

    it('passes hosting on when the host leaves, and a co-op host may start alone', () => {
      const match = new Match({ mode: 'coop', mapId: 'small-basin' });
      const a = new FakeSocket();
      const b = new FakeSocket();
      match.join(asSocket(a), 'token-lobby-aaaa');
      match.join(asSocket(b));
      ticks(match, 2);
      match.leave(asSocket(a)); // no grace period before the start
      ticks(match, 2);
      expect(match.empty).toBe(false);
      const lobby = b.messages.filter((m) => m.t === 'lobby').at(-1)!;
      expect(lobby.hostId).toBe(b.messages.find((m) => m.t === 'welcome')!.playerId);
      begin(match, b);
      ticks(match, 3);
      expect(match.inLobby).toBe(false);
      const idB = b.messages.find((m) => m.t === 'welcome')!.playerId as number;
      expect(ownedBy(match, idB).length).toBeGreaterThan(0);
      expect(ownedBy(match, a.messages.find((m) => m.t === 'welcome')!.playerId as number)).toHaveLength(0);
    });

    describe('computer players', () => {
      const lobbyOf = (s: FakeSocket) => s.messages.filter((m) => m.t === 'lobby').at(-1)! as unknown as {
        bots: { id: number; name: string; level: number }[];
        capacity: number;
        minPlayers: number;
      };
      const send = (m: Match, s: FakeSocket, msg: Parameters<Match['receive']>[1]) => {
        m.receive(asSocket(s), msg);
        ticks(m, 2);
      };

      it('lets the host add, rename, re-level and remove bots, up to the seats of the map', () => {
        const match = new Match({ mapId: 'small-basin' });
        const host = new FakeSocket();
        match.join(asSocket(host));
        ticks(match, 2);
        expect(lobbyOf(host).minPlayers).toBe(2);
        send(match, host, { t: 'addBot', name: '', level: 0 });
        expect(lobbyOf(host).bots).toMatchObject([{ name: 'Bot 1', level: 0 }]);
        expect(lobbyOf(host).minPlayers).toBe(1); // a bot is the second side
        expect(match.capacity).toBe(3); // humans that can still join
        const id = lobbyOf(host).bots[0].id;
        send(match, host, { t: 'editBot', id, name: '<b>Ace</b>', level: 5 });
        expect(lobbyOf(host).bots).toMatchObject([{ name: 'bAce/b', level: 5 }]);
        send(match, host, { t: 'editBot', id, name: 'Ace', level: 99 }); // an unknown level is ignored
        expect(lobbyOf(host).bots).toMatchObject([{ name: 'Ace', level: 5 }]);
        for (let i = 0; i < 5; i++) send(match, host, { t: 'addBot', name: '', level: 2 });
        expect(lobbyOf(host).bots).toHaveLength(3); // four corners, one is the host's
        send(match, host, { t: 'removeBot', id });
        expect(lobbyOf(host).bots).toHaveLength(2);
        send(match, host, { t: 'addBot', name: '', level: 2 });
        expect(lobbyOf(host).bots).toHaveLength(3);
      });

      it('ignores anyone but the host, and a bot cannot be added once the match is on', () => {
        const match = new Match();
        const a = new FakeSocket();
        const b = new FakeSocket();
        match.join(asSocket(a));
        match.join(asSocket(b));
        send(match, b, { t: 'addBot', name: 'Nope', level: 1 });
        expect(lobbyOf(a).bots).toHaveLength(0);
        send(match, a, { t: 'addBot', name: 'Yes', level: 1 });
        expect(lobbyOf(a).bots).toHaveLength(1);
        send(match, a, { t: 'startGame' });
        send(match, a, { t: 'addBot', name: 'Late', level: 1 });
        expect(match.roster().filter((r) => r.name === 'Late')).toHaveLength(0);
      });

      it('lets one human start against a bot, and the bot builds a base', () => {
        const match = new Match({ mapId: 'small-basin' });
        const host = new FakeSocket();
        match.join(asSocket(host));
        send(match, host, { t: 'addBot', name: 'Rival', level: 3 });
        send(match, host, { t: 'startGame' });
        expect(match.inLobby).toBe(false);
        expect(match.pauseReasons).toHaveLength(0);
        const bot = lobbyOf(host).bots[0];
        expect(ownedBy(match, bot.id).length).toBeGreaterThan(0);
        expect(match.roster().map((r) => r.name)).toEqual(expect.arrayContaining(['Rival']));
        ticks(match, 600);
        expect(ownedBy(match, bot.id).filter((e) => match.sim.motion.has(e)).length).toBeGreaterThanOrEqual(5);
      });

      it('offers co-op the same list: one bot to start, none removable past the last, a seat kept for the second human', () => {
        const match = new Match({ mode: 'coop', mapId: 'small-basin' });
        const host = new FakeSocket();
        match.join(asSocket(host));
        ticks(match, 2);
        expect(lobbyOf(host).bots).toHaveLength(1);
        const only = lobbyOf(host).bots[0].id;
        send(match, host, { t: 'removeBot', id: only });
        expect(lobbyOf(host).bots).toHaveLength(1); // a co-op match needs an opponent
        for (let i = 0; i < 4; i++) send(match, host, { t: 'addBot', name: '', level: 1 });
        expect(lobbyOf(host).bots).toHaveLength(2); // four seats: the host, two bots, and one kept for the second human
        expect((lobbyOf(host) as unknown as { canAddBot: boolean }).canAddBot).toBe(false);
        const guest = new FakeSocket();
        match.join(asSocket(guest));
        expect(guest.readyState).toBe(1); // the kept seat
      });
    });

    it('lets people join a match that is already under way', () => {
      const match = new Match();
      const a = new FakeSocket();
      const b = new FakeSocket();
      match.join(asSocket(a));
      match.join(asSocket(b));
      begin(match, a);
      ticks(match, 3);
      match.leave(asSocket(b));
      ticks(match, 2);
      const c = new FakeSocket();
      match.join(asSocket(c));
      ticks(match, 3);
      expect(c.messages.find((m) => m.t === 'welcome')!.lobby).toBe(false);
      expect(ownedBy(match, c.messages.find((m) => m.t === 'welcome')!.playerId as number).length).toBeGreaterThan(0);
    });
  });

  describe('lobby designs', () => {
    it('answers a design upload sent from the waiting room instead of ignoring it', () => {
      const match = new Match({ mapId: 'small-basin' });
      const a = new FakeSocket();
      const b = new FakeSocket();
      match.join(asSocket(a));
      match.join(asSocket(b));
      match.receive(asSocket(a), { t: 'loadDesigns', classes: [], reason: 'upload' });
      ticks(match, 2);
      const reply = a.messages.find((m) => m.t === 'designsLoaded');
      expect(reply).toBeDefined();
      expect((reply!.errors as string[]).length).toBeGreaterThan(0);
    });
  });

  describe('spectating', () => {
    const open = (tokens = false) => {
      const match = new Match({ mapId: 'small-basin' });
      const sockets = [new FakeSocket(), new FakeSocket(), new FakeSocket()];
      sockets.forEach((s, i) => match.join(asSocket(s), tokens ? `token-spec-${i}-1234` : undefined));
      begin(match, sockets[0]);
      ticks(match, 10);
      return { match, a: sockets[0], b: sockets[1], c: sockets[2] };
    };
    const last = (s: FakeSocket, t: string) => s.messages.filter((m) => m.t === t).at(-1);

    it('tells a defeated player the match goes on, then shows them the whole map', () => {
      const { match, a, b, c } = open();
      for (const e of ownedBy(match, 2)) match.sim.destroyEntity(e);
      ticks(match, 10);
      expect(b.messages.some((m) => m.t === 'defeated')).toBe(true);
      expect(a.messages.some((m) => m.t === 'defeated')).toBe(false);
      expect(a.messages.some((m) => m.t === 'matchOver')).toBe(false);

      // Not allowed while still in it.
      match.receive(asSocket(a), { t: 'spectate' });
      ticks(match, 1);
      expect(a.messages.filter((m) => m.t === 'welcome')).toHaveLength(1);

      const before = b.sent.length;
      match.receive(asSocket(b), { t: 'spectate' });
      ticks(match, 1);
      const welcome = last(b, 'welcome')!;
      expect(welcome.spectating).toBe(true);
      expect(welcome.fog).toBe(false);
      expect(b.sent.length).toBeGreaterThan(before);
      // Spectators give no orders: this would otherwise queue a build.
      const bp = match.sim.blueprints.ownedBy(2).find((x) => x.stats.structure)!;
      const sites = match.sim.unit.dense.length;
      match.receive(asSocket(b), { t: 'place', blueprint: bp.id, x: 40, y: 40, builders: [], queue: false });
      ticks(match, 2);
      expect(match.sim.unit.dense.length).toBe(sites);
      expect(c.messages.some((m) => m.t === 'defeated')).toBe(false);
    });

    it('does not make anyone wait for a defeated player who disconnects', () => {
      const { match, a, b } = open(true);
      for (const e of ownedBy(match, 2)) match.sim.destroyEntity(e);
      ticks(match, 10);
      match.leave(asSocket(b));
      ticks(match, 5);
      expect(match.pauseReasons).toEqual([]);
      expect(last(a, 'pause')!.reasons).toEqual([]);
    });

    it('resigning forfeits the forces and offers the spectator view; resigning again leaves', () => {
      const { match, b } = open();
      match.receive(asSocket(b), { t: 'resign' });
      ticks(match, 10);
      expect(ownedBy(match, 2)).toHaveLength(0);
      expect(match.playerCount).toBe(3);
      expect(b.messages.some((m) => m.t === 'resigned')).toBe(false);
      expect(b.messages.some((m) => m.t === 'defeated')).toBe(true);
      match.receive(asSocket(b), { t: 'resign' });
      expect(b.messages.some((m) => m.t === 'resigned')).toBe(true);
      expect(match.playerCount).toBe(2);
    });

    it('a forfeit defeats the player at once, even on the first tick, so closing the tab starts no wait', () => {
      const match = new Match({ mapId: 'small-basin' });
      const sockets = [new FakeSocket(), new FakeSocket()];
      sockets.forEach((s, i) => match.join(asSocket(s), `token-forfeit-${i}-1234`));
      begin(match, sockets[0]);
      ticks(match, 1);
      match.receive(asSocket(sockets[1]), { t: 'forfeit' });
      expect(sockets[1].messages.some((m) => m.t === 'defeated')).toBe(true);
      match.leave(asSocket(sockets[1]));
      ticks(match, 3);
      expect(match.pauseReasons.some((r) => r.includes('disconnected'))).toBe(false);
    });

    it('leave frees the seat at once, and a forfeit is refused once defeated', () => {
      const { match, b } = open();
      match.receive(asSocket(b), { t: 'forfeit' });
      ticks(match, 2);
      const defeats = b.messages.filter((m) => m.t === 'defeated').length;
      match.receive(asSocket(b), { t: 'forfeit' });
      expect(b.messages.filter((m) => m.t === 'defeated')).toHaveLength(defeats);
      match.receive(asSocket(b), { t: 'leave' });
      expect(b.messages.some((m) => m.t === 'resigned')).toBe(true);
      expect(match.playerCount).toBe(2);
    });

    it('lets the losers watch once the match is decided', () => {
      const { match, a, c } = open();
      for (const id of [2, 3]) for (const e of ownedBy(match, id)) match.sim.destroyEntity(e);
      ticks(match, 10);
      expect(last(a, 'matchOver')!.winner).toBe(1);
      match.receive(asSocket(c), { t: 'spectate' });
      ticks(match, 1);
      expect(last(c, 'welcome')!.spectating).toBe(true);
    });
  });

  it('runs with two players, and pauses with the reason when one disconnects', () => {
    const match = new Match();
    const a = new FakeSocket();
    const b = new FakeSocket();
    match.join(asSocket(a), 'token-aaaa-1111');
    match.join(asSocket(b), 'token-bbbb-2222');
    begin(match, a);
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
    begin(match, connected);
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
    begin(match, socket);
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
    begin(match, a);
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
    begin(match, socket);
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
    begin(match, a);
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
    begin(match, a);
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
    begin(match, a);
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

  it('a bug in the simulation ends that match, not the server', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const match = new Match({ mapId: 'small-basin' });
    const a = new FakeSocket();
    match.join(asSocket(a));
    begin(match, a);
    (match as unknown as { tick(): void }).tick = () => {
      throw new TypeError('boom');
    };
    match.start();
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(error).toHaveBeenCalled();
    expect(a.messages.some((m) => m.t === 'error')).toBe(true);
    expect(a.readyState).toBe(3);
    expect(match.empty).toBe(true); // the room sweep removes it
    const late = new FakeSocket();
    match.join(asSocket(late));
    expect(late.readyState).toBe(3);
    error.mockRestore();
  });
});
