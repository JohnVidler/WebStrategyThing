/**
 * Starter content: the classes every player begins with and the starting base
 * layout. Each class's behaviour is entirely its program — players are expected
 * to rewrite these. Buildings are built from the same modules as units.
 *
 * Programs are written here as text (the TypeScript subset, see flow/text.ts) and stored
 * as the canonical JSON of the same program, which is what classes, designs and the
 * wire carry. They are event-driven: a unit reacts to orders, sensor reports, visits and
 * the end of its own jobs, and nothing polls (no `Idle` block).
 */

import { printText, parseText } from '../flow/text';
import { serialize } from '../flow/ir';
import { FLOW_HOST } from './actions';

export interface ClassTemplate {
  readonly name: string;
  readonly parts: readonly string[];
  /** Stored program (JSON). Empty for classes without a CPU (they just provide their modules). */
  readonly program: string;
  /** The same program as text, for reading (starter classes only). */
  readonly text?: string;
}

/** Turns program text into the stored form, failing loudly (at start-up) on a mistake in the starter content. */
export function programFromText(name: string, text: string): string {
  const { doc, errors } = parseText(text, FLOW_HOST);
  if (errors.length) {
    throw new Error(`Starter program '${name}': ${errors.map((e) => `${e.message} at ${e.from}`).join('; ')}`);
  }
  return serialize(doc);
}

/** Text of a stored program, normalised through the printer (what the Text view shows). */
export const normalisedText = (name: string, text: string): string => printText(parseText(text, FLOW_HOST).doc, FLOW_HOST);

const template = (name: string, parts: readonly string[], text: string): ClassTemplate => ({
  name,
  parts,
  program: text.trim() ? programFromText(name, text) : '',
  text,
});

// --- Buildings -----------------------------------------------------------------------
//
// Every program here is a few `use(...)` lines: built-in blocks (see flow/blocks.ts) with settings. A block
// is a template that expands into ordinary event blocks, so what it costs is what the expanded program costs.
// Right-click a block in the editor and choose Expand to turn it into plain events you can change.

export const HQ_CLASS: ClassTemplate = template('HQ', [
  'frame.large', 'cpu.fast', 'mem.small', 'sensor.long', 'factory.basic', 'factory.basic', 'silo', 'silo',
  'solar.panel', 'solar.panel', 'battery.cell',
], `// Headquarters: produces units and stores harvested resources in its silos.
// Right-clicking with the HQ selected sets the rally point; harvesters that are produced or dock here
// are sent to a random nearby field.
use(RallyPoint);
use(DispatchHarvesters, { fieldsToChooseFrom: 4, minMatter: 10 });
`);

// Specialised unit factories: the size of unit a building can produce grows with its factory modules
// (1 light, 2 medium, 3 heavy). The HQ has two, so anything lighter than a heavy unit is built there.
const FACTORY_PROGRAM = `// Produces units and sends each new one to the rally point (right-click with the building selected).
use(RallyPoint);
`;

export const LIGHT_FACTORY_CLASS: ClassTemplate = template('Light Factory', ['frame.small', 'cpu.basic', 'factory.basic', 'battery.cell'], FACTORY_PROGRAM);

export const VEHICLE_FACTORY_CLASS: ClassTemplate = template('Vehicle Factory', ['frame.medium', 'cpu.basic', 'factory.basic', 'factory.basic', 'battery.cell'], FACTORY_PROGRAM);

export const HEAVY_FACTORY_CLASS: ClassTemplate = template('Heavy Factory', ['frame.large', 'cpu.basic', 'factory.basic', 'factory.basic', 'factory.basic', 'battery.bank'], FACTORY_PROGRAM);

export const CHARGING_PAD_CLASS: ClassTemplate = template('Charging Pad', ['frame.small', 'charger.pad', 'battery.cell'], '');

export const SOLAR_CLASS: ClassTemplate = template('Solar Array', ['frame.medium', ...Array<string>(8).fill('solar.panel')], '');

export const WIND_CLASS: ClassTemplate = template('Wind Turbine', ['frame.small', 'wind.turbine', 'wind.turbine'], '');

// Energy storage: a pile of battery banks and a small CPU deciding which way the energy flows. Soak up
// surplus; give it back when generation falls short. Its buttons let the player hold the charge back.
const STORAGE_PROGRAM = `use(StorageController, { interval: 4 });
`;

