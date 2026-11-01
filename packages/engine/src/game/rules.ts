/**
 * Balance sheet. Every number that shapes gameplay lives here, so a balance pass
 * only needs this file: world scale, ranges, energy, economy, combat, limits,
 * map set-up, and the stats of every module (PART_TUNING at the bottom).
 * Server and client both import it, so keep it free of side effects.
 */

/** World positions are integers in sub-tile units, keeping the simulation deterministic. */
export const TILE = 1024;

/** Interaction ranges, measured from a building's edge (or a unit's centre). */
export const HARVEST_RANGE = 1.5 * TILE;
/** A cargo module's `harvestRate` is for a hull of this radius (tiles, a light chassis); other hulls gather in proportion to their radius. */
export const HARVEST_REFERENCE_RADIUS = 0.3;
export const DOCK_RANGE = 1.5 * TILE;
/** Energy transfer reach, from the giver: units only reach neighbours; buildings (charging pads) reach further. */
export const UNIT_TRANSFER_RANGE = 1 * TILE;
export const BUILDING_TRANSFER_RANGE = 3 * TILE;
/** Charging pads use the building-scale transfer range. */
export const CHARGE_RANGE = BUILDING_TRANSFER_RANGE;
/**
 * Charging pads deliver their listed charge rate times this per unit per tick,
 * limited by the energy the pad's own store (topped up by its grid) actually holds.
 */
export const CHARGE_PAD_RATE_MULTIPLIER = 2;
/**
 * Units whose centre is within this distance (sub-tile units) of a charging building's
 * centre are charged: the transfer range measured from the building's edge (see
 * Simulation.transferEnergy; units have no footprint).
 */
export const chargeZoneRadius = (footprint: number): number => (footprint * TILE) / 2 + CHARGE_RANGE;
export const BUILD_RANGE = 1.5 * TILE;
/** Build cranes on buildings (construction towers) reach further. */
export const BUILDING_BUILD_RANGE = 4 * TILE;
/** Share of a finished building's cost returned when it is demolished (sites return everything invested). */
export const DEMOLISH_REFUND = 0.5;

/** Energy to construct a building: this much per tile it covers (so 1x1 = 250, 2x2 = 1000, 3x3 = 2250). */
export const BUILD_ENERGY_PER_TILE = 250;
export const buildEnergyCost = (area: number): number => area * BUILD_ENERGY_PER_TILE;
/** Radar pulse: energy per tile of range (the script chooses how much to spend, up to the module's limit). */
export const RADAR_ENERGY_PER_TILE = 25;
/** Ticks a radar module must rest after a pulse (10 ticks = 1 second). */
export const RADAR_COOLDOWN_TICKS = 100;
/** Ticks until a radar contact has faded from the map entirely. */
export const RADAR_FADE_TICKS = 300;
/** Builders off the grid stop building at this share of their energy capacity, so they can still reach a charger. */
export const BUILDER_ENERGY_RESERVE = 0.25;
/** A unit with no energy for this many ticks falls apart into a matter block worth its cost. */
export const DECAY_TICKS = 600;

/** A solar panel on a mobile unit (not a building): weighs this many times as much, breaks after this percent of the damage, and yields this percent of the output. */
export const MOBILE_SOLAR_MASS_FACTOR = 4;
export const MOBILE_SOLAR_INTEGRITY_PERCENT = 25;
export const MOBILE_SOLAR_EFFICIENCY_PERCENT = 25;
/** Multiplier applied to solar output after scaling by daylight (1 = unchanged). */
export const SOLAR_GENERATION_MULTIPLIER = 5;
/** Multiplier applied to wind output after scaling by wind intensity (1 = unchanged). */
export const WIND_GENERATION_MULTIPLIER = 3;

/** Matter a new natural patch holds (also the cap it regenerates up to). */
export const RESOURCE_PATCH_AMOUNT = 1400;
/** Natural matter patches regenerate one unit at this interval, up to their initial amount. */
export const RESOURCE_REGEN_INTERVAL_TICKS = 5;

/** Share of generation lost per tile of link gap in a network, up to a maximum. */
export const TRANSMISSION_LOSS_PER_TILE = 0.0001;
export const MAX_TRANSMISSION_LOSS = 0.7;

/**
 * Links no longer than BASE_LINK_RANGE tiles (edge to edge) carry any amount of energy. Longer
 * links, which exist because of an antenna, carry at most this much per tick for each antenna
 * on the building, times the building's footprint (tiles per side); several antennas on one
 * building add up. A long link uses the stronger of its two ends.
 */
export const ANTENNA_THROUGHPUT_PER_TILE = 20;

/** A discharging storage building gives at most this share of its capacity to the network per tick. */
export const STORAGE_DISCHARGE_FRACTION = 0.02;
/** A storage never discharges below this share of its capacity, and below it refills as a normal consumer whatever its mode. */
export const STORAGE_RESERVE_FRACTION = 0.02;

/** Tesla coil: stun radius (sub-tile units), stun length and recharge time (ticks, 10 per second). */
export const TESLA_RANGE = 3 * TILE;
/** Radius of a flak burst around the missile it is aimed at (sub-tile units). */
export const FLAK_BURST_RADIUS = Math.floor(1.5 * TILE);
/** Damage a flak burst does to each enemy flying unit inside it (missiles take the weapon's own damage). */
export const FLAK_AIR_DAMAGE = 8;

/**
 * Smoke launcher: a volley of SMOKE_CANISTERS canisters thrown SMOKE_THROW out, one straight ahead and the others SMOKE_SPREAD (radians)
 * to each side. Each makes a cloud of SMOKE_RADIUS that lasts SMOKE_TICKS and blocks sight; a laser through it does SMOKE_LASER_PERCENT %.
 * The module then rests SMOKE_COOLDOWN ticks. At most MAX_SMOKE clouds exist at once (the oldest vanish first).
 */
