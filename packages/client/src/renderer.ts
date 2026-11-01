import type { DevGlow, EffectSinks } from './devEffects';
import { drawShot, SHOT_LIFE_MS, shotKindOf, shotPower, type ShotKind } from './beams';
import { ARC_REACH, drawDischarge, flickerFrame, hopStrength, makeDischarge, type Hop } from './discharge';
import { drawBlast, energyRadius, hasBatteryPart, makeBlast, SHIELD_IMPLODE, shieldRadius, type Blast, type BlastKind } from './blasts';
import { buildSparksDone, drawBuildSparks, makeBuildSparks, type BuildSparks } from './buildSparks';
import {
  Cargo,
  Construction,
  CpuState,
  CpuStatus,
  EnergyView,
  Debris,
  Feature,
  FeatureKind,
  findPath,
  Health,
  Missile,
  Flame,
  FLAME_LIFE_STEPS,
  Shell,
  Aim,
  Shield,
  Light,
  Smoke,
  Charge,
  Modules,
  Position,
  Production,
  Resource,
  ResourcePatch,
  SimEvent,
  TaskType,
  TICK_RATE,
  LIGHTNING_RADIUS,
  CLIFF_HEIGHT,
  WHEELS,
  chargeZoneRadius,
  RADAR_FADE_TICKS,
  LIGHT_TILES_PER_ENERGY,
  RESOURCE_PATCH_AMOUNT,
  Sky,
  TILE,
  Unit,
  type Blueprint,
  type Terrain,
  type TickInfo,
} from '@wst/engine';
import { AlphaFilter, Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { buildingHalf, dishAnchor, drawDish, drawLook, drawRotor, drawTurretSprite, drawWall, factoryAnchor, GAIT_FRAMES, gaitLength, headlampsOf, isWall, lookOf, turretAnchors, WALL_E, WALL_N, WALL_NE, WALL_NW, WALL_S, WALL_SE, WALL_SW, WALL_W, windAnchor, type Lamp, type Look } from './art';
import { contourSegments } from './contours';
import { buildLiquids, type Liquids, type Loop } from './liquids';
import { DEBRIS_VARIANTS, debrisStage, drawDebris } from './debris';
import { drawFactoryFx, type FactoryParts } from './factoryFx';
import { drawScenery, drawVent, drawVentSteam, SCENERY_VARIANTS } from './features';
import { BEAM_H, BEAM_LAMP_Y, GLOW_SIZE, lampDaylight, lampLevel, makeBeamTexture, makeGlowTexture, makeMistTexture, mixColour } from './lights';
import { unit as hash01 } from './precipitation';
import { fogImage } from './fogmap';
import { Precipitation, type SkyProbe } from './precipitation';
import { flashesAllowed, flickerAllowed, reduceMotion, weatherDetail } from './settings';
import { BEAM_RAYS, BeamHeadings, beamReach, drawBeam } from './spotBeam';
import { arcIntersections, drawBloom, drawShield, easeAngle, easeBy, FLASH_MS, MAX_CROSSING_BLOOMS, MAX_FLASHES, MAX_INTERFERING, shieldLevel, type ShieldDraw, type ShieldFlash } from './shields';
import { burstSparks, drawSparks, expireSparks, type Spark } from './sparks';
import { drawIonHold, drawRailBeam, drawRailCharge, drawSmokeCloud, RAIL_BEAM_MS, SMOKE_SWELL_MS } from './weaponFx';
import { buildField, CrystalDust, DUST_PER_TILE, dustMask, FIELD_SKIRT, glowPoints, scatterShards, type CrystalField, type Shards } from './crystalField';
import { DAMAGE_SMOKE_BELOW, drawDamage, drawFire, drawFireball, MAX_TONGUES, fireStrength, flicker, FIRE_LIGHT, FIRE_YELLOW, lobHeight } from './flames';
import { landWrecks, wreckFireMs, wreckFlameSize, wreckThrowsFragments, MAX_WRECKS, shouldCrash, SMOKE_EVERY_MS, startWreck, wreckGround, wreckHeight, wreckProgress, wreckRotation, type Wreck } from './wrecks';
import { drawShrapnel, emberChance, emberLife, landShrapnel, throwShrapnel, type Shrapnel } from './shrapnel';
import { renderClassImage, TEX, TEX_RESOLUTION } from './artstudio';
import type { ClientState } from './state';

/** Textures are drawn at this many pixels per tile, then scaled to the current zoom. */
const OWNER_COLOURS = [0x8a8f98, 0x4ea1ff, 0xff6b5b, 0x5bd68a, 0xf5c542, 0xc77dff, 0x4fd1c5, 0xff9f43];
const RESOURCE_COLOUR = 0x7ee0b5;
/** Sparks off a resource being mined: bright, with a few white-hot. */
/** Fire thrown off by a falling wreck. */
const WRECK_SPARK_COLOURS = [0xff9a2e, 0xffe08a, 0xff6a1a];
const HARVEST_SPARK_COLOURS = [0xc8ffe6, 0x7ee0b5, 0xffffff, 0xfff0a8];
const BREAK_SPARK_COLOUR = 0xffb066;
/** Cannon shells: the dot, its streak, and the sparks of a glancing blow or an impact. */
const SHELL_COLOUR = 0xfff2c0;
const SHELL_SPARK_COLOURS = [0xffe08a, 0xffb347, 0xffffff];
/** Sparks thrown off an energy shield that stops a hit: cool and bright. */
const SHIELD_SPARK_COLOURS = [0xbfe9ff, 0xffffff, 0x8fd0ff];
/** Where two shields cross, and at an emitter under strain, sparks are thrown this often (ms) and in these numbers. */
const SHIELD_STRAIN_MS = 55;
const CROSSING_SPARKS = 5;
const EMITTER_SPARKS_PER_CROSSING = 3;
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
const GUN_LAMP_LENGTH = 0.6;
const GUN_LAMP_ALPHA = 0.5;
/** Radians per second of a wind turbine rotor in the strongest wind. */
const ROTOR_MAX_SPEED = 9;
const ENERGY_COLOUR = 0xf5c542;
/** The line along the edge of explored ground while placing a building. */
const EXPLORED_EDGE_COLOUR = 0x5bd68a;
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
const PULSE_MS = 600;
/** Arcs per tesla discharge and the most hops in each. */
const TESLA_CHAINS = 6;
const TESLA_HOPS = 5;
const TESLA_CORE = 0xf3eaff;
/** The most units and buildings a discharge may jump to (the nearest ones). */
const DISCHARGE_TARGETS = 24;
/** The light a live hop of a discharge throws: its radius in tiles (a hit lights more), and its alpha. */
const HOP_LIGHT_RADIUS = 1.3;
const HOP_LIGHT_HIT_RADIUS = 2;
const HOP_LIGHT_ALPHA = 0.7;
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
/** Lamps switch on (with a flicker) once daylight falls below this, a little after the glow starts to fade in. */
const LAMPS_SWITCH_BELOW = LIGHTS_ON_BELOW - 0.15 * (LIGHTS_ON_BELOW - LIGHTS_FULL_BELOW);
/** Headlight beam length in tiles, and its warm colour. */
const BEAM_LENGTH = 2.4;
const BEAM_COLOUR = 0xfff0c0;
/** Mist wisps: how many, their pale colour, the alpha of each at full mist, their radius range in tiles (they are wider than tall) and their drift in tiles per second (the wind adds to it). */
const MIST_WISPS = 44;
const MIST_WISP_COLOUR = 0xe9eff2;
const MIST_WISP_ALPHA = 0.16;
const MIST_WISP_RADIUS = 4.5;
const MIST_WISP_STRETCH = 1.7;
const MIST_WISP_DRIFT = 0.12;
/** The halo a light throws on the mist: its radius is the light's times this, and its alpha is the light's times this and the thickness of the mist (at most HALO_MAX_ALPHA). At most HALO_CAP are drawn a frame. */
const HALO_RADIUS = 2.6;
const HALO_ALPHA = 0.55;
const HALO_MAX_ALPHA = 0.45;
const HALO_CAP = 160;
/** Chance that a lightning strike on a unit or building also throws a tesla-style ring of sparks round where it lands. */
const LIGHTNING_RING_CHANCE = 0.35;
/** In haze (mist, dust) headlight light scatters: it turns white-grey, the beams spread wider and brighter, and each lit vehicle gets a pool of pale glow round it. Haze at or above `HAZE_FULL_SPILL` (0..100) is the full effect. */
const BEAM_HAZE_COLOUR = 0xe4ebf0;
const HAZE_FULL_SPILL = 50;
const HAZE_BEAM_WIDEN = 0.7;
const HAZE_BEAM_BRIGHTEN = 0.5;
const HAZE_POOL_RADIUS = 1.5;
const HAZE_POOL_ALPHA = 0.28;
/** Nav lights on flying units: port red, starboard green, and a white strobe that flashes every STROBE_MS (steady with Reduce motion). */
const NAV_PORT = 0xff3030;
const NAV_STARBOARD = 0x30ff60;
const STROBE_MS = 1300;
/** Fire lights (drawGlows): the most lights drawn in a frame, and the colours of blasts and gun flashes. */
const GLOW_CAP = 300;
/** Water glints and lava bubbles tried per frame (those that land on liquid are drawn), and how many of those tries may be bubbles. */
const GLINT_CAP = 56;
const BUBBLE_CAP = 28;
/** Lava spits: slots tried per frame, and how long a fragment is in the air. */
const SPIT_SLOTS = 4;
const SPIT_MS = 1100;
/** Rain ripples on water: slots tried per frame at full wetness (those that land on water are drawn), and how long a ring lasts. */
const RIPPLE_CAP = 72;
const RIPPLE_MS = 1100;
/** Lava steam: wisps (the mist texture, drawn light) rising off sparse lava cells, their peak alpha dry and the extra when it is raining. */
const STEAM_CAP = 22;
const STEAM_ALPHA = 0.07;
const STEAM_WET_ALPHA = 0.1;
const STEAM_COLOUR = 0xe9eff2;
/** Water, by depth step: the first is the shallows' colour, the rest darken what is under them. [colour, alpha] */
const WATER_TIERS: readonly (readonly [number, number])[] = [[0x2f8a9b, 0.92], [0x123c66, 0.16], [0x0f3260, 0.18], [0x0c2a55, 0.2], [0x0a2248, 0.24]];
/** Lava, by depth step: crust, glowing rock, white-hot core. */
const LAVA_TIERS: readonly (readonly [number, number])[] = [[0x4c1707, 1], [0xb8360f, 0.9], [0xf47a1e, 0.9]];

/** A cheap deterministic hash of a counter and a cycle, for scattering glints without any state. */
function cellHash(a: number, b: number): number {
  let h = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

const SOFT_CAP = 600;
const MAX_EMBERS = 40;
const flameDirOut = { x: 0, y: 0 };
/** Between fragments from a big burning wreck (ms, min and max), and the hull radius assumed when the unit's stats are not known. */
const BIG_FRAGMENT_MS = [1200, 3200];
const WRECK_FIRE_SIZE_FALLBACK = 0.45;
/** Spotlights under flying units: glows stacked from the craft to the ground, their colour and brightness. */
const SPOT_STEPS = 5;
const SPOT_COLOUR = 0xcfe4ff;
const SPOT_ALPHA = 0.4;
/** Radius of the pool of light under a flying unit, in tiles: tight while it sits still, wide once it is under way (it eases between them with the unit's lift). */
const SPOT_MIN_RADIUS = 0.9;
const SPOT_MAX_RADIUS = 5;
/** Most spotlight glows drawn at once. */
const SPOT_CAP = 200;
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

interface Pulse {
  e: number;
  born: number;
  colour: number;
  /** Tesla discharges: the arcs, jumping from point to point (see `makeDischarge`). */
  hops?: Hop[];
  /** A discharge at a fixed point (tiles) with a radius (tiles), instead of round entity `e` with its weapon's range: where lightning struck. */
  spot?: { x: number; y: number; radius: number };
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
  /** Shooter and target entities (-1 when the shot has fixed ends, as from the dev Effects panel). */
  a: number;
  b: number;
  /** Fixed ends in tiles, for a shot with no entities. */
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  born: number;
  kind: ShotKind;
  damage: number;
  /** How long it shows (ms), and a number that varies its flicker from shot to shot. */
  ms: number;
  seed: number;
  colour: number;
  /** Tile where an enemy shield stopped the beam, if one did (it is drawn only that far). */
  end?: { x: number; y: number };
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
  /** Water, lava and voids (`liquids.ts`): outlines built once per map shape; the shore foam and lava glow are their own Graphics so their alpha can breathe without a redraw, and the glints, bubbles and wakes are redrawn each frame (a handful of shapes). */
  private liquids: Liquids | null = null;
  private liquidsFor = '';
  private readonly liquidFx = new Container();
  private readonly foamG = new Graphics();
  /** Every rock cell, as drawn: the liquid effects layer is masked by its inverse so foam, glow and glints never show on rock. */
  private readonly rockMask = new Graphics();
  private readonly lavaG = new Graphics();
  private readonly glintG = new Graphics();
  /** Contour line segments in tiles (`contours.ts`), and the map they were made for. */
  private contours: Float32Array = new Float32Array(0);
  private contourFor = '';
  private readonly zoneLayer = new Graphics();
  private zonesDrawnFor = '';
  private readonly linkLayer = new Graphics();
  /** Crystals that sit together are tinted into one field: a wide faint skirt under a tighter core, each flattened to one even alpha. Looks only. */
  private readonly fieldGlow = new Container();
  /** Small shards strewn over the field, so it looks seeded with crystal and not just tinted. */
  private readonly fieldShards = new Graphics();
  private shards: Shards | null = null;
  private readonly fieldLive = new Map<number, boolean>();
  private fieldDirty = true;
  private fieldX: number[] = [];
  private fieldY: number[] = [];
  private field: CrystalField | null = null;
  /** Tiles near a live crystal (where vehicles kick up dust), the dust itself, and how far each unit has driven since its last puff. */
  private dustTiles: Uint8Array | null = null;
  private readonly crystalDust = new CrystalDust();
  // Same starting size as curX: ensureCapacity only grows these together once that is exceeded.
  private dustOwed = new Float32Array(1024);
  private readonly layer = new Container();
  /** Ore lies flat on the ground, under every unit and building whatever order they appeared in. */
  private readonly groundLayer = new Container();
  /** Steam over the map's vents: above the units, under the night and fog. Redrawn each frame for the vents on screen. */
  private readonly steamLayer = new Graphics();
  /** Soft steam over lava (`drawLiquidFx`), under the night shade and the fog. */
  private readonly lavaSteam = new Container();
  private readonly steamWisps: Sprite[] = [];
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
  private readonly softLayer = new Container();
  private softs: Sprite[] = [];
  private softsUsed = 0;
  /** Draws a soft, dark-or-coloured blob (smoke, scorch) from the pool: a radial sprite with no hard edge. */
  private readonly softBlob = (x: number, y: number, radius: number, colour: number, alpha: number): void => {
    if (alpha < 0.01 || radius < 1 || this.softsUsed >= SOFT_CAP) return;
    let s = this.softs[this.softsUsed];
    if (!s) {
      s = new Sprite(this.glowTexture);
      s.anchor.set(0.5);
      this.softLayer.addChild(s);
      this.softs[this.softsUsed] = s;
    }
    this.softsUsed++;
    s.visible = true;
    s.position.set(x, y);
    s.scale.set((radius * 2) / GLOW_SIZE);
    s.tint = colour;
    s.alpha = Math.min(1, alpha);
  };
  private readonly glowTexture = Texture.from(makeGlowTexture());
  /**
   * Mist: soft wisps that live in the world (they drift over the ground and move with the camera's view of it), drawn over
   * the units and every effect so it can tone what is under it. Lights shine through it: see `haloLayer`.
   */
  private readonly mistLayer = new Container();
  /** Soft additive halos on top of the mist, one for each light (`glow`), so in mist every muzzle flash, laser, fire and lamp lights up the air round it. */
  private readonly haloLayer = new Container();
  private readonly halos: Sprite[] = [];
  private halosUsed = 0;
  /** How thick the mist is now, 0..1 (set by `drawMist` each frame). */
  private mistAmount = 0;
  private readonly mistTexture = Texture.from(makeMistTexture());
  private readonly mistWisps: Sprite[] = [];
  /** The fog of war: a picture one pixel per tile, stretched over the map with smoothing so its edge is soft (see `fogmap.ts`). */
  private readonly fogView = new Sprite();
  private fogCanvas: HTMLCanvasElement | undefined;
  private fogTexture: Texture | undefined;
  /** Energy shields: drawn with added light so overlapping ones burn brighter, under the fog so unseen ones stay hidden. */
  private readonly shieldLayer = new Graphics();
  /** Spotlight beams: warm light added over the ground, under the fog. */
  private readonly spotBeamLayer = new Graphics();
  private readonly beamHeadings = new BeamHeadings();
  private readonly beamReaches = new Float32Array(BEAM_RAYS);
  private readonly beamSeen = new Set<number>();
  private lastBeamFrame = 0;
  private shieldFlashes: ShieldFlash[] = [];
  /** Scratch for drawShields: the shields in sight this frame, and the points where two arcs cross. */
  private readonly shieldsDrawn: ShieldDraw[] = [];
  private readonly crossings: number[] = [];
  /** Blooms where arcs cross, as [x, y, colour, colour, ...] with x and y in tiles, and when they were last worked out. */
  private readonly crossBlooms: number[] = [];
  private crossBloomAt = 0;
  /** What each shield looks like right now, eased towards the latest replicated arc, radius and heading (they arrive ten times a second). */
  private readonly shieldView = new Map<number, { head: number; arc: number; r: number }>();
  private lastShieldFrame = 0;
  private readonly shieldSeen = new Set<number>();
  private nextShieldSparks = 0;
  /** Radar blips and pulse rings, above the fog so contacts show in the dark. */
  private readonly radarLayer = new Container();
  private readonly radarGfx = new Graphics();
  /** Faded copies of each contact's real art, reused from frame to frame. */
  private readonly radarSprites: Sprite[] = [];
  private fogDrawnFor = '';
  private readonly overlay = new Graphics();
  /** Rain, storm gloom and lightning, over the fog and under the interface. */
  private readonly precipitation = new Precipitation();
  /** What the weather needs to know of the view: where things are on screen, and what the player can see. */
  private readonly skyProbe: SkyProbe = {
    visible: (sx, sy) => this.state.tileVisible(Math.floor((sx - this.offX) / this.scale), Math.floor((sy - this.offY) / this.scale)),
    tileVisible: (tx, ty) => this.state.tileVisible(tx, ty),
    tileToScreen: (tx, ty) => this.tileToScreen(tx, ty),
  };
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
  /** Per entity: 0 not seen yet, 1 lamps off, 2 lamps on; and when (ms) the last switch began. A lamp is on in the dark while its owner has energy. */
  private lampState = new Uint8Array(1024);
  private lampSince = new Float64Array(1024);
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
  /** Shot-down fliers still tumbling to the ground before they explode. */
  private wrecks: Wreck[] = [];
  /** Dev tools: every shot-down flier crashes. */
  private alwaysCrash = false;
  /** Cargo a harvester held at its last Harvest event: the difference is what it just mined. */
  private readonly lastCargo = new Map<number, number>();
  private readonly textures = new Map<string, Texture>();
  private readonly routes = new Map<number, Route>();
  /** Sprite rotation each unit is turning towards (art faces up; 0 = up). Kept while stopped. */
  private readonly facing = new Map<number, number>();
  private lastFrameAt = 0;
  /** Small cosmetic fires left by bouncing fragments (tiles, ms). */
  private embers: { x: number; y: number; born: number; ms: number; seed: number; size: number; nextFrag: number }[] = [];
  /** Last known direction of each fireball on screen (tiles per tick, the rise of the lob included): the tail follows it. */
  private flameDirX = new Float32Array(1024);
  private flameDirY = new Float32Array(1024);
  private flameArcPrev = new Float32Array(1024);
  private flameArcCur = new Float32Array(1024);
  private prevX = new Float32Array(1024);
  private prevY = new Float32Array(1024);
  private curX = new Float32Array(1024);
  private curY = new Float32Array(1024);
  private shots: Shot[] = [];
  /** Launcher entities that just fired a missile, with the time of the launch. */
  private launches: { e: number; born: number }[] = [];
  /** Missiles in flight (they are drawn straight from the Missile component, not as sprites, and cannot be selected). */
  private readonly flying = new Set<number>();
  /** Smoke clouds: drawn on a layer of their own over the units, so they hide what they cover (see weaponFx.ts); when each first appeared, for its swell. */
  private readonly smokeLayer = new Graphics();
  private readonly smokeBorn = new Map<number, number>();
  /** Railgun shots still on screen, and the units that have a module held down by an ion bolt. */
  private railBeams: { x: number; y: number; heading: number; len: number; born: number }[] = [];
  private readonly ionHeld = new Set<number>();
  /** Recent positions of each missile in tiles, flat [x, y, ...], oldest first. */
  private readonly trails = new Map<number, number[]>();
  private pulses: Pulse[] = [];
  private chargePulses: Pulse[] = [];
  private explosions: Blast[] = [];
  private buildSparks: BuildSparks[] = [];
  /** Lights with no entity behind them, added by the dev Effects panel (empty in a real match). */
  private devGlows: DevGlow[] = [];
  /** Blast radius in tiles per entity, remembered while alive because stats are gone once it dies. */
  private readonly blastRadius = new Map<number, number>();
  /** What kind of blast each entity leaves (missing = plain fire), and the share of charge a battery building held at its last update. */
  private readonly blastKind = new Map<number, BlastKind>();
  private readonly blastCharge = new Map<number, number>();
  /** Per design: does it hold a battery (its building bursts as a discharge). */
  private readonly batteryDesign = new Map<number, boolean>();
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
    this.shieldLayer.blendMode = 'add';
    this.spotBeamLayer.blendMode = 'add';
    this.liquidFx.addChild(this.foamG, this.lavaG, this.glintG);
    this.liquidFx.setMask({ mask: this.rockMask, inverse: true });
    this.zoneLayer.setMask({ mask: this.rockMask, inverse: true }); // the charge zone lies on the ground, never over rock
    app.stage.addChild(this.backdrop, this.liquidFx, this.zoneLayer, this.linkLayer, this.shadowLayer, this.fieldGlow, this.fieldShards, this.groundLayer, this.beamLayer, this.layer, this.steamLayer, this.smokeLayer, this.lavaSteam, this.nightLayer, this.lightLayer, this.spotBeamLayer, this.shieldLayer, this.fogView, this.precipitation.view, this.radarLayer, this.softLayer, this.glowLayer, this.overlay, this.mistLayer, this.haloLayer, this.damageLayer, this.bubbleLayer, this.powerLabelLayer, this.ghost);
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

  /** The ground changed shape (painted by a developer command): redraw it, and plan routes again. */
  terrainChanged(): void {
    this.laidOutFor = '';
    this.routes.clear();
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

  /** Inverse of `screenToTile`: canvas CSS pixels of a point given in tiles. */
  tileToScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.offX + x * this.scale, y: this.offY + y * this.scale };
  }

  /** The live effect lists, for the dev Effects panel (devEffects.ts) to add to. Call again after each use: the lists are replaced as effects expire. */
  devSinks(): EffectSinks {
    return {
      explosions: this.explosions,
      sparks: this.sparks,
      shrapnel: this.shrapnel,
      buildSparks: this.buildSparks,
      glows: this.devGlows,
      shot: (kind, damage, x1, y1, x2, y2, colour, now) => this.fireShot(kind, damage, -1, -1, { x: x1, y: y1 }, { x: x2, y: y2 }, colour, now),
      alwaysCrash: (on) => (this.alwaysCrash = on),
      clear: () => {
        this.explosions = [];
        this.sparks.length = 0;
        this.shrapnel.length = 0;
        this.buildSparks = [];
        this.devGlows = [];
      },
    };
  }

  /** The middle of the view in tiles, and how far from it things can still be heard (a little past the screen corners). */
  listener():{ x: number; y: number; radius: number } {
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
      for (const w of this.wrecks) {
        w.sprite.destroy();
        w.shadow.destroy();
      }
      this.wrecks.length = 0;
      this.facing.clear();
      this.lastHp.clear();
      this.blastRadius.clear();
      this.blastKind.clear();
      this.blastCharge.clear();
      this.batteryDesign.clear();
      this.flying.clear();
      this.trails.clear();
      this.smokeBorn.clear();
      this.railBeams.length = 0;
      this.ionHeld.clear();
    }
    for (const e of world.despawned) {
      this.lampState[e] = 0; // an id that is reused starts afresh
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
      const sprite = this.sprites.get(e);
      const shadow = this.shadows.get(e);
      const crashed = !!sprite && !!shadow && dying.has(e) && this.crashes(e, sprite);
      if (crashed && sprite && shadow) {
        // Shot down: the sprite and shadow live on as a wreck, and the blast waits until it lands.
        const heading = (this.facing.get(e) ?? sprite.rotation) - Math.PI / 2;
        this.wrecks.push(startWreck(sprite, shadow, this.curX[e], this.curY[e], heading, this.blastRadius.get(e) ?? 0.9, performance.now(), Math.random, (this.state.stats(e)?.radius ?? WRECK_FIRE_SIZE_FALLBACK * TILE) / TILE));
      } else {
        sprite?.destroy();
        shadow?.destroy();
      }
      this.sprites.delete(e);
      this.shadows.delete(e);
      this.routes.delete(e);
      this.facing.delete(e);
      this.flying.delete(e);
      this.smokeBorn.delete(e);
      this.ionHeld.delete(e);
      this.trails.delete(e);
      // Forget what was seen: an entity that comes back (or an id that is reused) starts afresh.
      this.lastHp.delete(e);
      if (!dying.has(e) || crashed) {
        this.blastRadius.delete(e);
        this.blastKind.delete(e);
        this.blastCharge.delete(e);
      }
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
      this.blastKind.set(e, st?.structure ? (this.holdsBattery(unit.f.blueprint[e]) ? 'energy' : 'structure') : 'fire');
    }
    // A battery building remembers how full it was, so its last blast can be as big as the charge it held.
    const charges = world.store(EnergyView);
    for (const e of charges.changed) if (this.blastKind.get(e) === 'energy' && charges.has(e)) this.blastCharge.set(e, charges.f.pct[e] / 100);
    if (this.wallVersion !== this.state.structureVersion) this.joinWalls();

    const missiles = world.store(Missile);
    for (const e of missiles.changed) {
      if (!missiles.has(e)) continue;
      this.flying.add(e);
      this.blastRadius.set(e, missiles.f.blast[e] / 10);
      this.blastKind.set(e, 'missile');
    }
    const shells = world.store(Shell);
    for (const e of shells.changed) if (shells.has(e)) this.flying.add(e); // interpolated like missiles
    const smokes = world.store(Smoke);
    for (const e of smokes.changed) {
      if (!smokes.has(e)) continue;
      this.flying.add(e); // tracked for its position like a missile; clouds do not move, so nothing is interpolated
      if (!this.smokeBorn.has(e)) this.smokeBorn.set(e, performance.now());
    }
    const modules = world.store(Modules);
    for (const e of modules.changed) {
      if (modules.has(e) && modules.f.ion[e] !== 0) this.ionHeld.add(e);
      else this.ionHeld.delete(e);
    }
    const flames = world.store(Flame);
    for (const e of flames.changed) {
      if (!flames.has(e)) continue;
      this.flying.add(e);
      // The lob's progress is replicated once a tick: keep the last two so it can be eased between them.
      this.flameArcPrev[e] = this.flameArcCur[e] > flames.f.arc[e] ? flames.f.arc[e] : this.flameArcCur[e];
      this.flameArcCur[e] = flames.f.arc[e];
    }
    for (const e of this.flying) {
      if (!pos.has(e) || !missiles.has(e)) continue;
      let trail = this.trails.get(e);
      if (!trail) this.trails.set(e, (trail = []));
      trail.push(this.curX[e], this.curY[e]);
      if (trail.length > TRAIL_POINTS * 2) trail.splice(0, 2);
    }

    const res = world.store(Resource);
    const patches = world.store(ResourcePatch);
    const debris = world.store(Debris);
    for (const e of [...res.changed, ...patches.changed, ...debris.changed]) {
      if (!res.has(e)) continue;
      if (debris.has(e)) {
        // Wreckage: scrap that thins out as it is used up.
        const stage = debrisStage(res.f.amount[e], debris.f.maximum[e]);
        const look = debris.f.look[e];
        this.ensureSprite(e, this.texture(`debris.${look}.${stage}.${e % DEBRIS_VARIANTS}`, (g) => drawDebris(g, look, stage, e % DEBRIS_VARIANTS, TEX)), this.groundLayer);
        continue;
      }
      // Shards drop away as the node is mined: five looks, from full down to a bare patch.
      const amount = res.f.amount[e];
      const full = Math.max(amount, patches.has(e) ? patches.f.maximum[e] : RESOURCE_PATCH_AMOUNT);
      const stage = amount <= 0 ? -1 : Math.min(4, Math.floor((amount / full) * 5));
      this.ensureSprite(e, this.resourceTexture(stage), this.groundLayer);
      if (this.fieldLive.get(e) !== amount > 0) {
        this.fieldLive.set(e, amount > 0);
        this.fieldDirty = true;
      }
    }

    const features = world.store(Feature);
    for (const e of features.changed) {
      if (!features.has(e)) continue;
      const kind = features.f.kind[e];
      this.ensureSprite(e, this.featureTexture(kind, e % SCENERY_VARIANTS), kind === FeatureKind.Vent ? this.groundLayer : this.layer);
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
    // Shield hits first: a beam that one stopped is drawn only as far as the arc (the Shot event comes before it in the list).
    let shieldEnds: Map<number, { x: number; y: number }> | undefined;
    for (let i = 0; i < info.events.length; i += 3) {
      if (info.events[i] === SimEvent.ShieldHit) {
        const end = this.shieldImpact(info.events[i + 1], info.events[i + 2], now);
        if (end) (shieldEnds ??= new Map()).set(info.events[i + 1], end);
      } else if (info.events[i] === SimEvent.ShieldBurst) {
        this.shieldBurst(info.events[i + 1], now);
      }
    }
    for (let i = 0; i < info.events.length; i += 3) {
      if (info.events[i] === SimEvent.Charge) {
        const a = info.events[i + 1];
        this.chargePulses.push({ e: a, born: now, colour: CHARGE_PULSE_COLOUR });
        continue;
      }
      if (info.events[i] === SimEvent.Lightning) {
        // Lightning struck something we can see: a bolt onto it, and the ring of sparks of a tesla stun round it.
        const a = info.events[i + 1];
        if (!this.sprites.has(a)) continue;
        const at = this.tileToScreen(this.curX[a], this.curY[a]);
        this.precipitation.strikeAt(at.x, at.y, now);
        // The bolt always lands; the ring of sparks round the point of impact only shows on some strikes.
        if (Math.random() < LIGHTNING_RING_CHANCE) {
          const x = this.curX[a], y = this.curY[a], reach = (LIGHTNING_RADIUS / TILE) * ARC_REACH;
          const hops = makeDischarge(x, y, reach, this.dischargeTargets(x, y, reach, a), TESLA_CHAINS, Math.random, { maxHops: TESLA_HOPS });
          this.pulses.push({ e: a, born: now, colour: 0xdfe9ff, hops, spot: { x, y, radius: reach / ARC_REACH } });
        }
        continue;
      }
      if (info.events[i] === SimEvent.Pulse) {
        const a = info.events[i + 1];
        const x = this.curX[a], y = this.curY[a], reach = ((this.state.stats(a)?.weapon?.range ?? 0) / TILE) * ARC_REACH;
        const hops = makeDischarge(x, y, reach, this.dischargeTargets(x, y, reach, a), TESLA_CHAINS, Math.random, { maxHops: TESLA_HOPS });
        this.pulses.push({ e: a, born: now, colour: ownerColour(unit.f.owner[a]), hops });
        continue;
      }
      if (info.events[i] === SimEvent.Death) {
        const a = info.events[i + 1];
        // No blast radius means this client never saw the entity (out of sight), so its position is unset (0,0) or stale.
        const radius = this.blastRadius.get(a);
        if (radius === undefined) continue;
        const kind = this.blastKind.get(a) ?? 'fire';
        if (kind === 'energy') {
          // A battery bank lets go of what it holds: the fuller it was, the bigger the discharge.
          const power = this.blastCharge.get(a) ?? 0.5;
          const r = energyRadius(radius / 0.75, power);
          this.explosions.push(makeBlast('energy', this.curX[a], this.curY[a], r, now, { power, targets: this.dischargeTargets(this.curX[a], this.curY[a], r * (1.2 + 0.8 * power) * ARC_REACH, a) }));
        } else {
          this.explosions.push(makeBlast(kind, this.curX[a], this.curY[a], radius, now));
        }
        if (!reduceMotion()) throwShrapnel(this.shrapnel, this.curX[a], this.curY[a], radius, now);
        this.blastRadius.delete(a);
        this.blastKind.delete(a);
        this.blastCharge.delete(a);
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
      if (info.events[i] === SimEvent.ShellHit || info.events[i] === SimEvent.ShellBounce || info.events[i] === SimEvent.ShellLand) {
        this.shellImpact(info.events[i], info.events[i + 1], now);
        continue;
      }
      if (info.events[i] === SimEvent.FlameLand) {
        const f = info.events[i + 1];
        if (!reduceMotion() && this.state.world.store(Flame).has(f)) burstSparks(this.sparks, this.curX[f], this.curY[f], 6, now, { colour: FIRE_YELLOW, reach: [0.2, 0.6], ms: [200, 420] });
        continue;
      }
      if (info.events[i] === SimEvent.Smoke) {
        // The volley leaves in a puff of grey from the launcher; the clouds swell where they land.
        const a = info.events[i + 1];
        if (this.sprites.has(a) && !reduceMotion()) burstSparks(this.sparks, this.curX[a], this.curY[a], 7, now, { colour: 0xc8ced8, reach: [0.3, 0.8], ms: [240, 520], width: 2.4 });
        continue;
      }
      if (info.events[i] === SimEvent.Intercept) {
        // Point defence: a stitch of green darts from the defender to the missile or shell, and a small puff where it is hit.
        const a = info.events[i + 1], b = info.events[i + 2];
        if (this.sprites.has(a)) this.fireShot('pd', 1, a, b, { x: this.curX[a], y: this.curY[a] }, { x: this.curX[b], y: this.curY[b] }, 0x9dffb4, now);
        continue;
      }
      if (info.events[i] === SimEvent.RailShot) {
        // The beam is drawn from the Charge the carrier still holds this tick (heading and length of the line).
        const a = info.events[i + 1];
        const charge = world.store(Charge);
        if (this.sprites.has(a) && charge.has(a) && this.railBeams.length < 16) {
          const heading = (charge.f.heading[a] / 256) * Math.PI * 2;
          this.railBeams.push({ x: this.curX[a], y: this.curY[a], heading, len: charge.f.len[a] / 10, born: now });
          if (!reduceMotion()) burstSparks(this.sparks, this.curX[a] + Math.cos(heading), this.curY[a] + Math.sin(heading), 14, now, { colour: 0xcdeeff, heading, spread: 0.5, reach: [0.5, 1.6], ms: [200, 480], width: 2.6 });
        }
        continue;
      }
      if (info.events[i] === SimEvent.DroneLaunch || info.events[i] === SimEvent.DroneDock) {
        // Amber sparks round the carrier's hatch as a drone leaves or comes home.
        const a = info.events[i + 1];
        if (this.sprites.has(a) && !reduceMotion()) burstSparks(this.sparks, this.curX[a], this.curY[a], 6, now, { colour: 0xffc247, reach: [0.25, 0.7], ms: [200, 420] });
        continue;
      }
      if (info.events[i] !== SimEvent.Shot) continue;
      const a = info.events[i + 1];
      this.aimAt.set(a, { target: info.events[i + 2], until: now + AIM_LINGER_MS });
      if (this.state.stats(a)?.weapon?.kind === 'flame') {
        // The fireball is the shot: a puff of flame at the muzzle.
        this.launches.push({ e: a, born: now });
        continue;
      }
      if (this.state.stats(a)?.weapon?.kind === 'cannon' && !world.store(Missile).has(info.events[i + 2])) {
        // No instant line: the shell itself is the shot. A flash and a few sparks at the muzzle.
        this.launches.push({ e: a, born: now });
        if (this.sprites.has(a) && !reduceMotion()) {
          const heading = Math.atan2(this.curY[info.events[i + 2]] - this.curY[a], this.curX[info.events[i + 2]] - this.curX[a]);
          burstSparks(this.sparks, this.curX[a], this.curY[a], 3, now, { colour: SHELL_SPARK_COLOURS[0], heading, spread: 0.5, reach: [0.2, 0.5], ms: [120, 240] });
        }
        continue;
      }
      if (this.state.stats(a)?.weapon?.kind === 'missile') {
        // No instant line: the missile itself is the shot (see drawMissiles).
        this.launches.push({ e: a, born: now });
        continue;
      }
      const weapon = this.state.stats(a)?.weapon;
      this.fireShot(shotKindOf(weapon?.kind), weapon?.damage ?? 5, a, info.events[i + 2], undefined, undefined, ownerColour(unit.f.owner[a]), now, shieldEnds?.get(info.events[i + 2]));
    }
    for (const a of info.alerts) this.showBubble(a.e, a.text, now + a.ticks * (1000 / TICK_RATE));
    this.lastTickAt = now;
  }

  /**
   * An instant shot (gun, laser or flak): the beam or tracer itself is drawn each frame (beams.ts); here the effects that
   * happen once are added: sparks where it lands (none when a shield stopped it, which has its own) and the air-burst of a flak shot.
   * `from`/`to` (tiles) give a shot with fixed ends, used by the dev Effects panel.
   */
  private fireShot(kind: ShotKind, damage: number, a: number, b: number, from: { x: number; y: number } | undefined, to: { x: number; y: number } | undefined, colour: number, now: number, end?: { x: number; y: number }): void {
    const ms = SHOT_LIFE_MS[kind];
    this.shots.push({ a, b, from, to, born: now, kind, damage, ms, seed: Math.floor(Math.random() * 1000), colour, end });
    const sx = from ? from.x : this.curX[a], sy = from ? from.y : this.curY[a];
    const tx = end ? end.x : to ? to.x : this.curX[b], ty = end ? end.y : to ? to.y : this.curY[b];
    if (kind === 'pd') {
      if (!reduceMotion()) burstSparks(this.sparks, tx, ty, 3, now + ms * 0.4, { colour: 0x9dffb4, reach: [0.1, 0.35], ms: [120, 240] });
      if (this.explosions.length < MAX_EXPLOSIONS) this.explosions.push(makeBlast('flak', tx, ty, 0.35, now + ms * 0.4));
      return;
    }
    if (kind === 'flak') {
      // The shell is a string of puffs that takes most of the shot's life to arrive, then bursts.
      if (this.explosions.length < MAX_EXPLOSIONS) this.explosions.push(makeBlast('flak', tx, ty, 0.7, now + ms * 0.55));
      return;
    }
    if (end || reduceMotion()) return;
    const back = Math.atan2(sy - ty, sx - tx);
    if (kind === 'ion') {
      burstSparks(this.sparks, tx, ty, 9, now + ms * 0.1, { colour: 0xc27bff, reach: [0.2, 0.7], ms: [200, 420], width: 2 });
      return;
    }
    if (kind === 'laser') {
      burstSparks(this.sparks, tx, ty, 6, now, { colour: SHIELD_SPARK_COLOURS[1], heading: back, spread: 1.2, reach: [0.15, 0.55], ms: [180, 380] });
    } else {
      // A tracer takes about a third of the shot to arrive; the sparks wait for it.
      burstSparks(this.sparks, tx, ty, 3, now + ms * 0.3, { colour: SHELL_SPARK_COLOURS[0], heading: back, spread: 1.1, reach: [0.12, 0.4], ms: [120, 260] });
    }
  }

  /** A shell struck an enemy (small blast and sparks), glanced off (sparks), or landed (a few sparks). Reuses the spark and explosion effects. */
  private shellImpact(type: number, e: number, now: number): void {
    const shells = this.state.world.store(Shell);
    if (!shells.has(e)) return;
    const x = this.curX[e], y = this.curY[e];
    const colour = () => SHELL_SPARK_COLOURS[Math.floor(Math.random() * SHELL_SPARK_COLOURS.length)];
    if (type === SimEvent.ShellHit) {
      this.explosions.push(makeBlast('shell', x, y, 0.3 + 0.004 * shells.f.size[e], now));
      burstSparks(this.sparks, x, y, 8, now, { colour: colour(), reach: [0.3, 0.8], ms: [200, 420] });
    } else if (type === SimEvent.ShellBounce) {
      // Sparks fly off the way the shell now travels.
      const heading = (shells.f.heading[e] / 256) * Math.PI * 2;
      burstSparks(this.sparks, x, y, 7, now, { colour: colour(), heading, spread: 0.9, reach: [0.3, 0.9], ms: [180, 380], width: 2 });
    } else {
      burstSparks(this.sparks, x, y, 3, now, { colour: colour(), reach: [0.15, 0.4], ms: [150, 300] });
    }
  }

  /**
   * A shield stopped a hit: sparks fly off the arc where it landed and the struck part of the arc lights up (the event carries the
   * direction of the hit and the damage stopped). Returns the tile it landed on, or undefined if the shield is not known here.
   */
  private shieldImpact(e: number, packed: number, now: number): { x: number; y: number } | undefined {
    const shields = this.state.world.store(Shield);
    if (!shields.has(e) || !this.sprites.has(e)) return undefined;
    const angle = ((packed & 255) / 256) * Math.PI * 2;
    const power = Math.min(1, (packed >> 8) / 60);
    const reach = shields.f.range[e] / 10;
    const x = this.curX[e] + Math.cos(angle) * reach;
    const y = this.curY[e] + Math.sin(angle) * reach;
    if (this.shieldFlashes.length < MAX_FLASHES) this.shieldFlashes.push({ e, angle, born: now, power });
    const owner = this.state.world.store(Unit).f.owner[e];
    burstSparks(this.sparks, x, y, 8 + Math.round(power * 14), now, {
      colour: SHIELD_SPARK_COLOURS[Math.floor(Math.random() * SHIELD_SPARK_COLOURS.length)] ?? ownerColour(owner),
      heading: angle,
      spread: 1.6,
      reach: [0.3, 1.1],
      ms: [200, 480],
      width: 2.2,
    });
    // A hard hit also throws a few white-hot sparks straight out from the point struck.
    if (power > 0.3) burstSparks(this.sparks, x, y, 3 + Math.round(power * 5), now, { colour: 0xffffff, heading: angle, spread: 0.5, reach: [0.6, 1.5], ms: [140, 280], width: 2.6 });
    return { x, y };
  }

  /** A shield ran its owner flat and blew: a blast as big as the energy it held, sparks, and fragments. */
  private shieldBurst(e: number, now: number): void {
    if (!this.sprites.has(e)) return;
    const capacity = this.state.stats(e)?.energyCapacity ?? 600;
    const radius = shieldRadius(capacity);
    const colour = ownerColour(this.state.world.store(Unit).f.owner[e]);
    if (this.explosions.length < MAX_EXPLOSIONS) this.explosions.push(makeBlast('shield', this.curX[e], this.curY[e], radius, now, { colour, targets: this.dischargeTargets(this.curX[e], this.curY[e], radius * 1.3 * ARC_REACH, e) }));
    burstSparks(this.sparks, this.curX[e], this.curY[e], 24, now, { colour: SHIELD_SPARK_COLOURS[0], reach: [0.5, radius + 0.5], ms: [300, 700], width: 2 });
    if (!reduceMotion()) throwShrapnel(this.shrapnel, this.curX[e], this.curY[e], radius * 0.6, now);
  }

  /** Every shield that is up and in sight: the translucent arc, hit flashes, and a crackle where two arcs cross. */
  private drawShields(now: number): void {
    const g = this.shieldLayer.clear();
    this.shieldFlashes = this.shieldFlashes.filter((f) => now - f.born < FLASH_MS && this.sprites.has(f.e));
    const store = this.state.world.store(Shield);
    if (store.dense.length === 0) return;
    const reduce = reduceMotion();
    const energy = this.state.world.store(EnergyView);
    const unit = this.state.world.store(Unit);
    const thickness = Math.max(1.5, Math.min(3, this.scale * 0.07)); // a thin border: a few pixels at any zoom
    const { width, height } = this.app.screen;
    const k = easeBy((now - (this.lastShieldFrame || now)) / 1000);
    this.lastShieldFrame = now;
    const seen = this.shieldSeen;
    seen.clear();
    const drawn = this.shieldsDrawn; // reused objects: only the first `count` are live this frame
    let count = 0;
    for (const e of store.dense) {
      if (store.f.active[e] === 0 || !this.sprites.has(e)) continue;
      const p = this.screenOf(e);
      const view = this.easedShield(e, store.f.heading[e], store.f.arc[e], store.f.range[e], k);
      seen.add(e);
      const r = view.r * this.scale;
      if (p.x + r < 0 || p.y + r < 0 || p.x - r > width || p.y - r > height) continue;
      const d = (drawn[count] ??= { e: 0, x: 0, y: 0, r: 0, head: 0, arc: 0, colour: 0, level: 1, seed: 0 });
      count++;
      d.e = e;
      d.x = p.x;
      d.y = p.y;
      d.r = r;
      d.head = view.head;
      d.arc = view.arc;
      d.colour = ownerColour(unit.f.owner[e]);
      d.seed = (e * 0.6180339887) % 1;
      d.level = shieldLevel(energy.has(e) ? energy.f.pct[e] : 100, now, d.seed, reduce);
      drawShield(g, d, this.shieldFlashes, now, thickness, reduce);
    }
    for (const e of this.shieldView.keys()) if (!seen.has(e)) this.shieldView.delete(e);
    // Load: sparks where two arcs cross (each crossing also drains both shields' power) and from each emitter under strain.
    const due = now >= this.nextShieldSparks;
    if (due) {
      this.nextShieldSparks = now + SHIELD_STRAIN_MS;
      this.crossBlooms.length = 0;
      this.crossBloomAt = now;
    }
    if (due && count >= 2 && count <= MAX_INTERFERING) {
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const n = arcIntersections(drawn[i], drawn[j], this.crossings);
          for (let c = 0; c < n; c++) {
            const x = (this.crossings[c * 2] - this.offX) / this.scale;
            const y = (this.crossings[c * 2 + 1] - this.offY) / this.scale;
            if (this.crossBlooms.length < MAX_CROSSING_BLOOMS * 4) this.crossBlooms.push(x, y, drawn[i].colour, drawn[j].colour);
            const burst = reduce ? 2 : CROSSING_SPARKS;
            burstSparks(this.sparks, x, y, burst, now, { colour: drawn[i].colour, reach: [0.2, 0.7], ms: [150, 340], width: 1.8 });
            burstSparks(this.sparks, x, y, burst, now, { colour: drawn[j].colour, reach: [0.2, 0.7], ms: [150, 340], width: 1.8 });
            burstSparks(this.sparks, x, y, burst, now, { colour: SHIELD_SPARK_COLOURS[1], reach: [0.1, 0.45], ms: [110, 260], width: 2.2 });
          }
        }
      }
    }
    // Where two arcs cross the energy piles up: a bloom in both colours that flares with each refresh and flickers between them.
    const bl = this.crossBlooms;
    if (bl.length > 0) {
      const fresh = Math.max(0, 1 - (now - this.crossBloomAt) / (SHIELD_STRAIN_MS * 1.5));
      const radius = thickness * 12;
      for (let c = 0; c < bl.length; c += 4) {
        const px = bl[c] * this.scale + this.offX;
        const py = bl[c + 1] * this.scale + this.offY;
        const a = (reduce ? 0.7 : 1.1) + (reduce ? 0 : 0.5 * fresh);
        drawBloom(g, px, py, radius * (1 + 0.3 * fresh), bl[c + 2], a);
        drawBloom(g, px, py, radius * (1 + 0.3 * fresh), bl[c + 3], a);
        drawBloom(g, px, py, radius * 0.4, 0xffffff, a * 0.8);
      }
    }
    if (due && !reduce) {
      for (let i = 0; i < count; i++) {
        const d = drawn[i];
        const strain = store.f.strain[d.e];
        if (strain === 0) continue;
        // From the emitter out along the arc it is holding: the more crossings, the more sparks.
        burstSparks(this.sparks, this.curX[d.e], this.curY[d.e], Math.min(12, strain * EMITTER_SPARKS_PER_CROSSING), now, {
          colour: SHIELD_SPARK_COLOURS[Math.floor(Math.random() * SHIELD_SPARK_COLOURS.length)],
          heading: d.head,
          spread: d.arc / 2,
          reach: [0.3, Math.max(0.5, d.r / this.scale)],
          ms: [180, 420],
          width: 1.6,
        });
      }
    }
  }

  /** Smoke clouds in view: soft billows over the units, swelling out when new and thinning as they run out. */
  private drawSmoke(now: number): void {
    const g = this.smokeLayer.clear();
    const store = this.state.world.store(Smoke);
    if (store.dense.length === 0) return;
    const still = reduceMotion();
    const { width, height } = this.app.screen;
    for (const e of store.dense) {
      if (!this.flying.has(e)) continue;
      const p = this.tileToScreen(this.curX[e], this.curY[e]);
      const radius = (store.f.radius[e] / 10) * this.scale;
      if (p.x + radius < 0 || p.y + radius < 0 || p.x - radius > width || p.y - radius > height) continue;
      const born = this.smokeBorn.get(e) ?? now;
      drawSmokeCloud(g, p.x, p.y, radius, store.f.life[e] / 255, (now - born) / SMOKE_SWELL_MS, e, this.state.daylight, now, still);
    }
  }

  /** The railgun's aim line and gathering glint while it charges, its beam after it fires, and the violet crackle on a unit with a module held down. */
  private drawWeaponFx(g: Graphics, now: number, still: boolean): void {
    const charges = this.state.world.store(Charge);
    for (const e of charges.dense) {
      if (charges.f.state[e] !== 0 || !this.sprites.has(e)) continue;
      const p = this.screenOf(e);
      const reach = ((this.state.stats(e)?.weapon?.range ?? 0) / TILE) * this.scale;
      drawRailCharge(g, p.x, p.y, (charges.f.heading[e] / 256) * Math.PI * 2, charges.f.pct[e] / 255, reach, this.scale, now, still);
    }
    if (this.railBeams.length > 0) {
      this.railBeams = this.railBeams.filter((b) => now - b.born < RAIL_BEAM_MS);
      for (const b of this.railBeams) {
        const p = this.tileToScreen(b.x, b.y);
        drawRailBeam(g, p.x, p.y, b.heading, b.len * this.scale, (now - b.born) / RAIL_BEAM_MS, this.scale, still);
      }
    }
    for (const e of this.ionHeld) {
      if (!this.sprites.has(e)) continue;
      const p = this.screenOf(e);
      const s = this.state.stats(e);
      drawIonHold(g, p.x, p.y, (s?.structure ? s.footprint / 2 : Math.max(0.3, (s?.radius ?? 300) / TILE)) * this.scale, e, now, still);
    }
  }

  /** Every spotlight that is lit and in sight: a soft wedge, cut short where rock or a building stops the light, brighter as the sky darkens. */
  private drawSpotBeams(now: number): void {
    const g = this.spotBeamLayer.clear();
    const store = this.state.world.store(Light);
    const seen = this.beamSeen;
    seen.clear();
    if (store.dense.length === 0) {
      this.beamHeadings.retain(seen);
      return;
    }
    const k = easeBy((now - (this.lastBeamFrame || now)) / 1000);
    this.lastBeamFrame = now;
    const strength = 0.35 + 0.65 * (1 - this.state.daylight / 100);
    const { width, height } = this.app.screen;
    for (const e of store.dense) {
      if (store.f.power[e] === 0 || !this.sprites.has(e)) continue;
      seen.add(e);
      const head = this.beamHeadings.ease(e, store.f.heading[e], k);
      const length = (store.f.power[e] / 10) * LIGHT_TILES_PER_ENERGY;
      const p = this.screenOf(e);
      const r = length * this.scale;
      if (p.x + r < 0 || p.y + r < 0 || p.x - r > width || p.y - r > height) continue;
      const skip = (this.state.stats(e)?.footprint ?? 1) / 2 + 0.6;
      beamReach(this.state.terrain, this.tileX(e), this.tileY(e), head, length, skip, this.beamReaches);
      drawBeam(g, { x: p.x, y: p.y, scale: this.scale, head, reach: this.beamReaches, skip, strength: strength * (store.f.dim[e] / 255) });
    }
    this.beamHeadings.retain(seen);
  }

  /** The shield on `e` as drawn now: its replicated heading, arc and radius, eased so they glide between ticks (a new shield starts where it is). */
  private easedShield(e: number, heading: number, arc: number, range: number, k: number): { head: number; arc: number; r: number } {
    const wantHead = (heading / 256) * Math.PI * 2;
    const wantArc = (arc / 256) * Math.PI * 2;
    const wantR = range / 10;
    let v = this.shieldView.get(e);
    if (!v) {
      v = { head: wantHead, arc: wantArc, r: wantR };
      this.shieldView.set(e, v);
      return v;
    }
    v.head = easeAngle(v.head, wantHead, k);
    v.arc += (wantArc - v.arc) * k;
    v.r += (wantR - v.r) * k;
    return v;
  }

  /** Fireballs on their lob and the fires they left; each is drawn from the clock alone (see flames.ts). */
  private drawFlames(g: Graphics, now: number, still: boolean): void {
    const store = this.state.world.store(Flame);
    this.softsUsed = 0;
    // The more fires a jet has laid, the fewer flames each gets, and only some give off smoke, so a stream stays cheap to draw.
    const fires = store.dense.length;
    const tongues = Math.max(3, Math.min(MAX_TONGUES, Math.round(MAX_TONGUES * 40 / Math.max(40, fires))));
    const smokeEvery = Math.max(1, Math.ceil(fires / 50));
    for (const e of this.flying) {
      if (!store.has(e)) continue;
      const p = this.screenOf(e);
      if (p.x < -this.scale * 3 || p.y < -this.scale * 4 || p.x > this.app.screen.width + this.scale * 3 || p.y > this.app.screen.height + this.scale * 3) continue;
      if (store.f.state[e] === 1) {
        drawFire(g, this.softBlob, p.x, p.y, this.scale, store.f.life[e] / FLAME_LIFE_STEPS, now, e, still, tongues, e % smokeEvery === 0);
      } else {
        const dir = this.flameDirection(e);
        drawFireball(g, this.softBlob, p.x, p.y, this.scale, this.flameProgress(e), dir.x, dir.y, now, e, still);
      }
    }
    this.embers = this.embers.filter((m) => now - m.born < m.ms);
    for (const m of this.embers) {
      if (now >= m.nextFrag) {
        // A big wreck cooks off now and then: a few fragments fly from the fire.
        m.nextFrag = now + BIG_FRAGMENT_MS[0] + Math.random() * (BIG_FRAGMENT_MS[1] - BIG_FRAGMENT_MS[0]);
        if (Math.random() < 0.6) throwShrapnel(this.shrapnel, m.x, m.y, 0.6, now);
      }
      const age = (now - m.born) / m.ms;
      drawFire(g, this.softBlob, this.offX + m.x * this.scale, this.offY + m.y * this.scale, this.scale * m.size, 1 - age, now, m.seed, still);
    }
    if (this.dustTiles) this.crystalDust.draw(now, this.softBlob, this.offX, this.offY, this.scale);
    // Damaged buildings and units smoulder, then burn. Drawn last so a crowded screen drops these before the fires of a fight.
    const health = this.state.world.store(Health);
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    for (const e of health.dense) {
      if (this.softsUsed >= SOFT_CAP) break;
      if (!this.sprites.has(e) || this.state.isSite(e)) continue;
      const s = this.state.stats(e);
      if (!s || health.f.hp[e] >= s.hp * DAMAGE_SMOKE_BELOW || health.f.hp[e] <= 0) continue;
      const p = this.screenOf(e);
      const size = s.structure ? s.footprint : Math.max(1, (s.radius * 2) / TILE);
      const reach = size * this.scale;
      if (p.x < -reach || p.y < -reach * 2 || p.x > w + reach || p.y > h + reach) continue;
      drawDamage(g, this.softBlob, p.x, p.y, this.scale, size, health.f.hp[e] / s.hp, now, e, still, this.softsUsed > SOFT_CAP / 2 ? 0.5 : 1);
    }
    this.hideSofts();
  }

  /** Which way a fireball is moving on screen (tiles per tick): along the ground, and up or down as the lob rises and falls. It keeps its last direction while it is momentarily still. */
  private flameDirection(e: number): { x: number; y: number } {
    const p = this.flameArcCur[e] / 255;
    const dp = (this.flameArcCur[e] - this.flameArcPrev[e]) / 255;
    const rise = lobHeight(p + dp * 0.5) - lobHeight(p - dp * 0.5);
    const x = this.curX[e] - this.prevX[e];
    const y = this.curY[e] - this.prevY[e] - rise;
    if (Math.abs(x) + Math.abs(y) > 1e-5) {
      this.flameDirX[e] = x;
      this.flameDirY[e] = y;
    }
    flameDirOut.x = this.flameDirX[e];
    flameDirOut.y = this.flameDirY[e] || (this.flameDirX[e] === 0 ? 0.001 : 0);
    return flameDirOut;
  }

  /** Hides the soft blobs this frame did not use. */
  private hideSofts(): void {
    for (let i = this.softsUsed; i < this.softs.length; i++) this.softs[i].visible = false;
  }

  /** How far along its lob a fireball is, 0..1, eased between the last two ticks so it rises and falls smoothly. */
  private flameProgress(e: number): number {
    const a = this.flameArcPrev[e] + (this.flameArcCur[e] - this.flameArcPrev[e]) * this.alpha;
    return a / 255;
  }

  /** Cannon shells in flight: a bright dot with a short streak behind it, above a small shadow. */
  private drawShells(g: Graphics): void {
    const store = this.state.world.store(Shell);
    const lift = this.scale * 0.3;
    for (const e of this.flying) {
      if (!store.has(e) || store.f.state[e] !== 0) continue;
      const p = this.screenOf(e);
      const angle = (store.f.heading[e] / 256) * Math.PI * 2;
      const r = Math.max(1.8, this.scale * 0.06);
      const len = this.scale * 0.55;
      g.circle(p.x, p.y, r * 0.8).fill({ color: 0x000000, alpha: 0.3 });
      const y = p.y - lift;
      g.moveTo(p.x - Math.cos(angle) * len, y - Math.sin(angle) * len).lineTo(p.x, y).stroke({ width: Math.max(1.5, r), color: ownerColour(store.f.owner[e]), alpha: 0.5 });
      g.circle(p.x, y, r).fill(SHELL_COLOUR);
    }
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
    if (this.powered(e)) dish.rotation = (now / 1000) * 2.4; // without power it stops where it is
  }

  /** Whether an entity has power to move and shine: some energy left (as replicated) and a CPU that is not reporting no power. */
  private powered(e: number): boolean {
    const { world } = this.state;
    return world.store(EnergyView).f.pct[e] > 0 && world.store(CpuStatus).f.state[e] !== CpuState.NoPower;
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
    if (!this.powered(e)) return; // dead turrets stay as they are: no tracking, no watch sweep
    let want = 0;
    let tracking = false;
    const aims = this.state.world.store(Aim);
    const aim = this.aimAt.get(e);
    if (aims.has(e)) {
      // A long-range weapon points where the engine says (its owner sees a wedge along it), not at random.
      want = (aims.f.heading[e] / 256) * Math.PI * 2 + Math.PI / 2 - s.rotation;
      tracking = true;
    } else if (aim) {
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

  /** Whether a shot-down unit crashes on instead of exploding where it was hit: some fliers, some of the time, in sight. */
  private crashes(e: number, sprite: Sprite): boolean {
    return !reduceMotion() && sprite.visible && this.wrecks.length < MAX_WRECKS && !!this.state.stats(e)?.flying && (this.alwaysCrash || shouldCrash());
  }

  /** Moves each tumbling wreck along its fall, trailing fire, and sets it off where it comes down. */
  private drawWrecks(now: number, k: number): void {
    for (const w of this.wrecks) {
      const t = wreckProgress(w, now);
      const ground = wreckGround(w, now);
      const gx = this.offX + ground.x * this.scale;
      const gy = this.offY + ground.y * this.scale;
      const up = wreckHeight(t) * this.scale;
      w.sprite.position.set(gx, gy - up);
      w.sprite.rotation = wreckRotation(w, t);
      w.sprite.scale.set(k * (1 - 0.2 * t));
      const char = Math.round(255 * (1 - 0.65 * t));
      w.sprite.tint = (char << 16) | (char << 8) | char;
      // The shadow stays on the ground and closes in on the wreck as it drops.
      w.shadow.position.set(gx, gy);
      w.shadow.rotation = w.sprite.rotation;
      w.shadow.scale.set(k * (1 - 0.1 * t));
      if (now >= w.nextSmoke) {
        w.nextSmoke = now + SMOKE_EVERY_MS;
        const at = { x: ground.x, y: ground.y - wreckHeight(t) };
        burstSparks(this.sparks, at.x, at.y, 2, now, { colour: WRECK_SPARK_COLOURS[Math.floor(Math.random() * WRECK_SPARK_COLOURS.length)], heading: Math.atan2(-w.vy, -w.vx), spread: 0.7, reach: [0.2, 0.5], ms: [180, 320] });
      }
    }
    landWrecks(this.wrecks, now, (w) => {
      const x = w.x + w.vx * w.ms;
      const y = w.y + w.vy * w.ms;
      w.sprite.destroy();
      w.shadow.destroy();
      this.explosions.push(makeBlast('fire', x, y, w.radius, now));
      throwShrapnel(this.shrapnel, x, y, w.radius, now);
      // Now and then the wreck is left burning where it came down (looks only; rain makes it rarer and shorter).
      const burn = this.embers.length < MAX_EMBERS && !reduceMotion() ? wreckFireMs((this.state.weather.mix[Sky.Rain] + this.state.weather.mix[Sky.Storm]) / 100, Math.random(), w.size) : 0;
      if (burn > 0) this.embers.push({ x, y, born: now, ms: burn, seed: Math.floor(Math.random() * 100000), size: wreckFlameSize(w.size), nextFrag: wreckThrowsFragments(w.size) ? now + BIG_FRAGMENT_MS[0] + Math.random() * (BIG_FRAGMENT_MS[1] - BIG_FRAGMENT_MS[0]) : Infinity });
    });
  }

  /**
   * Rebuilds the crystal field when a crystal appears or is used up, and draws it for the nodes on screen: a disc round each
   * crystal that has a neighbour and a thick bridge between each pair, so a cluster fills in as one patch of lit ground.
   * Only the look; spent crystals drop out, so a field shrinks as it is mined.
   */
  private drawCrystalField(): void {
    const world = this.state.world;
    if (this.fieldDirty) {
      this.fieldDirty = false;
      const res = world.store(Resource);
      const debris = world.store(Debris);
      this.fieldX = [];
      this.fieldY = [];
      for (const e of res.dense) {
        if (debris.has(e) || res.f.amount[e] <= 0 || !this.sprites.has(e)) continue;
        this.fieldX.push(this.tileX(e));
        this.fieldY.push(this.tileY(e));
      }
      this.field = this.fieldX.length > 1 ? buildField(this.fieldX, this.fieldY) : null;
      this.shards = this.field ? scatterShards(this.fieldX, this.fieldY, this.field) : null;
      this.buildFieldGlow();
      const t = this.state.terrain;
      this.dustTiles = this.fieldX.length > 0 ? dustMask(this.fieldX, this.fieldY, t.width, t.height) : null;
    }
    // The glow sprites live in tile coordinates, so panning and zooming only moves their parent.
    this.fieldGlow.position.set(this.offX, this.offY);
    this.fieldGlow.scale.set(this.scale);
    const sg = this.fieldShards.clear();
    const field = this.field;
    if (!field || field.links.length === 0) return;
    const s = this.scale;
    const w = this.app.screen.width, h = this.app.screen.height;
    const pad = FIELD_SKIRT * s;
    const sh = this.shards;
    if (!sh) return;
    for (let i = 0; i < sh.x.length; i++) {
      const x = this.offX + sh.x[i] * s, y = this.offY + sh.y[i] * s;
      if (x < -pad || y < -pad || x > w + pad || y > h + pad) continue;
      // A little two-tone shard like the ones on the crystals themselves: a lit side and a dark side.
      const len = sh.size[i] * 1.8 * s, wid = sh.size[i] * 0.5 * s;
      const dx = Math.cos(sh.angle[i]), dy = Math.sin(sh.angle[i]);
      const tx = x + dx * len, ty = y + dy * len;
      sg.poly([x - dy * wid, y + dx * wid, tx, ty, x, y]).fill({ color: RESOURCE_COLOUR, alpha: 0.85 });
      sg.poly([x + dy * wid, y - dx * wid, tx, ty, x, y]).fill({ color: 0x2a8f6c, alpha: 0.85 });
    }
  }

  /** One soft glow sprite for each crystal and along each bridge (see `glowPoints`): built when the field changes, then only moved with the camera. */
  private buildFieldGlow(): void {
    const g = glowPoints(this.fieldX, this.fieldY, this.field);
    const kids = this.fieldGlow.children as Sprite[];
    for (let i = 0; i < g.x.length; i++) {
      let sp = kids[i];
      if (!sp) {
        sp = new Sprite(this.glowTexture);
        sp.anchor.set(0.5);
        sp.tint = RESOURCE_COLOUR;
        this.fieldGlow.addChild(sp);
      }
      sp.visible = true;
      sp.position.set(g.x[i], g.y[i]);
      sp.scale.set((g.radius[i] * 2) / GLOW_SIZE);
      sp.alpha = g.alpha[i];
    }
    for (let i = g.x.length; i < kids.length; i++) kids[i].visible = false;
  }

  /** A ground vehicle on crystal ground leaves puffs of dust as it moves, a few per tile driven. Flyers, buildings and anything unseen leave none. */
  private kickDust(e: number, s: Sprite, dt: number, now: number): void {
    if (!s.visible || !this.state.world.store(Unit).has(e)) return;
    const stats = this.state.stats(e);
    if (!stats || stats.structure || stats.flying) return;
    const moved = Math.hypot(this.curX[e] - this.prevX[e], this.curY[e] - this.prevY[e]) / (this.tickMs / 1000) * dt; // tiles this frame
    if (moved < 1e-4) return;
    const t = this.state.terrain;
    const x = this.tileX(e), y = this.tileY(e);
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= t.width || ty >= t.height || !this.dustTiles![ty * t.width + tx]) return;
    const size = Math.min(2, Math.max(0.6, (stats.radius * 2) / TILE));
    let owed = this.dustOwed[e] + moved * DUST_PER_TILE * size;
    for (; owed >= 1; owed--) this.crystalDust.puff(x, y, now, Math.random(), Math.random(), size);
    this.dustOwed[e] = owed;
  }

  /** Keeps the drop shadow under a sprite: the same art in black, nudged away from the light; bigger things cast longer shadows. */
  private updateShadow(e: number, s: Sprite, k: number, dt: number): void {
    if (this.state.world.store(Resource).has(e)) return; // ore lies flat on the ground
    if (this.state.world.store(Feature).has(e) && this.state.world.store(Feature).f.kind[e] === FeatureKind.Vent) return; // and so does a vent
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

  /** A shot's two ends in screen pixels (reused array: read it before the next call). */
  private readonly shotPoints = [0, 0, 0, 0];
  private shotEnds(s: Shot): number[] {
    const p = this.shotPoints;
    const sc = this.scale;
    if (s.from && s.to) {
      p[0] = this.offX + s.from.x * sc;
      p[1] = this.offY + s.from.y * sc;
      p[2] = this.offX + s.to.x * sc;
      p[3] = this.offY + s.to.y * sc;
      return p;
    }
    const a = this.screenOf(s.a);
    p[0] = a.x;
    p[1] = a.y;
    if (s.end) {
      p[2] = this.offX + s.end.x * sc;
      p[3] = this.offY + s.end.y * sc;
    } else {
      const b = this.screenOf(s.b);
      p[2] = b.x;
      p[3] = b.y;
    }
    return p;
  }

  /** Does this design hold a battery? (Cached per design: its building bursts as a discharge.) */
  private holdsBattery(bpId: number): boolean {
    let v = this.batteryDesign.get(bpId);
    if (v === undefined) {
      v = hasBatteryPart(this.state.blueprints.get(bpId)?.parts ?? []);
      this.batteryDesign.set(bpId, v);
    }
    return v;
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
      if (this.dustTiles) this.kickDust(e, s, dt, now);
      const want = this.facing.get(e);
      if (want !== undefined) {
        // Shortest way round.
        const diff = Math.atan2(Math.sin(want - s.rotation), Math.cos(want - s.rotation));
        s.rotation += diff * turn;
      }
      this.updateShadow(e, s, k, dt);
    }
    this.drawCrystalField();
    this.drawWrecks(now, k);
    this.drawLiquidFx(now);
    this.halosUsed = 0;
    this.glowsUsed = 0; // drawNight (spotlights) and drawGlows (fire) both add to the pool
    this.drawNight(now, k);
    this.drawMist(now);
    this.precipitation.update(this.state, this.skyProbe, now, this.app.screen.width, this.app.screen.height, reduceMotion(), flashesAllowed(), weatherDetail() === 'fancy');
    this.drawSteam(now);
    this.drawChargeZones();
    this.drawLinks();
    this.drawSpotBeams(now);
    this.drawSmoke(now);
    this.drawShields(now);
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
   * A tesla discharge: a ring of charge races out from the coil to the edge of its range while arcs jump from point to
   * point ahead of it, preferring units and buildings in reach (see `makeDischarge`); each hop flashes and lights its surroundings.
   */
  private drawTesla(g: Graphics, p: Pulse, now: number): void {
    const c = p.spot ? this.tileToScreen(p.spot.x, p.spot.y) : this.screenOf(p.e);
    const age = (now - p.born) / PULSE_MS;
    const reach = (p.spot ? p.spot.radius : (this.state.stats(p.e)?.weapon?.range ?? 0) / TILE) * this.scale;
    const front = reach * (1 - (1 - Math.min(1, age * 1.6)) ** 2); // the ring eases out and arrives at ~60% of the time
    const fade = 1 - age;
    g.circle(c.x, c.y, front).fill({ color: p.colour, alpha: 0.12 * fade });
    g.circle(c.x, c.y, front).stroke({ width: 3, color: p.colour, alpha: 0.9 * fade });
    g.circle(c.x, c.y, front * 0.93).stroke({ width: 1.5, color: TESLA_CORE, alpha: 0.7 * fade });
    if (p.hops) drawDischarge(g, p.hops, age, p.colour, TESLA_CORE, flickerFrame(p.born, now, reduceMotion()), this.offX, this.offY, this.scale);
  }

  /**
   * Where the units and buildings in sight stand within `reach` tiles of a point (not entity `skip`), as a flat list of
   * x, y pairs, nearest first and at most DISCHARGE_TARGETS: the places a discharge may jump to. Runs once per discharge.
   */
  private dischargeTargets(x: number, y: number, reach: number, skip: number): number[] {
    const units = this.state.world.store(Unit);
    const found: { d: number; x: number; y: number }[] = [];
    const limit = reach * reach;
    for (const e of this.sprites.keys()) {
      if (e === skip || !units.has(e)) continue;
      const dx = this.curX[e] - x, dy = this.curY[e] - y;
      const d = dx * dx + dy * dy;
      if (d <= limit) found.push({ d, x: this.curX[e], y: this.curY[e] });
    }
    found.sort((a, b) => a.d - b.d);
    if (found.length > DISCHARGE_TARGETS) found.length = DISCHARGE_TARGETS;
    const flat: number[] = [];
    for (const f of found) flat.push(f.x, f.y);
    return flat;
  }

  /** The light of a discharge's live hops: a glow where each arc runs, and a bigger one where it lands on a unit or building. */
  private hopGlows(hops: readonly Hop[], t: number, colour: number, level: number): void {
    const sc = this.scale;
    for (let i = 0; i < hops.length; i++) {
      const h = hops[i];
      const s = hopStrength(h, t);
      if (s <= 0) continue;
      this.glow(this.offX + ((h.x0 + h.x1) / 2) * sc, this.offY + ((h.y0 + h.y1) / 2) * sc, (HOP_LIGHT_RADIUS * 0.6 + Math.hypot(h.x1 - h.x0, h.y1 - h.y0) * 0.35) * sc, colour, HOP_LIGHT_ALPHA * level * s);
      if (h.hit) this.glow(this.offX + h.x1 * sc, this.offY + h.y1 * sc, HOP_LIGHT_HIT_RADIUS * sc, colour, HOP_LIGHT_ALPHA * level * s);
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
    this.updateLamps(now);
    const sun = this.lightDaylight(); // for the lamps; the night dimming below follows the real daylight
    const dark = 1 - this.state.daylight / 100;
    const spill = Math.min(1, this.state.haze / HAZE_FULL_SPILL);
    const night = this.nightLayer;
    night.visible = dark > 0.01;
    const g = this.lightLayer.clear();
    this.spotsUsed = 0;
    if (!night.visible && sun >= LIGHTS_ON_BELOW) {
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
    const beamColour = mixColour(BEAM_COLOUR, BEAM_HAZE_COLOUR, spill);
    this.beamTint = (lift((beamColour >> 16) & 255, nr) << 16) | (lift((beamColour >> 8) & 255, ng) << 8) | lift(beamColour & 255, nb);
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
      const lit = glow * this.lampBrightness(e, now);
      if (lit < 0.005) continue; // out of power, or dark in a flicker
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
          b.alpha = lit * GUN_LAMP_ALPHA;
        }
      }
      if (stats.structure) {
        // Interior light spilling out: soft warm rings round the footprint, fainter outwards. Not while still being built.
        if (construction.has(e) || this.wallMasks.has(e)) continue; // a wall has no windows
        this.buildingLight(g, s.x, s.y, stats, lit);
        continue;
      }
      // The art's nose points up at rotation 0.
      const fx = Math.sin(s.rotation), fy = -Math.cos(s.rotation);
      const rx = -fy, ry = fx;
      if (stats.flying) {
        const wing = half * 0.8;
        const dot = Math.max(1.5, this.scale * 0.07);
        this.navLight(g, s.x - rx * wing, s.y - ry * wing, NAV_PORT, dot, lit);
        this.navLight(g, s.x + rx * wing, s.y + ry * wing, NAV_STARBOARD, dot, lit);
        if (strobe) this.navLight(g, s.x - fx * half * 0.8, s.y - fy * half * 0.8, 0xffffff, dot, lit);
        // A spotlight shining down: a few overlapping glows from the craft to the ground (where its shadow falls),
        // each wider and fainter than the last, so the light spreads and thins with altitude.
        const off = half * 2 * (SHADOW_OFFSET + AIR_SHADOW_LIFT * this.shadowLift[e]);
        const flying = Math.max(0, Math.min(1, (this.shadowLift[e] - AIR_HOVER_LIFT) / (1 - AIR_HOVER_LIFT)));
        const far = this.scale * (SPOT_MIN_RADIUS + (SPOT_MAX_RADIUS - SPOT_MIN_RADIUS) * flying), near = far * 0.3;
        for (let i = 0; i < SPOT_STEPS; i++) {
          const t = i / (SPOT_STEPS - 1);
          this.spot(s.x + off * t, s.y + off * t, near + (far - near) * t, SPOT_ALPHA * lit * (1 - 0.75 * t));
        }
        continue;
      }
      const lamps = this.lampsOf(unit.f.blueprint[e]);
      for (let i = 0; i < lamps.length; i++) {
        const lamp = lamps[i];
        const b = this.beamSprite(used++);
        b.position.set(s.x + fx * half * 0.75 + rx * half * lamp.side, s.y + fy * half * 0.75 + ry * half * lamp.side);
        b.rotation = s.rotation;
        const along = beamScale * (0.7 + 0.3 * lamp.power);
        b.scale.set(along * (1 + HAZE_BEAM_WIDEN * spill), along);
        b.alpha = Math.min(1, lit * lamp.power * (1 + HAZE_BEAM_BRIGHTEN * spill));
      }
      // Light scattered by the haze: a pale pool round the vehicle, a little ahead of it.
      if (spill > 0.02 && lamps.length > 0) this.spot(s.x + fx * half * 0.9, s.y + fy * half * 0.9, this.scale * HAZE_POOL_RADIUS * (0.8 + 0.4 * lamps.length / 2), HAZE_POOL_ALPHA * lit * spill);
    }
    for (let i = used; i < this.beams.length; i++) this.beams[i].visible = false;
    this.hideSpots();
  }

  /**
   * Decides which lamps are on: after dark, a unit or building with energy left (and a working CPU, if it has one)
   * has its lights on; with none they go out. Every switch starts a flicker (see `lampLevel`), staggered a little from
   * lamp to lamp so a whole base does not blink in step. First sight of something is not a switch. Runs in daylight too,
   * so everything is known to be off when dusk comes.
   */
  private updateLamps(now: number): void {
    const dark = this.lightDaylight() < LAMPS_SWITCH_BELOW;
    const { world } = this.state;
    const sites = world.store(Construction);
    const unit = world.store(Unit);
    for (const e of this.sprites.keys()) {
      if (!unit.has(e)) continue;
      const want = dark && this.powered(e) && !sites.has(e) ? 2 : 1;
      const have = this.lampState[e];
      if (have === want) continue;
      this.lampState[e] = want;
      this.lampSince[e] = have === 0 ? -1e9 : now + ((Math.imul(e, 2654435761) >>> 0) % 150);
    }
  }

  /**
   * Mist: soft, wide wisps of pale haze that belong to the ground. Each has a place on the map and drifts slowly across
   * it with the wind, so it moves with the world when the camera does, not with the screen. They are drawn over the
   * units, buildings and effects, have no hard edge, and are only a faint tint; lights halo through them (`glow`). The fog of war turns pale and
   * soft in mist as well (`drawFog`). Still with Reduce motion; left out entirely with the weather set to Simple.
   */
  private drawMist(now: number): void {
    const mist = this.state.weather.mix[Sky.Mist] / 100;
    const layer = this.mistLayer;
    this.mistAmount = mist < 0.01 || weatherDetail() !== 'fancy' ? 0 : mist;
    if (this.mistAmount === 0) {
      layer.visible = false;
      return;
    }
    layer.visible = true;
    const { width, height } = this.state.terrain;
    const t = reduceMotion() ? 0 : now / 1000;
    const drift = MIST_WISP_DRIFT + (this.state.wind / 100) * 0.3;
    const sc = this.scale;
    const screenW = this.app.screen.width, screenH = this.app.screen.height;
    for (let i = 0; i < MIST_WISPS; i++) {
      let sp = this.mistWisps[i];
      if (!sp) {
        sp = new Sprite(this.mistTexture);
        sp.anchor.set(0.5);
        sp.tint = MIST_WISP_COLOUR;
        layer.addChild(sp);
        this.mistWisps[i] = sp;
      }
      const radius = MIST_WISP_RADIUS * (0.7 + 0.8 * hash01(i, 2));
      const span = width + 2 * radius * MIST_WISP_STRETCH;
      const x = ((hash01(i, 1) * span + t * drift * (0.5 + hash01(i, 3))) % span) - radius * MIST_WISP_STRETCH;
      const y = hash01(i, 4) * height + Math.sin(t * 0.2 + i) * 0.6;
      const sx = this.offX + x * sc, sy = this.offY + y * sc;
      const rx = radius * MIST_WISP_STRETCH * sc, ry = radius * sc;
      if (sx + rx < 0 || sy + ry < 0 || sx - rx > screenW || sy - ry > screenH) {
        sp.visible = false;
        continue;
      }
      sp.visible = true;
      sp.position.set(sx, sy);
      sp.scale.set((rx * 2) / GLOW_SIZE, (ry * 2) / GLOW_SIZE);
      sp.alpha = MIST_WISP_ALPHA * mist * (0.6 + 0.4 * hash01(i, 5));
    }
  }

  /** The daylight that decides when lamps are on: the sun, cut by haze, so mist and dust bring the headlights on by day. */
  private lightDaylight(): number {
    return lampDaylight(this.state.daylight, this.state.haze);
  }

  /** Brightness (0..1) of an entity's lamps now: settled on or off, or mid-flicker. */
  private lampBrightness(e: number, now: number): number {
    const on = this.lampState[e] === 2;
    return flickerAllowed() ? lampLevel(now - this.lampSince[e], on, e) : on ? 1 : 0;
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
    if (this.mistAmount > 0.02) this.halo(x, y, radius * HALO_RADIUS, colour, Math.min(HALO_MAX_ALPHA, alpha * HALO_ALPHA * this.mistAmount));
  }

  /** The light a source throws on the mist over it: a wide, very soft additive puff in the light's colour. */
  private halo(x: number, y: number, radius: number, colour: number, alpha: number): void {
    if (alpha < 0.01 || this.halosUsed >= HALO_CAP) return;
    if (x + radius < 0 || y + radius < 0 || x - radius > this.app.screen.width || y - radius > this.app.screen.height) return;
    let s = this.halos[this.halosUsed];
    if (!s) {
      s = new Sprite(this.mistTexture);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      this.haloLayer.addChild(s);
      this.halos[this.halosUsed] = s;
    }
    this.halosUsed++;
    s.visible = true;
    s.position.set(x, y);
    s.scale.set((radius * 2) / GLOW_SIZE);
    s.tint = colour;
    s.alpha = alpha;
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
      if (t < 0) continue; // not gone off yet (a flak burst waits for its shell)
      const cx = this.offX + x.x * sc, cy = this.offY + x.y * sc;
      const r = Math.max(1, x.radius) * sc;
      this.glow(cx, cy, r * (x.lightScale - 0.8 * t), x.palette.light, 0.9 * level * (1 - t) ** 1.6);
      const flash = Math.max(0, 1 - t / 0.25);
      this.glow(cx, cy, r * 1.6, 0xffffff, 0.8 * level * flash);
      if (x.discharge.length > 0) this.hopGlows(x.discharge, x.kind === 'shield' ? (t - SHIELD_IMPLODE) / (1 - SHIELD_IMPLODE) : t, x.kind === 'shield' ? x.colour : x.palette.ring, level);
    }
    // Lava lights the night: a faint orange pool over every few cells of it.
    const lava = this.liquids?.lava;
    if (lava && lava.length > 0 && this.state.daylight < 85) {
      const flicker = reduceMotion() ? 1 : 0.85 + 0.15 * Math.sin(now / 500);
      for (let i = 0; i < lava.length; i += 2) this.glow(this.offX + lava[i] * sc, this.offY + lava[i + 1] * sc, sc * 2.4, 0xff7a1f, 0.3 * level * flicker * (i % 3 ? 1 : 0.8));
    }
    if (this.devGlows.length > 0) {
      this.devGlows = this.devGlows.filter((d) => now - d.born < d.ms);
      for (const d of this.devGlows) {
        const t = Math.max(0, (now - d.born) / d.ms);
        this.glow(this.offX + d.x * sc, this.offY + d.y * sc, d.radius * sc, d.colour, 0.9 * level * (1 - t) ** 1.6);
      }
    }
    for (const s of this.shots) {
      const age = (now - s.born) / s.ms;
      const size = Math.min(1.6, 0.35 + 0.07 * Math.sqrt(s.damage));
      const colour = s.kind === 'laser' ? s.colour : MUZZLE_LIGHT;
      const [ax, ay, bx, by] = this.shotEnds(s);
      this.glow(ax, ay, size * sc, colour, 0.8 * level * (1 - age) ** 2);
      this.glow(bx, by, size * 0.7 * sc, colour, 0.6 * level * (1 - age));
      // A laser lights the ground along its length, not only at its ends.
      if (s.kind === 'laser') this.glow((ax + bx) / 2, (ay + by) / 2, size * 0.9 * sc + Math.hypot(bx - ax, by - ay) * 0.25, colour, 0.35 * level * (1 - age));
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
      if (p.hops) this.hopGlows(p.hops, age, p.colour, level);
      const range = p.spot ? p.spot.radius * TILE : this.state.stats(p.e)?.weapon?.range ?? 0;
      const c = p.spot ? this.tileToScreen(p.spot.x, p.spot.y) : this.screenOf(p.e);
      this.glow(c.x, c.y, Math.min(3, Math.max(1, (range / TILE) * 0.3)) * sc, p.colour, 0.8 * level * (1 - age) ** 2);
    }
    const flames = this.state.world.store(Flame);
    // A jet lays many fires: only some give light, a little wider each, so the pool is not used up.
    const glowEvery = Math.max(1, Math.ceil(flames.dense.length / 40));
    for (const e of this.flying) {
      if (!flames.has(e)) continue;
      const p = this.screenOf(e);
      const f = flicker(now, e, reduceMotion());
      if (flames.f.state[e] === 1) {
        if (e % glowEvery !== 0) continue;
        const s = fireStrength(flames.f.life[e] / FLAME_LIFE_STEPS);
        this.glow(p.x, p.y - sc * 0.2, sc * 2.4 * f * (0.5 + 0.5 * s) * (1 + 0.25 * Math.sqrt(glowEvery - 1)), FIRE_LIGHT, 0.8 * level * s);
      } else {
        this.glow(p.x, p.y - lobHeight(this.flameProgress(e)) * sc, sc * 1.2 * f, FIRE_LIGHT, 0.85 * level);
      }
    }
    for (let i = this.glowsUsed; i < this.glows.length; i++) this.glows[i].visible = false;
    for (let i = this.halosUsed; i < this.halos.length; i++) this.halos[i].visible = false;
  }

  /**
   * Darkens tiles out of view: lightly where seen before, heavily where never seen. The fog is a picture one pixel per
   * tile (`fogImage`), redrawn when vision changes and stretched over the map with smoothing, so the edge of what you
   * can see fades over a couple of tiles instead of stepping tile by tile.
   */
  private drawFog(): void {
    const v = this.state.vision;
    const { width, height } = this.state.terrain;
    const view = this.fogView;
    if (!this.state.fog || v.length !== width * height) {
      view.visible = false;
      return;
    }
    // In mist the fog turns pale and its edge widens; the amount is rounded so the picture is redrawn in steps while mist comes and goes.
    const mist = Math.round(this.state.weather.mix[Sky.Mist] / 5) / 20;
    const key = `${this.state.visionVersion}|${width}x${height}|${mist}`;
    if (key !== this.fogDrawnFor) {
      this.fogDrawnFor = key;
      if (!this.fogCanvas || this.fogCanvas.width !== width || this.fogCanvas.height !== height) {
        this.fogCanvas = document.createElement('canvas');
        this.fogCanvas.width = width;
        this.fogCanvas.height = height;
        this.fogTexture?.destroy(true);
        this.fogTexture = Texture.from(this.fogCanvas);
        this.fogTexture.source.scaleMode = 'linear';
        view.texture = this.fogTexture;
      }
      const ctx = this.fogCanvas.getContext('2d')!;
      const img = ctx.createImageData(width, height);
      fogImage(v, width, height, img.data, mist);
      ctx.putImageData(img, 0, 0);
      this.fogTexture!.source.update();
    }
    view.visible = true;
    view.position.set(this.offX, this.offY);
    view.scale.set(this.scale);
  }

  /** The straight runs (x0, y0, x1, y1 in tiles) along the border of explored ground; rebuilt when vision changes. */
  private exploredEdge: number[] = [];
  private exploredEdgeFor = '';

  /** A hard green line along the limit of the explored ground, drawn while placing a building: nothing can be built past it. */
  private drawExploredEdge(g: Graphics): void {
    const v = this.state.vision;
    const { width, height } = this.state.terrain;
    if (!this.state.fog || v.length !== width * height) return;
    const key = `${this.state.visionVersion}|${width}x${height}`;
    if (key !== this.exploredEdgeFor) {
      this.exploredEdgeFor = key;
      const seg: number[] = (this.exploredEdge = []);
      for (let y = 1; y < height; y++) {
        let start = -1;
        for (let x = 0; x <= width; x++) {
          const edge = x < width && v[(y - 1) * width + x] > 0 !== v[y * width + x] > 0;
          if (edge && start < 0) start = x;
          else if (!edge && start >= 0) {
            seg.push(start, y, x, y);
            start = -1;
          }
        }
      }
      for (let x = 1; x < width; x++) {
        let start = -1;
        for (let y = 0; y <= height; y++) {
          const edge = y < height && v[y * width + x - 1] > 0 !== v[y * width + x] > 0;
          if (edge && start < 0) start = y;
          else if (!edge && start >= 0) {
            seg.push(x, start, x, y);
            start = -1;
          }
        }
      }
    }
    const seg = this.exploredEdge;
    if (seg.length === 0) return;
    const { offX, offY, scale } = this;
    for (let i = 0; i < seg.length; i += 4) {
      g.moveTo(offX + seg[i] * scale, offY + seg[i + 1] * scale).lineTo(offX + seg[i + 2] * scale, offY + seg[i + 3] * scale);
    }
    g.stroke({ width: 2, color: EXPLORED_EDGE_COLOUR, alpha: 0.95 });
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
      this.drawExploredEdge(g);
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

    this.pulses = this.pulses.filter((p) => now - p.born < PULSE_MS && (p.spot !== undefined || this.sprites.has(p.e)));
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
    const still = reduceMotion();
    for (const x of this.explosions) drawBlast(g, x, now, this.offX, this.offY, this.scale, still);
    landShrapnel(this.shrapnel, now, this.landFragment);
    drawShrapnel(g, this.shrapnel, now, this.offX, this.offY, this.scale);
    expireSparks(this.sparks, now);
    drawSparks(g, this.sparks, now, this.offX, this.offY, this.scale);

    this.drawMissiles(g, now);
    this.drawShells(g);
    this.drawFlames(g, now, still);
    this.drawWeaponFx(g, now, still);

    this.shots = this.shots.filter((s) => now - s.born < s.ms && (s.from !== undefined || (this.sprites.has(s.a) && this.sprites.has(s.b))));
    for (const s of this.shots) {
      const [ax, ay, bx, by] = this.shotEnds(s);
      drawShot(g, s.kind, ax, ay, bx, by, (now - s.born) / s.ms, s.colour, shotPower(s.damage), this.scale, s.seed, still);
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
    // A fragment that bounced now and then leaves a small fire where it comes to rest (looks only: it does no damage). Rain smothers it.
    const wet = (this.state.weather.mix[Sky.Rain] + this.state.weather.mix[Sky.Storm]) / 100;
    if (this.embers.length < MAX_EMBERS && !reduceMotion() && Math.random() < emberChance(s, wet)) {
      this.embers.push({ x: s.tx, y: s.ty, born: now, ms: emberLife(wet), seed: Math.floor(Math.random() * 100000), size: 0.45, nextFrag: Infinity });
    }
    if (this.explosions.length < MAX_EXPLOSIONS && Math.random() < 0.6) this.explosions.push(makeBlast('shell', s.tx, s.ty, SHRAPNEL_BLAST_RADIUS, now));
    burstSparks(this.sparks, s.tx, s.ty, 4 + Math.floor(Math.random() * 5), now, {
      colour: SHRAPNEL_SPARK_COLOURS[Math.floor(Math.random() * SHRAPNEL_SPARK_COLOURS.length)],
      reach: [0.15, 0.5],
      ms: [200, 420],
    });
  };

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
    // Faint contour lines on the open ground (cached per map; rock is painted over them below).
    const contourKey = `${t.width}x${t.height}:${this.state.seed}:${t.version}`;
    if (contourKey !== this.contourFor) {
      this.contourFor = contourKey;
      this.contours = contourSegments(t.width, t.height, this.state.seed, (x, y) => t.isPassable(x, y));
    }
    const cs = this.contours;
    for (let i = 0; i < cs.length; i += 4) {
      g.moveTo(this.offX + cs[i] * this.scale, this.offY + cs[i + 1] * this.scale).lineTo(this.offX + cs[i + 2] * this.scale, this.offY + cs[i + 3] * this.scale);
    }
    g.stroke({ width: 1, color: 0x34425a, alpha: 0.45 });
    // Rock is painted over the grid so the lines only show on open ground. Outer (convex) corners are
    // rounded: a corner is rounded where both of its sides face tiles outside the shape being filled.
    const rad = this.scale * 0.23;
    const PI = Math.PI;
    const open = (x: number, y: number) => !t.isRock(x, y); // liquid is open to the eye: only rock is drawn solid
    this.drawLiquids(g, t);
    const fillShape = (inShape: (x: number, y: number) => boolean, out: Graphics = g) => {
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
            out.rect(l, top, this.scale + 0.5, this.scale + 0.5);
            continue;
          }
          out.moveTo(l + tl, top).lineTo(r - tr, top);
          if (tr) out.arc(r - tr, top + tr, tr, -PI / 2, 0);
          out.lineTo(r, b - br);
          if (br) out.arc(r - br, b - br, br, 0, PI / 2);
          out.lineTo(l + bl, b);
          if (bl) out.arc(l + bl, b - bl, bl, PI / 2, PI);
          out.lineTo(l, top + tl);
          if (tl) out.arc(l + tl, top + tl, tl, PI, PI * 1.5);
          out.closePath();
        }
      }
    };
    fillShape((x, y) => !open(x, y));
    g.fill(0x343b47);
    this.rockMask.clear();
    fillShape((x, y) => !open(x, y), this.rockMask);
    this.rockMask.fill(0xffffff);

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

  /**
   * Water, lava and voids, under the rock. Straight shores follow the cell edges and corners are rounded (`liquids.ts`). Each tier
   * is drawn over the one above it, so the colour deepens step by step; the steps are feathered with a soft stroke on their edge.
   * The dry side of every shore gets a few widening, fading bands (wet ground, a lava glow, a dark lip), and the shore itself foam,
   * a cooled crust with a hot inner line, or a crumbling pale rim.
   */
  private drawLiquids(g: Graphics, t: Terrain): void {
    const key = `${t.width}x${t.height}:${t.shape}`;
    if (key !== this.liquidsFor) {
      this.liquidsFor = key;
      this.liquids = t.hasLiquid ? buildLiquids(t) : null;
    }
    const foam = this.foamG.clear();
    const hot = this.lavaG.clear();
    const L = this.liquids;
    if (!L || L.tiers.length === 0) return;
    const s = this.scale;
    const ox = this.offX;
    const oy = this.offY;
    const trace = (gg: Graphics, loop: Loop) => {
      gg.moveTo(ox + loop[0] * s, oy + loop[1] * s);
      for (let i = 2; i < loop.length; i += 2) gg.lineTo(ox + loop[i] * s, oy + loop[i + 1] * s);
      gg.closePath();
    };
    const fill = (loops: Loop[], nest: { parent: number[]; depth: number[] }, colour: number, alpha: number) => {
      for (let i = 0; i < loops.length; i++) {
        if (nest.depth[i] % 2) continue; // an island is cut out of its lake below
        trace(g, loops[i]);
        g.fill({ color: colour, alpha });
        for (let j = 0; j < loops.length; j++) {
          if (nest.parent[j] === i && nest.depth[j] % 2) {
            trace(g, loops[j]);
            g.cut();
          }
        }
      }
    };
    const strokeAll = (gg: Graphics, loops: Loop[], width: number, colour: number, alpha: number) => {
      for (const l of loops) trace(gg, l);
      gg.stroke({ width, color: colour, alpha, join: 'round' });
    };
    // Dry-side bands first, so the fills cover their inner halves.
    for (const o of L.tiers) {
      if (o.tier.index !== 0) continue;
      if (o.tier.kind === 'water') for (const [w, a] of [[0.95, 0.07], [0.6, 0.1], [0.3, 0.14]]) strokeAll(g, o.shore, s * w, 0x0d1a22, a);
      else if (o.tier.kind === 'lava') for (const [w, a] of [[1.5, 0.05], [0.95, 0.08], [0.5, 0.13]]) strokeAll(g, o.shore, s * w, 0xb8400f, a);
      else for (const [w, a] of [[0.9, 0.1], [0.5, 0.18], [0.25, 0.28]]) strokeAll(g, o.shore, s * w, 0x000000, a);
    }
    for (const o of L.tiers) {
      const { kind, index } = o.tier;
      if (kind === 'water') {
        const [colour, alpha] = WATER_TIERS[index];
        fill(o.fill, o.nest, colour, alpha);
        if (index > 0) strokeAll(g, o.fill, s * 0.4, colour, alpha * 0.5); // feather: the outer half softens the step above
      } else if (kind === 'lava') {
        const [colour, alpha] = LAVA_TIERS[index];
        fill(o.fill, o.nest, colour, alpha);
        if (index > 0) strokeAll(g, o.fill, s * 0.3, colour, alpha * 0.5);
        if (index === 1) strokeAll(hot, o.fill, Math.max(1, s * 0.07), 0xffa347, 0.6);
        if (index === 2) strokeAll(hot, o.fill, Math.max(1, s * 0.1), 0xffe29a, 0.5);
      } else {
        fill(o.fill, o.nest, 0x06080c, 1);
        strokeAll(g, o.fill, s * 0.35, 0x06080c, 0.5);
      }
    }
    // Cooler, darker patches in the lava: overlapping blotches on interior cells (so none spill past a shore), plus a few big, faint
    // ones every other cell for the broad variation. Drawn once with the terrain, not per frame.
    const isLava = (x: number, y: number) => { const d = t.depthAt(x, y); return d >= 6 && d <= 8; };
    for (let y = 0; y < t.height; y++) {
      for (let x = 0; x < t.width; x++) {
        if (!isLava(x, y) || !isLava(x - 1, y) || !isLava(x + 1, y) || !isLava(x, y - 1) || !isLava(x, y + 1)) continue;
        const h = cellHash(x * 7919 + 3, y * 104729 + 11);
        const broad = cellHash(x >> 1, y >> 1) % 100 < 40; // 2x2 clumps share a roll, so the dark comes in patches
        if (broad) {
          g.circle(ox + (x + 0.5 + ((h >>> 4) % 50) / 250 - 0.1) * s, oy + (y + 0.5 + ((h >>> 12) % 50) / 250 - 0.1) * s, s * (0.38 + ((h >>> 20) % 25) / 100))
            .fill({ color: 0x1c0803, alpha: 0.22 + ((h >>> 8) % 20) / 100 });
        }
        if (h % 100 < 22) {
          g.circle(ox + (x + 0.5 + ((h >>> 6) % 50) / 160 - 0.15) * s, oy + (y + 0.5 + ((h >>> 14) % 50) / 160 - 0.15) * s, s * (0.15 + ((h >>> 22) % 20) / 100))
            .fill({ color: 0x2a0d04, alpha: 0.35 });
        }
      }
    }
    // Shores.
    for (const o of L.tiers) {
      if (o.tier.index !== 0) continue;
      if (o.tier.kind === 'water') {
        strokeAll(foam, o.shore, s * 0.24, 0x8fd0de, 0.22);
        strokeAll(foam, o.shore, Math.max(1, s * 0.06), 0xe3f6fa, 0.65);
      } else if (o.tier.kind === 'lava') {
        strokeAll(g, o.shore, Math.max(1.5, s * 0.16), 0x24100a, 0.85); // cooled crust
        strokeAll(hot, o.shore, Math.max(1, s * 0.05), 0xff8a2a, 0.45);
      } else {
        strokeAll(g, o.shore, Math.max(1.5, s * 0.22), 0x4a586e, 0.3); // crumbling lip
        strokeAll(g, o.shore, Math.max(1, s * 0.07), 0x9fb0c8, 0.3);
      }
    }
  }

  /**
   * Life on the liquids, all cheap and capped: the shore foam and lava glow breathe (an alpha each), pale glints drift over water on the
   * wind, bubbles swell and pop on lava, and ground units wading leave a ring behind them. None of it with Reduce motion; the glints,
   * bubbles and wakes only with Fancy weather effects.
   */
  private drawLiquidFx(now: number): void {
    const gl = this.glintG.clear();
    const t = this.state.terrain;
    if (!this.liquids || this.liquids.tiers.length === 0) {
      this.lavaSteam.visible = false;
      return;
    }
    const still = reduceMotion();
    this.foamG.alpha = still ? 0.85 : 0.7 + 0.2 * Math.sin(now / 900);
    this.lavaG.alpha = still ? 0.85 : 0.65 + 0.35 * Math.sin(now / 650 + 1);
    this.lavaSteam.visible = false;
    if (still || weatherDetail() !== 'fancy') return;
    const s = this.scale;
    const X = (tx: number) => this.offX + tx * s;
    const Y = (ty: number) => this.offY + ty * s;
    const x0 = Math.max(0, Math.floor(-this.offX / s));
    const y0 = Math.max(0, Math.floor(-this.offY / s));
    const x1 = Math.min(t.width - 1, Math.ceil((this.app.screen.width - this.offX) / s));
    const y1 = Math.min(t.height - 1, Math.ceil((this.app.screen.height - this.offY) / s));
    if (x1 < x0 || y1 < y0) return;
    const cols = x1 - x0 + 1;
    const rows = y1 - y0 + 1;
    const wind = this.state.wind / 100;
    for (let k = 0; k < GLINT_CAP; k++) {
      const period = 1600 + (k % 7) * 230;
      const cycle = Math.floor(now / period + k * 0.37);
      const phase = (now / period + k * 0.37) % 1;
      const h = cellHash(k, cycle);
      const cx = x0 + (h % cols);
      const cy = y0 + (Math.floor(h / cols) % rows);
      const d = t.depthAt(cx, cy);
      if (d >= 1 && d <= 5) {
        // A short pale streak sliding with the wind and fading in and out.
        const x = X(cx + 0.5 + ((h >>> 8) % 100) / 200 - 0.25 + wind * phase * 0.6);
        const y = Y(cy + 0.5 + ((h >>> 16) % 100) / 200 - 0.25);
        const a = Math.sin(phase * Math.PI) * (0.18 + 0.05 * d);
        gl.moveTo(x - s * 0.18, y).lineTo(x + s * 0.18, y).stroke({ width: Math.max(1, s * 0.05), color: 0xd6f1f7, alpha: a });
      } else if (d >= 6 && d <= 8 && k < BUBBLE_CAP) {
        // A bubble swells, then pops into a bright fleck.
        const x = X(cx + 0.5 + ((h >>> 8) % 100) / 220 - 0.22);
        const y = Y(cy + 0.5 + ((h >>> 16) % 100) / 220 - 0.22);
        if (phase < 0.8) gl.circle(x, y, s * (0.04 + 0.1 * phase)).stroke({ width: Math.max(1, s * 0.03), color: 0xffc25a, alpha: 0.6 * (1 - phase) });
        else gl.circle(x, y, s * 0.06 * (phase - 0.7) * 6).fill({ color: 0xfff0b0, alpha: 0.5 * (1 - phase) * 5 });
      }
    }
    // Rain ripples: while it rains, rings spread on water cells in view. Not tied to the streaks, only to how wet it is.
    const wet = Math.min(1, this.state.weather.wetness / 100);
    const ripples = Math.floor(RIPPLE_CAP * wet);
    for (let k = 0; k < ripples; k++) {
      const period = RIPPLE_MS * (0.8 + 0.5 * ((k * 7) % 5) / 5);
      const u = now / period + k * 0.41;
      const phase = u % 1;
      const h = cellHash(k + 211, Math.floor(u));
      const cx = x0 + (h % cols);
      const cy = y0 + (Math.floor(h / cols) % rows);
      const d = t.depthAt(cx, cy);
      if (d < 1 || d > 5) continue;
      const x = X(cx + ((h >>> 8) % 100) / 100);
      const y = Y(cy + ((h >>> 16) % 100) / 100);
      const fade = (1 - phase) * 0.5;
      gl.circle(x, y, s * (0.06 + 0.34 * phase)).stroke({ width: Math.max(1, s * 0.04), color: 0xe3f6fa, alpha: fade });
      if (phase > 0.3) gl.circle(x, y, s * (0.34 * (phase - 0.3))).stroke({ width: Math.max(1, s * 0.03), color: 0xe3f6fa, alpha: fade * 0.6 });
    }
    // Lava steam: the mist's soft wisps again, a few at a time, rising and widening off sparse lava cells and fading as they go; thicker in rain.
    const lamps = this.liquids.lava;
    const lampCount = lamps.length / 2;
    if (lampCount > 0) {
      this.lavaSteam.visible = true;
      const peak = STEAM_ALPHA + STEAM_WET_ALPHA * wet;
      const wind = this.state.wind / 100;
      for (let k = 0; k < STEAM_CAP; k++) {
        let sp = this.steamWisps[k];
        if (!sp) {
          sp = new Sprite(this.mistTexture);
          sp.anchor.set(0.5);
          sp.tint = STEAM_COLOUR;
          this.lavaSteam.addChild(sp);
          this.steamWisps[k] = sp;
        }
        const period = 5500 + (k % 5) * 1300;
        const u = now / period + k * 0.37;
        const phase = u % 1;
        const h = cellHash(k + 401, Math.floor(u));
        const li = (h % lampCount) * 2;
        const cx = lamps[li], cy = lamps[li + 1];
        if (cx < x0 - 2 || cx > x1 + 2 || cy < y0 - 2 || cy > y1 + 2) {
          sp.visible = false;
          continue;
        }
        const r = (0.9 + 1.1 * phase) * s;
        sp.visible = true;
        sp.position.set(X(cx + ((h >>> 12) % 100) / 100 - 0.5 + wind * phase * 1.5), Y(cy - phase * 1.6));
        sp.scale.set((r * 2.4) / GLOW_SIZE, (r * 2) / GLOW_SIZE);
        sp.alpha = peak * Math.sin(phase * Math.PI);
      }
    }
    // Spat fragments, very occasionally: a few slots, each firing on roughly one cycle in four and only if its cell is lava. A glowing
    // fleck lobs up and over, cooling from orange to dark as it falls.
    for (let k = 0; k < SPIT_SLOTS; k++) {
      const period = 7000 + k * 2300;
      const u = now / period + k * 0.29;
      const phase = u % 1;
      const flight = SPIT_MS / period;
      if (phase >= flight) continue;
      const h = cellHash(k + 91, Math.floor(u));
      if (h % 4 !== 0) continue;
      if (lampCount === 0) continue;
      const li = ((h >>> 4) % lampCount) * 2; // one of the sparse lava cells kept for lighting
      const cx = Math.floor(lamps[li]);
      const cy = Math.floor(lamps[li + 1]);
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
      const p = phase / flight;
      const ang = ((h >>> 9) % 628) / 100;
      const reach = 0.7 + ((h >>> 19) % 100) / 100;
      const x = X(cx + 0.5 + Math.cos(ang) * reach * p);
      const y = Y(cy + 0.5 + Math.sin(ang) * reach * p) - s * 1.1 * 4 * p * (1 - p);
      const hot = 1 - p;
      const colour = hot > 0.55 ? 0xffd27a : hot > 0.25 ? 0xf47a1e : 0x6a2208;
      gl.circle(x, y, s * 0.09).fill({ color: 0xff8a2a, alpha: 0.25 * hot });
      gl.circle(x, y, s * 0.045).fill({ color: colour, alpha: 0.95 });
    }
    // Wakes: a ring spreading behind each ground unit that is moving through water.
    for (const e of this.sprites.keys()) {
      const st = this.state.stats(e);
      if (!st || st.structure || st.flying) continue;
      const px = this.curX[e];
      const py = this.curY[e];
      if (px < x0 - 1 || px > x1 + 1 || py < y0 - 1 || py > y1 + 1) continue;
      if (Math.abs(px - this.prevX[e]) + Math.abs(py - this.prevY[e]) < 0.002) continue;
      const d = t.depthAt(Math.floor(px), Math.floor(py));
      if (d < 1 || d > 8) continue;
      const phase = (now / 700 + e * 0.13) % 1;
      const lava = d >= 6;
      gl.circle(X(px), Y(py), s * (st.hover ? 0.3 + 0.5 * phase : 0.25 + 0.35 * phase)).stroke({ width: Math.max(1, s * 0.05), color: lava ? 0xffb066 : 0xe3f6fa, alpha: (1 - phase) * (lava ? 0.5 : 0.4) });
    }
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

  /** A vent or a piece of scenery: one texture per kind and variant, shared by every sprite of it. */
  private featureTexture(kind: number, variant: number): Texture {
    if (kind === FeatureKind.Vent) return this.texture('feature.vent', (g) => drawVent(g, TEX));
    return this.texture(`feature.${kind}.${variant}`, (g) => drawScenery(g, kind, variant, TEX));
  }

  /** Steam over the vents that are on screen: open, capped by a site or a building, or worked by a steam turbine. */
  private drawSteam(now: number): void {
    const g = this.steamLayer.clear();
    const features = this.state.world.store(Feature);
    if (features.dense.length === 0) return;
    const pos = this.state.world.store(Position);
    const reduced = reduceMotion();
    const w = this.app.screen.width, h = this.app.screen.height;
    const reach = this.scale * 2;
    for (const e of features.dense) {
      if (features.f.kind[e] !== FeatureKind.Vent) continue;
      const p = this.screenOf(e);
      if (p.x < -reach || p.y < -reach || p.x > w + reach || p.y > h + reach) continue;
      drawVentSteam(g, p.x, p.y, this.scale, this.state.ventCover.get(e) ?? 0, now, e, reduced);
    }
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
  async previewImage(parts: readonly string[], pxPerTile: number, owner = this.state.myId, fit?: number): Promise<string> {
    return renderClassImage(this.app.renderer, parts, ownerColour(owner), fit ? (w, h) => fit / Math.max(w, h, 1) : () => pxPerTile / TEX);
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
      /** Spreads index `i` round a disc: a point at distance `rr` at the golden angle. */
      const onDisc = (i: number, rr: number): [number, number] => [Math.cos(i * 2.399963) * rr, Math.sin(i * 2.399963) * rr];
      // No slab or brackets round the crystals: the soft glow of the field (see drawCrystalField) lights the ground instead, so no square edge shows.
      for (let i = 0; i < 8 + Math.round(14 * rich); i++) {
        const ga = i * 2.399963, gr = (0.5 + 0.5 * ((i * 0.618) % 1)) * TEX;
        const [gx, gy] = [Math.cos(ga) * gr, Math.sin(ga) * gr];
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
        const [sx, sy] = onDisc(i + 0.25, (0.42 + 0.7 * t + 0.05 * wob(i, 5)) * TEX);
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
    this.flameArcPrev = grow(this.flameArcPrev);
    this.flameDirX = grow(this.flameDirX);
    this.flameDirY = grow(this.flameDirY);
    this.flameArcCur = grow(this.flameArcCur);
    this.dustOwed = grow(this.dustOwed);
    const state = new Uint8Array(n);
    state.set(this.lampState);
    this.lampState = state;
    const since = new Float64Array(n);
    since.set(this.lampSince);
    this.lampSince = since;
  }
}
