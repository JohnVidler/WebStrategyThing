/*
 * The object tree programs see. Instead of a long list of global calls there is `self` (the unit or building running
 * the program) with its own readings and orders, and `self.modules`, which holds one object per kind of module:
 *
 *   if (self.hp < self.hpMax / 2) self.moveTo(0, 0);
 *   self.modules['weapon'].fire(foe);
 *   self.modules.shield.angle(90);        // the same thing, written with a dot
 *
 * This table says where each builtin lives. Builtins missing from it stay global (the world queries such as
 * findResources, and maths such as rand). The tree is only how the text form is written: the graph editor, the
 * compiler and the VM all still use the flat builtin names, and the flat names still read in the text form, so
 * saved programs keep working. Add new module calls here when you add them to `UNIT_API`.
 *
 * Modules a class may carry several of are lists: `self.modules.weapon.length`, `self.modules.weapon[i].fire(h)`, and
 * `self.modules.weapon.filter(w => self.modules.weapon[w].kind === W_LASER).first()` to pick one. The plain
 * `self.modules.weapon.fire(h)` (no index) acts on every weapon. A class carries up to `maxWeapons` of them, by size.
 */

/** Read-only values of the unit, written without brackets: `self.hp`. */
const SELF_PROPERTIES: readonly string[] = [
  'x', 'y', 'hp', 'hpMax', 'energy', 'energyMax', 'cargo', 'cargoMax', 'caps', 'tick', 'credits', 'size', 'climb', 'wade',
  'flying', 'moving', 'activity', 'orderCount', 'orderType', 'moduleCount',
];

/** Things the unit does or asks, written `self.name(...)`. */
const SELF_METHODS: readonly string[] = [
  'rest', 'after', 'moveTo', 'move', 'stop', 'goTo', 'approach', 'harvest', 'dock', 'take', 'build', 'repair', 'charge', 'supply',
  'engage', 'suspendActivity', 'resumeActivity', 'nextOrder', 'swapOrder', 'clearOrders', 'alert', 'notify', 'giveEnergy',
  'moduleKind', 'moduleOn', 'moduleBroken', 'setModule',
];

/** Builtin name -> module and the name it goes by on that module's object. */
const MODULE_MEMBERS: Readonly<Record<string, readonly [module: string, member: string]>> = {
  fire: ['weapon', 'fire'],
  weaponCount: ['weapon', 'length'],
  weaponKind: ['weapon[]', 'kind'],
  weaponRange: ['weapon[]', 'range'],
  weaponFire: ['weapon[]', 'fire'],
  weaponLaserPower: ['weapon[]', 'laserPower'],
  weaponAim: ['weapon[]', 'aim'],
  laserPower: ['weapon', 'laserPower'],
  aim: ['weapon', 'aim'],
  shieldAngle: ['shield', 'angle'],
  shieldArc: ['shield', 'arc'],
  shieldRange: ['shield', 'range'],
  shieldUp: ['shield', 'up'],
  incomingBearing: ['shield', 'incomingBearing'],
  lightAngle: ['light', 'angle'],
  lightPower: ['light', 'power'],
  lightHeading: ['light', 'heading'],
  lightOn: ['light', 'on'],
  lightBlocked: ['light', 'blocked'],
  outwardBearing: ['light', 'outwardBearing'],
  smoke: ['smoke', 'launch'],
  smokeReady: ['smoke', 'ready'],
  droneClass: ['hangar', 'droneClass'],
  launchDrones: ['hangar', 'launch'],
  recallDrones: ['hangar', 'recall'],
  dronesDocked: ['hangar', 'docked'],
  dronesOut: ['hangar', 'out'],
  radarPulse: ['radar', 'pulse'],
  radarCooldown: ['radar', 'cooldown'],
  radioSend: ['radio', 'send'],
  laserSend: ['laserLink', 'send'],
  storageMode: ['storage', 'mode'],
  queueUnit: ['factory', 'queue'],
  queueLength: ['factory', 'queueLength'],
  unitClassCount: ['factory', 'classCount'],
};

/**
 * Module calls that are read without brackets, like `self.modules.weapon.length`. A module written `name[]` is a list of
 * modules of that kind: `self.modules.weapon[i].kind` takes the index as the builtin's first argument.
 */
const MODULE_PROPERTIES: ReadonlySet<string> = new Set(['weaponCount', 'weaponKind', 'weaponRange']);

/** List sources: `self.modules.weapon` starts a chain (`.filter(...)`, `.first()`), like the find calls. */
const MODULE_LISTS: Readonly<Record<string, string>> = { weapons: 'weapon' };

/** Other names a module answers to in `self.modules[...]`: the real names are the ones the editors write. */
export const MODULE_ALIASES: ReadonlyMap<string, string> = new Map([
  ['gun', 'weapon'],
  ['laser', 'laserLink'],
]);

/** What the text form calls a builtin: its path in the tree and whether it is a property, or undefined if it stays global. */
export function memberOf(name: string): { member: string; prop: boolean } | undefined {
  if (SELF_PROPERTIES.includes(name)) return { member: `self.${name}`, prop: true };
  if (name === 'me') return { member: 'self.id', prop: true };
  if (SELF_METHODS.includes(name)) return { member: `self.${name}`, prop: false };
  if (MODULE_LISTS[name]) return { member: `self.modules.${MODULE_LISTS[name]}`, prop: false };
  const m = MODULE_MEMBERS[name];
  if (m && MODULE_PROPERTIES.has(name)) return { member: `self.modules.${m[0]}.${m[1]}`, prop: true };
  return m ? { member: `self.modules.${m[0]}.${m[1]}`, prop: false } : undefined;
}
