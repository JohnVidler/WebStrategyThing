import { BUILD_RANGE, BUILDING_BUILD_RANGE, BUILDING_TRANSFER_RANGE, CHARGE_PAD_RATE_MULTIPLIER, FLAK_BURST_RADIUS, PART_TUNING, type MissileTuning, RADAR_COOLDOWN_TICKS, RADAR_ENERGY_PER_TILE, RADAR_FADE_TICKS, TESLA_COOLDOWN, TESLA_RANGE, TESLA_SELF_STUN_FACTOR, TESLA_STUN_TICKS, TILE } from './rules';

export { TILE };

export type WeaponKind = 'gun' | 'cannon' | 'laser' | 'tesla' | 'missile' | 'flak';

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
  | 'builder'
  | 'radar'
  | 'comms'
  | 'repair';

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
  radar: 16,
  repair: 17,
  comms: 18,
};

/** Modules that use or make energy can be switched off; passive ones (frame, memory, armour, batteries) cannot. */
export const SWITCHABLE: ReadonlySet<PartSlot> = new Set<PartSlot>([
  'cpu', 'motor', 'sensor', 'weapon', 'cargo', 'factory', 'charger', 'generator', 'antenna', 'builder', 'radar', 'repair', 'comms',
]);

/**
 * Static part catalogue. Shared by server and client as code, so it is never
 * sent over the wire — blueprints reference parts by id. Units and buildings
 * use the same modules: a building is just a static frame with more slots.
 */
