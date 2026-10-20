/*
 * The example programs used by the manual. Each is real program text: the manual draws it as the
 * graph editor shows it and as text, and a test checks every one parses and checks cleanly.
 */

export const EXAMPLES = {
  hello: `// A program is a set of event blocks. This one runs once, when the unit is built.
on(Spawned, (reason) => {
  alert('Hello!', 2000);
});`,

  move: `// Obey right-click move orders: walk to the tile that was clicked.
on(Order, { types: [MOVE] }, (type, tx, ty) => {
  goTo(tx, ty);
});`,

  arrive: `// goTo starts the walk and returns at once. What to do when it ends is attached to the way it ends.
on(Order, { types: [MOVE] }, (type, tx, ty) => {
  goTo(tx, ty, {
    arrived: () => {
      alert('I am here!', 1500);
    },
  });
});`,

  counter: `// A variable remembers a number between events.
let beeps = 0;

on(Every, { ticks: 20 }, () => {
  beeps = beeps + 1;
  alert('Beep ' + beeps, 1000);
});`,

  branch: `// An if / else chooses between two paths.
on(Damaged, (amount, attacker) => {
  if (hp() < 20) {
    alert('Nearly dead!', 2000);
  } else {
    alert('Ouch! ' + amount, 1000);
  }
});`,

  guard: `// Needs a sensor and a weapon. Shoot anything hostile that comes into range.
on(Detected, { watch: [ENEMY], range: 6, interval: 5 }, (kind, h) => {
  fire(h);
});`,

  chase: `// Close in on a far enemy, shoot a near one.
on(Detected, { watch: [ENEMY], range: 12, interval: 5 }, (kind, h) => {
  const near = dist(h);
  if (near > 4) {
    approach(h, 4);
  } else {
    fire(h);
  }
});`,

  recharge: `// Put the job aside when energy runs low, charge, then carry on.
on(EnergyLow, { below: 25 }, () => {
  suspendActivity();
  const pad = nearestCharger();
  charge(pad, {
    charged: () => {
      resumeActivity();
    },
  });
});`,

  blocks: `// The same ideas, ready-made. Each use() is a card in the graph.
use(TakeOrders, { types: [MOVE, STOP, CHARGE] });
use(RechargeWhenLow, { below: 25 });
use(HarvestLoop, { minMatter: 10 });`,

  own: `// A block raises an event of its own; your blocks can react to it.
use(HarvestLoop);

let delivered = 0;
on(Delivered, (load) => {
  delivered = delivered + load;
  alert('Delivered ' + delivered, 1500);
});`,

  button: `// A button for the player: the block is the button.
on(Button, { label: 'Say hi', key: 'Y' }, () => {
  alert('Hi there!', 1500);
});`,

  radio: `// Needs a radio module. One unit calls, every allied radio nearby answers.
on(Button, { label: 'Rally!', key: 'Q' }, () => {
  radioSend(1, 7);
});

on(Message, { channels: [1] }, (channel, value, sender, link) => {
  alert('Rally call ' + value, 2000);
});`,

  join: `// Text can be joined with +; numbers and true / false become text.
on(Every, { ticks: 50 }, () => {
  alert('HP ' + hp() + ' / ' + hpMax() + ', low = ' + (hp() < 20), 1000);
});`,

  while: `// A while loop repeats while its condition holds. Careful: a handler that runs too long crashes.
let total = 0;
let i = 0;

on(Spawned, (reason) => {
  i = 1;
  while (i <= 5) {
    total = total + i;
    i = i + 1;
  }
  alert('1 + 2 + 3 + 4 + 5 = ' + total, 3000);
});`,
} as const;

export type ExampleId = keyof typeof EXAMPLES;
