import { defineComponent } from '../ecs/component';

// Networked: replicated to clients when changed.
export const Position = defineComponent('Position', { x: 'i32', y: 'i32' }, { networked: true, wireShift: { x: 4, y: 4 } });
export const Unit = defineComponent('Unit', { blueprint: 'u16', owner: 'u8' }, { networked: true });
export const Health = defineComponent('Health', { hp: 'i32' }, { networked: true });
/** `state` is a CpuState; `fault` a VM Fault code. */
export const CpuStatus = defineComponent('CpuStatus', { used: 'u16', fault: 'u8', state: 'u8' }, { networked: true });
export const Resource = defineComponent('Resource', { amount: 'u16' }, { networked: true });
/** Marker for natural resource patches, capped at their initial amount. Networked (once, at spawn) so clients can show how full a node is. */
export const ResourcePatch = defineComponent('ResourcePatch', { maximum: 'u16' }, { networked: true });
/**
 * Marker for debris: the wreck of a unit that ran out of energy and broke down. It is a matter block (it also
 * has Resource) that harvesters use up and that is then removed; it does not regrow. `maximum` is the amount it
 * started with, `look` the wrecked unit's hull size tier (0 to 5) plus 8 if it flew, for the art.
 */
export const Debris = defineComponent('Debris', { maximum: 'u16', look: 'u8' }, { networked: true });
/** A fixed map feature (steam vent or scenery, see features.ts): `kind` is a FeatureKind. It never changes, so it is only sent once. */
export const Feature = defineComponent('Feature', { kind: 'u8' }, { networked: true });
export const Cargo = defineComponent('Cargo', { amount: 'u16' }, { networked: true });
/**
 * Factory progress for the UI. `blueprint` is the item being built, `progress` its percent and `queued`
 * the queue length; `q1`-`q7` are the items waiting behind it (0 = empty), so clients can draw the whole queue.
 */
export const Production = defineComponent(
  'Production',
  { blueprint: 'u16', progress: 'u8', queued: 'u8', q1: 'u16', q2: 'u16', q3: 'u16', q4: 'u16', q5: 'u16', q6: 'u16', q7: 'u16' },
  { networked: true },
);
/** Energy as a percentage: replicated only when the whole percent changes. */
export const EnergyView = defineComponent('EnergyView', { pct: 'u8' }, { networked: true });
/** Bit i set = parts[i] switched off (`off`) or broken by damage (`broken`). Clients need both to derive the unit's effective stats. */
export const Modules = defineComponent('Modules', { off: 'u32', broken: 'u32' }, { networked: true });
/** Resources held by a building with silos. */
export const Stockpile = defineComponent('Stockpile', { amount: 'i32' }, { networked: true });
/** Present while a building is still being constructed. `progress` is percent. */
export const Construction = defineComponent('Construction', { progress: 'u8' }, { networked: true });

/**
 * A missile in flight (also has Position and Health, so weapons can shoot it down). `size` is the
 * matter it cost (drives the art), `heading` the direction it points in 256ths of a turn from
 * east, `blast` the burst radius in tenths of a tile.
 */
export const Missile = defineComponent('Missile', { owner: 'u8', size: 'u8', heading: 'u8', blast: 'u8' }, { networked: true });

/**
 * A cannon shell in flight (Position only; its flight is in `Simulation.shellFlights`). `size` is its damage (capped),
 * `heading` as for Missile, `state` 0 = flying, 1 = spent (it stays one tick where it landed so clients can show the impact).
 */
export const Shell = defineComponent('Shell', { owner: 'u8', size: 'u8', heading: 'u8', state: 'u8' }, { networked: true });

/**
 * A flamethrower fireball in the air or the fire it left (Position only; the rest is in `Simulation.flameFlights`).
 * `state` 0 = in the air (`arc` is how far along its flight it is, 0 to 255, for the lob), 1 = burning (`life` is the fire left, 0 to 32).
 */
export const Flame = defineComponent('Flame', { owner: 'u8', state: 'u8', arc: 'u8', life: 'u8' }, { networked: true });

/** Which way a long-range weapon points, in 256ths of a turn from east: its owner sees a thin wedge along it (see vision.ts). */
export const Aim = defineComponent('Aim', { heading: 'u8' }, { networked: true });

/**
 * A unit's or building's energy shield (see shield.ts): an arc of energy centred on the owner. `heading` and `arc` are in 256ths of
 * a turn (heading from east, as for Aim), `range` in tenths of a tile, `active` 1 while the shield is up (module on, working and paid for), `strain` how many points its arc crosses another shield's (each drains more power).
 */
export const Shield = defineComponent('Shield', { heading: 'u8', arc: 'u8', range: 'u8', active: 'u8', strain: 'u8' }, { networked: true });

// Server-only.
/** `arrived`: 1 = reached the end of the path to (tx, ty); 2 = stopped short by a crowd. */
export const Motion = defineComponent('Motion', { tx: 'i32', ty: 'i32', moving: 'u8', arrived: 'u8' });
/** `aim`: the module class (SLOT_CODES) shots are aimed at; 0 = any, a random module each hit. */
export const Weapon = defineComponent('Weapon', { target: 'i32', cooldown: 'u16', power: 'u16', aim: 'u8' });
/** `target` is the resource handle last given to harvest() — kept as "where I was working". */
export const Harvester = defineComponent('Harvester', { target: 'i32' });
export const Energy = defineComponent('Energy', { amount: 'i32' });
/** Buildings only: how the power network treats this building's store (StorageMode). */
export const Storage = defineComponent('Storage', { mode: 'u8' });
/** Construction site handle last given to build(). */
export const Builder = defineComponent('Builder', { target: 'i32' });

/** Own unit or building handle last given to repair(). */
export const Repairer = defineComponent('Repairer', { target: 'i32' });

/** CpuStatus.state values. */
export const CpuState = {
  Running: 0,
  Sleeping: 1,
  NoPower: 2,
  Offline: 3,
  /** Held by a tesla discharge: the program doesn't run until it wears off. */
  Stunned: 4,
} as const;

/**
 * Registration order defines component wire ids, so server and client must
 * both build their World from this exact list. Append only once matches persist.
 */
export const GAME_COMPONENTS = [
  Position,
  Unit,
  Health,
  CpuStatus,
  Resource,
  Cargo,
  Production,
  EnergyView,
  Modules,
  Motion,
  Weapon,
  Harvester,
  Energy,
  Storage,
  Stockpile,
  Construction,
  Builder,
  ResourcePatch,
  Repairer,
  Missile,
  Feature,
  Debris,
  Shell,
  Aim,
  Shield,
  Flame,
] as const;
