import { BUILDING_BUILD_RANGE, BUILDING_TRANSFER_RANGE, PART_TUNING, TESLA_COOLDOWN, TESLA_RANGE, TESLA_SELF_STUN_FACTOR, TESLA_STUN_TICKS, TILE } from './rules';

export { TILE };

export type WeaponKind = 'gun' | 'cannon' | 'laser' | 'tesla';

export type PartSlot =
  | 'chassis'
  | 'cpu'
  | 'memory'
  | 'motor'
  | 'sensor'
  | 'weapon'
  | 'armor'
  | 'cargo'
  | 'battery'
  | 'factory'
  | 'depot'
  | 'charger'
  | 'generator'
  | 'antenna'
  | 'builder';

/** Numeric slot codes, exposed to scripts via moduleKind() as M_CPU, M_MOTOR, ... */
export const SLOT_CODES: Readonly<Record<PartSlot, number>> = {
  chassis: 1,
  cpu: 2,
  memory: 3,
  motor: 4,
  sensor: 5,
  weapon: 6,
  armor: 7,
  cargo: 8,
  battery: 9,
  factory: 10,
  depot: 11,
  charger: 12,
  generator: 13,
  antenna: 14,
  builder: 15,
};

/** Modules that use or make energy can be switched off; passive ones (frame, memory, armour, batteries) cannot. */
export const SWITCHABLE: ReadonlySet<PartSlot> = new Set<PartSlot>([
  'cpu', 'motor', 'sensor', 'weapon', 'cargo', 'factory', 'charger', 'generator', 'antenna', 'builder',
]);

/**
 * Static part catalogue. Shared by server and client as code, so it is never
 * sent over the wire — blueprints reference parts by id. Units and buildings
 * use the same modules: a building is just a static frame with more slots.
 */
export interface PartDef {
  readonly id: string;
  readonly slot: PartSlot;
  readonly name: string;
  readonly mass: number;
  readonly hp?: number;
  /** Chassis/frame: how many modules fit. */
  readonly slots?: number;
  /** Chassis: render size class. */
  readonly size?: number;
  /** Frame: immobile building occupying footprint × footprint tiles. */
  readonly structure?: boolean;
  readonly footprint?: number;
  /** Energy storage capacity (chassis base buffer, or battery modules). */
  readonly energy?: number;
  readonly cycles?: number;
  readonly memory?: number;
  readonly stack?: number;
  readonly thrust?: number;
  /** Rotor: the unit flies over any terrain (but only lands on passable cells). */
  readonly flight?: boolean;
  /** Tiles. */
  readonly sensorRange?: number;
  readonly weapon?: {
    readonly range: number;
    readonly damage: number;
    readonly cooldown: number;
    /** Default 'gun'. Tesla range and cooldown come from rules.ts. */
    readonly kind?: WeaponKind;
    /** Matter per shot: taken from the cargo bay (vehicles) or the silos (buildings). */
    readonly matter?: number;
  };
  readonly cargo?: number;
  readonly harvestRate?: number;
  /** Energy per tick given to each unit on the pad. */
  readonly chargeRate?: number;
  readonly generator?: 'solar' | 'wind';
  /** Peak energy per tick. */
  readonly output?: number;
  /** Tiles a power link can span from this building's edge. */
  readonly antennaRange?: number;
  /** Resources a silo holds. */
  readonly storage?: number;
  /** Resources per tick a build arm puts into a construction site. */
  readonly buildRate?: number;
  /**
   * Energy per use. CPU: per 100 cycles executed (yield and sleep are free). Motor: per tick moving.
   * Sensor: per scan. Weapon: per shot. Cargo: per tick harvesting. Factory: per tick producing.
   * Build arm: per tick constructing.
   */
  readonly use?: number;
  readonly structureOnly?: boolean;
  readonly mobileOnly?: boolean;
  readonly description: string;
}

/** Generator outputs are stored in 1/GENERATION_SCALE energy per tick, so they can be fractional. */
export const GENERATION_SCALE = 10;

