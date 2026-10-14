/**
 * Starter content: the classes every player begins with and the starting base
 * layout. Each class's behaviour is entirely its script — players are expected
 * to rewrite these. Buildings are built from the same modules as units.
 */

export interface ClassTemplate {
  readonly name: string;
  readonly parts: readonly string[];
  /** Empty for classes without a CPU (they just provide their modules). */
  readonly program: string;
}

/** Shared preamble: how a class reacts to new player orders is a scripting decision. */
const OBEY_URGENT = `# Orders given without the queue modifier are flagged URGENT; this class drops
# its plan for them. Delete this block to make it finish what it was doing first.
n = taskCount()
if n > 1 && taskFlags(n - 1) & URGENT {
  taskFirst(n - 1)
  while taskCount() > 1 { taskDrop(1) }
}
taskAck(0)   # the front task is in hand: only newer URGENT orders count as new
`;

/** Shared energy policy: below 25%, recharging jumps the queue. */
const RECHARGE_WHEN_LOW = `# Low on energy: recharging comes before everything else (even urgent orders).
if energy() * 4 < energyMax() && taskType(0) != CHARGE {
  h = nearestCharger()
  if h >= 0 {
    taskPush(CHARGE, 0, 0, h)
    taskFirst(taskCount() - 1)
  }
}
`;

/** Builders retreat to charge at 30%, just above the 25% at which they stop building off-grid (BUILDER_ENERGY_RESERVE). */
const BUILDER_RECHARGE = RECHARGE_WHEN_LOW.replace('energy() * 4 < energyMax()', 'energy() * 10 < energyMax() * 3');

/** Revives a flat unit: hand over 10% of our capacity per pass until it reaches 50%,
 * as long as we stay above half ourselves. */
const HANDLE_SUPPLY = `else if t == SUPPLY {
  h = taskTarget(0)
  if energyOf(h) < 0 || energyOf(h) >= 50 || energy() * 2 < energyMax() {
    taskDrop(0)
  } else if approach(h, 1) == 1 {
    giveEnergy(h, energyMax() / 10)
  }
}`;

/** Waits beside a charging pad until 95% full. */
const HANDLE_CHARGE = `if t == CHARGE {
  h = taskTarget(0)
  if energy() * 20 >= energyMax() * 19 || approach(h, 1) < 0 { taskDrop(0) }
}`;

const SEND_HARVESTER_BACK = `res = visitorLastHarvest()
if resource(res) == 0 { res = scanResource() }
if res >= 0 { order(HARVEST, 0, 0, res) }`;

// --- Buildings -----------------------------------------------------------------------

export const HQ_CLASS: ClassTemplate = {
  name: 'HQ',
  parts: [
    'frame.large', 'cpu.fast', 'mem.small', 'sensor.long', 'factory.basic', 'silo', 'silo',
    'solar.panel', 'solar.panel', 'battery.cell',
  ],
  program: `# Headquarters: produces units and stores harvested resources in its silos.
# It can only instruct a unit while that unit is visiting: once when it is
# produced here, and again each time it docks here.
var r = 0
var res = -1

# Right-clicking with the HQ selected queues a MOVE here: keep only the newest
# one and use it as the rally point.
while taskCount() > 1 { taskDrop(0) }

r = nextVisitor()
if r != 0 {
  if (visitorCaps() & (CAN_HARVEST | CAN_BUILD)) == CAN_HARVEST {
    # Send harvesters back to where they were working, or find a new field.
${SEND_HARVESTER_BACK}
  } else if r == PRODUCED && taskType(0) == MOVE {
    order(MOVE, taskX(0), taskY(0), -1)
  }
} else {
  sleep(2)
}
`,
};

export const CHARGING_PAD_CLASS: ClassTemplate = {
  name: 'Charging Pad',
  parts: ['frame.small', 'charger.pad', 'battery.cell'],
  program: '',
};

export const SOLAR_CLASS: ClassTemplate = {
  name: 'Solar Array',
  parts: ['frame.medium', ...Array<string>(8).fill('solar.panel')],
  program: '',
};

export const WIND_CLASS: ClassTemplate = {
  name: 'Wind Turbine',
  parts: ['frame.small', 'wind.turbine', 'wind.turbine'],
  program: '',
};