export const STORAGE_CLASS: ClassTemplate = template('Energy Storage', ['frame.medium', 'cpu.basic', ...Array<string>(8).fill('battery.bank')], STORAGE_PROGRAM);

/** The starting base's store: a quarter of the full Energy Storage. */
export const SMALL_STORAGE_CLASS: ClassTemplate = template('Small Energy Storage', ['frame.small', 'cpu.basic', 'battery.bank', 'battery.bank'], STORAGE_PROGRAM);

export const SILO_CLASS: ClassTemplate = template('Resource Silo', ['frame.medium', 'cpu.basic', 'mem.small', ...Array<string>(6).fill('silo')], `// Resource Silo: send visiting harvesters to a random nearby field.
use(DispatchHarvesters);
`);

export const TOWER_CLASS: ClassTemplate = template('Construction Tower', ['frame.small', 'cpu.basic', 'build.crane', 'repair.beam', 'battery.cell'], `// Construction tower: builds any own site within 4 tiles of its edge, paid from the common pool, so it
// must be linked by the power grid to a silo. With nothing to build it mends the nearest damaged own
// unit or building in reach. While it has nothing to do, it looks again every 10 ticks.
use(MaintainNearby, { interval: 10 });
`);

export const LASER_TURRET_CLASS: ClassTemplate = template('Laser Turret', ['frame.small', 'cpu.basic', 'sensor.long', 'laser.beam', 'battery.bank'], `// Laser turret: shoots the nearest enemy its sensor finds. Each shot costs a lot of energy, so it must be
// linked to a power network (or it runs on its battery bank).
use(EngageEnemies, { watch: [ENEMY], interval: 3, orders: 0, holdFireKey: '' });
`);

export const RADAR_TOWER_CLASS: ClassTemplate = template('Radar Tower', ['frame.small', 'cpu.basic', 'radar.pulse', 'battery.bank'], `// Radar tower: pings the map as soon as its radar has rested, as long as the radar module is switched on
// and the tower holds more than half its energy. 500 energy buys a 20-tile pulse.
use(RadarPing, { energy: 500 });
`);

export const PYLON_CLASS: ClassTemplate = template('Power Pylon', ['frame.small', 'antenna.large'], '');

// --- Units ---------------------------------------------------------------------------

/** Orders every moving unit takes, and recharging when low. */
const BASICS = (below: number) => `use(TakeOrders, { types: [MOVE, STOP, CHARGE], urgent: REPLACE });
use(RechargeWhenLow, { below: ${below} });`;

export const HARVESTER_CLASS: ClassTemplate = template('Harvester', ['chassis.light', 'cpu.basic', 'motor.small', 'cargo.bay', 'battery.cell'], `// Harvester: the engine walks, gathers and unloads; the program only decides what comes next.
${BASICS(25)}
use(ReviveFlatUnits);
use(HarvestLoop, { fieldsToChooseFrom: 4, minMatter: 10 });
`);

export const BUILDER_CLASS: ClassTemplate = template('Builder', ['chassis.medium', 'cpu.basic', 'motor.large', 'build.arm', 'cargo.bay', 'battery.cell'], `// Builder: works BUILD orders. Sites linked to a silo by the power grid draw from the common pool;
// remote sites need resources carried to them.
${BASICS(30)}
use(ReviveFlatUnits);
use(BuildJobs, { interval: 20 });
`);

export const REPAIR_CLASS: ClassTemplate = template('Repair Drone', ['chassis.medium', 'cpu.basic', 'motor.small', 'cargo.bay', 'repair.beam', 'battery.cell'], `// Repair drone: mends own units and buildings. Repairs cost energy and matter (more for armour); the
// matter is carried in the cargo bay and fetched from the nearest stocked silo. REPAIR orders are worked
// first; when free it picks the nearest damaged own unit or building itself.
${BASICS(25)}
use(ReviveFlatUnits);
use(RepairJobs, { interval: 20 });
`);

export const FIGHTER_PROGRAM_TEXT = `// Follows MOVE / ATTACK / STOP / CHARGE orders. Its sensor sweeps every 5 ticks and it shoots the nearest
// enemy in range without chasing it. ATTACK without a target (the Attack button on open ground) is an
// attack-move. The "Hold fire" button toggles shooting at things that wander into range.
${BASICS(25)}
use(ReviveFlatUnits);
use(EngageEnemies, { watch: [ENEMY], interval: 5, holdFireKey: 'F' });
`;