export const SMOKE_CANISTERS = 3;
export const SMOKE_SPREAD = (25 * Math.PI) / 180;
export const SMOKE_THROW = 4 * TILE;
export const SMOKE_RADIUS = Math.floor(1.5 * TILE);
export const SMOKE_TICKS = 150;
export const SMOKE_COOLDOWN = 300;
export const SMOKE_LASER_PERCENT = 50;
export const MAX_SMOKE = 120;

/**
 * Point defence: each working module shoots at the nearest enemy missile or cannon shell within PD_RANGE every PD_COOLDOWN ticks.
 * A missile is hit like any shot at it (its own hit chance) for PD_DAMAGE; a shell is destroyed with PD_SHELL_HIT_PERMILLE in a thousand.
 */
export const PD_RANGE = 3 * TILE;
export const PD_COOLDOWN = 4;
export const PD_DAMAGE = 4;
export const PD_SHELL_HIT_PERMILLE = 350;

/**
 * Railgun: charges RAIL_CHARGE_TICKS before it fires (and the energy is spent when the charge starts). The charge is lost if the carrier
 * takes RAIL_BREAK_PERMILLE of its hit points in damage, is stunned, loses the module or the target, or is ordered to move. The shot
 * pierces up to RAIL_PIERCE enemies, each after the first taking RAIL_FALLOFF_PERMILLE of the one before.
 */
export const RAIL_CHARGE_TICKS = 50;
export const RAIL_PIERCE = 4;
export const RAIL_FALLOFF_PERMILLE = 600;
export const RAIL_BREAK_PERMILLE = 150;

/** Ion gun: the module it hits is off for ION_TICKS, and the target cannot be ion-disabled again for ION_IMMUNITY_TICKS after. A shield that stops the bolt loses ION_SHIELD_DRAIN energy. */
export const ION_TICKS = 60;
export const ION_IMMUNITY_TICKS = 40;
export const ION_SHIELD_DRAIN = 100;

/**
 * Drone bay: each bay module holds DRONE_BAY_CAPACITY micro drones. A drone is built at DRONE_BUILD_PERCENT of the normal build time,
 * launched one per DRONE_LAUNCH_GAP ticks, and docks when it is within DRONE_DOCK_RANGE of its carrier. Docked drones are recharged by
 * DRONE_RECHARGE energy and mended by DRONE_REPAIR hit points a tick.
 */
export const DRONE_BAY_CAPACITY = 2;
export const DRONE_BUILD_PERCENT = 150;
export const DRONE_LAUNCH_GAP = 5;
export const DRONE_DOCK_RANGE = 1.2 * TILE;
export const DRONE_RECHARGE = 10;
export const DRONE_REPAIR = 1;
export const TESLA_STUN_TICKS = 30;
export const TESLA_COOLDOWN = 150;
/** A tesla mounted on a vehicle also stuns that vehicle, for this share of the full duration. */
export const TESLA_SELF_STUN_FACTOR = 0.5;

/**
 * Missiles are slow, homing shots that fly as entities of their own (see game/missile.ts). A
 * launcher spends `matter` per missile and the warhead does MISSILE_DAMAGE_PER_MATTER damage for
 * each unit of it, so damage is proportional to what the missile costs to make. Bigger missiles
 * fly slower, turn wider, last longer, have more hit points and are easier to hit.
 */
export const MISSILE_DAMAGE_PER_MATTER = 12;
/** A fresh missile leaves up to this many radians off the line to its target, so its arc shows. */
export const MISSILE_LAUNCH_SPREAD = 0.45;
/** A missile bursts when within this distance (sub-tile units) of the edge of an enemy unit or building. */
export const MISSILE_FUSE_RADIUS = Math.floor(0.45 * TILE);
/** Damage at the very edge of a blast, as a share of the damage at its centre (linear in between). */
export const MISSILE_EDGE_DAMAGE = 0.4;

// --- Cannon shells & elevation (see shell.ts) ----------------------------------------

/** Shell speed in tiles per tick (12 tiles/s): fast enough to read as a dot, slow enough that a mover can dodge a long shot. */
export const SHELL_SPEED = 1.2;
/** A shell hits a unit whose centre is this close (a building: within its footprint), in sub-tile units. */
export const SHELL_UNIT_RADIUS = Math.floor(0.35 * TILE);
/** Spread of the aim, radians either way. */
export const SHELL_SPREAD = 0.03;
/** Chance a shell that strikes an enemy glances off instead of exploding, and the same for rock it cannot clear. */
export const SHELL_BOUNCE_UNIT_CHANCE = 0.1;
export const SHELL_BOUNCE_ROCK_CHANCE = 0.3;
/** Most bounces one shell makes; each keeps this share of its remaining flight and speed. */
export const SHELL_MAX_BOUNCES = 2;
export const SHELL_BOUNCE_KEEP = 0.6;
/** Extra range (sub-tile units) per level a shooter stands above its target (rock height 0 to 9; flyers count as FLYER_ELEVATION). */
export const ELEVATION_RANGE_PER_LEVEL = Math.floor(0.5 * TILE);
export const FLYER_ELEVATION = 2;
/** A weapon that outranges its owner's sight sees a thin wedge this wide either way (radians, about 10 degrees) along the way it points, out to its range. */
export const WEAPON_CONE_HALF_ANGLE = 0.17;
/** A new unit with a matter-burning weapon (cannon, missiles) starts with this many shots in its cargo bay. */
export const STARTING_SHOTS = 10;

// --- Flamethrower (see flame.ts) -------------------------------------------------------

