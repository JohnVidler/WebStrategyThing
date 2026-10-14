import { TILE } from './parts';

/** Interaction ranges, measured from a building's edge (or a unit's centre). */
export const HARVEST_RANGE = 1.5 * TILE;
export const DOCK_RANGE = 1.5 * TILE;
/** Energy transfer reach, from the giver: units only reach neighbours; buildings (charging pads) reach further. */
export const UNIT_TRANSFER_RANGE = 1 * TILE;
export const BUILDING_TRANSFER_RANGE = 3 * TILE;
/** Charging pads use the building-scale transfer range. */
export const CHARGE_RANGE = BUILDING_TRANSFER_RANGE;
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
/** Builders off the grid stop building at this share of their energy capacity, so they can still reach a charger. */
export const BUILDER_ENERGY_RESERVE = 0.25;
/** A unit with no energy for this many ticks falls apart into a matter block worth its cost. */
export const DECAY_TICKS = 600;

/** Multiplier applied to solar output after scaling by daylight (1 = unchanged). */
export const SOLAR_GENERATION_MULTIPLIER = 2;
/** Multiplier applied to wind output after scaling by wind intensity (1 = unchanged). */
export const WIND_GENERATION_MULTIPLIER = 2;

/** Natural matter patches regenerate one unit at this interval, up to their initial amount. */
export const RESOURCE_REGEN_INTERVAL_TICKS = 10;

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
