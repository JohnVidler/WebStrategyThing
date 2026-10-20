import { Caps, Missile, Position, Resource, TaskType, TILE, Unit, type Blueprint, type ClientMessage } from '@wst/engine';
import { actionsFor, type ActionButton } from './actions';
import type { Placement, Renderer, ViewState } from './renderer';
import { playSound } from './sound';
import type { ClientState } from './state';

/** The order sound for each common action button. */
const TASK_SOUNDS: Record<number, string> = {
  [TaskType.Move]: 'order.move',
  [TaskType.Attack]: 'order.attack',
  [TaskType.Harvest]: 'order.harvest',
  [TaskType.Dock]: 'order.charge',
  [TaskType.Charge]: 'order.charge',
  [TaskType.Stop]: 'order.stop',
  [TaskType.Supply]: 'order.supply',
  [TaskType.Repair]: 'order.repair',
};

const DRAG_THRESHOLD = 5;
/** A dragged line of buildings never has more spots than a player may have construction sites. */
const MAX_LINE = 12;
/** A dragged order path adds a point whenever the mouse has moved this far (pixels). */
const PATH_STEP = 4;
const WHEEL_ZOOM = 1.15;
const KEY_PAN = 60;
/** Recalling the same control group twice within this time centres the view on it. */
const DOUBLE_TAP_MS = 400;

/** Ctrl (or Cmd) queues; Shift is accepted too, but Firefox hijacks Shift + right click. */
const isQueueModifier = (ev: MouseEvent | KeyboardEvent) => ev.ctrlKey || ev.metaKey || ev.shiftKey;

/**
 * RTS controls. The client only *requests* things: every order becomes a task
 * on the server, and each unit's script decides how to act on it.
 *
 *   Left click / drag   select (Shift adds; a drag prefers combat units, then turrets,
 *                       then takes everything of yours)
 *   Right click         context order: move / attack / harvest / dock / charge / build / rally
 *   Ctrl + right click  queue the order instead of marking it URGENT
 *                       (Shift works too where the browser allows it — Firefox always
 *                       opens its own context menu on Shift + right click)
 *   Mouse wheel         zoom at the cursor; middle-drag or arrow keys pan; Home resets
 *   Build bar           pick a building, left-click to place it (Ctrl/Shift: place several);
 *                       selected builders are told to build it. Left-drag places a straight
 *                       line of them, side by side. Right-click or Esc cancels.
 *   Right drag          spreads the selected units evenly along the path dragged
 *   Action grid         common actions (M move, A attack, S stop, H harvest, D unload,
 *                       C recharge) and class buttons; aimed ones wait for a left-click
 *   Esc                 cancel aiming / placement, or deselect
 *   Ctrl+1..9 / 1..9    save / recall control group (twice quickly: centre on it);
 *   Shift+1..9          add the selection to a group     Ctrl+A  select all units
 */
export class Input implements ViewState {
  readonly selection = new Set<number>();
  band: ViewState['band'] = null;
  readonly pings: ViewState['pings'] = [];
  placement: Placement | null = null;
  orderPath: ViewState['orderPath'] = null;
  /** Own unit/building under the cursor, or -1. */
  hovered = -1;
  /** An aimed action waiting for its point/unit (left-click), or null. */
  aiming: ActionButton | null = null;
  /** Demolish was pressed once; a second press before this time confirms. */
  demolishArmedUntil = 0;

  private dragFrom: { x: number; y: number } | null = null;
  /** Top-left tile where a left-press began while placing, for dragging a line of buildings. */
  private placeStart: { x: number; y: number } | null = null;
  /** A right-press being dragged: the mouse path so far (screen pixels). */
  private orderDrag: { path: { x: number; y: number }[]; moved: boolean } | null = null;
  private panFrom: { x: number; y: number } | null = null;
  /** Control groups by number (1-9): saved entity lists, pruned as units die. */
  private readonly groups = new Map<number, number[]>();
  private lastRecall = { n: 0, at: 0 };
  private renderer!: Renderer;

  constructor(
    private readonly state: ClientState,
    private readonly send: (msg: ClientMessage) => void,
    private readonly onSelectionChanged: () => void,
    private readonly onPlacementChanged: () => void = () => {},
    private readonly onHoverChanged: () => void = () => {},
    private readonly onAimChanged: () => void = () => {},
    private readonly onGroupsChanged: () => void = () => {},
  ) {}

