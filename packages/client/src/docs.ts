import './docs.css';
import {
  API_GROUPS,
  BASE_LINK_RANGE,
  BUILD_RANGE,
  BUILDING_BUILD_RANGE,
  BUILDING_VISION,
  DEMOLISH_REFUND,
  UNIT_VISION,
  BUILDING_TRANSFER_RANGE,
  CHARGE_RANGE,
  COMMON_ACTIONS,
  CUSTOM_TASK_BASE,
  MAX_BUTTON_LABEL,
  MAX_BUTTONS,
  DAY_LENGTH,
  DOCK_RANGE,
  HARVEST_RANGE,
  MAX_PARTS,
  MAX_TASKS,
  PART_LIST,
  RESOURCE_REGEN_INTERVAL_TICKS,
  SCRIPT_CONSTANT_DOCS,
  SOLAR_GENERATION_MULTIPLIER,
  STARTER_CLASSES,
  SWITCHABLE,
  TICK_RATE,
  TILE,
  UNIT_API,
  UNIT_TRANSFER_RANGE,
  VISIT_TTL,
  WIND_GENERATION_MULTIPLIER,
} from '@wst/engine';

/*
 * Script documentation. Reference pages are generated from the engine's own
 * metadata (UNIT_API, constants, part catalogue, starter scripts), so they
 * always match the build being played. Guide pages are hand-written below.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const code = (s: string) => `<pre><code>${esc(s.trim())}</code></pre>`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const tiles = (sub: number) => sub / TILE;
const fnLink = (name: string) => {
  const b = UNIT_API.find((f) => f.name === name);
  return b ? `<a href="#/api/${slug(b.group ?? '')}#${name}"><code>${name}()</code></a>` : `<code>${name}</code>`;
};

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
      order only lands in the unit's <a href="#/tasks">task queue</a>. What the unit actually does is decided
      by the <b>program of its class</b>: one script, shared by every unit of that class, running on each
      unit's own CPU with its own memory.</p>
      <h2>The loop</h2>
      <ul>
        <li>The simulation runs at ${TICK_RATE} ticks per second.</li>
        <li>Each tick, each unit's CPU gets its cycle budget (from its CPU modules) and runs its program from where it left off.</li>
        <li>Every instruction costs 1 cycle; builtin functions cost extra (listed on each one).</li>
        <li>Reaching the end of the program ends the tick; the next tick starts again at the top.</li>
        <li>Running out of cycles pauses mid-program; it resumes next tick. Slow CPUs run the same code, just with slower reactions.</li>
        <li>Variables live in the unit's memory and <b>persist between ticks</b>.</li>
      </ul>
      <h2>A minimal class</h2>
      ${code(`
var t = 0

t = taskType(0)
if t == MOVE {
  if goTo(taskX(0), taskY(0)) { taskDrop(0) }
} else if t != 0 {
  taskDrop(0)    # can't do anything else: discard it
} else {
  sleep(5)       # idle: save energy
}`)}
      <p>Open the <b>Designer</b> (button in the side panel, or F2), pick a class, edit its program and press
      <b>Upload program</b>: every unit of that class reboots into the new code at once. The editor highlights the
      language, completes builtins and constants (Ctrl+Space), shows their docs on hover, and runs the real compiler
      as you type. New designs are assembled there too, from modules grouped by category.</p>
      <h2>Where next</h2>
      <ul>
        <li><a href="#/language">Language</a> — syntax and operators.</li>
        <li><a href="#/tasks">Tasks &amp; orders</a> — how player orders reach your scripts.</li>
        <li><a href="#/energy">Energy &amp; power</a> — why units need to recharge.</li>
        <li><a href="#/examples">Starter scripts</a> — the programs your starting classes run.</li>
      </ul>`,
  },
  {
    id: 'language',
    title: 'Language',
    section: 'Guide',
    render: () => `
      <h1>Language</h1>
      <p>A deliberately small language: 32-bit integers only, no functions of your own (yet).</p>
      ${code(`
var target = -1          # declares a memory slot; the initial value is applied once at boot
target = scan()          # assignment
if target >= 0 && fire(target) == 0 {
  approach(target, 3)
} else if moving() == 0 {
  move(rand(5) - 2, rand(5) - 2)
}
while taskCount() > 1 { taskDrop(1) }
yield                    # end this tick's run here (resume after it next tick)`)}
      <h2>Statements</h2>
      <table>
        <tr><th>Form</th><th>Meaning</th></tr>
        <tr><td><code>var name</code>, <code>var name = 5</code></td><td>Declare a variable. Initial values must be literals and are applied once, at boot.</td></tr>
        <tr><td><code>name = expr</code></td><td>Assign.</td></tr>
        <tr><td><code>if expr { } else if expr { } else { }</code></td><td>Conditional (0 is false, anything else true).</td></tr>
        <tr><td><code>while expr { }</code></td><td>Loop. Long loops simply continue next tick when cycles run out.</td></tr>
        <tr><td><code>yield</code></td><td>Stop for this tick.</td></tr>
        <tr><td><code>button name "Label" key "K" aim</code></td><td>Declare a player action button (top level; <code>key</code> and <code>aim</code> optional). See <a href="#/buttons">Action buttons</a>.</td></tr>
        <tr><td><code>expr</code></td><td>Evaluate and discard (usually a function call).</td></tr>
      </table>
      <h2>Operators (loosest first)</h2>
      <table>
        <tr><th>Operators</th><th>Notes</th></tr>
        <tr><td><code>||</code></td><td>Short-circuit or (result 0/1)</td></tr>
        <tr><td><code>&amp;&amp;</code></td><td>Short-circuit and (result 0/1)</td></tr>
        <tr><td><code>== !=</code></td><td></td></tr>
        <tr><td><code>&lt; &lt;= &gt; &gt;=</code></td><td></td></tr>
        <tr><td><code>|</code></td><td>Bitwise or</td></tr>
        <tr><td><code>&amp;</code></td><td>Bitwise and — binds tighter than comparisons, so <code>taskFlags(0) &amp; URGENT</code> needs no brackets</td></tr>
        <tr><td><code>+ -</code></td><td>32-bit wrap-around</td></tr>
        <tr><td><code>* / %</code></td><td>Division truncates; dividing by zero is a fault</td></tr>
        <tr><td><code>-x !x</code></td><td>Negate, logical not</td></tr>
      </table>
      <h2>Comments</h2><p><code># …</code> or <code>// …</code> to the end of the line.</p>
      <h2>Faults</h2>
      <p>Division by zero or a stack overflow crashes the unit's program. The unit spends one tick rebooting
      (memory reset to its initial values) and starts again; the client tints faulted units red.</p>
      <h2>Limits</h2>
      <ul>
        <li>Memory: the number of variables is limited by the class's memory (CPU and memory modules). A program needing more is rejected.</li>
        <li>Stack depth comes from CPU modules; deeply nested expressions use more.</li>
        <li>Constants such as <code>MOVE</code> or <code>URGENT</code> are built in — see <a href="#/constants">Constants</a>.</li>
      </ul>`,
  },
  {
    id: 'tasks',
    title: 'Tasks & orders',
    section: 'Guide',
    render: () => `
      <h1>Tasks &amp; orders</h1>
      <p>Every unit and building has a task queue of up to ${MAX_TASKS} entries. A task is
      <code>(type, x, y, target, flags)</code>; index 0 is the front.</p>
      <h2>Where tasks come from</h2>
      <table>
        <tr><th>Source</th><th>How</th><th>Flags</th></tr>
        <tr><td>Player</td><td>Right-click (the server picks the type from what was clicked)</td><td><code>FROM_PLAYER</code>, plus <code>URGENT</code> unless the queue modifier (Ctrl, or Shift outside Firefox) was held</td></tr>
        <tr><td>Building</td><td><code>order()</code> while the unit is visiting (see <a href="#/buildings">Buildings</a>)</td><td><code>FROM_BUILDING</code></td></tr>
        <tr><td>The unit itself</td><td>${fnLink('taskPush')}</td><td>none</td></tr>
      </table>
      <h2>Right-click resolution</h2>
      <table>
        <tr><th>Clicked</th><th>Task</th></tr>
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
      <h2>Your script decides</h2>
      <p>Orders are always <b>appended</b>. Nothing happens unless the program acts on them. The starter
      classes use this policy: an URGENT order replaces the whole plan.</p>
      ${code(`
n = taskCount()
if n > 1 && taskFlags(n - 1) & URGENT {
  taskFirst(n - 1)                       # newest order to the front
  while taskCount() > 1 { taskDrop(1) }  # forget the rest
}
taskAck(0)                               # in hand: clear its URGENT flag`)}
      <p class="note">Acknowledge orders with ${fnLink('taskAck')}. Otherwise an old URGENT task that ends up
      last in the queue again (say, after the unit pushes a CHARGE task in front of it) looks like a brand-new order.</p>
      <p>Change it to make a class stubborn (finish the current job first), obedient only outside combat, or
      to refuse player orders while recharging. The client draws the planned route through every queued task
      for your selected units.</p>`,
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
      <p class="note">Scripts are limited separately, by their own sensors: ${fnLink('scan')} only finds what the unit's
      sensor reaches, whatever the player can see.</p>`,
  },
  {
    id: 'buttons',
    title: 'Action buttons',
    section: 'Guide',
    render: () => `
      <h1>Action buttons</h1>
      <p>With units selected, the side panel shows a grid of action buttons. Pressing a button (or its key) only
      <b>queues a task</b>, like a right-click. The unit's script still decides what happens.</p>
      <h2>Common actions</h2>
      <p>These are always shown. Each is greyed out unless at least one selected unit has the modules for it,
      and it only reaches the units that do. Aimed actions wait for a left-click on the map (right-click or Esc cancels).</p>
      <table>
        <tr><th>Button</th><th>Key</th><th>Task</th><th>What it does</th></tr>
        ${COMMON_ACTIONS.map((a) => `<tr><td>${a.icon} ${a.label}</td><td><kbd>${a.key}</kbd></td><td><code>${SCRIPT_CONSTANT_DOCS.find(([, v]) => v === a.task)?.[0] ?? a.task}</code>${a.aim ? ' (aimed)' : ''}</td><td>${esc(a.doc)}</td></tr>`).join('')}
      </table>
      <h2>Your own buttons</h2>
      <p>A class declares buttons in its program, at the top level:</p>
      ${code(`
button boost "Overdrive" key "O"   # key is optional
button mine "Lay mine" aim         # aim: the player then clicks a point or unit
var t = 0

t = taskType(0)
if t == boost {
  setModule(3, 1)
  taskDrop(0)
} else if t == mine {
  if goTo(taskX(0), taskY(0)) { taskDrop(0) }
}`)}
      <ul>
        <li>The button's name (<code>boost</code>) becomes a constant: the task type pushed onto the queue
        (${CUSTOM_TASK_BASE}, ${CUSTOM_TASK_BASE + 1}, … in declaration order). Declare buttons before using their names.</li>
        <li>Aimed buttons carry the picked tile in <code>taskX/taskY</code> and the unit under the cursor (if any) in
        <code>taskTarget</code>. Other buttons carry the unit's own tile and no target.</li>
        <li>With several classes selected, the grid shows every button of every class. Buttons with the same name
        are merged, and each press only reaches units whose class declares that button.</li>
        <li>Up to ${MAX_BUTTONS} buttons per class, labels up to ${MAX_BUTTON_LABEL} characters. Keys are single letters;
        ${COMMON_ACTIONS.map((a) => `<kbd>${a.key}</kbd>`).join(' ')} belong to the common actions.</li>
        <li>As with right-clicks, the task is <code>URGENT</code> unless the queue modifier is held.</li>
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
      <p>The building takes visits one at a time with ${fnLink('nextVisitor')}, may inspect the visitor
      (${fnLink('visitorCaps')}, ${fnLink('visitorLastHarvest')}, ${fnLink('visitorEnergy')}) and gives it tasks
      with ${fnLink('order')}. The visit ends at the next <code>nextVisitor()</code> call or when the building's
      program finishes its pass. Unclaimed visits lapse after ${VISIT_TTL} ticks.</p>
      <p class="note">Keeping a visitor's handle in a variable grants nothing: <code>order()</code> only ever
      targets the current visitor. Once a unit leaves, the building has no control over it until it visits again.</p>
      ${code(`
r = nextVisitor()
if r != 0 && visitorCaps() & CAN_HARVEST {
  res = randomResource(4, 10)
  if res >= 0 { order(HARVEST, 0, 0, res) }
}`)}
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
        <tr><td>CPU</td><td>per 100 cycles actually executed — <code>yield</code> and ${fnLink('sleep')} are free, and a sleeping CPU uses nothing</td></tr>
        <tr><td>Motor / rotor</td><td>per tick moving</td></tr>
        <tr><td>Sensor</td><td>per scan (${fnLink('scan')}, ${fnLink('scanAlly')}, ${fnLink('scanResource')})</td></tr>
        <tr><td>Weapon</td><td>per shot</td></tr>
        <tr><td>Cargo bay</td><td>per tick harvesting</td></tr>
        <tr><td>Factory</td><td>per tick producing</td></tr>
      </table>
      <p>Without enough energy the action simply doesn't happen: the CPU stops (state "NO POWER", unit greyed
      out), motors stall, weapons don't fire. Exact costs are in the <a href="#/parts">parts catalogue</a>.</p>
      <h2>Moving energy around</h2>
      <p>Energy moves between your own units and buildings by <b>transfer</b>, with one rule for everyone:</p>
      <ul>
        <li>The giver must have at least the amount it offers (otherwise nothing moves); the receiver takes what fits.</li>
        <li>Reach depends on the giver's scale: units reach ${tiles(UNIT_TRANSFER_RANGE)} tile; buildings reach
            ${tiles(BUILDING_TRANSFER_RANGE)} tiles from their edge.</li>
      </ul>
      <p><b>Charging pads</b> are buildings that transfer automatically, every tick, to each nearby own unit (topped up from
      the grid). Scripts transfer with ${fnLink('giveEnergy')} and check others with ${fnLink('energyOf')}. The starter scripts
      push a <code>CHARGE</code> task to the front of the queue below 25%.</p>
      <h2>Reviving flat units</h2>
      <p>A unit with no energy can't think or move. Select a healthy unit and right-click the flat one: it gets a
      <code>SUPPLY</code> task, and the starter scripts walk over and hand across 10% of their own capacity per pass until the
      flat unit reaches 50% (stopping if the helper would drop below half itself).</p>
      ${code(`
} else if t == SUPPLY {
  h = taskTarget(0)
  if energyOf(h) < 0 || energyOf(h) >= 50 || energy() * 2 < energyMax() {
    taskDrop(0)
  } else if approach(h, 1) == 1 {
    giveEnergy(h, energyMax() / 10)
  }
}`)}
      <h2>Power networks</h2>
      <p>Buildings link automatically to other own buildings within reach (edge to edge, in tiles):
      ${BASE_LINK_RANGE} tile by default, more with an <b>energy antenna</b> module (3, 6 or 12 tiles; the larger
      of the two buildings' reaches counts). Linked buildings form a network. Each tick, per network:</p>
      <ol>
        <li>Generators produce: <b>solar panels</b> follow daylight (a ${DAY_LENGTH / TICK_RATE}s day/night cycle; dark half the time; ${SOLAR_GENERATION_MULTIPLIER}× multiplier), <b>wind turbines</b> follow the wind (drifting 0–100%; ${WIND_GENERATION_MULTIPLIER}× multiplier).</li>
        <li>If generation is short of demand, buildings in <code>DISCHARGE</code> mode supply the gap from their stores.</li>
        <li><code>NORMAL</code> buildings are topped up (shared in proportion to what each needs).</li>
        <li>What is left goes to buildings in <code>CHARGE_STORE</code> mode. <code>HOLD</code> buildings neither take nor give.</li>
      </ol>
      <h2>Energy storage</h2>
      <p>A storage building is a pile of battery banks with a small CPU choosing the mode:</p>
      ${code(`
if netSupply() >= netDemand() { storageMode(CHARGE_STORE) } else { storageMode(DISCHARGE) }
sleep(4)`)}
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
      (Ctrl/Shift-click to place several). Any selected units with a <b>build arm</b> get a <code>BUILD</code> task for it;
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
      <p>Remote sites therefore need resources carried to them — the starter Builder script does this
      automatically — or a chain of pylons to bring them into the grid.</p>
      ${code(`
if siteSupplied(h) == 0 && cargo() == 0 {
  d = nearestStock()
  if approach(d, 1) == 1 { take(d, cargoMax()) }
} else if approach(h, 1) == 1 {
  build(h)
}`)}
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
# Save energy: only power the sensor every other pass.
if moduleKind(3) == M_SENSOR {
  setModule(3, !moduleOn(3))
}`)}
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
        <li>${fnLink('goTo')} returns 1 on arrival — including "as close as possible" when crowded or blocked —
            so <code>if goTo(x, y) { taskDrop(0) }</code> always finishes.</li>
        <li>${fnLink('passable')} lets scripts check terrain themselves.</li>
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
          <span class="meta">${1 + b.cost} cycle${b.cost ? 's' : ''}</span>
          <div class="sig">${b.name}(${(b.args ?? []).join(', ')})</div>
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
      <tr><th>Function</th><th>Cycles</th><th>Group</th><th>Description</th></tr>
      ${[...UNIT_API]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => `<tr><td><a href="#/api/${slug(b.group ?? '')}#${b.name}"><code>${b.name}(${(b.args ?? []).join(', ')})</code></a></td>
          <td>${1 + b.cost}</td><td>${esc(b.group ?? '')}</td><td>${esc(b.doc ?? '')}</td></tr>`)
        .join('')}
    </table></div>`,
  },
  ...apiPages,
  {
    id: 'constants',
    title: 'Constants',
    section: 'Reference',
    render: () => `<h1>Constants</h1><p>Built-in names, usable anywhere an integer is.</p><div class="table-wrap"><table>
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
    <p>Class cost: 10 × mass + CPU cycles. Build time: 10 + 4 × mass ticks.</p>`,
  },
  {
    id: 'examples',
    title: 'Starter scripts',
    section: 'Reference',
    render: () => `<h1>Starter scripts</h1><p>The programs your starting classes run. Copy, change, upload.</p>
      ${STARTER_CLASSES.map(
        (c) => `<h2>${esc(c.name)}</h2><p><code>${c.parts.join(', ')}</code></p>${c.program ? code(c.program) : '<p class="note">No CPU: this building just provides its modules.</p>'}`,
      ).join('')}`,
  },
];

const pages = [...guides, ...reference];

function renderNav(active: string, filter: string): void {
  const nav = document.getElementById('nav')!;
  const sections = [...new Set(pages.map((p) => p.section))];
  const matches = filter
    ? UNIT_API.filter((b) => b.name.toLowerCase().includes(filter) || (b.doc ?? '').toLowerCase().includes(filter))
    : [];
  nav.innerHTML = `<h1>Script API</h1>
    <input id="search" type="search" placeholder="Search functions…" value="${esc(filter)}">
    ${filter ? `<h2>Matches</h2>${matches.map((b) => `<a href="#/api/${slug(b.group ?? '')}#${b.name}">${b.name}()</a>`).join('') || '<p class="note">None</p>'}` : ''}
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
  document.title = `${page.title} — WebStrategyThing Script API`;
  renderNav(page.id, '');
  if (anchor) document.getElementById(anchor)?.scrollIntoView();
  else window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
