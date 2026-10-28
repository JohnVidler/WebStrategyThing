import { Caps, Missile, Position, Resource, TaskType, TILE, Unit, type Blueprint, type ClientMessage } from '@wst/engine';
import { actionsFor, type ActionButton } from './actions';
import type { Placement, Renderer, ViewState } from './renderer';
import { controls, WheelClassifier, type ActionId, type ModState } from './controls';
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
/** Pinch on a trackpad: zoom factor per unit of wheel delta (the browser reports a pinch as ctrl + wheel). */
const PINCH_ZOOM = 0.01;
/** The zoom sound plays at most this often during a continuous pinch. */
const ZOOM_SOUND_MS = 250;
/** Keyboard pan speed at full tilt (screen pixels per second) and how quickly it eases in and out (seconds). */
const KEY_PAN_SPEED = 900;
const KEY_PAN_EASE = 0.08;
/** Which pan action each key action moves the view in (x, y). */
const PAN_DIRS: Partial<Record<ActionId, [number, number]>> = { panLeft: [-1, 0], panRight: [1, 0], panUp: [0, -1], panDown: [0, 1] };
const BUILD_ACTIONS: readonly ActionId[] = ['buildMenu', 'buildCategoryPrev', 'buildCategoryNext', 'buildItemPrev', 'buildItemNext', 'buildConfirm'];
const KEY_ACTIONS: readonly ActionId[] = ['panLeft', 'panRight', 'panUp', 'panDown', 'zoomIn', 'zoomOut', 'resetView', 'cancel'];
const MOUSE_ACTIONS: readonly ActionId[] = ['select', 'order', 'panDrag'];
/** Pixels per line / page for scroll events that are not in pixels. */
const LINE_PX = 16;

/** Recalling the same control group twice within this time centres the view on it. */
const DOUBLE_TAP_MS = 400;

