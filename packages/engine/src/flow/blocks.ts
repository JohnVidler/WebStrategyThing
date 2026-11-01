import { configProblem } from './check';
import type { ConfigField } from './events';
import { FlowError, type BlockUse, type ConfigValue, type FlowDoc } from './ir';

/**
 * The built-in block library. A block is a named piece of behaviour with settings: one `use(Block, { ... })`
 * statement in the text and one card in the graph. It is a template: at compile time it expands into
 * ordinary variables and event blocks (written here as program text), so it costs exactly what the
 * expanded program costs, and `Expand` turns it into those plain blocks for the player to change.
 */

export type Settings = Readonly<Record<string, ConfigValue>>;

/** What a template can use while it writes its text. */
export interface BlockContext {
  /** The name of one of the block's variables, unique to the block (`harvestLoop_quiet`). */
  readonly v: (name: string) => string;
  readonly num: (setting: string) => number;
  readonly list: (setting: string) => readonly number[];
  readonly str: (setting: string) => string;
  /** The value of a named constant, such as MOVE. */
  readonly c: (name: string) => number;
}

export interface BlockDef {
  readonly name: string;
  readonly group: string;
  readonly doc: string;
  readonly settings: readonly ConfigField[];
  /** Events the block raises for the player's own blocks to hook. */
  readonly emits?: readonly string[];
  readonly text: (ctx: BlockContext) => string;
}

const int = (name: string, def: number, min: number, max: number, doc: string): ConfigField => ({ name, type: 'int', default: def, min, max, doc });
const ints = (name: string, def: readonly number[], doc: string): ConfigField => ({ name, type: 'ints', default: def, doc });
const text = (name: string, def: string, doc: string): ConfigField => ({ name, type: 'string', default: def, doc });

const quote = (s: string): string => `'${s.replace(/(['\\])/g, '\\$1')}'`;
/** Timer id EngageEnemies uses to resume an attack-move after a fight (a program's own `after` should pick another). */
const REGROUP_TIMER = 900;

/**
 * Statements that choose a field to work: first a home depot (the nearest to the caller, but each harvester already
 * working round it counts against it beyond `crowdLimit`, so a crowded depot loses to another one), then the field
 * nearest that depot among the `fieldsToChooseFrom` closest, each harvester already on a field counting against it
 * too. With no depot it takes the nearest field. `avoid` names a field to leave out (one that could not be reached).
 * Leaves the choice in the block's `pick` variable, -1 for none.
 */
const chooseField = (c: BlockContext, avoid = ''): string => {
  const [home, pick, d, r] = [c.v('home'), c.v('pick'), c.v('d'), c.v('r')];
  const [limit, radius, min, k] = [c.num('crowdLimit'), c.num('crowdRadius'), c.num('minMatter'), c.num('fieldsToChooseFrom')];
  const skip = avoid ? `.filter(${r} => ${r} !== ${avoid})` : '';
  return `const ${home} = findDepots().minBy(${d} => dist(${d}) + 12 * crowdOver(${d}, ${radius}, ${limit}));
const ${pick} = ${home} < 0 ? findResources(${min})${skip}.first() : findResourcesNear(${home}, ${min})${skip}.take(${k}).minBy(${r} => distBetween(${home}, ${r}) + 6 * crowd(${r}, 3));`;
};

/** Indents every line of `text` after the first by `by` (the first is placed by the caller). */
const indent = (text: string, by: string): string => text.split('\n').join(`\n${by}`);

const FIELD_SETTINGS: readonly ConfigField[] = [
  int('fieldsToChooseFrom', 4, 1, 10, 'Choose among this many fields nearest the depot (so no field is farmed out)'),
  int('minMatter', 10, 0, 1000, 'Ignore fields with less matter than this'),
  int('crowdLimit', 4, 1, 50, 'A depot with more harvesters than this round it is overcrowded: work from another depot instead'),
  int('crowdRadius', 6, 1, 20, 'How many tiles round a depot count as "round it"'),
];

