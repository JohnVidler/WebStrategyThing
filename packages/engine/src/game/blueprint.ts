import type { Program } from '../vm/types';
import { PARTS, SWITCHABLE, type PartDef, type WeaponKind } from './parts';
import { ANTENNA_THROUGHPUT_PER_TILE, BASE_LINK_RANGE, BASE_STACK, BUILD_TIME_BASE, BUILD_TIME_PER_MASS, COST_PER_MASS, CYCLE_COST, PRODUCTION_ENERGY_BY_SLOT, PRODUCTION_ENERGY_PER_MODULE, REPAIR_ARMOR_MULTIPLIER, REPAIR_MATTER_PER_HP, SPEED_FACTOR, TILE } from './rules';
import { TESLA_COOLDOWN, TESLA_RANGE } from './rules';

/** Converts total thrust / mass into sub-tile units per tick. */
/** Module on/off state is a 32-bit mask, one bit per part. */
export const MAX_PARTS = 32;
/** Buildings without an antenna link to others within this many tiles (edge to edge). */

/** Capability bits, also exposed to scripts (CAN_MOVE, CAN_FIGHT, ...). */
export const Caps = {
  Move: 1,
  Fight: 2,
  Harvest: 4,
  Structure: 8,
  Factory: 16,
  Depot: 32,
  Fly: 64,
  Charger: 128,
  Generator: 256,
  Storage: 512,
  Build: 1024,
  Radar: 2048,
  Repair: 4096,
} as const;

export class BlueprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlueprintError';
  }
}

/**
 * Derived once per (blueprint, module mask), then shared read-only by every
 * unit of that class with those modules switched on.
 */
export interface BlueprintStats {
  readonly hp: number;
  readonly mass: number;
  readonly cyclesPerTick: number;
  readonly memorySlots: number;
  readonly stackDepth: number;
  /** Sub-tile units per tick. */
  readonly speed: number;
  readonly flying: boolean;
  /** Sub-tile units. */
  readonly sensorRange: number;
  readonly weapon: {
    readonly range: number;
    readonly damage: number;
    readonly cooldown: number;
    readonly use: number;
    readonly kind: WeaponKind;
    readonly matter: number;
  } | null;
  readonly cargo: number;
  readonly harvestRate: number;
  readonly structure: boolean;
  /** Tiles per side (0 for mobile units). */
  readonly footprint: number;
  readonly factory: boolean;
  readonly depot: boolean;
  readonly chargeRate: number;
  /** Resources the building's silos hold. */
  readonly resourceCapacity: number;
  /** Resources per tick invested by build arms. */
  readonly buildRate: number;
  /** Peak generation per tick. */
  readonly solar: number;
  readonly wind: number;
  /** Tiles a power link reaches from this building's edge. */
  readonly linkRange: number;
  /** Energy per tick a long (antenna) link from this building can carry; 0 without an antenna. */
  readonly linkThroughput: number;
  readonly energyCapacity: number;
  /** Energy per 100 CPU cycles / per tick moving / per scan / per tick harvesting / per tick producing. */
  readonly cpuUse: number;
  readonly motorUse: number;
  readonly sensorUse: number;
  /** Most energy one radar pulse may spend; 0 without a working radar. */
  readonly radarMaxEnergy: number;
  readonly cargoUse: number;
  readonly factoryUse: number;
  readonly builderUse: number;
  /** Hit points per tick restored by the repair module, and the energy per tick it uses. */
  readonly repairRate: number;
  /** Matter it costs to mend one hit point of this class (armour plating costs more). */
  readonly repairMatterPerHp: number;
  readonly repairUse: number;
  readonly caps: number;
  /** Credits to produce one. */
  readonly cost: number;
  /** Ticks to produce one. */
  readonly buildTime: number;
  /** Energy the factory spends producing one (over its build time), from module count and types. */
  readonly buildEnergy: number;
  readonly size: number;
}

/** What goes over the wire: just part ids. Stats are re-derived on the client from the shared catalogue. */
export interface BlueprintInfo {
  readonly id: number;
  readonly owner: number;
  readonly name: string;
  readonly parts: readonly string[];
  /** Retired classes can't be produced or placed; existing units carry on. */
  readonly retired?: boolean;
}

/**
 * A unit class — the flyweight. Units hold only a blueprint id, a module mask
 * and their own mutable state; stats and program are shared through this object.
 */
export interface Blueprint extends BlueprintInfo {
  /** Stats with every module switched on. */
  readonly stats: BlueprintStats;
  /** Memoised stats per module-off mask. */
  readonly variants: Map<number, BlueprintStats>;
  /** Server-only. Swapping it hot-reloads every unit of the class. */
  program: Program | null;
  retired: boolean;
}