/** Tuned numbers for a part (see rules.ts). */
const T = (id: string) => PART_TUNING[id];
const tiles = (n: number) => `${n} tile${n === 1 ? '' : 's'}`;

const CATALOGUE: PartDef[] = [
  // Mobile chassis
  { id: 'chassis.light', slot: 'chassis', name: 'Light chassis', ...T('chassis.light'), size: 0, description: 'Small, fast and fragile.' },
  { id: 'chassis.medium', slot: 'chassis', name: 'Medium chassis', ...T('chassis.medium'), size: 1, description: 'General-purpose body.' },
  { id: 'chassis.heavy', slot: 'chassis', name: 'Heavy chassis', ...T('chassis.heavy'), size: 2, description: 'Slow, tough and roomy.' },
  // Building frames
  { id: 'frame.small', slot: 'chassis', name: 'Small frame (1×1)', ...T('frame.small'), structure: true, footprint: 1, description: 'A one-tile building.' },
  { id: 'frame.medium', slot: 'chassis', name: 'Medium frame (2×2)', ...T('frame.medium'), structure: true, footprint: 2, description: 'A 2×2 building.' },
  { id: 'frame.large', slot: 'chassis', name: 'Large frame (3×3)', ...T('frame.large'), structure: true, footprint: 3, description: 'A 3×3 building.' },

  ...(['cpu.basic', 'cpu.fast', 'cpu.quantum'] as const).map((id): PartDef => {
    const t = T(id);
    const name = id === 'cpu.basic' ? 'Basic CPU' : id === 'cpu.fast' ? 'Fast CPU' : 'Quantum CPU';
    return { id, slot: 'cpu', name, ...t, description: `${t.cycles} cycles per tick; ${t.use} energy per 100 cycles run.` };
  }),

  { id: 'mem.small', slot: 'memory', name: `Memory bank (${T('mem.small').memory})`, ...T('mem.small'), description: `+${T('mem.small').memory} script variables.` },
  { id: 'mem.large', slot: 'memory', name: `Memory bank (${T('mem.large').memory})`, ...T('mem.large'), description: `+${T('mem.large').memory} script variables.` },

  { id: 'motor.small', slot: 'motor', name: 'Small motor', ...T('motor.small'), mobileOnly: true, description: 'Ground drive.' },
  { id: 'motor.large', slot: 'motor', name: 'Large motor', ...T('motor.large'), mobileOnly: true, description: 'Powerful ground drive.' },
  { id: 'rotor', slot: 'motor', name: 'Rotor', ...T('rotor'), flight: true, mobileOnly: true, description: 'Flight: crosses any terrain, lands only on passable cells.' },

  { id: 'sensor.short', slot: 'sensor', name: `Short sensor (${T('sensor.short').sensorRange})`, ...T('sensor.short'), description: `Sees ${T('sensor.short').sensorRange} tiles.` },
  { id: 'sensor.long', slot: 'sensor', name: `Long sensor (${T('sensor.long').sensorRange})`, ...T('sensor.long'), description: `Sees ${T('sensor.long').sensorRange} tiles.` },

  { id: 'gun.light', slot: 'weapon', name: 'Light gun', ...T('gun.light'), weapon: { ...T('gun.light').weapon!, kind: 'gun' }, description: `${T('gun.light').weapon!.damage} damage, range ${T('gun.light').weapon!.range}. Needs no energy or matter.` },
  { id: 'gun.cannon', slot: 'weapon', name: 'Cannon', ...T('gun.cannon'), weapon: { ...T('gun.cannon').weapon!, kind: 'cannon' }, description: `${T('gun.cannon').weapon!.damage} damage, range ${T('gun.cannon').weapon!.range}. Uses ${T('gun.cannon').weapon!.matter} matter per shot: from the cargo bay on a vehicle, from the silos on a building.` },
  { id: 'laser.beam', slot: 'weapon', name: 'Laser', ...T('laser.beam'), weapon: { ...T('laser.beam').weapon!, kind: 'laser' }, description: `${T('laser.beam').weapon!.damage} damage, range ${T('laser.beam').weapon!.range}. Heavy energy cost: ${T('laser.beam').use} per shot.` },
  { id: 'tesla.coil', slot: 'weapon', name: 'Tesla coil', ...T('tesla.coil'), weapon: { ...T('tesla.coil').weapon!, kind: 'tesla' }, description: `Stuns the CPU of every unit and building within ${TESLA_RANGE / TILE} tiles for ${TESLA_STUN_TICKS / 10}s, friend or foe, then recharges for ${TESLA_COOLDOWN / 10}s. Aim it with fire(). On a vehicle it stuns the vehicle too, for ${Math.round(TESLA_SELF_STUN_FACTOR * 100)}% as long.` },

  { id: 'armor.plate', slot: 'armor', name: 'Armour plate', ...T('armor.plate'), description: `+${T('armor.plate').hp} hit points.` },

  { id: 'cargo.bay', slot: 'cargo', name: `Cargo bay (${T('cargo.bay').cargo})`, ...T('cargo.bay'), mobileOnly: true, description: `Harvests and carries ${T('cargo.bay').cargo} resources.` },

  { id: 'battery.cell', slot: 'battery', name: 'Battery cell', ...T('battery.cell'), description: `+${T('battery.cell').energy} energy storage.` },
  { id: 'battery.bank', slot: 'battery', name: 'Battery bank', ...T('battery.bank'), structureOnly: true, description: `+${T('battery.bank').energy} energy storage.` },

  { id: 'factory.basic', slot: 'factory', name: 'Factory', ...T('factory.basic'), structureOnly: true, description: 'Produces units.' },
  { id: 'silo', slot: 'depot', name: 'Resource silo', ...T('silo'), structureOnly: true, description: `Stores ${T('silo').storage} resources; units dock here to fill it or take from it.` },
  { id: 'build.arm', slot: 'builder', name: 'Build arm', ...T('build.arm'), mobileOnly: true, description: `Constructs buildings, investing ${T('build.arm').buildRate} resources per tick.` },
  { id: 'build.crane', slot: 'builder', name: 'Build crane', ...T('build.crane'), structureOnly: true, description: `Constructs buildings up to ${BUILDING_BUILD_RANGE / TILE} tiles from this building's edge, investing ${T('build.crane').buildRate} resources per tick.` },
  { id: 'charger.pad', slot: 'charger', name: 'Charging pad', ...T('charger.pad'), structureOnly: true, description: `Transfers ${T('charger.pad').chargeRate} energy/tick from the building to each own unit within ${BUILDING_TRANSFER_RANGE / TILE} tiles.` },
  { id: 'solar.panel', slot: 'generator', name: 'Solar panel', ...T('solar.panel'), output: T('solar.panel').output! * GENERATION_SCALE, generator: 'solar', structureOnly: true, description: `Up to ${T('solar.panel').output}/tick, following daylight.` },
  { id: 'wind.turbine', slot: 'generator', name: 'Wind turbine', ...T('wind.turbine'), output: T('wind.turbine').output! * GENERATION_SCALE, generator: 'wind', structureOnly: true, description: `Up to ${T('wind.turbine').output}/tick, following the wind.` },
  { id: 'antenna.small', slot: 'antenna', name: `Energy antenna S (${T('antenna.small').antennaRange})`, ...T('antenna.small'), structureOnly: true, description: `Power links reach ${tiles(T('antenna.small').antennaRange!)}.` },
  { id: 'antenna.medium', slot: 'antenna', name: `Energy antenna M (${T('antenna.medium').antennaRange})`, ...T('antenna.medium'), structureOnly: true, description: `Power links reach ${tiles(T('antenna.medium').antennaRange!)}.` },
  { id: 'antenna.large', slot: 'antenna', name: `Energy antenna L (${T('antenna.large').antennaRange})`, ...T('antenna.large'), structureOnly: true, description: `Power links reach ${tiles(T('antenna.large').antennaRange!)}.` },
];

export const PARTS: Readonly<Record<string, PartDef>> = Object.freeze(
  Object.fromEntries(CATALOGUE.map((p) => [p.id, Object.freeze(p)])),
);

export const PART_LIST: readonly PartDef[] = Object.freeze(CATALOGUE);