/** A lobbed fireball flies at this many tiles per tick (3 tiles/s): slow enough to watch, to dodge, and for a shield to turn it. */
export const FLAME_SPEED = 0.3;
/** A fire burns anything whose body reaches within this of its centre (sub-tile units), friend or foe. */
export const FLAME_RADIUS = Math.floor(0.9 * TILE);
/**
 * A fire from a projector's stream burns for this many ticks (5 s) and hurts what is in it every FLAME_BURN_INTERVAL ticks. The projector fires
 * about every other tick, so many fires overlap on the target: each does little, the jet does a lot. A dying carrier's fire burns longer.
 */
export const FLAME_BURN_TICKS = 50;
export const FLAME_BURST_BURN_TICKS = 80;
export const FLAME_BURST_DAMAGE = 3;
export const FLAME_BURN_INTERVAL = 5;
export const FLAME_BURN_DAMAGE = 1;
/** The projector pays 1 matter for this many shots, so a stream of fireballs is cheap (it fires about 5 a second). */
export const FLAME_SHOTS_PER_MATTER = 4;
/** How far the fireballs of a jet scatter round the aim point, sub-tile units either way, so the stream does not land in one heap. */
export const FLAME_SPREAD = Math.floor(0.8 * TILE);
/** Most fireballs and fires alive at once, so a burst of flamers cannot swamp the tick. */
export const MAX_FLAMES = 600;
/** A unit or building carrying a flame projector takes this many times the damage: it is full of fuel. */
export const FLAME_VULNERABILITY = 2;
/** When one dies it throws this many fireballs in every direction (a building: this many more), each landing up to FLAME_BURST_REACH tiles out. */
export const FLAME_BURST_COUNT = 16;
export const FLAME_BURST_STRUCTURE_BONUS = 6;
export const FLAME_BURST_REACH = 4;
/** Damage a fireball counts as when it strikes an enemy shield (what the shield's battery pays for). */
export const FLAME_SHIELD_DAMAGE = 6;
/** A fireball turned back by a shield flies this share of the way it had come, and is turned at most this many times. */
export const FLAME_DEFLECT_KEEP = 0.6;
export const FLAME_MAX_DEFLECTIONS = 3;
/** Rain puts fires out: at full wetness a fire burns down this many times faster than the 1x of a dry day, in proportion to how wet it is. */
export const FLAME_RAIN_BURN_FACTOR = 4;

// --- Energy shields (see shield.ts) -------------------------------------------------------

/** Energy a shield drains from its owner's battery for each point of damage it stops. */
export const SHIELD_ENERGY_PER_DAMAGE = 4;
/** When a shield runs its owner's battery flat it collapses: the owner takes this share of its energy capacity as damage. */
export const SHIELD_BURST_DAMAGE_FRACTION = 0.03;
/** The most a shield turns towards its aim in one tick (radians, about 9 degrees: half a turn takes 2 s). */
export const SHIELD_TURN_PER_TICK = 0.15;
/** `incomingBearing()` looks for enemy shells and missiles in flight this far from the caller (sub-tile units). */
export const SHIELD_INCOMING_RANGE = 10 * TILE;
/** Arc, radius and heading move this share of the way to what a script asked for, every tick, so changes ease in instead of jumping. */
export const SHIELD_EASE = 0.2;
/** Each point where two shields' arcs cross (any owners) multiplies the energy both pay per tick by this much. */
export const SHIELD_INTERFERENCE_DRAIN = 1.5;
/** The shield sits at least this far (sub-tile units) outside the hull, so it never has to cut through the unit that casts it. */
export const SHIELD_CLEARANCE = Math.floor(0.5 * TILE);

// --- Spotlights (see light.ts) -------------------------------------------------------------

/** A spotlight lights a beam this many tiles long for every point of energy per tick it is given. */
export const LIGHT_TILES_PER_ENERGY = 4;
/** Half the width of a spotlight's beam (radians, about 11 degrees): wider than a weapon's sight cone, so it is a lamp and not a pencil. */
export const LIGHT_HALF_ANGLE = 0.2;
/** The most a spotlight turns towards its aim in one tick (radians, about 4 degrees: a half turn takes about 4 s). */
export const LIGHT_TURN_PER_TICK = 0.07;
/** A spotlight is at full strength while its owner holds this much energy or more, dims in proportion as the store falls, and is out at LIGHT_OFF_BELOW (and below). Absolute amounts, so it does not depend on how many batteries a building has. */
export const LIGHT_FULL_ABOVE = 100;
export const LIGHT_OFF_BELOW = 30;
/** `outwardBearing()` looks at allied units and buildings this far round the light (tiles) to find which way is away from home. */
export const LIGHT_HOME_RADIUS = 15;
/** `lightBlocked(degrees)` says yes when an allied unit stands within this many tiles of the beam, inside its width plus LIGHT_FRIEND_MARGIN (radians). */
export const LIGHT_FRIEND_RANGE = 10;
export const LIGHT_FRIEND_MARGIN = 0.1;

// --- World & timing ----------------------------------------------------------------

/** Ticks in one day/night cycle (2 minutes at 10 Hz). Daylight during the first DAYLIGHT_TICKS, then night. */
export const DAY_LENGTH = 1200;
/** Ticks of each cycle with the sun up (84 s); the rest (36 s) is night. */
export const DAYLIGHT_TICKS = 840;
/** Light left at night (0..100): starlight and moonlight, so `lightLevel()` never drops to nothing. */
export const MOONLIGHT = 8;
/** Ticks between new random wind targets; the wind drifts smoothly between them. */
export const WIND_CHANGE_TICKS = 100;
/** Weather: the match is cut into slots of this many ticks (one minute), and each slot is dry or has one kind of weather. */
export const SKY_SLOT_TICKS = 600;
/** Chance (percent of slots) of each kind of weather; the rest are dry. All are rare. */
export const RAIN_PERCENT = 9;
export const STORM_PERCENT = 4;
export const HEAT_PERCENT = 3;
export const DUST_PERCENT = 2;
export const MIST_PERCENT = 4;
/**
 * How fast the weather changes: at the start of each slot the old weather gives way to the new over a time chosen
 * for that slot between these two lengths (in ticks, 15 s to 45 s), every effect sliding linearly. Most changes
 * creep in; now and then one is quicker (but still slow). Keep the longest below `SKY_SLOT_TICKS`.
 */
