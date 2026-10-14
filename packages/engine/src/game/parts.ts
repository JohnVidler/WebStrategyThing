/** World positions are integers in sub-tile units, keeping the simulation deterministic. */
export const TILE = 1024;

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
/** Peak output of one solar panel, in energy per tick. */
export const SOLAR_PANEL_OUTPUT = 0.5;
/** Peak output of one wind turbine, in energy per tick. */
export const WIND_TURBINE_OUTPUT = 1;

const CATALOGUE: PartDef[] = [
  // Mobile chassis
  { id: 'chassis.light', slot: 'chassis', name: 'Light chassis', mass: 2, hp: 40, slots: 4, size: 0, energy: 600, description: 'Small, fast and fragile.' },
  { id: 'chassis.medium', slot: 'chassis', name: 'Medium chassis', mass: 5, hp: 100, slots: 6, size: 1, energy: 1200, description: 'General-purpose body.' },
  { id: 'chassis.heavy', slot: 'chassis', name: 'Heavy chassis', mass: 10, hp: 220, slots: 9, size: 2, energy: 2400, description: 'Slow, tough and roomy.' },
  // Building frames
  { id: 'frame.small', slot: 'chassis', name: 'Small frame (1×1)', mass: 10, hp: 300, slots: 8, structure: true, footprint: 1, energy: 200, description: 'A one-tile building.' },
  { id: 'frame.medium', slot: 'chassis', name: 'Medium frame (2×2)', mass: 20, hp: 600, slots: 16, structure: true, footprint: 2, energy: 500, description: 'A 2×2 building.' },
  { id: 'frame.large', slot: 'chassis', name: 'Large frame (3×3)', mass: 40, hp: 1200, slots: 31, structure: true, footprint: 3, energy: 1000, description: 'A 3×3 building.' },

  { id: 'cpu.basic', slot: 'cpu', name: 'Basic CPU', mass: 1, cycles: 20, stack: 8, memory: 4, use: 1, description: '20 cycles per tick; 1 energy per 100 cycles run.' },
  { id: 'cpu.fast', slot: 'cpu', name: 'Fast CPU', mass: 1, cycles: 60, stack: 8, memory: 4, use: 1, description: '60 cycles per tick; 1 energy per 100 cycles run.' },
  { id: 'cpu.quantum', slot: 'cpu', name: 'Quantum CPU', mass: 3, cycles: 200, stack: 16, memory: 8, use: 2, description: '200 cycles per tick; 2 energy per 100 cycles run.' },

  { id: 'mem.small', slot: 'memory', name: 'Memory bank (8)', mass: 1, memory: 8, description: '+8 script variables.' },
  { id: 'mem.large', slot: 'memory', name: 'Memory bank (32)', mass: 2, memory: 32, description: '+32 script variables.' },

  { id: 'motor.small', slot: 'motor', name: 'Small motor', mass: 1, thrust: 60, use: 1, mobileOnly: true, description: 'Ground drive.' },
  { id: 'motor.large', slot: 'motor', name: 'Large motor', mass: 3, thrust: 160, use: 3, mobileOnly: true, description: 'Powerful ground drive.' },
  { id: 'rotor', slot: 'motor', name: 'Rotor', mass: 2, thrust: 70, flight: true, use: 3, mobileOnly: true, description: 'Flight: crosses any terrain, lands only on passable cells.' },

  { id: 'sensor.short', slot: 'sensor', name: 'Short sensor (6)', mass: 1, sensorRange: 6, use: 1, description: 'Sees 6 tiles.' },
  { id: 'sensor.long', slot: 'sensor', name: 'Long sensor (14)', mass: 2, sensorRange: 14, use: 2, description: 'Sees 14 tiles.' },

  { id: 'gun.light', slot: 'weapon', name: 'Light gun', mass: 1, weapon: { range: 4, damage: 5, cooldown: 5 }, use: 0, description: '5 damage, range 4. Needs no energy or matter.' },
  { id: 'gun.cannon', slot: 'weapon', name: 'Cannon', mass: 4, weapon: { range: 7, damage: 25, cooldown: 20, kind: 'cannon', matter: 3 }, use: 0, description: '25 damage, range 7. Uses 3 matter per shot: from the cargo bay on a vehicle, from the silos on a building.' },
  { id: 'laser.beam', slot: 'weapon', name: 'Laser', mass: 3, weapon: { range: 8, damage: 14, cooldown: 8, kind: 'laser' }, use: 20, description: '14 damage, range 8. Heavy energy cost: 20 per shot.' },
  { id: 'tesla.coil', slot: 'weapon', name: 'Tesla coil', mass: 5, weapon: { range: 0, damage: 0, cooldown: 0, kind: 'tesla' }, use: 40, description: 'Stuns the CPU of every unit and building nearby, friend or foe, then recharges slowly. Aim it with fire(). On a vehicle it stuns the vehicle too, for half as long. Range and timing are in rules.ts.' },

  { id: 'armor.plate', slot: 'armor', name: 'Armour plate', mass: 4, hp: 60, description: '+60 hit points.' },

  { id: 'cargo.bay', slot: 'cargo', name: 'Cargo bay (40)', mass: 1, cargo: 40, harvestRate: 4, use: 1, mobileOnly: true, description: 'Harvests and carries 40 resources.' },

  { id: 'battery.cell', slot: 'battery', name: 'Battery cell', mass: 2, energy: 1000, description: '+1000 energy storage.' },
  { id: 'battery.bank', slot: 'battery', name: 'Battery bank', mass: 6, energy: 5000, structureOnly: true, description: '+5000 energy storage.' },

  { id: 'factory.basic', slot: 'factory', name: 'Factory', mass: 5, use: 4, structureOnly: true, description: 'Produces units.' },
  { id: 'silo', slot: 'depot', name: 'Resource silo', mass: 3, storage: 1000, structureOnly: true, description: 'Stores 1000 resources; units dock here to fill it or take from it.' },
  { id: 'build.arm', slot: 'builder', name: 'Build arm', mass: 2, buildRate: 4, use: 2, mobileOnly: true, description: 'Constructs buildings, investing 4 resources per tick.' },
  { id: 'build.crane', slot: 'builder', name: 'Build crane', mass: 4, buildRate: 6, use: 3, structureOnly: true, description: 'Constructs buildings up to 4 tiles from this building\'s edge, investing 6 resources per tick.' },
  { id: 'charger.pad', slot: 'charger', name: 'Charging pad', mass: 3, chargeRate: 10, structureOnly: true, description: 'Transfers 10 energy/tick from the building to each own unit within 3 tiles.' },
  { id: 'solar.panel', slot: 'generator', name: 'Solar panel', mass: 2, generator: 'solar', output: SOLAR_PANEL_OUTPUT * GENERATION_SCALE, structureOnly: true, description: `Up to ${SOLAR_PANEL_OUTPUT}/tick, following daylight.` },
  { id: 'wind.turbine', slot: 'generator', name: 'Wind turbine', mass: 4, generator: 'wind', output: WIND_TURBINE_OUTPUT * GENERATION_SCALE, structureOnly: true, description: `Up to ${WIND_TURBINE_OUTPUT}/tick, following the wind.` },
  { id: 'antenna.small', slot: 'antenna', name: 'Energy antenna S (3)', mass: 1, antennaRange: 3, structureOnly: true, description: 'Power links reach 3 tiles.' },
  { id: 'antenna.medium', slot: 'antenna', name: 'Energy antenna M (6)', mass: 2, antennaRange: 6, structureOnly: true, description: 'Power links reach 6 tiles.' },
  { id: 'antenna.large', slot: 'antenna', name: 'Energy antenna L (12)', mass: 4, antennaRange: 12, structureOnly: true, description: 'Power links reach 12 tiles.' },
];

export const PARTS: Readonly<Record<string, PartDef>> = Object.freeze(
  Object.fromEntries(CATALOGUE.map((p) => [p.id, Object.freeze(p)])),
);

export const PART_LIST: readonly PartDef[] = Object.freeze(CATALOGUE);
