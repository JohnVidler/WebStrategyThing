import {
  BlueprintError,
  CommandError,
  CompileError,
  CORNERS,
  createMatch,
  mapById,
  encodeTick,
  Interest,
  MAX_CLASSES_PER_PLAYER,
  MAX_UNITS_PER_PLAYER,
  STARTING_CREDITS,
  setUpPlayer,
  TICK_RATE,
  toInfo,
  visibleTo,
  type Blueprint,
  type ClientMessage,
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

interface Player {
  readonly id: number;
  name: string;
  /** Lets a dropped connection pick its player back up (see Match.join). */
  token?: string;
  /** Has owned at least one unit or building (so a player still being set up isn't eliminated). */
  hadForces: boolean;
  socket: WebSocket;
  lastCredits: string;
  /** What this client currently holds of the world (fog of war). */
  readonly interest: Interest;
  lastNetworks: string;
}

export interface MatchOptions {
  /** Fog of war: each client only receives what its units and buildings can see. Default on. */
  readonly fog?: boolean;
  /** The selected room map; defaults to Crossroads. */
  readonly mapId?: string;
}

/**
 * All mutations happen at tick boundaries via this queue, so the simulation
 * stays deterministic: (seed + ordered command log) fully reproduces a match.
 * That log is also what you'd persist for replays.
 */
type Command =
  | { kind: 'join'; player: Player }
  | { kind: 'leave'; player: Player }
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
  /** Players who have ever had forces: a match only counts once two sides have. */
  private readonly fielded = new Set<number>();
  private timer: NodeJS.Timeout | undefined;
  private readonly fog: boolean;

  constructor(options: MatchOptions = {}) {
    this.map = mapById(options.mapId);
    this.sim = createMatch(0x5eed, this.map);
    this.fog = options.fog ?? true;
  }

  get playerCount(): number {
    return this.players.size;
  }

  /** Most players a match holds (one per map corner). */
  get capacity(): number {
    return this.corners.length;
  }

  get isOver(): boolean {
    return this.over;
  }

  start(): void {
    const stepMs = 1000 / TICK_RATE;
    let next = performance.now() + stepMs;
    const loop = () => {
      const now = performance.now();
      let steps = 0;
      while (now >= next && steps < 4) {
        this.tick();
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

  join(socket: WebSocket, token?: string): void {
    const back = token ? this.away.get(token) : undefined;
    if (token && back) {
      this.away.delete(token);
      this.rejoin(socket, back.player);
      return;
    }
    const corner = this.corners.indexOf(0);
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
    };
    player.name = `Player ${player.id}`;
    // A token already held by a connected player (a second tab) can't be used to reconnect.
    if (token && ![...this.players.values()].some((p) => p.token === token)) player.token = token;
    this.corners[corner] = player.id;
    this.players.set(socket, player);
    this.sendWelcome(player);
    this.pending.push({ kind: 'join', player });
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
      fog: this.fog,
    });
    this.send(player, { t: 'blueprints', list: this.sim.blueprints.all().map(toInfo) });
    this.send(player, this.pauseMessage());
    const view = this.fog ? player.interest.reset(this.visibleTo(player)) : undefined;
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
    if (player.token) this.away.set(player.token, { player, since: Date.now() });
    else this.pending.push({ kind: 'leave', player });
    this.lastScoreboard = '';
  }

  /** An explicit resignation skips the reconnect grace period. */
  private resign(socket: WebSocket): void {
    const player = this.players.get(socket);
    if (!player) return;
    this.players.delete(socket);
    this.pending.push({ kind: 'leave', player });
    this.lastScoreboard = '';
    this.send(player, { t: 'resigned' });
  }

  /** Nobody connected and nobody who could still reconnect. */
  get empty(): boolean {
    return this.players.size === 0 && this.away.size === 0;
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
    if (msg.t === 'resign') this.resign(socket);
    else this.pending.push({ kind: 'msg', player, msg });
  }

  private tick(): void {
    for (const cmd of this.pending.splice(0)) this.apply(cmd);
    // Commands still apply while paused (a new player's base appears), but time stands still.
    const reasons = this.pauseReasons;
    const paused = reasons.length > 0;
    this.reportPause(reasons);
    if (!paused) this.sim.step();
    // Without fog: one encode, broadcast to everyone. With fog: one per client, filtered to what it sees.
    const shared = this.fog ? undefined : encodeTick(this.sim.world, this.sim.tick, this.sim.events, false);
    const tasks = this.collectTaskUpdates();
    // Energy moved per building, summed over the report window (single ticks are too jumpy to animate).
    for (const net of paused ? [] : this.sim.networks) {
      net.members.forEach((e, i) => this.flowSums.set(e, (this.flowSums.get(e) ?? 0) + (net.flow[i] ?? 0)));
    }
    for (const p of this.players.values()) {
      if (p.socket.readyState !== WebSocket.OPEN) continue;
      p.socket.send(
        shared ??
          encodeTick(this.sim.world, this.sim.tick, this.sim.events, false, p.interest.update(this.visibleTo(p), this.sim.world.despawned)),
      );
      const amount = this.sim.pool(p.id);
      const capacity = this.sim.poolCapacity(p.id);
      if (`${amount}/${capacity}` !== p.lastCredits) {
        p.lastCredits = `${amount}/${capacity}`;
        this.send(p, { t: 'credits', amount, capacity });
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
    const reasons = [...this.away.values()].map(({ player }) => `${player.name} disconnected — waiting for them to come back`);
    if (this.players.size < 2) reasons.push('Waiting for another player — a match needs at least two');
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
    const entry = (p: Player, connected: boolean) => ({
      name: p.name,
      score: this.sim.score(p.id),
      connected,
      eliminated: p.hadForces && !owning.has(p.id),
    });
    return [
      ...[...this.players.values()].map((p) => entry(p, true)),
      ...[...this.away.values()].map(({ player }) => entry(player, false)),
    ];
  }

  private lastPause = '';

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
    const everyone = [...this.players.values(), ...[...this.away.values()].map((a) => a.player)];
    for (const p of everyone) {
      if (!owning.has(p.id)) continue;
      p.hadForces = true;
      this.fielded.add(p.id);
    }
    const entry = (p: Player): ScoreEntry => ({
      id: p.id,
      name: p.name,
      eliminated: p.hadForces && !owning.has(p.id),
      score: this.sim.score(p.id),
      ...this.sim.tally(p.id),
    });
    const players = [...this.players.values()].map(entry);
    const text = JSON.stringify({ t: 'scoreboard', players } satisfies ServerMessage);
    if (text !== this.lastScoreboard) {
      this.lastScoreboard = text;
      this.broadcast({ t: 'scoreboard', players });
    }
    this.checkVictory(everyone.map((p) => ({ p, e: entry(p) })), powered);
  }

  /** A match needs two sides to have fielded forces and some game time to have passed before anyone can win. */
  private checkVictory(sides: { p: Player; e: ScoreEntry }[], powered: ReadonlySet<number>): void {
    if (this.over || this.fielded.size < 2 || this.sim.tick === 0) return;
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

  /** Owner-only power network totals, sent when they change. */
  private reportNetworks(player: Player): void {
    const list: NetworkInfo[] = this.sim.networks
      .filter((n) => n.members.length > 0 && this.sim.unit.f.owner[n.members[0]] === player.id)
      .map((n) => ({
        members: n.members,
        supply: n.supply,
        demand: n.demand,
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
    return visibleTo(this.sim.world, player.id, (e) => this.sim.stats(e));
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

  private apply(cmd: Command): void {
    const { player } = cmd;
    switch (cmd.kind) {
      case 'join': {
        const corner = this.corners.indexOf(player.id);
        const classes = setUpPlayer(this.sim, player.id, CORNERS[corner], STARTING_CREDITS);
        this.announce(player, classes);
        return;
      }
      case 'leave':
        for (const e of this.sim.world.query(this.sim.unit.def)) {
          if (this.sim.unit.f.owner[e] === player.id) this.sim.destroyEntity(e);
        }
        this.corners[this.corners.indexOf(player.id)] = 0;
        return;
      case 'msg':
        try {
          this.handle(player, cmd.msg);
        } catch (err) {
          if (err instanceof BlueprintError || err instanceof CompileError || err instanceof CommandError) {
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
    switch (msg.t) {
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
          if (!(err instanceof CompileError || err instanceof BlueprintError)) throw err;
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
      case 'produce': {
        const owned = this.sim.unit.dense.filter((e) => this.sim.unit.f.owner[e] === player.id).length;
        if (owned >= MAX_UNITS_PER_PLAYER) throw new CommandError(`Unit cap (${MAX_UNITS_PER_PLAYER}) reached`);
        this.sim.enqueueProduction(player.id, msg.building, msg.blueprint);
        return;
      }
    }
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