export const SKY_RAMP_MIN_TICKS = 150;
export const SKY_RAMP_MAX_TICKS = 450;
/** When the dev tools force a different sky the change slides over this many ticks (unless they set the change time). */
export const SKY_DEV_RAMP_TICKS = 60;
/** What each kind of weather does at full strength (the dev tools' intensity scales it down). */
export const RAIN_SOLAR_CAP = 65;
export const RAIN_WIND_FLOOR = 20;
export const STORM_SOLAR_CAP = 30;
export const STORM_WIND_FLOOR = 45;
/** A heatwave lifts what panels make by this percent and leaves the wind no higher than the ceiling. */
export const HEAT_SOLAR_GAIN = 125;
export const HEAT_WIND_CEILING = 35;
/** Dust: sunlight is capped, the wind is strong, and sight shrinks. */
export const DUST_SOLAR_CAP = 70;
export const DUST_WIND_FLOOR = 55;
/** Mist: a light cut to the sunlight and a big one to sight. */
export const MIST_SOLAR_CAP = 85;
/** Haze (0..100) of each kind of weather at full strength: sight shrinks by this percent of `HAZE_VISION_FRACTION` of its range, but never below `HAZE_MIN_SIGHT`. */
export const RAIN_HAZE = 10;
export const STORM_HAZE = 20;
export const DUST_HAZE = 65;
export const MIST_HAZE = 40;
export const HAZE_VISION_FRACTION = 0.5;
export const HAZE_MIN_SIGHT = 2 * TILE;
/** Mean ticks between lightning strikes in a storm (a strike is chosen from the tick, so every client sees the same ones). */
export const LIGHTNING_MEAN_TICKS = 40;
/** Lightning stuns the CPU of everything within this many sub-tile units of where it lands, for this many ticks (a short tesla stun). */
export const LIGHTNING_RADIUS = Math.floor(1.5 * TILE);
export const LIGHTNING_STUN_TICKS = 10;

/** How far (sub-tile units) a unit sees with no sensor, and a building. A longer sensor range wins. */
export const UNIT_VISION = 4 * TILE;
export const BUILDING_VISION = 6 * TILE;
/** At full dark every viewer loses a quarter of its sight range, but never more than this (in world units); the loss follows daylight. */
export const NIGHT_VISION_LOSS = 3 * TILE;
export const NIGHT_VISION_FRACTION = 0.25;

/** Units closer than this (sub-tile units) push each other apart: the two hull radii plus SEPARATION_GAP. */
export const SEPARATION_GAP = Math.floor(0.1 * TILE);
/** Flying units fly in arcs: the tightest turn at full speed has this radius (sub-tile units), and slower flight turns tighter. */
export const FLY_TURN_RADIUS = Math.floor(1.2 * TILE);
/** A flying unit starts to circle its goal when this close (sub-tile units); it circles for FLY_LOITER_TICKS plus up to FLY_LOITER_SPREAD more (by unit), at FLY_LOITER_SPEED percent speed, then lands straight in. */
export const FLY_LOITER_RADIUS = 6 * TILE;
export const FLY_LOITER_TICKS = 18;
export const FLY_LOITER_SPREAD = 14;
export const FLY_LOITER_SPEED = 60;
/** Cruising flyers weave about the straight line by up to this many radians (each its own phase), fading out near the goal. */
export const FLY_WEAVE = 0.3;

/** Separation of two light units (radius 0.3 each), the old fixed value. */
export const SEPARATION_RADIUS = Math.floor(0.7 * TILE);

// --- Terrain height and legs ----------------------------------------------------------

/** Rock heights run 1..MAX_TERRAIN_HEIGHT (open ground is 0); a rock cell's height is how deep it lies inside its outcrop. */
export const MAX_TERRAIN_HEIGHT = 9;
/** Cliffs: outcrops whose rock is at least this high right at the edge, so only colossus legs (and rotors) cross them. */
export const CLIFF_HEIGHT = 3;
/** Every CLIFF_EVERY-th outcrop of a map is a cliff (chosen by position in the list, so no extra random numbers are drawn). */
export const CLIFF_EVERY = 4;
/** A legged unit walking on rock moves at this share of its speed, in thousandths. */
export const CLIMB_SPEED_PERMILLE = 500;

// --- Liquids: terrain below ground level ------------------------------------------------

/**
 * Liquid depth per cell, 0 (dry) to 9, set by `Terrain.depth`. The band decides the kind of liquid:
 * 1-2 shallow water, 3-5 deep water, 6-8 lava, 9 a void (a drop with no floor). A cell is either rock
 * (height 1..MAX_TERRAIN_HEIGHT) or liquid (depth 1..MAX_LIQUID_DEPTH), never both.
 */
