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

/** Energy to construct a building: this much per tile of footprint area (so 1x1 = 50, 2x2 = 200, 3x3 = 450). */
export const BUILD_ENERGY_PER_TILE = 50;
export const buildEnergyCost = (footprint: number): number => footprint * footprint * BUILD_ENERGY_PER_TILE;
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

/** Multiplier applied to solar output after scaling by daylight (1 = unchanged). */
export const SOLAR_GENERATION_MULTIPLIER = 75;
/** Multiplier applied to wind output after scaling by wind intensity (1 = unchanged). */
export const WIND_GENERATION_MULTIPLIER = 25;

/** Matter a new natural patch holds (also the cap it regenerates up to). */
export const RESOURCE_PATCH_AMOUNT = 1400;
/** Natural matter patches regenerate one unit at this interval, up to their initial amount. */
export const RESOURCE_REGEN_INTERVAL_TICKS = 5;

/** Share of generation lost per tile of link gap in a network, up to a maximum. */
export const TRANSMISSION_LOSS_PER_TILE = 0.0001;
export const MAX_TRANSMISSION_LOSS = 0.7;

/** A discharging storage building gives at most this share of its capacity to the network per tick. */
export const STORAGE_DISCHARGE_FRACTION = 0.02;

/** Tesla coil: stun radius (sub-tile units), stun length and recharge time (ticks, 10 per second). */
export const TESLA_RANGE = 3 * TILE;
export const TESLA_STUN_TICKS = 30;
export const TESLA_COOLDOWN = 150;
/** A tesla mounted on a vehicle also stuns that vehicle, for this share of the full duration. */
export const TESLA_SELF_STUN_FACTOR = 0.5;

// --- World & timing ----------------------------------------------------------------

/** Ticks in one day/night cycle (2 minutes at 10 Hz). Daylight during the first half. */
export const DAY_LENGTH = 1200;
/** Ticks between new random wind targets; the wind drifts smoothly between them. */
export const WIND_CHANGE_TICKS = 100;

/** How far (sub-tile units) a unit sees with no sensor, and a building. A longer sensor range wins. */
export const UNIT_VISION = 4 * TILE;
export const BUILDING_VISION = 6 * TILE;

/** Units closer than this (sub-tile units) push each other apart. */
export const SEPARATION_RADIUS = Math.floor(0.7 * TILE);

// --- Class derivation (how modules combine into stats) -----------------------------

/** Unit speed = thrust × this ÷ total mass (sub-tile units per tick). */
export const SPEED_FACTOR = 24;
/** Call-stack depth every class has before CPU stack bonuses. */
export const BASE_STACK = 8;
/** Power-link reach (tiles) of a building with no antenna. */
export const BASE_LINK_RANGE = 1;
/** Matter cost of a class = COST_PER_MASS × total mass + CYCLE_COST × the cycles of all its CPUs. */
export const COST_PER_MASS = 10;
export const CYCLE_COST = 1;
/** Production time of a class (ticks) = BUILD_TIME_BASE + BUILD_TIME_PER_MASS × mass. */
export const BUILD_TIME_BASE = 10;
export const BUILD_TIME_PER_MASS = 4;

// --- Construction, production & limits ---------------------------------------------

/** Construction sites start at this fraction of their hit points and grow with progress. */
export const SITE_START_HP = 0.1;
export const MAX_SITES_PER_PLAYER = 12;
export const MAX_PRODUCTION_QUEUE = 8;
export const MAX_UNITS_PER_PLAYER = 80;
export const MAX_CLASSES_PER_PLAYER = 40;

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
export const BOT_MAX_UNITS = 24;
/** First wave leaves after this many ticks; later waves every BOT_WAVE_INTERVAL_TICKS (10 ticks = 1 second). */
export const BOT_FIRST_WAVE_TICKS = 1800;
export const BOT_WAVE_INTERVAL_TICKS = 2400;
/** Each wave is BOT_WAVE_BASE_SIZE + BOT_WAVE_GROWTH per earlier wave; bots build only that many, then wait. */
export const BOT_WAVE_BASE_SIZE = 2;
export const BOT_WAVE_GROWTH = 1;
/** Idle fighters further than this many tiles from their base press on to the next target instead of waiting. */
export const BOT_STAGING_RADIUS = 8;

// --- Generators --------------------------------------------------------------------

/** Peak output of one solar panel and one wind turbine, in energy per tick (before the multipliers above). */
export const SOLAR_PANEL_OUTPUT = 0.5;
export const WIND_TURBINE_OUTPUT = 1;

