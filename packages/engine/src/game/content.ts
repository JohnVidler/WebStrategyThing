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

// --- Shared behaviour -----------------------------------------------------------------
//
// An activity started while handling an order is that order's work: when it ends and no chain
// continues it, the order is finished and the next one starts. So most order blocks are one line.

/** Orders every moving unit takes. The first block makes an urgent order replace the whole plan. */
const MOVE_ORDER = `// MOVE: walk there. An urgent order (no queue modifier) replaces everything else.
on(Order, { types: [MOVE], urgent: REPLACE }, (type, tx, ty) => {
  goTo(tx, ty);
});`;

const STOP_ORDER = `on(Order, { types: [STOP] }, () => {
  stop();
  fire(-1);
  nextOrder();
});`;

const CHARGE_ORDER = `on(Order, { types: [CHARGE] }, (type, tx, ty, pad) => {
  charge(pad);
});`;

/** Revives a flat unit: hand over 10% of our capacity until it reaches 50%, as long as we stay above half ourselves. */
const SUPPLY_ORDER = `on(Order, { types: [SUPPLY] }, (type, tx, ty, flat) => {
  supply(flat);
});`;

/** Below the level, put the current job aside, recharge, then go back to it. The event repeats while still low. */
const recharge = (below: number) => `// Low on energy: recharge first, then carry on with what we were doing.
on(EnergyLow, { below: ${below} }, () => {
  const pad = nearestCharger();
  if (pad >= 0 && activity() !== A_CHARGE) {
    suspendActivity();
    charge(pad, {
      charged: () => { resumeActivity(); },
      lost: () => { resumeActivity(); },
      blocked: () => { resumeActivity(); },
    });
  }
});`;

const SEND_HARVESTER_BACK = `// One of the few nearest fields with matter left, picked at random so no field is farmed out.
    const field = randomResource(4, 10);
    if (field >= 0) {
      order(HARVEST, 0, 0, field);
    }`;

// --- Buildings -----------------------------------------------------------------------

export const HQ_CLASS: ClassTemplate = template('HQ', [
  'frame.large', 'cpu.fast', 'mem.small', 'sensor.long', 'factory.basic', 'silo', 'silo',
  'solar.panel', 'solar.panel', 'battery.cell',
], `// Headquarters: produces units and stores harvested resources in its silos.
// Right-clicking with the HQ selected sets the rally point; an urgent order replaces the old one.
let rallyX = -1;
let rallyY = -1;

on(Order, { types: [MOVE], urgent: REPLACE }, (type, tx, ty) => {
  rallyX = tx;
  rallyY = ty;
});

// A building can only instruct a unit while that unit is visiting: once when it is
// produced here, and again each time it docks here.
on(Visitor, (reason, who) => {
  if ((visitorCaps() & (CAN_HARVEST | CAN_BUILD | CAN_FIGHT)) === CAN_HARVEST) {
    // Send harvesters to a random nearby field (a fighter with a cargo bay only carries ammunition).
    ${SEND_HARVESTER_BACK}
  } else if (reason === PRODUCED && rallyX >= 0) {
    order(MOVE, rallyX, rallyY, -1);
  }
});
`);

export const CHARGING_PAD_CLASS: ClassTemplate = template('Charging Pad', ['frame.small', 'charger.pad', 'battery.cell'], '');

export const SOLAR_CLASS: ClassTemplate = template('Solar Array', ['frame.medium', ...Array<string>(8).fill('solar.panel')], '');

export const WIND_CLASS: ClassTemplate = template('Wind Turbine', ['frame.small', 'wind.turbine', 'wind.turbine'], '');

// Energy storage: a pile of battery banks and a small CPU deciding which way the energy
// flows. Soak up surplus; give it back when generation falls short. Its buttons let the
// player hold the charge back for later.
const STORAGE_PROGRAM = `let held = 0;

on(Button, { label: 'Hold charge', key: 'K' }, () => {
  held = 1;
});

on(Button, { label: 'Automatic', key: 'U' }, () => {
  held = 0;
});

// Looks at the grid every 4 ticks (a periodic check is the point here).
on(Every, { ticks: 4 }, () => {
  if (held) {
    config.storageMode(HOLD);
  } else if (netSupply() >= netDemand()) {
    config.storageMode(CHARGE_STORE);
  } else {
    config.storageMode(DISCHARGE);
  }
});
`;

export const STORAGE_CLASS: ClassTemplate = template('Energy Storage', ['frame.medium', 'cpu.basic', ...Array<string>(8).fill('battery.bank')], STORAGE_PROGRAM);

/** The starting base's store: a quarter of the full Energy Storage. */
export const SMALL_STORAGE_CLASS: ClassTemplate = template('Small Energy Storage', ['frame.small', 'cpu.basic', 'battery.bank', 'battery.bank'], STORAGE_PROGRAM);

