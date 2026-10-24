import './docs.css';
import { MANUAL } from './manual';
import {
  API_GROUPS,
  BLOCKS,
  configToText,
  ANTENNA_THROUGHPUT_PER_TILE,
  BASE_LINK_RANGE,
  BUILD_RANGE,
  BUILDING_BUILD_RANGE,
  BUILDING_VISION,
  COMMON_ACTIONS,
  COST,
  DAY_LENGTH,
  DEMOLISH_REFUND,
  DOCK_RANGE,
  EVENTS,
  FLOW_HOST,
  FREE_LITERALS,
  HARVEST_RANGE,
  MAX_BUTTON_LABEL,
  MAX_BUTTONS,
  MAX_PARTS,
  MAX_TEXT,
  parseDoc,
  PART_LIST,
  printText,
  RESOURCE_REGEN_INTERVAL_TICKS,
  SCRIPT_CONSTANT_DOCS,
  SOLAR_GENERATION_MULTIPLIER,
  STARTER_CLASSES,
  SWITCHABLE,
  TICK_RATE,
  TILE,
  UNIT_API,
  UNIT_TRANSFER_RANGE,
  UNIT_VISION,
  WIND_GENERATION_MULTIPLIER,
  BUILDING_TRANSFER_RANGE,
  CHARGE_RANGE,
} from '@wst/engine';