export const BLOCKS: readonly BlockDef[] = [
  {
    name: 'TakeOrders', group: 'Orders',
    doc: 'Obeys the player\'s MOVE, STOP and CHARGE orders: starts the right activity for each, and when it ends takes the next order. An urgent order replaces the plan (or waits its turn, with urgent: QUEUE).',
    settings: [
      ints('types', [1, 5, 6], 'Which orders to obey: MOVE, STOP, CHARGE'),
      int('urgent', 1, 0, 1, 'REPLACE (1): an urgent order drops the plan and starts at once. QUEUE (0): it waits its turn'),
    ],
    text: (c) => {
      const has = (name: string) => c.list('types').includes(c.c(name));
      const out: string[] = [];
      if (has('MOVE')) out.push(`on(Order, { types: [MOVE], urgent: ${c.num('urgent') ? 'REPLACE' : 'QUEUE'} }, (type, tx, ty) => {\n  goTo(tx, ty);\n});`);
      if (has('STOP')) out.push('on(Order, { types: [STOP] }, () => {\n  stop();\n  fire(-1);\n  nextOrder();\n});');
      if (has('CHARGE')) out.push('on(Order, { types: [CHARGE] }, (type, tx, ty, pad) => {\n  charge(pad);\n});');
      return out.join('\n\n');
    },
  },
  {
    name: 'RechargeWhenLow', group: 'Energy',
    doc: 'Below a threshold, puts the current activity aside, recharges at the nearest charging pad, then carries on with what it was doing. Raises Charged when it is done.',
    emits: ['Charged'],
    settings: [int('below', 25, 1, 99, 'Percent of stored energy')],
    text: (c) => `on(EnergyLow, { below: ${c.num('below')} }, () => {
  const pad = nearestCharger();
  if (pad >= 0 && activity() !== A_CHARGE) {
    suspendActivity();
    charge(pad, {
      charged: () => {
        resumeActivity();
        emit(Charged);
      },
      lost: () => { resumeActivity(); },
      blocked: () => { resumeActivity(); },
    });
  }
});`,
  },
  {
    name: 'LeaveLava', group: 'Movement',
    doc: 'For hover units: when standing still on lava (depth 6 or more) it walks to the nearest ground that is not lava or a void, within 8 tiles. Lava scorches a hover unit every moment it stays on it; crossing it on the way somewhere is fine and is left alone.',
    settings: [int('interval', 10, 1, 600, 'Ticks between looks at the ground under the unit')],
    text: (c) => `on(Every, { ticks: ${c.num('interval')} }, () => {
  if (moving() === 0 && depthAt(x(), y()) >= 6) {
    const ${c.v('ex')} = escapeX();
    if (${c.v('ex')} >= 0) {
      goTo(${c.v('ex')}, escapeY());
    }
  }
});`,
  },
  {
    name: 'ReviveFlatUnits', group: 'Energy',
    doc: 'Right-click a flat unit: hand it 10% of our capacity until it reaches 50%, as long as we stay above half ourselves.',
    settings: [],
    text: () => 'on(Order, { types: [SUPPLY] }, (type, tx, ty, flat) => {\n  supply(flat);\n});',
  },
  {
    name: 'HarvestLoop', group: 'Work',
    doc: 'Harvest, unload at the nearest depot when full, and swap an empty or unreachable field for another. It prefers fields close to a depot and moves on to another depot (and its fields) when one is overcrowded. When free it unloads any cargo and finds a field itself. Raises Delivered(amount) after each unload.',
    emits: ['Delivered'],
    settings: [...FIELD_SETTINGS, int('interval', 50, 1, 6000, 'Ticks between looks for work while the unit is free')],
    text: (c) => `on(Order, { types: [HARVEST] }, (type, tx, ty, field) => {
  harvest(field, {
    full: () => {
      const load = cargo();
      dock(nearestDepot(), {
        docked: () => {
          emit(Delivered, load);
          nextOrder();
        },
      });
    },
    empty: () => {
      ${indent(chooseField(c), '      ')}
      if (${c.v('pick')} >= 0) {
        swapOrder(HARVEST, 0, 0, ${c.v('pick')});
      } else {
        nextOrder();
      }
    },
    lost: () => {
      ${indent(chooseField(c), '      ')}
      if (${c.v('pick')} >= 0) {
        swapOrder(HARVEST, 0, 0, ${c.v('pick')});
      } else {
        nextOrder();
      }
    },
    blocked: () => {
      ${indent(chooseField(c, 'field'), '      ')}
      if (${c.v('pick')} >= 0) {
        swapOrder(HARVEST, 0, 0, ${c.v('pick')});
      } else {
        nextOrder();
      }
    },
  });
});

on(Order, { types: [DOCK] }, (type, tx, ty, depot) => {
  dock(depot);
});

on(Free, { repeat: ${c.num('interval')} }, () => {
  if (cargo() > 0) {
    const ${c.v('room')} = nearestDepot();
    if (${c.v('room')} >= 0) {
      swapOrder(DOCK, 0, 0, ${c.v('room')});
    }
  } else {
    ${indent(chooseField(c), '    ')}
    if (${c.v('pick')} >= 0) {
      swapOrder(HARVEST, 0, 0, ${c.v('pick')});
    }
  }
});`,
  },
  {
    name: 'BuildJobs', group: 'Work',
    doc: 'Works BUILD orders; a remote site with nothing to build with sends it to fetch a load from the nearest stocked depot. When free it picks the nearest unfinished site itself.',
    settings: [int('interval', 20, 1, 6000, 'Ticks between looks for a site while the unit is free')],
    text: (c) => `on(Order, { types: [BUILD] }, (type, tx, ty, site) => {
  build(site, {
    starved: () => {
      take(nearestStock(), cargoMax(), {
        taken: () => {
          swapOrder(BUILD, 0, 0, site);
        },
      });
    },
  });
});

on(Free, { repeat: ${c.num('interval')} }, () => {
  const site = nearestSite();
  if (site >= 0) {
    swapOrder(BUILD, 0, 0, site);
  }
});`,
  },
  {
    name: 'RepairJobs', group: 'Work',
    doc: 'Works REPAIR orders (fetching matter when starved) and, when free, picks the nearest damaged own unit or building itself.',
    settings: [int('interval', 20, 1, 6000, 'Ticks between looks for a patient while the unit is free')],
    text: (c) => `on(Order, { types: [REPAIR] }, (type, tx, ty, patient) => {
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

on(Free, { repeat: ${c.num('interval')} }, () => {
  const hurt = nearestDamaged();
  if (hurt >= 0) {
    swapOrder(REPAIR, 0, 0, hurt);
  }
});`,
  },
  {
    name: 'MaintainNearby', group: 'Work',
    doc: 'A building with a crane or repair beam: builds the nearest own construction site in reach and, with none, mends the nearest damaged own unit or building.',
    settings: [int('interval', 10, 1, 6000, 'Ticks between looks for work')],
    text: (c) => `on(Free, { repeat: ${c.num('interval')} }, () => {
  const site = nearestSite();
  const hurt = nearestDamaged();
  if (site >= 0) {
    build(site);
  } else if (hurt >= 0) {
    repair(hurt);
  }
});`,
  },
  {
    name: 'EngageEnemies', group: 'Combat',
    doc: 'Shoots what the sensor finds (without chasing it), with a Hold fire button; and with orders on, closes in on an ATTACK target only until it is in weapon range (an enemy shield arc counts) and fights it until it is dead, or heads for where it was if it slips away. On an attack-move (ATTACK with no target) it stops to fight the first enemy its sensor finds, then marches on.',
    settings: [
      ints('watch', [1], 'What to look for, in priority order: ENEMY, MISSILE, ...'),
      int('interval', 5, 1, 600, 'Ticks between sensor sweeps'),
      text('holdFireKey', 'F', 'Hotkey of the Hold fire button: one upper-case letter, or empty for no button'),
      int('orders', 1, 0, 1, '1: obey ATTACK orders (units); 0: turrets, which cannot move'),
      int('spareAllies', 0, 0, 20, 'Tiles: do not open fire while another own unit is this close to the target (for weapons whose fire burns friends too); 0 = always fire'),
    ],
    text: (c) => {
      const key = c.str('holdFireKey');
      const quiet = c.v('quiet');
      const out: string[] = [];
      if (key) out.push(`let ${quiet} = 0;\n\non(Button, { label: 'Hold fire', key: ${quote(key)} }, () => {\n  ${quiet} = !${quiet};\n});`);
      // On an attack-move (ATTACK with no target) a unit puts the march aside as soon as it sees an enemy and engages it
      // (closing in only to weapon range). When that fight ends it waits one more sweep: another enemy in sight is engaged
      // straight away, and only with none left does the march resume. Resuming re-plans the whole route, so a squad that
      // kills one target of many must not resume and stop again every few ticks.
      const spare = c.num('spareAllies');
      const shoot = spare > 0 ? `const friend = scanAlly();\n    if (friend < 0 || distBetween(enemy, friend) > ${spare}) {\n      fire(enemy);\n    }` : 'fire(enemy);';
      const fireText = key ? `if (${quiet} === 0) {\n      ${shoot}\n    }` : shoot;
      const wait = `after(${c.num('interval') + 1}, ${REGROUP_TIMER});`;
      const body = c.num('orders')
        ? `\n  if (kind === ENEMY && orderType() === ATTACK && (activity() === A_GOTO || activity() === A_NONE)${key ? ` && ${quiet} === 0` : ''}) {\n    if (activity() === A_GOTO) {\n      suspendActivity();\n    }\n    engage(enemy, {\n      destroyed: () => { ${wait} },\n      lost: () => { ${wait} },\n      blocked: () => { ${wait} },\n    });\n  } else {\n    ${fireText}\n  }\n`
        : `\n  ${fireText}\n`;
      out.push(`on(Detected, { watch: [${c.list('watch').join(', ')}], interval: ${c.num('interval')} }, (kind, enemy) => {${body}});`);
      if (c.num('orders')) {
        out.push(`on(Timer, { ids: [${REGROUP_TIMER}] }, () => {
  if (activity() === A_NONE && orderType() === ATTACK) {
    resumeActivity();
    if (activity() === A_NONE) {
      nextOrder();
    }
  }
});`);
        out.push(`on(Order, { types: [ATTACK] }, (type, tx, ty, target) => {
  if (target >= 0) {
    engage(target, {
      lost: () => {
        goTo(tx, ty);
      },
    });
  } else {
    goTo(tx, ty);
  }
});`);
      }
      return out.join('\n\n');
    },
  },
  {
    name: 'Resupply', group: 'Combat',
    doc: 'For weapons that use matter: when the cargo bay runs low, puts the job aside, fetches a full load from the nearest stocked silo, then goes back to it.',
    settings: [int('below', 6, 1, 500, 'Fetch more when the cargo bay holds less than this'), int('interval', 20, 1, 6000, 'Ticks between checks')],
    text: (c) => `on(Every, { ticks: ${c.num('interval')} }, () => {
  if (cargo() < ${c.num('below')} && activity() !== A_TAKE && activity() !== A_CHARGE) {
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
});`,
  },
  {
    name: 'RallyPoint', group: 'Buildings',
    doc: 'Right-click with the building selected to set a rally point (an urgent order replaces the old one); every new non-harvester unit is sent there as it is produced.',
    settings: [],
    text: (c) => `let ${c.v('x')} = -1;
let ${c.v('y')} = -1;

on(Order, { types: [MOVE], urgent: REPLACE }, (type, tx, ty) => {
  ${c.v('x')} = tx;
  ${c.v('y')} = ty;
});

on(Visitor, { reasons: [PRODUCED] }, (reason, who) => {
  if ((visitorCaps() & (CAN_HARVEST | CAN_BUILD | CAN_FIGHT)) !== CAN_HARVEST && ${c.v('x')} >= 0) {
    order(MOVE, ${c.v('x')}, ${c.v('y')}, -1);
  }
});`,
  },
  {
    name: 'DispatchHarvesters', group: 'Buildings',
    doc: 'Sends every visiting harvester (produced here or docked here) to a field close to a depot, preferring a depot that is not overcrowded.',
    settings: FIELD_SETTINGS,
    text: (c) => `on(Visitor, () => {
  if ((visitorCaps() & (CAN_HARVEST | CAN_BUILD | CAN_FIGHT)) === CAN_HARVEST) {
    ${indent(chooseField(c), '    ')}
    if (${c.v('pick')} >= 0) {
      order(HARVEST, 0, 0, ${c.v('pick')});
    }
  }
});`,
  },
  {
    name: 'StorageController', group: 'Buildings',
    doc: 'Energy storage: soaks up surplus power, gives it back when generation falls short. Its Hold charge and Automatic buttons let the player keep the charge for later.',
    settings: [
      int('interval', 4, 1, 600, 'Ticks between looks at the grid'),
      text('holdKey', 'K', 'Hotkey of the Hold charge button'),
      text('automaticKey', 'U', 'Hotkey of the Automatic button'),
    ],
    text: (c) => `let ${c.v('held')} = 0;

on(Button, { label: 'Hold charge', key: ${quote(c.str('holdKey'))} }, () => {
  ${c.v('held')} = 1;
});

on(Button, { label: 'Automatic', key: ${quote(c.str('automaticKey'))} }, () => {
  ${c.v('held')} = 0;
});

on(Every, { ticks: ${c.num('interval')} }, () => {
  if (${c.v('held')}) {
    config.storageMode(HOLD);
  } else if (netSupply() >= netDemand()) {
    config.storageMode(CHARGE_STORE);
  } else {
    config.storageMode(DISCHARGE);
  }
});`,
  },
  {
    name: 'RadarPing', group: 'Buildings',
    doc: 'Pings the map as soon as the radar has rested, while the module is on and the building holds more than half its energy.',
    settings: [int('energy', 500, 25, 800, 'Energy per pulse (25 per tile of range)'), int('interval', 10, 1, 600, 'Ticks between checks')],
    text: (c) => `on(Every, { ticks: ${c.num('interval')} }, () => {
  if (radarCooldown() === 0 && energy() * 2 > energyMax()) {
    radarPulse(${c.num('energy')});
  }
});`,
  },
  {
    name: 'ShieldGuard', group: 'Combat',
    doc: 'Points the energy shield at the nearest incoming enemy shell or missile, else at the nearest enemy its sensor finds, and leaves it where it was when there is nothing to face. Needs a shield emitter (and a sensor for the enemy part).',
    settings: [int('interval', 3, 1, 100, 'Ticks between looks')],
    text: (c) => `on(Every, { ticks: ${c.num('interval')} }, () => {
  const threat = incomingBearing();
  if (threat >= 0) {
    config.shieldAngle(threat);
  } else {
    const foe = scan();
    if (foe >= 0) {
      config.shieldAngle(bearing(foe));
    }
  }
});`,
  },
  {
    name: 'Hunt', group: 'Combat',
    doc: 'Goes at the nearest enemy its sensor finds, while it is standing still, so a unit that has no orders closes in on what it sees. Pair it with EngageEnemies, which does the shooting. Made for drones.',
    settings: [int('interval', 20, 1, 200, 'Ticks between looks')],
    text: (c) => `on(Every, { ticks: ${c.num('interval')} }, () => {
  const foe = scan();
  if (foe >= 0 && moving() === 0) {
    goTo(posx(foe), posy(foe));
  }
});`,
  },
  {
    name: 'SmokeScreen', group: 'Combat',
    doc: 'Throws a volley of smoke towards whoever hurts the unit (or the nearest enemy its sensor finds), hiding it from their sensors for a while. Needs a smoke launcher; it rests 30 seconds between volleys, so the block simply tries each time the unit is hit.',
    settings: [int('minAmount', 5, 1, 1000, 'Damage in one hit before it reacts')],
    text: (c) => `on(Damaged, { minAmount: ${c.num('minAmount')} }, (amount, attacker) => {
  const foe = scan();
  const toward = bearing(attacker) >= 0 ? bearing(attacker) : (foe >= 0 ? bearing(foe) : -1);
  if (toward >= 0) {
    smoke(toward);
  }
});`,
  },
  {
    name: 'DroneBay', group: 'Combat',
    doc: 'Runs a drone bay: it builds the named small unit class (a micro or light unit of yours) and, when its sensor finds an enemy, launches every docked drone. When the enemy has been gone for a while it calls them home to recharge and mend. Needs a drone bay module and a sensor.',
    settings: [
      text('class', 'Wasp', 'Name of your unit class the bay builds (a micro or light unit)'),
      int('interval', 10, 1, 100, 'Ticks between looks'),
      int('calm', 8, 1, 100, 'Looks without an enemy before the drones are called home'),
    ],
    text: (c) => {
      const quiet = c.v('quiet');
      return `let ${quiet} = 0;
on(Every, { ticks: ${c.num('interval')} }, () => {
  config.droneClass(${quote(c.str('class'))});
  const foe = scan();
  if (foe >= 0) {
    ${quiet} = 0;
    launchDrones();
  } else {
    ${quiet} = ${quiet} + 1;
    if (${quiet} >= ${c.num('calm')}) {
      recallDrones();
    }
  }
});`;
    },
  },
  {
    name: 'Spotlight', group: 'Combat',
    doc: 'Points the spotlight at the nearest enemy its sensor finds. With none in sight it pans left and right across the way out from home (away from the allied units and buildings round it) to light the edge of the fog, and turns back rather than shine on an allied unit. Gives the player a Light power slider. Needs a spotlight module (and a sensor to follow enemies).',
    settings: [
      int('interval', 3, 1, 100, 'Ticks between turns'),
      int('sweep', 6, 1, 90, 'Degrees to turn each time when panning'),
      int('span', 60, 10, 180, 'Degrees to pan either side of straight out'),
      int('power', 5, 0, 10, 'Light power it starts with (the Light power slider in the side panel changes it)'),
    ],
    text: (c) => {
      const [offset, dir] = [c.v('offset'), c.v('dir')];
      return `let ${c.v('power')} = ${c.num('power')};
slider(${c.v('power')}, { label: 'Light power', min: 0, max: 10 });
let ${offset} = 0;
let ${dir} = 1;
on(Every, { ticks: ${c.num('interval')} }, () => {
  config.lightPower(${c.v('power')});
  const foe = scan();
  if (foe >= 0) {
    config.lightAngle(bearing(foe));
  } else {
    const next = ${offset} + ${dir} * ${c.num('sweep')};
    if (next > ${c.num('span')} || next < 0 - ${c.num('span')} || lightBlocked(outwardBearing() + next)) {
      ${dir} = 0 - ${dir};
    } else {
      ${offset} = next;
    }
    config.lightAngle(outwardBearing() + ${offset});
  }
});`;
    },
  },
];

