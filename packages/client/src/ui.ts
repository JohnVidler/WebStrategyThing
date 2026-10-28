import { timeOfDay, weatherOf } from './weather';
import { placeMusic } from './music';
import {
  buildEnergyCost,
  MAX_UNITS_PER_PLAYER,
  Caps,
  Construction,
  type Blueprint,
  EnergyView,
  factoryCanBuild,
  FACTORY_TIER_NAMES,
  MAX_PRODUCTION_QUEUE,
  Modules,
  PARTS,
  Production,
  Resource,
  RESOURCE_PATCH_AMOUNT,
  ResourcePatch,
  Stockpile,
  SWITCHABLE,
  Unit,
  type ScoreEntry,
  type MatchEndReason,
  type ServerMessage,
} from '@wst/engine';
import { playSound } from './sound';
import { controls } from './controls';
import { collapseByClass, generationPerTick } from './energy';
import { isShown, revealScreen, setShown } from './transition';
import type { ActionButton } from './actions';
import { ownerColour } from './renderer';
import { showToast, type ToastKind } from './toast';
import { HISTORY_EVERY, HISTORY_SAMPLES, METRICS, ResourceHistory, sparkline } from './resources';
import type { ClientState } from './state';

/** Ticks the net matter income is averaged over (10 ticks = 1 second). */
const MATTER_RATE_WINDOW = 50;

/** What the end-of-mission screens offer in a campaign level. */
export interface CampaignEnd {
  /** Start the same level again. */
  retry(): void;
  /** Only after a win: where to go next (the next level's briefing, or back to the campaign). */
  next?: { label: string; go(): void };
}

export interface UiActions {
  /** Queues `count` of a class (a full queue refuses the extras). */
  produce(building: number, blueprint: number, count: number): void;
  /** Remove the item at `index` (0 = being built) from a factory's queue. */
  dequeue(building: number, index: number): void;
  setModule(entity: number, index: number, on: boolean): void;
  /** Start placing a building blueprint. */
  place(blueprint: number): void;
  /** Image for a class, drawn with the game's own sprite art. */
  iconFor(blueprint: number): Promise<string>;
  /** Press an action-grid button. */
  press(id: string, queue: boolean): void;
  /** Select control group n (like pressing its number key). */
  recallGroup(n: number): void;
  /** Select all the player's units of a class (`add`: keep the current selection too). */
  selectClass(blueprint: number, add: boolean): void;
  /** The waiting room's host starts the match. */
  startGame(): void;
  /** Switch to watching the whole map (after defeat, or once the match is decided). */
  spectate(): void;
  /** Leave the room and return to the menu. */
  leave(): void;
  /** Ask the server where an own unit's CPU goes (answered with a cpuProfile message). */
  requestCpuProfile(unit: number): void;
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The invite link row shared by the pause and waiting-room panels. */
const inviteHtml = (url?: string): string =>
  url
    ? `<div class="pause-invite"><input class="invite-url" aria-label="Invite link" readonly value="${esc(url)}"><button class="invite-copy" type="button" data-sound="lobby.invite_copied">Copy link</button></div>`
    : '';

function bindInvite(root: HTMLElement, url?: string): void {
  const copy = root.querySelector<HTMLButtonElement>('.invite-copy');
  copy?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url!);
      copy.textContent = 'Copied';
    } catch {
      root.querySelector<HTMLInputElement>('.invite-url')?.select();
      copy.textContent = 'Select link';
    }
  });
}

/** Plain-DOM play UI: header, selection details, production, module switches, build options, top-bar meters. */
export class Ui {
  private readonly status = el<HTMLSpanElement>('status');
  private readonly resourceBars = el<HTMLDivElement>('resource-bars');
  private readonly productionPanel = el<HTMLDivElement>('production');
  private readonly productionStatus = el<HTMLDivElement>('production-status');
  private readonly productionButtons = el<HTMLDivElement>('production-buttons');
  /** The units a selected factory can build: a button in the pane opens them as a pop-over beside it, like the build menu. */
  private readonly unitMenu = el<HTMLDivElement>('unitmenu');
  private readonly unitToggle = el<HTMLButtonElement>('unit-menu-toggle');
  private unitMenuOpen = false;
  private readonly queueGrid = el<HTMLDivElement>('production-queue');
  private queueSlots: { btn: HTMLButtonElement; img: HTMLImageElement; fill: HTMLSpanElement; bp: number }[] = [];
  private queueIcons = new Map<number, string>();
  private queueFor = -1;
  private readonly modulesPanel = el<HTMLDivElement>('modules');
  private readonly modulesBox = el<HTMLElement>('modules-box');
  /** Modal sections of the left pane: each is shown only while the selection needs it. */
  private readonly buildSection = el<HTMLElement>('build-section');
  private readonly actionsSection = el<HTMLElement>('actions-section');
  private readonly selectionSection = el<HTMLElement>('selection-section');
  private readonly docsOverlay = el<HTMLDivElement>('docs-overlay');
  private readonly docsFrame = el<HTMLIFrameElement>('docs-frame');
  private readonly buildBar = el<HTMLDivElement>('buildbar');
  /** Build-bar category currently expanded, or null at the top level. */
  private openCategory: string | null = null;
  /** Keyboard highlight in the open pop-over (or the flat building list), or -1. */
  private buildCursor = -1;
  private buildGroups = new Map<string, Blueprint[]>();
  /** True while the build pop-over finishes a category swap (its old panel has just slid away). */
  private swapped = false;
  /** The open category's buildings, as a grid in a pop-over over the map. */
  private readonly buildMenu = el<HTMLDivElement>('buildmenu');
  private readonly selectionTitle = el<HTMLDivElement>('selection-title');
  private readonly scoreboard = el<HTMLTableElement>('scoreboard');
  private readonly standings = el<HTMLDivElement>('standings');
  private readonly pauseView = el<HTMLDivElement>('pause');
  private readonly waitingView = el<HTMLDivElement>('waiting');
  private readonly defeatView = el<HTMLDivElement>('defeat');
  private readonly spectatingBadge = el<HTMLDivElement>('spectating');
  private pauseTimer: number | undefined;
  private readonly actionGrid = el<HTMLDivElement>('actions');
  private readonly groupBar = el<HTMLDivElement>('groups');
  private readonly resourceList = el<HTMLDivElement>('selection-resources');
  /** Recent resource levels of every own entity, for the selection sparklines. */
  private readonly history = new ResourceHistory();
  private readonly actionHint = el<HTMLDivElement>('action-hint');
  private placing = -1;

  private credits = 0;
  /** Recent (tick, matter pool) samples, for the matter-per-tick figure. */
  private poolSamples: { tick: number; pool: number }[] = [];
  /** Per silo: its amount a window ago and how much it changed over the last full window (negative = draining). */
  private readonly siloMarks = new Map<number, { tick: number; amount: number; delta: number }>();
  /** Building classes that carry a battery (for the energy storage list). */
  private readonly batteryClass = new Map<number, boolean>();
  /** Rebuild buttons/toggles only when these change, so clicks aren't lost to DOM churn. */
  private productionKey = '';
  private productionCosts: { btn: HTMLButtonElement; cost: number; fits: boolean }[] = [];
  private modulesKey = '';