/** Ammunition for weapons that use matter (cannon, missiles): fetch a full cargo bay from a stocked silo when low. */
const resupply = (below: number) => `use(Resupply, { below: ${below} });
`;

/** The fighter program in stored form (also run by the bots). */
export const FIGHTER_PROGRAM = programFromText('Fighter', FIGHTER_PROGRAM_TEXT);

export const SCOUT_CLASS: ClassTemplate = template('Scout', ['chassis.light', 'cpu.basic', 'motor.small', 'sensor.short', 'gun.light'], FIGHTER_PROGRAM_TEXT);

export const HAWK_CLASS: ClassTemplate = template('Hawk', ['chassis.light', 'cpu.basic', 'rotor', 'sensor.short', 'gun.light'], FIGHTER_PROGRAM_TEXT);

/** One unit for each weapon, so every weapon gets played: cannon, laser, tesla coil and missiles (the gun is the Scout and Hawk). */
export const TANK_CLASS: ClassTemplate = template('Tank', ['chassis.medium', 'cpu.basic', 'motor.large', 'sensor.short', 'gun.cannon', 'cargo.bay', 'battery.cell'], FIGHTER_PROGRAM_TEXT + resupply(6));

export const LANCER_CLASS: ClassTemplate = template('Lancer', ['chassis.medium', 'cpu.basic', 'motor.small', 'sensor.short', 'laser.beam', 'battery.cell', 'battery.cell'], FIGHTER_PROGRAM_TEXT);

export const STORMER_CLASS: ClassTemplate = template('Stormer', ['chassis.light', 'cpu.basic', 'motor.small', 'sensor.short', 'tesla.coil'], FIGHTER_PROGRAM_TEXT);

export const ROCKET_CLASS: ClassTemplate = template('Rocket Truck', ['chassis.medium', 'cpu.basic', 'motor.small', 'sensor.long', 'missile.medium', 'cargo.bay', 'cargo.bay'], FIGHTER_PROGRAM_TEXT + resupply(12));

/** Anti-missile cover: the fighter program, but its sensor watches for incoming missiles and it fires at nothing else. */
const FLAK_PROGRAM_TEXT = `// Flak: shoots incoming missiles only (its burst is harmless to everything else). Follows MOVE / ATTACK / STOP / CHARGE orders.
${BASICS(25)}
use(ReviveFlatUnits);
use(EngageEnemies, { watch: [MISSILE], interval: 2, holdFireKey: 'F' });
`;

export const FLAK_CLASS: ClassTemplate = template('Flak Truck', ['chassis.medium', 'cpu.basic', 'motor.small', 'sensor.short', 'flak.cannon', 'battery.cell'], FLAK_PROGRAM_TEXT);

export const FLAK_TURRET_CLASS: ClassTemplate = template('Flak Turret', ['frame.small', 'cpu.basic', 'sensor.short', 'flak.cannon', 'battery.bank'], `// Flak turret: bursts any incoming enemy missile its sensor finds. Each shot costs a little energy,
// so link it to a power network (or it runs on its battery bank).
use(EngageEnemies, { watch: [MISSILE], interval: 2, orders: 0, holdFireKey: '' });
`);

/** Fast light units: a turbo motor makes a light chassis more than twice as quick as a small one. */
export const DART_CLASS: ClassTemplate = template('Dart', ['chassis.light', 'cpu.basic', 'motor.turbo', 'sensor.short', 'gun.light'], FIGHTER_PROGRAM_TEXT);

export const PATHFINDER_CLASS: ClassTemplate = template('Pathfinder', ['chassis.light', 'cpu.basic', 'motor.turbo', 'sensor.long'], `// Pathfinder: a fast scout with no weapon. It goes where it is told; its long sensor shows the map as it passes.
${BASICS(25)}
`);