export const MAX_LIQUID_DEPTH = 9;
export const SHALLOW_MAX = 2;
export const DEEP_MAX = 5;
export const LAVA_MAX = 8;
export const VOID_DEPTH = 9;
/** The deepest liquid every ground unit may wade into (shallow water), and what the hover and amphibious drives reach. */
export const DEFAULT_WADE = SHALLOW_MAX;
export const AMPHIBIOUS_WADE = DEEP_MAX;
export const HOVER_WADE = LAVA_MAX;
/** A ground unit wading through liquid moves at this share of its speed, in thousandths, by liquid kind (index: 1 shallow, 2 deep, 3 lava); hover drives skim at full speed. */
export const WADE_SPEED_PERMILLE: readonly number[] = [1000, 600, 450, 450, 450];
/** A step through liquid costs this many tenths of a dry step in the path search (the speeds above, rounded up), so a ford is chosen over a long detour only when it is worth it. */
export const WADE_STEP_COST: readonly number[] = [10, 17, 22, 22, 22];
/** Every LAVA_HEAT_TICKS ticks a hover unit over lava takes LAVA_HEAT_DAMAGE, and a ground unit stranded in lava (painted under it, say) LAVA_STRAND_DAMAGE; one over a void falls and is lost. */
export const LAVA_HEAT_TICKS = 5;
export const LAVA_HEAT_DAMAGE = 3;
export const LAVA_STRAND_DAMAGE = 60;

// --- Class derivation (how modules combine into stats) -----------------------------

/** Unit speed = thrust × this ÷ total mass (sub-tile units per tick). */
export const SPEED_FACTOR = 48;
/** Ground and air units speed up gradually: reaching top speed from a standstill takes ACCEL_TICKS_BASE plus ACCEL_TICKS_PER_TILE for every tile of hull radius (a micro hull about 0.5 s, a colossus about 1.8 s). */
export const ACCEL_TICKS_BASE = 2;
export const ACCEL_TICKS_PER_TILE = 16;
/** Braking is this many times faster than accelerating (also used to slow down for a corner ahead). */
export const BRAKE_FACTOR = 2;
/** The slowest a turn makes a unit go, as a share of top speed: a turn of 90 degrees or more drops it to this; gentler turns scale between (the cosine of the turn). */
export const CORNER_MIN_SPEED = 0.25;
/** Call-stack depth every class has before CPU stack bonuses. */
export const BASE_STACK = 8;
/** Power-link reach (tiles) of a building with no antenna. */
export const BASE_LINK_RANGE = 1;
/** Matter cost of a class = COST_PER_MASS × total mass + CYCLE_COST × the cycles of all its CPUs. */
export const COST_PER_MASS = 10;
export const CYCLE_COST = 1;
/**
 * Bigger hulls cost exponentially more, so the biggest units are late-game goals. Micro, light and medium
 * are the baseline (x1); each tier above medium multiplies the matter cost and the production energy by
 * this factor again (heavy x2.5, super-heavy x6.25, colossus about x15.6). Buildings are not scaled.
 */
export const SIZE_COST_FACTOR = 2.5;
export const MEDIUM_SIZE = 2;
export const sizeCostMultiplier = (chassisSize: number): number => SIZE_COST_FACTOR ** Math.max(0, chassisSize - MEDIUM_SIZE);
/** Production time of a class (ticks) = BUILD_TIME_BASE + BUILD_TIME_PER_MASS × mass. */
export const BUILD_TIME_BASE = 10;
export const BUILD_TIME_PER_MASS = 4;
/**
 * Energy a factory spends producing one unit, spread over its build time: this much per
 * module (any type, the chassis excluded) plus a per-type amount from the table (by slot).
 */
export const PRODUCTION_ENERGY_PER_MODULE = 5;
/** Matter per hit point repaired, and how many times more armour plating costs to mend than the rest. */
export const REPAIR_MATTER_PER_HP = 0.1;

/**
 * Module damage. Every hit also lands on one module (chosen at random, or by the shooter's aim): the
 * module takes the same damage as the hull, and breaks when it has taken its `integrity`, which is
 * MODULE_HP_BASE + MODULE_HP_PER_MASS x its mass unless the part says otherwise. A broken module
 * does nothing until repaired. Armour, memory and batteries cannot break, but they soak up the hits
 * that land on them.
 */
export const MODULE_HP_BASE = 25;
export const MODULE_HP_PER_MASS = 6;
export const REPAIR_ARMOR_MULTIPLIER = 4;
export const PRODUCTION_ENERGY_BY_SLOT: Readonly<Record<string, number>> = {
  cpu: 30,
  memory: 10,
  motor: 40,
  sensor: 20,
  weapon: 60,
  armor: 15,
  cargo: 20,
  battery: 10,
  factory: 50,
  depot: 10,
  charger: 20,
  generator: 30,
  antenna: 15,
  builder: 40,
  radar: 40,
  comms: 15,
  repair: 40,
  shield: 60,
  light: 20,
};

// --- Construction, production & limits ---------------------------------------------

/** Construction sites start at this fraction of their hit points and grow with progress. */
export const SITE_START_HP = 0.1;
export const MAX_SITES_PER_PLAYER = 12;
export const MAX_PRODUCTION_QUEUE = 8;
/**
 * Typed factory modules. A chassis of size tier s (0 micro, 1 light, 2 medium, 3 heavy, 4 super-heavy,
 * 5 colossus) can only be built by a building with a factory module of exactly that tier, so a bigger
 * factory is not automatically a better small one: a building needs one module per tier it should build.
 */
export const FACTORY_TIER_COUNT = 6;
/** Bit mask of the tiers a set of factory modules builds (bit s = chassis size s). */
export const factoryTierBit = (tier: number): number => 1 << tier;
/** Whether a factory with module mask `tiers` can build a chassis of size `chassisSize`. */
export const factoryCanBuild = (tiers: number, chassisSize: number): boolean => (tiers & factoryTierBit(chassisSize)) !== 0;
/** Names of the tiers, for messages. */
export const FACTORY_TIER_NAMES = ['micro', 'light', 'medium', 'heavy', 'super-heavy', 'colossus'] as const;

