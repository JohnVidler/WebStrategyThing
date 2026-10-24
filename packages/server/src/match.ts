import {
  BlueprintError,
  CommandError,
  cpuProfile,
  FlowError,
  CORNERS,
  createMatch,
  devClear,
  devFinishSites,
  devGive,
  devHeal,
  devRemove,
  devSpawn,
  NEUTRAL,
  mapById,
  messageAllowed,
  parseGameMode,
  setUpBot,
  type BotPlayer,
  type GameMode,
  encodeTick,
  Interest,
  MAX_CLASSES_PER_PLAYER,
  MAX_UNITS_PER_PLAYER,
  STARTING_CREDITS,
  setUpPlayer,
  TICK_RATE,
  TILE,
  toInfo,
  visibleTo,
  type Blueprint,
  type ClientMessage,
  type ClientPhase,
  type DevCommand,
  type DevOutcome,
  type NetworkInfo,
  type MatchEndReason,
  type ScoreEntry,
  type ServerMessage,
  type MapDefinition,
} from '@wst/engine';
import { WebSocket } from 'ws';

/** How long a disconnected player's base is kept for them to come back to. */
const RECONNECT_GRACE_MS = 60_000;
/** How often (ticks) power network totals are reported to their owners. */
const NETWORK_REPORT_TICKS = 5;

/** Anything that owns forces and is scored: a connected player or a bot. */
interface Side {
  readonly id: number;
  name: string;
  /** Has owned at least one unit or building (so a side still being set up isn't eliminated). */
  hadForces: boolean;
}

/** A co-op mode bot, paired with the human it trains. */
interface BotSide extends Side {
  readonly corner: number;
  controller?: BotPlayer;
}

interface Player extends Side {
  /** Lets a dropped connection pick its player back up (see Match.join). */
  token?: string;
  socket: WebSocket;
  lastCredits: string;
  /** What this client currently holds of the world (fog of war). */
  readonly interest: Interest;
  lastNetworks: string;
  /** Has no forces left while the match goes on; leaving no longer waits for a reconnect. */
  defeated: boolean;
  /** Sees the whole map (fog lifted) and gives no orders. */
  spectating: boolean;
}

export interface MatchOptions {
  /** Fog of war: each client only receives what its units and buildings can see. Default on. */
  readonly fog?: boolean;
  /** The selected room map; defaults to Crossroads. */
  readonly mapId?: string;
  /** Default 'versus'. */
  readonly mode?: GameMode;
  /** Campaign mode: the level's own map definition and terrain seed (replaces `mapId`). */
  readonly level?: { readonly map: MapDefinition; readonly seed: number };
  /** Accept the developer commands of the client's Dev Options menu (cheats). Default off: the server sets it from WST_DEV_TOOLS=1. */
  readonly devTools?: boolean;
}

/**
 * All mutations happen at tick boundaries via this queue, so the simulation
 * stays deterministic: (seed + ordered command log) fully reproduces a match.
 * That log is also what you'd persist for replays.
 */
type Command =
  | { kind: 'join'; player: Player }
  | { kind: 'leave'; player: Player }
  | { kind: 'forfeit'; player: Player }
  | { kind: 'msg'; player: Player; msg: ClientMessage };

function ignoreRefused(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (!(err instanceof CommandError)) throw err;
  }
}

export class Match {
  readonly map: MapDefinition;
  readonly sim: ReturnType<typeof createMatch>;
  private readonly players = new Map<WebSocket, Player>();
  /** Per building: energy taken minus given since the last network report. */
  private readonly flowSums = new Map<number, number>();
  private readonly pending: Command[] = [];
  /** Corner slots: player id per corner, 0 = free. */
  private readonly corners = CORNERS.map(() => 0);
  private nextPlayerId = 1;
  private lastScoreboard = '';
  /** Disconnected players who may still reconnect, by token. */
  private readonly away = new Map<string, { player: Player; since: number }>();
  private over = false;
  /** False while players gather in the lobby: no bases exist and time stands still until the host starts. */
  private started: boolean;
  /** Players who have ever had forces: a match only counts once two sides have. */
  private readonly fielded = new Set<number>();
  private timer: NodeJS.Timeout | undefined;
  /** The tick loop threw: the match is over and its room is removed at the next sweep. */
  private crashed = false;
  private fog: boolean;
  private readonly devTools: boolean;
  /** Set from the Dev Options menu: the simulation stands still, or shows the waiting-for-a-player notice. */
  private devPause: 'off' | 'dev' | 'disconnect' = 'off';
  readonly mode: GameMode;
  /** Co-op mode: each human's bot, by human player id. */
  private readonly bots = new Map<number, BotSide>();

