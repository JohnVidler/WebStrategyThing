import { Caps, Position, Resource, TaskType, TILE, Unit, type Blueprint, type ClientMessage } from '@wst/engine';
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
 *                       selected builders are told to build it. Right-click or Esc cancels.
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
  /** Own unit/building under the cursor, or -1. */
  hovered = -1;
  /** An aimed action waiting for its point/unit (left-click), or null. */
  aiming: ActionButton | null = null;
  /** Demolish was pressed once; a second press before this time confirms. */
  demolishArmedUntil = 0;

  private dragFrom: { x: number; y: number } | null = null;
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
    this.placement = { bp, x: -100, y: -100, valid: false };
    this.onPlacementChanged();
  }

  cancelPlacement(): void {
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
      if (ev.button === 0) this.place(isQueueModifier(ev));
      else if (ev.button === 2) {
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
      this.order(ev.offsetX, ev.offsetY, isQueueModifier(ev));
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
      this.placement.valid =
        this.state.terrain.footprintFree(this.placement.x, this.placement.y, size) && this.state.canPlaceInVision(this.placement.x, this.placement.y, size);
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
    this.state.terrain.occupy(p.x, p.y, p.bp.stats.footprint, 1);
    p.valid = false;
    if (!keepPlacing) this.cancelPlacement();
  }

  /** Completes an aimed action at a screen point. Holding the queue modifier keeps aiming. */
  private aimAt(sx: number, sy: number, queue: boolean): void {
    // Re-read the action: the selection may have changed (e.g. a control group) since it was pressed.
    const action = this.actions().find((a) => a.id === this.aiming!.id);
    if (!action?.units.length) return this.cancelAiming();
    const target = this.renderer.pick(sx, sy);
    const tile = this.renderer.screenToTile(sx, sy);
    this.sendAction(action, Math.floor(tile.x), Math.floor(tile.y), target, queue);
    const hostile = target >= 0 && this.state.world.store(Unit).has(target) && !this.isMine(target);
    this.pings.push({ x: sx, y: sy, born: performance.now(), colour: action.custom ? 0xc792ea : hostile ? 0xff6b5b : 0x5bd68a });
    if (!queue) this.cancelAiming();
  }

  private order(sx: number, sy: number, queue: boolean): void {
    const units = this.ownedSelection();
    if (!units.length) {
      playSound('order.invalid');
      return;
    }
    const target = this.renderer.pick(sx, sy);
    const tile = this.renderer.screenToTile(sx, sy);
    this.send({ t: 'order', units, x: Math.floor(tile.x), y: Math.floor(tile.y), target, queue });
    const hostile = target >= 0 && this.state.world.store(Unit).has(target) && !this.isMine(target);
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
