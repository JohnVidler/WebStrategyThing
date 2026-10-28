import { buildSparksDone, drawBuildSparks, makeBuildSparks, type BuildSparks } from './buildSparks';
import {
  Cargo,
  Construction,
  CpuState,
  CpuStatus,
  EnergyView,
  findPath,
  Health,
  Missile,
  Position,
  Production,
  Resource,
  ResourcePatch,
  SimEvent,
  TaskType,
  TICK_RATE,
  CLIFF_HEIGHT,
  WHEELS,
  chargeZoneRadius,
  RADAR_FADE_TICKS,
  RESOURCE_PATCH_AMOUNT,
  TILE,
  Unit,
  type Blueprint,
  type TickInfo,
} from '@wst/engine';
import { AlphaFilter, Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { buildingHalf, dishAnchor, drawDish, drawLook, drawRotor, drawTurretSprite, drawWall, factoryAnchor, GAIT_FRAMES, gaitLength, headlampsOf, isWall, lookOf, turretAnchors, WALL_E, WALL_N, WALL_NE, WALL_NW, WALL_S, WALL_SE, WALL_SW, WALL_W, windAnchor, type Lamp, type Look } from './art';
import { drawFactoryFx, type FactoryParts } from './factoryFx';
import { BEAM_H, BEAM_LAMP_Y, GLOW_SIZE, makeBeamTexture, makeGlowTexture } from './lights';
import { reduceMotion } from './settings';
import { burstSparks, drawSparks, expireSparks, type Spark } from './sparks';
import { drawShrapnel, landShrapnel, throwShrapnel, type Shrapnel } from './shrapnel';
import { renderClassImage, TEX, TEX_RESOLUTION } from './artstudio';
import type { ClientState } from './state';

/** Textures are drawn at this many pixels per tile, then scaled to the current zoom. */
const OWNER_COLOURS = [0x8a8f98, 0x4ea1ff, 0xff6b5b, 0x5bd68a, 0xf5c542, 0xc77dff, 0x4fd1c5, 0xff9f43];
const RESOURCE_COLOUR = 0x7ee0b5;
/** Sparks off a resource being mined: bright, with a few white-hot. */
const HARVEST_SPARK_COLOURS = [0xc8ffe6, 0x7ee0b5, 0xffffff, 0xfff0a8];
const BREAK_SPARK_COLOUR = 0xffb066;
/** Blast radius (tiles) used to size the fragments thrown when a module breaks: a few small ones. */
const MODULE_BREAK_RADIUS = 0.5;
/** A fragment that comes down: a small blast of this radius (tiles), and the sparks it sheds. */
const SHRAPNEL_BLAST_RADIUS = 0.3;
const SHRAPNEL_SPARK_COLOURS = [0xfff2a0, 0xffb347, 0xff9a2e];
/** Never run more blasts than this at once, so a big battle does not pile up fragment blasts. */
const MAX_EXPLOSIONS = 160;
/** A turret keeps tracking its last target this long after the last shot. */
const AIM_LINGER_MS = 1500;
/** An idle turret looks about: a new heading within this angle of the front every so often, turning at a share of the aiming speed. */
const TURRET_SWEEP_RANGE = 2.2;
const TURRET_SWEEP_MIN_MS = 1500;
const TURRET_SWEEP_MAX_MS = 4500;
const TURRET_SWEEP_SPEED = 0.25;
/** A gun lamp's beam is this many times a headlight's length, at this share of its brightness. */
const GUN_LAMP_LENGTH = 1.3;
const GUN_LAMP_ALPHA = 0.85;
/** Radians per second of a wind turbine rotor in the strongest wind. */
const ROTOR_MAX_SPEED = 9;
const ENERGY_COLOUR = 0xf5c542;
/** Repair beams, crosses and repair orders. */
const REPAIR_COLOUR = 0x66ffb8;
export const TASK_COLOURS: Record<number, number> = {
  [TaskType.Move]: 0x5bd68a,
  [TaskType.Attack]: 0xff6b5b,
  [TaskType.Harvest]: RESOURCE_COLOUR,
  [TaskType.Dock]: 0x4fd1c5,
  [TaskType.Charge]: ENERGY_COLOUR,
  [TaskType.Repair]: REPAIR_COLOUR,
};
/** Charging zones: drawn opaque, then the whole layer is faded so overlaps don't stack. */
const CHARGE_ZONE_COLOUR = 0x5bd68a;
const CHARGE_ZONE_ALPHA = 0.13;
/** Dashes for the placement link preview, in screen pixels. */
const DASH = 6;
const DASH_GAP = 4;
/** Above this many selected units, routes are drawn in the decluttered style. */
const CROWD_ROUTES = 6;
/** Green when healthy, through yellow, to red. */
const healthColour = (f: number) => (f > 0.6 ? 0x5bd68a : f > 0.3 ? 0xf5c542 : 0xff6b5b);
/** Tasks from class buttons. */
const SHOT_MS = 180;
/** A missile leaving its launcher flashes briefly. */
const LAUNCH_MS = 220;
/** Missiles leave a trail of this many past positions, so their wide turns can be read. */
const TRAIL_POINTS = 14;
/** Drop shadows of units and buildings: opacity, and the offset as a fraction of the sprite's size. */
const SHADOW_ALPHA = 0.4;
const SHADOW_OFFSET = 0.02;
/** Flying units: extra shadow offset at full lift (as a fraction of sprite size), lift while hovering, and how fast lift eases (per second). */
const AIR_SHADOW_LIFT = 0.7;
const AIR_HOVER_LIFT = 0.3;
const AIR_LIFT_RATE = 4;
/** How far above its shadow a missile is drawn, in tiles: the shadow is what says it is flying. */
const MISSILE_LIFT = 0.32;
const MISSILE_BODY = 0xdfe5ee;
const MISSILE_FLAME = 0xffb347;
const EXPLOSION_MS = 600;
/** Extra lifetime per tile of blast radius, so a building's blast lingers longer than a unit's. */
const EXPLOSION_MS_PER_TILE = 260;
const EXPLOSION_COLOUR = 0xff3b30;
const PULSE_MS = 600;
/** Lightning arcs per tesla discharge, segments per arc, and how often (ms) the crackle re-rolls. */
const TESLA_BOLTS = 11;
const TESLA_SEGMENTS = 9;
const TESLA_FLICKER_MS = 55;
const TESLA_CORE = 0xf3eaff;

/** Cheap deterministic noise in [-1, 1) from three integers, so a bolt's shape is stable within one flicker frame. */
const crackle = (a: number, b: number, c: number): number => {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x1b873593, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 2147483648 - 1;
};
/** A working charging pad sends out a slow green ring this often (see the engine's Charge event). */
const CHARGE_PULSE_MS = 2000;
const CHARGE_PULSE_COLOUR = 0x5dff9a;
/** A repair effect lingers this long after the last repair event (events come every other tick). */
const REPAIR_MS = 350;
/** Build beams: cyan lasers that raster across the site. Lingers a little after the last build event. */
const BUILD_BEAM_COLOUR = 0x4fd8ff;
const BUILD_BEAM_MS = 350;
/** Triangle wave 0..1..0 with the given period. */
const pingPong = (t: number, period: number): number => {
  const f = (t / period) % 1;
  return f < 0.5 ? f * 2 : 2 - f * 2;
};
/** The Power meter's colours (`--good` / `--bad` in style.css). */
const POWER_GOOD = 0x5bd68a;
const POWER_BAD = 0xff6b5b;
/** Damage numbers drift up this many tiles while fading out over this long. */
const DAMAGE_NUMBER_MS = 900;
const DAMAGE_NUMBER_RISE = 1.2;
/** Finished damage-number texts kept for reuse. */
const DAMAGE_TEXT_POOL = 64;
/** Font for the floating texts drawn in the map (damage numbers, power labels). */
const TEXT_FONT = 'ui-monospace, Consolas, monospace';
/** Night: the multiply colour at full dark (a deep blue), and the daylight (0..100) below which lights come on, fully lit by LIGHTS_FULL. */
const NIGHT_TINT = 0x3b4c80;
/** How far towards NIGHT_TINT the map goes at full dark (1 = all the way). */
const NIGHT_DEPTH = 0.7;
const LIGHTS_ON_BELOW = 45;
const LIGHTS_FULL_BELOW = 20;
/** Headlight beam length in tiles, and its warm colour. */
const BEAM_LENGTH = 2.4;
const BEAM_COLOUR = 0xfff0c0;
/** Nav lights on flying units: port red, starboard green, and a white strobe that flashes every STROBE_MS (steady with Reduce motion). */
const NAV_PORT = 0xff3030;
const NAV_STARBOARD = 0x30ff60;
const STROBE_MS = 1300;
/** Fire lights (drawGlows): the most lights drawn in a frame, and the colours of blasts and gun flashes. */
const GLOW_CAP = 300;
/** Spotlights under flying units: glows stacked from the craft to the ground, their colour and brightness. */
const SPOT_STEPS = 5;
const SPOT_COLOUR = 0xcfe4ff;
const SPOT_ALPHA = 0.4;
/** Radius of the pool of light under a flying unit, in tiles: tight while it sits still, wide once it is under way (it eases between them with the unit's lift). */
const SPOT_MIN_RADIUS = 0.9;
const SPOT_MAX_RADIUS = 5;
/** Most spotlight glows drawn at once. */
const SPOT_CAP = 200;
const EXPLOSION_LIGHT = 0xff9a3c;
const MUZZLE_LIGHT = 0xffd890;
/** Buildings at night: how far (in tiles) the interior light spills past the footprint, and its warm colour. */
const WINDOW_SPILL = 0.45;
const WINDOW_COLOUR = 0xffc060;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
/** The opening view: own forces plus this many tiles around them, and never less than this many tiles across. */
const START_MARGIN = 8;
const START_MIN_SPAN = 28;
/** Power-flow dots: spacing in tiles, and speed in tiles per second. */
const FLOW_SPACING = 2.5;
/** Speed for links whose load is unknown (other players' networks). */
const FLOW_SPEED = 1.5;
const FLOW_MIN_SPEED = 0.4;
const FLOW_MAX_SPEED = 8;
/** How quickly a link's displayed load follows a new report (per second). */
const FLOW_EASE = 1.5;
/** Dot speed for `amount` energy per tick: faster for more, with diminishing returns. */
export const flowSpeed = (amount: number | null): number =>
  amount === null ? FLOW_SPEED : Math.min(FLOW_MAX_SPEED, FLOW_MIN_SPEED + 1.1 * Math.sqrt(amount));
const PING_MS = 500;

export const ownerColour = (owner: number) =>
  owner === 0 ? OWNER_COLOURS[0] : OWNER_COLOURS[1 + ((owner - 1) % (OWNER_COLOURS.length - 1))];

/** A red ring that expands from where a unit or building died; x, y and radius are in tiles. */
/** One flying fragment of an explosion; angle and speed are fixed when it spawns. */
interface Fragment {
  angle: number;
  /** Distance travelled by the end, in blast radii. */
  reach: number;
  size: number;
}

interface Explosion {
  x: number;
  y: number;
  radius: number;
  born: number;
  /** Bigger blasts last longer. */
  ms: number;
  sparks: Fragment[];
  debris: Fragment[];
  smoke: Fragment[];
}

/** Rolls the random fragments for one blast; bigger blasts throw more of them. */
function makeExplosion(x: number, y: number, radius: number, born: number): Explosion {
  const fragments = (n: number, reach: [number, number], size: [number, number]): Fragment[] =>
    Array.from({ length: n }, () => ({
      angle: Math.random() * Math.PI * 2,
      reach: reach[0] + Math.random() * (reach[1] - reach[0]),
      size: size[0] + Math.random() * (size[1] - size[0]),
    }));
  const big = Math.min(3, radius);
  return {
    x,
    y,
    radius,
    born,
    ms: EXPLOSION_MS + EXPLOSION_MS_PER_TILE * radius,
    sparks: fragments(Math.round(10 + big * 6), [1.1, 2.2], [1.5, 2.5]),
    debris: fragments(Math.round(4 + big * 3), [0.8, 1.7], [1.5, 3.5]),
    smoke: fragments(Math.round(3 + big * 2), [0.1, 0.7], [0.3, 0.5]),
  };
}

interface Pulse {
  e: number;
  born: number;
  colour: number;
  /** Tesla discharges: the lightning arcs, each with a seed for its crackle. */
  bolts?: { angle: number; seed: number }[];
}

interface BuildBeam {
  a: number;
  b: number;
  /** Time of the latest build event for this pair. */
  last: number;
}

interface Repair {
  a: number;
  b: number;
  /** Time of the latest repair event for this pair. */
  last: number;
}

interface Shot {
  a: number;
  b: number;
  born: number;
  colour: number;
}

export interface Ping {
  x: number;
  y: number;
  born: number;
  colour: number;
}

/** A building blueprint following the cursor, waiting to be placed (top-left tile). */
export interface Placement {
  readonly bp: Blueprint;
  x: number;
  y: number;
  valid: boolean;
  /** While dragging a line of buildings: every spot on it (top-left tiles); empty for a single building. */
  line: { x: number; y: number; valid: boolean }[];
}

/** Input-owned state the renderer draws on top of the world. */
export interface ViewState {
  readonly selection: ReadonlySet<number>;
  band: { x0: number; y0: number; x1: number; y1: number } | null;
  readonly pings: Ping[];
  placement: Placement | null;
  /** While right-dragging a move order: the dragged path and where each selected unit would stand (screen pixels). */
  orderPath: { path: { x: number; y: number }[]; stops: { x: number; y: number }[] } | null;
}

/** Planned route through a unit's whole task queue, in tile coordinates. */
interface Route {
  key: string;
  segments: { type: number; points: number[] }[];
}

/**
 * Draws the client's mirror World. Holds no game state of its own beyond
 * interpolation buffers; sprites share one texture per blueprint (flyweight).
 */
export class Renderer {
  private readonly backdrop = new Graphics();
  private readonly zoneLayer = new Graphics();
  private zonesDrawnFor = '';
  private readonly linkLayer = new Graphics();
  private readonly layer = new Container();
  /** Ore lies flat on the ground, under every unit and building whatever order they appeared in. */
  private readonly groundLayer = new Container();
  /** Night: a screen-sized white sprite, multiplied over the map and tinted darker as daylight falls. */
  private readonly nightLayer = new Sprite(Texture.WHITE);
  /** Headlights and nav lights, added on top of the night tint. */
  private readonly lightLayer = new Graphics();
  /** Headlights: soft additive sprites under the vehicles (above the ground), pooled and reused each frame. */
  private readonly beamLayer = new Container();
  private readonly beams: Sprite[] = [];
  private readonly beamTexture = Texture.from(makeBeamTexture());
  private beamTint = 0xffffff;
  /** Flying units' spotlights: pooled soft glows in the same layer, under the craft. */
  private readonly spots: Sprite[] = [];
  private spotsUsed = 0;
  private spotTint = 0xffffff;
  /** Light thrown by explosions, muzzle flashes, impacts and missile engines: pooled soft additive sprites, above the fog, under the effects. */
  private readonly glowLayer = new Container();
  private readonly glows: Sprite[] = [];
  private glowsUsed = 0;
  private readonly glowTexture = Texture.from(makeGlowTexture());
  private readonly fogLayer = new Graphics();
  /** Radar blips and pulse rings, above the fog so contacts show in the dark. */
  private readonly radarLayer = new Container();
  private readonly radarGfx = new Graphics();
  /** Faded copies of each contact's real art, reused from frame to frame. */
  private readonly radarSprites: Sprite[] = [];
  private fogDrawnFor = '';
  private readonly overlay = new Graphics();
  /** Floating damage numbers; they rise and fade over DAMAGE_NUMBER_MS. */
  private readonly damageLayer = new Container();
  private damageNumbers: { text: Text; x: number; y: number; born: number }[] = [];
  /** Finished damage-number texts, kept for reuse: building a Pixi Text renders a canvas texture. */
  private readonly damageTextPool: Text[] = [];
  /** Speech bubbles from `alert()` in programs, by unit. */
  private readonly bubbleLayer = new Container();
  private readonly bubbles = new Map<number, { box: Container; until: number }>();
  /** Supply/load labels shown while the Power meter is hovered, by building. */
  private readonly powerLabelLayer = new Container();
  private readonly powerLabels = new Map<number, Text>();
  private readonly powerLabelColour = new WeakMap<Text, number>();
  /** Last health seen per entity, to spot drops. */
  private readonly lastHp = new Map<number, number>();
  private readonly ghost = new Sprite();
  /** Extra ghosts for the other buildings of a dragged line. */
  private readonly lineGhosts: Sprite[] = [];
  private readonly sprites = new Map<number, Sprite>();
  /** Soft dark copies of each unit and building, offset down-right under the layer of sprites, for a sense of height. */
  private readonly shadowLayer = new Container();
  private readonly shadows = new Map<number, Sprite>();
  /** How high each flying unit rides above its shadow, 0 (on the ground) to 1 (flying at speed); eased from frame to frame. */
  private shadowLift = new Float32Array(1024);
  /** Spinning radar dishes riding on the sprites of radar-equipped units and buildings. */
  private readonly dishes = new Map<number, Sprite>();
  /** Entities known not to have a radar, so they are not checked every frame. */
  private readonly noDish = new Set<number>();
  /** Walking units: how far through the gait cycle they are (cycles), where they were last frame, and when they last moved. */
  private readonly gaits = new Map<number, { look: Look; bp: Blueprint; owner: number; phase: number; x: number; y: number; movedAt: number; poses: (Texture | undefined)[] }>();
  /** Entities known not to walk, so they are not checked every frame. */
  private readonly noGait = new Set<number>();
  /** Gun turrets that swing to face their target, as child sprites of the hull (or building). */
  private readonly turrets = new Map<number, Sprite[]>();
  private readonly noTurret = new Set<number>();
  /** Headlights by design (blueprint id). */
  private readonly lamps = new Map<number, readonly Lamp[]>();
  /** Where each idle turret is currently sweeping to, and when it picks a new heading. */
  private readonly turretWatch = new WeakMap<Sprite, { goal: number; next: number }>();
  /** Who each weapon last shot at, and until when the turret keeps tracking it. */
  private readonly aimAt = new Map<number, { target: number; until: number }>();
  /** Wind turbine rotors on buildings, spun by the wind. */
  private readonly rotors = new Map<number, Sprite>();
  private readonly noRotor = new Set<number>();
  /** Walls (buildings that are only armour) and which sides join a neighbouring wall; rebuilt when buildings change. */
  private readonly wallMasks = new Map<number, number>();
  private wallVersion = -1;
  /** Sparks from mining and from broken modules. */
  private sparks: Spark[] = [];
  /** Fragments thrown by explosions, still in flight. */
  private shrapnel: Shrapnel[] = [];
  /** Cargo a harvester held at its last Harvest event: the difference is what it just mined. */
  private readonly lastCargo = new Map<number, number>();
  private readonly textures = new Map<string, Texture>();
  private readonly routes = new Map<number, Route>();
  /** Sprite rotation each unit is turning towards (art faces up; 0 = up). Kept while stopped. */
  private readonly facing = new Map<number, number>();
  private lastFrameAt = 0;
  private prevX = new Float32Array(1024);
  private prevY = new Float32Array(1024);
  private curX = new Float32Array(1024);
  private curY = new Float32Array(1024);
  private shots: Shot[] = [];
  /** Launcher entities that just fired a missile, with the time of the launch. */
  private launches: { e: number; born: number }[] = [];
  /** Missiles in flight (they are drawn straight from the Missile component, not as sprites, and cannot be selected). */
  private readonly flying = new Set<number>();
  /** Recent positions of each missile in tiles, flat [x, y, ...], oldest first. */
  private readonly trails = new Map<number, number[]>();
  private pulses: Pulse[] = [];
  private chargePulses: Pulse[] = [];
  private explosions: Explosion[] = [];
  private buildSparks: BuildSparks[] = [];
  /** Blast radius in tiles per entity, remembered while alive because stats are gone once it dies. */
  private readonly blastRadius = new Map<number, number>();
  private repairs = new Map<string, Repair>();
  private buildBeams = new Map<string, BuildBeam>();
  private lastTickAt = 0;
  private alpha = 1;
  private tickMs = 100;
  private scale = 10;
  private readonly factoryPartsCache = new Map<number, { scale: number; parts: FactoryParts | null }>();
  private offX = 0;
  private offY = 0;
  private laidOutFor = '';
  private linksDrawnFor = '';
  /** Where the dots on each flowing link are (0..1, by "from-to"), advanced each frame at that link's speed. */
  private readonly flowPhase = new Map<string, number>();
  /** Each link's displayed load, easing towards the latest report so bursty top-ups don't make dots stutter. */
  private readonly flowLoad = new Map<string, number>();
  private lastFlowFrame = 0;
  /** Camera: zoom relative to "whole map fits", centred on tile (camX, camY). */
  private zoom = 1;
  private camX = NaN;
  private camY = NaN;
  /** Set on joining a match: the first frame with own forces on the map frames them, unless the player moved the view first. */
  private frameOwnBase = false;

  private constructor(
    private readonly app: Application,
    private readonly state: ClientState,
    private readonly view: ViewState,
  ) {
    this.ghost.anchor.set(0.5);
    this.ghost.alpha = 0.55;
    this.ghost.visible = false;
    this.zoneLayer.filters = [new AlphaFilter({ alpha: CHARGE_ZONE_ALPHA })];
    this.nightLayer.blendMode = 'multiply';
    this.nightLayer.visible = false;
    this.lightLayer.blendMode = 'add';
    app.stage.addChild(this.backdrop, this.zoneLayer, this.linkLayer, this.shadowLayer, this.groundLayer, this.beamLayer, this.layer, this.nightLayer, this.lightLayer, this.fogLayer, this.radarLayer, this.glowLayer, this.overlay, this.damageLayer, this.bubbleLayer, this.powerLabelLayer, this.ghost);
    app.ticker.add(() => this.frame());
  }

  static async create(host: HTMLElement, state: ClientState, view: ViewState): Promise<Renderer> {
    const app = new Application();
    await app.init({ resizeTo: host, background: '#05070a', antialias: true });
    host.prepend(app.canvas); // first child: overlays inside #map stack above it
    // resizeTo only follows window resizes; the map area also changes size when the
    // panels around it fill in (e.g. the build bar once the class list arrives).
    new ResizeObserver(() => app.queueResize()).observe(host);
    return new Renderer(app, state, view);
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  configure(tickRate: number): void {
    this.tickMs = 1000 / tickRate;
    this.laidOutFor = '';
    this.resetView();
    this.frameOwnBase = true;
  }

  /** Zooms and pans to the bounding box of own units and buildings, plus a margin. False if there are none. */
  private frameBase(): boolean {
    const { unit, pos } = { unit: this.state.world.store(Unit), pos: this.state.world.store(Position) };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const e of unit.dense) {
      if (unit.f.owner[e] !== this.state.myId || !pos.has(e)) continue;
      const x = pos.f.x[e] / TILE;
      const y = pos.f.y[e] / TILE;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x0 === Infinity) return false;
    const spanX = Math.max(START_MIN_SPAN, x1 - x0 + 2 * START_MARGIN);
    const spanY = Math.max(START_MIN_SPAN, y1 - y0 + 2 * START_MARGIN);
    const { width, height } = this.app.screen;
    const fit = this.fitScale();
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(width / spanX, height / spanY) / fit));
    this.camX = (x0 + x1) / 2;
    this.camY = (y0 + y1) / 2;
    this.laidOutFor = '';
    return true;
  }

  // --- camera -------------------------------------------------------------------------

  /** Zooms by `factor`, keeping the tile under (sx, sy) fixed on screen. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToTile(sx, sy);
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    if (zoom === this.zoom) return;
    this.frameOwnBase = false;
    const { width, height } = this.app.screen;
    const scale = this.fitScale() * zoom;
    this.zoom = zoom;
    this.camX = before.x - (sx - width / 2) / scale;
    this.camY = before.y - (sy - height / 2) / scale;
    this.laidOutFor = '';
  }

  /** Pans by a screen-space delta (drag the map with the pointer). */
  panBy(dx: number, dy: number): void {
    this.frameOwnBase = false;
    this.camX -= dx / this.scale;
    this.camY -= dy / this.scale;
    this.laidOutFor = '';
  }

  /** Moves the camera to a tile position, keeping the zoom. */
  centreOn(x: number, y: number): void {
    this.frameOwnBase = false;
    this.camX = x;
    this.camY = y;
    this.laidOutFor = '';
  }

  resetView(): void {
    this.zoom = 1;
    this.camX = NaN;
    this.camY = NaN;
    this.laidOutFor = '';
  }

  private fitScale(): number {
    const { width, height } = this.app.screen;
    const t = this.state.terrain;
    return Math.min(width / t.width, height / t.height) * 0.96;
  }

  /** Small image of a class (same art as its sprites), for the build bar. */
  async iconFor(bp: Blueprint): Promise<string> {
    const sprite = new Sprite(this.unitTexture(bp, bp.owner));
    const s = 36 / Math.max(sprite.width, sprite.height);
    // In the game the turrets and a wind turbine's rotor are sprites of their own on top of this texture, so add them here too.
    const look = lookOf(bp.parts);
    const cx = sprite.width / 2, cy = sprite.height / 2;
    const wind = windAnchor(look, TEX);
    if (wind) {
      const rotor = new Sprite(this.texture(`rotor:${Math.round(wind.radius * 10)}`, (g) => drawRotor(g, wind.radius)));
      rotor.anchor.set(0.5);
      rotor.position.set(cx + wind.x, cy + wind.y);
      sprite.addChild(rotor);
    }
    const anchors = turretAnchors(look, TEX);
    if (anchors.length > 0) {
      const tex = this.texture(`turret:${bp.id}`, (g) => drawTurretSprite(g, look, TEX));
      for (const a of anchors) {
        const t = new Sprite(tex);
        t.anchor.set(0.5);
        t.position.set(cx + a.x, cy + a.y);
        sprite.addChild(t);
      }
    }
    sprite.scale.set(s);
    try {
      return await this.app.renderer.extract.base64(sprite);
    } finally {
      sprite.destroy({ children: true });
    }
  }

  // --- coordinate helpers (screen = canvas CSS pixels) -------------------------

  screenToTile(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.offX) / this.scale, y: (sy - this.offY) / this.scale };
  }

  /** The middle of the view in tiles, and how far from it things can still be heard (a little past the screen corners). */
  listener(): { x: number; y: number; radius: number } {
    const { width, height } = this.app.screen;
    const centre = this.screenToTile(width / 2, height / 2);
    return { x: centre.x, y: centre.y, radius: (Math.hypot(width, height) / 2 / this.scale) * 1.2 };
  }

  private tileX(e: number): number {
    return this.prevX[e] + (this.curX[e] - this.prevX[e]) * this.alpha;
  }

  private tileY(e: number): number {
    return this.prevY[e] + (this.curY[e] - this.prevY[e]) * this.alpha;
  }

  /** Interpolated screen position of an entity. */
  /** Door and stacks of a factory in screen pixels from its centre (cached by class and zoom, so nothing is allocated per frame); undefined if its art has none. */
  private factoryParts(e: number): FactoryParts | undefined {
    const bpId = this.state.world.store(Unit).f.blueprint[e];
    let c = this.factoryPartsCache.get(bpId);
    if (!c || c.scale !== this.scale) {
      const bp = this.state.blueprints.get(bpId);
      if (!bp) return undefined; // class info not here yet
      const a = factoryAnchor(lookOf(bp.parts), TEX);
      const k = this.scale / TEX;
      c = { scale: this.scale, parts: a ? { door: { x: a.door.x * k, y: a.door.y * k }, stacks: a.stacks.map((p) => ({ x: p.x * k, y: p.y * k })), unit: this.scale } : null };
      this.factoryPartsCache.set(bpId, c);
    }
    return c.parts ?? undefined;
  }

  screenOf(e: number): { x: number; y: number } {
    return { x: this.offX + this.tileX(e) * this.scale, y: this.offY + this.tileY(e) * this.scale };
  }

  /** Topmost entity under a screen point: units beat buildings beat resources. */
  pick(sx: number, sy: number, missiles = false): number {
    let best = -1;
    let bestScore = Infinity;
    const res = this.state.world.store(Resource);
    if (missiles) {
      // Missiles are not sprites; they fly above their shadow. Aimed orders may target one (to shoot it down).
      const lift = this.scale * MISSILE_LIFT;
      const reach = Math.max(10, this.scale * 0.45);
      for (const e of this.flying) {
        const store = this.state.world.store(Missile);
        if (!store.has(e) || store.f.owner[e] === this.state.myId) continue;
        const p = this.screenOf(e);
        const d = Math.hypot(p.x - sx, p.y - lift - sy);
        if (d <= reach && d - 5000 < bestScore) {
          best = e;
          bestScore = d - 5000;
        }
      }
    }
    for (const e of this.sprites.keys()) {
      const p = this.screenOf(e);
      const s = this.state.stats(e);
      let score: number;
      if (s?.structure) {
        const half = (s.footprint * this.scale) / 2;
        if (Math.abs(p.x - sx) > half || Math.abs(p.y - sy) > half) continue;
        score = 1000 + Math.hypot(p.x - sx, p.y - sy);
      } else {
        const d = Math.hypot(p.x - sx, p.y - sy);
        // Big hulls are hit anywhere on the body (a light unit's reach stays the old 0.55 tile).
        const reach = Math.max(0.55, ((s?.radius ?? 0) / TILE) * 1.25);
        if (d > Math.max(7, this.scale * reach)) continue;
        score = d + (res.has(e) ? 2000 : 0);
      }
      if (score < bestScore) {
        best = e;
        bestScore = score;
      }
    }
    return best;
  }

  entitiesInRect(x0: number, y0: number, x1: number, y1: number): number[] {
    const [l, r] = x0 < x1 ? [x0, x1] : [x1, x0];
    const [t, b] = y0 < y1 ? [y0, y1] : [y1, y0];
    const out: number[] = [];
    for (const e of this.sprites.keys()) {
      const p = this.screenOf(e);
      if (p.x >= l && p.x <= r && p.y >= t && p.y <= b) out.push(e);
    }
    return out;
  }

  // --- replication ----------------------------------------------------------

  /** Call after applyTick() and before world.flush(): consumes the world's change lists. */
  sync(info: TickInfo): void {
    const world = this.state.world;
    this.ensureCapacity(world.capacity);
    // Entities that die this tick keep their blast radius until the Death event below uses it.
    const dying = new Set<number>();
    for (let i = 0; i < info.events.length; i += 3) if (info.events[i] === SimEvent.Death) dying.add(info.events[i + 1]);
    if (info.full) {
      for (const s of this.sprites.values()) s.destroy();
      this.sprites.clear();
      for (const s of this.shadows.values()) s.destroy();
      this.shadows.clear();
      this.gaits.clear();
      this.noGait.clear();
      this.turrets.clear();
      this.noTurret.clear();
      this.aimAt.clear();
      this.rotors.clear();
      this.noRotor.clear();
      this.lastCargo.clear();
      this.sparks.length = 0;
      this.shrapnel.length = 0;
      this.facing.clear();
      this.lastHp.clear();
      this.blastRadius.clear();
      this.flying.clear();
      this.trails.clear();
    }
    for (const e of world.despawned) {
      this.dishes.get(e)?.destroy();
      this.dishes.delete(e);
      this.noDish.delete(e);
      this.gaits.delete(e);
      this.noGait.delete(e);
      this.turrets.delete(e); // destroyed with its parent sprite
      this.noTurret.delete(e);
      this.aimAt.delete(e);
      this.rotors.delete(e);
      this.noRotor.delete(e);
      this.lastCargo.delete(e);
      this.sprites.get(e)?.destroy();
      this.sprites.delete(e);
      this.shadows.get(e)?.destroy();
      this.shadows.delete(e);
      this.routes.delete(e);
      this.facing.delete(e);
      this.flying.delete(e);
      this.trails.delete(e);
      // Forget what was seen: an entity that comes back (or an id that is reused) starts afresh.
      this.lastHp.delete(e);
      if (!dying.has(e)) this.blastRadius.delete(e);
    }

    // Last tick's target becomes this tick's interpolation origin.
    for (const e of this.sprites.keys()) {
      this.prevX[e] = this.curX[e];
      this.prevY[e] = this.curY[e];
    }
    for (const e of this.flying) {
      this.prevX[e] = this.curX[e];
      this.prevY[e] = this.curY[e];
    }

    const pos = world.store(Position);
    for (const e of pos.changed) {
      if (!pos.has(e)) continue;
      this.curX[e] = pos.f.x[e] / TILE;
      this.curY[e] = pos.f.y[e] / TILE;
      const dx = this.curX[e] - this.prevX[e], dy = this.curY[e] - this.prevY[e];
      if (this.sprites.has(e) && dx * dx + dy * dy > 1e-6 && this.state.world.store(Unit).has(e) && !this.state.stats(e)?.structure) {
        this.facing.set(e, Math.atan2(dy, dx) + Math.PI / 2);
      }
      if (!this.sprites.has(e) && !this.flying.has(e)) {
        this.prevX[e] = this.curX[e];
        this.prevY[e] = this.curY[e];
      }
    }

    const unit = world.store(Unit);
    for (const e of unit.changed) {
      if (!unit.has(e)) continue;
      this.ensureSprite(e, this.skin(e));
      const st = this.state.stats(e);
      this.blastRadius.set(e, st?.structure ? st.footprint * 0.75 : 0.9);
    }
    if (this.wallVersion !== this.state.structureVersion) this.joinWalls();

    const missiles = world.store(Missile);
    for (const e of missiles.changed) {
      if (!missiles.has(e)) continue;
      this.flying.add(e);
      this.blastRadius.set(e, missiles.f.blast[e] / 10);
    }
    for (const e of this.flying) {
      if (!pos.has(e)) continue;
      let trail = this.trails.get(e);
      if (!trail) this.trails.set(e, (trail = []));
      trail.push(this.curX[e], this.curY[e]);
      if (trail.length > TRAIL_POINTS * 2) trail.splice(0, 2);
    }

    const res = world.store(Resource);
    const patches = world.store(ResourcePatch);
    for (const e of [...res.changed, ...patches.changed]) {
      if (!res.has(e)) continue;
      // Shards drop away as the node is mined: five looks, from full down to a bare patch.
      const amount = res.f.amount[e];
      const full = Math.max(amount, patches.has(e) ? patches.f.maximum[e] : RESOURCE_PATCH_AMOUNT);
      const stage = amount <= 0 ? -1 : Math.min(4, Math.floor((amount / full) * 5));
      this.ensureSprite(e, this.resourceTexture(stage), this.groundLayer);
    }

    const health = world.store(Health);
    const sites = world.store(Construction);
    const spawnedAt = performance.now();
    for (const e of health.changed) {
      if (!health.has(e)) {
        this.lastHp.delete(e);
        continue;
      }
      const hp = health.f.hp[e];
      const before = this.lastHp.get(e);
      this.lastHp.set(e, hp);
      if (before !== undefined && hp < before && this.sprites.has(e)) {
        this.spawnDamageNumber(e, Math.round(before - hp), spawnedAt);
      }
    }
    for (const e of [...health.changed, ...sites.changed, ...sites.removed]) {
      const s = this.sprites.get(e);
      if (!s || !health.has(e)) continue;
      const max = this.state.stats(e)?.hp ?? 1;
      s.alpha = sites.has(e) ? 0.25 + 0.4 * (sites.f.progress[e] / 100) : 0.5 + 0.5 * Math.max(0, health.f.hp[e] / max);
    }

    const cpu = world.store(CpuStatus);
    for (const e of cpu.changed) {
      const s = this.sprites.get(e);
      if (!s) continue;
      s.tint = cpu.f.fault[e] ? 0xff4040 : cpu.f.state[e] === CpuState.Stunned ? 0x9ad0ff : cpu.f.state[e] === CpuState.NoPower ? 0x6a6f78 : 0xffffff;
    }

    const now = performance.now();
    // A construction site that finishes (and is still standing) sends sparks out along the grid.
    for (const e of sites.removed) {
      if (!unit.has(e) || !world.isAlive(e) || !this.sprites.has(e)) continue;
      const f = this.state.footprint(e);
      this.buildSparks.push(makeBuildSparks(f.x, f.y, f.size, now));
    }
    for (let i = 0; i < info.events.length; i += 3) {
      if (info.events[i] === SimEvent.Charge) {
        const a = info.events[i + 1];
        this.chargePulses.push({ e: a, born: now, colour: CHARGE_PULSE_COLOUR });
        continue;
      }
      if (info.events[i] === SimEvent.Pulse) {
        const a = info.events[i + 1];
        const bolts = Array.from({ length: TESLA_BOLTS }, (_, i) => ({
          angle: ((i + Math.random() * 0.8) / TESLA_BOLTS) * Math.PI * 2,
          seed: Math.floor(Math.random() * 100000),
        }));
        this.pulses.push({ e: a, born: now, colour: ownerColour(unit.f.owner[a]), bolts });
        continue;
      }
      if (info.events[i] === SimEvent.Death) {
        const a = info.events[i + 1];
        // No blast radius means this client never saw the entity (out of sight), so its position is unset (0,0) or stale.
        const radius = this.blastRadius.get(a);
        if (radius === undefined) continue;
        this.explosions.push(makeExplosion(this.curX[a], this.curY[a], radius, now));
        if (!reduceMotion()) throwShrapnel(this.shrapnel, this.curX[a], this.curY[a], radius, now);
        this.blastRadius.delete(a);
        continue;
      }
      if (info.events[i] === SimEvent.Build) {
        const a = info.events[i + 1];
        const b = info.events[i + 2];
        this.buildBeams.set(`${a}:${b}`, { a, b, last: now });
        // Now and then the site throws off a spark or two along the grid.
        if (Math.random() < 0.1 && this.buildSparks.length < 100 && this.sprites.has(b)) {
          const f = this.state.footprint(b);
          this.buildSparks.push(makeBuildSparks(f.x, f.y, f.size, now, 1 + Math.floor(Math.random() * 2)));
        }
        continue;
      }
      if (info.events[i] === SimEvent.Repair) {
        const a = info.events[i + 1];
        const b = info.events[i + 2];
        this.repairs.set(`${a}:${b}`, { a, b, last: now });
        continue;
      }
      if (info.events[i] === SimEvent.Harvest) {
        const a = info.events[i + 1];
        const b = info.events[i + 2];
        // As many sparks as the harvester just took from the resource (its cargo since the last event).
        const held = world.store(Cargo).has(a) ? world.store(Cargo).f.amount[a] : 0;
        const mined = Math.max(0, held - (this.lastCargo.get(a) ?? held)) || (this.state.stats(a)?.harvestRate ?? 0) * 2;
        this.lastCargo.set(a, held);
        if (this.sprites.has(a)) {
          const at = this.sprites.has(b) ? b : a;
          // Matter streams in from the ground patch into the heart of the crystal as it is mined (the spark effect
          // in reverse). If the resource is not known here the sparks spray from the harvester as before.
          burstSparks(this.sparks, this.curX[at], this.curY[at], Math.min(14, Math.max(1, Math.round(mined * 0.8))), now, {
            colour: HARVEST_SPARK_COLOURS[Math.floor(Math.random() * HARVEST_SPARK_COLOURS.length)],
            ...(at === a ? { spread: 1.1 } : { inward: true }),
            reach: at === a ? [0.25, 0.65] : [0.5, 1.05],
            ms: at === a ? [220, 420] : [280, 520],
          });
        }
        continue;
      }
      if (info.events[i] === SimEvent.Break) {
        const a = info.events[i + 1];
        if (this.sprites.has(a)) {
          burstSparks(this.sparks, this.curX[a], this.curY[a], 18, now, { colour: BREAK_SPARK_COLOUR, reach: [0.4, 1.1], ms: [300, 650], width: 2 });
          if (!reduceMotion()) throwShrapnel(this.shrapnel, this.curX[a], this.curY[a], MODULE_BREAK_RADIUS, now);
        }
        continue;
      }
      if (info.events[i] !== SimEvent.Shot) continue;
      const a = info.events[i + 1];
      this.aimAt.set(a, { target: info.events[i + 2], until: now + AIM_LINGER_MS });
      if (this.state.stats(a)?.weapon?.kind === 'missile') {
        // No instant line: the missile itself is the shot (see drawMissiles).
        this.launches.push({ e: a, born: now });
        continue;
      }
      this.shots.push({ a, b: info.events[i + 2], born: now, colour: ownerColour(unit.f.owner[a]) });
    }
    for (const a of info.alerts) this.showBubble(a.e, a.text, now + a.ticks * (1000 / TICK_RATE));
    this.lastTickAt = now;
  }

  /** Puts (or replaces) a text-only speech bubble over a unit until the time given. */
  private showBubble(e: number, message: string, until: number): void {
    this.bubbles.get(e)?.box.destroy({ children: true });
    const text = new Text({
      text: message,
      style: { fontFamily: TEXT_FONT, fontSize: 12, fill: 0x14181f, wordWrap: true, wordWrapWidth: 150, align: 'center' },
    });
    text.anchor.set(0.5, 1);
    text.position.set(0, -8);
    const w = text.width + 12;
    const h = text.height + 8;
    const back = new Graphics()
      .roundRect(-w / 2, -8 - h + 2, w, h, 6)
      .fill({ color: 0xf4f6fa, alpha: 0.95 })
      .stroke({ color: 0x14181f, width: 1.5 })
      .poly([-5, -7, 5, -7, 0, 0])
      .fill({ color: 0xf4f6fa, alpha: 0.95 });
    const box = new Container();
    box.addChild(back, text);
    this.bubbleLayer.addChild(box);
    this.bubbles.set(e, { box, until });
  }

  private drawBubbles(now: number): void {
    for (const [e, b] of this.bubbles) {
      if (now >= b.until || !this.sprites.has(e)) {
        b.box.destroy({ children: true });
        this.bubbles.delete(e);
        continue;
      }
      const p = this.screenOf(e);
      const half = this.state.stats(e)?.structure ? ((this.state.stats(e)?.footprint ?? 1) * this.scale) / 2 : this.scale / 2;
      b.box.position.set(p.x, p.y - half);
      b.box.alpha = Math.min(1, (b.until - now) / 250);
    }
  }

  /** Pins a number to the spot (in tiles) just above the entity that was hit. */
  private spawnDamageNumber(e: number, amount: number, now: number): void {
    if (amount <= 0) return;
    const text =
      this.damageTextPool.pop() ??
      new Text({
        text: '',
        style: { fontFamily: TEXT_FONT, fontSize: 14, fontWeight: 'bold', fill: 0xffe08a, stroke: { color: 0x000000, width: 3 } },
      });
    text.text = String(amount);
    text.anchor.set(0.5, 1);
    text.alpha = 1;
    this.damageLayer.addChild(text);
    const half = this.state.stats(e)?.structure ? (this.state.stats(e)?.footprint ?? 1) / 2 : 0.5;
    // Small sideways jitter so simultaneous hits don't stack exactly.
    this.damageNumbers.push({ text, x: this.curX[e] + (Math.random() - 0.5) * 0.4, y: this.curY[e] - half, born: now });
  }

  private drawDamageNumbers(now: number): void {
    this.damageNumbers = this.damageNumbers.filter((d) => {
      const age = (now - d.born) / DAMAGE_NUMBER_MS;
      if (age >= 1) {
        this.damageLayer.removeChild(d.text);
        if (this.damageTextPool.length < DAMAGE_TEXT_POOL) this.damageTextPool.push(d.text);
        else d.text.destroy();
        return false;
      }
      d.text.position.set(this.offX + d.x * this.scale, this.offY + (d.y - age * DAMAGE_NUMBER_RISE) * this.scale);
      d.text.alpha = 1 - age * age;
      return true;
    });
  }

  /**
   * While the Power meter is hovered, labels every on-screen own building with the
   * energy per tick it supplied (+, green) or drew (-, red) last tick, in the meter's colours.
   */
  private drawPowerLabels(): void {
    const wanted = new Map<number, number>();
    if (this.state.showPowerLabels) {
      const { width, height } = this.app.screen;
      for (const net of this.state.networks) {
        net.members.forEach((e, i) => {
          const flow = net.flow[i] ?? 0;
          if (flow === 0 || !this.sprites.has(e)) return;
          wanted.set(e, flow);
        });
      }
      for (const [e, flow] of wanted) {
        const p = this.screenOf(e);
        if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) {
          wanted.delete(e);
          continue;
        }
        let label = this.powerLabels.get(e);
        if (!label) {
          label = new Text({ text: '', style: { fontFamily: TEXT_FONT, fontSize: 13, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } });
          label.anchor.set(0.5);
          this.powerLabelLayer.addChild(label);
          this.powerLabels.set(e, label);
        }
        const text = flow < 0 ? `+${-flow}` : `-${flow}`;
        if (label.text !== text) label.text = text;
        const colour = flow < 0 ? POWER_GOOD : POWER_BAD;
        if (this.powerLabelColour.get(label) !== colour) {
          label.style.fill = colour; // restyling re-renders the text's texture, so only when it changes
          this.powerLabelColour.set(label, colour);
        }
        label.position.set(p.x, p.y);
      }
    }
    for (const [e, label] of this.powerLabels) {
      if (wanted.has(e)) continue;
      label.destroy();
      this.powerLabels.delete(e);
    }
  }

  /** Keeps a radar dish turning on top of a radar-equipped sprite (a child, so it moves and scales with it). */
  private spinDish(e: number, s: Sprite, now: number): void {
    let dish = this.dishes.get(e);
    if (!dish) {
      if (this.noDish.has(e)) return;
      const unit = this.state.world.store(Unit);
      const bp = unit.has(e) ? this.state.blueprints.get(unit.f.blueprint[e]) : undefined;
      if (!bp) return; // class info not here yet
      if (bp.stats.radarMaxEnergy <= 0) {
        this.noDish.add(e);
        return;
      }
      const look = lookOf(bp.parts);
      const a = dishAnchor(look, TEX);
      dish = new Sprite(this.texture(`dish:${Math.round(a.radius * 10)}`, (g) => drawDish(g, a.radius)));
      dish.anchor.set(0.5);
      dish.position.set(a.x, a.y);
      s.addChild(dish);
      this.dishes.set(e, dish);
    }
    dish.rotation = (now / 1000) * 2.4;
  }

  /**
   * Walks the legs of a legged unit: the gait advances with the distance covered, so legs move in
   * proportion to speed and stop when the unit does. Each pose is a cached texture (a few per class).
   */
  private walk(e: number, s: Sprite, now: number): void {
    let w = this.gaits.get(e);
    if (!w) {
      if (this.noGait.has(e)) return;
      const unit = this.state.world.store(Unit);
      const bp = unit.has(e) ? this.state.blueprints.get(unit.f.blueprint[e]) : undefined;
      if (!bp) return; // class info not here yet
      const look = lookOf(bp.parts);
      if (look.motor !== 'legs') {
        this.noGait.add(e);
        return;
      }
      w = { look, bp, owner: unit.f.owner[e], phase: 0, x: this.tileX(e), y: this.tileY(e), movedAt: -Infinity, poses: [] };
      this.gaits.set(e, w);
    }
    const x = this.tileX(e), y = this.tileY(e);
    const d = Math.hypot(x - w.x, y - w.y);
    w.x = x;
    w.y = y;
    if (d > 1e-4) {
      w.phase = (w.phase + d / gaitLength(w.look)) % 1;
      w.movedAt = now;
    }
    // Standing still (for a moment): the rest pose, kept at the end of the list. Poses are looked up
    // once each, so a walking sprite allocates nothing per frame.
    const pose = now - w.movedAt > 150 ? GAIT_FRAMES : Math.floor(w.phase * GAIT_FRAMES) % GAIT_FRAMES;
    const tex = (w.poses[pose] ??= pose === GAIT_FRAMES
      ? this.unitTexture(w.bp, w.owner)
      : this.texture(`bp:${w.bp.id}:gait${pose}`, (g) => drawLook(g, w!.look, ownerColour(w!.owner), TEX, false, (pose / GAIT_FRAMES) * Math.PI * 2)));
    if (s.texture !== tex) s.texture = tex;
  }

  /**
   * Swings a gun turret (a child sprite) round to the target of the last shot, and back to the front
   * when the weapon has been quiet for a while. `turn` is the share of the remaining angle to cover this frame.
   */
  private aim(e: number, s: Sprite, now: number, turn: number): void {
    let ts = this.turrets.get(e);
    if (!ts) {
      if (this.noTurret.has(e)) return;
      const unit = this.state.world.store(Unit);
      const bp = unit.has(e) ? this.state.blueprints.get(unit.f.blueprint[e]) : undefined;
      if (!bp) return; // class info not here yet
      const look = lookOf(bp.parts);
      const anchors = turretAnchors(look, TEX);
      if (anchors.length === 0) {
        this.noTurret.add(e);
        return;
      }
      // A building with several weapons gets a turret for each; they share one texture.
      const tex = this.texture(`turret:${bp.id}`, (g) => drawTurretSprite(g, look, TEX));
      ts = anchors.map((a) => {
        const t = new Sprite(tex);
        t.anchor.set(0.5);
        t.position.set(a.x, a.y);
        s.addChild(t);
        return t;
      });
      this.turrets.set(e, ts);
    }
    let want = 0;
    let tracking = false;
    const aim = this.aimAt.get(e);
    if (aim) {
      if (now >= aim.until || !(this.sprites.has(aim.target) || this.flying.has(aim.target))) this.aimAt.delete(e);
      else {
        want = Math.atan2(this.tileX(aim.target) - this.tileX(e), this.tileY(e) - this.tileY(aim.target)) - s.rotation;
        tracking = true;
      }
    }
    // Nothing to shoot at: sweep slowly about, as if on watch (not with Reduce motion, and not while unseen or being built).
    const idle = !tracking && !reduceMotion() && s.visible && !this.state.world.store(Construction).has(e);
    for (const t of ts) {
      let goal = want;
      let rate = turn;
      if (idle) {
        let st = this.turretWatch.get(t);
        if (!st) this.turretWatch.set(t, (st = { goal: 0, next: 0 }));
        if (now >= st.next) {
          st.goal = (Math.random() * 2 - 1) * TURRET_SWEEP_RANGE;
          st.next = now + TURRET_SWEEP_MIN_MS + Math.random() * (TURRET_SWEEP_MAX_MS - TURRET_SWEEP_MIN_MS);
        }
        goal = st.goal;
        rate = turn * TURRET_SWEEP_SPEED;
      }
      const diff = Math.atan2(Math.sin(goal - t.rotation), Math.cos(goal - t.rotation));
      t.rotation += diff * rate;
    }
  }

  /** Spins the rotor of a wind turbine building: `step` is the angle for this frame, already scaled by the wind. */
  private spinRotor(e: number, s: Sprite, step: number): void {
    let rotor = this.rotors.get(e);
    if (!rotor) {
      if (this.noRotor.has(e)) return;
      const unit = this.state.world.store(Unit);
      const bp = unit.has(e) ? this.state.blueprints.get(unit.f.blueprint[e]) : undefined;
      if (!bp) return;
      const a = windAnchor(lookOf(bp.parts), TEX);
      if (!a) {
        this.noRotor.add(e);
        return;
      }
      rotor = new Sprite(this.texture(`rotor:${Math.round(a.radius * 10)}`, (g) => drawRotor(g, a.radius)));
      rotor.anchor.set(0.5);
      rotor.position.set(a.x, a.y);
      s.addChild(rotor);
      this.rotors.set(e, rotor);
    }
    rotor.rotation = (rotor.rotation + step) % (Math.PI * 2);
  }

  /** Keeps the drop shadow under a sprite: the same art in black, nudged away from the light; bigger things cast longer shadows. */
  private updateShadow(e: number, s: Sprite, k: number, dt: number): void {
    if (this.state.world.store(Resource).has(e)) return; // ore lies flat on the ground
    let sh = this.shadows.get(e);
    if (!sh) {
      sh = new Sprite(s.texture);
      sh.anchor.set(0.5);
      sh.tint = 0x000000;
      sh.alpha = SHADOW_ALPHA;
      this.shadowLift[e] = 0;
      this.shadowLayer.addChild(sh);
      this.shadows.set(e, sh);
    }
    sh.texture = s.texture;
    sh.visible = s.visible;
    let off = Math.max(s.texture.width, s.texture.height) * k * SHADOW_OFFSET;
    let grow = 1;
    let alpha = SHADOW_ALPHA;
    if (this.state.stats(e)?.flying) {
      // Airborne: the shadow slides away from the unit while it moves, and shrinks and fades as it climbs.
      const moving = Math.abs(this.curX[e] - this.prevX[e]) + Math.abs(this.curY[e] - this.prevY[e]) > 1e-4;
      const target = moving ? 1 : AIR_HOVER_LIFT;
      const lift = this.shadowLift[e] + (target - this.shadowLift[e]) * (1 - Math.exp(-dt * AIR_LIFT_RATE));
      this.shadowLift[e] = lift;
      off += Math.max(s.texture.width, s.texture.height) * k * AIR_SHADOW_LIFT * lift;
      grow = 1 - 0.18 * lift;
      alpha = SHADOW_ALPHA * (1 - 0.35 * lift);
    }
    sh.alpha = alpha;
    sh.position.set(s.x + off, s.y + off);
    sh.scale.set(k * grow);
    sh.rotation = s.rotation;
  }

  /** Blueprint info can arrive after units; re-skin everything (rare). */
  restyle(): void {
    const unit = this.state.world.store(Unit);
    for (const [e, s] of this.sprites) {
      if (unit.has(e)) s.texture = this.skin(e);
    }
    this.joinWalls();
  }

  /** The texture of a unit or building: walls pick the variant that matches the neighbours they join. */
  private skin(e: number): Texture {
    const unit = this.state.world.store(Unit);
    const bp = this.state.blueprints.get(unit.f.blueprint[e]);
    const owner = unit.f.owner[e];
    const look = bp && this.state.isStructure(e) ? lookOf(bp.parts) : undefined;
    if (!bp || !look || !isWall(look)) return this.unitTexture(bp, owner);
    const mask = this.wallMasks.get(e) ?? 0;
    return this.texture(`bp:${bp.id}:wall${mask}`, (g) => drawWall(g, look, ownerColour(owner), TEX, mask));
  }

  /**
   * Works out which buildings are walls and which of their sides touch another wall of the same owner,
   * then re-skins them. Runs when buildings change, not per frame.
   */
  private joinWalls(): void {
    this.wallVersion = this.state.structureVersion;
    const unit = this.state.world.store(Unit);
    const w = this.state.terrain.width;
    const cells = new Map<number, number>(); // tile -> owner
    const walls: number[] = [];
    this.wallMasks.clear();
    for (const e of unit.dense) {
      if (!this.state.isStructure(e)) continue;
      const bp = this.state.blueprints.get(unit.f.blueprint[e]);
      if (!bp || !isWall(lookOf(bp.parts))) continue;
      const f = this.state.footprint(e);
      for (let j = 0; j < f.size; j++) for (let i = 0; i < f.size; i++) cells.set((f.y + j) * w + f.x + i, unit.f.owner[e]);
      walls.push(e);
    }
    for (const e of walls) {
      const f = this.state.footprint(e);
      const owner = unit.f.owner[e];
      const touches = (x: number, y: number) => cells.get(y * w + x) === owner;
      let mask = 0;
      for (let k = 0; k < f.size; k++) {
        if (touches(f.x + k, f.y - 1)) mask |= WALL_N;
        if (touches(f.x + k, f.y + f.size)) mask |= WALL_S;
        if (touches(f.x - 1, f.y + k)) mask |= WALL_W;
        if (touches(f.x + f.size, f.y + k)) mask |= WALL_E;
      }
      // A diagonal join counts only where neither side next to that corner already joins.
      const x1 = f.x + f.size, y1 = f.y + f.size;
      if (!(mask & (WALL_N | WALL_E)) && touches(x1, f.y - 1)) mask |= WALL_NE;
      if (!(mask & (WALL_S | WALL_E)) && touches(x1, y1)) mask |= WALL_SE;
      if (!(mask & (WALL_S | WALL_W)) && touches(f.x - 1, y1)) mask |= WALL_SW;
      if (!(mask & (WALL_N | WALL_W)) && touches(f.x - 1, f.y - 1)) mask |= WALL_NW;
      this.wallMasks.set(e, mask);
      const s = this.sprites.get(e);
      if (s) s.texture = this.skin(e);
    }
  }

  // --- drawing -----------------------------------------------------------------

  private frame(): void {
    const now = performance.now();
    if (this.frameOwnBase && !this.state.spectating && this.frameBase()) this.frameOwnBase = false;
    this.layout();
    this.alpha = Math.min(1, (now - this.lastTickAt) / this.tickMs);
    const k = this.scale / TEX;
    const turn = 1 - Math.exp(-((now - (this.lastFrameAt || now)) / 1000) * 12);
    const spin = ((now - (this.lastFrameAt || now)) / 1000) * (this.state.wind / 100) * ROTOR_MAX_SPEED;
    const dt = (now - (this.lastFrameAt || now)) / 1000;
    this.lastFrameAt = now;
    for (const [e, s] of this.sprites) {
      this.spinDish(e, s, now);
      this.walk(e, s, now);
      this.aim(e, s, now, turn);
      this.spinRotor(e, s, spin);
      const p = this.screenOf(e);
      s.position.set(p.x, p.y);
      s.scale.set(k);
      const want = this.facing.get(e);
      if (want !== undefined) {
        // Shortest way round.
        const diff = Math.atan2(Math.sin(want - s.rotation), Math.cos(want - s.rotation));
        s.rotation += diff * turn;
      }
      this.updateShadow(e, s, k, dt);
    }
    this.glowsUsed = 0; // drawNight (spotlights) and drawGlows (fire) both add to the pool
    this.drawNight(now, k);
    this.drawChargeZones();
    this.drawLinks();
    this.drawFog();
    this.drawRadar();
    this.drawOverlay(now);
    this.drawGlows(now);
    this.drawDamageNumbers(now);
    this.drawBubbles(now);
    this.drawPowerLabels();
    this.drawGhost();
  }

  /**
   * Missiles in flight: a small rocket with a flame and a fading trail, drawn above a darker, smaller
   * copy on the ground that is the shadow. Bigger warheads make bigger missiles.
   */
  private drawMissiles(g: Graphics, now: number): void {
    this.launches = this.launches.filter((l) => now - l.born < LAUNCH_MS && this.sprites.has(l.e));
    for (const l of this.launches) {
      const p = this.screenOf(l.e);
      const age = (now - l.born) / LAUNCH_MS;
      g.circle(p.x, p.y, this.scale * (0.2 + 0.35 * age)).fill({ color: MISSILE_FLAME, alpha: 0.7 * (1 - age) });
    }

    const store = this.state.world.store(Missile);
    const lift = this.scale * MISSILE_LIFT;
    for (const e of this.flying) {
      if (!store.has(e)) continue;
      const p = this.screenOf(e);
      const angle = (store.f.heading[e] / 256) * Math.PI * 2;
      const len = this.scale * (0.15 + 0.1 * Math.sqrt(store.f.size[e]));
      const wid = len * 0.3;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      // Points are given along (forward, sideways) and turned to the heading.
      const at = (cx: number, cy: number, f: number, w: number): [number, number] => [cx + f * cos - w * sin, cy + f * sin + w * cos];
      const poly = (cx: number, cy: number, pts: number[], k = 1): number[] => {
        const out: number[] = [];
        for (let i = 0; i < pts.length; i += 2) out.push(...at(cx, cy, pts[i] * k, pts[i + 1] * k));
        return out;
      };
      const body = [len * 0.5, 0, len * 0.2, -wid / 2, -len * 0.5, -wid / 2, -len * 0.5, wid / 2, len * 0.2, wid / 2];

      g.poly(poly(p.x, p.y, body, 0.85)).fill({ color: 0x000000, alpha: 0.3 });

      const trail = this.trails.get(e);
      if (trail && trail.length >= 2) {
        const n = trail.length / 2;
        let px = this.offX + trail[0] * this.scale;
        let py = this.offY + trail[1] * this.scale - lift;
        for (let i = 1; i <= n; i++) {
          const x = i < n ? this.offX + trail[i * 2] * this.scale : p.x;
          const y = i < n ? this.offY + trail[i * 2 + 1] * this.scale - lift : p.y - lift;
          g.moveTo(px, py).lineTo(x, y).stroke({ width: Math.max(1.5, wid * 0.7), color: 0xe8edf5, alpha: 0.4 * (i / n) });
          px = x;
          py = y;
        }
      }

      const y = p.y - lift;
      const flame = len * (0.35 + 0.25 * Math.sin(now / 35 + e));
      g.poly(poly(p.x, y, [-len * 0.5, -wid * 0.3, -len * 0.5 - flame, 0, -len * 0.5, wid * 0.3])).fill(MISSILE_FLAME);
      for (const side of [-1, 1]) g.poly(poly(p.x, y, [-len * 0.5, side * wid * 0.5, -len * 0.75, side * wid * 1.1, -len * 0.2, side * wid * 0.5])).fill(0x8b95a5);
      g.poly(poly(p.x, y, body)).fill(MISSILE_BODY);
      g.poly(poly(p.x, y, [len * 0.5, 0, len * 0.2, -wid / 2, len * 0.2, wid / 2])).fill(ownerColour(store.f.owner[e]));
    }
  }

  /**
   * A tesla discharge: a ring of sparking charge races out from the coil to the edge of its range,
   * trailing jagged lightning arcs that crackle (re-rolled every TESLA_FLICKER_MS) and shed sparks.
   */
  private drawTesla(g: Graphics, p: Pulse, now: number): void {
    const range = this.state.stats(p.e)?.weapon?.range ?? 0;
    const c = this.screenOf(p.e);
    const age = (now - p.born) / PULSE_MS;
    const reach = (range / TILE) * this.scale;
    const front = reach * (1 - (1 - Math.min(1, age * 1.6)) ** 2); // the ring eases out and arrives at ~60% of the time
    const fade = 1 - age;
    const frame = Math.floor((now - p.born) / TESLA_FLICKER_MS);
    g.circle(c.x, c.y, front).fill({ color: p.colour, alpha: 0.12 * fade });
    g.circle(c.x, c.y, front).stroke({ width: 3, color: p.colour, alpha: 0.9 * fade });
    g.circle(c.x, c.y, front * 0.93).stroke({ width: 1.5, color: TESLA_CORE, alpha: 0.7 * fade });
    for (const b of p.bolts ?? []) {
      const dx = Math.cos(b.angle);
      const dy = Math.sin(b.angle);
      // The arc reaches as far as the ring has; sideways kicks grow with distance and shake each flicker.
      let px = c.x;
      let py = c.y;
      for (let i = 1; i <= TESLA_SEGMENTS; i++) {
        const along = (i / TESLA_SEGMENTS) * front;
        const kick = (i === TESLA_SEGMENTS ? 0.4 : 1) * crackle(b.seed, i, frame) * this.scale * 0.45;
        const x = c.x + dx * along - dy * kick;
        const y = c.y + dy * along + dx * kick;
        g.moveTo(px, py).lineTo(x, y);
        px = x;
        py = y;
      }
      g.stroke({ width: 2.5, color: p.colour, alpha: 0.55 * fade });
      px = c.x;
      py = c.y;
      for (let i = 1; i <= TESLA_SEGMENTS; i++) {
        const along = (i / TESLA_SEGMENTS) * front;
        const kick = (i === TESLA_SEGMENTS ? 0.4 : 1) * crackle(b.seed, i, frame) * this.scale * 0.45;
        const x = c.x + dx * along - dy * kick;
        const y = c.y + dy * along + dx * kick;
        g.moveTo(px, py).lineTo(x, y);
        px = x;
        py = y;
      }
      g.stroke({ width: 1, color: TESLA_CORE, alpha: 0.9 * fade });
      // A spark flies off the tip.
      const sx = c.x + dx * front + crackle(b.seed, 77, frame) * this.scale * 0.25;
      const sy = c.y + dy * front + crackle(b.seed, 78, frame) * this.scale * 0.25;
      g.circle(sx, sy, Math.max(1.5, this.scale * 0.07)).fill({ color: 0xffffff, alpha: fade });
    }
  }

  /** Radar contacts fade out over RADAR_FADE_TICKS; each pulse also sends out a quick ring. */
  private drawRadar(): void {
    if (this.radarLayer.children.length === 0) this.radarLayer.addChild(this.radarGfx);
    const g = this.radarGfx.clear();
    const s = this.state;
    s.pruneRadar(RADAR_FADE_TICKS);
    const now = s.tick + this.alpha;
    for (const r of s.radarRings) {
      const age = (now - r.born) / 12;
      if (age < 0 || age > 1) continue;
      g.circle(this.offX + (r.x / TILE) * this.scale, this.offY + (r.y / TILE) * this.scale, (r.range / TILE) * this.scale * age).stroke({
        width: 2,
        color: 0x7fffd4,
        alpha: 0.6 * (1 - age),
      });
    }
    let used = 0;
    for (const b of s.radarBlips) {
      const fade = 1 - (now - b.born) / RADAR_FADE_TICKS;
      if (fade <= 0) continue;
      const x = this.offX + (b.x / TILE) * this.scale;
      const y = this.offY + (b.y / TILE) * this.scale;
      const size = Math.max(4, this.scale * (b.structure ? 0.9 : 0.5));
      const colour = ownerColour(b.owner);
      // The contact's real art, faded, so it reads as the unit itself rather than a dot.
      const bp = this.state.blueprints.get(b.blueprint);
      if (bp) {
        let sprite = this.radarSprites[used];
        if (!sprite) {
          sprite = new Sprite();
          sprite.anchor.set(0.5);
          this.radarSprites.push(sprite);
          this.radarLayer.addChild(sprite);
        }
        used++;
        sprite.visible = true;
        sprite.texture = this.unitTexture(bp, b.owner);
        sprite.position.set(x, y);
        sprite.scale.set(this.scale / TEX);
        sprite.alpha = fade * 0.8;
      }
      if (b.structure) g.rect(x - size / 2, y - size / 2, size, size).stroke({ width: 2, color: colour, alpha: fade });
      else g.circle(x, y, size / 2).fill({ color: colour, alpha: fade * 0.9 }).stroke({ width: 1, color: 0xffffff, alpha: fade * 0.5 });
    }
    for (let i = used; i < this.radarSprites.length; i++) this.radarSprites[i].visible = false;
  }

  private drawGhost(): void {
    const p = this.view.placement;
    this.ghost.visible = p !== null && p.line.length === 0;
    this.drawLineGhosts(p);
    if (!p) return;
    this.ghost.texture = this.unitTexture(p.bp, p.bp.owner);
    const size = p.bp.stats.footprint;
    this.ghost.position.set(this.offX + (p.x + size / 2) * this.scale, this.offY + (p.y + size / 2) * this.scale);
    this.ghost.scale.set(this.scale / TEX);
    this.ghost.tint = p.valid ? 0xffffff : 0xff6060;
  }

  /** One ghost per spot of a dragged line of buildings. */
  private drawLineGhosts(p: Placement | null): void {
    const spots = p?.line ?? [];
    for (let i = 0; i < Math.max(spots.length, this.lineGhosts.length); i++) {
      let s = this.lineGhosts[i];
      if (i >= spots.length) {
        if (s) s.visible = false;
        continue;
      }
      if (!s) {
        s = new Sprite();
        s.anchor.set(0.5);
        s.alpha = 0.55;
        this.lineGhosts.push(s);
        this.app.stage.addChild(s);
      }
      const size = p!.bp.stats.footprint;
      s.visible = true;
      s.texture = this.unitTexture(p!.bp, p!.bp.owner);
      s.position.set(this.offX + (spots[i].x + size / 2) * this.scale, this.offY + (spots[i].y + size / 2) * this.scale);
      s.scale.set(this.scale / TEX);
      s.tint = spots[i].valid ? 0xffffff : 0xff6060;
    }
  }

  /** Ghosted (dashed) lines from a building being placed to the buildings its power links would reach. */
  private drawGhostLinks(g: Graphics): void {
    const p = this.view.placement;
    if (!p) return;
    const size = p.bp.stats.footprint;
    const from = { x: this.offX + (p.x + size / 2) * this.scale, y: this.offY + (p.y + size / 2) * this.scale };
    for (const e of this.state.linksFor(p.x, p.y, size, p.bp.stats.linkRange)) {
      const to = this.screenOf(e);
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      const dx = (to.x - from.x) / length;
      const dy = (to.y - from.y) / length;
      for (let d = 0; d < length; d += DASH + DASH_GAP) {
        const end = Math.min(length, d + DASH);
        g.moveTo(from.x + dx * d, from.y + dy * d).lineTo(from.x + dx * end, from.y + dy * end);
      }
      g.circle(to.x, to.y, 3);
    }
    g.stroke({ width: 1.5, color: ENERGY_COLOUR, alpha: p.valid ? 0.75 : 0.35 });
  }

  /**
   * Where own units gain energy: a faint green disc around each working charging
   * building (plus the one being placed, if it charges). Overlaps are flattened by
   * the layer's alpha filter, so stacked pads don't get darker.
   */
  private drawChargeZones(): void {
    const p = this.view.placement;
    const ghost = p && p.bp.stats.chargeRate > 0 ? `${p.bp.id}@${p.x},${p.y}` : '';
    const key = `${this.laidOutFor}|${this.state.structureVersion}|${ghost}`;
    if (key === this.zonesDrawnFor) return;
    this.zonesDrawnFor = key;
    const g = this.zoneLayer.clear();
    const zone = (cx: number, cy: number, footprint: number) =>
      g.circle(this.offX + cx * this.scale, this.offY + cy * this.scale, (chargeZoneRadius(footprint) / TILE) * this.scale);
    for (const e of this.state.world.store(Unit).dense) {
      if (!this.state.isMine(e) || this.state.isSite(e)) continue;
      const s = this.state.stats(e);
      if (!s?.structure || s.chargeRate <= 0) continue;
      const f = this.state.footprint(e); // from replicated state: the sprite may not be synced yet
      zone(f.x + f.size / 2, f.y + f.size / 2, s.footprint);
    }
    if (p && ghost) zone(p.x + p.bp.stats.footprint / 2, p.y + p.bp.stats.footprint / 2, p.bp.stats.footprint);
    g.fill(CHARGE_ZONE_COLOUR);
  }

  /**
   * Day and night: the map dims towards a deep blue as daylight falls (a multiply over the units and
   * ground, under the fog and interface), and once it is dim units switch their lights on: ground units
   * get two headlight beams, flying ones red/green nav lights and a white strobe.
   */
  private drawNight(now: number, k: number): void {
    const sun = this.state.daylight;
    const dark = 1 - sun / 100;
    const night = this.nightLayer;
    night.visible = dark > 0.01;
    const g = this.lightLayer.clear();
    this.spotsUsed = 0;
    if (!night.visible) {
      for (let i = 0; i < this.beams.length; i++) this.beams[i].visible = false;
      this.hideSpots();
      return;
    }
    // Blend white -> NIGHT_TINT by how dark it is (a channel at a time, no allocation).
    const mix = (c: number) => Math.round(255 + (c - 255) * dark * NIGHT_DEPTH);
    const nr = mix((NIGHT_TINT >> 16) & 255), ng = mix((NIGHT_TINT >> 8) & 255), nb = mix(NIGHT_TINT & 255);
    night.tint = (nr << 16) | (ng << 8) | nb;
    night.width = this.app.screen.width;
    night.height = this.app.screen.height;
    // Headlights are drawn under the vehicles, so the night multiply dims them too: pre-brighten each channel to cancel it.
    const lift = (beam: number, night: number) => Math.min(255, Math.round((beam * 255) / Math.max(night, 1)));
    this.beamTint = (lift((BEAM_COLOUR >> 16) & 255, nr) << 16) | (lift((BEAM_COLOUR >> 8) & 255, ng) << 8) | lift(BEAM_COLOUR & 255, nb);
    this.spotTint = (lift((SPOT_COLOUR >> 16) & 255, nr) << 16) | (lift((SPOT_COLOUR >> 8) & 255, ng) << 8) | lift(SPOT_COLOUR & 255, nb);
    const beamScale = (this.scale * BEAM_LENGTH) / BEAM_LAMP_Y;
    let used = 0;
    if (sun >= LIGHTS_ON_BELOW) {
      for (let i = 0; i < this.beams.length; i++) this.beams[i].visible = false;
      this.hideSpots();
      return;
    }
    const glow = Math.min(1, (LIGHTS_ON_BELOW - sun) / (LIGHTS_ON_BELOW - LIGHTS_FULL_BELOW));
    const unit = this.state.world.store(Unit);
    const construction = this.state.world.store(Construction);
    const w = this.app.screen.width, h = this.app.screen.height;
    const strobe = reduceMotion() || now % STROBE_MS < 110;
    for (const [e, s] of this.sprites) {
      if (!s.visible || !unit.has(e)) continue;
      const stats = this.state.stats(e);
      if (!stats) continue;
      if (s.x < -80 || s.y < -80 || s.x > w + 80 || s.y > h + 80) continue;
      const half = (Math.max(s.texture.width, s.texture.height) * k) / 2;
      // A lamp on each gun, turning with it (also on turret buildings).
      const guns = this.turrets.get(e);
      if (guns && !construction.has(e)) {
        const cs = Math.cos(s.rotation), sn = Math.sin(s.rotation);
        for (let i = 0; i < guns.length; i++) {
          const t = guns[i];
          const a = s.rotation + t.rotation;
          const b = this.beamSprite(used++);
          // At the turret's centre of rotation; the beam layer is under the units, so it shines out from beneath the gun.
          b.position.set(s.x + (t.x * cs - t.y * sn) * k, s.y + (t.x * sn + t.y * cs) * k);
          b.rotation = a;
          b.scale.set(beamScale * GUN_LAMP_LENGTH);
          b.alpha = glow * GUN_LAMP_ALPHA;
        }
      }
      if (stats.structure) {
        // Interior light spilling out: soft warm rings round the footprint, fainter outwards. Not while still being built.
        if (construction.has(e) || this.wallMasks.has(e)) continue; // a wall has no windows
        this.buildingLight(g, s.x, s.y, stats, glow);
        continue;
      }
      // The art's nose points up at rotation 0.
      const fx = Math.sin(s.rotation), fy = -Math.cos(s.rotation);
      const rx = -fy, ry = fx;
      if (stats.flying) {
        const wing = half * 0.8;
        const dot = Math.max(1.5, this.scale * 0.07);
        this.navLight(g, s.x - rx * wing, s.y - ry * wing, NAV_PORT, dot, glow);
        this.navLight(g, s.x + rx * wing, s.y + ry * wing, NAV_STARBOARD, dot, glow);
        if (strobe) this.navLight(g, s.x - fx * half * 0.8, s.y - fy * half * 0.8, 0xffffff, dot, glow);
        // A spotlight shining down: a few overlapping glows from the craft to the ground (where its shadow falls),
        // each wider and fainter than the last, so the light spreads and thins with altitude.
        const off = half * 2 * (SHADOW_OFFSET + AIR_SHADOW_LIFT * this.shadowLift[e]);
        const flying = Math.max(0, Math.min(1, (this.shadowLift[e] - AIR_HOVER_LIFT) / (1 - AIR_HOVER_LIFT)));
        const far = this.scale * (SPOT_MIN_RADIUS + (SPOT_MAX_RADIUS - SPOT_MIN_RADIUS) * flying), near = far * 0.3;
        for (let i = 0; i < SPOT_STEPS; i++) {
          const t = i / (SPOT_STEPS - 1);
          this.spot(s.x + off * t, s.y + off * t, near + (far - near) * t, SPOT_ALPHA * glow * (1 - 0.75 * t));
        }
        continue;
      }
      const lamps = this.lampsOf(unit.f.blueprint[e]);
      for (let i = 0; i < lamps.length; i++) {
        const lamp = lamps[i];
        const b = this.beamSprite(used++);
        b.position.set(s.x + fx * half * 0.75 + rx * half * lamp.side, s.y + fy * half * 0.75 + ry * half * lamp.side);
        b.rotation = s.rotation;
        b.scale.set(beamScale * (0.7 + 0.3 * lamp.power));
        b.alpha = glow * lamp.power;
      }
    }
    for (let i = used; i < this.beams.length; i++) this.beams[i].visible = false;
    this.hideSpots();
  }

  /** Adds one soft round spotlight glow (radius in pixels) under the units for this frame. */
  private spot(x: number, y: number, radius: number, alpha: number): void {
    if (alpha < 0.01 || radius < 1 || this.spotsUsed >= SPOT_CAP) return;
    if (x + radius < 0 || y + radius < 0 || x - radius > this.app.screen.width || y - radius > this.app.screen.height) return;
    let sp = this.spots[this.spotsUsed];
    if (!sp) {
      sp = new Sprite(this.glowTexture);
      sp.anchor.set(0.5);
      sp.blendMode = 'add';
      this.beamLayer.addChild(sp);
      this.spots[this.spotsUsed] = sp;
    }
    this.spotsUsed++;
    sp.visible = true;
    sp.position.set(x, y);
    sp.scale.set((radius * 2) / GLOW_SIZE);
    sp.tint = this.spotTint;
    sp.alpha = Math.min(1, alpha);
  }

  private hideSpots(): void {
    for (let i = this.spotsUsed; i < this.spots.length; i++) this.spots[i].visible = false;
  }

  /** The headlights of a unit's body type, looked up once per design. */
  private lampsOf(blueprint: number): readonly Lamp[] {
    let lamps = this.lamps.get(blueprint);
    if (!lamps) {
      const bp = this.state.blueprints.get(blueprint);
      if (!bp) return headlampsOf([]); // class info not here yet: do not cache
      lamps = headlampsOf(bp.parts);
      this.lamps.set(blueprint, lamps);
    }
    return lamps;
  }

  /** A pooled headlight sprite (soft additive beam with spill), shown and tinted for the current frame. */
  private beamSprite(i: number): Sprite {
    let b = this.beams[i];
    if (!b) {
      b = new Sprite(this.beamTexture);
      b.anchor.set(0.5, BEAM_LAMP_Y / BEAM_H);
      b.blendMode = 'add';
      this.beamLayer.addChild(b);
      this.beams[i] = b;
    }
    b.visible = true;
    b.tint = this.beamTint;
    return b;
  }

  /**
   * Interior light spilling out of a finished building: soft warm rings round its outline, fainter outwards.
   * A square building gets rounded rings sized to its drawn art (a one-tile building is small, a bigger one
   * leaves a margin); a shaped one (L, T, +, U, H) gets them round its own cells, with rounded outer corners
   * and no overlap between cells, so the light follows the walls instead of a bounding square.
   */
  private buildingLight(g: Graphics, cx: number, cy: number, stats: { footprint: number; shape: readonly string[] | null }, glow: number): void {
    const sc = this.scale;
    const spill = sc * WINDOW_SPILL;
    const shape = stats.shape;
    if (!shape) {
      const half = buildingHalf(stats.footprint, sc);
      for (let ring = 0; ring < 3; ring++) {
        const grow = spill * (1 - ring / 3);
        g.roundRect(cx - half - grow, cy - half - grow, (half + grow) * 2, (half + grow) * 2, half * 0.5 + grow).fill({ color: WINDOW_COLOUR, alpha: 0.05 * glow });
      }
      g.roundRect(cx - half * 0.85, cy - half * 0.85, half * 1.7, half * 1.7, half * 0.4).fill({ color: WINDOW_COLOUR, alpha: 0.08 * glow });
      return;
    }
    const n = shape.length;
    const margin = sc - buildingHalf(2, sc); // the gap the art leaves on an outside edge
    const x0 = cx - (n * sc) / 2;
    const y0 = cy - (n * sc) / 2;
    const covered = (i: number, j: number) => i >= 0 && j >= 0 && j < n && shape[j]?.[i] === 'X';
    for (let ring = 0; ring < 4; ring++) {
      const grow = ring === 3 ? 0 : spill * (1 - ring / 3);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          if (!covered(i, j)) continue;
          const up = !covered(i, j - 1), down = !covered(i, j + 1), left = !covered(i - 1, j), right = !covered(i + 1, j);
          const inset = ring === 3 ? margin * 1.8 : margin; // the last pass is the brighter core
          const l = x0 + i * sc + (left ? inset : 0), r = x0 + (i + 1) * sc - (right ? inset : 0);
          const t = y0 + j * sc + (up ? inset : 0), b = y0 + (j + 1) * sc - (down ? inset : 0);
          if (grow === 0) {
            g.rect(l, t, r - l, b - t);
            continue;
          }
          // Strips on the outside edges, and a quarter disc on each outside corner so the outline rounds off.
          if (up) g.rect(l, t - grow, r - l, grow);
          if (down) g.rect(l, b, r - l, grow);
          if (left) g.rect(l - grow, t, grow, b - t);
          if (right) g.rect(r, t, grow, b - t);
          if (up && left) g.moveTo(l, t).arc(l, t, grow, Math.PI, Math.PI * 1.5).closePath();
          if (up && right) g.moveTo(r, t).arc(r, t, grow, Math.PI * 1.5, Math.PI * 2).closePath();
          if (down && right) g.moveTo(r, b).arc(r, b, grow, 0, Math.PI * 0.5).closePath();
          if (down && left) g.moveTo(l, b).arc(l, b, grow, Math.PI * 0.5, Math.PI).closePath();
        }
      }
      g.fill({ color: WINDOW_COLOUR, alpha: (ring === 3 ? 0.08 : 0.05) * glow });
    }
  }

  /** A small glowing lamp with a soft halo. */
  private navLight(g: Graphics, x: number, y: number, colour: number, dot: number, glow: number): void {
    g.circle(x, y, dot * 3).fill({ color: colour, alpha: 0.18 * glow });
    g.circle(x, y, dot).fill({ color: colour, alpha: 0.95 * glow });
  }

  /** Adds one soft round light (radius in pixels) for this frame from the pool; off-screen ones are skipped. */
  private glow(x: number, y: number, radius: number, colour: number, alpha: number): void {
    if (alpha < 0.01 || radius < 1 || this.glowsUsed >= GLOW_CAP) return;
    if (x + radius < 0 || y + radius < 0 || x - radius > this.app.screen.width || y - radius > this.app.screen.height) return;
    let s = this.glows[this.glowsUsed];
    if (!s) {
      s = new Sprite(this.glowTexture);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      this.glowLayer.addChild(s);
      this.glows[this.glowsUsed] = s;
    }
    this.glowsUsed++;
    s.visible = true;
    s.position.set(x, y);
    s.scale.set((radius * 2) / GLOW_SIZE);
    s.tint = colour;
    s.alpha = Math.min(1, alpha);
  }

  /**
   * The light that fire throws: blasts light up their surroundings (the radius follows the blast), guns
   * flash at the muzzle and at the point they hit (bigger guns, bigger flash), missile launches flare, and
   * a flying missile's engine glows. Strongest at night, still a hint by day.
   */
  private drawGlows(now: number): void {
    const level = 0.35 + 0.65 * (1 - this.state.daylight / 100);
    const sc = this.scale;
    for (const x of this.explosions) {
      const t = (now - x.born) / x.ms;
      const cx = this.offX + x.x * sc, cy = this.offY + x.y * sc;
      const r = Math.max(1, x.radius) * sc;
      this.glow(cx, cy, r * (3.4 - 0.8 * t), EXPLOSION_LIGHT, 0.9 * level * (1 - t) ** 1.6);
      const flash = Math.max(0, 1 - t / 0.25);
      this.glow(cx, cy, r * 1.6, 0xffffff, 0.8 * level * flash);
    }
    for (const s of this.shots) {
      const age = (now - s.born) / SHOT_MS;
      const w = this.state.stats(s.a)?.weapon;
      const size = Math.min(1.6, 0.35 + 0.07 * Math.sqrt(w?.damage ?? 4));
      const colour = w?.kind === 'laser' ? s.colour : MUZZLE_LIGHT;
      const a = this.screenOf(s.a), b = this.screenOf(s.b);
      this.glow(a.x, a.y, size * sc, colour, 0.8 * level * (1 - age) ** 2);
      this.glow(b.x, b.y, size * 0.7 * sc, colour, 0.6 * level * (1 - age));
    }
    for (const l of this.launches) {
      const age = (now - l.born) / LAUNCH_MS;
      const p = this.screenOf(l.e);
      this.glow(p.x, p.y, sc * (1.2 + 0.6 * age), MISSILE_FLAME, 0.85 * level * (1 - age));
    }
    const missiles = this.state.world.store(Missile);
    for (const e of this.flying) {
      if (!missiles.has(e)) continue;
      const p = this.screenOf(e);
      const angle = (missiles.f.heading[e] / 256) * Math.PI * 2;
      const len = sc * (0.15 + 0.1 * Math.sqrt(missiles.f.size[e]));
      const flicker = 0.85 + 0.15 * Math.sin(now / 35 + e);
      // The engine sits at the tail, lifted above the shadow like the missile.
      this.glow(p.x - Math.cos(angle) * len * 0.5, p.y - sc * MISSILE_LIFT - Math.sin(angle) * len * 0.5, (0.6 + 0.12 * Math.sqrt(missiles.f.size[e])) * sc * flicker, MISSILE_FLAME, 0.7 * level);
    }
    for (const p of this.pulses) {
      const age = (now - p.born) / PULSE_MS;
      const range = this.state.stats(p.e)?.weapon?.range ?? 0;
      const c = this.screenOf(p.e);
      this.glow(c.x, c.y, Math.min(3, Math.max(1, (range / TILE) * 0.3)) * sc, p.colour, 0.8 * level * (1 - age) ** 2);
    }
    for (let i = this.glowsUsed; i < this.glows.length; i++) this.glows[i].visible = false;
  }

  /** Darkens tiles out of view: lightly where seen before, heavily where never seen. */
  private drawFog(): void {
    const key = `${this.laidOutFor}|${this.state.fog}|${this.state.visionVersion}`;
    if (key === this.fogDrawnFor) return;
    this.fogDrawnFor = key;
    const g = this.fogLayer.clear();
    const v = this.state.vision;
    const { width, height } = this.state.terrain;
    if (!this.state.fog || v.length !== width * height) return;
    for (const [level, alpha] of [[1, 0.35], [0, 0.65]] as const) {
      for (let y = 0; y < height; y++) {
        let x = 0;
        while (x < width) {
          if (v[y * width + x] !== level) {
            x++;
            continue;
          }
          const start = x;
          while (x < width && v[y * width + x] === level) x++;
          // Pixel-snapped edges: neighbouring rows meet exactly, since an overlap would double the translucent fill into a visible seam.
          const left = Math.round(this.offX + start * this.scale);
          const top = Math.round(this.offY + y * this.scale);
          g.rect(left, top, Math.round(this.offX + x * this.scale) - left, Math.round(this.offY + (y + 1) * this.scale) - top);
        }
      }
      g.fill({ color: 0x05070a, alpha });
    }
  }

  /** Redraw links (e.g. when network reports arrive). */
  highlightNetwork(): void {
    this.linksDrawnFor = '';
  }

  /** Power links; the network of a selected own building is drawn brighter. */
  private drawLinks(): void {
    const sel = [...this.view.selection].find((e) => this.state.isMine(e) && this.state.isStructure(e));
    const net = sel === undefined ? undefined : this.state.networkOf(sel);
    const key = `${this.laidOutFor}|${this.state.structureVersion}|${net?.members.join(',') ?? ''}`;
    if (key === this.linksDrawnFor) return;
    this.linksDrawnFor = key;
    const g = this.linkLayer.clear();
    const unit = this.state.world.store(Unit);
    const members = new Set(net?.members);
    for (const [a, b] of this.state.links) {
      const pa = this.screenOf(a);
      const pb = this.screenOf(b);
      const lit = members.has(a);
      // Width follows zoom so links stay readable zoomed out and don't turn into bars zoomed in.
      const width = Math.min(4, Math.max(1.5, this.scale * 0.1)) * (lit ? 1.5 : 1);
      g.moveTo(pa.x, pa.y)
        .lineTo(pb.x, pb.y)
        .stroke({ width, color: lit ? 0xfff2a8 : ownerColour(unit.f.owner[a]), alpha: lit ? 0.8 : 0.4, cap: 'round' });
    }
  }

  private drawOverlay(now: number): void {
    const g = this.overlay.clear();
    const { world } = this.state;
    const unit = world.store(Unit);
    const health = world.store(Health);
    const energy = world.store(EnergyView);

    // Power flowing along links, away from the network's sources; the more energy, the faster.
    const dotR = Math.max(1.5, this.scale * 0.09);
    const dt = Math.min(0.25, (now - this.lastFlowFrame) / 1000);
    this.lastFlowFrame = now;
    const phases = new Map<string, number>();
    const loads = new Map<string, number>();
    for (const { from, to, amount } of this.state.flows) {
      if (!this.sprites.has(from) || !this.sprites.has(to)) continue;
      const id = `${from}-${to}`;
      let load: number | null = null;
      if (amount !== null) {
        const before = this.flowLoad.get(id) ?? amount;
        load = before + (amount - before) * Math.min(1, dt * FLOW_EASE);
        if (load < 0.05 && amount <= 0) continue; // nothing moving
        loads.set(id, load);
      }
      const a = this.screenOf(from);
      const b = this.screenOf(to);
      const lengthTiles = Math.hypot(b.x - a.x, b.y - a.y) / this.scale;
      const dots = Math.max(1, Math.round(lengthTiles / FLOW_SPACING));
      const phase = ((this.flowPhase.get(id) ?? 0) + (dt * flowSpeed(load)) / Math.max(lengthTiles, 0.5)) % 1;
      phases.set(id, phase);
      for (let k = 0; k < dots; k++) {
        const t = (phase + k / dots) % 1;
        g.circle(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, dotR).fill({ color: ENERGY_COLOUR, alpha: 0.85 });
      }
    }

    this.flowPhase.clear();
    for (const [id, phase] of phases) this.flowPhase.set(id, phase);
    this.flowLoad.clear();
    for (const [id, load] of loads) this.flowLoad.set(id, load);

    // Construction progress on your sites.
    const sites = world.store(Construction);
    for (const e of sites.dense) {
      if (!this.state.isMine(e)) continue;
      const p = this.screenOf(e);
      const w = (this.state.stats(e)?.footprint ?? 1) * this.scale * 0.8;
      const y = p.y + w / 2 + 3;
      g.rect(p.x - w / 2, y, w, 3).fill(0x222a35);
      g.rect(p.x - w / 2, y, (w * sites.f.progress[e]) / 100, 3).fill(0x4fd1c5);
    }

    // Footprint for a blueprint being placed.
    const placing = this.view.placement;
    if (placing) {
      const size = placing.bp.stats.footprint;
      const colour = placing.valid ? 0x5bd68a : 0xff6b5b;
      const shape = placing.bp.stats.shape;
      const spots = placing.line.length ? placing.line : [{ x: placing.x, y: placing.y, valid: placing.valid }];
      for (const spot of spots) {
        const c = spot.valid ? 0x5bd68a : 0xff6b5b;
        for (let j = 0; j < size; j++) {
          for (let i = 0; i < size; i++) {
            if (shape && shape[j][i] !== 'X') continue;
            g.rect(this.offX + (spot.x + i) * this.scale, this.offY + (spot.y + j) * this.scale, this.scale, this.scale)
              .fill({ color: c, alpha: 0.15 })
              .stroke({ width: 1.5, color: c });
          }
        }
      }
      const reach = placing.bp.stats.linkRange;
      g.rect(
        this.offX + (placing.x - reach) * this.scale,
        this.offY + (placing.y - reach) * this.scale,
        (size + 2 * reach) * this.scale,
        (size + 2 * reach) * this.scale,
      ).stroke({ width: 1, color: ENERGY_COLOUR, alpha: 0.35 });
      this.drawGhostLinks(g);
    }

    // Factory progress, harvester cargo and low-energy warnings for your own things.
    const prod = world.store(Production);
    const fxNow = performance.now();
    for (const e of prod.dense) {
      if (prod.f.queued[e] === 0) continue;
      // Everyone who can see a factory sees it working (see factoryFx.ts).
      const fp = this.screenOf(e);
      const size = (this.state.stats(e)?.footprint ?? 1) * this.scale;
      drawFactoryFx(g, fp.x, fp.y, size, prod.f.progress[e], fxNow, ownerColour(this.state.world.store(Unit).f.owner[e]), e, reduceMotion(), this.factoryParts(e));
    }
    for (const e of prod.dense) {
      if (!this.state.isMine(e) || prod.f.queued[e] === 0) continue;
      const p = this.screenOf(e);
      const w = (this.state.stats(e)?.footprint ?? 1) * this.scale * 0.8;
      const y = p.y + w / 2 + 3;
      g.rect(p.x - w / 2, y, w, 3).fill(0x222a35);
      g.rect(p.x - w / 2, y, (w * prod.f.progress[e]) / 100, 3).fill(0xf5c542);
    }
    const cargo = world.store(Cargo);
    for (const e of cargo.dense) {
      if (!this.state.isMine(e) || cargo.f.amount[e] === 0) continue;
      const p = this.screenOf(e);
      g.circle(p.x + this.scale * 0.35, p.y - this.scale * 0.35, Math.max(2, this.scale * 0.12)).fill(RESOURCE_COLOUR);
    }
    for (const e of energy.dense) {
      if (!this.state.isMine(e) || energy.f.pct[e] >= 20 || this.state.isStructure(e)) continue;
      const p = this.screenOf(e);
      g.circle(p.x - this.scale * 0.35, p.y - this.scale * 0.35, Math.max(2, this.scale * 0.12)).fill(0xff9f43);
    }

    // Routes: with many units selected, shared legs and waypoints are drawn once and
    // each unit's own first leg fades, so a big group doesn't become a hairball.
    const routed = [...this.view.selection].filter((e) => this.sprites.has(e) && this.state.isMine(e));
    const crowd = routed.length > CROWD_ROUTES;
    const drawn = new Set<string>();
    for (const e of routed) this.drawRoute(g, e, crowd, drawn);

    // Health bars on anything damaged (selected things get theirs below).
    const barH = Math.min(5, Math.max(2.5, this.scale * 0.1));
    for (const e of health.dense) {
      if (this.view.selection.has(e) || !this.sprites.has(e)) continue;
      const s = this.state.stats(e);
      if (!s || health.f.hp[e] >= s.hp || this.state.isSite(e)) continue;
      const p = this.screenOf(e);
      const half = s.structure ? (s.footprint * this.scale) / 2 : Math.max(6, this.scale * Math.max(0.45, (s.radius / TILE) * 1.1));
      const w = Math.max(14, half * 1.6);
      const y = p.y - half - barH - 3;
      g.rect(p.x - w / 2, y, w, barH).fill({ color: 0x3a1d1d, alpha: 0.8 });
      g.rect(p.x - w / 2, y, (w * Math.max(0, health.f.hp[e])) / s.hp, barH).fill({ color: healthColour(health.f.hp[e] / s.hp), alpha: 0.8 });
    }

    for (const e of this.view.selection) {
      if (!this.sprites.has(e)) continue;
      const p = this.screenOf(e);
      const s = this.state.stats(e);
      const mine = this.state.isMine(e);
      const ringColour = !unit.has(e) ? RESOURCE_COLOUR : mine ? 0x5bd68a : 0xff6b5b;
      const half = s?.structure ? (s.footprint * this.scale) / 2 + 2 : Math.max(6, this.scale * Math.max(0.55, ((s?.radius ?? 0) / TILE) * 1.3));
      if (s?.structure) g.rect(p.x - half, p.y - half, half * 2, half * 2).stroke({ width: 1.5, color: ringColour });
      else g.circle(p.x, p.y, half).stroke({ width: 1.5, color: ringColour });
      if (health.has(e) && s) {
        // Bars grow with zoom (within limits) and sit just above the ring.
        const w = Math.max(16, half * 1.6);
        const showEnergy = energy.has(e) && mine;
        const y = p.y - half - (showEnergy ? barH * 2 + 4 : barH + 3);
        g.rect(p.x - w / 2, y, w, barH).fill(0x3a1d1d);
        g.rect(p.x - w / 2, y, (w * Math.max(0, health.f.hp[e])) / s.hp, barH).fill(healthColour(health.f.hp[e] / s.hp));
        if (showEnergy) {
          g.rect(p.x - w / 2, y + barH + 1, w, barH * 0.8).fill(0x2e2a1a);
          g.rect(p.x - w / 2, y + barH + 1, (w * energy.f.pct[e]) / 100, barH * 0.8).fill(ENERGY_COLOUR);
        }
      }
    }

    this.pulses = this.pulses.filter((p) => now - p.born < PULSE_MS && this.sprites.has(p.e));
    for (const p of this.pulses) this.drawTesla(g, p, now);

    this.chargePulses = this.chargePulses.filter((p) => now - p.born < CHARGE_PULSE_MS && this.sprites.has(p.e));
    for (const p of this.chargePulses) {
      const c = this.screenOf(p.e);
      const footprint = this.state.stats(p.e)?.footprint ?? 1;
      const age = (now - p.born) / CHARGE_PULSE_MS;
      const full = (chargeZoneRadius(footprint) / TILE) * this.scale;
      const r = full * (0.15 + 0.85 * (1 - (1 - age) * (1 - age))); // eases out to the edge of the charge zone
      const fade = (1 - age) * Math.min(1, age * 8);
      g.circle(c.x, c.y, r).fill({ color: p.colour, alpha: 0.12 * fade });
      g.circle(c.x, c.y, r).stroke({ width: Math.max(2, this.scale * 0.1), color: p.colour, alpha: 0.7 * fade });
    }

    this.buildSparks = this.buildSparks.filter((x) => !buildSparksDone(x, now));
    for (const x of this.buildSparks) drawBuildSparks(g, x, now, this.offX, this.offY, this.scale);

    this.explosions = this.explosions.filter((x) => now - x.born < x.ms);
    for (const x of this.explosions) this.drawExplosion(g, x, now);
    landShrapnel(this.shrapnel, now, this.landFragment);
    drawShrapnel(g, this.shrapnel, now, this.offX, this.offY, this.scale);
    expireSparks(this.sparks, now);
    drawSparks(g, this.sparks, now, this.offX, this.offY, this.scale);

    this.drawMissiles(g, now);

    this.shots = this.shots.filter((s) => now - s.born < SHOT_MS && this.sprites.has(s.a) && this.sprites.has(s.b));
    for (const s of this.shots) {
      const a = this.screenOf(s.a);
      const b = this.screenOf(s.b);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: s.colour, alpha: 1 - (now - s.born) / SHOT_MS });
    }

    this.drawRepairs(g, now);
    this.drawBuildBeams(g, now);

    const pings = this.view.pings;
    for (let i = pings.length - 1; i >= 0; i--) {
      const age = (now - pings[i].born) / PING_MS;
      if (age >= 1) {
        pings.splice(i, 1);
        continue;
      }
      g.circle(pings[i].x, pings[i].y, 4 + 8 * age).stroke({ width: 1.5, color: pings[i].colour, alpha: 1 - age });
    }

    const drag = this.view.orderPath;
    if (drag && drag.path.length > 1) {
      g.moveTo(drag.path[0].x, drag.path[0].y);
      for (const p of drag.path) g.lineTo(p.x, p.y);
      g.stroke({ width: 2, color: 0x5bd68a, alpha: 0.7 });
      for (const s of drag.stops) g.circle(s.x, s.y, 4).fill({ color: 0x5bd68a, alpha: 0.9 }).stroke({ width: 1, color: 0xffffff, alpha: 0.8 });
    }

    const band = this.view.band;
    if (band) {
      const x = Math.min(band.x0, band.x1);
      const y = Math.min(band.y0, band.y1);
      g.rect(x, y, Math.abs(band.x1 - band.x0), Math.abs(band.y1 - band.y0))
        .fill({ color: 0x5bd68a, alpha: 0.08 })
        .stroke({ width: 1, color: 0x5bd68a, alpha: 0.8 });
    }
  }

  /**
   * Path lines from the unit through every queued task, routed with the same pathfinder
   * as the server. `drawn` collects legs and waypoints already drawn for other units.
   */
  private drawRoute(g: Graphics, e: number, crowd: boolean, drawn: Set<string>): void {
    const route = this.routeFor(e);
    if (!route) return;
    const px = (t: number) => this.offX + t * this.scale;
    const py = (t: number) => this.offY + t * this.scale;
    route.segments.forEach((seg, i) => {
      const colour = TASK_COLOURS[seg.type] ?? 0xffffff;
      const pts = seg.points;
      const n = pts.length;
      const end = `${seg.type}@${Math.floor(pts[n - 2])},${Math.floor(pts[n - 1])}`;
      // Legs between waypoints are often shared by the whole group: draw each once.
      const leg = `${Math.floor(pts[0])},${Math.floor(pts[1])}>${end}`;
      if (i === 0 || !drawn.has(leg)) {
        drawn.add(leg);
        g.moveTo(px(pts[0]), py(pts[1]));
        for (let k = 2; k < n; k += 2) g.lineTo(px(pts[k]), py(pts[k + 1]));
        g.stroke({ width: crowd && i === 0 ? 1 : 1.5, color: colour, alpha: crowd && i === 0 ? 0.25 : 0.7 });
      }
      if (!drawn.has(end)) {
        drawn.add(end);
        g.circle(px(pts[n - 2]), py(pts[n - 1]), 3).fill({ color: colour, alpha: 0.9 });
      }
    });
  }

  /**
   * Repair beams look unlike weapon fire: a soft green ribbon with bright dots running
   * from the repairer to the target, a breathing ring on the target, and little crosses
   * rising from it (the classic "healing" glyph).
   */
  /** A thrown fragment comes down: a small blast, usually, and always a few sparks. */
  private landFragment = (s: Shrapnel): void => {
    const now = performance.now();
    if (this.explosions.length < MAX_EXPLOSIONS && Math.random() < 0.6) this.explosions.push(makeExplosion(s.tx, s.ty, SHRAPNEL_BLAST_RADIUS, now));
    burstSparks(this.sparks, s.tx, s.ty, 4 + Math.floor(Math.random() * 5), now, {
      colour: SHRAPNEL_SPARK_COLOURS[Math.floor(Math.random() * SHRAPNEL_SPARK_COLOURS.length)],
      reach: [0.15, 0.5],
      ms: [200, 420],
    });
  };

  /** Flash, fireball, shockwaves, sparks, debris and smoke; every motion eases out. */
  private drawExplosion(g: Graphics, x: Explosion, now: number): void {
    const t = (now - x.born) / x.ms;
    const out = 1 - (1 - t) ** 3;
    const cx = this.offX + x.x * this.scale;
    const cy = this.offY + x.y * this.scale;
    const R = x.radius * this.scale;

    // Light: a bright flash in the first moments, then a warm glow that fades with the fireball.
    const flash = Math.max(0, 1 - t / 0.2);
    if (flash > 0) {
      g.circle(cx, cy, R * 2.6).fill({ color: 0xffd27a, alpha: 0.14 * flash });
      g.circle(cx, cy, R * 1.7).fill({ color: 0xffe9a8, alpha: 0.3 * flash });
      g.circle(cx, cy, R * 0.9).fill({ color: 0xffffff, alpha: 0.85 * flash });
    }
    const glow = (1 - t) ** 2;
    g.circle(cx, cy, R * 2.2).fill({ color: 0xff7a1a, alpha: 0.1 * glow });
    g.circle(cx, cy, R * 1.4).fill({ color: 0xff9a2e, alpha: 0.14 * glow });

    // Smoke: dark puffs that drift up and swell once the fireball dies back.
    const smokeT = Math.max(0, (t - 0.15) / 0.85);
    if (smokeT > 0) {
      const ease = 1 - (1 - smokeT) ** 2;
      for (const f of x.smoke) {
        const d = R * f.reach * ease;
        const px = cx + Math.cos(f.angle) * d;
        const py = cy + Math.sin(f.angle) * d - R * 0.6 * ease;
        g.circle(px, py, R * f.size * (0.5 + ease)).fill({ color: 0x2a2d33, alpha: 0.4 * (1 - smokeT) });
      }
    }

    // Fireball: hot core inside an orange body, shrinking in brightness as it grows.
    const body = R * (0.25 + 0.55 * out);
    g.circle(cx, cy, body).fill({ color: 0xff8a1f, alpha: 0.55 * (1 - t) });
    g.circle(cx, cy, body * 0.6).fill({ color: 0xffd36a, alpha: 0.7 * (1 - t) ** 1.5 });

    // Shockwaves: the original red ring, plus a thin fast white one ahead of it.
    g.circle(cx, cy, R * (0.2 + 0.8 * out)).fill({ color: EXPLOSION_COLOUR, alpha: 0.2 * (1 - t) });
    g.circle(cx, cy, R * (0.2 + 0.8 * out)).stroke({ width: 3, color: EXPLOSION_COLOUR, alpha: 1 - t });
    g.circle(cx, cy, R * (0.3 + 1.2 * out)).stroke({ width: 1.5, color: 0xffffff, alpha: 0.6 * (1 - t) ** 2 });

    // Sparks: bright streaks flung outwards, cooling from yellow to orange.
    for (const f of x.sparks) {
      const head = R * f.reach * out;
      const tail = R * f.reach * Math.max(0, out - 0.18);
      const cos = Math.cos(f.angle);
      const sin = Math.sin(f.angle);
      g.moveTo(cx + cos * tail, cy + sin * tail)
        .lineTo(cx + cos * head, cy + sin * head)
        .stroke({ width: f.size, color: t < 0.4 ? 0xfff2a0 : 0xff9a2e, alpha: (1 - t) ** 1.5 });
    }

    // Debris: dark chunks that arc outwards and fall back under gravity.
    for (const f of x.debris) {
      const d = R * f.reach * out;
      const px = cx + Math.cos(f.angle) * d;
      const py = cy + Math.sin(f.angle) * d + R * 0.5 * t * t;
      g.circle(px, py, f.size).fill({ color: t < 0.3 ? 0xffb347 : 0x3b3f47, alpha: 1 - t * t });
    }
  }

  /**
   * Build beams are a continuous laser, unlike shots (instant lines) and repair (dots):
   * a thin cyan beam from the build arm to a point that rasters back and forth across the
   * site's footprint, with a faint scan line left across the building at that row.
   */
  private drawBuildBeams(g: Graphics, now: number): void {
    for (const [key, r] of this.buildBeams) {
      if (now - r.last > BUILD_BEAM_MS || !this.sprites.has(r.a) || !this.sprites.has(r.b)) {
        this.buildBeams.delete(key);
        continue;
      }
      const a = this.screenOf(r.a);
      const f = this.state.footprint(r.b);
      const fade = 1 - (now - r.last) / BUILD_BEAM_MS;
      const unit = this.scale;
      const left = this.offX + f.x * unit;
      const top = this.offY + f.y * unit;
      const size = f.size * unit;
      const rowY = top + size * (0.05 + 0.9 * pingPong(now + r.b * 137, 1800));
      const hitX = left + size * (0.05 + 0.9 * pingPong(now * 1.0 + r.a * 71, 420));
      // Scan line across the site at the current row.
      g.moveTo(left, rowY).lineTo(left + size, rowY).stroke({ width: Math.max(1.5, unit * 0.05), color: BUILD_BEAM_COLOUR, alpha: 0.45 * fade });
      // Beam: wide soft glow, bright core.
      g.moveTo(a.x, a.y).lineTo(hitX, rowY).stroke({ width: Math.max(4, unit * 0.2), color: BUILD_BEAM_COLOUR, alpha: 0.14 * fade });
      g.moveTo(a.x, a.y).lineTo(hitX, rowY).stroke({ width: Math.max(1.5, unit * 0.06), color: 0xe8fbff, alpha: 0.9 * fade });
      // Hot spot where the beam lands, and a glint on the emitter.
      g.circle(hitX, rowY, Math.max(3, unit * 0.14)).fill({ color: BUILD_BEAM_COLOUR, alpha: 0.35 * fade });
      g.circle(hitX, rowY, Math.max(1.5, unit * 0.06)).fill({ color: 0xffffff, alpha: fade });
      g.circle(a.x, a.y, Math.max(2, unit * 0.09)).fill({ color: BUILD_BEAM_COLOUR, alpha: 0.7 * fade });
    }
  }

  private drawRepairs(g: Graphics, now: number): void {
    for (const [key, r] of this.repairs) {
      if (now - r.last > REPAIR_MS || !this.sprites.has(r.a) || !this.sprites.has(r.b)) {
        this.repairs.delete(key);
        continue;
      }
      const a = this.screenOf(r.a);
      const b = this.screenOf(r.b);
      const fade = 1 - (now - r.last) / REPAIR_MS;
      const unit = this.scale; // pixels per tile
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: Math.max(2, unit * 0.12), color: REPAIR_COLOUR, alpha: 0.18 * fade });
      const dots = 5;
      for (let k = 0; k < dots; k++) {
        const f = (((now / 600) + k / dots) % 1);
        g.circle(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, Math.max(1.5, unit * 0.07)).fill({ color: 0xffffff, alpha: 0.85 * fade });
      }
      const breathe = 0.5 + 0.5 * Math.sin(now / 90);
      g.circle(b.x, b.y, unit * (0.45 + 0.1 * breathe)).stroke({ width: 1.5, color: REPAIR_COLOUR, alpha: (0.5 + 0.3 * breathe) * fade });
      const arm = Math.max(2, unit * 0.1);
      for (let k = 0; k < 3; k++) {
        const f = ((now / 700) + k / 3) % 1;
        const x = b.x + Math.sin(k * 2.4 + r.b) * unit * 0.3;
        const y = b.y - unit * 0.2 - f * unit * 0.8;
        const alpha = Math.sin(f * Math.PI) * fade;
        g.moveTo(x - arm, y).lineTo(x + arm, y).stroke({ width: Math.max(1.5, unit * 0.06), color: REPAIR_COLOUR, alpha });
        g.moveTo(x, y - arm).lineTo(x, y + arm).stroke({ width: Math.max(1.5, unit * 0.06), color: REPAIR_COLOUR, alpha });
      }
    }
  }

  private routeFor(e: number): Route | undefined {
    const tasks = this.state.tasks.get(e);
    if (!tasks || tasks.length === 0) return undefined;
    const flying = this.state.stats(e)?.flying ?? false;
    const mobility = this.state.stats(e) ?? WHEELS;
    const ux = this.tileX(e);
    const uy = this.tileY(e);
    // Resolve each task's destination (targets may move).
    const dests: { type: number; x: number; y: number }[] = [];
    for (let i = 0; i < tasks.length; i += 4) {
      const [type, x, y, target] = tasks.slice(i, i + 4);
      if (type === TaskType.Stop || type === TaskType.None) continue;
      if (target >= 0 && this.sprites.has(target)) dests.push({ type, x: this.curX[target], y: this.curY[target] });
      else dests.push({ type, x: x + 0.5, y: y + 0.5 });
    }
    const key = `${Math.floor(ux)},${Math.floor(uy)}|${dests.map((d) => `${d.type}:${Math.floor(d.x)},${Math.floor(d.y)}`).join(';')}|${this.state.terrain.version}|${flying}`;
    const cached = this.routes.get(e);
    if (cached?.key === key) {
      // Keep the first segment glued to the moving unit.
      if (cached.segments.length) {
        cached.segments[0].points[0] = ux;
        cached.segments[0].points[1] = uy;
      }
      return cached;
    }
    const segments: Route['segments'] = [];
    let fx = ux;
    let fy = uy;
    for (const d of dests) {
      const points = [fx, fy];
      if (!flying) {
        const tiles = findPath(this.state.terrain, Math.floor(fx), Math.floor(fy), Math.floor(d.x), Math.floor(d.y), mobility);
        for (let i = 0; i < tiles.length - 2; i += 2) points.push(tiles[i] + 0.5, tiles[i + 1] + 0.5);
      }
      points.push(d.x, d.y);
      segments.push({ type: d.type, points });
      fx = d.x;
      fy = d.y;
    }
    const route = { key, segments };
    this.routes.set(e, route);
    return route;
  }

  private layout(): void {
    const { width, height } = this.app.screen;
    const t = this.state.terrain;
    const key = `${width}x${height}:${t.width}x${t.height}:${this.state.seed}:${this.zoom}:${this.camX}:${this.camY}`;
    if (key === this.laidOutFor) return;
    this.scale = this.fitScale() * this.zoom;
    // Centred when the map fits; otherwise clamped to the edges, allowing half a screen of overscroll (the map edge can reach the middle of the view).
    const clamp = (c: number, extent: number, screen: number) => {
      const half = screen / 2 / this.scale;
      if (Number.isNaN(c) || half * 2 >= extent) return extent / 2;
      const over = half;
      return Math.min(extent - half + over, Math.max(half - over, c));
    };
    this.camX = clamp(this.camX, t.width, width);
    this.camY = clamp(this.camY, t.height, height);
    this.offX = width / 2 - this.camX * this.scale;
    this.offY = height / 2 - this.camY * this.scale;
    this.laidOutFor = `${width}x${height}:${t.width}x${t.height}:${this.state.seed}:${this.zoom}:${this.camX}:${this.camY}`;

    const g = this.backdrop.clear();
    g.rect(this.offX, this.offY, t.width * this.scale, t.height * this.scale).fill(0x161c24);
    for (let x = 0; x <= t.width; x += 8) {
      g.moveTo(this.offX + x * this.scale, this.offY).lineTo(this.offX + x * this.scale, this.offY + t.height * this.scale);
    }
    for (let y = 0; y <= t.height; y += 8) {
      g.moveTo(this.offX, this.offY + y * this.scale).lineTo(this.offX + t.width * this.scale, this.offY + y * this.scale);
    }
    g.stroke({ width: 1, color: 0x222a35, alpha: 0.6 });
    // Rock is painted over the grid so the lines only show on open ground. Outer (convex) corners are
    // rounded: a corner is rounded where both of its sides face tiles outside the shape being filled.
    const rad = this.scale * 0.23;
    const PI = Math.PI;
    const open = (x: number, y: number) => t.isPassable(x, y);
    const fillShape = (inShape: (x: number, y: number) => boolean) => {
      for (let y = 0; y < t.height; y++) {
        for (let x = 0; x < t.width; x++) {
          if (!inShape(x, y)) continue;
          const up = !inShape(x, y - 1);
          const down = !inShape(x, y + 1);
          const lf = !inShape(x - 1, y);
          const rt = !inShape(x + 1, y);
          const l = this.offX + x * this.scale;
          const top = this.offY + y * this.scale;
          const r = l + this.scale + 0.5;
          const b = top + this.scale + 0.5;
          const tl = up && lf ? rad : 0;
          const tr = up && rt ? rad : 0;
          const br = down && rt ? rad : 0;
          const bl = down && lf ? rad : 0;
          if (!(tl || tr || br || bl)) {
            g.rect(l, top, this.scale + 0.5, this.scale + 0.5);
            continue;
          }
          g.moveTo(l + tl, top).lineTo(r - tr, top);
          if (tr) g.arc(r - tr, top + tr, tr, -PI / 2, 0);
          g.lineTo(r, b - br);
          if (br) g.arc(r - br, b - br, br, 0, PI / 2);
          g.lineTo(l + bl, b);
          if (bl) g.arc(l + bl, b - bl, bl, PI / 2, PI);
          g.lineTo(l, top + tl);
          if (tl) g.arc(l + tl, top + tl, tl, PI, PI * 1.5);
          g.closePath();
        }
      }
    };
    fillShape((x, y) => !open(x, y));
    g.fill(0x343b47);

    // Rock height (the terrain's height map: 1 at an outcrop's rim, higher inside it, cliffs high from
    // the edge) shown as lighter tiers. The map edge counts as solid.
    fillShape((x, y) => t.heightAt(x, y) >= 2);
    g.fill(0x414a58);
    fillShape((x, y) => t.heightAt(x, y) >= 3);
    g.fill(0x4d5767);
    fillShape((x, y) => t.heightAt(x, y) >= 5);
    g.fill(0x596476);

    // Only the sides of solid tiles that face open ground are outlined, so walls read as shapes, not a grid.
    const s = this.scale;
    for (let y = 0; y < t.height; y++) {
      for (let x = 0; x < t.width; x++) {
        if (open(x, y)) continue;
        const up = open(x, y - 1);
        const down = open(x, y + 1);
        const lf = open(x - 1, y);
        const rt = open(x + 1, y);
        const l = this.offX + x * s;
        const top = this.offY + y * s;
        const r = l + s;
        const b = top + s;
        const tl = up && lf ? rad : 0;
        const tr = up && rt ? rad : 0;
        const br = down && rt ? rad : 0;
        const bl = down && lf ? rad : 0;
        if (up) g.moveTo(l + tl, top).lineTo(r - tr, top);
        if (down) g.moveTo(l + bl, b).lineTo(r - br, b);
        if (lf) g.moveTo(l, top + tl).lineTo(l, b - bl);
        if (rt) g.moveTo(r, top + tr).lineTo(r, b - br);
        if (tl) g.moveTo(l, top + tl).arc(l + tl, top + tl, tl, PI, PI * 1.5);
        if (tr) g.moveTo(r - tr, top).arc(r - tr, top + tr, tr, -PI / 2, 0);
        if (br) g.moveTo(r, b - br).arc(r - br, b - br, br, 0, PI / 2);
        if (bl) g.moveTo(l + bl, b).arc(l + bl, b - bl, bl, PI / 2, PI);
      }
    }
    g.stroke({ width: Math.max(1.5, s * 0.12), color: 0x8a9bb5, alpha: 0.9, cap: 'square' });
    // Cliffs: rock already CLIFF_HEIGHT high at its edge gets a heavier, warmer rim, so players see where only colossus legs climb.
    for (let y = 0; y < t.height; y++) {
      for (let x = 0; x < t.width; x++) {
        if (t.heightAt(x, y) < CLIFF_HEIGHT) continue;
        const l = this.offX + x * s;
        const top = this.offY + y * s;
        if (open(x, y - 1)) g.moveTo(l, top).lineTo(l + s, top);
        if (open(x, y + 1)) g.moveTo(l, top + s).lineTo(l + s, top + s);
        if (open(x - 1, y)) g.moveTo(l, top).lineTo(l, top + s);
        if (open(x + 1, y)) g.moveTo(l + s, top).lineTo(l + s, top + s);
      }
    }
    g.stroke({ width: Math.max(2, s * 0.2), color: 0xc8b48c, alpha: 0.85, cap: 'square' });
  }

  private ensureSprite(e: number, tex: Texture, parent: Container = this.layer): Sprite {
    let s = this.sprites.get(e);
    if (!s) {
      s = new Sprite(tex);
      s.anchor.set(0.5);
      parent.addChild(s);
      this.sprites.set(e, s);
    } else {
      s.texture = tex;
    }
    return s;
  }

  /** One texture per blueprint, shared by every sprite of that class. */
  private unitTexture(bp: Blueprint | undefined, owner: number): Texture {
    return this.texture(bp ? `bp:${bp.id}` : `owner:${owner}`, (g) => this.drawClass(g, bp?.parts, owner));
  }

  /**
   * Preview of a design that may not exist yet (the designer), drawn with the
   * same art as in-game sprites, at `pxPerTile` pixels per map tile.
   * `owner` picks the team colour (default: the local player).
   */
  async previewImage(parts: readonly string[], pxPerTile: number, owner = this.state.myId): Promise<string> {
    return renderClassImage(this.app.renderer, parts, ownerColour(owner), () => pxPerTile / TEX);
  }

  /** Class art in texture space (TEX pixels per tile). */
  private drawClass(g: Graphics, parts: readonly string[] | undefined, owner: number): void {
    const colour = ownerColour(owner);
    if (!parts) g.rect(-0.2 * TEX, -0.2 * TEX, 0.4 * TEX, 0.4 * TEX).fill(colour);
    else drawLook(g, lookOf(parts), colour, TEX);
  }

  /**
   * A cluster of faceted shards on a patch of disturbed ground. The patch is only drawn (it has no
   * collision), and it is baked into the same texture so a field costs one sprite per node. `stage` is how
   * much is left: 4 full down to 0 nearly spent (one small shard), or -1 for a spent node (bare patch).
   */
  private resourceTexture(stage: number): Texture {
    return this.texture(`resource.${stage}`, (g) => {
      const rich = Math.max(0, stage) / 4; // 0 .. 1
      // Deterministic wobble, so every node (and every reload) looks the same.
      const wob = (a: number, k: number) => Math.sin(a * 3 + k) * 0.5 + Math.sin(a * 5 + k * 2.3) * 0.3 + Math.sin(a * 2 + k * 0.7) * 0.2;
      // The patch is a slab: a square with chamfered corners and slightly uneven sides, to match the square-ish art.
      const blob = (half: number, k: number): number[] => {
        const top = half * (1 + 0.08 * wob(0, k)), right = half * (1 + 0.08 * wob(1, k)), bottom = half * (1 + 0.08 * wob(2, k)), left = half * (1 + 0.08 * wob(3, k));
        const c = half * 0.2;
        return [-left + c, -top, right - c, -top, right, -top + c, right, bottom - c, right - c, bottom, -left + c, bottom, -left, bottom - c, -left, -top + c];
      };
      /** Spreads index `i` over a square instead of a disc: a point at "radius" `rr` (Chebyshev distance) at the golden angle. */
      const onSquare = (i: number, rr: number): [number, number] => {
        const a = i * 2.399963;
        const cx = Math.cos(a), cy = Math.sin(a);
        const m = Math.max(Math.abs(cx), Math.abs(cy));
        return [(cx / m) * rr, (cy / m) * rr];
      };
      g.poly(blob(1.3 * TEX, 0)).fill({ color: RESOURCE_COLOUR, alpha: 0.02 + 0.03 * rich });
      g.poly(blob(0.95 * TEX, 1.7)).fill({ color: RESOURCE_COLOUR, alpha: 0.03 + 0.04 * rich }).stroke({ width: 1, color: RESOURCE_COLOUR, alpha: 0.08 + 0.08 * rich });
      // Faint ripples and grit: the ground looks cracked and lit from below around the crystals. The ripples are
      // square corner brackets (some corners missing), the grit small squares.
      for (let ring = 0; ring < (stage >= 3 ? 3 : stage >= 1 ? 2 : 1); ring++) {
        const rad = (0.55 + ring * 0.27) * TEX;
        for (let i = 0; i < 4; i++) {
          if ((i + ring) % 4 === 3) continue; // a gap in the pattern
          const sx = i % 2 === 0 ? -1 : 1, sy = i < 2 ? -1 : 1;
          const rr = rad * (1 + 0.06 * wob(i, ring + 3));
          const arm = (0.22 + 0.08 * Math.sin(i * 2 + ring)) * TEX;
          g.moveTo(sx * rr, sy * (rr - arm)).lineTo(sx * rr, sy * rr).lineTo(sx * (rr - arm), sy * rr).stroke({ width: 1, color: RESOURCE_COLOUR, alpha: 0.18 - ring * 0.04 });
        }
      }
      for (let i = 0; i < 8 + Math.round(14 * rich); i++) {
        const [gx, gy] = onSquare(i, (0.5 + 0.75 * ((i * 0.618) % 1)) * TEX);
        const sz = 1.2 + (i % 3) * 0.6;
        g.rect(gx - sz / 2, gy - sz / 2, sz, sz).fill({ color: i % 4 === 0 ? 0xffffff : RESOURCE_COLOUR, alpha: 0.22 });
      }
      // Shards: a base dark, one lit facet and a white edge, like the other parts' two-tone hulls. Tallest last.
      const shard = (ax: number, ay: number, angle: number, len: number, wid: number) => {
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const px = -dy;
        const py = dx;
        const tipX = ax + dx * len;
        const tipY = ay + dy * len;
        const lx = ax + px * wid;
        const ly = ay + py * wid;
        const rx = ax - px * wid;
        const ry = ay - py * wid;
        const mx = ax + dx * len * 0.35;
        const my = ay + dy * len * 0.35;
        g.poly([lx, ly, mx + px * wid * 1.15, my + py * wid * 1.15, tipX, tipY, mx - px * wid * 1.15, my - py * wid * 1.15, rx, ry]).fill(0x2a8f6c);
        g.poly([lx, ly, mx + px * wid * 1.15, my + py * wid * 1.15, tipX, tipY, ax, ay]).fill(RESOURCE_COLOUR);
        g.poly([ax, ay, tipX, tipY, mx - px * wid * 1.15, my - py * wid * 1.15, rx, ry]).fill(0x4fbf93);
        g.poly([lx, ly, mx + px * wid * 1.15, my + py * wid * 1.15, tipX, tipY, mx - px * wid * 1.15, my - py * wid * 1.15, rx, ry]).stroke({ width: 1.2, color: 0xffffff, alpha: 0.45 });
        g.moveTo(ax, ay).lineTo(tipX, tipY).stroke({ width: 0.8, color: 0xffffff, alpha: 0.3 });
      };
      // Mined out shard by shard: the small outer ones go first, the tall centre one is last, and what is left shrinks.
      const u = TEX * (0.7 + 0.3 * rich);
      const shards: [number, number, number, number, number][] = [
        [-0.12, -0.04, 2.7, 0.27, 0.08],
        [0.02, 0.12, 1.35, 0.26, 0.08],
        [0.12, 0.1, -0.5, 0.36, 0.1],
        [-0.1, 0.08, -2.6, 0.34, 0.09],
        [0, 0.04, -1.45, 0.5, 0.13],
      ];
      // Small sub-crystals sprouting across the patch: the ones nearest the cluster stay longest, so the field empties from the edges in.
      const subs = stage < 0 ? 0 : [3, 7, 11, 15, 19][stage];
      for (let i = 0; i < subs; i++) {
        const t = i / 19;
        const [sx, sy] = onSquare(i + 0.25, (0.42 + 0.7 * t + 0.05 * wob(i, 5)) * TEX);
        const size = (0.17 - 0.06 * t + 0.03 * wob(i, 2)) * TEX;
        shard(sx, sy, i * 2.399963 + 0.6 + 1.9 * Math.sin(i * 1.3 + 1), size, size * 0.3);
      }
      if (stage >= 0) for (const [x, y, a, l, w] of shards.slice(4 - stage)) shard(x * u, y * u, a, l * u, w * u);
      if (stage >= 0) g.circle(0, -0.3 * u * (stage === 0 ? 0.5 : 1), 1.6).fill({ color: 0xffffff, alpha: 0.7 });
    });
  }

  private texture(key: string, draw: (g: Graphics) => void): Texture {
    let tex = this.textures.get(key);
    if (tex) return tex;
    const g = new Graphics();
    draw(g);
    tex = this.app.renderer.generateTexture({ target: g, resolution: TEX_RESOLUTION });
    g.destroy();
    this.textures.set(key, tex);
    return tex;
  }

  private ensureCapacity(n: number): void {
    if (this.curX.length >= n) return;
    const grow = (a: Float32Array) => {
      const b = new Float32Array(n);
      b.set(a);
      return b;
    };
    this.prevX = grow(this.prevX);
    this.prevY = grow(this.prevY);
    this.curX = grow(this.curX);
    this.curY = grow(this.curY);
    this.shadowLift = grow(this.shadowLift);
  }
}