  constructor(options: MatchOptions = {}) {
    this.mode = parseGameMode(options.mode);
    this.started = this.single;
    this.map = options.level?.map ?? mapById(options.mapId);
    this.sim = createMatch(options.level?.seed ?? 0x5eed, this.map);
    this.fog = options.fog ?? true;
    this.devTools = options.devTools ?? false;
    this.sim.requirePlacementVision = this.fog;
  }

  get playerCount(): number {
    return this.players.size;
  }

  /** Most human players a match holds: one per map corner, or two in co-op mode (the other corners hold bots). */
  get capacity(): number {
    return this.single ? 1 : this.mode === 'coop' ? 2 : this.corners.length;
  }

  /** Solo and campaign rooms: private, one human, no lobby. */
  private get single(): boolean {
    return this.mode === 'solo' || this.mode === 'campaign';
  }

  /** Solo and co-op rooms give every human a bot of their own and a team with the other humans. */
  private get botted(): boolean {
    return this.mode !== 'versus';
  }

  /** A random free start corner, so nobody knows where their enemies begin. -1 if none is free. */
  private randomFreeCorner(): number {
    const free = this.corners.flatMap((id, c) => (id === 0 ? [c] : []));
    return free.length ? free[Math.floor(Math.random() * free.length)] : -1;
  }

  /** Bot modes need a corner for the human and another for their bot. */
  private freeCorner(): number {
    const sides = this.botted ? 2 : 1;
    const free = this.corners.filter((id) => id === 0).length;
    if (free < sides || (this.corners.length - free) / sides >= this.capacity) return -1;
    return this.randomFreeCorner();
  }

  get isOver(): boolean {
    return this.over;
  }

  /** Players are still gathering; the host has not started the match. */
  get inLobby(): boolean {
    return !this.started;
  }

  /** Fewest players the host may start with: bot modes run with one human, a free-for-all needs two. */
  get minPlayers(): number {
    return this.botted ? 1 : 2;
  }

  /** The lobby host: whoever has been present longest. */
  private get host(): Player | undefined {
    let host: Player | undefined;
    for (const p of this.players.values()) if (!host || p.id < host.id) host = p;
    return host;
  }