/** Starting points for a new class in the editor: a short name, what it is for, and its program text (all built-in blocks). */
export const CLASS_TEMPLATES: readonly { readonly name: string; readonly about: string; readonly text: string }[] = [
  { name: 'Blank', about: 'No behaviour at all.', text: '' },
  { name: 'Worker', about: 'Harvests matter and brings it home.', text: HARVESTER_CLASS.text! },
  { name: 'Builder', about: 'Builds sites and fetches matter for remote ones.', text: BUILDER_CLASS.text! },
  { name: 'Medic', about: 'Repairs damaged units and buildings.', text: REPAIR_CLASS.text! },
  { name: 'Fighter', about: 'Obeys orders and shoots enemies in range, with a Hold fire button.', text: FIGHTER_PROGRAM_TEXT },
  { name: 'Turret', about: 'A building that shoots whatever its sensor finds.', text: LASER_TURRET_CLASS.text! },
  { name: 'Storage', about: 'Energy storage with Hold charge and Automatic buttons.', text: STORAGE_CLASS.text! },
  { name: 'Factory', about: 'A unit factory that sends new units to a rally point.', text: LIGHT_FACTORY_CLASS.text! },
];

export const STARTER_CLASSES: readonly ClassTemplate[] = [
  HQ_CLASS,
  LIGHT_FACTORY_CLASS,
  VEHICLE_FACTORY_CLASS,
  HEAVY_FACTORY_CLASS,
  CHARGING_PAD_CLASS,
  SOLAR_CLASS,
  WIND_CLASS,
  SMALL_STORAGE_CLASS,
  STORAGE_CLASS,
  PYLON_CLASS,
  SILO_CLASS,
  TOWER_CLASS,
  LASER_TURRET_CLASS,
  RADAR_TOWER_CLASS,
  HARVESTER_CLASS,
  BUILDER_CLASS,
  REPAIR_CLASS,
  SCOUT_CLASS,
  HAWK_CLASS,
  TANK_CLASS,
  LANCER_CLASS,
  STORMER_CLASS,
  ROCKET_CLASS,
  DART_CLASS,
  PATHFINDER_CLASS,
  FLAK_CLASS,
  FLAK_TURRET_CLASS,
];

/** Program shown in the editor for a freshly defined class (as stored text). */
export const NEW_CLASS_TEXT = `// A new class. A program is a few built-in blocks plus small reactions to events. The engine does the
// long work (walking, gathering, ...). This one obeys MOVE, STOP and CHARGE orders and recharges when low;
// right-click a block and choose Expand to see (and change) the events it is made of.
${BASICS(25)}
`;
export const NEW_CLASS_PROGRAM = programFromText('New class', NEW_CLASS_TEXT);

export const NEUTRAL_CLASS: ClassTemplate = template('Wanderer', ['chassis.light', 'cpu.basic', 'motor.small'], `// Wanders: every 10 ticks, if it is standing still, it picks a random spot nearby.
on(Every, { ticks: 10 }, () => {
  if (moving() === 0) {
    move(rand(9) - 4, rand(9) - 4);
  }
});
`);

// --- Starting base (for the top-left corner; the server mirrors it for other corners) ----

export interface LayoutEntry {
  readonly cls: ClassTemplate;
  /** Top-left tile. */
  readonly x: number;
  readonly y: number;
  /** Starting charge as a fraction of capacity. */
  readonly energy?: number;
}

export const BASE_LAYOUT: readonly LayoutEntry[] = [
  { cls: HQ_CLASS, x: 6, y: 6 },
  { cls: CHARGING_PAD_CLASS, x: 9, y: 8 },
  { cls: SOLAR_CLASS, x: 6, y: 10 },
  { cls: WIND_CLASS, x: 4, y: 6 },
  { cls: SMALL_STORAGE_CLASS, x: 3, y: 8, energy: 0.5 },
  { cls: PYLON_CLASS, x: 12, y: 12 },
  { cls: CHARGING_PAD_CLASS, x: 17, y: 17 },
];

/** Starting units: class, tile, count (placed in a row). */
export const BASE_UNITS: readonly { cls: ClassTemplate; x: number; y: number; count: number }[] = [
  { cls: HARVESTER_CLASS, x: 11, y: 7, count: 2 },
  { cls: SCOUT_CLASS, x: 11, y: 10, count: 2 },
  { cls: BUILDER_CLASS, x: 14, y: 8, count: 1 },
];

/** Centre of the resource field near the top-left base. */
export const BASE_FIELD = { x: 15, y: 13 } as const;