export const SILO_CLASS: ClassTemplate = template('Resource Silo', ['frame.medium', 'cpu.basic', 'mem.small', ...Array<string>(6).fill('silo')], `// Resource Silo: send visiting harvesters to a random nearby field.
on(Visitor, () => {
  if ((visitorCaps() & (CAN_HARVEST | CAN_BUILD | CAN_FIGHT)) === CAN_HARVEST) {
    ${SEND_HARVESTER_BACK}
  }
});
`);

export const TOWER_CLASS: ClassTemplate = template('Construction Tower', ['frame.small', 'cpu.basic', 'build.crane', 'repair.beam', 'battery.cell'], `// Construction tower: builds any own site within 4 tiles of its edge, paid from
// the common pool, so it must be linked by the power grid to a silo. With nothing to
// build it mends the nearest damaged own unit or building within 4 tiles of its edge
// (energy plus matter from the common pool; armour costs more). While it has nothing
// to do, the engine asks again every 10 ticks.
on(Free, { repeat: 10 }, () => {
  const site = nearestSite();
  const hurt = nearestDamaged();
  if (site >= 0) {
    build(site);
  } else if (hurt >= 0) {
    repair(hurt);
  }
});
`);

export const LASER_TURRET_CLASS: ClassTemplate = template('Laser Turret', ['frame.small', 'cpu.basic', 'sensor.long', 'laser.beam', 'battery.bank'], `// Laser turret: shoots the nearest enemy its sensor finds. Each shot costs a lot of
// energy, so it must be linked to a power network (or it runs on its battery bank).
// config.laserPower(n) sets the energy per shot (up to the laser's max); damage scales with it.
on(Detected, { watch: [ENEMY], interval: 3 }, (kind, target) => {
  fire(target);
});
`);

export const RADAR_TOWER_CLASS: ClassTemplate = template('Radar Tower', ['frame.small', 'cpu.basic', 'radar.pulse', 'battery.bank'], `// Radar tower: pings the map as soon as its radar has rested, as long as the
// radar module is switched on and the tower holds more than half its energy.
// 500 energy buys a 20-tile pulse; change it to scan nearer or further.
on(Every, { ticks: 10 }, () => {
  if (radarCooldown() === 0 && energy() * 2 > energyMax()) {
    radarPulse(500);
  }
});
`);

export const PYLON_CLASS: ClassTemplate = template('Power Pylon', ['frame.small', 'antenna.large'], '');

// --- Units ---------------------------------------------------------------------------

export const HARVESTER_CLASS: ClassTemplate = template('Harvester', ['chassis.light', 'cpu.basic', 'motor.small', 'cargo.bay', 'battery.cell'], `// Harvester: the engine walks, gathers and unloads; the program only decides what comes next.
${MOVE_ORDER}

// HARVEST: gather until full, then unload at the nearest depot. A field that runs low is swapped for another nearby one.
on(Order, { types: [HARVEST] }, (type, tx, ty, field) => {
  harvest(field, {
    full: () => {
      dock(nearestDepot());
    },
    empty: () => {
      swapOrder(HARVEST, 0, 0, randomResource(4, 10));
    },
  });
});

on(Order, { types: [DOCK] }, (type, tx, ty, depot) => {
  dock(depot);
});

${STOP_ORDER}

${CHARGE_ORDER}

${SUPPLY_ORDER}

${recharge(25)}

// Nothing left to do (asked again every 50 ticks while it stays that way): go back to a storage building,
// which hands out new orders, or find a field itself.
on(Free, { repeat: 50 }, () => {
  const store = nearestStorage();
  if (store >= 0 && (cargo() > 0 || dist(store) > 2)) {
    swapOrder(DOCK, 0, 0, store);
  } else if (store >= 0) {
    swapOrder(HARVEST, 0, 0, randomResource(4, 10));
  }
});
`);

export const BUILDER_CLASS: ClassTemplate = template('Builder', ['chassis.medium', 'cpu.basic', 'motor.large', 'build.arm', 'cargo.bay', 'battery.cell'], `// Builder: works BUILD orders. Sites linked to a silo by the power grid draw
// from the common pool; remote sites need resources carried to them.
${MOVE_ORDER}

on(Order, { types: [BUILD] }, (type, tx, ty, site) => {
  build(site, {
    // Remote site and nothing to build with: fetch a load from the nearest stocked depot, then carry on.
    starved: () => {
      take(nearestStock(), cargoMax(), {
        taken: () => {
          swapOrder(BUILD, 0, 0, site);
        },
      });
    },
  });
});

${STOP_ORDER}

${CHARGE_ORDER}

${SUPPLY_ORDER}

${recharge(30)}

// Free: pick up the nearest unfinished site as a new job (asked again every 20 ticks).
on(Free, { repeat: 20 }, () => {
  const site = nearestSite();
  if (site >= 0) {
    swapOrder(BUILD, 0, 0, site);
  }
});
`);