export const STORAGE_CLASS: ClassTemplate = {
  name: 'Energy Storage',
  parts: ['frame.medium', 'cpu.basic', ...Array<string>(8).fill('battery.bank')],
  program: `# Energy storage: a pile of battery banks and a small CPU deciding which way
# the energy flows. Soak up surplus; give it back when generation falls short.
# Its buttons let the player hold the charge back for later.
button reserve "Hold charge" key "K"
button release "Automatic" key "U"
var held = 0
var t = 0

t = taskType(0)
if t == reserve { held = 1 } else if t == release { held = 0 }
if t != 0 { taskDrop(0) }

if held {
  storageMode(HOLD)
} else if netSupply() >= netDemand() {
  storageMode(CHARGE_STORE)
} else {
  storageMode(DISCHARGE)
}
sleep(4)
`,
};

export const SILO_CLASS: ClassTemplate = {
  name: 'Resource Silo',
  parts: ['frame.medium', 'cpu.basic', 'mem.small', ...Array<string>(6).fill('silo')],
  program: `# Resource Silo: send visiting harvesters back to their last field.
var res = -1

if nextVisitor() != 0 {
  if (visitorCaps() & (CAN_HARVEST | CAN_BUILD)) == CAN_HARVEST {
${SEND_HARVESTER_BACK}
  }
} else {
  sleep(2)
}
`,
};

export const TOWER_CLASS: ClassTemplate = {
  name: 'Construction Tower',
  parts: ['frame.small', 'cpu.basic', 'build.crane', 'battery.cell'],
  program: `# Construction tower: builds any own site within 4 tiles of its edge, paid from
# the common pool, so it must be linked by the power grid to a silo.
var h = -1

h = nearestSite()
if h < 0 || build(h) == 0 { sleep(10) }
`,
};

export const LASER_TURRET_CLASS: ClassTemplate = {
  name: 'Laser Turret',
  parts: ['frame.small', 'cpu.basic', 'sensor.long', 'laser.beam', 'battery.bank'],
  program: `# Laser turret: shoots the nearest enemy in sensor range. Each shot costs a lot of
# energy, so it must be linked to a power network (or it runs on its battery bank).
var h = -1

h = scan()
if h >= 0 {
  fire(h)
} else {
  fire(-1)
  sleep(5)
}
`,
};

export const PYLON_CLASS: ClassTemplate = {
  name: 'Power Pylon',
  parts: ['frame.small', 'antenna.large'],
  program: '',
};

// --- Units ---------------------------------------------------------------------------

export const HARVESTER_CLASS: ClassTemplate = {
  name: 'Harvester',
  parts: ['chassis.light', 'cpu.basic', 'motor.small', 'cargo.bay', 'battery.cell'],
  program: `# Harvester: works HARVEST tasks until full, then docks at the nearest depot.
# Docking hands control back to the depot's script, which issues the next job.
var n = 0
var t = 0
var h = -1

${OBEY_URGENT}
${RECHARGE_WHEN_LOW}
t = taskType(0)
${HANDLE_CHARGE} ${HANDLE_SUPPLY} else if t == HARVEST {
  h = taskTarget(0)
  # A pass can span several ticks, so the field may run dry between checks:
  # anything carried is always delivered before the task is dropped.
  if cargo() < cargoMax() && resource(h) > 0 {
    if approach(h, 1) == 1 { harvest(h) }
  } else if cargo() == 0 {
    taskDrop(0)
  } else {
    h = nearestDepot()
    if approach(h, 1) != 0 {
      dock(h)
      taskDrop(0)
    }
  }
} else if t == DOCK {
  h = taskTarget(0)
  if approach(h, 1) != 0 {
    dock(h)
    taskDrop(0)
  }
} else if t == MOVE {
  if goTo(taskX(0), taskY(0)) { taskDrop(0) }
} else if t == STOP {
  stop()
  taskDrop(0)
} else if t != 0 {
  taskDrop(0)
} else {
  sleep(5)
}
`,
};