export interface PartDef {
  readonly id: string;
  /** Damage the module takes before it breaks; default from its mass (see MODULE_HP_BASE). */
  readonly integrity?: number;
  readonly slot: PartSlot;
  readonly name: string;
  readonly mass: number;
  readonly hp?: number;
  /** Chassis/frame: how many modules fit. */
  readonly slots?: number;
  /** Chassis: size tier (TIER_NAMES): decides the factory modules it needs, and which big modules fit. */
  readonly size?: number;
  /** Chassis: hull radius in tiles (drawing, crowding, and how close weapons and docks must get). */
  readonly radius?: number;
  /** Module: the smallest chassis tier it fits (heavy modules need a big hull). */
  readonly minSize?: number;
  /** Legs: the highest rock they walk onto (0 = open ground only, like wheels). */
  readonly climb?: number;
  /** Factory modules: the chassis size tier this module builds. */
  readonly factoryTier?: number;
  /** Frame: immobile building occupying footprint × footprint tiles (or the cells of `shape` inside that box). */
  readonly structure?: boolean;
  readonly footprint?: number;
  /** Frame: rows of the building's layout inside its footprint box, 'X' = a tile it covers, '.' = empty. Absent = a full square. */
  readonly shape?: readonly string[];
  /** Vehicle chassis twice as long as it is wide. */
  readonly long?: boolean;
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
  /** What a Detected block may configure: 1 = basic, 2 = better (see sensor.ts). */
  readonly sensorTier?: number;
  readonly weapon?: {
    readonly range: number;
    readonly damage: number;
    readonly cooldown: number;
    /** Default 'gun'. Tesla range and cooldown come from rules.ts. */
    readonly kind?: WeaponKind;
    /** Matter per shot: taken from the cargo bay (vehicles) or the silos (buildings). */
    readonly matter?: number;
    /** Missile launchers: how the missile flies. */
    readonly missile?: MissileTuning;
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
  /** Repair module: hit points per tick restored to an own unit or building in reach. */
  readonly repairRate?: number;
  /**
   * Energy per use. CPU: per 100 cycles executed (yield and sleep are free). Motor: per tick moving.
   * Sensor: per scan. Weapon: per shot. Cargo: per tick harvesting. Factory: per tick producing.
   * Build arm: per tick constructing. Repair beam: per tick repairing.
   */
  readonly use?: number;
  /** Radar: the most energy one pulse may spend. */
  readonly radarMaxEnergy?: number;
  /** Radio / laser link: which kind it is, and its reach in tiles. */
  readonly link?: 'radio' | 'laser';
  readonly commsRange?: number;
  readonly structureOnly?: boolean;
  readonly mobileOnly?: boolean;
  readonly description: string;
}

/** Chassis size tiers, by `PartDef.size`. */
export const TIER_NAMES: readonly string[] = ['micro', 'light', 'medium', 'heavy', 'super-heavy', 'colossus'];

/** Generator outputs are stored in 1/GENERATION_SCALE energy per tick, so they can be fractional. */
export const GENERATION_SCALE = 10;

/** Tuned numbers for a part (see rules.ts). */
const T = (id: string) => PART_TUNING[id];
const tiles = (n: number) => `${n} tile${n === 1 ? '' : 's'}`;

const CATALOGUE: PartDef[] = [
  // Mobile chassis
  { id: 'chassis.light', slot: 'chassis', name: 'Light chassis', ...T('chassis.light'), size: 1, radius: 0.3, description: 'Small, fast and fragile.' },
  { id: 'chassis.medium', slot: 'chassis', name: 'Medium chassis', ...T('chassis.medium'), size: 2, radius: 0.38, description: 'General-purpose body.' },
  { id: 'chassis.heavy', slot: 'chassis', name: 'Heavy chassis', ...T('chassis.heavy'), size: 3, radius: 0.46, description: 'Slow, tough and roomy.' },
  // Building frames
  { id: 'chassis.long.light', slot: 'chassis', name: 'Long light chassis', ...T('chassis.long.light'), size: 1, radius: 0.3, long: true, description: 'Twice as long as a light chassis: more room for modules, still quick to build and nimble.' },
  { id: 'chassis.long.medium', slot: 'chassis', name: 'Long medium chassis', ...T('chassis.long.medium'), size: 2, radius: 0.38, long: true, description: 'A double-length body with room for a big launcher and its ammunition.' },
  { id: 'chassis.long.heavy', slot: 'chassis', name: 'Long heavy chassis', ...T('chassis.long.heavy'), size: 3, radius: 0.46, long: true, description: 'A double-length armoured hull: the roomiest vehicle body.' },
  { id: 'frame.small', slot: 'chassis', name: 'Small frame (1×1)', ...T('frame.small'), structure: true, footprint: 1, description: 'A one-tile building.' },
  { id: 'frame.medium', slot: 'chassis', name: 'Medium frame (2×2)', ...T('frame.medium'), structure: true, footprint: 2, description: 'A 2×2 building.' },
  { id: 'frame.large', slot: 'chassis', name: 'Large frame (3×3)', ...T('frame.large'), structure: true, footprint: 3, description: 'A 3×3 building.' },
  { id: 'frame.l', slot: 'chassis', name: 'L-shaped frame', ...T('frame.l'), structure: true, footprint: 3, shape: ['X..', 'X..', 'XXX'], description: 'An L-shaped building in a 3×3 box: 5 tiles, so it fits round obstacles and holds modules in proportion.' },
  { id: 'frame.t', slot: 'chassis', name: 'T-shaped frame', ...T('frame.t'), structure: true, footprint: 3, shape: ['XXX', '.X.', '.X.'], description: 'A T-shaped building in a 3×3 box: 5 tiles.' },
  { id: 'frame.plus', slot: 'chassis', name: 'Cross-shaped frame', ...T('frame.plus'), structure: true, footprint: 3, shape: ['.X.', 'XXX', '.X.'], description: 'A plus-shaped building in a 3×3 box: 5 tiles. Units can stand in the corners.' },
  { id: 'frame.u', slot: 'chassis', name: 'U-shaped frame', ...T('frame.u'), structure: true, footprint: 3, shape: ['X.X', 'X.X', 'XXX'], description: 'A U-shaped building in a 3×3 box: 7 tiles around a bay.' },
  { id: 'frame.h', slot: 'chassis', name: 'H-shaped frame', ...T('frame.h'), structure: true, footprint: 3, shape: ['X.X', 'XXX', 'X.X'], description: 'An H-shaped building in a 3×3 box: 7 tiles.' },

  ...(['cpu.basic', 'cpu.fast', 'cpu.quantum'] as const).map((id): PartDef => {
    const t = T(id);
    const name = id === 'cpu.basic' ? 'Basic CPU' : id === 'cpu.fast' ? 'Fast CPU' : 'Quantum CPU';
    return { id, slot: 'cpu', name, ...t, description: `${t.cycles} cycles per tick; ${t.use} energy per 100 cycles run.` };
  }),

  { id: 'mem.small', slot: 'memory', name: `Memory bank (${T('mem.small').memory})`, ...T('mem.small'), description: `+${T('mem.small').memory} script variables.` },
  { id: 'mem.large', slot: 'memory', name: `Memory bank (${T('mem.large').memory})`, ...T('mem.large'), description: `+${T('mem.large').memory} script variables.` },

  { id: 'motor.small', slot: 'motor', name: 'Small motor', ...T('motor.small'), mobileOnly: true, description: 'Ground drive.' },
  { id: 'motor.turbo', slot: 'motor', name: 'Turbo motor', ...T('motor.turbo'), mobileOnly: true, description: 'Fast ground drive for light units: weak for its weight on anything heavy, but a light chassis with one is over twice as quick as with a small motor.' },
  { id: 'motor.large', slot: 'motor', name: 'Large motor', ...T('motor.large'), mobileOnly: true, description: 'Powerful ground drive.' },
  { id: 'rotor', slot: 'motor', name: 'Rotor', ...T('rotor'), flight: true, mobileOnly: true, description: 'Flight: crosses any terrain, lands only on passable cells.' },

  { id: 'sensor.short', slot: 'sensor', name: `Short sensor (${T('sensor.short').sensorRange})`, ...T('sensor.short'), description: `Sees ${T('sensor.short').sensorRange} tiles.` },
  { id: 'sensor.long', slot: 'sensor', name: `Long sensor (${T('sensor.long').sensorRange})`, ...T('sensor.long'), description: `Sees ${T('sensor.long').sensorRange} tiles.` },

  { id: 'gun.light', slot: 'weapon', name: 'Light gun', ...T('gun.light'), weapon: { ...T('gun.light').weapon!, kind: 'gun' }, description: `${T('gun.light').weapon!.damage} damage, range ${T('gun.light').weapon!.range}. Needs no energy or matter.` },
  { id: 'gun.cannon', slot: 'weapon', name: 'Cannon', ...T('gun.cannon'), weapon: { ...T('gun.cannon').weapon!, kind: 'cannon' }, description: `${T('gun.cannon').weapon!.damage} damage, range ${T('gun.cannon').weapon!.range}. Uses ${T('gun.cannon').weapon!.matter} matter per shot: from the cargo bay on a vehicle, from the silos on a building.` },
  { id: 'laser.beam', slot: 'weapon', name: 'Laser', ...T('laser.beam'), weapon: { ...T('laser.beam').weapon!, kind: 'laser' }, description: `${T('laser.beam').weapon!.damage} damage at full power, range ${T('laser.beam').weapon!.range}. Heavy energy cost: ${T('laser.beam').use} per shot; damage scales with the energy spent, which scripts can set with laserPower(energy).` },
  { id: 'tesla.coil', slot: 'weapon', name: 'Tesla coil', ...T('tesla.coil'), weapon: { ...T('tesla.coil').weapon!, kind: 'tesla' }, description: `Stuns the CPU of every unit and building within ${TESLA_RANGE / TILE} tiles for ${TESLA_STUN_TICKS / 10}s, friend or foe, then recharges for ${TESLA_COOLDOWN / 10}s. Aim it with fire(). On a vehicle it stuns the vehicle too, for ${Math.round(TESLA_SELF_STUN_FACTOR * 100)}% as long.` },
  { id: 'flak.cannon', slot: 'weapon', name: 'Flak cannon', ...T('flak.cannon'), weapon: { ...T('flak.cannon').weapon!, kind: 'flak' }, description: `Anti-missile air-burst: ${T('flak.cannon').weapon!.damage} damage to every enemy missile within ${FLAK_BURST_RADIUS / TILE} tiles of the one it is aimed at, range ${T('flak.cannon').weapon!.range}, never misses. Harmless to units and buildings. ${T('flak.cannon').use} energy per shot. Aim it with fire(); a Detected block can watch for MISSILE.` },
  ...(['small', 'medium', 'large', 'huge'] as const).map((size): PartDef => {
    const id = `missile.${size}`;
    const t = T(id);
    const w = t.weapon!;
    const m = w.missile!;
    return {
      id, slot: 'weapon', name: `Missile launcher (${size})`, ...t, weapon: { ...w, kind: 'missile' },
      description: `Homing missile: ${w.damage} damage in a ${m.blast}-tile blast for ${w.matter} matter (from the cargo bay on a vehicle, from the silos on a building), range ${w.range}. Flies ${m.speed * 10} tiles/s, turns slowly and bursts after ${m.flight / 10}s. Hit-scan weapons can shoot it down: ${m.hp} hit points, and a ${Math.round(m.hitChance * 100)}% chance for a shot at it to connect.`,
    };
  }),

  { id: 'armor.plate', slot: 'armor', name: 'Armour plate', ...T('armor.plate'), description: `+${T('armor.plate').hp} hit points.` },

  { id: 'cargo.bay', slot: 'cargo', name: `Cargo bay (${T('cargo.bay').cargo})`, ...T('cargo.bay'), mobileOnly: true, description: `Harvests and carries ${T('cargo.bay').cargo} resources.` },

  { id: 'battery.cell', slot: 'battery', name: 'Battery cell', ...T('battery.cell'), description: `+${T('battery.cell').energy} energy storage.` },
  { id: 'battery.bank', slot: 'battery', name: 'Battery bank', ...T('battery.bank'), structureOnly: true, description: `+${T('battery.bank').energy} energy storage.` },

  { id: 'factory.micro', slot: 'factory', name: 'Micro factory', ...T('factory.micro'), structureOnly: true, description: 'Lets the building produce micro units (chassis tier 0) and only those: a micro chassis is built by a factory module of its own size, and a building needs one module for each size it should build. Units come out one at a time.' },
  { id: 'factory.light', slot: 'factory', name: 'Light factory', ...T('factory.light'), structureOnly: true, description: 'Lets the building produce light units (chassis tier 1) and only those: a light chassis is built by a factory module of its own size, and a building needs one module for each size it should build. Units come out one at a time.' },
  { id: 'factory.medium', slot: 'factory', name: 'Medium factory', ...T('factory.medium'), structureOnly: true, description: 'Lets the building produce medium units (chassis tier 2) and only those: a medium chassis is built by a factory module of its own size, and a building needs one module for each size it should build. Units come out one at a time.' },
  { id: 'factory.heavy', slot: 'factory', name: 'Heavy factory', ...T('factory.heavy'), structureOnly: true, description: 'Lets the building produce heavy units (chassis tier 3) and only those: a heavy chassis is built by a factory module of its own size, and a building needs one module for each size it should build. Units come out one at a time.' },
  { id: 'factory.super', slot: 'factory', name: 'Super-heavy factory', ...T('factory.super'), structureOnly: true, description: 'Lets the building produce super-heavy units (chassis tier 4) and only those: a super-heavy chassis (needs a Titan Works-class building) is built by a factory module of its own size, and a building needs one module for each size it should build. Units come out one at a time.' },
  { id: 'factory.colossal', slot: 'factory', name: 'Colossus factory', ...T('factory.colossal'), structureOnly: true, description: 'Lets the building produce colossus units (chassis tier 5) and only those: a colossus chassis (needs a Titan Works-class building) is built by a factory module of its own size, and a building needs one module for each size it should build. Units come out one at a time.' },
  { id: 'silo', slot: 'depot', name: 'Resource silo', ...T('silo'), structureOnly: true, description: `Stores ${T('silo').storage} resources; units dock here to fill it or take from it.` },
  { id: 'build.arm', slot: 'builder', name: 'Build arm', ...T('build.arm'), mobileOnly: true, description: `Constructs buildings, investing ${T('build.arm').buildRate} resources per tick.` },
  { id: 'build.crane', slot: 'builder', name: 'Build crane', ...T('build.crane'), structureOnly: true, description: `Constructs buildings up to ${BUILDING_BUILD_RANGE / TILE} tiles from this building's edge, investing ${T('build.crane').buildRate} resources per tick.` },
  { id: 'repair.beam', slot: 'repair', name: 'Repair beam', ...T('repair.beam'), description: `Restores ${T('repair.beam').repairRate} hit points per tick to an own unit or building in reach (${BUILD_RANGE / TILE} tiles from a unit, ${BUILDING_BUILD_RANGE / TILE} from a building), costing ${T('repair.beam').use} energy per tick. Aim it with repair(h).` },
  { id: 'radar.pulse', slot: 'radar', name: 'Radar', ...T('radar.pulse'), description: `Pulse scan: radarPulse(energy) spends that energy (up to ${T('radar.pulse').radarMaxEnergy}) and reveals every unit and building within ${RADAR_ENERGY_PER_TILE} energy per tile of range, up to ${Math.floor(T('radar.pulse').radarMaxEnergy! / RADAR_ENERGY_PER_TILE)} tiles. Contacts show as blips that fade over ${RADAR_FADE_TICKS / 10}s; the module rests ${RADAR_COOLDOWN_TICKS / 10}s between pulses.` },
  { id: 'radio.basic', slot: 'comms', name: 'Radio', ...T('radio.basic'), link: 'radio', description: `Short-range radio: radioSend(channel, value) reaches every allied unit and building with a radio within ${T('radio.basic').commsRange} tiles, through rock and buildings, and raises their Message event. Costs ${T('radio.basic').use} energy per message; receiving is free.` },
  { id: 'radio.laser', slot: 'comms', name: 'Laser link', ...T('radio.laser'), link: 'laser', description: `Line-of-sight laser communication: laserSend(channel, value) reaches every allied unit and building with a laser link within ${T('radio.laser').commsRange} tiles that it has a clear line to (rock blocks it). Costs ${T('radio.laser').use} energy per message; receiving is free.` },
  { id: 'charger.pad', slot: 'charger', name: 'Charging pad', ...T('charger.pad'), structureOnly: true, description: `Transfers ${T('charger.pad').chargeRate! * CHARGE_PAD_RATE_MULTIPLIER} energy/tick (as much as the pad's store holds) from the building to each own unit within ${BUILDING_TRANSFER_RANGE / TILE} tiles.` },
  { id: 'solar.panel', slot: 'generator', name: 'Solar panel', ...T('solar.panel'), output: T('solar.panel').output! * GENERATION_SCALE, generator: 'solar', structureOnly: true, description: `Up to ${T('solar.panel').output}/tick, following daylight.` },
  { id: 'wind.turbine', slot: 'generator', name: 'Wind turbine', ...T('wind.turbine'), output: T('wind.turbine').output! * GENERATION_SCALE, generator: 'wind', structureOnly: true, description: `Up to ${T('wind.turbine').output}/tick, following the wind.` },
  { id: 'antenna.small', slot: 'antenna', name: `Energy antenna S (${T('antenna.small').antennaRange})`, ...T('antenna.small'), structureOnly: true, description: `Power links reach ${tiles(T('antenna.small').antennaRange!)}.` },
  { id: 'antenna.medium', slot: 'antenna', name: `Energy antenna M (${T('antenna.medium').antennaRange})`, ...T('antenna.medium'), structureOnly: true, description: `Power links reach ${tiles(T('antenna.medium').antennaRange!)}.` },
  { id: 'antenna.large', slot: 'antenna', name: `Energy antenna L (${T('antenna.large').antennaRange})`, ...T('antenna.large'), structureOnly: true, description: `Power links reach ${tiles(T('antenna.large').antennaRange!)}.` },

  // --- Size tiers beyond light/medium/heavy, legs, and the heavy modules that make the big tiers worth it.
  { id: 'chassis.micro', slot: 'chassis', name: 'Micro chassis', ...T('chassis.micro'), size: 0, radius: 0.22, description: 'Tiny and cheap: room for a CPU and two modules. Built at full speed by any factory.' },
  { id: 'chassis.superheavy', slot: 'chassis', name: 'Super-heavy chassis', ...T('chassis.superheavy'), size: 4, radius: 0.7, description: 'A huge armoured hull with room for heavy modules. Needs 4 factory modules, and a corridor 3 tiles wide to drive through.' },
  { id: 'chassis.colossus', slot: 'chassis', name: 'Colossus chassis', ...T('chassis.colossus'), size: 5, radius: 1, description: 'The biggest hull there is. Needs 5 factory modules and a corridor 3 tiles wide, unless it walks over the rock on colossus legs.' },
  { id: 'motor.huge', slot: 'motor', name: 'Huge motor', ...T('motor.huge'), mobileOnly: true, minSize: 3, description: 'Ground drive for heavy and bigger hulls.' },
  { id: 'legs.light', slot: 'motor', name: 'Light legs', ...T('legs.light'), mobileOnly: true, description: `Walking legs: cross open ground and climb ${T('legs.light').climb} level onto the rim of rock outcrops (half speed on rock). Fragile: only ${T('legs.light').integrity} damage breaks them, and a unit on broken legs cannot move until a repair module mends them. Do not mix with wheels or rotors.` },
  { id: 'legs.heavy', slot: 'motor', name: 'Heavy legs', ...T('legs.heavy'), mobileOnly: true, minSize: 2, description: `Strong legs for medium and bigger hulls: climb ${T('legs.heavy').climb} levels into rock (half speed on rock). Cliffs are too high. Fragile: ${T('legs.heavy').integrity} damage breaks them (see repair).` },
  { id: 'legs.colossus', slot: 'motor', name: 'Colossus legs', ...T('legs.colossus'), mobileOnly: true, minSize: 5, description: `Giant legs that stride over any rock and cliff, slowly (half speed on rock). Fragile for their size: ${T('legs.colossus').integrity} damage breaks them. Colossus chassis only.` },
  { id: 'cannon.siege', slot: 'weapon', name: 'Siege cannon', ...T('cannon.siege'), minSize: 4, weapon: { ...T('cannon.siege').weapon!, kind: 'cannon' }, description: `${T('cannon.siege').weapon!.damage} damage, range ${T('cannon.siege').weapon!.range}, one shot every ${T('cannon.siege').weapon!.cooldown / 10}s. Uses ${T('cannon.siege').weapon!.matter} matter per shot from the cargo. Super-heavy and colossus hulls only.` },
  { id: 'gun.rotary', slot: 'weapon', name: 'Rotary gun', ...T('gun.rotary'), minSize: 4, weapon: { ...T('gun.rotary').weapon!, kind: 'gun' }, description: `${T('gun.rotary').weapon!.damage} damage every ${T('gun.rotary').weapon!.cooldown} ticks, range ${T('gun.rotary').weapon!.range}: shreds crowds of small units. ${T('gun.rotary').use} energy per shot. Super-heavy and colossus hulls only.` },
  { id: 'armor.heavy', slot: 'armor', name: 'Heavy armour', ...T('armor.heavy'), minSize: 3, description: `+${T('armor.heavy').hp} hit points. Heavy and bigger hulls only.` },
  { id: 'cargo.hold', slot: 'cargo', name: `Cargo hold (${T('cargo.hold').cargo})`, ...T('cargo.hold'), mobileOnly: true, minSize: 3, description: `Harvests ${T('cargo.hold').harvestRate} per tick and carries ${T('cargo.hold').cargo} resources. Heavy and bigger hulls only.` },
  { id: 'battery.large', slot: 'battery', name: 'Large battery', ...T('battery.large'), minSize: 3, description: `+${T('battery.large').energy} energy storage for heavy and bigger hulls (and buildings).` },
];

export const PARTS: Readonly<Record<string, PartDef>> = Object.freeze({
  ...Object.fromEntries(CATALOGUE.map((p) => [p.id, Object.freeze(p)])),
  // The first factory module was one `factory.basic` that built everything it had enough copies for. Designs saved
  // with it still load: it counts as the light factory module (it is not in PART_LIST, so the designer doesn't offer it).
  'factory.basic': CATALOGUE.find((p) => p.id === 'factory.light')!,
});

export const PART_LIST: readonly PartDef[] = Object.freeze(CATALOGUE);