  start(): void {
    const stepMs = 1000 / TICK_RATE;
    let next = performance.now() + stepMs;
    const loop = () => {
      const now = performance.now();
      let steps = 0;
      while (now >= next && steps < 4) {
        try {
          this.tick();
        } catch (err) {
          this.crash(err);
          return;
        }
        next += stepMs;
        steps++;
      }
      // Too far behind: drop time rather than spiral.
      if (now - next > stepMs * 4) next = now + stepMs;
      this.timer = setTimeout(loop, Math.max(0, next - performance.now()));
    };
    this.timer = setTimeout(loop, stepMs);
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  /** A bug in the simulation ends this match only: log it, tell the players, and close their connections (the room empties and is removed). */
  private crash(err: unknown): void {
    console.error(`Match crashed at tick ${this.sim.tick}:`, err);
    this.crashed = true;
    this.stop();
    for (const p of this.players.values()) {
      this.send(p, { t: 'error', message: 'The match stopped because of a server error. Sorry!' });
      p.socket.close(1011, 'Match crashed');
    }
  }

  join(socket: WebSocket, token?: string): void {
    if (this.crashed) {
      socket.close(1011, 'Match crashed');
      return;
    }
    const back = token ? this.away.get(token) : undefined;
    if (token && back) {
      this.away.delete(token);
      this.rejoin(socket, back.player);
      return;
    }
    const corner = this.freeCorner();
    if (corner < 0) {
      socket.close(1013, 'Match full');
      return;
    }
    const player: Player = {
      id: this.nextPlayerId++,
      name: '',
      hadForces: false,
      socket,
      lastCredits: '',
      interest: new Interest(),
      lastNetworks: '',
      defeated: false,
      spectating: false,
    };
    player.name = `Player ${player.id}`;
    // A token already held by a connected player (a second tab) can't be used to reconnect.
    if (token && ![...this.players.values()].some((p) => p.token === token)) player.token = token;
    this.corners[corner] = player.id;
    if (this.botted) {
      const names = new Set([...this.bots.values()].map((b) => b.name));
      const name = names.has('Bot 1') ? 'Bot 2' : 'Bot 1';
      const bot: BotSide = { id: this.nextPlayerId++, name, hadForces: false, corner: this.randomFreeCorner() };
      this.corners[bot.corner] = bot.id;
      this.bots.set(player.id, bot);
      this.sim.teams.set(player.id, 1);
      this.sim.teams.set(bot.id, 2);
    }
    this.players.set(socket, player);
    this.sendWelcome(player);
    // In the lobby nothing is built yet: the host's start sets everyone up together.
    if (this.started) this.pending.push({ kind: 'join', player });
  }

  /** Brings the client up to date with the committed state; deltas follow from the next tick. */
  private sendWelcome(player: Player): void {
    const { width, height, seed } = this.sim.config;
    this.send(player, {
      t: 'welcome',
      playerId: player.id,
      tickRate: TICK_RATE,
      width,
      height,
      seed,
      terrain: this.sim.terrain.encode(),
      fog: this.fog && !player.spectating,
      lobby: !this.started,
      spectating: player.spectating,
    });
    if (!this.started) this.send(player, this.lobbyMessage());
    this.send(player, { t: 'blueprints', list: this.sim.blueprints.all().map(toInfo) });
    this.send(player, this.pauseMessage());
    const view = this.fog && !player.spectating ? player.interest.reset(this.visibleTo(player)) : undefined;
    player.socket.send(encodeTick(this.sim.world, this.sim.tick, [], true, view));
  }

  /** A returning player gets everything the owner-only channels would have told them. */
  private rejoin(socket: WebSocket, player: Player): void {
    player.socket = socket;
    player.lastCredits = '';
    player.lastNetworks = '';
    this.players.set(socket, player);
    this.sendWelcome(player);
    for (const bp of this.sim.blueprints.ownedBy(player.id)) {
      if (bp.program) this.send(player, { t: 'program', blueprint: bp.id, source: bp.program.source });
    }
    const updates: number[][] = [];
    for (const e of this.sim.unit.dense) {
      if (this.sim.unit.f.owner[e] !== player.id) continue;
      const q = this.sim.tasks[e];
      if (q) updates.push([e, ...q.toWire((h) => this.sim.world.resolve(h))]);
    }
    if (updates.length) this.send(player, { t: 'tasks', updates });
    this.lastScoreboard = '';
  }

  /** Players with a token keep their base for a while after disconnecting, so they can reconnect. */
  leave(socket: WebSocket): void {
    const player = this.players.get(socket);
    if (!player) return;
    this.players.delete(socket);
    // Nobody is kept waiting for a lobby member or a defeated player: there is no base to hold.
    if (player.token && this.started && !player.defeated) this.away.set(player.token, { player, since: Date.now() });
    else this.pending.push({ kind: 'leave', player });
    this.lastScoreboard = '';
  }

  /** Resigning forfeits while a player has forces and otherwise leaves for good. */
  private resign(player: Player): void {
    if (this.canForfeit(player)) this.forfeit(player);
    else this.leaveForGood(player);
  }

  private canForfeit(player: Player): boolean {
    return this.started && !player.defeated && !this.over;
  }

  /**
   * Gives up the player's forces. They are marked defeated at once (so closing the tab doesn't
   * start a reconnect wait) and offered the spectator view; the forces go at the next tick.
   * In co-op the player's bot is left alone: the bots win once every human is out.
   */
  private forfeit(player: Player): void {
    if (!this.canForfeit(player)) return;
    this.defeat(player);
    this.pending.push({ kind: 'forfeit', player });
  }

  /** Marks the player out of the game and offers them the spectator view. */
  private defeat(player: Player): void {
    if (player.defeated) return;
    player.defeated = true;
    player.hadForces = true;
    this.send(player, { t: 'defeated' });
    this.lastScoreboard = '';
  }

  /** Leaving for good frees the seat at once instead of waiting for a reconnect. */
  private leaveForGood(player: Player): void {
    if (!this.players.delete(player.socket)) return;
    this.pending.push({ kind: 'leave', player });
    this.lastScoreboard = '';
    this.send(player, { t: 'resigned' });
  }

  /** Nobody connected and nobody who could still reconnect. */
  get empty(): boolean {
    return this.crashed || (this.players.size === 0 && this.away.size === 0);
  }

  private expireAway(): void {
    for (const [token, { player, since }] of this.away) {
      if (Date.now() - since < RECONNECT_GRACE_MS) continue;
      this.away.delete(token);
      this.pending.push({ kind: 'leave', player });
    }
  }

  receive(socket: WebSocket, msg: ClientMessage): void {
    const player = this.players.get(socket);
    if (!player) return;
    if (msg.t === 'resign') this.resign(player);
    else if (msg.t === 'forfeit') this.forfeit(player);
    else if (msg.t === 'leave') this.leaveForGood(player);
    else this.pending.push({ kind: 'msg', player, msg });
  }

  private tick(): void {
    for (const cmd of this.pending.splice(0)) this.apply(cmd);
    if (!this.started) {
      this.reportLobby();
      return;
    }
    // Commands still apply while paused (a new player's base appears), but time stands still.
    const reasons = this.pauseReasons;
    const paused = reasons.length > 0;
    this.reportPause(reasons);
    if (!paused) {
      for (const bot of this.bots.values()) bot.controller?.step();
      this.sim.step();
    }
    // Without fog: one encode, broadcast to everyone. With fog: one per client, filtered to what it sees.
    const shared = this.fog ? undefined : encodeTick(this.sim.world, this.sim.tick, this.sim.events, false, undefined, this.sim.alerts);
    // Spectators see everything, fog or not.
    let unfiltered = shared;
    const tasks = this.collectTaskUpdates();
    // Energy moved per building, summed over the report window (single ticks are too jumpy to animate).
    for (const net of paused ? [] : this.sim.networks) {
      net.members.forEach((e, i) => this.flowSums.set(e, (this.flowSums.get(e) ?? 0) + (net.flow[i] ?? 0)));
    }
    for (const p of this.players.values()) {
      if (p.socket.readyState !== WebSocket.OPEN) continue;
      if (p.spectating) unfiltered ??= encodeTick(this.sim.world, this.sim.tick, this.sim.events, false, undefined, this.sim.alerts);
      p.socket.send(
        (p.spectating ? unfiltered : shared) ??
          encodeTick(this.sim.world, this.sim.tick, this.sim.events, false, p.interest.update(this.visibleTo(p), this.sim.world.despawned), this.sim.alerts),
      );
      const amount = this.sim.pool(p.id);
      const capacity = this.sim.poolCapacity(p.id);
      if (`${amount}/${capacity}` !== p.lastCredits) {
        p.lastCredits = `${amount}/${capacity}`;
        this.send(p, { t: 'credits', amount, capacity });
      }
      for (const pulse of this.sim.radarPulses) {
        if (!this.sim.allied(p.id, pulse.owner)) continue;
        this.send(p, {
          t: 'radar',
          x: pulse.x,
          y: pulse.y,
          range: pulse.range,
          contacts: pulse.contacts.map((c) => [c.x, c.y, c.owner, c.structure ? 1 : 0, c.blueprint]),
        });
      }
      const updates = tasks.get(p.id);
      if (updates) this.send(p, { t: 'tasks', updates });
      if (this.sim.tick % NETWORK_REPORT_TICKS === 0) this.reportNetworks(p);
    }
    if (this.sim.tick % NETWORK_REPORT_TICKS === 0) this.flowSums.clear();
    if (this.sim.tick % NETWORK_REPORT_TICKS === 0) this.reportScoreboard();
    this.expireAway();
    this.sim.commit();
  }

  /** Why the game is stopped, if it is: it needs two connected players and nobody missing. */
  get pauseReasons(): string[] {
    if (!this.started) return []; // the lobby has its own panel
    const reasons = [...this.away.values()].map(({ player }) => `${player.name} disconnected — waiting for them to come back`);
    const needed = this.minPlayers;
    if (this.players.size < needed) reasons.push(needed === 1 ? 'Waiting for a player' : 'Waiting for another player — a match needs at least two');
    if (this.devPause === 'dev') reasons.push('Paused from the Dev Options menu');
    else if (this.devPause === 'disconnect') reasons.push('A player disconnected — waiting for them to come back (simulated by Dev Options)');
    return reasons;
  }

  private pauseMessage(): Extract<ServerMessage, { t: 'pause' }> {
    return {
      t: 'pause',
      reasons: this.pauseReasons,
      away: [...this.away.values()].map(({ player, since }) => ({
        name: player.name,
        remainingMs: Math.max(0, RECONNECT_GRACE_MS - (Date.now() - since)),
      })),
    };
  }

  /** Game time so far; it doesn't advance while paused. */
  get elapsedSeconds(): number {
    return Math.floor(this.sim.tick / TICK_RATE);
  }

  /** Everyone in the match, connected or not, with their current score (for the room list). */
  roster(): { name: string; score: number; connected: boolean; eliminated: boolean }[] {
    const owning = new Set<number>();
    for (const e of this.sim.unit.dense) if (!this.sim.isSite(e)) owning.add(this.sim.unit.f.owner[e]);
    const entry = (p: Side, connected: boolean) => ({
      name: p.name,
      score: this.sim.score(p.id),
      connected,
      eliminated: p.hadForces && !owning.has(p.id),
    });
    return [
      ...[...this.players.values()].map((p) => entry(p, true)),
      ...[...this.bots.values()].map((b) => entry(b, true)),
      ...[...this.away.values()].map(({ player }) => entry(player, false)),
    ];
  }

  private lastPause = '';
  private lastLobby = '';

  private lobbyMessage(): Extract<ServerMessage, { t: 'lobby' }> {
    const players = [...this.players.values()].sort((a, b) => a.id - b.id).map((p) => ({ id: p.id, name: p.name }));
    return {
      t: 'lobby',
      players,
      hostId: this.host?.id ?? 0,
      mode: this.mode,
      mapName: this.map.name,
      capacity: this.capacity,
      minPlayers: this.minPlayers,
    };
  }

  /** Who is waiting in the lobby, and who may start the match. */
  private reportLobby(): void {
    const message = this.lobbyMessage();
    const key = JSON.stringify(message);
    if (key === this.lastLobby) return;
    this.lastLobby = key;
    this.broadcast(message);
  }

  /** Builds every waiting player's base (and bot) and lets time run. */
  private startMatch(): void {
    this.started = true;
    for (const player of this.players.values()) this.setUpSide(player);
    this.broadcast({ t: 'started' });
    this.lastScoreboard = '';
  }

  private setUpSide(player: Player): void {
    const corner = this.corners.indexOf(player.id);
    const classes = setUpPlayer(this.sim, player.id, CORNERS[corner], STARTING_CREDITS);
    this.announce(player, classes);
    const bot = this.bots.get(player.id);
    if (bot) {
      const set = setUpBot(this.sim, bot.id, CORNERS[bot.corner], player.id);
      bot.controller = set.bot;
      // Everyone needs the bot's class shapes to draw its units; nobody sees its programs.
      this.broadcast({ t: 'blueprints', list: set.classes.map(toInfo) });
    }
  }

  private reportPause(reasons: string[]): void {
    const message = this.pauseMessage();
    const key = JSON.stringify({
      reasons,
      away: message.away.map(({ name, remainingMs }) => [name, Math.ceil(remainingMs / 1000)]),
    });
    if (key === this.lastPause) return;
    this.lastPause = key;
    this.broadcast(message);
  }

  /** Everyone sees everyone's totals, sent when they change. */
  private reportScoreboard(): void {
    const owning = new Set<number>();
    const powered = new Set<number>();
    for (const e of this.sim.unit.dense) {
      if (this.sim.isSite(e)) continue;
      const owner = this.sim.unit.f.owner[e];
      owning.add(owner);
      if (this.sim.motion.has(e) && this.sim.energy.f.amount[e] >= 1) powered.add(owner);
    }
    const bots = [...this.bots.values()];
    const everyone: Side[] = [...this.players.values(), ...[...this.away.values()].map((a) => a.player), ...bots];
    for (const p of everyone) {
      if (!owning.has(p.id)) continue;
      p.hadForces = true;
      this.fielded.add(p.id);
    }
    const entry = (p: Side): ScoreEntry => ({
      id: p.id,
      name: p.name,
      eliminated: p.hadForces && !owning.has(p.id),
      score: this.sim.score(p.id),
      ...this.sim.tally(p.id),
    });
    for (const p of this.players.values()) {
      if (p.hadForces && !owning.has(p.id)) this.defeat(p);
    }
    const players = [...this.players.values(), ...bots].map(entry);
    const text = JSON.stringify({ t: 'scoreboard', players } satisfies ServerMessage);
    if (text !== this.lastScoreboard) {
      this.lastScoreboard = text;
      this.broadcast({ t: 'scoreboard', players });
    }
    this.checkVictory(everyone.map((p) => ({ p, e: entry(p) })), powered);
  }

  /** A match needs two sides to have fielded forces and some game time to have passed before anyone can win. */
  private checkVictory(sides: { p: Side; e: ScoreEntry }[], powered: ReadonlySet<number>): void {
    if (this.over || this.fielded.size < 2 || this.sim.tick === 0) return;
    if (this.botted) {
      this.checkTeamVictory(sides);
      return;
    }
    const standing = sides.filter((s) => !s.e.eliminated);
    let winner: number | undefined;
    let reason: MatchEndReason = 'eliminated';
    if (sides.length === 1 && standing.length === 1) {
      winner = standing[0].e.id;
      reason = 'last-player';
    } else if (standing.length <= 1) {
      winner = standing[0]?.e.id ?? 0;
    } else {
      const active = standing.filter((s) => s.p.hadForces && powered.has(s.e.id));
      if (active.length === 1) {
        winner = active[0].e.id;
        reason = 'no-power';
      }
    }
    if (winner === undefined) return;
    this.over = true;
    const standings = sides.map((s) => s.e).sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.score - a.score);
    this.broadcast({ t: 'matchOver', winner, reason, standings });
  }