// --- Module stats ------------------------------------------------------------------

/**
 * Numbers for every module, by part id. Descriptions and names in the catalogue
 * (parts.ts) are generated from these, so they stay in step. Units: hp = hit
 * points, energy = storage, cycles = per tick, sensorRange / antennaRange in
 * tiles, use = energy per use (see PartDef.use), cooldown in ticks.
 */
export interface PartTuning {
  readonly mass: number;
  readonly hp?: number;
  /** Chassis/frame: how many modules fit. */
  readonly slots?: number;
  readonly energy?: number;
  readonly cycles?: number;
  readonly memory?: number;
  readonly stack?: number;
  readonly thrust?: number;
  readonly sensorRange?: number;
  readonly weapon?: { readonly range: number; readonly damage: number; readonly cooldown: number; readonly matter?: number };
  readonly cargo?: number;
  readonly harvestRate?: number;
  readonly chargeRate?: number;
  /** Generators: peak energy per tick. */
  readonly output?: number;
  readonly antennaRange?: number;
  readonly storage?: number;
  readonly buildRate?: number;
  readonly use?: number;
  /** Radar: the most energy one pulse may spend. */
  readonly radarMaxEnergy?: number;
}

export const PART_TUNING: Readonly<Record<string, PartTuning>> = {
  // Mobile chassis
  'chassis.light': { mass: 2, hp: 40, slots: 4, energy: 600 },
  'chassis.medium': { mass: 5, hp: 100, slots: 6, energy: 1200 },
  'chassis.heavy': { mass: 10, hp: 220, slots: 9, energy: 2400 },
  // Building frames
  'frame.small': { mass: 10, hp: 300, slots: 8, energy: 200 },
  'frame.medium': { mass: 20, hp: 600, slots: 16, energy: 500 },
  'frame.large': { mass: 40, hp: 1200, slots: 31, energy: 1000 },

  'cpu.basic': { mass: 1, cycles: 20, stack: 8, memory: 4, use: 1 },
  'cpu.fast': { mass: 1, cycles: 60, stack: 8, memory: 4, use: 1 },
  'cpu.quantum': { mass: 3, cycles: 200, stack: 16, memory: 8, use: 2 },

  'mem.small': { mass: 1, memory: 8 },
  'mem.large': { mass: 2, memory: 32 },

  'motor.small': { mass: 1, thrust: 60, use: 1 },
  'motor.large': { mass: 3, thrust: 160, use: 3 },
  rotor: { mass: 2, thrust: 70, use: 3 },

  'sensor.short': { mass: 1, sensorRange: 6, use: 1 },
  'sensor.long': { mass: 2, sensorRange: 14, use: 2 },

  // The tesla coil's range and cooldown come from TESLA_RANGE / TESLA_COOLDOWN above; its `use` is per discharge.
  'gun.light': { mass: 1, weapon: { range: 4, damage: 5, cooldown: 5 }, use: 0 },
  'gun.cannon': { mass: 4, weapon: { range: 7, damage: 25, cooldown: 20, matter: 3 }, use: 0 },
  'laser.beam': { mass: 3, weapon: { range: 8, damage: 14, cooldown: 8 }, use: 20 },
  'tesla.coil': { mass: 5, weapon: { range: 0, damage: 0, cooldown: 0 }, use: 40 },

  'armor.plate': { mass: 4, hp: 60 },

  'cargo.bay': { mass: 1, cargo: 40, harvestRate: 4, use: 1 },

  'battery.cell': { mass: 2, energy: 1000 },
  'battery.bank': { mass: 6, energy: 5000 },

  'factory.basic': { mass: 5, use: 4 },
  silo: { mass: 3, storage: 1000 },
  'build.arm': { mass: 2, buildRate: 4, use: 2 },
  'build.crane': { mass: 4, buildRate: 6, use: 3 },
  'radar.pulse': { mass: 4, radarMaxEnergy: 800 },
  'charger.pad': { mass: 3, chargeRate: 10 },
  'solar.panel': { mass: 2, output: SOLAR_PANEL_OUTPUT },
  'wind.turbine': { mass: 4, output: WIND_TURBINE_OUTPUT },
  'antenna.small': { mass: 1, antennaRange: 3 },
  'antenna.medium': { mass: 2, antennaRange: 6 },
  'antenna.large': { mass: 4, antennaRange: 12 },
};