export const REPAIR_CLASS: ClassTemplate = template('Repair Drone', ['chassis.medium', 'cpu.basic', 'motor.small', 'cargo.bay', 'repair.beam', 'battery.cell'], `// Repair drone: mends own units and buildings. Repairs cost energy and matter (more for
// armour); the matter is carried in the cargo bay and fetched from the nearest stocked silo.
// REPAIR orders (the Repair button / right-click on a damaged own unit) are worked first;
// when free it picks the nearest damaged own unit or building itself.
${MOVE_ORDER}

on(Order, { types: [REPAIR] }, (type, tx, ty, patient) => {
  repair(patient, {
    starved: () => {
      take(nearestStock(), cargoMax(), {
        taken: () => {
          swapOrder(REPAIR, 0, 0, patient);
        },
      });
    },
  });
});

${STOP_ORDER}

${CHARGE_ORDER}

${SUPPLY_ORDER}

${recharge(25)}

on(Free, { repeat: 20 }, () => {
  const hurt = nearestDamaged();
  if (hurt >= 0) {
    swapOrder(REPAIR, 0, 0, hurt);
  }
});
`);

export const FIGHTER_PROGRAM_TEXT = `// Follows MOVE / ATTACK / STOP / CHARGE orders. Its sensor sweeps every 5 ticks and it shoots the
// nearest enemy in range without chasing it; the sweep costs nothing to run when nothing is found.
// ATTACK without a target (the Attack button on open ground) is an attack-move.
// The "Hold fire" button toggles shooting at things that wander into range.
let quiet = 0;

on(Button, { label: 'Hold fire', key: 'F' }, () => {
  quiet = !quiet;
});

on(Detected, { watch: [ENEMY], interval: 5 }, (kind, enemy) => {
  if (quiet === 0) {
    fire(enemy);
  }
});

${MOVE_ORDER}

// ATTACK a target: close in and fight until it is dead; if it slips out of sensor range, head for where it was.
on(Order, { types: [ATTACK] }, (type, tx, ty, target) => {
  if (target >= 0) {
    engage(target, {
      lost: () => {
        goTo(tx, ty);
      },
    });
  } else {
    goTo(tx, ty);
  }
});

${STOP_ORDER}

${CHARGE_ORDER}

${SUPPLY_ORDER}

${recharge(25)}
`;

/**
 * Ammunition for weapons that use matter (cannon, missiles): below the level, put the job aside,
 * fetch a full cargo bay from the nearest silo with matter in it, then go back to the job.
 */
const resupply = (below: number) => `
// Low on ammunition (matter in the cargo bay): fetch more from the nearest stocked silo, then carry on.
on(Every, { ticks: 20 }, () => {
  if (cargo() < ${below} && activity() !== A_TAKE && activity() !== A_CHARGE) {
    const depot = nearestStock();
    if (depot >= 0) {
      suspendActivity();
      take(depot, cargoMax(), {
        taken: () => { resumeActivity(); },
        lost: () => { resumeActivity(); },
        blocked: () => { resumeActivity(); },
      });
    }
  }
});
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
const FLAK_PROGRAM_TEXT = FIGHTER_PROGRAM_TEXT.replace('// Follows MOVE', '// Flak: shoots incoming missiles only (its burst is harmless to everything else). Follows MOVE')
  .replace('watch: [ENEMY], interval: 5', 'watch: [MISSILE], interval: 2');

export const FLAK_CLASS: ClassTemplate = template('Flak Truck', ['chassis.medium', 'cpu.basic', 'motor.small', 'sensor.short', 'flak.cannon', 'battery.cell'], FLAK_PROGRAM_TEXT);

export const FLAK_TURRET_CLASS: ClassTemplate = template('Flak Turret', ['frame.small', 'cpu.basic', 'sensor.short', 'flak.cannon', 'battery.bank'], `// Flak turret: bursts any incoming enemy missile its sensor finds. Each shot costs a little energy,
// so link it to a power network (or it runs on its battery bank).
on(Detected, { watch: [MISSILE], interval: 2 }, (kind, target) => {
  fire(target);
});
`);

/** Fast light units: a turbo motor makes a light chassis more than twice as quick as a small one. */
export const DART_CLASS: ClassTemplate = template('Dart', ['chassis.light', 'cpu.basic', 'motor.turbo', 'sensor.short', 'gun.light'], FIGHTER_PROGRAM_TEXT);

export const PATHFINDER_CLASS: ClassTemplate = template('Pathfinder', ['chassis.light', 'cpu.basic', 'motor.turbo', 'sensor.long'], `// Pathfinder: a fast scout with no weapon. It goes where it is told; its long sensor shows the map as it passes.
${MOVE_ORDER}

${STOP_ORDER}

${CHARGE_ORDER}

${recharge(25)}
`);

export const STARTER_CLASSES: readonly ClassTemplate[] = [
  HQ_CLASS,
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
export const NEW_CLASS_TEXT = `// A new class. A program is a set of small reactions to events: orders, sensor reports, visits,
// and the end of a job. The engine does the long work (walking, gathering, ...); you decide what
// happens when it starts and when it ends. This one obeys MOVE orders and recharges when low.
${MOVE_ORDER}

${STOP_ORDER}

${CHARGE_ORDER}

${recharge(25)}
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
