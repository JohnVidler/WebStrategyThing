import { Cargo, Construction, CpuState, CpuStatus, EnergyView, Health, Position, SimEvent, TILE, Unit, type NetworkInfo, type ServerMessage, type TickInfo } from '@wst/engine';
import { playSound, sound } from './sound';
import type { ClientState } from './state';

/** Credits below this raise `alert.low_credits`. */
const LOW_CREDITS = 50;
/** A silo this full counts as filling up (`building.silo_fill`). */
const SILO_FILLING = 0.75;
/** Own things below this share of their health sound `combat.damage_critical`. */
const CRITICAL_HP = 0.25;
/** Footprint (tiles per side) from which a building's death sounds large. */
const LARGE_BUILDING = 3;
/** Hit points from which a unit's death sounds large. */
const LARGE_UNIT_HP = 150;

/** What is remembered of an entity so its end can be told apart after it is gone. */
interface Seen {
  owner: number;
  structure: boolean;
  footprint: number;
  hp: number;
  flying: boolean;
  x: number;
  y: number;
}

/**
 * Turns what the server tells the client into sound tags (see SOUND_EVENTS.md): lobby and match
 * messages, plus the things that happen in the world each tick, worked out from the component
 * changes and replicated events. Does nothing while a tag has no sounds, so the cost is the
 * bookkeeping here and a map lookup per sound.
 */
export class GameSounds {
  private readonly seen = new Map<number, Seen>();
  private readonly cargo = new Map<number, number>();
  private readonly energy = new Map<number, number>();
  private readonly cpu = new Map<number, number>();
  private readonly critical = new Set<number>();

  private lobbyPlayers = new Set<number>();
  private lobbyHost = -1;
  private lobbyReady = false;
  private paused = false;
  private away = new Set<string>();
  private credits = 0;
  private lowPower = false;
  private powerOut = false;
  private networkCount = 0;
  private networkMembers = 0;

  constructor(private readonly state: ClientState) {}

  // --- server messages -------------------------------------------------------------------

  onMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.reset();
        sound.setAmbient('bed', 'ambient.battlefield');
        if (msg.lobby) playSound('lobby.join');
        break;
      case 'lobby': {
        const ids = new Set(msg.players.map((p) => p.id));
        if (this.lobbyPlayers.size) {
          for (const id of ids) if (!this.lobbyPlayers.has(id) && id !== this.state.myId) playSound('lobby.player_joined');
          for (const id of this.lobbyPlayers) if (!ids.has(id)) playSound('lobby.player_left');
          if (msg.hostId !== this.lobbyHost) playSound('lobby.host_changed');
        }
        const ready = msg.players.length >= msg.minPlayers;
        if (ready && !this.lobbyReady) playSound('lobby.ready');
        this.lobbyPlayers = ids;
        this.lobbyHost = msg.hostId;
        this.lobbyReady = ready;
        break;
      }
      case 'started':
        playSound('match.start');
        break;
      case 'pause': {
        const paused = msg.reasons.length > 0;
        if (paused && !this.paused) playSound('match.pause');
        else if (!paused && this.paused) playSound('match.resume');
        this.paused = paused;
        const away = new Set(msg.away.map((a) => a.name));
        for (const name of away) if (!this.away.has(name)) playSound('match.player_away');
        for (const name of this.away) if (!away.has(name)) playSound('match.player_back');
        this.away = away;
        break;
      }
      case 'defeated':
        playSound('match.defeat');
        playSound('sting.defeat');
        break;
      case 'matchOver': {
        const winners = msg.winners ?? [msg.winner];
        if (this.state.spectating) playSound('match.draw_or_over');
        else if (winners.includes(this.state.myId)) {
          playSound('match.victory');
          playSound('sting.victory');
        } else if (!this.state.defeated) {
          // A defeated player has already had theirs.
          playSound('match.defeat');
          playSound('sting.defeat');
        }
        playSound('match.standings');
        break;
      }
      case 'programResult':
        playSound(msg.ok ? 'ui.designer_save' : 'ui.designer_error');
        break;
      case 'designsLoaded':
        if (msg.errors.length) playSound('ui.error');
        else if (msg.reason === 'upload') playSound('ui.design_upload');
        else if (msg.reason === 'reset') playSound('ui.design_reset');
        break;
      case 'error':
        playSound('ui.error');
        break;
      case 'credits':
        this.onCredits(msg.amount, msg.capacity);
        break;
      case 'networks':
        this.onNetworks(msg.list);
        break;
      case 'radar':
        playSound('building.radar_ping', { x: msg.x / TILE, y: msg.y / TILE });
        if (msg.contacts.length) playSound('building.radar_contact', { x: msg.x / TILE, y: msg.y / TILE });
        break;
    }
  }

  private onCredits(amount: number, capacity: number): void {
    const before = this.credits;
    this.credits = amount;
    if (this.state.inLobby) return;
    if (amount > before) {
      playSound('alert.credits_gained');
      if (capacity > 0) {
        if (amount >= capacity && before < capacity) playSound('building.silo_full');
        else if (amount >= capacity * SILO_FILLING && before < capacity * SILO_FILLING) playSound('building.silo_fill');
      }
    } else if (amount < LOW_CREDITS && before >= LOW_CREDITS) {
      playSound('alert.low_credits');
    }
  }

  private onNetworks(list: readonly NetworkInfo[]): void {
    let supply = 0;
    let demand = 0;
    let delivered = 0;
    let stored = 0;
    let members = 0;
    for (const n of list) {
      supply += n.supply;
      demand += n.demand;
      delivered += n.delivered;
      stored += n.stored;
      members += n.members.length;
    }
    // Starving: consumers wanted more than they got.
    const low = demand > 0 && delivered < demand;
    const out = members > 0 && supply === 0 && stored === 0;
    if (out && !this.powerOut) playSound('alert.power_out');
    else if (low && !this.lowPower && !out) playSound('alert.low_power');
    else if (!low && !out && (this.lowPower || this.powerOut)) playSound('alert.power_restored');
    this.lowPower = low;
    this.powerOut = out;
    // Links: separate grids joining up, or one falling apart while its buildings are still there.
    if (this.networkCount && !this.state.inLobby) {
      if (list.length < this.networkCount && members >= this.networkMembers) playSound('building.link_connected');
      else if (list.length > this.networkCount && members <= this.networkMembers) playSound('building.link_broken');
    }
    this.networkCount = list.length;
    this.networkMembers = members;
  }

  // --- the world, once per tick -----------------------------------------------------------

  /** Call after applying a tick and before world.flush(), with the view centre for positional sounds. */
  onTick(info: TickInfo): void {
    const state = this.state;
    const world = state.world;
    const unit = world.store(Unit);
    const pos = world.store(Position);
    const health = world.store(Health);
    const sites = world.store(Construction);
    const me = state.myId;
    const quiet = info.full; // the first view of the world is not a series of events

    if (info.full) this.clearWorld();

    const at = (e: number) => ({ x: pos.f.x[e] / TILE, y: pos.f.y[e] / TILE });

    // New things: spawns, construction sites, enemies coming into view.
    for (const e of unit.changed) {
      if (!unit.has(e)) continue;
      const stats = state.stats(e);
      const owner = unit.f.owner[e];
      if (!this.seen.has(e)) {
        const p = pos.has(e) ? at(e) : { x: 0, y: 0 };
        this.seen.set(e, {
          owner,
          structure: stats?.structure ?? false,
          footprint: stats?.footprint ?? 0,
          hp: stats?.hp ?? 0,
          flying: stats?.flying ?? false,
          x: p.x,
          y: p.y,
        });
        if (!quiet && !state.inLobby) {
          if (sites.has(e) && owner === me) playSound('building.construction_start', p);
          else if (!stats?.structure && owner === me) playSound('unit.spawn', p);
          else if (!stats?.structure && owner !== me && !state.spectating) playSound('alert.enemy_spotted');
        }
      }
    }

    // Completed buildings: the construction marker goes away but the building stays.
    if (!quiet) {
      for (const e of sites.removed) {
        if (unit.has(e) && world.isAlive(e) && pos.has(e) && unit.f.owner[e] === me) playSound('building.complete', at(e));
      }
    }

    // Keep the last known position of everything that moves, for events that arrive as it vanishes.
    for (const e of pos.changed) {
      const s = this.seen.get(e);
      if (s && pos.has(e)) {
        s.x = pos.f.x[e] / TILE;
        s.y = pos.f.y[e] / TILE;
      }
    }

    // Replicated events.
    const died = new Set<number>();
    for (let i = 0; i < info.events.length; i += 3) {
      const type = info.events[i];
      const a = info.events[i + 1];
      if (type === SimEvent.Shot) {
        const kind = state.stats(a)?.weapon?.kind;
        if (kind && kind !== 'tesla' && pos.has(a)) playSound(`combat.shot.${kind}`, at(a));
      } else if (type === SimEvent.Pulse) {
        if (pos.has(a)) playSound('combat.tesla', at(a));
      } else if (type === SimEvent.Repair) {
        if (pos.has(a)) playSound('combat.repair', at(a));
      } else if (type === SimEvent.Death) {
        died.add(a);
        this.onDeath(a);
      }
    }

    // Damage: hit points that went down on something in view.
    for (const e of health.changed) {
      const s = this.seen.get(e);
      if (!health.has(e) || !s || quiet) {
        if (s && health.has(e)) s.hp = health.f.hp[e];
        continue;
      }
      const hp = health.f.hp[e];
      const before = s.hp;
      s.hp = hp;
      if (hp >= before) continue;
      const mine = s.owner === me;
      const max = state.stats(e)?.hp ?? 0;
      if (hp > 0) playSound(s.structure ? 'combat.hit_building' : 'combat.hit', { x: s.x, y: s.y });
      if (mine && hp > 0) {
        playSound(s.structure ? 'alert.base_under_attack' : 'alert.under_attack');
        if (max > 0 && hp / max < CRITICAL_HP && !this.critical.has(e)) {
          this.critical.add(e);
          playSound('combat.damage_critical', { x: s.x, y: s.y });
        }
      }
      if (max > 0 && hp / max >= CRITICAL_HP) this.critical.delete(e);
    }

    // Own units' cargo, energy and processor state.
    if (!quiet) {
      const cargo = world.store(Cargo);
      for (const e of cargo.changed) {
        if (!cargo.has(e)) continue;
        const s = this.seen.get(e);
        const now = cargo.f.amount[e];
        const before = this.cargo.get(e) ?? now;
        this.cargo.set(e, now);
        if (!s || s.owner !== me) continue;
        if (now > before) playSound('unit.harvest', { x: s.x, y: s.y });
        else if (now < before && now === 0) playSound('unit.deposit', { x: s.x, y: s.y });
      }
      const energy = world.store(EnergyView);
      for (const e of energy.changed) {
        if (!energy.has(e)) continue;
        const s = this.seen.get(e);
        const now = energy.f.pct[e];
        const before = this.energy.get(e) ?? now;
        this.energy.set(e, now);
        if (s && s.owner === me && !s.structure && now >= 100 && before < 100) playSound('unit.charged', { x: s.x, y: s.y });
      }
      const cpu = world.store(CpuStatus);
      for (const e of cpu.changed) {
        if (!cpu.has(e)) continue;
        const s = this.seen.get(e);
        const now = cpu.f.fault[e] ? -1 : cpu.f.state[e];
        const before = this.cpu.get(e) ?? now;
        this.cpu.set(e, now);
        if (!s || s.owner !== me || s.structure || now === before) continue;
        if (now === CpuState.NoPower) playSound('unit.flat', { x: s.x, y: s.y });
        else if (before === CpuState.NoPower && now !== CpuState.Offline) playSound('unit.revived', { x: s.x, y: s.y });
        else if (now === -1 || now === CpuState.Offline) playSound('unit.cpu_offline', { x: s.x, y: s.y });
      }
    }

    // Things that left: own buildings that vanish without dying were demolished (or their site cancelled).
    for (const e of world.despawned) {
      const s = this.seen.get(e);
      if (s && !died.has(e) && !quiet && s.structure && s.owner === me && !state.spectating) playSound('building.demolished', { x: s.x, y: s.y });
      this.seen.delete(e);
      this.cargo.delete(e);
      this.energy.delete(e);
      this.cpu.delete(e);
      this.critical.delete(e);
    }
  }

  private onDeath(e: number): void {
    const s = this.seen.get(e);
    if (!s) return;
    const where = { x: s.x, y: s.y };
    const mine = s.owner === this.state.myId;
    if (s.structure) playSound(s.footprint >= LARGE_BUILDING ? 'death.building_large' : 'death.building', where);
    else playSound(s.flying ? 'death.unit_air' : s.hp >= LARGE_UNIT_HP ? 'death.unit_large' : 'death.unit_small', where);
    playSound(mine ? 'death.own' : 'death.enemy', where);
    if (mine) playSound(s.structure ? 'alert.building_lost' : 'alert.unit_lost');
  }

  private clearWorld(): void {
    this.seen.clear();
    this.cargo.clear();
    this.energy.clear();
    this.cpu.clear();
    this.critical.clear();
  }

  private reset(): void {
    this.clearWorld();
    this.lobbyPlayers = new Set();
    this.lobbyHost = -1;
    this.lobbyReady = false;
    this.paused = false;
    this.away = new Set();
    this.credits = 0;
    this.lowPower = false;
    this.powerOut = false;
    this.networkCount = 0;
    this.networkMembers = 0;
  }
}