export const MAX_UNITS_PER_PLAYER = 256;
/** Includes the starter classes (41), so players have room for dozens of their own. A class is a shared flyweight, so the limit costs nothing per tick; it bounds the designs a player can load and the blueprint list sent at join (raised from 48 on 2026-10-30). */
export const MAX_CLASSES_PER_PLAYER = 128;
/** Retired classes keep their id for good, so redefining over and over would fill the id space: this caps every class an owner ever made. */
export const MAX_CLASSES_EVER_PER_PLAYER = 512;
/** Path-search work (A* cells expanded, and tiles of line-of-sight tested while smoothing) the planner may do per tick; routes beyond it wait for later ticks, so one big group order cannot stall the server. */
export const PLAN_WORK_PER_TICK = 12_000;

// --- Match set-up ------------------------------------------------------------------

/** Matter each player starts with, placed in their HQ's silos. */
export const STARTING_CREDITS = 300;
/** Natural matter patches near each base and near the centre of the map, and the neutral wanderers. */
export const BASE_FIELD_PATCHES = 6;
export const CENTRE_FIELD_PATCHES = 6;
export const NEUTRAL_UNITS = 4;

// --- Co-op-mode bots ------------------------------------------------------------
// Bots cheat: their buildings and units are kept at full energy and their silos full,
// so they never need to mine. They build each wave's units on demand and send them in growing waves.

/** Ticks between bot decisions (production top-ups and wave checks). */
export const BOT_THINK_TICKS = 10;
/** Units each assembler keeps queued, and the most mobile units a bot fields at once. */
export const BOT_QUEUE_DEPTH = 2;
export const BOT_MAX_UNITS = 256;
/** First wave leaves after this many ticks; later waves every BOT_WAVE_INTERVAL_TICKS (10 ticks = 1 second). */
export const BOT_FIRST_WAVE_TICKS = 1800;
export const BOT_WAVE_INTERVAL_TICKS = 2400;
/** Each wave is BOT_WAVE_BASE_SIZE + BOT_WAVE_GROWTH per earlier wave; bots build only that many, then wait. */
export const BOT_WAVE_BASE_SIZE = 2;
export const BOT_WAVE_GROWTH = 1;
/** Idle fighters further than this many tiles from their base press on to the next target instead of waiting. */
export const BOT_STAGING_RADIUS = 8;

// --- Single Player scenarios (scenario.ts) -------------------------------------------------
/** Surrounded: the four bots start and wave more slowly than a lone bot (multiplies BOT_FIRST_WAVE_TICKS and BOT_WAVE_INTERVAL_TICKS). */
export const SURROUNDED_BOT_PACE = 1.75;
/** Horde: first group after this many ticks, then one every HORDE_INTERVAL_TICKS (10 ticks = 1 second). */
export const HORDE_FIRST_TICKS = 900;
export const HORDE_INTERVAL_TICKS = 60;
/** A group is HORDE_GROUP_BASE units, plus one more per HORDE_GROWTH_TICKS elapsed. */
export const HORDE_GROUP_BASE = 1;
export const HORDE_GROWTH_TICKS = 3000;
/** The next class in the bot roster joins the rotation every HORDE_TIER_TICKS. */
export const HORDE_TIER_TICKS = 3600;
/** Most horde units alive at once; spawning pauses until some fall. */
export const HORDE_MAX_ALIVE = 120;

// --- Generators --------------------------------------------------------------------

/** Peak output of one solar panel and one wind turbine, in energy per tick (before the multipliers above). */
export const SOLAR_PANEL_OUTPUT = 0.5;
export const WIND_TURBINE_OUTPUT = 1;
/** One steam turbine on a vent: steady, whatever the weather or the hour. */
export const STEAM_TURBINE_OUTPUT = 1;
/** Multiplier applied to steam output (1 = unchanged). A turbine yields STEAM_TURBINE_OUTPUT x this per tick. */
export const STEAM_GENERATION_MULTIPLIER = 2;

// --- Module stats ------------------------------------------------------------------

/**
 * Numbers for every module, by part id. Descriptions and names in the catalogue
 * (parts.ts) are generated from these, so they stay in step. Units: hp = hit
 * points, energy = storage, cycles = per tick, sensorRange / antennaRange in
 * tiles, use = energy per use (see PartDef.use), cooldown in ticks.
 */
/** How a missile flies. Speed in tiles per tick, turn in degrees per tick, flight in ticks, blast in tiles. */
export interface MissileTuning {
  readonly speed: number;
  readonly turn: number;
  /** Ticks in the air before it bursts on its own. */
  readonly flight: number;
  readonly hp: number;
  /** Radius of the burst. */
  readonly blast: number;
  /** Chance that a hit-scan shot at it connects: small missiles are hard to hit. */
  readonly hitChance: number;
}

/** A launcher whose damage follows from the matter each missile costs. */
const missileLauncher = (matter: number, range: number, cooldown: number, missile: MissileTuning) =>
  ({ range, damage: matter * MISSILE_DAMAGE_PER_MATTER, cooldown, matter, missile });

