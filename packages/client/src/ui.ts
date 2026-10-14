import {
  Cargo,
  Construction,
  CpuStatus,
  EnergyView,
  FAULT_NAMES,
  Health,
  Modules,
  PARTS,
  Production,
  Resource,
  Stockpile,
  SWITCHABLE,
  Unit,
  type ScoreEntry,
  type MatchEndReason,
} from '@wst/engine';
import type { ActionButton } from './actions';
import { ownerColour } from './renderer';
import { HISTORY_EVERY, HISTORY_SAMPLES, METRICS, ResourceHistory, sparkline } from './resources';
import type { ClientState } from './state';

export interface UiActions {
  produce(building: number, blueprint: number): void;
  setModule(entity: number, index: number, on: boolean): void;
  /** Start placing a building blueprint. */
  place(blueprint: number): void;
  /** Image for a class, drawn with the game's own sprite art. */
  iconFor(blueprint: number): Promise<string>;
  /** Press an action-grid button. */
  press(id: string, queue: boolean): void;
  /** Select control group n (like pressing its number key). */
  recallGroup(n: number): void;
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const CPU_STATES = ['running', 'asleep', 'NO POWER', 'offline', 'STUNNED'];

/** Plain-DOM play UI: header, selection details, production, module switches, build bar, hover bar. */
export class Ui {
  private readonly status = el<HTMLSpanElement>('status');
  private readonly resourceBars = el<HTMLDivElement>('resource-bars');
  private readonly envView = el<HTMLSpanElement>('environment');
  private readonly selectionSummary = el<HTMLDivElement>('selection-summary');
  private readonly productionPanel = el<HTMLDivElement>('production');
  private readonly productionStatus = el<HTMLDivElement>('production-status');
  private readonly productionButtons = el<HTMLDivElement>('production-buttons');
  private readonly modulesPanel = el<HTMLDivElement>('modules');
  private readonly result = el<HTMLDivElement>('result');
  private readonly docsOverlay = el<HTMLDivElement>('docs-overlay');
  private readonly docsFrame = el<HTMLIFrameElement>('docs-frame');
  private readonly buildBar = el<HTMLDivElement>('buildbar');
  private readonly hoverBar = el<HTMLDivElement>('hoverbar');
  private readonly scoreboard = el<HTMLTableElement>('scoreboard');
  private readonly standings = el<HTMLDivElement>('standings');
  private readonly pauseView = el<HTMLDivElement>('pause');
  private pauseTimer: number | undefined;
  private readonly actionGrid = el<HTMLDivElement>('actions');
  private readonly groupBar = el<HTMLDivElement>('groups');
  private readonly resourceList = el<HTMLDivElement>('selection-resources');
  /** Recent resource levels of every own entity, for the selection sparklines. */
  private readonly history = new ResourceHistory();
  private readonly actionHint = el<HTMLDivElement>('action-hint');
  private placing = -1;

  private credits = 0;
  /** Rebuild buttons/toggles only when these change, so clicks aren't lost to DOM churn. */
  private productionKey = '';
  private modulesKey = '';