  /**
   * Co-op mode is humans against bots: the humans win together once every bot is
   * destroyed, and the bots win once every human is. (Bots cheat on energy, so the
   * no-power rule doesn't apply.)
   */
  private checkTeamVictory(sides: { p: Side; e: ScoreEntry }[]): void {
    const botIds = new Set([...this.bots.values()].map((b) => b.id));
    const bots = sides.filter((s) => botIds.has(s.p.id));
    const humans = sides.filter((s) => !botIds.has(s.p.id));
    if (!bots.length || !humans.length) return;
    let winners: number[];
    if (bots.every((s) => s.p.hadForces && s.e.eliminated)) winners = humans.map((s) => s.e.id);
    else if (humans.every((s) => s.p.hadForces && s.e.eliminated)) winners = bots.map((s) => s.e.id);
    else return;
    this.over = true;
    const standings = sides.map((s) => s.e).sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.score - a.score);
    this.broadcast({ t: 'matchOver', winner: winners[0], winners, reason: 'eliminated', standings });
  }

  /** Owner-only power network totals, sent when they change. */
  private reportNetworks(player: Player): void {
    const list: NetworkInfo[] = this.sim.networks
      .filter((n) => n.members.length > 0 && this.sim.unit.f.owner[n.members[0]] === player.id)
      .map((n) => ({
        members: n.members,
        supply: n.supply,
        demand: n.demand,
        delivered: n.delivered,
        stored: n.stored,
        capacity: n.capacity,
        depot: n.depot,
        // Average per tick over the window, to one decimal place.
        flow: n.members.map((e) => Math.round(((this.flowSums.get(e) ?? 0) * 10) / NETWORK_REPORT_TICKS) / 10),
      }));
    const text = JSON.stringify(list);
    if (text === player.lastNetworks) return;
    player.lastNetworks = text;
    this.send(player, { t: 'networks', list });
  }

  private visibleTo(player: Player): Set<number> {
    // Co-op-mode humans are one team: they see what each other sees.
    const team = this.botted ? new Set([...this.players.values(), ...[...this.away.values()].map((a) => a.player)].map((p) => p.id)) : undefined;
    return visibleTo(this.sim.world, team?.has(player.id) ? team : player.id, (e) => this.sim.stats(e));
  }

  /** Full queues of units whose tasks changed, grouped by owner (only the owner sees them). */
  private collectTaskUpdates(): Map<number, number[][]> {
    const byOwner = new Map<number, number[][]>();
    const resolve = (h: number) => this.sim.world.resolve(h);
    for (const e of this.sim.unit.dense) {
      const q = this.sim.tasks[e];
      if (!q?.dirty) continue;
      q.dirty = false;
      const owner = this.sim.unit.f.owner[e];
      let list = byOwner.get(owner);
      if (!list) byOwner.set(owner, (list = []));
      list.push([e, ...q.toWire(resolve)]);
    }
    return byOwner;
  }

  /** Destroys every unit and building of the given owners. */
  private removeForces(...owners: (number | undefined)[]): void {
    for (const e of this.sim.world.query(this.sim.unit.def)) {
      if (owners.includes(this.sim.unit.f.owner[e])) this.sim.destroyEntity(e);
    }
  }

  private apply(cmd: Command): void {
    const { player } = cmd;
    switch (cmd.kind) {
      case 'join':
        this.setUpSide(player);
        return;
      case 'forfeit':
        this.removeForces(player.id);
        return;
      case 'leave': {
        const bot = this.bots.get(player.id);
        this.removeForces(player.id, bot?.id);
        this.corners[this.corners.indexOf(player.id)] = 0;
        if (bot) {
          this.corners[bot.corner] = 0;
          this.bots.delete(player.id);
          this.fielded.delete(bot.id);
          this.sim.cheaters.delete(bot.id);
          this.sim.teams.delete(bot.id);
          this.sim.teams.delete(player.id);
        }
        return;
      }
      case 'msg':
        try {
          this.handle(player, cmd.msg);
        } catch (err) {
          if (err instanceof BlueprintError || err instanceof FlowError || err instanceof CommandError) {
            this.send(player, { t: 'error', message: err.message });
          } else {
            throw err;
          }
        }
        return;
    }
  }

  /** Every client needs class shapes for rendering; only the owner ever sees programs. */
  private announce(player: Player, classes: Blueprint[]): void {
    this.broadcast({ t: 'blueprints', list: classes.map(toInfo) });
    for (const bp of classes) {
      if (bp.program) this.send(player, { t: 'program', blueprint: bp.id, source: bp.program.source });
    }
  }

  private handle(player: Player, msg: ClientMessage): void {
    const phase: ClientPhase = !this.started ? 'lobby' : player.spectating ? 'spectating' : 'playing';
    // Spectators only watch, and nothing can be ordered before the match starts.
    if (!messageAllowed(phase, msg.t)) return;
    switch (msg.t) {
      case 'startGame':
        if (!this.started && this.host === player && this.players.size >= this.minPlayers) this.startMatch();
        return;
      case 'spectate':
        // Only those who are out (or once the match is decided) may watch the whole map.
        if (this.started && !player.spectating && (player.defeated || this.over)) {
          player.spectating = true;
          this.sendWelcome(player);
        }
        return;
      case 'setName': {
        // eslint-disable-next-line no-control-regex
        const name = msg.name.replace(/[\u0000-\u001f\u007f<>&"]/g, '').trim().slice(0, 16);
        player.name = name || `Player ${player.id}`;
        this.lastScoreboard = '';
        return;
      }
      case 'defineBlueprint': {
        if (this.sim.blueprints.ownedBy(player.id).filter((b) => !b.retired).length >= MAX_CLASSES_PER_PLAYER) {
          throw new CommandError(`At most ${MAX_CLASSES_PER_PLAYER} classes per player`);
        }
        this.announce(player, [this.sim.blueprints.define(player.id, msg.name, msg.parts)]);
        return;
      }
      case 'loadDesigns': {
        if (phase !== 'playing') {
          // The classes don't exist yet (or the player is only watching): say so, so the client's store recovers.
          this.send(player, { t: 'designsLoaded', reason: msg.reason, defined: 0, updated: 0, retired: 0, errors: ['Designs can only be changed during a match you are playing in.'] });
          return;
        }
        const report = this.sim.loadDesigns(player.id, msg.classes, MAX_CLASSES_PER_PLAYER, msg.merge === true);
        if (report.changed.length) this.broadcast({ t: 'blueprints', list: report.changed.map(toInfo) });
        for (const bp of report.programs) this.send(player, { t: 'program', blueprint: bp.id, source: bp.program?.source ?? '' });
        const { defined, updated, retired, errors } = report;
        this.send(player, { t: 'designsLoaded', reason: msg.reason, defined, updated, retired, errors });
        return;
      }
      case 'retireClass': {
        if (!msg.retired && this.sim.blueprints.ownedBy(player.id).filter((b) => !b.retired).length >= MAX_CLASSES_PER_PLAYER) {
          throw new CommandError(`At most ${MAX_CLASSES_PER_PLAYER} classes per player`);
        }
        const bp = this.sim.retireClass(player.id, msg.blueprint, msg.retired);
        this.broadcast({ t: 'blueprints', list: [toInfo(bp)] });
        return;
      }
      case 'setProgram': {
        const bp = this.sim.blueprints.get(msg.blueprint);
        if (!bp || bp.owner !== player.id) throw new CommandError('Not your class');
        try {
          this.sim.setProgram(msg.blueprint, msg.source);
          this.send(player, { t: 'programResult', blueprint: msg.blueprint, ok: true });
          this.send(player, { t: 'program', blueprint: msg.blueprint, source: msg.source });
        } catch (err) {
          if (!(err instanceof FlowError || err instanceof BlueprintError)) throw err;
          this.send(player, { t: 'programResult', blueprint: msg.blueprint, ok: false, error: err.message });
        }
        return;
      }
      case 'order':
        // Selections can go stale between click and tick (units die): skip those quietly.
        for (const e of msg.units) ignoreRefused(() => this.sim.issueOrder(player.id, e, msg.x, msg.y, msg.target, msg.queue));
        return;
      case 'stop':
        for (const e of msg.units) ignoreRefused(() => this.sim.issueStop(player.id, e, msg.queue));
        return;
      case 'command':
        for (const e of msg.units) ignoreRefused(() => this.sim.issueCommand(player.id, e, msg.task, msg.x, msg.y, msg.target, msg.queue));
        return;
      case 'button':
        // Mixed selections: units whose class lacks the button refuse quietly.
        for (const e of msg.units) ignoreRefused(() => this.sim.issueButton(player.id, e, msg.name, msg.x, msg.y, msg.target, msg.queue));
        return;
      case 'demolish':
        for (const e of msg.units) ignoreRefused(() => this.sim.demolish(player.id, e));
        return;
      case 'place':
        this.sim.placeBlueprint(player.id, msg.blueprint, msg.x, msg.y, msg.builders, msg.queue);
        return;
      case 'setModule':
        for (const e of msg.units) ignoreRefused(() => this.sim.issueModule(player.id, e, msg.index, msg.on));
        return;
      case 'cpuProfile': {
        // Only for the player's own living units: program internals are never shown to anyone else.
        const e = msg.unit;
        if (!this.sim.world.isAlive(e) || !this.sim.unit.has(e) || this.sim.unit.f.owner[e] !== player.id) return;
        const flow = this.sim.flows[e];
        this.send(player, { t: 'cpuProfile', unit: e, tick: this.sim.tick, profile: flow ? cpuProfile(flow) : null });
        return;
      }
      case 'produce': {
        const owned = this.sim.unit.dense.filter((e) => this.sim.unit.f.owner[e] === player.id && !this.sim.stats(e).structure).length;
        if (owned >= MAX_UNITS_PER_PLAYER) throw new CommandError(`Unit cap (${MAX_UNITS_PER_PLAYER}) reached`);
        this.sim.enqueueProduction(player.id, msg.building, msg.blueprint);
        return;
      }
      case 'dequeue':
        this.sim.dequeueProduction(player.id, msg.building, msg.index);
        return;
      case 'dev':
        this.dev(player, msg.cmd);
        return;
    }
  }

  /** Whether `id` is neutral or a side of this match. */
  private knownOwner(id: number): boolean {
    return id === NEUTRAL || [...this.players.values(), ...[...this.away.values()].map((a) => a.player), ...this.bots.values()].some((s) => s.id === id);
  }

  /** Developer commands (cheats for playtesting); a server only obeys them when started with WST_DEV_TOOLS=1. */
  private dev(player: Player, cmd: DevCommand): void {
    const note = (text: string, ok = true) => this.send(player, { t: 'devNote', text, ok });
    if (!this.devTools) {
      note('Dev tools are off on this server: start it with WST_DEV_TOOLS=1 (npm run dev does).', false);
      return;
    }
    if ('owner' in cmd && cmd.owner >= 0 && !this.knownOwner(cmd.owner)) {
      note('No such player.', false);
      return;
    }
    switch (cmd.kind) {
      case 'fog':
        this.fog = cmd.on;
        this.sim.requirePlacementVision = cmd.on;
        // A fresh welcome per client resets what it holds of the world (and re-sends its programs and orders).
        for (const p of this.players.values()) this.rejoin(p.socket, p);
        note(cmd.on ? 'Fog of war on.' : 'Fog of war off: everything is visible.');
        return;
      case 'spawn': {
        const made = devSpawn(this.sim, cmd.owner, cmd.template, cmd.x, cmd.y, cmd.count);
        if (!made) note(`Unknown class "${cmd.template}".`, false);
        else {
          if (made.created) this.broadcast({ t: 'blueprints', list: [toInfo(made.bp)] });
          note(made.entities.length ? `Spawned ${made.entities.length} × ${cmd.template}.` : 'No room near there.', made.entities.length > 0);
        }
        return;
      }
      case 'field':
        this.sim.spawnResourcePatch(cmd.x * TILE + TILE / 2, cmd.y * TILE + TILE / 2, cmd.amount);
        note(`Added a field of ${cmd.amount} matter.`);
        return;
      case 'give':
        note(`Added ${devGive(this.sim, cmd.owner, cmd.amount)} matter to the silos.`);
        return;
      case 'remove':
        note(`Removed ${devRemove(this.sim, cmd.x, cmd.y, cmd.r, cmd.owner, cmd.scope)} things.`);
        return;
      case 'clear':
        note(`Destroyed ${devClear(this.sim, cmd.owner)} units and buildings.`);
        return;
      case 'heal':
        note(`Restored ${devHeal(this.sim, cmd.owner)} units and buildings.`);
        return;
      case 'finish':
        note(`Finished ${devFinishSites(this.sim, cmd.owner)} construction sites.`);
        return;
      case 'pause':
        this.devPause = cmd.mode;
        note(cmd.mode === 'off' ? 'Simulation running.' : 'Simulation stopped.');
        return;
      case 'defeat':
        this.defeat(player);
        return;
      case 'reopen':
        this.over = false;
        note('The match can end normally again.');
        return;
      case 'end':
        this.devEnd(player, cmd.outcome);
        note('Match ended.');
        return;
    }
  }

  /** Ends the match now, for testing the victory and loss screens: the sender's side wins, loses or draws. */
  private devEnd(player: Player, outcome: DevOutcome): void {
    const humans = [...this.players.values()];
    const bots = [...this.bots.values()];
    const sides: Side[] = [...humans, ...bots];
    const owning = new Set<number>();
    for (const e of this.sim.unit.dense) if (!this.sim.isSite(e)) owning.add(this.sim.unit.f.owner[e]);
    const mine = this.botted ? humans.map((p) => p.id) : [player.id];
    const theirs = sides.map((s) => s.id).filter((id) => !mine.includes(id));
    const wins = outcome.startsWith('win');
    const winners = outcome === 'draw' ? [] : wins ? mine : this.botted ? theirs : theirs.slice(0, 1);
    const reason: MatchEndReason = outcome.endsWith('last-player') ? 'last-player' : outcome.endsWith('no-power') ? 'no-power' : 'eliminated';
    const standings: ScoreEntry[] = sides
      .map((s) => ({
        id: s.id,
        name: s.name,
        eliminated: reason === 'eliminated' && winners.length > 0 ? !winners.includes(s.id) : s.hadForces && !owning.has(s.id),
        score: this.sim.score(s.id),
        ...this.sim.tally(s.id),
      }))
      .sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.score - a.score);
    this.over = true;
    this.broadcast({ t: 'matchOver', winner: winners[0] ?? 0, winners, reason, standings });
  }

  private send(player: Player, msg: ServerMessage): void {
    if (player.socket.readyState === WebSocket.OPEN) player.socket.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage): void {
    const text = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.socket.readyState === WebSocket.OPEN) p.socket.send(text);
    }
  }
}
