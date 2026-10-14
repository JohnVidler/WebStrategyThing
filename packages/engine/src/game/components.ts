import { defineComponent } from '../ecs/component';

// Networked: replicated to clients when changed.
export const Position = defineComponent('Position', { x: 'i32', y: 'i32' }, { networked: true, wireShift: { x: 4, y: 4 } });
export const Unit = defineComponent('Unit', { blueprint: 'u16', owner: 'u8' }, { networked: true });
export const Health = defineComponent('Health', { hp: 'i32' }, { networked: true });
/** `state` is a CpuState; `fault` a VM Fault code. */
export const CpuStatus = defineComponent('CpuStatus', { used: 'u16', fault: 'u8', state: 'u8' }, { networked: true });
export const Resource = defineComponent('Resource', { amount: 'u16' }, { networked: true });
/** Server-only marker for natural resource patches, capped at their initial amount. */
export const ResourcePatch = defineComponent('ResourcePatch', { maximum: 'u16' });
export const Cargo = defineComponent('Cargo', { amount: 'u16' }, { networked: true });
/** Factory progress for the UI. `progress` is percent of the current item. */
export const Production = defineComponent(
  'Production',
  { blueprint: 'u16', progress: 'u8', queued: 'u8' },
  { networked: true },
);
/** Energy as a percentage: replicated only when the whole percent changes. */
export const EnergyView = defineComponent('EnergyView', { pct: 'u8' }, { networked: true });
/** Bit i set = parts[i] switched off. Clients need it to derive the unit's effective stats. */
export const Modules = defineComponent('Modules', { off: 'u32' }, { networked: true });
/** Resources held by a building with silos. */
export const Stockpile = defineComponent('Stockpile', { amount: 'i32' }, { networked: true });
/** Present while a building is still being constructed. `progress` is percent. */
export const Construction = defineComponent('Construction', { progress: 'u8' }, { networked: true });

// Server-only.
/** `arrived`: 1 = reached the end of the path to (tx, ty); 2 = stopped short by a crowd. */
export const Motion = defineComponent('Motion', { tx: 'i32', ty: 'i32', moving: 'u8', arrived: 'u8' });
export const Weapon = defineComponent('Weapon', { target: 'i32', cooldown: 'u16', power: 'u16' });
/** `target` is the resource handle last given to harvest() — kept as "where I was working". */
export const Harvester = defineComponent('Harvester', { target: 'i32' });
export const Energy = defineComponent('Energy', { amount: 'i32' });
/** Buildings only: how the power network treats this building's store (StorageMode). */
export const Storage = defineComponent('Storage', { mode: 'u8' });
/** Construction site handle last given to build(). */
export const Builder = defineComponent('Builder', { target: 'i32' });

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
] as const;