  constructor(
    private readonly state: ClientState,
    private readonly actions: UiActions,
  ) {
    // Docs open over the game area (the game keeps running) or in a new tab.
    el<HTMLButtonElement>('docs-open').onclick = () => this.toggleDocs(true);
    el<HTMLButtonElement>('docs-close').onclick = () => this.toggleDocs(false);
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'F1') {
        ev.preventDefault();
        this.toggleDocs(this.docsOverlay.hidden !== false);
      } else if (ev.key === 'Escape' && !this.docsOverlay.hidden) {
        this.toggleDocs(false);
      }
    });
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
      const invite = inviteUrl
        ? `<div class="pause-invite"><input id="pause-invite-url" aria-label="Invite link" readonly value="${esc(inviteUrl)}"><button id="pause-copy" type="button">Copy link</button></div>`
        : '';
      this.pauseView.innerHTML = lines.length ? `<h2>Game paused</h2><ul>${lines.join('')}</ul>${invite}` : '';
      const copy = this.pauseView.querySelector<HTMLButtonElement>('#pause-copy');
      copy?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(inviteUrl!);
          copy.textContent = 'Copied';
        } catch {
          this.pauseView.querySelector<HTMLInputElement>('#pause-invite-url')?.select();
          copy.textContent = 'Select link';
        }
      });
    };
    render();
    if (reasons.length && deadlines.length) this.pauseTimer = window.setInterval(render, 1000);
  }

  /** Final standings, shown over the map when the match has a winner; the game keeps running underneath. */
  showStandings(winner: number, standings: readonly ScoreEntry[], reason: MatchEndReason): void {
    const name = standings.find((p) => p.id === winner)?.name;
    const won = winner === this.state.myId;
    const headline = won ? 'Victory!' : name ? `${esc(name)} wins` : 'Match over';
    const why = {
      eliminated: 'All opposing forces have been destroyed.',
      'last-player': 'Every other player has left.',
      'no-power': 'Only one player still has powered units.',
    }[reason];
    this.standings.innerHTML = `<h2>${headline}</h2><p class="muted">${why}</p><table>${this.scoreTable(standings, 'Final standings')}</table>
      <div class="row">${won ? '<button id="standings-quit">Quit as victor</button>' : ''}<button id="standings-close">${won ? 'Keep playing' : 'Keep watching'}</button></div>`;
    this.standings.hidden = false;
    el<HTMLButtonElement>('standings-close').onclick = () => (this.standings.hidden = true);
    if (won) el<HTMLButtonElement>('standings-quit').onclick = () => (location.href = location.pathname);
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
    const { pool, poolCapacity, networks } = this.state;
    const energy = networks.reduce((a, n) => a + n.stored, 0);
    const energyMax = networks.reduce((a, n) => a + n.capacity, 0);
    const rows = [
      { icon: '◆', label: 'Matter', colour: '#7ee0b5', value: pool, max: poolCapacity },
      { icon: 'ϟ', label: 'Energy', colour: '#f5c542', value: energy, max: energyMax },
    ].filter((r) => r.max > 0);
    const html = rows
      .map((r) => {
        const pct = Math.round(Math.min(1, r.value / r.max) * 100);
        return `<div class="res"><span class="label"><span class="icon" aria-hidden="true">${r.icon}</span>${r.label}</span><span class="track"><i style="width:${pct}%;background:${r.colour}"></i></span><span class="amount">${Math.round(r.value)} / ${r.max}</span></div>`;
      })
      .join('');
    this.resourceBars.hidden = rows.length === 0;
    if (this.resourceBars.innerHTML !== html) this.resourceBars.innerHTML = html;
  }

  setCredits(amount: number): void {
    this.credits = amount;
    this.productionKey = ''; // affordability changed
  }

  /**
   * The info bar across the top of the map: the unit/building under the cursor,
   * otherwise the selection. One object shows its own stats; several own units
   * show totals. Health, energy, then other resources; the name (or "N selected
   * units") sits at the far right so the columns don't jump around.
   */
  renderInfo(hovered: number, selection: ReadonlySet<number>): void {
    const { world } = this.state;
    const alive = (e: number) => e >= 0 && world.isAlive(e) && world.store(Unit).has(e);
    const ids = alive(hovered) ? [hovered] : [...selection].filter(alive);
    const html = ids.length === 1 ? this.singleInfo(ids[0]) : this.groupInfo(ids.filter((e) => this.state.isMine(e)));
    this.hoverBar.hidden = !html;
    if (html && this.hoverBar.innerHTML !== html) this.hoverBar.innerHTML = html;
  }

  private stat(label: string, text: string, fraction?: number, colour?: string): string {
    const className = label === 'CPU' ? 'stat cpu-stat' : 'stat';
    return `<span class="${className}"><span class="label">${label}</span>${
      fraction === undefined
        ? ''
        : `<span class="bar"><i style="width:${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%;background:${colour}"></i></span>`
    }<span>${text}</span></span>`;
  }

  private singleInfo(e: number): string {
    const { world, blueprints } = this.state;
    const bp = blueprints.get(world.store(Unit).f.blueprint[e]);
    const s = this.state.stats(e);
    if (!bp || !s) return '';
    const stat = this.stat.bind(this);
    const items: string[] = [];
    const hp = world.store(Health);
    if (hp.has(e)) items.push(stat('Health', `${hp.f.hp[e]}/${s.hp}`, hp.f.hp[e] / s.hp, '#5bd68a'));
    if (!this.state.isMine(e)) {
      items.push(`<span class="name">${esc(bp.name)} <span class="muted">(${world.store(Unit).f.owner[e] === 0 ? 'neutral' : 'enemy'})</span></span>`);
      return items.join('');
    }
    const energy = world.store(EnergyView);
    if (energy.has(e)) {
      const pct = energy.f.pct[e];
      items.push(stat('Energy', `${pct}% of ${s.energyCapacity}`, pct / 100, '#f5c542'));
    }
    const cargo = world.store(Cargo);
    if (cargo.has(e)) items.push(stat('Cargo', `${cargo.f.amount[e]}/${s.cargo}`, cargo.f.amount[e] / Math.max(1, s.cargo), '#7ee0b5'));
    const stock = world.store(Stockpile);
    if (stock.has(e)) {
      items.push(stat('Silos', `${stock.f.amount[e]}/${s.resourceCapacity}`, stock.f.amount[e] / Math.max(1, s.resourceCapacity), '#7ee0b5'));
    }
    const site = world.store(Construction);
    if (site.has(e)) items.push(stat('Built', `${site.f.progress[e]}%`, site.f.progress[e] / 100, '#4fd1c5'));
    const prod = world.store(Production);
    if (prod.has(e) && prod.f.queued[e] > 0) {
      const name = blueprints.get(prod.f.blueprint[e])?.name ?? '…';
      items.push(stat('Making', `${esc(name)} ${prod.f.progress[e]}%${prod.f.queued[e] > 1 ? ` +${prod.f.queued[e] - 1}` : ''}`, prod.f.progress[e] / 100, '#f5c542'));
    }
    const cpu = world.store(CpuStatus);
    if (cpu.has(e) && s.cyclesPerTick > 0 && !site.has(e)) {
      items.push(stat('CPU', `${CPU_STATES[cpu.f.state[e]]} ${cpu.f.used[e]}/${s.cyclesPerTick}c`));
    }
    const tasks = this.state.tasks.get(e);
    if (tasks?.length) items.push(stat('Tasks', String(tasks.length / 4)));
    const net = s.structure ? this.state.networkOf(e) : undefined;
    if (net) {
      const balance = net.supply - net.demand;
      items.push(stat('Grid', `+${net.supply} −${net.demand}/t`, net.demand ? net.supply / net.demand : 1, balance >= 0 ? '#5bd68a' : '#ff6b5b'));
      if (net.capacity) items.push(stat('Grid store', `${net.stored}/${net.capacity}`, net.stored / net.capacity, '#f5c542'));
    }
    items.push(`<span class="name">${esc(bp.name)}</span>`);
    return items.join('');
  }

  /** Totals over several own units/buildings. */
  private groupInfo(ids: number[]): string {
    if (ids.length < 2) return ids.length ? this.singleInfo(ids[0]) : '';
    const { world } = this.state;
    const hp = world.store(Health);
    const energy = world.store(EnergyView);
    const cargo = world.store(Cargo);
    const stock = world.store(Stockpile);
    const cpu = world.store(CpuStatus);
    const t = { hp: 0, hpMax: 0, en: 0, enMax: 0, cargo: 0, cargoMax: 0, stock: 0, stockMax: 0, running: 0, cpus: 0, tasks: 0 };
    for (const e of ids) {
      const s = this.state.stats(e);
      if (!s) continue;
      if (hp.has(e)) (t.hp += hp.f.hp[e], (t.hpMax += s.hp));
      if (energy.has(e)) (t.en += Math.round((energy.f.pct[e] * s.energyCapacity) / 100), (t.enMax += s.energyCapacity));
      if (cargo.has(e)) (t.cargo += cargo.f.amount[e], (t.cargoMax += s.cargo));
      if (stock.has(e)) (t.stock += stock.f.amount[e], (t.stockMax += s.resourceCapacity));
      if (cpu.has(e) && s.cyclesPerTick > 0 && !this.state.isSite(e)) {
        t.cpus++;
        if (cpu.f.state[e] === 0) t.running++;
      }
      t.tasks += (this.state.tasks.get(e)?.length ?? 0) / 4;
    }
    const stat = this.stat.bind(this);
    const items: string[] = [];
    if (t.hpMax) items.push(stat('Health', `${t.hp}/${t.hpMax}`, t.hp / t.hpMax, '#5bd68a'));
    if (t.enMax) items.push(stat('Energy', `${t.en}/${t.enMax}`, t.en / t.enMax, '#f5c542'));
    if (t.cargoMax) items.push(stat('Cargo', `${t.cargo}/${t.cargoMax}`, t.cargo / t.cargoMax, '#7ee0b5'));
    if (t.stockMax) items.push(stat('Silos', `${t.stock}/${t.stockMax}`, t.stock / t.stockMax, '#7ee0b5'));
    if (t.cpus) items.push(stat('CPU', `${t.running}/${t.cpus} running`));
    if (t.tasks) items.push(stat('Tasks', String(t.tasks)));
    items.push(`<span class="name">${ids.length} selected units</span>`);
    return items.join('');
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
        btn.innerHTML = `<span class="icon">${esc(a.icon)}</span><span class="label">${esc(a.label)}</span>${a.key ? `<kbd>${a.key}</kbd>` : ''}`;
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
    for (const b of this.buildBar.querySelectorAll<HTMLButtonElement>('button')) {
      b.classList.toggle('active', Number(b.dataset.blueprint) === blueprint);
    }
  }

  /** One button per own building class: icon, name and cost. */
  private renderBuildBar(): void {
    const classes = this.state.blueprints.ownedBy(this.state.myId).filter((bp) => bp.stats.structure && !bp.retired);
    const key = classes.map((bp) => bp.id).join(',');
    if (this.buildBar.dataset.key === key) return;
    this.buildBar.dataset.key = key;
    this.buildBar.innerHTML = '';
    for (const bp of classes) {
      const btn = document.createElement('button');
      btn.dataset.blueprint = String(bp.id);
      btn.title = `${bp.name}: ${bp.stats.footprint}×${bp.stats.footprint}, costs ◆${bp.stats.cost} (paid as it is built). Select builders first to assign them.`;
      const img = document.createElement('img');
      img.alt = '';
      this.actions.iconFor(bp.id).then((src) => (img.src = src)).catch(() => img.remove());
      const label = document.createElement('span');
      label.innerHTML = `${bp.name}<small>◆${bp.stats.cost}</small>`;
      btn.append(img, label);
      btn.onclick = () => this.actions.place(bp.id);
      this.buildBar.appendChild(btn);
    }
    this.setPlacing(this.placing);
  }

  showResult(text: string, ok: boolean): void {
    this.result.textContent = text;
    this.result.className = ok ? 'ok' : 'bad';
  }

  /** Call once per applied tick: records resource levels for the sparklines. */
  sampleHistory(): void {
    this.history.sample(this.state);
  }

  /**
   * One row per resource the selected own units have: label, a sparkline of the
   * last ~30 s (totals for a group) and the current amount out of the maximum.
   */
  private renderResources(ids: readonly number[]): void {
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
    this.resourceList.hidden = rows.length === 0;
    this.resourceList.innerHTML = rows.join('');
  }

  /** Called on selection change and every tick. */
  renderSelection(selection: ReadonlySet<number>): void {
    const { world, blueprints } = this.state;
    const nets = this.state.networks;
    const supply = nets.reduce((t, n) => t + n.supply, 0);
    const demand = nets.reduce((t, n) => t + n.demand, 0);
    const balance = supply - demand;
    this.envView.textContent = `☀ ${this.state.daylight}%  ≋ ${this.state.wind}%  ϟ ${balance >= 0 ? '+' : ''}${balance}/t`;
    this.envView.title = `Daylight and wind; your power grids: generated ${supply}/tick, wanted ${demand}/tick across ${nets.length} network(s)`;
    const unit = world.store(Unit);
    const ids = [...selection];

    if (ids.length === 0) {
      this.selectionSummary.textContent = 'Nothing selected';
    } else if (ids.length === 1) {
      this.selectionSummary.textContent = this.describe(ids[0]);
    } else {
      const counts = new Map<string, number>();
      for (const e of ids) {
        const name = unit.has(e) ? (blueprints.get(unit.f.blueprint[e])?.name ?? '?') : 'Resource';
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      this.selectionSummary.textContent = [...counts].map(([n, c]) => `${n} ×${c}`).join(', ');
    }

    this.renderResources(ids.filter((e) => world.isAlive(e) && unit.has(e)));

    const single = ids.length === 1 && this.state.isMine(ids[0]) ? ids[0] : -1;
    this.renderModules(single);
    this.renderProduction(single);
  }

  private renderModules(e: number): void {
    const bp = e >= 0 ? this.state.blueprints.get(this.state.world.store(Unit).f.blueprint[e]) : undefined;
    this.modulesPanel.hidden = !bp;
    if (!bp) return;
    const mask = this.state.world.store(Modules).f.off[e];
    const key = `${e}|${bp.id}|${mask}`;
    if (key === this.modulesKey) return;
    this.modulesKey = key;
    this.modulesPanel.innerHTML = '<div class="muted">Modules (switch off to save energy)</div>';
    bp.parts.forEach((id, i) => {
      const def = PARTS[id];
      const label = document.createElement('label');
      label.className = 'module';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !((mask >>> i) & 1);
      box.disabled = !SWITCHABLE.has(def.slot);
      box.onchange = () => this.actions.setModule(e, i, box.checked);
      label.append(box, ` ${i}: ${def.name}`);
      if (def.use) label.title = `Uses ${def.use} energy per ${def.slot === 'sensor' ? 'scan' : def.slot === 'weapon' ? 'shot' : 'tick in use'}`;
      this.modulesPanel.appendChild(label);
    });
  }

  private renderProduction(b: number): void {
    const { world, blueprints } = this.state;
    const prod = world.store(Production);
    const isFactory = b >= 0 && prod.has(b);
    this.productionPanel.hidden = !isFactory;
    if (!isFactory) return;

    const current = blueprints.get(prod.f.blueprint[b]);
    this.productionStatus.textContent = prod.f.queued[b]
      ? `Building ${current?.name ?? '…'} ${prod.f.progress[b]}%${prod.f.queued[b] > 1 ? ` (+${prod.f.queued[b] - 1} queued)` : ''}`
      : 'Idle — choose a class to build';

    const buildable = blueprints.ownedBy(this.state.myId).filter((bp) => !bp.stats.structure && !bp.retired);
    const key = `${b}|${this.credits}|${buildable.map((bp) => bp.id).join(',')}`;
    if (key === this.productionKey) return;
    this.productionKey = key;
    this.productionButtons.innerHTML = '';
    for (const bp of buildable) {
      const btn = document.createElement('button');
      btn.textContent = `${bp.name} ◆${bp.stats.cost}`;
      btn.title = `${(bp.stats.buildTime / 10).toFixed(1)}s`;
      btn.disabled = bp.stats.cost > this.credits;
      btn.onclick = () => this.actions.produce(b, bp.id);
      this.productionButtons.appendChild(btn);
    }
  }

  updateClasses(): void {
    this.productionKey = '';
    this.renderBuildBar();
  }

  private toggleDocs(show: boolean): void {
    if (show && !this.docsFrame.src.endsWith('docs.html')) this.docsFrame.src = 'docs.html';
    this.docsOverlay.hidden = !show;
  }

  private describe(e: number): string {
    const { world, blueprints } = this.state;
    const res = world.store(Resource);
    if (res.has(e)) return `Type: Resource field\nAmount remaining: ${res.f.amount[e]}`;
    const unit = world.store(Unit);
    if (!unit.has(e)) return '';
    const bp = blueprints.get(unit.f.blueprint[e]);
    const s = this.state.stats(e);
    const owner = this.state.isMine(e) ? 'yours' : unit.f.owner[e] === 0 ? 'neutral' : `player ${unit.f.owner[e]}`;
    const sparklineKeys = new Set(
      this.state.isMine(e) ? METRICS.filter((metric) => metric.read(this.state, e)).map((metric) => metric.key) : [],
    );
    const parts = [`Class: ${bp?.name ?? '?'}`, `Owner: ${owner}`];
    const hp = world.store(Health);
    if (hp.has(e) && !sparklineKeys.has('hp')) parts.push(`Health: ${hp.f.hp[e]}/${s?.hp ?? '?'}`);
    if (!this.state.isMine(e)) return parts.join('\n');
    const energy = world.store(EnergyView);
    if (energy.has(e) && s && !sparklineKeys.has('energy')) parts.push(`Energy: ${energy.f.pct[e]}% of ${s.energyCapacity}`);
    const cpu = world.store(CpuStatus);
    if (cpu.has(e) && s?.cyclesPerTick && !sparklineKeys.has('cpu')) {
      const fault = cpu.f.fault[e] ? ` (fault: ${FAULT_NAMES[cpu.f.fault[e]]})` : '';
      parts.push(`CPU: ${CPU_STATES[cpu.f.state[e]]} ${cpu.f.used[e]}/${s.cyclesPerTick}c${fault}`);
    }
    const cargo = world.store(Cargo);
    if (cargo.has(e) && !sparklineKeys.has('cargo')) parts.push(`Cargo: ${cargo.f.amount[e]}/${s?.cargo ?? '?'}`);
    const site = world.store(Construction);
    if (site.has(e) && !sparklineKeys.has('built')) parts.push(`Construction: ${site.f.progress[e]}% of ◆${s?.cost ?? '?'}`);
    const stock = world.store(Stockpile);
    if (stock.has(e) && !sparklineKeys.has('silos')) parts.push(`Silos: ${stock.f.amount[e]}/${s?.resourceCapacity ?? '?'}`);
    const tasks = this.state.tasks.get(e);
    parts.push(`Tasks queued: ${(tasks?.length ?? 0) / 4}`);
    if (s?.structure) {
      const links = this.state.links.filter(([a, b]) => a === e || b === e).length;
      parts.push(`Power links: ${links}`);
      const net = this.state.networkOf(e);
      if (net) {
        parts.push(
          `Grid: ${net.members.length} buildings, +${net.supply}/−${net.demand} per tick`,
        );
        parts.push(`Grid storage: ${net.stored}/${net.capacity}${net.depot ? ' (silo connected)' : ' (no silo)'}`);
      }
    }
    return parts.join('\n');
  }
}