function validate(defs: PartDef[]): PartDef {
  if (defs.length > MAX_PARTS) throw new BlueprintError(`At most ${MAX_PARTS} parts`);
  const chassis = defs.filter((d) => d.slot === 'chassis');
  if (chassis.length !== 1) throw new BlueprintError('A class needs exactly one chassis or frame');
  const frame = chassis[0];
  const slots = frame.slots ?? 0;
  if (defs.length - 1 > slots) throw new BlueprintError(`${frame.name} holds ${slots} modules, got ${defs.length - 1}`);
  if (defs.filter((d) => d.weapon).length > 1) throw new BlueprintError('Only one weapon per class (for now)');
  const structure = frame.structure === true;
  for (const d of defs) {
    if (structure && d.mobileOnly) throw new BlueprintError(`${d.name} only fits mobile units`);
    if (!structure && d.structureOnly) throw new BlueprintError(`${d.name} only fits buildings`);
  }
  const motors = defs.filter((d) => d.slot === 'motor');
  if (motors.some((d) => d.flight) && motors.some((d) => !d.flight)) {
    throw new BlueprintError('Rotors and ground motors cannot be mixed');
  }
  return frame;
}

/**
 * `off` has bit i set when parts[i] is switched off. Switched-off modules still
 * weigh something and still hold memory/stack/battery capacity, but contribute
 * no capability and use no energy.
 */
export function deriveStats(parts: readonly string[], off = 0): BlueprintStats {
  const defs = parts.map((id) => {
    const def = PARTS[id];
    if (!def) throw new BlueprintError(`Unknown part '${id}'`);
    return def;
  });
  const frame = validate(defs);
  const structure = frame.structure === true;

  let hp = 0, mass = 0, memory = 0, stack = BASE_STACK, energy = 0, fullCycles = 0;
  let cycles = 0, cpuUse = 0, thrust = 0, motorUse = 0, flying = false;
  let sensor = 0, sensorUse = 0, cargo = 0, rate = 0, cargoUse = 0;
  let factory = false, factoryUse = 0, silo = 0, charge = 0, solar = 0, wind = 0, antenna = 0, antennas = 0, banks = 0;
  let buildRate = 0, builderUse = 0, radarMax = 0, buildEnergy = 0, repairRate = 0, repairUse = 0, armorHp = 0;
  let weapon: BlueprintStats['weapon'] = null;

  defs.forEach((d, i) => {
    // Passive properties: always present.
    hp += d.hp ?? 0;
    if (d.slot === 'armor') armorHp += d.hp ?? 0;
    mass += d.mass;
    memory += d.memory ?? 0;
    stack += d.stack ?? 0;
    energy += d.energy ?? 0;
    fullCycles += d.cycles ?? 0;
    if (d.slot !== 'chassis') buildEnergy += PRODUCTION_ENERGY_PER_MODULE + (PRODUCTION_ENERGY_BY_SLOT[d.slot] ?? 0);
    if (d.slot === 'battery' && d.structureOnly) banks++;
    silo += d.storage ?? 0;
    const on = !(SWITCHABLE.has(d.slot) && (off >>> i) & 1);
    if (!on) return;
    switch (d.slot) {
      case 'cpu':
        cycles += d.cycles ?? 0;
        cpuUse = Math.max(cpuUse, d.use ?? 0);
        break;
      case 'motor':
        thrust += d.thrust ?? 0;
        motorUse += d.use ?? 0;
        flying ||= d.flight === true;
        break;
      case 'sensor':
        if ((d.sensorRange ?? 0) > sensor) {
          sensor = d.sensorRange ?? 0;
          sensorUse = d.use ?? 0;
        }
        break;
      case 'weapon':
        weapon = Object.freeze({
          range: d.weapon!.kind === 'tesla' ? TESLA_RANGE : d.weapon!.range * TILE,
          damage: d.weapon!.damage,
          cooldown: d.weapon!.kind === 'tesla' ? TESLA_COOLDOWN : d.weapon!.cooldown,
          use: d.use ?? 0,
          kind: d.weapon!.kind ?? 'gun',
          matter: d.weapon!.matter ?? 0,
        });
        break;
      case 'cargo':
        cargo += d.cargo ?? 0;
        rate += d.harvestRate ?? 0;
        cargoUse += d.use ?? 0;
        break;
      case 'factory':
        factory = true;
        factoryUse += d.use ?? 0;
        break;
      case 'charger':
        charge += d.chargeRate ?? 0;
        break;
      case 'generator':
        if (d.generator === 'solar') solar += d.output ?? 0;
        else wind += d.output ?? 0;
        break;
      case 'antenna':
        antenna = Math.max(antenna, d.antennaRange ?? 0);
        antennas++;
        break;
      case 'radar':
        radarMax = Math.max(radarMax, d.radarMaxEnergy ?? 0);
        break;
      case 'repair':
        repairRate += d.repairRate ?? 0;
        repairUse += d.use ?? 0;
        break;
      case 'builder':
        buildRate += d.buildRate ?? 0;
        builderUse += d.use ?? 0;
        break;
    }
  });

  const speed = structure ? 0 : Math.floor((thrust * SPEED_FACTOR) / mass);
  const depot = silo > 0;
  const caps =
    (speed > 0 ? Caps.Move : 0) |
    (weapon ? Caps.Fight : 0) |
    (cargo > 0 ? Caps.Harvest : 0) |
    (structure ? Caps.Structure : 0) |
    (factory ? Caps.Factory : 0) |
    (depot ? Caps.Depot : 0) |
    (flying && speed > 0 ? Caps.Fly : 0) |
    (charge > 0 ? Caps.Charger : 0) |
    (solar + wind > 0 ? Caps.Generator : 0) |
    (banks > 0 ? Caps.Storage : 0) |
    (buildRate > 0 ? Caps.Build : 0) |
    (radarMax > 0 ? Caps.Radar : 0) |
    (repairRate > 0 ? Caps.Repair : 0);

  return Object.freeze({
    hp,
    mass,
    cyclesPerTick: cycles,
    memorySlots: memory,
    stackDepth: stack,
    speed,
    flying: flying && speed > 0,
    sensorRange: sensor * TILE,
    weapon,
    cargo,
    harvestRate: rate,
    structure,
    footprint: structure ? (frame.footprint ?? 1) : 0,
    factory,
    depot,
    chargeRate: charge,
    resourceCapacity: silo,
    buildRate,
    solar,
    wind,
    linkRange: Math.max(BASE_LINK_RANGE, antenna),
    linkThroughput: antennas * (structure ? (frame.footprint ?? 1) : 0) * ANTENNA_THROUGHPUT_PER_TILE,
    energyCapacity: energy,
    cpuUse,
    motorUse,
    sensorUse,
    radarMaxEnergy: radarMax,
    cargoUse,
    factoryUse,
    builderUse,
    repairRate,
    repairUse,
    repairMatterPerHp: hp > 0 ? (REPAIR_MATTER_PER_HP * (hp - armorHp + armorHp * REPAIR_ARMOR_MULTIPLIER)) / hp : 0,
    caps,
    cost: COST_PER_MASS * mass + CYCLE_COST * fullCycles,
    buildTime: BUILD_TIME_BASE + BUILD_TIME_PER_MASS * mass,
    buildEnergy,
    size: frame.size ?? 0,
  });
}