export const BUILDER_CLASS: ClassTemplate = {
  name: 'Builder',
  parts: ['chassis.medium', 'cpu.basic', 'motor.large', 'build.arm', 'cargo.bay', 'battery.cell'],
  program: `# Builder: works BUILD tasks. Sites linked to a silo by the power grid draw
# from the common pool; remote sites need resources carried to them.
var n = 0
var t = 0
var h = -1

${OBEY_URGENT}
${BUILDER_RECHARGE}
t = taskType(0)
${HANDLE_CHARGE} ${HANDLE_SUPPLY} else if t == BUILD {
  h = taskTarget(0)
  if buildProgress(h) < 0 || buildProgress(h) >= 100 {
    taskDrop(0)
  } else if siteSupplied(h) == 0 && cargo() == 0 {
    # Remote site: fetch a load from the nearest stocked depot first.
    h = nearestStock()
    if h < 0 {
      taskDrop(0)
      sleep(20)
    } else if approach(h, 1) == 1 {
      take(h, cargoMax())
    }
  } else if approach(h, 1) == 1 {
    build(h)
  }
} else if t == MOVE {
  if goTo(taskX(0), taskY(0)) { taskDrop(0) }
} else if t == STOP {
  stop()
  taskDrop(0)
} else if t != 0 {
  taskDrop(0)
} else {
  # Idle: pick up the nearest unfinished site as a new job.
  h = nearestSite()
  if h >= 0 { taskPush(BUILD, 0, 0, h) } else { sleep(5) }
}
`,
};

const FIGHTER_PROGRAM = `# Follows MOVE / ATTACK / STOP / CHARGE orders; when idle, shoots anything in
# sensor range without chasing it, and naps between scans to save energy.
# ATTACK without a target (the Attack button on open ground) is an attack-move.
button holdfire "Hold fire" key "F"
var n = 0
var t = 0
var h = -1
var quiet = 0

${OBEY_URGENT}
${RECHARGE_WHEN_LOW}
t = taskType(0)
${HANDLE_CHARGE} ${HANDLE_SUPPLY} else if t == MOVE {
  if goTo(taskX(0), taskY(0)) { taskDrop(0) }
} else if t == ATTACK {
  h = taskTarget(0)
  if h < 0 {
    h = scan()
    if h < 0 {
      if goTo(taskX(0), taskY(0)) { taskDrop(0) }
    } else if fire(h) == 0 {
      approach(h, 3)
    }
  } else if dist(h) < 0 {
    # Out of our sensor range (or gone): head for where it was when ordered.
    if goTo(taskX(0), taskY(0)) { taskDrop(0) }
  } else if fire(h) == 0 {
    approach(h, 3)
  }
} else if t == holdfire {
  # The "Hold fire" button toggles shooting at things that wander into range.
  quiet = !quiet
  taskDrop(0)
} else if t == STOP {
  stop()
  fire(-1)
  taskDrop(0)
} else if t != 0 {
  taskDrop(0)
} else if quiet {
  sleep(5)
} else {
  h = scan()
  if h >= 0 { fire(h) } else { sleep(5) }
}
`;

export const SCOUT_CLASS: ClassTemplate = {
  name: 'Scout',
  parts: ['chassis.light', 'cpu.basic', 'motor.small', 'sensor.short', 'gun.light'],
  program: FIGHTER_PROGRAM,
};

export const HAWK_CLASS: ClassTemplate = {
  name: 'Hawk',
  parts: ['chassis.light', 'cpu.basic', 'rotor', 'sensor.short', 'gun.light'],
  program: FIGHTER_PROGRAM,
};

export const STARTER_CLASSES: readonly ClassTemplate[] = [
  HQ_CLASS,
  CHARGING_PAD_CLASS,
  SOLAR_CLASS,
  WIND_CLASS,
  STORAGE_CLASS,
  PYLON_CLASS,
  SILO_CLASS,
  TOWER_CLASS,
  LASER_TURRET_CLASS,
  HARVESTER_CLASS,
  BUILDER_CLASS,
  SCOUT_CLASS,
  HAWK_CLASS,
];

/** Template shown in the editor for a freshly defined class. */
export const NEW_CLASS_PROGRAM = `var n = 0
var t = 0
var h = -1

${OBEY_URGENT}
${RECHARGE_WHEN_LOW}
t = taskType(0)
${HANDLE_CHARGE} ${HANDLE_SUPPLY} else if t == MOVE {
  if goTo(taskX(0), taskY(0)) { taskDrop(0) }
} else if t != 0 {
  taskDrop(0)   # not handled by this class yet
} else {
  sleep(5)
}
`;

export const NEUTRAL_CLASS: ClassTemplate = {
  name: 'Wanderer',
  parts: ['chassis.light', 'cpu.basic', 'motor.small'],
  program: `if moving() == 0 {
  move(rand(9) - 4, rand(9) - 4)
}
sleep(10)
`,
};

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
  { cls: STORAGE_CLASS, x: 3, y: 8, energy: 0.5 },
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