export interface PartTuning {
  readonly mass: number;
  readonly hp?: number;
  /** Damage this one module takes before it breaks (see MODULE_HP_BASE); legs are made deliberately fragile. */
  readonly integrity?: number;
  /** Chassis/frame: how many modules fit. */
  readonly slots?: number;
  readonly energy?: number;
  readonly cycles?: number;
  readonly memory?: number;
  readonly stack?: number;
  readonly thrust?: number;
  /** Legs: the highest terrain (rock height) they can walk onto. */
  readonly climb?: number;
  /** Amphibious and hover drives: the deepest liquid (`Terrain.depth`) the unit may enter. */
  readonly wade?: number;
  /** Hover drives skim over liquid at full speed. */
  readonly hover?: boolean;
  readonly sensorRange?: number;
  /** Sensor tier: what a Detected block may configure (see sensor.ts). */
  readonly sensorTier?: number;
  readonly weapon?: { readonly range: number; readonly damage: number; readonly cooldown: number; readonly matter?: number; readonly missile?: MissileTuning };
  readonly cargo?: number;
  readonly harvestRate?: number;
  readonly chargeRate?: number;
  /** Generators: peak energy per tick. */
  readonly output?: number;
  readonly antennaRange?: number;
  readonly storage?: number;
  readonly buildRate?: number;
  /** Repair module: hit points restored per tick (while powered and in range). */
  readonly repairRate?: number;
  readonly use?: number;
  /** Factory modules: the chassis size tier this module builds. */
  readonly factoryTier?: number;
  /** Radar: the most energy one pulse may spend. */
  readonly radarMaxEnergy?: number;
  /** Radio and laser link: reach in tiles (`use` is the energy per message). */
  readonly commsRange?: number;
  /** Shield emitter: arc and radius it starts with and the most a script may set (degrees, tiles); `use` is the energy per tick at the starting size. */
  readonly shield?: { readonly arc: number; readonly maxArc: number; readonly range: number; readonly maxRange: number };
  /** Spotlight: the energy per tick it starts at and the most a script may set (the beam is LIGHT_TILES_PER_ENERGY tiles long for each). */
  readonly light?: { readonly power: number; readonly maxPower: number };
}