/*
 * Program documentation. Reference pages are generated from the engine's own
 * metadata (UNIT_API, events, constants, part catalogue, starter programs), so they
 * always match the build being played. Guide pages are hand-written below.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const code = (s: string) => `<pre><code>${esc(s.trim())}</code></pre>`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const tiles = (sub: number) => sub / TILE;
const fnLink = (name: string) => {
  const b = UNIT_API.find((f) => f.name === name);
  return b ? `<a href="#/api/${slug(b.group ?? '')}#${name}"><code>${b.kind === 'config' ? 'config.' : ''}${name}()</code></a>` : `<code>${name}</code>`;
};
const KIND_LABEL = { query: 'query', action: 'action', config: 'runtime setting' } as const;
const callName = (b: { name: string; kind: string }) => (b.kind === 'config' ? `config.${b.name}` : b.name);
const configText = (f: { name: string; type: string; default: unknown }) =>
  `<code>${f.name}</code> <span class="note">(${f.type === 'ints' ? 'list' : f.type}${Array.isArray(f.default) ? '' : `, default ${f.default === '' ? "''" : String(f.default)}`})</span>`;

interface Page {
  id: string;
  title: string;
  section: string;
  render(): string;
}

const guides: Page[] = [
  {
    id: 'start',
    title: 'Getting started',
    section: 'Guide',
    render: () => `
      <h1>Getting started</h1>
      <p>You command units the usual way — select with the mouse, right-click to give orders — but every
      order is only an <i>event</i> for the unit, see <a href="#/orders">Orders &amp; activities</a>. What the unit actually does is decided
      by the <b>program of its class</b>: one program, shared by every unit of that class, running on each
      unit's own CPU with its own memory.</p>
      <h2>Programs are event blocks</h2>
      <p>A program is a set of <b>event blocks</b>. Each block says <i>when</i> it runs (an <a href="#/events">event</a>:
      the unit was told something, saw something, has nothing to do, ...) and holds the code for it. A unit does
      nothing, and <b>pays nothing</b>, until an event that it has a block for arrives — and events nobody handles are
      never even queued.</p>
      <ul>
        <li>The simulation runs at ${TICK_RATE} ticks per second.</li>
        <li>Each tick a unit's CPU gets its cycle budget (from its CPU modules) and works through its queued events, one handler at a time.</li>
        <li>What a handler costs is counted in <b>nodes executed and wires followed</b> — see <a href="#/cost">CPU cost &amp; memory</a>.</li>
        <li>Running out of cycles pauses a handler between statements; it resumes next tick. Slow CPUs run the same code, just with slower reactions.</li>
        <li><code>let</code> variables live in the unit's memory and <b>persist between events</b>.</li>
      </ul>
      <h2>A minimal class</h2>
      ${code(`
// Obey MOVE orders: walk there. The walk itself runs without the program, and costs it nothing.
on(Order, { types: [MOVE] }, (type, tx, ty) => {
  goTo(tx, ty);
});

// Say something when the unit has nothing left to do.
on(Free, { repeat: 50 }, () => {
  // look for work here
});`)}
      <p>Open the <b>Designer</b> (button in the side panel, or F2), pick a class and switch to the <b>Code</b> tab to
      edit its program, then press <b>Upload program</b>: every unit of that class reboots into the new code at once.
      The program can be edited as text (a strict subset of TypeScript) or as a node graph, and the two always agree:
      see <a href="#/language">Language</a>. The designer's <b>Design</b> tab assembles new classes from modules.</p>
      <h2>Where next</h2>
      <ul>
        <li><a href="#/language">Language</a> — the text and graph forms, and the kinds of call.</li>
        <li><a href="#/events">Events</a> — what starts a block, and how to configure the sensor.</li>
        <li><a href="#/cost">CPU cost &amp; memory</a> — what programs cost to run and to store.</li>
        <li><a href="#/orders">Orders &amp; activities</a> — how player orders reach your programs, and how jobs run.</li>
        <li><a href="#/blocks">Blocks &amp; your own events</a> — ready-made behaviours with settings, and events your program raises itself.</li>
        <li><a href="#/examples">Starter programs</a> — the programs your starting classes run.</li>
      </ul>`,
  },
  {
    id: 'language',
    title: 'Language',
    section: 'Guide',
    render: () => `
      <h1>Language</h1>
      <p>One program, two views. The <b>text</b> is a strict subset of TypeScript; the <b>graph</b> shows the same program as
      blocks and wires. Edit either: the other follows. 32-bit integers only; <code>true</code> and <code>false</code> are 1 and 0.</p>
      ${code(`
let target = -1;                       // a variable: one memory slot, starts at this value

// An event block: its settings sit in the object, its parameters in the arrow function.
on(Detected, { watch: [ENEMY], range: 6, interval: 5 }, (kind, h) => {
  target = h;
  const near = dist(h);                // bind a call's result with const
  if (near <= 3) {
    fire(h);
  } else {
    approach(h, 3);
  }
});`)}
      <h2>What can be written</h2>
      <table>
        <tr><th>Text</th><th>Graph</th></tr>
        <tr><td><code>on(Event, { settings }, (a, b) =&gt; { ... });</code></td><td>An event block: the settings are fields on the block, the parameters are its data outputs.</td></tr>
        <tr><td><code>let name = 5;</code> (top level)</td><td>A variable declaration.</td></tr>
        <tr><td><code>name = expr;</code></td><td>Set Variable.</td></tr>
        <tr><td><code>call(args);</code>, <code>const r = call(args);</code></td><td>A call node on the execution line; <code>const</code> binds its result.</td></tr>
        <tr><td><code>if (c) { } else if (c) { } else { }</code></td><td>Branch.</td></tr>
        <tr><td><code>while (c) { }</code></td><td>While loop (a handler that runs too long crashes, see <a href="#/cost">CPU cost</a>).</td></tr>
        <tr><td><code>a + b</code>, <code>a === b</code>, <code>a &amp;&amp; b</code>, <code>c ? a : b</code>, <code>-x</code>, <code>!x</code></td><td>Maths, comparison and logic nodes.</td></tr>
        <tr><td><code>// note</code></td><td>A comment, kept in both views.</td></tr>
      </table>
      <p>Operators follow JavaScript's precedence: <code>||</code> <code>&amp;&amp;</code> <code>|</code> <code>&amp;</code> <code>== !=</code> <code>&lt; &lt;= &gt; &gt;=</code>
      <code>+ -</code> <code>* / %</code>. <code>&amp;&amp;</code> and <code>||</code> stop early. Division truncates and dividing by zero crashes the handler.
      Both <code>==</code> and <code>===</code> are accepted (the formatter writes <code>===</code>). Nothing else from TypeScript exists: no classes, closures, loops other
      than <code>while</code>, or other statements.</p>
      <h2>Four kinds of call</h2>
      <p>Every call belongs to one kind, and the editors colour them differently so you never mistake "set up how I behave" for "do something now":</p>
      <table>
        <tr><th>Kind</th><th>Meaning</th><th>Where</th><th>Examples</th></tr>
        <tr><td><b>Query</b></td><td>Reads state; no effect (a few spend energy, such as a scan).</td><td>Anywhere, inside expressions.</td><td><code>hp()</code> <code>orderCount()</code> <code>dist(h)</code> <code>scan()</code></td></tr>
        <tr><td><b>Action</b></td><td>A one-shot effect on the world now.</td><td>A statement. Its result can be bound with <code>const</code>.</td><td><code>moveTo(x, y)</code> <code>fire(h)</code> <code>nextOrder()</code> <code>stop()</code></td></tr>
        <tr><td><b>Runtime setting</b></td><td>Changes a standing setting of a module or the CPU while the program runs.</td><td>A statement, written in the <code>config</code> namespace.</td><td><code>config.rest(5)</code> <code>config.laserPower(12)</code> <code>config.setModule(2, 0)</code> <code>config.storageMode(HOLD)</code></td></tr>
        <tr><td><b>Event source settings</b></td><td>How an event's source behaves: the sensor sweep, filters, intervals, a button's label. Fixed when you upload; costs nothing to run.</td><td>The settings object of an event block.</td><td><code>{ watch: [ENEMY], range: 6 }</code> <code>{ types: [MOVE] }</code> <code>{ interval: 4 }</code></td></tr>
      </table>
      <p class="note">An action inside an expression, such as <code>if (fire(h))</code>, is an error: write <code>const hit = fire(h); if (hit) { ... }</code>.</p>
      <p>The one place text exists is where a function takes it, such as <code>alert('Enemy!', 2000)</code>, a speech bubble over the unit
      for 2 seconds (up to ${MAX_TEXT} characters; each distinct text takes one memory slot). Join text, whole numbers and true/false values with <code>+</code>,
      as <code>alert('HP: ' + hp() + ' low=' + (hp() &lt; 20), 2000)</code>: the text is built when the call runs and cut at ${MAX_TEXT} characters. Joined text is only allowed where a function takes text.
      In the graph, type the text straight into the input, or wire an Add node.</p>
      <h2>Names</h2>
      <p>Variables, event parameters and bound results cannot reuse a built-in name (so no variable called <code>x</code> or <code>hp</code>), and
      <code>const</code> results only live inside the block they are written in. Constants such as <code>MOVE</code> or <code>URGENT</code> are built in — see <a href="#/constants">Constants</a>.</p>
      <h2>Faults</h2>
      <p>Division by zero, or a handler that runs more than ${COST.HANDLER_LIMIT} cycles, crashes the unit's program. The unit spends one tick rebooting
      (memory reset to its start values, queued events lost, a <code>Spawned</code> event with reason 1) and starts again; the client tints faulted units red.</p>`,
  },
  {
    id: 'events',
    title: 'Events',
    section: 'Guide',
    render: () => `
      <h1>Events</h1>
      <p>Events are the only way a block runs. Each block has the event's <b>settings</b> in an object after its name, and receives the event's
      <b>parameters</b>. An event with no block for it costs nothing: it is dropped before it is queued. Filters in the settings (such as
      <code>types</code> on <code>Order</code>) drop events for free too.</p>
      <div class="table-wrap"><table>
        <tr><th>Event</th><th>Parameters</th><th>Settings</th><th>Raised when</th></tr>
        ${EVENTS.map(
          (e) => `<tr id="${e.name}"><td><code>${e.name}</code>${e.multi ? '<br><span class="note">several blocks allowed</span>' : ''}</td>
            <td>${e.params.map((p) => `<code>${p}</code>`).join(', ') || '—'}</td>
            <td>${e.config.map(configText).join('<br>') || '—'}</td><td>${esc(e.doc)}</td></tr>`,
        ).join('')}
      </table></div>
      <h2>Free: nothing left to do</h2>
      <p><code>Free</code> fires when the unit has no job and no order: it was just built, a job ended with nothing attached to it, or the order list ran out.
      It fires once, then again every <code>repeat</code> ticks while the unit stays free, so a free unit can look for work without a polling loop.
      A unit that is busy is never free, so it pays nothing. (<code>Idle</code> still exists as a CPU heartbeat, but hooking only <code>Idle</code> is a sign
      the program should be built from events instead.)</p>
      <h2>Detected: the sensor</h2>
      <p>A <code>Detected</code> block <i>is</i> the sensor setup. The sensor sweeps on its own schedule, paying its normal energy per sweep (even when nothing is found),
      and raises one event per thing found, only when something is. Better sensors allow more:</p>
      <table>
        <tr><th>Setting</th><th>Short sensor</th><th>Long sensor</th></tr>
        <tr><td><code>watch</code> (kinds, in priority order: <code>ENEMY</code>, <code>RESOURCE</code>, <code>DAMAGED_ALLY</code>)</td><td>1 kind</td><td>up to 3 kinds</td></tr>
        <tr><td><code>sort</code> (which candidate comes first)</td><td><code>NEAREST</code></td><td>also <code>WEAKEST</code>, <code>STRONGEST</code>, <code>MOST_DAMAGED</code></td></tr>
        <tr><td><code>limit</code> (reports per sweep)</td><td>1</td><td>up to 3</td></tr>
        <tr><td><code>range</code></td><td colspan="2">up to the sensor's own range</td></tr>
        <tr><td><code>interval</code></td><td colspan="2">at least 1 tick between sweeps</td></tr>
      </table>
      <p>Anything the installed sensor cannot do is reduced to what it can, and the editor says so where it is written. A class needs a sensor module for <code>Detected</code> to ever fire.
      Nothing senses further or cheaper than the explicit ${fnLink('scan')} did: a sweep costs the sensor's energy, like one scan.</p>
      ${code(`
// Shoot what comes into range, strongest first; no code runs while nothing is there.
on(Detected, { watch: [ENEMY, RESOURCE], range: 14, interval: 4, sort: STRONGEST, limit: 2 }, (kind, h) => {
  if (kind === ENEMY) {
    fire(h);
  }
});`)}
      <h2>Order, Button, Visitor</h2>
      <p><code>Order</code> blocks run when an order reaches the front of the unit's order list (see <a href="#/orders">Orders &amp; activities</a>). <code>Button</code> blocks
      <i>are</i> the class's action buttons, see <a href="#/buttons">Action buttons</a>. <code>Visitor</code> blocks are how buildings talk to units, see <a href="#/buildings">Buildings &amp; visitors</a>.</p>`,
  },
  {
    id: 'cost',
    title: 'CPU cost & memory',
    section: 'Guide',
    render: () => `
      <h1>CPU cost &amp; memory</h1>
      <h2>What running costs</h2>
      <p>A handler is charged for the <b>nodes it executes and the wires it follows</b> — the same price whether you wrote text or drew a graph:</p>
      <table>
        <tr><th>What</th><th>Cycles</th></tr>
        <tr><td>A statement that runs (its node, plus the execution wire into it)</td><td>${COST.NODE + COST.ARC}</td></tr>
        <tr><td>An operator or a query inside an expression (its node, plus the wire out of it)</td><td>${COST.NODE + COST.ARC}</td></tr>
        <tr><td>Reading a variable (a Get node on a wire)</td><td>${COST.NODE + COST.ARC}</td></tr>
        <tr><td>Reading an event parameter or a <code>const</code> result (just the wire)</td><td>${COST.ARC}</td></tr>
        <tr><td>A number written inline, or a named constant</td><td>free</td></tr>
        <tr><td>A call's own cost, on top (a scan costs more than a comparison)</td><td>listed per function</td></tr>
        <tr><td>A branch that is not taken, a block with no events, a filtered-out event</td><td>nothing</td></tr>
      </table>
      <p>Each tick a unit's CPU receives its <code>cycles per tick</code>. It runs statements until the balance is spent, <b>pauses</b> the handler and resumes it next tick.
      A statement is never split: one that costs more than the budget still runs, overdrawing the balance, and the CPU then pays it off over the next ticks. Unspent cycles are not
      banked. Energy is billed from the cycles actually run, per 100 (see the CPU module). A handler that runs more than ${COST.HANDLER_LIMIT} cycles crashes.</p>
      <h2>What a program occupies</h2>
      <p>Memory never costs energy, but a program has to fit the class's memory slots (CPU and memory modules provide them). One slot for each:</p>
      <ul>
        <li>variable (<code>let</code>);</li>
        <li><b>distinct</b> number written in the code, other than ${[...FREE_LITERALS].join(', ')} (a number used ten times takes one slot; named constants like <code>MOVE</code> are free);</li>
        <li>event parameter or <code>const</code> result — for the biggest block, since only one runs at a time.</li>
      </ul>
      <p>Event settings are not memory. The editor shows <i>Memory used/available</i> as you type, and an upload that does not fit is rejected with what it needs.
      Sharing one <code>let range = 6;</code> is cheaper than writing several different numbers.</p>
      <h2>The event queue</h2>
      <p>Each unit buffers a few events (its CPU's stack size). When the queue is full, the oldest periodic event (<code>Every</code>, <code>Timer</code>, <code>Detected</code>)
      makes room, otherwise the new event is dropped.</p>`,
  },
  {
    id: 'orders',
    title: 'Orders & activities',
    section: 'Guide',
    render: () => `
      <h1>Orders &amp; activities</h1>
      <p>Orders are events, and jobs are <b>activities</b> that the game runs for you. Your program says <i>what</i> to do when an order arrives; the walking,
      gathering and fighting happen outside the program, so a busy unit costs almost no CPU.</p>
      <h2>Where orders come from</h2>
      <table>
        <tr><th>Source</th><th>How</th><th>Setting to match</th></tr>
        <tr><td>Player</td><td>Right-click (the server picks the type from what was clicked), or an action button</td><td><code>from: FROM_PLAYER</code></td></tr>
        <tr><td>Building</td><td>${fnLink('order')} while the unit is visiting (see <a href="#/buildings">Buildings</a>)</td><td><code>from: FROM_BUILDING</code></td></tr>
      </table>
      <p>An order that no <code>Order</code> block wants is dropped at once, for free. Wanted orders wait in the unit's order list; the front one is raised as an
      <code>Order</code> event with <code>(type, tx, ty, target)</code>. Player orders given with the queue modifier (Ctrl, or Shift outside Firefox) wait behind the current one;
      without it the order is <i>urgent</i>, and an <code>Order</code> block with <code>urgent: REPLACE</code> lets it cancel the current job and the rest of the list.</p>
      <h2>Right-click resolution</h2>
      <table>
        <tr><th>Clicked</th><th>Order</th></tr>
        <tr><td>Enemy unit or building (and you can fight)</td><td><code>ATTACK</code></td></tr>
        <tr><td>Resource (and you have a cargo bay)</td><td><code>HARVEST</code></td></tr>
        <tr><td>Own depot (and you have a cargo bay)</td><td><code>DOCK</code></td></tr>
        <tr><td>Own charging pad</td><td><code>CHARGE</code></td></tr>
        <tr><td>Own construction site (and you have a build arm)</td><td><code>BUILD</code></td></tr>
        <tr><td>Own unit below 25% energy</td><td><code>SUPPLY</code> (give it energy)</td></tr>
        <tr><td>Anything else / ground</td><td><code>MOVE</code></td></tr>
        <tr><td>With a building selected</td><td><code>MOVE</code> on the building (starter HQ uses it as a rally point)</td></tr>
        <tr><td><kbd>S</kbd></td><td><code>STOP</code></td></tr>
      </table>
      <h2>Activities and their outcomes</h2>
      <p>A call such as ${fnLink('goTo')}, ${fnLink('harvest')} or ${fnLink('build')} <b>starts an activity</b> and returns at once. When the activity ends it ends in one
      of a few named ways, and you attach what to do next to each way. The graph shows these as extra exec pins on the node.</p>
      ${code(`
on(Order, { types: [HARVEST], urgent: REPLACE }, (type, tx, ty, field) => {
  harvest(field, {
    full: () => {
      const depot = nearestDepot();
      dock(depot);
    },
    empty: () => {
      nextOrder();
    },
  });
});`)}
      <p>The chain runs later, in the frame of the call: it sees the same names the call did (here <code>field</code>), not what the call returned. An activity started
      while handling an order <b>finishes that order</b> when it ends without a chain; if there is one, it is up to the chain
      (use ${fnLink('nextOrder')} to move on, ${fnLink('swapOrder')} to hand the job on, ${fnLink('clearOrders')} to drop everything).</p>
      <h2>Interrupting a job</h2>
      <p>${fnLink('suspendActivity')} puts the current job aside and stops the unit; ${fnLink('resumeActivity')} brings it back where it was.
      That is how a unit recharges mid-job: <code>EnergyLow</code> suspends, charges, and resumes. ${fnLink('stop')} cancels the job outright, and
      ${fnLink('activity')} tells you which kind is under way.</p>
      ${code(`
on(EnergyLow, { below: 25 }, () => {
  suspendActivity();
  const pad = nearestCharger();
  charge(pad, {
    charged: () => {
      resumeActivity();
    },
  });
});`)}
      <p class="note"><code>EnergyLow</code> repeats while the store stays low, so a recharge that was cut short is tried again. The client draws the route of a unit's
      current job for your selected units.</p>`,
  },
  {
    id: 'blocks',
    title: 'Blocks & your own events',
    section: 'Guide',
    render: () => `
      <h1>Blocks &amp; your own events</h1>
      <p>Most classes do the same few things: obey orders, recharge when low, harvest, fight. Those are <b>blocks</b>: named behaviours with settings, written as one line of text
      or one card in the graph. Every starter class is built from them.</p>
      ${code(`use(TakeOrders, { types: [MOVE, STOP, CHARGE], urgent: REPLACE });
use(RechargeWhenLow, { below: 25 });
use(HarvestLoop, { minMatter: 10 });`)}
      <p>A block is a template: it expands into ordinary variables and event blocks when the program is checked, so it costs exactly what the expanded program costs, and
      each block can be used once. In the graph press <b>Expand</b> on a card (or write the events yourself) to turn it into plain event blocks you can change; that is one way, like ejecting.
      Variables a block makes are named after it (<code>harvestLoop_x</code>), and a problem inside a block is shown on its card. New classes can start from a
      <b>Template</b> in the graph toolbar.</p>
      <h2>Your own events</h2>
      <p>A program can raise events of its own and react to them: <code>emit(Delivered, load)</code> raises <code>Delivered</code> for this unit's <code>on(Delivered, (load) => { ... })</code>
      blocks. Names start with a capital letter and are not built-in events; a class can have up to 16 of them, each carrying up to 4 numbers. Raising an event nobody handles costs only the statement.
      Blocks raise events too, so you can react to them without touching the block:</p>
      ${code(`use(HarvestLoop);

let delivered = 0;
on(Delivered, (load) => {
  delivered = delivered + load;
});`)}
      <h2>The blocks</h2>
      <table>
        <tr><th>Block</th><th>What it does</th><th>Settings (default)</th><th>Raises</th></tr>
        ${BLOCKS.map(
          (b) => `<tr><td><code>${b.name}</code><br><span class="muted">${b.group}</span></td><td>${b.doc}</td><td>${
            b.settings.map((f) => `<code>${f.name}</code> (${configToText(b.name, f, undefined, FLOW_HOST) || "''"}): ${f.doc}`).join('<br>') || '—'
          }</td><td>${b.emits?.map((e) => `<code>${e}</code>`).join(', ') ?? '—'}</td></tr>`,
        ).join('')}
      </table>`,
  },
  {
    id: 'fog',
    title: 'Vision & fog of war',
    section: 'Guide',
    render: () => `
      <h1>Vision &amp; fog of war</h1>
      <p>You see your own units and buildings, every resource field, and anything within the <b>vision</b> of one of
      your own: at least ${tiles(UNIT_VISION)} tiles for units and ${tiles(BUILDING_VISION)} for buildings, or the range of their
      best sensor if that is further. The server only sends you what you can see, so enemy positions, health and module
      switches outside your vision never reach your browser.</p>
      <p>The map is shaded where you can't see: lightly where you have looked before, darker where you never have.
      Things that leave your vision disappear until you see them again.</p>
      <p class="note">Programs are limited separately, by their own sensors: ${fnLink('scan')} and <code>Detected</code> only find what the unit's
      sensor reaches, whatever the player can see.</p>`,
  },
  {
    id: 'buttons',
    title: 'Action buttons',
    section: 'Guide',
    render: () => `
      <h1>Action buttons</h1>
      <p>With units selected, the side panel shows a grid of action buttons.</p>
      <h2>Common actions</h2>
      <p>These are always shown. Pressing one (or its key) gives the unit an <b>order</b>, like a right-click, and the unit's program decides what happens.
      Each is greyed out unless at least one selected unit has the modules for it, and it only reaches the units that do. Aimed actions wait for a
      left-click on the map (right-click or Esc cancels).</p>
      <table>
        <tr><th>Button</th><th>Key</th><th>Order</th><th>What it does</th></tr>
        ${COMMON_ACTIONS.map((a) => `<tr><td>${a.icon} ${a.label}</td><td><kbd>${a.key}</kbd></td><td><code>${SCRIPT_CONSTANT_DOCS.find(([, v]) => v === a.task)?.[0] ?? a.task}</code>${a.aim ? ' (aimed)' : ''}</td><td>${esc(a.doc)}</td></tr>`).join('')}
      </table>
      <h2>Your own buttons</h2>
      <p>A class declares a button with a <code>Button</code> block. The block <i>is</i> the button, and its code runs when the button is pressed:</p>
      ${code(`
let boosted = 0;

on(Button, { label: 'Overdrive', key: 'O' }, () => {
  config.setModule(3, 1);
  boosted = 1;
});

on(Button, { label: 'Lay mine', aim: true }, (px, py, target) => {
  const arrived = goTo(px, py);
});`)}
      <ul>
        <li>Settings: <code>label</code> (up to ${MAX_BUTTON_LABEL} characters), <code>key</code> (one upper-case letter, optional), <code>aim</code> (the player then clicks a point or unit) and <code>name</code> (defaults to the label).</li>
        <li>The block receives <code>(tx, ty, target)</code> (tile x and y): the picked tile and the unit under the cursor (-1 if none) for aimed buttons, otherwise the unit's own tile.</li>
        <li>A button raises its event directly; it does not go through the order list.</li>
        <li>With several classes selected, the grid shows every button of every class. Buttons with the same name
        are merged, and each press only reaches units whose class has that button.</li>
        <li>Up to ${MAX_BUTTONS} buttons per class. Keys are single letters;
        ${COMMON_ACTIONS.map((a) => `<kbd>${a.key}</kbd>`).join(' ')} belong to the common actions.</li>
      </ul>
      <p class="note">The starter fighters have a <b>Hold fire</b> toggle (<kbd>F</kbd>), and the energy storage has
      <b>Hold charge</b> / <b>Automatic</b> (<kbd>K</kbd>/<kbd>U</kbd>).</p>`,
  },
  {
    id: 'buildings',
    title: 'Buildings & visitors',
    section: 'Guide',
    render: () => `
      <h1>Buildings &amp; visitors</h1>
      <p>Buildings are built from the same modules as units, on an immobile frame with many more slots
      (1×1, 2×2 or 3×3 tiles). They run programs too — or none at all, if they have no CPU (e.g. a power pylon).</p>
      <h2>Talking to units: visits</h2>
      <p>A building can only instruct a unit while that unit is <b>visiting</b>:</p>
      <ul>
        <li><code>PRODUCED</code> — the unit was just built by this factory;</li>
        <li><code>DOCKED</code> — the unit just called ${fnLink('dock')} here.</li>
      </ul>
      <p>Each visit raises a <code>Visitor</code> event with the reason and the visitor's handle. While that handler runs, the building may inspect the visitor
      (${fnLink('visitorCaps')}, ${fnLink('visitorLastHarvest')}, ${fnLink('visitorEnergy')}) and give it orders
      with ${fnLink('order')}. The link ends when the handler does.</p>
      <p class="note">Keeping a visitor's handle in a variable grants nothing: <code>order()</code> only ever
      targets the current visitor. Once a unit leaves, the building has no control over it until it visits again.</p>
      ${code(`
on(Visitor, { reasons: [DOCKED] }, (reason, who) => {
  if (visitorCaps() & CAN_HARVEST) {
    const field = randomResource(4, 10);
    if (field >= 0) {
      order(HARVEST, 0, 0, field);
    }
  }
});`)}
      <h2>Ranges</h2>
      <p>Interaction ranges are measured from a building's edge: docking within ${tiles(DOCK_RANGE)} tiles,
      charging within ${tiles(CHARGE_RANGE)} tiles; harvesting needs the unit within ${tiles(HARVEST_RANGE)} tiles
      of the resource.</p>`,
  },
  {
    id: 'energy',
    title: 'Energy & power',
    section: 'Guide',
    render: () => `
      <h1>Energy &amp; power</h1>
      <h2>Every unit has an energy store</h2>
      <p>Its chassis provides a small buffer; battery modules add more. Modules use energy when used:</p>
      <table>
        <tr><th>Module</th><th>Energy use</th></tr>
        <tr><td>CPU</td><td>per 100 cycles actually run — a CPU with nothing to do uses nothing</td></tr>
        <tr><td>Motor / rotor</td><td>per tick moving</td></tr>
        <tr><td>Sensor</td><td>per scan (${fnLink('scan')}, ${fnLink('scanAlly')}, ${fnLink('scanResource')}) and per <code>Detected</code> sweep</td></tr>
        <tr><td>Weapon</td><td>per shot</td></tr>
        <tr><td>Cargo bay</td><td>per tick harvesting</td></tr>
        <tr><td>Factory</td><td>per tick producing</td></tr>
      </table>
      <p>Without enough energy the action simply doesn't happen: the CPU stops (state "NO POWER", unit greyed
      out), motors stall, weapons don't fire. Exact costs are in the <a href="#/parts">parts catalogue</a>. The <code>EnergyLow</code> and
      <code>EnergyFull</code> events fire as the store crosses a threshold.</p>
      <h2>Moving energy around</h2>
      <p>Energy moves between your own units and buildings by <b>transfer</b>, with one rule for everyone:</p>
      <ul>
        <li>The giver must have at least the amount it offers (otherwise nothing moves); the receiver takes what fits.</li>
        <li>Reach depends on the giver's scale: units reach ${tiles(UNIT_TRANSFER_RANGE)} tile; buildings reach
            ${tiles(BUILDING_TRANSFER_RANGE)} tiles from their edge.</li>
      </ul>
      <p><b>Charging pads</b> are buildings that transfer automatically, every tick, to each nearby own unit (topped up from
      the grid). Programs transfer with ${fnLink('giveEnergy')} and check others with ${fnLink('energyOf')}. The starter programs
      suspend their job and go to a charging pad below 25%.</p>
      <h2>Reviving flat units</h2>
      <p>A unit with no energy can't think or move. Select a healthy unit and right-click the flat one: it gets a
      <code>SUPPLY</code> order, and the starter programs walk over and hand across 10% of their own capacity per pass until the
      flat unit reaches 50% (stopping if the helper would drop below half itself).</p>
      ${code(`
on(Order, { types: [SUPPLY] }, (type, tx, ty, flat) => {
  supply(flat);
});`)}
      <h2>Power networks</h2>
      <p>Buildings link automatically to other own buildings within reach (edge to edge, in tiles):
      ${BASE_LINK_RANGE} tile by default, more with an <b>energy antenna</b> module (3, 6 or 12 tiles; the larger
      of the two buildings' reaches counts). Linked buildings form a network. Short links (up to ${BASE_LINK_RANGE} tile) carry any
      amount of energy; long antenna links carry at most ${ANTENNA_THROUGHPUT_PER_TILE} energy per tick for each antenna on the
      building times the building's size (1, 2 or 3 tiles), so two antennas on one building double it and a larger
      building carries more (a long link uses the stronger of its two ends). Each tick, per network:</p>
      <ol>
        <li>Generators produce: <b>solar panels</b> follow daylight (a ${DAY_LENGTH / TICK_RATE}s day/night cycle; dark half the time; ${SOLAR_GENERATION_MULTIPLIER}× multiplier), <b>wind turbines</b> follow the wind (drifting 0–100%; ${WIND_GENERATION_MULTIPLIER}× multiplier).</li>
        <li>If generation is short of demand, buildings in <code>DISCHARGE</code> mode supply the gap from their stores.</li>
        <li><code>NORMAL</code> buildings are topped up (shared in proportion to what each needs).</li>
        <li>What is left goes to buildings in <code>CHARGE_STORE</code> mode. <code>HOLD</code> buildings neither take nor give.</li>
      </ol>
      <h2>Energy storage</h2>
      <p>A storage building is a pile of battery banks with a small CPU choosing the mode:</p>
      ${code(`
on(Every, { ticks: 4 }, () => {
  if (netSupply() >= netDemand()) {
    config.storageMode(CHARGE_STORE);
  } else {
    config.storageMode(DISCHARGE);
  }
});`)}
      <p>See also ${fnLink('netStored')}, ${fnLink('netCapacity')}, ${fnLink('daylight')}, ${fnLink('wind')}.</p>`,
  },
  {
    id: 'construction',
    title: 'Construction & resources',
    section: 'Guide',
    render: () => `
      <h1>Construction &amp; resources</h1>
      <h2>Resources live in silos</h2>
      <p>Harvested resources are stored in buildings with <b>silo</b> modules (the HQ has two; a Resource Silo has six).
      Your <b>common pool</b> is everything held in all your silos — shown at the top of the side panel as
      <i>stored / capacity</i>. Silos can fill up (build more), and a destroyed silo loses its contents.</p>
      <p>Natural matter fields regenerate one unit every ${RESOURCE_REGEN_INTERVAL_TICKS / TICK_RATE}s, up to their starting amount. Matter drops from destroyed units remain finite.</p>
      <ul>
        <li>${fnLink('dock')} fills the depot's silos with as much cargo as fits (and makes the unit a visitor).</li>
        <li>${fnLink('take')} loads resources from a depot back into a unit's cargo bay.</li>
        <li>${fnLink('nearestDepot')} finds a depot with free space; ${fnLink('nearestStock')} one with something in it.</li>
        <li>Production is paid from the pool when a unit is queued.</li>
      </ul>
      <h2>Placing buildings</h2>
      <p>Pick a building class in the <b>build bar</b> under the map, then left-click the map to place its blueprint
      (Ctrl/Shift-click to place several). Any selected units with a <b>build arm</b> get a <code>BUILD</code> order for it;
      right-clicking a site with builders selected does the same. Sites block their tiles and can be attacked.
      Blueprints can only be placed inside your vision (the centre of the building must be in view of your units or
      buildings); the ghost turns red outside it.</p>
      <h2>Building</h2>
      <p>A builder within ${tiles(BUILD_RANGE)} tiles of the site calls ${fnLink('build')}; from then on it invests up to its
      build rate in resources every tick until the site is finished (the building costs its class cost in total;
      several builders work faster). Each tick the builder pays:</p>
      <ol>
        <li>from its own cargo bay first, then</li>
        <li>from the common pool — but only if the site is <b>supplied</b>: linked by the power grid (directly, or through
        pylons) to a finished building with silos. Check with ${fnLink('siteSupplied')}.</li>
      </ol>
      <p>Remote sites therefore need resources carried to them — the starter Builder program does this
      automatically — or a chain of pylons to bring them into the grid.</p>
      ${code(`
on(Order, { types: [BUILD] }, (type, tx, ty, site) => {
  build(site, {
    starved: () => {
      const depot = nearestStock();
      take(depot, cargoMax(), {
        taken: () => {
          build(site);
        },
      });
    },
  });
});`)}
      <p>A finished building starts with empty energy and fills up from its power network.</p>
      <h2>Construction towers</h2>
      <p>Buildings can carry a <b>build crane</b>, which reaches ${tiles(BUILDING_BUILD_RANGE)} tiles from the building's edge.
      The starter <b>Construction Tower</b> builds the nearest own site (${fnLink('nearestSite')}) whenever it is in reach,
      paying from the common pool, so link it to the grid.</p>
      <h2>Cancelling and demolishing</h2>
      <p>Select own buildings and press <b>Demolish</b> (<kbd>X</kbd>) twice. A construction site is cancelled and refunds
      everything invested so far; a finished building refunds ${DEMOLISH_REFUND * 100}% of its cost. A demolished silo's
      contents move to your other silos where they fit. Refunds go to the common pool, as far as your silos have room.</p>
      <h2>Retiring classes</h2>
      <p>In the designer, <b>Retire class</b> removes a class from the build bar and production menus (and from the class limit).
      Units already built carry on; <b>Restore class</b> brings it back.</p>`,
  },
  {
    id: 'modules',
    title: 'Modules',
    section: 'Guide',
    render: () => `
      <h1>Modules</h1>
      <p>A class is a chassis (or building frame) plus up to ${MAX_PARTS - 1} modules. Each unit can switch its own
      modules on and off — from its program with ${fnLink('setModule')}, or by the player from the side panel.
      Switched-off modules use no energy and provide nothing (but still weigh something and keep their memory,
      stack and battery capacity).</p>
      <p>Switchable: ${[...SWITCHABLE].map((s) => `<code>${s}</code>`).join(', ')}. Frames, memory, armour,
      batteries and depots are passive and always on. A program may not switch off its own last running CPU
      (the player can).</p>
      ${code(`
// Save energy: switch the sensor (module 3) on only while something is near.
on(EnergyLow, { below: 30 }, () => {
  if (moduleKind(3) === M_SENSOR) {
    config.setModule(3, 0);
  }
});`)}
      <p>Module indices match the order of parts in the class (the chassis is index 0). Use
      ${fnLink('moduleCount')} and ${fnLink('moduleKind')} to find them.</p>`,
  },
  {
    id: 'movement',
    title: 'Terrain & movement',
    section: 'Guide',
    render: () => `
      <h1>Terrain &amp; movement</h1>
      <ul>
        <li>Each tile is either passable or not. Buildings also block the tiles they stand on.</li>
        <li>Ground units path around obstacles automatically (${fnLink('moveTo')}, ${fnLink('goTo')}, ${fnLink('approach')}).
            If the destination is blocked or unreachable, they go as close as they can.</li>
        <li>Flying units (a working <b>rotor</b>) fly straight over anything, but only land on tiles that are
            passable and free; if told to stop over rock they drift to the nearest landing spot.</li>
        <li>Units push apart rather than overlap (ground and air separately).</li>
        <li>${fnLink('goTo')} is an activity: it ends <code>arrived</code> — including "as close as possible" when crowded — or <code>blocked</code>.
            The <code>Arrived</code> event fires when a trip ends.</li>
        <li>${fnLink('passable')} lets programs check terrain themselves.</li>
      </ul>`,
  },
];

const apiPages: Page[] = API_GROUPS.map((group) => ({
  id: `api/${slug(group)}`,
  title: group,
  section: 'API reference',
  render: () => {
    const fns = UNIT_API.filter((b) => b.group === group);
    return `<h1>${esc(group)}</h1>${fns
      .map(
        (b) => `<div class="fn" id="${b.name}">
          <span class="meta">${KIND_LABEL[b.kind]}${b.cost ? ` · +${b.cost} cycles` : ''}</span>
          <div class="sig">${callName(b)}(${(b.args ?? []).join(', ')})</div>
          <p>${esc(b.doc ?? '')}</p>
        </div>`,
      )
      .join('')}`;
  },
}));

const reference: Page[] = [
  {
    id: 'api/index',
    title: 'All functions',
    section: 'API reference',
    render: () => `<h1>All functions</h1><div class="table-wrap"><table>
      <tr><th>Function</th><th>Kind</th><th>Extra cycles</th><th>Group</th><th>Description</th></tr>
      ${[...UNIT_API]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => `<tr><td><a href="#/api/${slug(b.group ?? '')}#${b.name}"><code>${callName(b)}(${(b.args ?? []).join(', ')})</code></a></td>
          <td>${KIND_LABEL[b.kind]}</td><td>${b.cost}</td><td>${esc(b.group ?? '')}</td><td>${esc(b.doc ?? '')}</td></tr>`)
        .join('')}
    </table></div>`,
  },
  ...apiPages,
  {
    id: 'constants',
    title: 'Constants',
    section: 'Reference',
    render: () => `<h1>Constants</h1><p>Built-in names, usable anywhere an integer is (and in event settings).</p><div class="table-wrap"><table>
      <tr><th>Name</th><th>Value</th><th>Meaning</th></tr>
      ${SCRIPT_CONSTANT_DOCS.map(([n, v, d]) => `<tr><td><code>${n}</code></td><td>${v}</td><td>${esc(d)}</td></tr>`).join('')}
    </table></div>`,
  },
  {
    id: 'parts',
    title: 'Parts catalogue',
    section: 'Reference',
    render: () => `<h1>Parts catalogue</h1><div class="table-wrap"><table>
      <tr><th>Part</th><th>Slot</th><th>Mass</th><th>Energy use</th><th>Fits</th><th>What it does</th></tr>
      ${PART_LIST.map(
        (p) => `<tr><td>${esc(p.name)}<br><code>${p.id}</code></td><td>${p.slot}</td><td>${p.mass}</td>
          <td>${p.use ?? '—'}</td><td>${p.structureOnly ? 'buildings' : p.mobileOnly ? 'units' : 'both'}</td>
          <td>${esc(p.description)}${p.slots ? ` ${p.slots} slots.` : ''}${p.energy ? ` Stores ${p.energy}.` : ''}</td></tr>`,
      ).join('')}
    </table></div>
    <p>Class cost: 10 × mass + CPU cycles, then ×2.5 for each size above medium (heavy ×2.5, super-heavy ×6.25, colossus ×15.6), and the energy to produce a unit grows the same way. Build time: 10 + 4 × mass ticks.</p>`,
  },
  {
    id: 'examples',
    title: 'Starter programs',
    section: 'Reference',
    render: () => `<h1>Starter programs</h1><p>The programs your starting classes run. Copy, change, upload.</p>
      ${STARTER_CLASSES.map((c) => {
        let text = '';
        try {
          text = c.program ? printText(parseDoc(c.program), FLOW_HOST) : '';
        } catch {
          text = '';
        }
        return `<h2>${esc(c.name)}</h2><p><code>${c.parts.join(', ')}</code></p>${text ? code(text) : '<p class="note">No CPU: this building just provides its modules.</p>'}`;
      }).join('')}`,
  },
];

const manual: Page[] = MANUAL.map((p) => ({ ...p, section: 'Manual' }));
const pages = [...manual, ...guides, ...reference];

function renderNav(active: string, filter: string): void {
  const nav = document.getElementById('nav')!;
  const sections = [...new Set(pages.map((p) => p.section))];
  const matches = filter
    ? UNIT_API.filter((b) => b.name.toLowerCase().includes(filter) || (b.doc ?? '').toLowerCase().includes(filter))
    : [];
  nav.innerHTML = `<h1>Manual</h1>
    <input id="search" type="search" placeholder="Search functions…" value="${esc(filter)}">
    ${filter ? `<h2>Matches</h2>${matches.map((b) => `<a href="#/api/${slug(b.group ?? '')}#${b.name}">${callName(b)}()</a>`).join('') || '<p class="note">None</p>'}` : ''}
    ${sections
      .map(
        (s) => `<h2>${s}</h2>${pages
          .filter((p) => p.section === s)
          .map((p) => `<a href="#/${p.id}" class="${p.id === active ? 'active' : ''}">${esc(p.title)}</a>`)
          .join('')}`,
      )
      .join('')}`;
  const search = nav.querySelector<HTMLInputElement>('#search')!;
  search.oninput = () => {
    renderNav(active, search.value.trim().toLowerCase());
    const again = document.querySelector<HTMLInputElement>('#search')!;
    again.focus();
    again.setSelectionRange(again.value.length, again.value.length);
  };
}

function route(): void {
  // Hash form: #/page-id or #/page-id#anchor
  const [path, anchor] = location.hash.replace(/^#\/?/, '').split('#');
  const page = pages.find((p) => p.id === path) ?? pages[0];
  document.getElementById('page')!.innerHTML = page.render();
  document.title = `${page.title} — Digital Chaos manual`;
  renderNav(page.id, '');
  if (anchor) document.getElementById(anchor)?.scrollIntoView();
  else window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