  attach(renderer: Renderer): void {
    this.renderer = renderer;
    const canvas = renderer.canvas;
    // Suppress the browser menu anywhere over the game area, not just the canvas element.
    canvas.parentElement?.addEventListener('contextmenu', (ev) => ev.preventDefault());
    canvas.addEventListener('pointerdown', (ev) => this.pointerDown(ev));
    canvas.addEventListener('pointermove', (ev) => this.pointerMove(ev));
    canvas.addEventListener('pointerup', (ev) => this.pointerUp(ev));
    canvas.addEventListener('dblclick', (ev) => this.selectClassOnScreen(ev));
    canvas.addEventListener('pointerleave', () => this.setHovered(-1));
    canvas.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        this.renderer.zoomAt(ev.offsetX, ev.offsetY, ev.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM);
        playSound('camera.zoom');
      },
      { passive: false },
    );
    window.addEventListener('keydown', (ev) => this.keyDown(ev));
  }

  /** Drop entities that no longer exist (call after each applied tick). */
  prune(): void {
    let changed = false;
    for (const e of this.selection) {
      if (!this.state.world.isAlive(e)) {
        this.selection.delete(e);
        changed = true;
      }
    }
    if (changed) this.onSelectionChanged();
    let groupsChanged = false;
    for (const [n, g] of this.groups) {
      const alive = g.filter((e) => this.state.world.isAlive(e) && this.isMine(e));
      if (alive.length === g.length) continue;
      if (alive.length) this.groups.set(n, alive);
      else this.groups.delete(n);
      groupsChanged = true;
    }
    if (groupsChanged) this.onGroupsChanged();
  }

  ownedSelection(): number[] {
    return [...this.selection].filter((e) => this.isMine(e));
  }

  /** The action grid for the current selection. */
  actions(): ActionButton[] {
    return actionsFor(this.state, [...this.selection]);
  }

  /**
   * Presses an action button: instant actions go straight to the server; aimed
   * ones wait for a left-click on the map.
   */
  press(id: string, queue = false): void {
    const action = this.actions().find((a) => a.id === id);
    if (!action || action.units.length === 0) return;
    if (id === 'ui:demolish') {
      if (performance.now() < this.demolishArmedUntil) {
        this.demolishArmedUntil = 0;
        this.send({ t: 'demolish', units: action.units });
        playSound('build.demolish');
      } else {
        this.demolishArmedUntil = performance.now() + 3000;
        setTimeout(() => this.onAimChanged(), 3100);
      }
      this.onAimChanged();
      return;
    }
    if (action.aim) {
      this.cancelPlacement();
      this.setAiming(action);
    } else {
      this.sendAction(action, 0, 0, -1, queue);
    }
  }

  cancelAiming(): void {
    this.setAiming(null);
  }

  private setAiming(action: ActionButton | null): void {
    this.aiming = action;
    this.renderer.canvas.style.cursor = action ? 'crosshair' : '';
    this.onAimChanged();
  }

  private sendAction(a: ActionButton, x: number, y: number, target: number, queue: boolean): void {
    const units = a.units.filter((e) => this.state.world.isAlive(e));
    if (!units.length) return;
    if (a.id.startsWith('cmd:')) {
      const task = Number(a.id.slice(4));
      if (task === TaskType.Stop) this.send({ t: 'stop', units, queue });
      else this.send({ t: 'command', units, task, x, y, target, queue });
      playSound(queue ? 'order.queue' : TASK_SOUNDS[task] ?? 'order.acknowledge');
    } else {
      this.send({ t: 'button', units, name: a.id.slice(4), x, y, target, queue });
      playSound(queue ? 'order.queue' : 'order.acknowledge');
    }
  }

  /** Start placing a building blueprint (from the build bar). */
  beginPlacement(bp: Blueprint): void {
    this.cancelAiming();
    this.placement = { bp, x: -100, y: -100, valid: false, line: [] };
    this.onPlacementChanged();
  }

  cancelPlacement(): void {
    this.placeStart = null;
    if (!this.placement) return;
    this.placement = null;
    this.onPlacementChanged();
  }

  private isMine(e: number): boolean {
    return this.state.isMine(e);
  }

  private pointerDown(ev: PointerEvent): void {
    if (ev.button === 1) {
      ev.preventDefault();
      this.panFrom = { x: ev.offsetX, y: ev.offsetY };
      this.renderer.canvas.setPointerCapture(ev.pointerId);
    } else if (this.placement) {
      if (ev.button === 0) {
        // Placed on release: a drag in between lays a line of them.
        this.placeStart = { x: this.placement.x, y: this.placement.y };
        this.renderer.canvas.setPointerCapture(ev.pointerId);
      } else if (ev.button === 2) {
        this.cancelPlacement();
        playSound('build.cancel_placement');
      }
    } else if (this.aiming) {
      if (ev.button === 0) this.aimAt(ev.offsetX, ev.offsetY, isQueueModifier(ev));
      else if (ev.button === 2) this.cancelAiming();
    } else if (ev.button === 0) {
      this.dragFrom = { x: ev.offsetX, y: ev.offsetY };
      this.renderer.canvas.setPointerCapture(ev.pointerId);
    } else if (ev.button === 2) {
      // The order is sent on release: a drag in between spreads the units along the path.
      this.orderDrag = { path: [{ x: ev.offsetX, y: ev.offsetY }], moved: false };
      this.renderer.canvas.setPointerCapture(ev.pointerId);
    }
  }

  private setHovered(e: number): void {
    if (e === this.hovered) return;
    this.hovered = e;
    this.onHoverChanged();
  }

  private pointerMove(ev: PointerEvent): void {
    const under = this.renderer.pick(ev.offsetX, ev.offsetY);
    this.setHovered(under >= 0 && this.isMine(under) ? under : -1);
    if (this.panFrom) {
      this.renderer.panBy(ev.offsetX - this.panFrom.x, ev.offsetY - this.panFrom.y);
      this.panFrom = { x: ev.offsetX, y: ev.offsetY };
      return;
    }
    if (this.placement) {
      const size = this.placement.bp.stats.footprint;
      const tile = this.renderer.screenToTile(ev.offsetX, ev.offsetY);
      this.placement.x = Math.round(tile.x - size / 2);
      this.placement.y = Math.round(tile.y - size / 2);
      this.placement.valid = this.spotValid(this.placement.x, this.placement.y);
      this.placement.line = this.placeStart ? this.lineSpots() : [];
      return;
    }
    if (this.orderDrag) {
      const path = this.orderDrag.path;
      const last = path[path.length - 1];
      if (Math.hypot(ev.offsetX - last.x, ev.offsetY - last.y) >= PATH_STEP) path.push({ x: ev.offsetX, y: ev.offsetY });
      if (!this.orderDrag.moved && Math.hypot(ev.offsetX - path[0].x, ev.offsetY - path[0].y) > DRAG_THRESHOLD) this.orderDrag.moved = true;
      this.orderPath = this.orderDrag.moved ? this.spreadPlan() : null;
      return;
    }
    if (!this.dragFrom) return;
    const { x, y } = this.dragFrom;
    if (this.band || Math.hypot(ev.offsetX - x, ev.offsetY - y) > DRAG_THRESHOLD) {
      this.band = { x0: x, y0: y, x1: ev.offsetX, y1: ev.offsetY };
    }
  }

  private pointerUp(ev: PointerEvent): void {
    if (ev.button === 1) {
      this.panFrom = null;
      return;
    }
    if (ev.button === 0 && this.placeStart) {
      const p = this.placement;
      this.placeStart = null;
      if (!p) return;
      if (p.line.length > 1) this.placeLine(isQueueModifier(ev));
      else this.place(isQueueModifier(ev));
      return;
    }
    if (ev.button === 2 && this.orderDrag) {
      const drag = this.orderDrag;
      this.orderDrag = null;
      this.orderPath = null;
      const spread = drag.moved ? this.spreadUnits(drag.path) : null;
      if (spread) this.sendSpread(spread, isQueueModifier(ev));
      else this.order(drag.path[0].x, drag.path[0].y, isQueueModifier(ev));
      return;
    }
    if (ev.button !== 0 || !this.dragFrom) return;
    if (!ev.shiftKey) this.selection.clear();
    if (this.band) {
      const { x0, y0, x1, y1 } = this.band;
      const mine = this.renderer.entitiesInRect(x0, y0, x1, y1).filter((e) => this.isMine(e));
      for (const e of this.bandPriority(mine)) this.selection.add(e);
    } else {
      const e = this.renderer.pick(ev.offsetX, ev.offsetY);
      if (e >= 0) {
        if (ev.shiftKey && this.selection.has(e)) this.selection.delete(e);
        else this.selection.add(e);
      }
    }
    this.dragFrom = null;
    this.band = null;
    this.onSelectionChanged();
    this.playSelectionSound();
  }

  /** One sound for what was just selected: nothing, one unit, one building, or several. */
  private playSelectionSound(): void {
    const n = this.selection.size;
    if (n === 0) playSound('select.deselect');
    else if (n > 1) playSound('select.units');
    else playSound(this.state.isStructure([...this.selection][0]) ? 'select.building' : 'select.unit');
  }

  private selectClassOnScreen(ev: MouseEvent): void {
    if (this.placement || this.aiming) return;
    const target = this.renderer.pick(ev.offsetX, ev.offsetY);
    if (target < 0 || !this.isMine(target) || this.state.isStructure(target)) return;
    const blueprint = this.state.world.store(Unit).f.blueprint[target];
    const bounds = this.renderer.canvas.getBoundingClientRect();
    const onScreen = this.renderer.entitiesInRect(0, 0, bounds.width, bounds.height);
    this.selection.clear();
    for (const e of onScreen) {
      if (this.isMine(e) && !this.state.isStructure(e) && this.state.world.store(Unit).f.blueprint[e] === blueprint) {
        this.selection.add(e);
      }
    }
    this.onSelectionChanged();
    this.playSelectionSound();
  }

  /**
   * What a drag selects: combat units if there are any in the band, else combat
   * buildings (turrets), else everything of yours in it.
   */
  private bandPriority(mine: number[]): number[] {
    const fights = (e: number) => ((this.state.stats(e)?.caps ?? 0) & Caps.Fight) !== 0;
    const units = mine.filter((e) => fights(e) && !this.state.isStructure(e));
    if (units.length) return units;
    const turrets = mine.filter((e) => fights(e) && this.state.isStructure(e));
    return turrets.length ? turrets : mine;
  }

  /** Control groups 1-9 that hold at least one live unit, for the side panel. */
  groupList(): { n: number; size: number }[] {
    return [...this.groups].filter(([, g]) => g.length).map(([n, g]) => ({ n, size: g.length })).sort((a, b) => a.n - b.n);
  }

  /** Saves the selection as group n (Ctrl+n), or adds it to the group (Shift+n). */
  private setGroup(n: number, add: boolean): void {
    const units = this.ownedSelection();
    const group = add ? [...new Set([...(this.groups.get(n) ?? []), ...units])] : units;
    if (group.length) this.groups.set(n, group);
    else this.groups.delete(n);
    this.onGroupsChanged();
    playSound('select.group_assign');
  }

  /** Selects group n; recalling the same group again quickly centres the view on it. */
  recallGroup(n: number): void {
    const group = (this.groups.get(n) ?? []).filter((e) => this.state.world.isAlive(e) && this.isMine(e));
    if (!group.length) return;
    const now = performance.now();
    if (this.lastRecall.n === n && now - this.lastRecall.at < DOUBLE_TAP_MS) {
      const pos = this.state.world.store(Position);
      let x = 0;
      let y = 0;
      for (const e of group) {
        x += pos.f.x[e];
        y += pos.f.y[e];
      }
      this.renderer.centreOn(x / group.length / TILE, y / group.length / TILE);
    }
    this.lastRecall = { n, at: now };
    this.selection.clear();
    for (const e of group) this.selection.add(e);
    this.onSelectionChanged();
    playSound('select.group_recall');
  }

  private spotValid(x: number, y: number): boolean {
    const bp = this.placement!.bp;
    return this.state.terrain.footprintFree(x, y, bp.stats.footprint, bp.stats.shape) && this.state.canPlaceInVision(x, y, bp.stats.footprint);
  }

  /**
   * The spots of a line of buildings from where the press began to the cursor: one every
   * `footprint` tiles along the longer axis, so neighbours touch without overlapping.
   * Empty while the cursor is less than one building away.
   */
  private lineSpots(): Placement['line'] {
    const p = this.placement!;
    const a = this.placeStart!;
    const size = p.bp.stats.footprint;
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const major = Math.max(Math.abs(dx), Math.abs(dy));
    if (major < size) return [];
    const n = Math.min(MAX_LINE, Math.floor(major / size) + 1);
    const out: Placement['line'] = [];
    for (let i = 0; i < n; i++) {
      const x = Math.round(a.x + (dx * i * size) / major);
      const y = Math.round(a.y + (dy * i * size) / major);
      out.push({ x, y, valid: this.spotValid(x, y) });
    }
    return out;
  }

  /** Places every free spot of the dragged line; builders get them as one queue, in order. */
  private placeLine(keepPlacing: boolean): void {
    const p = this.placement!;
    const builders = this.ownedSelection().filter((e) => ((this.state.stats(e)?.caps ?? 0) & Caps.Build) !== 0);
    let sent = 0;
    for (const spot of p.line) {
      if (!spot.valid) continue;
      this.send({ t: 'place', blueprint: p.bp.id, x: spot.x, y: spot.y, builders, queue: keepPlacing || sent > 0 });
      this.state.terrain.occupy(spot.x, spot.y, p.bp.stats.footprint, 1, p.bp.stats.shape);
      sent++;
    }
    playSound(sent ? 'build.place' : 'build.place_invalid');
    p.line = [];
    p.valid = false;
    if (!keepPlacing && sent) this.cancelPlacement();
  }

  /**
   * Where each selected unit would stand if the dragged path were spread over them: evenly
   * along its length, the unit nearest the start of the path taking the first spot, and so on.
   */
  private spreadUnits(path: { x: number; y: number }[]): { unit: number; sx: number; sy: number }[] | null {
    const units = this.ownedSelection().filter((e) => !this.state.isStructure(e));
    if (!units.length || path.length < 2) return null;
    const lengths = [0];
    for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
    const total = lengths[lengths.length - 1];
    if (total <= 0) return null;
    const at = (d: number) => {
      let i = 1;
      while (i < lengths.length - 1 && lengths[i] < d) i++;
      const span = lengths[i] - lengths[i - 1] || 1;
      const t = (d - lengths[i - 1]) / span;
      return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t };
    };
    const stops = units.map((_, i) => at(units.length === 1 ? total : (total * i) / (units.length - 1)));
    // Order the units along the path's overall direction so their routes do not cross.
    const dir = { x: path[path.length - 1].x - path[0].x, y: path[path.length - 1].y - path[0].y };
    const side = (e: number) => {
      const p = this.renderer.screenOf(e);
      return p.x * dir.x + p.y * dir.y;
    };
    const ordered = [...units].sort((a, b) => side(a) - side(b));
    return ordered.map((unit, i) => ({ unit, sx: stops[i].x, sy: stops[i].y }));
  }

  /** The preview for the renderer while the drag is under way. */
  private spreadPlan(): ViewState['orderPath'] {
    const drag = this.orderDrag!;
    const spread = this.spreadUnits(drag.path);
    return { path: drag.path, stops: (spread ?? []).map((s) => ({ x: s.sx, y: s.sy })) };
  }

  private sendSpread(spread: { unit: number; sx: number; sy: number }[], queue: boolean): void {
    for (const s of spread) {
      const tile = this.renderer.screenToTile(s.sx, s.sy);
      this.send({ t: 'order', units: [s.unit], x: Math.floor(tile.x), y: Math.floor(tile.y), target: -1, queue });
      this.pings.push({ x: s.sx, y: s.sy, born: performance.now(), colour: 0x5bd68a });
    }
    playSound(queue ? 'order.queue' : 'order.move');
  }

  /** Places the current blueprint; selected builders are assigned to it. */
  private place(keepPlacing: boolean): void {
    const p = this.placement;
    if (!p) return;
    if (!p.valid) {
      playSound('build.place_invalid');
      return;
    }
    const builders = this.ownedSelection().filter((e) => ((this.state.stats(e)?.caps ?? 0) & Caps.Build) !== 0);
    this.send({ t: 'place', blueprint: p.bp.id, x: p.x, y: p.y, builders, queue: keepPlacing });
    playSound('build.place');
    // Optimistically block the footprint so a second click can't land on the same spot.
    this.state.terrain.occupy(p.x, p.y, p.bp.stats.footprint, 1, p.bp.stats.shape);
    p.valid = false;
    if (!keepPlacing) this.cancelPlacement();
  }

  /** Completes an aimed action at a screen point. Holding the queue modifier keeps aiming. */
  private aimAt(sx: number, sy: number, queue: boolean): void {
    // Re-read the action: the selection may have changed (e.g. a control group) since it was pressed.
    const action = this.actions().find((a) => a.id === this.aiming!.id);
    if (!action?.units.length) return this.cancelAiming();
    const target = this.renderer.pick(sx, sy, true);
    const tile = this.renderer.screenToTile(sx, sy);
    this.sendAction(action, Math.floor(tile.x), Math.floor(tile.y), target, queue);
    const hostile = target >= 0 && (this.state.world.store(Missile).has(target) || this.state.world.store(Unit).has(target)) && !this.isMine(target);
    this.pings.push({ x: sx, y: sy, born: performance.now(), colour: action.custom ? 0xc792ea : hostile ? 0xff6b5b : 0x5bd68a });
    if (!queue) this.cancelAiming();
  }

  private order(sx: number, sy: number, queue: boolean): void {
    const units = this.ownedSelection();
    if (!units.length) {
      playSound('order.invalid');
      return;
    }
    const target = this.renderer.pick(sx, sy, true);
    const tile = this.renderer.screenToTile(sx, sy);
    this.send({ t: 'order', units, x: Math.floor(tile.x), y: Math.floor(tile.y), target, queue });
    const hostile = target >= 0 && (this.state.world.store(Missile).has(target) || this.state.world.store(Unit).has(target)) && !this.isMine(target);
    playSound(queue ? 'order.queue' : target < 0 ? 'order.move' : hostile ? 'order.attack' : this.state.world.store(Resource).has(target) ? 'order.harvest' : 'order.acknowledge');
    this.pings.push({ x: sx, y: sy, born: performance.now(), colour: hostile ? 0xff6b5b : 0x5bd68a });
  }

  private keyDown(ev: KeyboardEvent): void {
    const el = ev.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    if (document.querySelector('#designer-overlay:not([hidden])')) return; // designing, not playing

    const pans: Record<string, [number, number]> = {
      ArrowLeft: [KEY_PAN, 0],
      ArrowRight: [-KEY_PAN, 0],
      ArrowUp: [0, KEY_PAN],
      ArrowDown: [0, -KEY_PAN],
    };
    if (pans[ev.key]) {
      ev.preventDefault();
      this.renderer.panBy(...pans[ev.key]);
    } else if (ev.key === 'Home') {
      this.renderer.resetView();
    } else if (ev.key === 'Escape') {
      if (this.aiming) this.cancelAiming();
      else if (this.placement) {
        this.cancelPlacement();
        playSound('build.cancel_placement');
      } else {
        const had = this.selection.size > 0;
        this.selection.clear();
        this.onSelectionChanged();
        if (had) playSound('select.deselect');
      }
    } else if (/^[a-z]$/i.test(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      // Action hotkeys (Shift queues).
      const action = this.actions().find((a) => a.key === ev.key.toUpperCase());
      if (action) {
        ev.preventDefault();
        this.press(action.id, ev.shiftKey);
        if (action.aim) playSound('action.hotkey');
      }
    } else if (ev.key === 'a' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      this.selection.clear();
      for (const e of this.state.world.store(Unit).dense) {
        if (this.isMine(e) && !this.state.isStructure(e)) this.selection.add(e);
      }
      this.onSelectionChanged();
      this.playSelectionSound();
    } else if (/^(Digit|Numpad)[1-9]$/.test(ev.code) && !ev.altKey) {
      // By physical key, so Shift (and layouts like AZERTY) still give the digit.
      ev.preventDefault();
      const n = Number(ev.code.slice(-1));
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey) this.setGroup(n, ev.shiftKey && !ev.ctrlKey && !ev.metaKey);
      else this.recallGroup(n);
    }
  }
}