export const BLOCK_BY_NAME: ReadonlyMap<string, BlockDef> = new Map(BLOCKS.map((b) => [b.name, b]));

/** The value of a setting: what the program wrote, else the schema's default. */
export const settingValue = (def: BlockDef, settings: Settings, name: string): ConfigValue => settings[name] ?? def.settings.find((f) => f.name === name)!.default;

/** The context a block's template writes its text with. */
export function blockContext(def: BlockDef, settings: Settings, constants: ReadonlyMap<string, number>): BlockContext {
  const prefix = def.name[0].toLowerCase() + def.name.slice(1);
  return {
    v: (name) => `${prefix}_${name}`,
    num: (s) => settingValue(def, settings, s) as number,
    list: (s) => settingValue(def, settings, s) as readonly number[],
    str: (s) => settingValue(def, settings, s) as string,
    c: (name) => constants.get(name) ?? NaN,
  };
}

/** Problems with the `use` statements of a document: unknown blocks, used twice, bad settings. */
export function checkBlocks(doc: FlowDoc): FlowError[] {
  const errors: FlowError[] = [];
  const fail = (message: string, node: string) => errors.push(new FlowError(message, undefined, undefined, node));
  const seen = new Set<string>();
  for (const u of doc.blocks ?? []) {
    const def = BLOCK_BY_NAME.get(u.block);
    if (!def) {
      fail(`Unknown block '${u.block}' (blocks: ${BLOCKS.map((b) => b.name).join(', ')})`, u.id);
      continue;
    }
    if (seen.has(u.block)) fail(`${u.block} is used twice: one is enough (its settings say how it behaves)`, u.id);
    seen.add(u.block);
    for (const [key, value] of Object.entries(u.settings)) {
      const field = def.settings.find((f) => f.name === key);
      if (!field) {
        fail(`${u.block} has no setting '${key}'${def.settings.length ? ` (it has: ${def.settings.map((f) => f.name).join(', ')})` : ''}`, u.id);
        continue;
      }
      const problem = configProblem(field, value);
      if (problem) fail(`${u.block} ${key}: ${problem}`, u.id);
      else if (key === 'holdFireKey' && value !== '' && !/^[A-Z]$/.test(value as string)) fail(`${u.block} ${key}: one upper-case letter, or empty`, u.id);
      else if (field.type === 'string' && key.endsWith('Key') && !/^[A-Z]$/.test(value as string) && key !== 'holdFireKey') fail(`${u.block} ${key}: one upper-case letter`, u.id);
    }
  }
  return errors;
}

export type { BlockUse };