export const PART_TUNING: Readonly<Record<string, PartTuning>> = {
  // Mobile chassis
  'chassis.light': { mass: 2, hp: 40, slots: 4, energy: 600 },
  'chassis.medium': { mass: 5, hp: 100, slots: 6, energy: 1200 },
  'chassis.heavy': { mass: 10, hp: 220, slots: 9, energy: 2400 },
  'chassis.long.light': { mass: 4, hp: 75, slots: 7, energy: 1100 },
  'chassis.long.medium': { mass: 9, hp: 190, slots: 11, energy: 2200 },
  'chassis.long.heavy': { mass: 19, hp: 420, slots: 16, energy: 4400 },
  // The size ladder beyond light/medium/heavy (see the factory tier comment above).
  'chassis.micro': { mass: 1, hp: 15, slots: 3, energy: 300 },
  'chassis.drone': { mass: 2, hp: 30, slots: 4, energy: 500 },
  'chassis.superheavy': { mass: 20, hp: 480, slots: 14, energy: 4800 },
  'chassis.colossus': { mass: 40, hp: 1000, slots: 20, energy: 9000 },
  // Building frames: a token buffer only; real storage comes from battery modules.
  'frame.small': { mass: 10, hp: 300, slots: 8, energy: 20 },
  'frame.medium': { mass: 20, hp: 600, slots: 16, energy: 50 },
  'frame.large': { mass: 40, hp: 1200, slots: 31, energy: 100 },
  // Shaped frames: per tile roughly what the square ones give (slots 3.4, mass 4.4, hp 135, energy 11).
  'frame.l': { mass: 24, hp: 700, slots: 17, energy: 56 },
  'frame.t': { mass: 24, hp: 700, slots: 17, energy: 56 },
  'frame.plus': { mass: 24, hp: 700, slots: 17, energy: 56 },
  'frame.u': { mass: 32, hp: 950, slots: 24, energy: 78 },
  'frame.h': { mass: 32, hp: 950, slots: 24, energy: 78 },

  'cpu.basic': { mass: 1, cycles: 20, stack: 8, memory: 16, use: 1 },
  'cpu.fast': { mass: 1, cycles: 60, stack: 8, memory: 24, use: 1 },
  'cpu.quantum': { mass: 3, cycles: 200, stack: 16, memory: 64, use: 2 },

  'mem.small': { mass: 1, memory: 16 },
  'mem.large': { mass: 2, memory: 64 },

  'motor.small': { mass: 1, thrust: 60, use: 1 },
  'motor.large': { mass: 3, thrust: 160, use: 3 },
  rotor: { mass: 2, thrust: 70, use: 3 },
  'motor.turbo': { mass: 2, thrust: 150, use: 2 },
  'motor.huge': { mass: 8, thrust: 450, use: 8 },
  // Legs: `climb` is the highest rock they walk onto (open ground is 0, a wall's rim 1, cliffs 3 and up).
  // Legs climb, but break easily: a broken pair leaves the unit stuck until a repair module mends them.
  'legs.light': { mass: 2, thrust: 70, climb: 1, use: 2, integrity: 12 },
  'legs.heavy': { mass: 5, thrust: 180, climb: 2, use: 4, integrity: 30 },
  'legs.colossus': { mass: 14, thrust: 500, climb: 9, use: 10, integrity: 100 },
  // Liquids: an amphibious drive wades into deep water (slowed); a hover skirt skims over water and lava at full
  // speed (lava scorches it) but is heavy on energy and cannot climb.
  'motor.amphibious': { mass: 3, thrust: 130, use: 3, wade: AMPHIBIOUS_WADE },
  'motor.hover': { mass: 4, thrust: 170, use: 5, wade: HOVER_WADE, hover: true },

  'sensor.short': { mass: 1, sensorRange: 6, sensorTier: 1, use: 1 },
  'sensor.long': { mass: 2, sensorRange: 14, sensorTier: 2, use: 2 },

  // The tesla coil's range and cooldown come from TESLA_RANGE / TESLA_COOLDOWN above; its `use` is per discharge.
  'gun.light': { mass: 1, weapon: { range: 4, damage: 5, cooldown: 5 }, use: 0 },
  'gun.cannon': { mass: 4, weapon: { range: 21, damage: 25, cooldown: 20, matter: 3 }, use: 0 },
  'laser.beam': { mass: 3, weapon: { range: 8, damage: 8, cooldown: 8 }, use: 100 },
  // Railgun: `use` is the energy spent when the charge starts. Ion gun: no damage, `use` is high on purpose.
  'rail.gun': { mass: 8, weapon: { range: 18, damage: 120, cooldown: 60 }, use: 400 },
  'ion.gun': { mass: 4, weapon: { range: 9, damage: 0, cooldown: 80 }, use: 350 },
  'tesla.coil': { mass: 5, weapon: { range: 0, damage: 0, cooldown: 0 }, use: 40 },
  // Missiles: damage is matter x MISSILE_DAMAGE_PER_MATTER; the matter comes from the cargo bay (vehicles) or the silos (buildings).
  // Flak: an air-burst that only ever hurts missiles; every enemy missile in the burst is hit, no roll.
  'flak.cannon': { mass: 3, weapon: { range: 10, damage: 12, cooldown: 3 }, use: 2 },
  'missile.small': { mass: 3, weapon: missileLauncher(4, 12, 30, { speed: 0.5, turn: 7, flight: 40, hp: 4, blast: 1, hitChance: 0.3 }), use: 0 },
  'missile.medium': { mass: 6, weapon: missileLauncher(12, 14, 40, { speed: 0.35, turn: 4.5, flight: 60, hp: 20, blast: 1.5, hitChance: 0.6 }), use: 0 },
  // Artillery: reaches further than any sensor sees (sensor.long is 14), so it needs a spotter, a radar or allied vision.
  'missile.huge': { mass: 16, weapon: missileLauncher(60, 26, 100, { speed: 0.3, turn: 2, flight: 110, hp: 80, blast: 3, hitChance: 1 }), use: 0 },
  'missile.large': { mass: 10, weapon: missileLauncher(30, 16, 60, { speed: 0.22, turn: 2.5, flight: 90, hp: 60, blast: 2.2, hitChance: 1 }), use: 0 },

  // Heavy weapons for the big tiers: a slow siege cannon (buildings) and a rotary gun (crowds of small units).
  'cannon.siege': { mass: 14, weapon: { range: 27, damage: 120, cooldown: 30, matter: 8 }, use: 0 },
  'gun.rotary': { mass: 10, weapon: { range: 7, damage: 20, cooldown: 3 }, use: 1 },
  // Flamethrower: lobs a fireball that lands and burns; `damage` is what the fire does each time it burns (FLAME_BURN_DAMAGE).
  'flame.projector': { mass: 14, weapon: { range: 9, damage: FLAME_BURN_DAMAGE, cooldown: 1, matter: 1 }, use: 0 },

  'armor.plate': { mass: 4, hp: 60 },
  'armor.heavy': { mass: 12, hp: 300 },

  // harvestRate is per tick on a light hull; the class's rate scales with its hull radius (HARVEST_REFERENCE_RADIUS).
  'cargo.bay': { mass: 1, cargo: 40, harvestRate: 2, use: 1 },
  'cargo.hold': { mass: 4, cargo: 200, harvestRate: 6, use: 3 },

  'battery.cell': { mass: 2, energy: 500 },
  'battery.large': { mass: 5, energy: 2000 },
  'battery.bank': { mass: 6, energy: 2500 },

  // One module per size tier; mass and use grow with the tier (a building needs a module for each tier it builds).
  'factory.micro': { mass: 3, use: 2, factoryTier: 0 },
  'factory.light': { mass: 5, use: 4, factoryTier: 1 },
  'factory.medium': { mass: 8, use: 6, factoryTier: 2 },
  'factory.heavy': { mass: 14, use: 9, factoryTier: 3 },
  'factory.super': { mass: 24, use: 14, factoryTier: 4 },
  'factory.colossal': { mass: 40, use: 20, factoryTier: 5 },
  silo: { mass: 3, storage: 1000 },
  'build.arm': { mass: 2, buildRate: 4, use: 2 },
  'build.crane': { mass: 4, buildRate: 6, use: 3 },
  'radar.pulse': { mass: 4, radarMaxEnergy: 800 },
  'radio.basic': { mass: 1, commsRange: 12, use: 1 },
  'radio.laser': { mass: 3, commsRange: 40, use: 3 },
  'repair.beam': { mass: 3, repairRate: 4, use: 8 },
  // The shield is the most power-hungry module: `use` is per tick, for the starting arc and radius; a wider or longer shield costs in proportion.
  'shield.emitter': { mass: 4, use: 5, shield: { arc: 120, maxArc: 240, range: 3, maxRange: 6 } },
  // The spotlight draws its power every tick: 5 energy lights a 20-tile beam (further than any sensor sees), 10 a 40-tile one.
  'light.spot': { mass: 3, light: { power: 5, maxPower: 10 } },
  // Smoke: `use` is per volley. Point defence: `use` is per shot. The drone bay costs nothing itself; its drones pay.
  'smoke.launcher': { mass: 2, use: 60 },
  'defence.point': { mass: 2, use: 3 },
  'hangar.bay': { mass: 6 },
  'charger.pad': { mass: 3, chargeRate: 10 },
  'solar.panel': { mass: 2, output: SOLAR_PANEL_OUTPUT },
  'wind.turbine': { mass: 4, output: WIND_TURBINE_OUTPUT },
  'steam.turbine': { mass: 5, output: STEAM_TURBINE_OUTPUT },
  'antenna.small': { mass: 1, antennaRange: 3 },
  'antenna.medium': { mass: 2, antennaRange: 6 },
  'antenna.large': { mass: 4, antennaRange: 12 },
};