/** Stats for a unit of `bp` with module mask `off` (shared between all units with that mask). */
export function statsFor(bp: Blueprint, off: number): BlueprintStats {
  if (off === 0) return bp.stats;
  let s = bp.variants.get(off);
  if (!s) {
    s = deriveStats(bp.parts, off);
    bp.variants.set(off, s);
  }
  return s;
}

export function toInfo(bp: Blueprint): BlueprintInfo {
  return { id: bp.id, owner: bp.owner, name: bp.name, parts: bp.parts, retired: bp.retired };
}

export class BlueprintRegistry {
  /** Index = blueprint id (u16 on the wire). */
  private readonly list: (Blueprint | undefined)[] = [];

  get(id: number): Blueprint | undefined {
    return this.list[id];
  }

  all(): Blueprint[] {
    return this.list.filter((b): b is Blueprint => b !== undefined);
  }

  ownedBy(owner: number): Blueprint[] {
    return this.all().filter((b) => b.owner === owner);
  }

  find(owner: number, name: string): Blueprint | undefined {
    return this.list.find((b) => b?.owner === owner && b.name === name);
  }

  /** Authority side: allocate an id. */
  define(owner: number, name: string, parts: readonly string[]): Blueprint {
    const id = this.list.length;
    if (id > 0xffff) throw new BlueprintError('Blueprint limit reached');
    return this.register({ id, owner, name, parts });
  }

  /** Mirror side: adopt a server-assigned id. */
  register(info: BlueprintInfo): Blueprint {
    const bp: Blueprint = {
      id: info.id,
      owner: info.owner,
      name: info.name,
      parts: Object.freeze([...info.parts]),
      stats: deriveStats(info.parts),
      variants: new Map(),
      program: null,
      retired: info.retired === true,
    };
    this.list[info.id] = bp;
    return bp;
  }

  setProgram(id: number, program: Program): void {
    const bp = this.list[id];
    if (!bp) throw new BlueprintError(`No blueprint ${id}`);
    if (program.slots > bp.stats.memorySlots) {
      throw new BlueprintError(
        `Program uses ${program.slots} variables but '${bp.name}' only has ${bp.stats.memorySlots} memory slots`,
      );
    }
    bp.program = program;
  }
}