  constructor(
    private readonly state: ClientState,
    private readonly actions: UiActions,
  ) {
    this.wireBuildMenuDismiss();
    this.wireUnitMenu();
    // Docs open over the game area (the game keeps running) or in a new tab.
    el<HTMLButtonElement>('docs-open').onclick = () => this.toggleDocs(true);
    el<HTMLButtonElement>('docs-close').onclick = () => this.toggleDocs(false);
    el<HTMLButtonElement>('docs-back').onclick = () => this.docsFrame.contentWindow?.history.back();
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'F1') {
        ev.preventDefault();
        this.toggleDocs(!isShown(this.docsOverlay));
      } else if (ev.key === 'Escape' && isShown(this.docsOverlay)) {
        this.toggleDocs(false);
      }
    });
    // The Power tile sits in the Energy drop-down; its hover is tracked on the stable container.
    const track = (e: PointerEvent) => {
      const over = !!(e.target as Element | null)?.closest?.('.env-power');
      if (over && !this.state.showPowerLabels) playSound('ui.power_overlay');
      this.state.showPowerLabels = over;
    };
    this.resourceBars.addEventListener('pointerover', track);
    this.resourceBars.addEventListener('pointermove', track);
    this.resourceBars.addEventListener('pointerleave', () => (this.state.showPowerLabels = false));
    // The selection title strip in the left pane is as tall as the top bar, so its text lines up with the bar's middle.
    const topbar = document.getElementById('topbar');
    if (topbar && typeof ResizeObserver !== 'undefined')
      new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`)).observe(topbar);
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  setPlayer(name: string, room?: string): void {
    this.setStatus(room ? `${name} · ${room}` : name);
  }

  /** Top-right table of every present player: score, then made / lost / destroyed (units/buildings). */
  setScoreboard(players: readonly ScoreEntry[]): void {
    this.scoreboard.innerHTML = this.scoreTable(players, `Players (${players.length})`);
    this.scoreboard.hidden = players.length === 0;
  }

  /** Overlay while the server has stopped the game; an empty list hides it. */
  showPause(reasons: readonly string[], away: readonly { name: string; remainingMs: number }[] = [], inviteUrl?: string): void {
    if (this.pauseTimer !== undefined) window.clearInterval(this.pauseTimer);
    this.pauseTimer = undefined;
    const deadlines = away.map(({ name, remainingMs }) => ({ name, deadline: performance.now() + remainingMs }));
    const render = () => {
      const lines = reasons
        .filter((reason) => !deadlines.some(({ name }) => reason.startsWith(`${name} disconnected`)))
        .map((reason) => `<li>${esc(reason)}</li>`);
      for (const player of deadlines) {
        const seconds = Math.max(0, Math.ceil((player.deadline - performance.now()) / 1000));
        lines.push(`<li class="away">${esc(player.name)} disconnected — leaves in ${seconds}s</li>`);
      }
      this.pauseView.hidden = lines.length === 0;
      this.pauseView.innerHTML = lines.length ? `<h2>Game paused</h2><ul>${lines.join('')}</ul>${inviteHtml(inviteUrl)}` : '';
      bindInvite(this.pauseView, inviteUrl);
    };
    render();
    if (reasons.length && deadlines.length) this.pauseTimer = window.setInterval(render, 1000);
  }

  /**
   * The waiting room: who has joined, an invite link, and (for the host) the Start button.
   * Shown until the server reports the match has started.
   */
  showWaitingRoom(lobby: Extract<ServerMessage, { t: 'lobby' }>, inviteUrl: string): void {
    const host = lobby.hostId === this.state.myId;
    const enough = lobby.players.length >= lobby.minPlayers;
    const rows = lobby.players
      .map((p) => {
        const colour = `#${ownerColour(p.id).toString(16).padStart(6, '0')}`;
        const tags = [p.id === lobby.hostId ? 'host' : '', p.id === this.state.myId ? 'you' : ''].filter(Boolean).join(', ');
        return `<li><span class="dot" style="background:${colour}"></span>${esc(p.name)}<span class="tag">${tags}</span></li>`;
      })
      .join('');
    const hint = !enough
      ? `Waiting for ${lobby.minPlayers - lobby.players.length} more player${lobby.minPlayers - lobby.players.length > 1 ? 's' : ''} — share the link below.`
      : host
        ? 'Start whenever everyone is here.'
        : 'Waiting for the host to start the game…';
    this.waitingView.innerHTML = `<h2>Waiting room</h2>
      <p class="muted">${esc(lobby.mapName)} · ${lobby.players.length}/${lobby.capacity} players${lobby.mode === 'coop' ? ' · co-op against bots' : ''}</p>
      <ul>${rows}</ul>
      <p class="muted">${hint}</p>
      ${inviteHtml(inviteUrl)}
      <div class="row">${host ? `<button id="waiting-start" class="primary" type="button" data-sound="ui.confirm"${enough ? '' : ' disabled'}>Start game</button>` : ''}<button id="waiting-leave" type="button" data-sound="match.leave">Leave</button></div>`;
    this.waitingView.hidden = false;
    bindInvite(this.waitingView, inviteUrl);
    this.waitingView.querySelector<HTMLButtonElement>('#waiting-start')?.addEventListener('click', () => this.actions.startGame());
    el<HTMLButtonElement>('waiting-leave').onclick = () => this.actions.leave();
  }

  hideWaitingRoom(): void {
    this.waitingView.hidden = true;
    this.waitingView.innerHTML = '';
  }

  private campaign: CampaignEnd | undefined;

  /** Campaign levels add "Retry" (and, after a win, "Next mission") to the end-of-mission screens. */
  setCampaign(campaign: CampaignEnd): void {
    this.campaign = campaign;
  }

  /** A player with nothing left (defeated or resigned) chooses between watching the whole map and leaving. */
  showDefeat(): void {
    const retry = this.campaign ? '<button id="defeat-retry" class="primary" type="button" data-sound="ui.confirm">Retry mission</button>' : '';
    this.defeatView.innerHTML = `<h2>You have been defeated</h2>
      <p class="muted">The match goes on without you. Spectate to watch it with the fog of war lifted.</p>
      <div class="end-actions">${retry}<button id="defeat-spectate"${this.campaign ? '' : ' class="primary"'} type="button" data-sound="match.spectate">Spectate</button><button id="defeat-leave" type="button" data-sound="match.leave">Leave to menu</button></div>`;
    this.defeatView.hidden = false;
    revealScreen(this.defeatView);
    if (this.campaign) el<HTMLButtonElement>('defeat-retry').onclick = () => this.campaign!.retry();
    el<HTMLButtonElement>('defeat-spectate').onclick = () => this.actions.spectate();
    el<HTMLButtonElement>('defeat-leave').onclick = () => this.actions.leave();
  }

  hideDefeat(): void {
    this.defeatView.hidden = true;
  }

  /** Spectator mode: a badge over the map, the unusable controls hidden, and Resign becomes Leave. */
  setSpectating(on: boolean): void {
    this.spectatingBadge.hidden = !on;
    document.body.classList.toggle('spectating', on);
    if (on) this.hideDefeat();
  }

  /** Final standings, shown over the map when the match has a winner; the game keeps running underneath. */
  showStandings(
    winner: number,
    standings: readonly ScoreEntry[],
    reason: MatchEndReason,
    winners: readonly number[] = [winner],
  ): void {
    const name = standings.filter((p) => winners.includes(p.id)).map((p) => p.name).join(' & ');
    const won = winners.includes(this.state.myId);
    const headline = won ? 'Victory!' : name ? `${esc(name)} win${winners.length > 1 ? '' : 's'}` : 'Match over';
    const why = {
      eliminated: 'All opposing forces have been destroyed.',
      'last-player': 'Every other player has left.',
      'no-power': 'Only one player still has powered units.',
    }[reason];
    this.standings.innerHTML = `<h2>${headline}</h2><p class="muted">${why}</p><table>${this.scoreTable(standings, 'Final standings')}</table>
      <div class="end-actions">${won && this.campaign?.next ? `<button id="standings-next" class="primary" data-sound="ui.confirm">${esc(this.campaign.next.label)}</button>` : ''}${
        !won && this.campaign ? '<button id="standings-retry" class="primary" data-sound="ui.confirm">Retry mission</button>' : ''
      }${won ? '<button id="standings-quit" data-sound="match.leave">Quit as victor</button>' : ''}<button id="standings-close" data-sound="ui.cancel">Keep playing</button>${
        won ? '' : '<button id="standings-spectate" data-sound="match.spectate">Spectate</button><button id="standings-leave" data-sound="match.leave">Leave to menu</button>'
      }</div>`;
    this.standings.hidden = false;
    revealScreen(this.standings);
    this.hideDefeat();
    el<HTMLButtonElement>('standings-close').onclick = () => (this.standings.hidden = true);
    if (won && this.campaign?.next) el<HTMLButtonElement>('standings-next').onclick = () => this.campaign!.next!.go();
    if (!won && this.campaign) el<HTMLButtonElement>('standings-retry').onclick = () => this.campaign!.retry();
    if (won) el<HTMLButtonElement>('standings-quit').onclick = () => this.actions.leave();
    else {
      el<HTMLButtonElement>('standings-spectate').onclick = () => {
        this.standings.hidden = true;
        this.actions.spectate();
      };
      el<HTMLButtonElement>('standings-leave').onclick = () => this.actions.leave();
    }
  }

  private scoreTable(players: readonly ScoreEntry[], title: string): string {
    const pair = (u: number, b: number) => `${u}/${b}`;
    const rows = [...players]
      .sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.score - a.score)
      .map((p) => {
        const colour = `#${ownerColour(p.id).toString(16).padStart(6, '0')}`;
        const cls = [p.id === this.state.myId ? 'me' : '', p.eliminated ? 'out' : ''].filter(Boolean).join(' ');
        return `<tr${cls ? ` class="${cls}"` : ''}><td><span class="dot" style="background:${colour}"></span>${esc(p.name)}</td><td>${p.score}</td><td>${pair(p.createdUnits, p.createdBuildings)}</td><td>${pair(p.lostUnits, p.lostBuildings)}</td><td>${pair(p.destroyedUnits, p.destroyedBuildings)}</td></tr>`;
      })
      .join('');
    const head = `<tr><th>${title}</th><th title="Resources in silos + cost of buildings and units">Score</th><th title="Units / buildings created">Made</th><th title="Units / buildings lost">Lost</th><th title="Enemy units / buildings destroyed">Kills</th></tr>`;
    return head + rows;
  }

  /** One bar per resource type the player has capacity for: matter in silos, energy in power networks. */
  renderResourceBars(): void {
    const { pool, poolCapacity, networks, world } = this.state;
    const unit = world.store(Unit);
    const stock = world.store(Stockpile).f.amount;
    const energyPct = world.store(EnergyView).f.pct;
    const sun = this.state.daylight;
    const air = this.state.wind;
    const fmt = (n: number): string => (n >= 10 || n === 0 ? String(Math.round(n)) : n.toFixed(1));
    const signed = (n: number): string => `${n >= 0 ? '+' : '-'}${fmt(Math.abs(n))}/t`;

    // Silos: every finished one of the player's.
    const silos: { e: number; name: string; amount: number; cap: number }[] = [];
    const unitCounts = new Map<number, number>(); // class id -> how many of the player's units
    for (const e of unit.dense) {
      if (unit.f.owner[e] !== this.state.myId || this.state.isSite(e)) continue;
      const st = this.state.stats(e);
      if (st && !st.structure) unitCounts.set(unit.f.blueprint[e], (unitCounts.get(unit.f.blueprint[e]) ?? 0) + 1);
      if (st?.structure && st.resourceCapacity > 0) silos.push({ e, name: this.state.blueprints.get(unit.f.blueprint[e])?.name ?? 'Silo', amount: stock[e], cap: st.resourceCapacity });
    }
    silos.sort((a, b) => a.e - b.e);

    // Grids: a power network that has a generator or a battery. A split network is a separate grid.
    interface Gen { kind: 'sun' | 'wind'; bp: number; name: string; count: number; rate: number; peak: number }
    interface Grid {
      first: number;
      stored: number;
      capacity: number;
      buildings: number;
      balance: number;
      cover: number;
      supply: number;
      delivered: number;
      stores: { e: number; name: string; pct: number; cap: number; flow: number }[];
      gens: Map<string, Gen>;
    }
    const grids: Grid[] = [];
    let unlinked = 0;
    for (const net of [...networks].sort((a, b) => a.members[0] - b.members[0])) {
      const g: Grid = {
        first: net.members[0],
        stored: net.stored,
        capacity: net.capacity,
        buildings: 0,
        balance: net.supply - net.delivered,
        cover: net.demand > 0 ? (net.delivered / net.demand) * 100 : 100,
        supply: net.supply,
        delivered: net.delivered,
        stores: [],
        gens: new Map(),
      };
      let relevant = false;
      for (let mi = 0; mi < net.members.length; mi++) {
        const e = net.members[mi];
        if (!world.isAlive(e) || !unit.has(e) || this.state.isSite(e)) continue;
        const st = this.state.stats(e);
        if (!st) continue;
        g.buildings++;
        const bpId = unit.f.blueprint[e];
        const name = this.state.blueprints.get(bpId)?.name ?? 'Building';
        if (this.hasBattery(bpId)) {
          relevant = true;
          g.stores.push({ e, name, pct: energyPct[e], cap: st.energyCapacity, flow: net.flow[mi] ?? 0 });
        }
        for (const [kind, output] of [['sun', st.solar], ['wind', st.wind]] as const) {
          if (output <= 0) continue;
          relevant = true;
          const key = `${kind}:${bpId}`;
          const gen = g.gens.get(key) ?? { kind, bp: bpId, name, count: 0, rate: 0, peak: 0 };
          gen.count++;
          gen.rate += kind === 'sun' ? generationPerTick(output, 0, sun, 0) : generationPerTick(0, output, 0, air);
          gen.peak += kind === 'sun' ? generationPerTick(output, 0, 100, 0) : generationPerTick(0, output, 0, 100);
          g.gens.set(key, gen);
        }
      }
      if (relevant) grids.push(g);
      else unlinked += g.buildings;
    }
    const energy = grids.reduce((a, g) => a + g.stored, 0);
    const energyMax = grids.reduce((a, g) => a + g.capacity, 0);

    // Net matter per tick over the last few seconds (harvesting minus spending).
    const samples = this.poolSamples;
    const lastSample = samples[samples.length - 1];
    if (lastSample && this.state.tick < lastSample.tick) samples.length = 0; // the match restarted
    if (!lastSample || lastSample.tick !== this.state.tick) samples.push({ tick: this.state.tick, pool });
    while (samples.length > 2 && this.state.tick - samples[0].tick > MATTER_RATE_WINDOW) samples.shift();
    const span = this.state.tick - samples[0].tick;
    const rate = span > 0 ? (pool - samples[0].pool) / span : 0;
    const energyDelta = grids.reduce((a, g) => a + g.balance, 0);

    const rows = [
      { key: 'matter', icon: '◆', label: 'Matter', colour: '#7ee0b5', value: pool, max: poolCapacity },
      { key: 'energy', icon: 'ϟ', label: 'Energy', colour: '#f5c542', value: energy, max: energyMax },
      { key: 'units', icon: '▲', label: 'Units', colour: '#7eb6ff', value: this.state.ownUnitCount(), max: MAX_UNITS_PER_PLAYER },
    ].filter((r) => r.max > 0 || r.key !== 'units'); // Matter and Energy always show: they hold the drop-downs
    this.resourceBars.hidden = false;
    const tiles = rows.map((r) => {
      const drop = true; // every tile opens a drop-down: matter (silos), energy (grids), units (classes)
      const split = r.key === 'energy' && grids.length > 1;
      return this.tileIn(this.resourceBars, r.key, {
        cls: `env-store${drop ? ' env-has-drop' : ''}`,
        icon: r.icon,
        value: String(Math.round(r.value)),
        label: `${r.label} / ${r.max}${split ? ` · ${grids.length} grids` : ''}${r.key === 'matter' ? ` · ${signed(rate)}` : r.key === 'energy' ? ` · ${signed(energyDelta)}` : ''}${drop ? ' ▾' : ''}`,
        drain: r.key === 'matter' ? rate < -0.05 : r.key === 'energy' ? energyDelta < 0 : false,
        pct: r.max > 0 ? (r.value / r.max) * 100 : 0,
        // One bar per grid: a break in the network shows as a gap in the bar.
        segments: r.key === 'energy' ? grids.map((g) => ({ w: g.capacity, pct: g.capacity > 0 ? (g.stored / g.capacity) * 100 : 0, drain: g.balance < 0 })) : undefined,
        colour: r.colour,
        title: `${r.label}: ${Math.round(r.value)} of ${r.max}${r.key === 'matter' ? '. Hover for your silos and the matter income.' : r.key === 'energy' ? `${split ? `, in ${grids.length} separate grids` : ''}. Hover for storage, solar, wind and power.` : '. Hover for your unit classes.'}`,
        drop,
      });
    });
    this.keepOnly(this.resourceBars, tiles);

    // Units drop-down: an information list (no bars) of the classes in play and how many of each.
    const unitsDrop = this.resourceBars.querySelector<HTMLElement>('[data-tile="units"] > .env-drop');
    if (unitsDrop) {
      const classes = [...unitCounts].map(([bp, n]) => ({ bp, n, name: this.state.blueprints.get(bp)?.name ?? 'Unit' })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
      const out: HTMLElement[] = [
        this.tileIn(unitsDrop, 'head', { cls: 'env-plain env-grid-head', icon: '▲', value: String(this.state.ownUnitCount()), label: `Units / ${MAX_UNITS_PER_PLAYER}`, pct: 0, title: 'Your units, by class' }),
      ];
      for (const c of classes) {
        const row = this.tileIn(unitsDrop, `class:${c.bp}`, { cls: 'env-plain env-sub env-click', icon: '', value: String(c.n), label: c.name, pct: 0, title: `${c.n} × ${c.name}. Click to select them all (Shift adds to your selection).` });
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        out.push(row);
      }
      if (!unitsDrop.dataset.wired) {
        // One delegated handler: the rows are kept between updates but come and go with the classes.
        unitsDrop.dataset.wired = '1';
        const pick = (ev: Event, add: boolean) => {
          const key = (ev.target as Element | null)?.closest<HTMLElement>('[data-tile^="class:"]')?.dataset.tile;
          if (key) this.actions.selectClass(Number(key.slice(6)), add);
        };
        unitsDrop.addEventListener('click', (ev) => pick(ev, ev.shiftKey));
        unitsDrop.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            pick(ev, ev.shiftKey);
          }
        });
      }
      if (classes.length === 0) out.push(this.tileIn(unitsDrop, 'none', { cls: 'env-plain env-sub', icon: '', value: '', label: 'No units yet', pct: 0, title: '' }));
      this.keepOnly(unitsDrop, out);
    }

    // Matter drop-down: net income per tick, then every silo with its fill.
    const matterDrop = this.resourceBars.querySelector<HTMLElement>('[data-tile="matter"] > .env-drop');
    if (matterDrop) {
      const deltas = new Map<number, number>(); // matter each silo gained or lost over the last window

      for (const sl of silos) {
        let m = this.siloMarks.get(sl.e);
        if (!m || this.state.tick < m.tick) this.siloMarks.set(sl.e, (m = { tick: this.state.tick, amount: sl.amount, delta: 0 }));
        else if (this.state.tick - m.tick >= MATTER_RATE_WINDOW) {
          m.delta = sl.amount - m.amount;
          m.tick = this.state.tick;
          m.amount = sl.amount;
        }
        deltas.set(sl.e, m.delta);
      }
      if (this.siloMarks.size > silos.length) for (const e of [...this.siloMarks.keys()]) if (!silos.some((sl) => sl.e === e)) this.siloMarks.delete(e);
      const out: HTMLElement[] = [
        this.tileIn(matterDrop, 'silos', {
          cls: 'env-grid-head',
          drain: rate < -0.05,
          icon: '◆',
          value: String(Math.round(pool)),
          label: `Silos / ${poolCapacity}`,
          extra: signed(rate),
          negative: rate < 0,
          pct: poolCapacity > 0 ? (pool / poolCapacity) * 100 : 0,
          colour: '#7ee0b5',
          title: `All your silos: ${Math.round(pool)} of ${poolCapacity} matter. The change per tick is harvesting minus what you spend, over the last ${MATTER_RATE_WINDOW / 10} seconds.`,
        }),
      ];
      for (const row of collapseByClass(silos)) {
        const amount = row.items.reduce((a, sl) => a + sl.amount, 0);
        const cap = row.items.reduce((a, sl) => a + sl.cap, 0);
        out.push(
          this.tileIn(matterDrop, `silo:${row.key}`, {
            cls: 'env-sub',
            drain: row.items.reduce((a, sl) => a + (deltas.get(sl.e) ?? 0), 0) < 0,
            icon: '▣',
            value: String(amount),
            label: `${row.label} / ${cap}`,
            pct: (amount / cap) * 100,
            colour: '#7ee0b5',
            title: `${row.label}: ${amount} of ${cap}`,
          }),
        );
      }
      if (silos.length === 0) out.push(this.tileIn(matterDrop, 'none', { cls: 'env-plain env-sub', icon: '', value: '', label: 'No silos yet', pct: 0, title: 'Build a silo to store matter' }));
      this.keepOnly(matterDrop, out);
    }

    // Energy drop-down, a strict tree: each grid (total and change per tick) with its storage and generators
    // beneath it, then the world (solar and wind levels) that the generators follow.
    const drop = this.resourceBars.querySelector<HTMLElement>('[data-tile="energy"] > .env-drop');
    if (!drop) return;
    const env: HTMLElement[] = [];
    grids.forEach((g, gi) => {
      const k = `g${g.first}`;
      env.push(
        this.tileIn(drop, `${k}:head`, {
          cls: 'env-grid-head',
          drain: g.balance < 0,
          icon: 'ϟ',
          value: String(Math.round(g.stored)),
          label: `Grid ${gi + 1} / ${g.capacity}`,
          extra: `${g.balance >= 0 ? '+' : ''}${g.balance}/t`,
          negative: g.balance < 0,
          pct: g.capacity > 0 ? (g.stored / g.capacity) * 100 : 0,
          colour: '#f5c542',
          title: `Grid ${gi + 1}: ${g.buildings} linked building${g.buildings === 1 ? '' : 's'}, ${Math.round(g.stored)} of ${g.capacity} energy stored. Generated ${g.supply}/tick, delivered to consumers ${g.delivered}/tick. ${grids.length > 1 ? 'It is cut off from your other grids.' : ''}`,
        }),
      );
      for (const row of collapseByClass(g.stores)) {
        const amount = row.items.reduce((a, st) => a + Math.round((st.pct * st.cap) / 100), 0);
        const cap = row.items.reduce((a, st) => a + st.cap, 0);
        env.push(
          this.tileIn(drop, `${k}:store:${row.key}`, {
            cls: 'env-sub',
            drain: row.items.reduce((a, st) => a + st.flow, 0) < 0,
            icon: '▮',
            value: String(amount),
            label: `${row.label} / ${cap}`,
            pct: cap > 0 ? (amount / cap) * 100 : 0,
            colour: '#f5c542',
            title: `${row.label}: ${amount} of ${cap} energy stored`,
          }),
        );
      }
      for (const x of [...g.gens.values()].sort((p, q) => p.bp - q.bp)) {
        const solar = x.kind === 'sun';
        env.push(
          this.tileIn(drop, `${k}:${x.kind}:${x.bp}`, {
            cls: 'env-sub',
            icon: solar ? '☀' : '≋',
            value: `${fmt(x.rate)}/t`,
            label: `${x.name} (x${x.count})`,
            pct: x.peak > 0 ? (x.rate / x.peak) * 100 : 0,
            colour: solar ? '#ffd54a' : '#6fd3ff',
            title: `${x.count} × ${x.name}: about ${fmt(x.rate)} of at most ${fmt(x.peak)} energy per tick right now, before transmission losses`,
          }),
        );
      }
    });
    if (grids.length === 0) env.push(this.tileIn(drop, 'none', { cls: 'env-plain env-sub', icon: '', value: '', label: 'No generators or batteries yet', pct: 0, title: 'Build solar panels, wind turbines or batteries' }));
    if (unlinked > 0) env.push(this.tileIn(drop, 'unlinked', { cls: 'env-plain env-sub', icon: '', value: '', label: `${unlinked} building${unlinked === 1 ? '' : 's'} on a grid with no generator or battery`, pct: 0, title: 'Link them to a grid with a generator by building closer or adding a power pylon' }));
    env.push(this.tileIn(drop, 'world', { cls: 'env-plain env-grid-head', icon: '◍', value: '', label: 'World', extra: `${timeOfDay(this.state.tick, sun, this.state.devSun >= 0)} · ${weatherOf(air)}`, pct: 0, title: `The conditions your generators follow: ${timeOfDay(this.state.tick, sun, this.state.devSun >= 0).toLowerCase()}, ${weatherOf(air).toLowerCase()}` }));
    env.push(this.tileIn(drop, 'sun', { cls: 'env-sub', icon: '☀', value: `${sun}%`, label: 'Solar', pct: sun, colour: '#ffd54a', title: 'Daylight: solar panels follow it' }));
    env.push(this.tileIn(drop, 'wind', { cls: 'env-sub', icon: '≋', value: `${air}%`, label: 'Wind', pct: air, colour: '#6fd3ff', title: 'Wind: turbines follow it' }));
    this.keepOnly(drop, env);
  }

  /** Whether a building class carries a battery module (cached: classes never change under an id). */
  private hasBattery(bp: number): boolean {
    let v = this.batteryClass.get(bp);
    if (v === undefined) {
      v = !!this.state.blueprints.get(bp)?.parts.some((id) => PARTS[id]?.slot === 'battery');
      this.batteryClass.set(bp, v);
    }
    return v;
  }

  /**
   * Creates or updates one meter tile inside `host`. The elements are kept between updates (only changed
   * text and widths are written), so a drop-down under the pointer is never torn down while it is open.
   * `segments` splits the tile's bar into several (one per power grid), each as wide as its weight.
   */
  private tileIn(
    host: HTMLElement,
    key: string,
    o: { cls: string; icon: string; value: string; label: string; pct: number; colour?: string; title: string; drop?: boolean; segments?: { w: number; pct: number; drain?: boolean }[]; extra?: string; negative?: boolean; drain?: boolean },
  ): HTMLElement {
    let t = (Array.from(host.children) as HTMLElement[]).find((c) => c.dataset.tile === key);
    if (!t) {
      t = document.createElement('div');
      t.dataset.tile = key;
      if (o.drop) t.tabIndex = 0; // keyboard and touch users open the drop-down by focusing the tile
      t.innerHTML = '<span class="env-icon" aria-hidden="true"></span><span class="env-value"></span><span class="env-label"></span><span class="env-extra"></span><span class="env-bar"><i></i></span>' + (o.drop ? '<div class="env-drop"></div>' : '');
    }
    const cls = `env-tile ${o.cls}`;
    if (t.className !== cls) t.className = cls;
    // Not a `title`: a hover tooltip would cover the bar it describes. Screen readers get the text instead.
    if (t.getAttribute('aria-label') !== o.title) o.title ? t.setAttribute('aria-label', o.title) : t.removeAttribute('aria-label');
    if (!t.hasAttribute('role')) t.setAttribute('role', 'group');
    if (o.colour && t.style.getPropertyValue('--c') !== o.colour) t.style.setProperty('--c', o.colour);
    const set = (sel: string, text: string) => {
      const n = t!.querySelector<HTMLElement>(`:scope > ${sel}`)!;
      if (n.textContent !== text) n.textContent = text;
    };
    set('.env-icon', o.icon);
    set('.env-value', o.value);
    set('.env-label', o.label);
    set('.env-extra', o.extra ?? '');
    t.classList.toggle('neg', o.negative === true);
    t.classList.toggle('drain', o.drain === true); // draining: the whole bar goes red
    const clamp = (n: number): string => `${Math.max(0, Math.min(100, n))}%`;
    const bar = t.querySelector<HTMLElement>(':scope > .env-bar')!;
    if (o.segments) {
      const segs = o.segments.length ? o.segments : [{ w: 1, pct: 0 }];
      if (bar.firstElementChild?.tagName === 'I') bar.replaceChildren(); // was a plain bar
      bar.classList.add('segmented');
      while (bar.children.length > segs.length) bar.lastElementChild!.remove();
      while (bar.children.length < segs.length) bar.append(document.createElement('b')), bar.lastElementChild!.append(document.createElement('i'));
      const total = segs.reduce((a, sg) => a + Math.max(0, sg.w), 0) || 1;
      segs.forEach((sg, n) => {
        const seg = bar.children[n] as HTMLElement;
        const grow = String(Math.max(0.08, Math.max(0, sg.w) / total)); // never a sliver too thin to see
        if (seg.style.flexGrow !== grow) seg.style.flexGrow = grow;
        const colour = sg.drain ? 'var(--bad)' : (o.colour ?? 'var(--accent)');
        if (seg.style.getPropertyValue('--c') !== colour) seg.style.setProperty('--c', colour);
        const fill = seg.firstElementChild as HTMLElement;
        const width = clamp(sg.pct);
        if (fill.style.width !== width) fill.style.width = width;
      });
      return t;
    }
    const fill = bar.firstElementChild as HTMLElement;
    const width = clamp(o.pct);
    if (fill.style.width !== width) fill.style.width = width;
    return t;
  }

  /** Makes `host` hold exactly `tiles`, in order, moving or removing elements only when they differ. */
  private keepOnly(host: HTMLElement, tiles: readonly HTMLElement[]): void {
    tiles.forEach((t, i) => {
      if (host.children[i] !== t) host.insertBefore(t, host.children[i] ?? null);
    });
    while (host.children.length > tiles.length) host.lastElementChild!.remove();
  }

  setCredits(amount: number): void {
    this.credits = amount;
    this.updateAffordability();
  }

  /**
   * The heading at the top of the left pane: the class of the unit or building under the cursor, otherwise of the
   * selection ("Scout", "5 × Scout", or "7 selected units" when the classes differ). An enemy or neutral unit
   * says so. Hidden when there is nothing to name.
   */
  renderSelectionTitle(hovered: number, selection: ReadonlySet<number>): void {
    const { world, blueprints } = this.state;
    const unit = world.store(Unit);
    const alive = (e: number) => e >= 0 && world.isAlive(e) && unit.has(e);
    const ids = alive(hovered) ? [hovered] : [...selection].filter(alive);
    let text = '';
    const resource = world.store(Resource);
    const nodes = alive(hovered) ? 0 : [...selection].filter((e) => world.isAlive(e) && resource.has(e)).length;
    if (ids.length === 0 && nodes > 0) {
      text = nodes === 1 ? 'Matter deposit' : `${nodes} × Matter deposit`;
    } else if (ids.length === 1) {
      const name = blueprints.get(unit.f.blueprint[ids[0]])?.name;
      if (name) text = this.state.isMine(ids[0]) ? name : `${name} (${unit.f.owner[ids[0]] === 0 ? 'neutral' : 'enemy'})`;
    } else {
      const own = ids.filter((e) => this.state.isMine(e));
      if (own.length > 1) {
        const first = unit.f.blueprint[own[0]];
        const same = own.every((e) => unit.f.blueprint[e] === first);
        text = same ? `${own.length} × ${blueprints.get(first)?.name ?? 'units'}` : `${own.length} selected units`;
      }
    }
    this.selectionTitle.hidden = !text;
    if (this.selectionTitle.textContent !== text) this.selectionTitle.textContent = text;
  }

  /**
   * The action grid: common actions (always present, disabled when no selected
   * unit can do them) followed by the buttons the selected classes declare.
   * Rebuilt only when the set of buttons changes, so clicks aren't lost.
   */
  renderActions(actions: readonly ActionButton[], aiming: ActionButton | null, demolishArmed = false): void {
    const key = actions.map((a) => `${a.id}/${a.key}/${a.label}`).join('|');
    if (this.actionGrid.dataset.key !== key) {
      this.actionGrid.dataset.key = key;
      this.actionGrid.innerHTML = '';
      for (const a of actions) {
        const btn = document.createElement('button');
        btn.className = a.custom ? 'action custom' : 'action';
        btn.dataset.id = a.id;
        btn.innerHTML = `<span class="icon">${esc(a.icon)}</span><span class="label">${esc(a.label)}</span>${a.key ? `<kbd>${esc(a.key)}</kbd>` : ''}`;
        btn.onclick = (ev) => this.actions.press(a.id, ev.ctrlKey || ev.metaKey || ev.shiftKey);
        this.actionGrid.appendChild(btn);
      }
    }
    for (const btn of this.actionGrid.querySelectorAll<HTMLButtonElement>('button')) {
      const a = actions.find((x) => x.id === btn.dataset.id)!;
      btn.disabled = a.units.length === 0;
      btn.classList.toggle('active', aiming?.id === a.id);
      btn.classList.toggle('armed', demolishArmed && a.id === 'ui:demolish');
      btn.title = `${a.label}${a.key ? ` (${a.key})` : ''}: ${a.doc}${a.units.length ? ` — ${a.units.length} unit${a.units.length > 1 ? 's' : ''}` : ''}`;
    }
    // Orders only appear while the selection can take some.
    this.actionsSection.hidden = !actions.some((a) => a.units.length > 0);
    const demolish = actions.find((a) => a.id === 'ui:demolish');
    this.actionHint.textContent = aiming
      ? `${aiming.label}: left-click a target (Ctrl keeps aiming), right-click or Esc cancels`
      : demolishArmed && demolish?.units.length
        ? `Press ${demolish.label} again to ${demolish.label.toLowerCase()} ${demolish.units.length} building${demolish.units.length > 1 ? 's' : ''}`
        : '';
  }

  /** Control group chips (number and size); click selects, a quick second click centres on it. */
  renderGroups(groups: readonly { n: number; size: number }[]): void {
    this.groupBar.hidden = groups.length === 0;
    this.groupBar.innerHTML = '';
    for (const g of groups) {
      const btn = document.createElement('button');
      btn.className = 'group';
      btn.innerHTML = `<b>${g.n}</b><small>${g.size}</small>`;
      btn.title = `Group ${g.n}: ${g.size} unit${g.size > 1 ? 's' : ''} (press ${g.n}; twice to centre on it)`;
      btn.onclick = () => this.actions.recallGroup(g.n);
      this.groupBar.appendChild(btn);
    }
  }

  /** Highlights the build-bar button of the blueprint being placed (or none). */
  setPlacing(blueprint: number): void {
    this.placing = blueprint;
    const buttons = [...this.buildBar.querySelectorAll<HTMLButtonElement>('button')];
    buttons.push(...this.buildMenu.querySelectorAll<HTMLButtonElement>('button'));
    for (const b of buttons) {
      b.classList.toggle('active', Number(b.dataset.blueprint) === blueprint);
    }
  }

  /** Build-bar category for a building class, from the modules it carries (first match wins). */
  private buildCategory(bp: Blueprint): string {
    const slots = new Set(bp.parts.map((id) => PARTS[id]?.slot));
    const has = (...s: string[]) => s.some((x) => slots.has(x as never));
    if (has('factory')) return 'Production';
    if (has('builder', 'repair')) return 'Construction';
    if (has('weapon', 'radar')) return 'Defence';
    if (has('generator')) return 'Power';
    if (has('depot', 'charger')) return 'Logistics';
    if (has('battery', 'antenna')) return 'Power';
    return 'Other';
  }

  /**
   * Tree-style build bar: the top level lists categories (derived from each
   * building's modules, with lone buildings folded into "Other"); picking one
   * pops a menu of that category's buildings up over the map.
   */
  private renderBuildBar(): void {
    const classes = this.state.blueprints.ownedBy(this.state.myId).filter((bp) => bp.stats.structure && !bp.retired);
    const groups = new Map<string, Blueprint[]>();
    for (const bp of classes) {
      const cat = this.buildCategory(bp);
      const list = groups.get(cat) ?? [];
      list.push(bp);
      groups.set(cat, list);
    }
    // Avoid single-building categories by merging them into "Other".
    const other = groups.get('Other') ?? [];
    for (const [cat, list] of [...groups]) {
      if (cat !== 'Other' && list.length < 2) {
        other.push(...list);
        groups.delete(cat);
      }
    }
    if (other.length) groups.set('Other', other);
    else groups.delete('Other');
    for (const list of groups.values()) list.sort((a, b) => a.id - b.id);
    const cats = [...groups.keys()].sort((a, b) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)));
    if (this.openCategory && !groups.has(this.openCategory)) this.openCategory = null;
    this.buildGroups = groups;
    // Nothing to nest: show the buildings directly.
    const flat = cats.length === 1 ? cats[0] : null;

    const key = `${flat ?? ''}|${cats.map((c) => `${c}:${groups.get(c)!.map((bp) => bp.id).join('.')}`).join(',')}`;
    if (this.buildBar.dataset.key !== key) {
      this.buildBar.dataset.key = key;
      this.buildBar.innerHTML = '';
      if (flat) {
        for (const bp of groups.get(flat)!) this.buildBar.appendChild(this.buildingButton(bp));
      } else {
        for (const cat of cats) {
          const list = groups.get(cat)!;
          const btn = document.createElement('button');
          btn.className = 'category';
          btn.dataset.category = cat;
          btn.title = `${cat}: ${list.map((bp) => bp.name).join(', ')}`;
          const img = document.createElement('img');
          img.alt = '';
          this.actions.iconFor(list[0].id).then((src) => (img.src = src)).catch(() => img.remove());
          const label = document.createElement('span');
          label.innerHTML = `${cat}<small>${list.length} buildings</small>`;
          btn.append(img, label);
          btn.dataset.sound = 'none'; // opens or closes below, with its own sound
          btn.onclick = () => {
            this.openCategory = this.openCategory === cat ? null : cat;
            playSound(this.openCategory ? 'build.menu_open' : 'build.menu_close');
            this.renderBuildMenu();
          };
          this.buildBar.appendChild(btn);
        }
      }
    }
    this.renderBuildMenu();
    this.setPlacing(this.placing);
  }

  private buildingButton(bp: Blueprint): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.dataset.blueprint = String(bp.id);
    btn.dataset.sound = 'build.choose';
    btn.title = `${bp.name}: ${bp.stats.shape ? `${bp.stats.area} tiles in a ${bp.stats.footprint}×${bp.stats.footprint} box` : `${bp.stats.footprint}×${bp.stats.footprint}`}, costs ◆${bp.stats.cost} and ϟ${buildEnergyCost(bp.stats.area)} (paid as it is built). Select builders first to assign them.`;
    const img = document.createElement('img');
    img.alt = '';
    this.actions.iconFor(bp.id).then((src) => (img.src = src)).catch(() => img.remove());
    const label = document.createElement('span');
    label.innerHTML = `${esc(bp.name)}<small>◆${bp.stats.cost} ϟ${buildEnergyCost(bp.stats.area)}</small>`;
    btn.append(img, label);
    btn.onclick = (ev) => {
      this.actions.place(bp.id);
      // Placing starts: clear the pop-over off the map, unless Ctrl/Shift says keep building.
      if (!ev.ctrlKey && !ev.shiftKey) this.closeBuildMenu();
    };
    return btn;
  }

  private navButtons(): HTMLButtonElement[] {
    if (this.openCategory) return [...this.buildMenu.querySelectorAll<HTMLButtonElement>('.build-grid button')];
    if (!this.buildBar.querySelector('button.category')) return [...this.buildBar.querySelectorAll<HTMLButtonElement>('button[data-blueprint]')];
    return [];
  }

  private showBuildCursor(): void {
    const buttons = this.navButtons();
    buttons.forEach((b, i) => b.classList.toggle('kbd-focus', i === this.buildCursor));
    buttons[this.buildCursor]?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Build-menu hotkeys (configurable under Options > Controls): open or close the pop-over, step through
   * categories and buildings, place the highlighted one. False if the key does nothing right now (no
   * builder selected, nothing highlighted), so it can fall through to another control.
   */
  buildKey(act: string): boolean {
    if (this.buildSection.hidden) return false;
    const tabs = [...this.buildBar.querySelectorAll<HTMLButtonElement>('button.category')].map((b) => b.dataset.category!);
    const openCategory = (cat: string | null) => {
      this.openCategory = cat;
      this.buildCursor = -1;
      playSound(cat ? 'build.menu_open' : 'build.menu_close');
      this.renderBuildMenu();
    };
    const dir = act.endsWith('Next') ? 1 : -1;
    switch (act) {
      case 'buildMenu':
        if (!tabs.length) return false;
        openCategory(this.openCategory ? null : tabs[0]);
        return true;
      case 'buildCategoryPrev':
      case 'buildCategoryNext': {
        if (!tabs.length) return false;
        const at = this.openCategory ? tabs.indexOf(this.openCategory) : -1;
        openCategory(tabs[at < 0 ? (dir > 0 ? 0 : tabs.length - 1) : (at + dir + tabs.length) % tabs.length]);
        return true;
      }
      case 'buildItemPrev':
      case 'buildItemNext': {
        const n = this.navButtons().length;
        if (!n) return false;
        this.buildCursor = this.buildCursor < 0 ? (dir > 0 ? 0 : n - 1) : (this.buildCursor + dir + n) % n;
        this.showBuildCursor();
        return true;
      }
      case 'buildConfirm': {
        const button = this.navButtons()[this.buildCursor];
        if (!button) return false;
        button.click();
        return true;
      }
    }
    return false;
  }

  private closeBuildMenu(): void {
    if (!this.openCategory) return;
    this.openCategory = null;
    playSound('build.menu_close');
    this.renderBuildMenu();
  }

  /** Lines the pop-over up with its category tab: top edge level with the button, left edge over the pane's border line. */
  private positionBuildMenu(): void {
    const menu = this.buildMenu;
    const cat = this.openCategory;
    if (!cat || menu.hidden) return;
    const tab = [...this.buildBar.querySelectorAll<HTMLButtonElement>('button.category')].find((b) => b.dataset.category === cat);
    if (!tab) return;
    const pane = el<HTMLElement>('panel').getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const top = Math.max(0, tabRect.top);
    menu.style.setProperty('--tab-h', `${tabRect.height}px`);
    menu.style.left = `${pane.right - 1}px`;
    menu.style.top = `${top}px`;
    menu.style.maxHeight = `${Math.max(120, window.innerHeight - top - 8)}px`;
  }

  /** Closes the build pop-over on Escape, or on a click anywhere but the pop-over and the category buttons. */
  private wireBuildMenuDismiss(): void {
    // The tab moves when the window or the pane scrolls.
    window.addEventListener('resize', () => this.positionBuildMenu());
    el<HTMLElement>('panel').addEventListener('scroll', () => this.positionBuildMenu(), { passive: true });
    window.addEventListener(
      'keydown',
      (ev) => {
        if (ev.key !== 'Escape' || !this.openCategory) return;
        ev.stopImmediatePropagation(); // before the input handler, which would deselect
        this.closeBuildMenu();
      },
      true,
    );
    window.addEventListener(
      'pointerdown',
      (ev) => {
        if (!this.openCategory) return;
        const t = ev.target as Element | null;
        if (t?.closest('#buildmenu, #buildbar')) return;
        this.closeBuildMenu();
      },
      true,
    );
  }

  private wireUnitMenu(): void {
    this.unitToggle.onclick = () => {
      playSound(this.unitMenuOpen ? 'build.menu_close' : 'build.menu_open');
      this.setUnitMenu(!this.unitMenuOpen);
    };
    window.addEventListener('resize', () => this.positionUnitMenu());
    el<HTMLElement>('panel').addEventListener('scroll', () => this.positionUnitMenu(), { passive: true });
    window.addEventListener(
      'keydown',
      (ev) => {
        if (ev.key !== 'Escape' || !this.unitMenuOpen) return;
        ev.stopImmediatePropagation(); // before the input handler, which would deselect
        playSound('build.menu_close');
        this.setUnitMenu(false);
      },
      true,
    );
    window.addEventListener(
      'pointerdown',
      (ev) => {
        if (!this.unitMenuOpen || (ev.target as Element | null)?.closest('#unitmenu, #unit-menu-toggle')) return;
        this.setUnitMenu(false);
      },
      true,
    );
  }

  private setUnitMenu(open: boolean): void {
    const opening = open && !this.unitMenuOpen;
    this.unitMenuOpen = open;
    this.unitToggle.classList.toggle('open', open);
    this.unitMenu.hidden = !open;
    if (!open) {
      this.unitMenu.classList.remove('opening');
      return;
    }
    this.positionUnitMenu();
    if (opening && !document.documentElement.hasAttribute('data-reduce-motion')) {
      const menu = this.unitMenu;
      menu.classList.remove('opening');
      void menu.offsetWidth; // restart the animation if it is still running
      menu.classList.add('opening');
      menu.addEventListener('animationend', () => menu.classList.remove('opening'), { once: true });
    }
  }

  /** Lines the unit pop-over up with its button, the way positionBuildMenu does for a category tab. */
  private positionUnitMenu(): void {
    if (!this.unitMenuOpen) return;
    const menu = this.unitMenu;
    const pane = el<HTMLElement>('panel').getBoundingClientRect();
    const btn = this.unitToggle.getBoundingClientRect();
    const top = Math.max(0, btn.top);
    menu.style.setProperty('--tab-h', `${btn.height}px`);
    menu.style.left = `${pane.right - 1}px`;
    menu.style.top = `${top}px`;
    menu.style.maxHeight = `${Math.max(120, window.innerHeight - top - 8)}px`;
  }

  /** Shows the open category's buildings as a grid in a pop-over over the map. */
  private renderBuildMenu(): void {
    const cat = this.openCategory;
    const list = cat ? this.buildGroups.get(cat) : undefined;
    const menu = this.buildMenu;
    for (const b of this.buildBar.querySelectorAll<HTMLButtonElement>('button.category')) {
      b.classList.toggle('open', b.dataset.category === cat);
    }
    this.buildBar.classList.toggle('has-open', !!cat);
    if (!cat || !list) {
      this.buildCursor = -1;
      menu.classList.remove('opening', 'closing');
      menu.hidden = true;
      menu.innerHTML = '';
      delete menu.dataset.key;
      return;
    }
    if (menu.classList.contains('closing')) return; // the slide-away ends in a render of whatever is open by then
    const menuKey = `${cat}:${list.map((bp) => bp.id).join('.')}`;
    if (menu.dataset.key === menuKey && !menu.hidden) {
      this.positionBuildMenu(); // the same category after a rebuild of the bar: the tab may have moved
      return;
    }
    // Switching category: the current panel slides away under the pane, then the new one slides out.
    if (!menu.hidden && !this.swapped && !document.documentElement.hasAttribute('data-reduce-motion')) {
      menu.classList.remove('opening');
      menu.classList.add('closing');
      menu.addEventListener(
        'animationend',
        () => {
          menu.classList.remove('closing');
          this.swapped = true;
          this.renderBuildMenu();
          this.swapped = false;
        },
        { once: true },
      );
      return;
    }
    menu.dataset.key = menuKey;
    this.buildCursor = -1;
    menu.innerHTML = '';
    const heading = document.createElement('h3');
    heading.textContent = cat;
    const grid = document.createElement('div');
    grid.className = 'build-grid';
    for (const bp of list) grid.appendChild(this.buildingButton(bp));
    menu.append(heading, grid);
    const opening = menu.hidden || this.swapped;
    menu.hidden = false;
    this.positionBuildMenu();
    // Slides out from under the pane (CSS keeps it beneath the pane while `opening`); not with Reduce motion.
    if (opening && !document.documentElement.hasAttribute('data-reduce-motion')) {
      menu.classList.remove('opening');
      void menu.offsetWidth; // restart the animation if it is still running
      menu.classList.add('opening');
      menu.addEventListener('animationend', () => menu.classList.remove('opening'), { once: true });
    }
    this.setPlacing(this.placing);
  }

  /** A message for the player: a pop-in alert at the right of the playfield, below the scoreboard. */
  showResult(text: string, ok: boolean, kind: ToastKind = ok ? 'ok' : 'error'): void {
    showToast(text, kind);
  }

  /** Call once per applied tick: records resource levels for the sparklines. */
  sampleHistory(): void {
    this.history.sample(this.state);
  }

  /**
   * One row per resource the selected own units have: label, a sparkline of the
   * last ~30 s (totals for a group) and the current amount out of the maximum.
   */
  private renderResources(ids: readonly number[], nodes: readonly number[] = []): void {
    const own = ids.filter((e) => this.state.isMine(e));
    const rows: string[] = [];
    const seconds = (HISTORY_SAMPLES * HISTORY_EVERY) / this.state.tickRate;
    for (const m of METRICS) {
      let value = 0;
      let max = 0;
      let any = false;
      for (const e of own) {
        const r = m.read(this.state, e);
        if (!r) continue;
        any = true;
        value += r.value;
        max += r.max;
      }
      if (!any) continue;
      const line = sparkline(this.history.total(m.key, own), max, m.colour);
      rows.push(
        `<div class="res-row" title="${m.label}: last ${seconds}s${own.length > 1 ? `, total of ${own.length} units` : ''}">` +
          `<span class="label">${m.label}</span>${line}<span class="value">${value}<small>/${max}</small></span></div>`,
      );
    }
    // Selected matter nodes: how much is left of how much they hold (a bar, not a history: nodes regrow slowly).
    if (nodes.length) {
      const res = this.state.world.store(Resource);
      const patches = this.state.world.store(ResourcePatch);
      let left = 0;
      let full = 0;
      for (const e of nodes) {
        const amount = res.f.amount[e];
        left += amount;
        full += Math.max(amount, patches.has(e) ? patches.f.maximum[e] : RESOURCE_PATCH_AMOUNT);
      }
      const pct = full > 0 ? Math.round((left / full) * 100) : 0;
      rows.push(
        `<div class="res-row node" title="Matter left in ${nodes.length > 1 ? `these ${nodes.length} deposits` : 'this deposit'}. Harvesters take it; it slowly grows back.">` +
          `<span class="label">Matter</span><span class="node-bar"><i style="width:${pct}%"></i></span><span class="value">${left}<small>/${full}</small></span></div>`,
      );
    }
    this.resourceList.hidden = rows.length === 0;
    this.resourceList.innerHTML = rows.join('');
  }

  /** Called on selection change and every tick. */
  renderSelection(selection: ReadonlySet<number>): void {
    const { world } = this.state;
    const unit = world.store(Unit);
    const ids = [...selection];

    const resource = world.store(Resource);
    this.renderResources(
      ids.filter((e) => world.isAlive(e) && unit.has(e)),
      ids.filter((e) => world.isAlive(e) && resource.has(e)),
    );

    const single = ids.length === 1 && this.state.isMine(ids[0]) ? ids[0] : -1;
    this.renderModules(single);
    this.renderProduction(single);

    // Modal pane: building options only while a builder is selected, details only while there are some.
    const builder = ids.some((e) => this.state.isMine(e) && ((this.state.stats(e)?.caps ?? 0) & Caps.Build) !== 0);
    this.buildSection.hidden = !builder || this.buildBar.childElementCount === 0;
    if (this.buildSection.hidden && this.openCategory) {
      this.openCategory = null; // no builder, no pop-over
      this.renderBuildMenu();
    }
    this.selectionSection.hidden = this.resourceList.hidden;
  }

  private renderModules(e: number): void {
    const bp = e >= 0 ? this.state.blueprints.get(this.state.world.store(Unit).f.blueprint[e]) : undefined;
    this.modulesBox.hidden = !bp;
    if (!bp) return;
    const mask = this.state.world.store(Modules).f.off[e];
    const broken = this.state.world.store(Modules).f.broken[e];
    const key = `${e}|${bp.id}|${mask}|${broken}`;
    if (key === this.modulesKey) return;
    this.modulesKey = key;
    this.modulesPanel.innerHTML = '<div class="muted">Switch a module off to save energy</div>';
    bp.parts.forEach((id, i) => {
      const def = PARTS[id];
      const label = document.createElement('label');
      label.className = 'module';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.sound = 'module';
      const isBroken = ((broken >>> i) & 1) === 1;
      box.checked = !isBroken && !((mask >>> i) & 1);
      box.disabled = isBroken || !SWITCHABLE.has(def.slot);
      if (isBroken) label.classList.add('broken');
      box.onchange = () => this.actions.setModule(e, i, box.checked);
      label.append(box, ` ${i}: ${def.name}${isBroken ? ' (broken: needs repair)' : ''}`);
      if (isBroken) label.title = 'Broken by damage: it does nothing until a repair module mends it';
      else if (def.use) label.title = `Uses ${def.use} energy per ${def.slot === 'sensor' ? 'scan' : def.slot === 'weapon' ? 'shot' : 'tick in use'}`;
      this.modulesPanel.appendChild(label);
    });
  }

  private renderProduction(b: number): void {
    const { world, blueprints } = this.state;
    const prod = world.store(Production);
    const isFactory = b >= 0 && prod.has(b);
    this.productionPanel.hidden = !isFactory;
    if (!isFactory) {
      if (this.unitMenuOpen) this.setUnitMenu(false);
      return;
    }
    this.positionUnitMenu(); // the button moves as the pane's contents change

    const current = blueprints.get(prod.f.blueprint[b]);
    this.productionStatus.textContent = prod.f.queued[b]
      ? `Building ${current?.name ?? '…'} ${prod.f.progress[b]}%`
      : 'Idle — choose a class to build';
    this.renderQueue(b);

    const buildable = blueprints.ownedBy(this.state.myId).filter((bp) => !bp.stats.structure && !bp.retired);
    // The buttons are only rebuilt when the building or the class list changes: rebuilding them as
    // the matter total moves would swallow clicks (the element is replaced between press and release).
    const tiers = blueprints.get(world.store(Unit).f.blueprint[b])?.stats.factoryTiers ?? 0;
    const key = `${b}|${tiers}|${buildable.map((bp) => bp.id).join(',')}`;
    if (key !== this.productionKey) {
      this.productionKey = key;
      this.productionButtons.innerHTML = '';
      this.productionCosts = [];
      for (const bp of buildable) {
        const btn = document.createElement('button');
        const fits = factoryCanBuild(tiers, bp.stats.size);
        const tier = FACTORY_TIER_NAMES[bp.stats.size] ?? 'this size of';
        btn.title = !fits
          ? `${bp.name} is a ${tier} unit: this building has no ${tier} factory module.`
          : `${bp.name}: ◆${bp.stats.cost} + ϟ${bp.stats.buildEnergy}, ${(bp.stats.buildTime / 10).toFixed(1)}s. Click to queue one.`;
        const img = document.createElement('img');
        img.alt = '';
        this.actions.iconFor(bp.id).then((src) => (img.src = src)).catch(() => img.remove());
        const label = document.createElement('span');
        label.innerHTML = `${esc(bp.name)}<small>◆${bp.stats.cost} ϟ${bp.stats.buildEnergy}</small>`;
        btn.append(img, label);
        btn.dataset.sound = 'none';
        btn.onclick = (ev) => {
          // With the fill modifier (Ctrl by default) the clicked unit takes every free place in the queue.
          const free = MAX_PRODUCTION_QUEUE - this.state.world.store(Production).f.queued[b];
          this.actions.produce(b, bp.id, controls.modifierHeld('fillQueue', ev) ? Math.max(1, free) : 1);
        };
        this.productionButtons.appendChild(btn);
        this.productionCosts.push({ btn, cost: bp.stats.cost, fits });
      }
    }
    this.updateAffordability();
  }

  /**
   * The factory's queue as MAX_PRODUCTION_QUEUE slots with a picture of each queued unit; the one being
   * built fills up as it progresses, and clicking a slot removes that item (its matter is refunded).
   * The slot elements are kept between updates (replacing them would swallow clicks).
   */
  private renderQueue(b: number): void {
    const prod = this.state.world.store(Production);
    if (this.queueFor !== b || this.queueSlots.length !== MAX_PRODUCTION_QUEUE) {
      this.queueFor = b;
      this.queueGrid.innerHTML = '';
      this.queueSlots = Array.from({ length: MAX_PRODUCTION_QUEUE }, (_, i) => {
        const btn = document.createElement('button');
        btn.className = 'queue-slot';
        btn.dataset.sound = 'none';
        const fill = document.createElement('span');
        fill.className = 'fill';
        const img = document.createElement('img');
        img.alt = '';
        btn.append(fill, img);
        btn.onclick = () => this.actions.dequeue(b, i);
        this.queueGrid.appendChild(btn);
        return { btn, img, fill, bp: -1 };
      });
    }
    const f = prod.f;
    const behind = [f.q1, f.q2, f.q3, f.q4, f.q5, f.q6, f.q7];
    this.queueSlots.forEach((slot, i) => {
      const filled = i < f.queued[b];
      const id = !filled ? 0 : i === 0 ? f.blueprint[b] : behind[i - 1][b];
      slot.btn.disabled = !filled;
      slot.btn.classList.toggle('empty', !filled);
      slot.btn.classList.toggle('current', filled && i === 0);
      slot.fill.style.height = filled && i === 0 ? `${f.progress[b]}%` : '0';
      if (slot.bp === id) return;
      slot.bp = id;
      const bp = this.state.blueprints.get(id);
      slot.btn.title = filled && bp ? `${bp.name}${i === 0 ? ` (${f.progress[b]}%)` : ''}: click to remove it from the queue and get ◆${bp.stats.cost} back` : '';
      slot.img.hidden = !filled || !bp;
      if (!filled || !bp) return;
      const cached = this.queueIcons.get(id);
      if (cached) slot.img.src = cached;
      else {
        slot.img.removeAttribute('src');
        this.actions.iconFor(id).then((src) => {
          this.queueIcons.set(id, src);
          if (slot.bp === id) slot.img.src = src;
        }).catch(() => undefined);
      }
    });
  }

  /** Greys out production buttons the player can't pay for, in place. */
  private updateAffordability(): void {
    for (const { btn, cost, fits } of this.productionCosts) btn.disabled = !fits || cost > this.credits;
  }

  updateClasses(): void {
    this.productionKey = '';
    this.renderBuildBar();
  }

  private toggleDocs(show: boolean): void {
    if (show && !this.docsFrame.src.endsWith('docs.html')) this.docsFrame.src = 'docs.html';
    setShown(this.docsOverlay, show);
    placeMusic(show ? this.docsOverlay.querySelector<HTMLElement>('.docs-music') : null); // the player sits in the docs bar meanwhile
  }

}