/** The queue modifier(s) chosen in Options (Ctrl and Shift by default; Firefox hijacks Shift + right click). */
const isQueueModifier = (ev: MouseEvent | KeyboardEvent) => controls.modifierHeld('queue', ev);

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
 * These are the defaults; every key, button and gesture below can be changed in Options
 * (`controls.ts`), including the modifiers.
 *   Mouse wheel         zoom at the cursor; middle-drag or arrow keys pan; Home resets
 *   Trackpad            pinch zooms at the cursor; two-finger scroll pans
 *   WASD / arrows       pan smoothly; a letter that is an action hotkey for the current
 *                       selection (H harvest, C recharge) still gives the order
 *   Build bar           pick a building, left-click to place it (Ctrl/Shift: place several);
 *                       selected builders are told to build it. Left-drag places a straight
 *                       line of them, side by side. Right-click or Esc cancels.
 *   Right drag          spreads the selected units evenly along the path dragged
 *   Action grid         common actions (M move, Ctrl+A attack, Ctrl+S stop, H harvest, Shift+D unload,
 *                       C recharge) and class buttons; aimed ones wait for a left-click
 *   Esc                 cancel aiming / placement, or deselect
 *   Ctrl+1..9 / 1..9    (modifiers configurable) save / recall control group (twice quickly: centre on it);
 *   Shift+1..9          add the selection to a group
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
  /** Pan keys currently held (physical key -> action), the camera's eased velocity and its animation frame. */
  private readonly panHeld = new Map<string, ActionId>();
  /** Which action each mouse button's press started, so its release finishes the same one. */
  private readonly down = new Map<number, ActionId>();
  private readonly wheelClass = new WheelClassifier();
  private panVx = 0;
  private panVy = 0;
  private panRaf = 0;
  private panLast = 0;
  private lastZoomSound = 0;

  constructor(
    private readonly state: ClientState,
    private readonly send: (msg: ClientMessage) => void,
    private readonly onSelectionChanged: () => void,
    private readonly onPlacementChanged: () => void = () => {},
    private readonly onHoverChanged: () => void = () => {},
    private readonly onAimChanged: () => void = () => {},
    private readonly onGroupsChanged: () => void = () => {},
    /** A build-menu key was pressed; true if the build menu used it (false: no builder selected, so the key falls through). */
    private readonly onBuildKey: (act: ActionId) => boolean = () => false,
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
      (ev) => this.wheel(ev),
      { passive: false },
    );
    // Safari reports a trackpad pinch as gesture events instead of ctrl + wheel.
    let lastScale = 1;
    const gesture = (ev: Event) => ev as Event & { scale: number; clientX: number; clientY: number };
    canvas.addEventListener('gesturestart', (ev) => {
      ev.preventDefault();
      lastScale = 1;
    });
    canvas.addEventListener('gesturechange', (ev) => {
      ev.preventDefault();
      const g = gesture(ev);
      const r = canvas.getBoundingClientRect();
      if (controls.find('pinch', ev as unknown as ModState, ['zoom']) === 'zoom') this.zoomBy(g.clientX - r.left, g.clientY - r.top, g.scale / lastScale);
      lastScale = g.scale;
    });
    window.addEventListener('keydown', (ev) => this.keyDown(ev));
    window.addEventListener('keyup', (ev) => this.panHeld.delete(ev.code));
    window.addEventListener('blur', () => this.panHeld.clear());
  }

  private zoomBy(sx: number, sy: number, factor: number): void {
    this.renderer.zoomAt(sx, sy, Math.min(2, Math.max(0.5, factor)));
    const now = performance.now();
    if (now - this.lastZoomSound >= ZOOM_SOUND_MS) {
      this.lastZoomSound = now;
      playSound('camera.zoom');
    }
  }

  /** Wheel, scroll and pinch events do whatever the player bound that gesture (with the held modifiers) to. */
  private wheel(ev: WheelEvent): void {
    ev.preventDefault();
    const kind = this.wheelClass.classify(ev, performance.now());
    // A browser pinch is a wheel event with a Ctrl that the player did not press.
    const mods = kind === 'pinch' ? { ctrlKey: false, shiftKey: ev.shiftKey, altKey: ev.altKey, metaKey: ev.metaKey } : ev;
    const act = controls.find(kind, mods, ['zoom', 'panScroll']);
    if (act === 'zoom') {
      const dy = ev.deltaMode === 0 ? ev.deltaY : ev.deltaY * LINE_PX;
      const factor = kind === 'wheel' ? (dy < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM) : Math.exp(-dy * PINCH_ZOOM);
      this.zoomBy(ev.offsetX, ev.offsetY, factor);
    } else if (act === 'panScroll') {
      const unit = ev.deltaMode === 0 ? 1 : ev.deltaMode === 1 ? LINE_PX : this.renderer.canvas.clientHeight;
      this.renderer.panBy(-ev.deltaX * unit, -ev.deltaY * unit);
    }
  }

  private panFrame = (now: number): void => {
    const dt = Math.min(0.05, (now - this.panLast) / 1000);
    this.panLast = now;
    let dx = 0;
    let dy = 0;
    for (const act of this.panHeld.values()) {
      dx += PAN_DIRS[act]![0];
      dy += PAN_DIRS[act]![1];
    }
    const len = Math.hypot(dx, dy);
    const tx = len ? (dx / len) * KEY_PAN_SPEED : 0;
    const ty = len ? (dy / len) * KEY_PAN_SPEED : 0;
    const k = 1 - Math.exp(-dt / KEY_PAN_EASE);
    this.panVx += (tx - this.panVx) * k;
    this.panVy += (ty - this.panVy) * k;
    if (!len && Math.hypot(this.panVx, this.panVy) < 5) {
      this.panVx = this.panVy = 0;
      this.panRaf = 0;
      return;
    }
    this.renderer.panBy(-this.panVx * dt, -this.panVy * dt);
    this.panRaf = requestAnimationFrame(this.panFrame);
  };

  /** The event's modifiers without the queue modifiers that are safe to use on keys (Shift, Alt), or null if none is held. */
  private withoutQueueMods(ev: KeyboardEvent): ModState | null {
    const m = { ctrlKey: ev.ctrlKey, shiftKey: ev.shiftKey, altKey: ev.altKey, metaKey: ev.metaKey };
    let changed = false;
    for (const b of controls.slotsOf('queue')) {
      if (b?.input === 'mod:shift' && m.shiftKey) {
        m.shiftKey = false;
        changed = true;
      } else if (b?.input === 'mod:alt' && m.altKey) {
        m.altKey = false;
        changed = true;
      }
    }
    return changed ? m : null;
  }

  private startPan(): void {
    if (this.panRaf) return;
    this.panLast = performance.now();
    this.panRaf = requestAnimationFrame(this.panFrame);
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
    if (ev.button === 1) ev.preventDefault(); // no autoscroll
    const act = controls.find(`mouse:${ev.button}`, ev, MOUSE_ACTIONS);
    if (act) this.down.set(ev.button, act);
    else this.down.delete(ev.button);
    if (act === 'panDrag') {
      this.panFrom = { x: ev.offsetX, y: ev.offsetY };
      this.renderer.canvas.setPointerCapture(ev.pointerId);
    } else if (this.placement) {
      if (act === 'select') {
        // Placed on release: a drag in between lays a line of them.
        this.placeStart = { x: this.placement.x, y: this.placement.y };
        this.renderer.canvas.setPointerCapture(ev.pointerId);
      } else if (act === 'order') {
        this.cancelPlacement();
        playSound('build.cancel_placement');
      }
    } else if (this.aiming) {
      if (act === 'select') this.aimAt(ev.offsetX, ev.offsetY, isQueueModifier(ev));
      else if (act === 'order') this.cancelAiming();
    } else if (act === 'select') {
      this.dragFrom = { x: ev.offsetX, y: ev.offsetY };
      this.renderer.canvas.setPointerCapture(ev.pointerId);
    } else if (act === 'order') {
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
    const act = this.down.get(ev.button);
    this.down.delete(ev.button);
    if (act === 'panDrag') {
      this.panFrom = null;
      return;
    }
    if (act === 'select' && this.placeStart) {
      const p = this.placement;
      this.placeStart = null;
      if (!p) return;
      if (p.line.length > 1) this.placeLine(isQueueModifier(ev));
      else this.place(isQueueModifier(ev));
      return;
    }
    if (act === 'order' && this.orderDrag) {
      const drag = this.orderDrag;
      this.orderDrag = null;
      this.orderPath = null;
      const spread = drag.moved ? this.spreadUnits(drag.path) : null;
      if (spread) this.sendSpread(spread, isQueueModifier(ev));
      else this.order(drag.path[0].x, drag.path[0].y, isQueueModifier(ev));
      return;
    }
    if (act !== 'select' || !this.dragFrom) return;
    const add = controls.modifierHeld('addSelect', ev);
    if (!add) this.selection.clear();
    if (this.band) {
      const { x0, y0, x1, y1 } = this.band;
      const mine = this.renderer.entitiesInRect(x0, y0, x1, y1).filter((e) => this.isMine(e));
      for (const e of this.bandPriority(mine)) this.selection.add(e);
    } else {
      const e = this.renderer.pick(ev.offsetX, ev.offsetY);
      if (e >= 0) {
        if (add && this.selection.has(e)) this.selection.delete(e);
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

  /** Selects every unit of a class the player has (all of them, wherever they are); `add` keeps the current selection. */
  selectClass(blueprint: number, add = false): void {
    const unit = this.state.world.store(Unit);
    if (!add) this.selection.clear();
    for (const e of unit.dense) {
      if (unit.f.blueprint[e] === blueprint && this.isMine(e) && !this.state.isStructure(e)) this.selection.add(e);
    }
    this.onSelectionChanged();
    this.playSelectionSound();
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

    const actions = this.actions();
    const orders = actions.filter((a) => a.control && a.units.length > 0);
    const orderIds = orders.map((a) => a.control!);
    // A class's own button on a bare letter beats the camera keys, as it always has.
    const plain = /^[a-z]$/i.test(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey;
    const custom = plain ? actions.find((a) => a.custom && a.key === ev.key.toUpperCase()) : undefined;
    const key = `key:${ev.code}`;
    // Orders the selection can take come first, then the build menu, then the camera and the rest.
    let act = custom ? null : controls.find(key, ev, [...orderIds, ...BUILD_ACTIONS, ...KEY_ACTIONS]);
    if (act && BUILD_ACTIONS.includes(act)) {
      if (this.onBuildKey(act)) {
        ev.preventDefault();
        return;
      }
      act = controls.find(key, ev, [...orderIds, ...KEY_ACTIONS]);
    }
    // Holding a queue modifier (Shift by default) with an order key queues the order.
    let queue = false;
    const bare = custom || act ? null : this.withoutQueueMods(ev);
    if (bare) {
      act = controls.find(key, bare, orderIds);
      queue = act !== null;
    }
    const order = act ? orders.find((a) => a.control === act) : undefined;
    if (order) {
      ev.preventDefault();
      this.press(order.id, queue);
      if (order.aim) playSound('action.hotkey');
    } else if (act && PAN_DIRS[act]) {
      ev.preventDefault();
      this.panHeld.set(ev.code, act);
      this.startPan();
    } else if (act === 'zoomIn' || act === 'zoomOut') {
      ev.preventDefault();
      const { clientWidth: w, clientHeight: h } = this.renderer.canvas;
      this.zoomBy(w / 2, h / 2, act === 'zoomIn' ? WHEEL_ZOOM : 1 / WHEEL_ZOOM);
    } else if (act === 'resetView') {
      this.renderer.resetView();
    } else if (act === 'cancel') {
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
    } else if (custom) {
      // A class's own button key (set by its program); Shift queues.
      ev.preventDefault();
      this.press(custom.id, isQueueModifier(ev));
      if (custom.aim) playSound('action.hotkey');
    } else if (/^(Digit|Numpad)[1-9]$/.test(ev.code)) {
      // By physical key, so Shift (and layouts like AZERTY) still give the digit. Save wins over add, add over select.
      const n = Number(ev.code.slice(-1));
      const select = controls.hasModifier('groupSelect') ? controls.modifierHeld('groupSelect', ev) : !(ev.ctrlKey || ev.shiftKey || ev.altKey || ev.metaKey);
      if (controls.modifierHeld('groupAssign', ev)) this.setGroup(n, false);
      else if (controls.modifierHeld('groupAdd', ev)) this.setGroup(n, true);
      else if (select) this.recallGroup(n);
      else return;
      ev.preventDefault();
    }
  }
}
