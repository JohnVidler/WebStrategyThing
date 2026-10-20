import {
  BLOCKS,
  configToText,
  expandBlocks,
  FLOW_HOST,
  MAX_UNITS_PER_PLAYER,
  parseText,
  printText,
  STARTER_CLASSES,
  STARTING_CREDITS,
  TICK_RATE,
} from '@wst/engine';
import { graphOf } from './docsGraph';
import { EXAMPLES, type ExampleId } from './manualExamples';

/*
 * The manual: gentle, task-oriented pages for new players, ahead of the reference pages in docs.ts.
 * Programs shown here come from manualExamples.ts (checked by a test) and are drawn as the graph
 * editor draws them, so the pictures can never drift from the real editor.
 */

export interface ManualPage {
  readonly id: string;
  readonly title: string;
  render(): string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const code = (s: string) => `<pre><code>${esc(s.trim())}</code></pre>`;
const key = (k: string) => `<span class="kbd">${k}</span>`;
const ext = (href: string, label: string) => `<a href="${href}" target="_blank" rel="noopener">${label} ↗</a>`;

/** An example as the graph shows it, then as text. */
const example = (id: ExampleId, caption: string): string => `${graphOf(EXAMPLES[id], caption).html}<details><summary>The same program as text</summary>${code(EXAMPLES[id])}</details>`;
const graphOnly = (id: ExampleId, caption: string): string => graphOf(EXAMPLES[id], caption).html;

const tryIt = (html: string): string => `<div class="try"><b>Try it.</b> ${html}</div>`;

const starterLink = (name: string) => (STARTER_CLASSES.some((c) => c.name === name) ? `<b>${esc(name)}</b>` : esc(name));

export const MANUAL: ManualPage[] = [
  {
    id: 'manual',
    title: 'Welcome',
    render: () => `
      <h1>The manual</h1>
      <p class="manual-lead">Digital Chaos is a real-time strategy game where you do not only give orders: you also <b>write the minds of your units</b>.
      You build a base, gather matter, make power, design your own units and buildings out of modules, and then teach each class what to do,
      either by wiring blocks together or by writing a few lines of code. No programming experience is needed to start.</p>
      <h2>Where to begin</h2>
      <ol class="manual-steps">
        <li><b><a href="#/m-game">How the game works</a></b>: what you are trying to do, and the two things everything runs on, <i>matter</i> and <i>energy</i>.</li>
        <li><b><a href="#/m-play">Playing</a></b>: selecting, giving orders, building and the keys worth learning.</li>
        <li><b><a href="#/m-economy">Matter &amp; energy in practice</a></b> and <b><a href="#/m-build">Building &amp; producing</a></b>: running a base.</li>
        <li><b><a href="#/m-fight">Fighting, seeing &amp; talking</a></b>: weapons, fog of war, radar and radios.</li>
        <li><b><a href="#/m-design">Designing your own classes</a></b>: chassis, modules and shapes.</li>
        <li><b><a href="#/m-code">Programming from zero</a></b>, then <b><a href="#/m-graph">the graph editor</a></b>, <b><a href="#/m-recipes">recipes</a></b> and the <b><a href="#/m-blocks">block gallery</a></b>.</li>
        <li><b><a href="#/m-help">When something goes wrong</a></b>: reading problems, and a glossary.</li>
      </ol>
      <p>When you want details rather than a walk-through, the <b>Guide</b> pages (Language, Events, Orders &amp; activities, Energy, ...) and the <b>API reference</b> list everything exactly,
      and are generated from the game itself, so they always match the version you are playing.</p>
      ${tryIt('The quickest way to feel it: start a single-player game, open the <b>Designer</b> (side panel, or ' + key('F2') + '), pick <i>Harvester</i>, open the <b>Code</b> tab and press <b>Graph</b>. That picture is the program your harvesters are running right now.')}`,
  },

  {
    id: 'm-game',
    title: 'How the game works',
    render: () => `
      <h1>How the game works</h1>
      <h2>The aim</h2>
      <p>You and your opponents each start with a small base. A match ends when only one side has anything left: destroy the other side's units and buildings
      (a team-mate's, in co-op, is on your side). If you are beaten you can keep watching the rest of the match with the fog lifted.</p>
      <h2>Two resources</h2>
      <ul>
        <li><b>Matter</b> (◆) is the stuff everything is made of. It lies in <b>fields</b> on the map, and units with a <i>cargo bay</i> harvest it and carry it to a <b>silo</b>.
        Units, buildings and some weapons' ammunition all cost matter. You start with ${STARTING_CREDITS} in your HQ's silos.</li>
        <li><b>Energy</b> (ϟ) is what makes things <i>work</i>: every CPU, motor, sensor and weapon spends it. Buildings generate it (solar panels, wind turbines), store it in batteries and
        share it over power links; units carry a small store and recharge at charging pads. No energy means no thinking, moving or shooting.</li>
      </ul>
      <h2>Units and buildings are made of modules</h2>
      <p>Everything you own belongs to a <b>class</b>: a list of <b>modules</b> bolted onto a <b>chassis</b> (units) or <b>frame</b> (buildings). The modules decide what it can do:
      a <i>motor</i> lets it move, a <i>cargo bay</i> harvest, a <i>build arm</i> construct, a <i>gun</i> fight, a <i>sensor</i> see further, a <i>CPU</i> think.
      The game comes with a set of starter classes (${starterLink('Harvester')}, ${starterLink('Builder')}, ${starterLink('Tank')}, ${starterLink('Resource Silo')}, ${starterLink('Solar Array')}, ...),
      and you can design your own in the <a href="#/m-design">Designer</a>.</p>
      <h2>Every class has a program</h2>
      <p>Here is the idea that makes this game different. A unit with a CPU does not run on magic: it runs the <b>program of its class</b>. When you right-click to send a harvester
      to a field, you are not steering it; the order arrives as an <b>event</b>, and the class's program decides what that means (the starter one starts walking and gathering).
      Change the program and every unit of that class changes behaviour at once.</p>
      <p>A program is a set of <b>event blocks</b>: <i>"when this happens, do that"</i>. Units that have nothing to react to do nothing, and cost nothing.
      You can build programs by wiring blocks (see <a href="#/m-graph">the graph editor</a>) or by typing them; both are the same program shown two ways.
      The starter classes are already built from a handful of ready-made <b>blocks</b> (see the <a href="#/m-blocks">gallery</a>), so you can play for a long time without touching code.</p>
      <h2>Time</h2>
      <p>The game runs at ${TICK_RATE} <b>ticks</b> per second. Programs run on a unit's own CPU, which gets a limited number of <b>cycles</b> each tick: a small CPU is slow to react,
      a good one reacts quickly, and running out of cycles just means the rest waits for next tick. How many cycles a program costs is explained in <a href="#/cost">CPU cost &amp; memory</a>.</p>
      <h2>Fog of war</h2>
      <p>You only see what your own units and buildings can see. Unseen terrain is dark, enemies in the dark are hidden, and you cannot place buildings where you have no vision.
      Sensors extend sight; <a href="#/m-fight">radar</a> reveals a flash of everything in range.</p>`,
  },

  {
    id: 'm-play',
    title: 'Playing: controls',
    render: () => `
      <h1>Playing: controls</h1>
      <h2>Selecting</h2>
      <ul>
        <li><b>Left-click</b> a unit or building to select it. <b>Drag</b> a box to select several: a box picks combat units first, then turrets, then everything of yours.
        ${key('Shift')} adds to (or removes from) the selection.</li>
        <li><b>Double-click</b> a unit to select every unit of its class on screen. ${key('Ctrl')}+${key('A')} selects all your units.</li>
        <li><b>Control groups:</b> ${key('Ctrl')}+${key('1')}...${key('9')} saves the selection, ${key('1')}...${key('9')} recalls it (press twice to centre the view), ${key('Shift')}+number adds to a group.</li>
      </ul>
      <h2>Giving orders</h2>
      <p><b>Right-click</b> is a context order. The game looks at what you clicked and picks the order:</p>
      <table>
        <tr><th>You right-click</th><th>The selected units are told to</th></tr>
        <tr><td>the ground</td><td>move there</td></tr>
        <tr><td>an enemy</td><td>attack it</td></tr>
        <tr><td>a field of matter</td><td>harvest it (units with a cargo bay)</td></tr>
        <tr><td>your own silo</td><td>dock and unload / reload</td></tr>
        <tr><td>a charging pad</td><td>go and recharge</td></tr>
        <tr><td>a construction site</td><td>build it (units with a build arm)</td></tr>
        <tr><td>one of your own flat or damaged units</td><td>give it energy, or repair it</td></tr>
      </table>
      <ul>
        <li>${key('Ctrl')}-click (or ${key('Shift')} where your browser allows) <b>queues</b> the order behind the current ones instead of replacing them.</li>
        <li><b>Right-drag</b> instead of clicking to <b>spread</b> the selected units evenly along the path you draw: line them up across a corridor or around a point.</li>
        <li>The <b>action grid</b> in the side panel offers the common orders as buttons with hotkeys (${key('M')} move, ${key('A')} attack, ${key('S')} stop, ${key('H')} harvest, ${key('D')} unload, ${key('C')} recharge),
        and the buttons that each selected class adds for itself, such as <b>Hold fire</b>.</li>
        <li>Orders are only <i>requests</i>: the unit's program decides what to do with them. If a class has no block for an order, it ignores it.</li>
      </ul>
      <h2>Building</h2>
      <ol class="manual-steps">
        <li>Select the builders you want to use (units with a <i>build arm</i>, or a Construction Tower).</li>
        <li>Pick a building from the <b>Build</b> bar. A ghost follows the mouse: green means you can place it, red means rock, another building or darkness is in the way.</li>
        <li>Click to place it. A construction site appears and the selected builders are sent to it. ${key('Ctrl')}-click keeps the ghost so you can place several.</li>
        <li><b>Left-drag</b> before you let go to lay a <b>straight line</b> of the building, side by side (up to 12): good for walls, pylons and rows of solar panels. Spots that are blocked are skipped.</li>
        <li>${key('Esc')} or right-click cancels.</li>
      </ol>
      <h2>The view</h2>
      <p>Mouse wheel zooms at the cursor, the middle button (or the arrow keys) pans, ${key('Home')} resets. ${key('F1')} opens this manual over the game without pausing it, and ${key('F2')} opens the Designer.</p>
      ${tryIt('In a single-player game, select a Harvester, then right-click a glowing field of matter. Now drag a box around three units and right-drag a curved line across the map.')}`,
  },

  {
    id: 'm-economy',
    title: 'Matter & energy in practice',
    render: () => `
      <h1>Matter &amp; energy in practice</h1>
      <h2>Matter: harvest, carry, store</h2>
      <p>A <b>Harvester</b> walks to a field, fills its cargo bay, walks to a <b>silo</b> and unloads, over and over. The starter program does this for you after one right-click on a field,
      and picks a nearby field again when its own runs low. Fields slowly regrow after being emptied.</p>
      <ul>
        <li>Your HQ has silos; build a <b>Resource Silo</b> near a distant field so the round trip is short. Silos also reload tanks and rocket trucks with ammunition.</li>
        <li>Your matter total is shown at the top. Everything you buy comes out of it: classes cost matter by their mass, and weapons that need ammunition draw it from their cargo bay (on units) or from silos (on buildings).</li>
        <li>More harvesters means more income, until the fields near you are the limit.</li>
      </ul>
      <h2>Energy: make, link, store, spend</h2>
      <ol class="manual-steps">
        <li><b>Make it.</b> A <b>Solar Array</b> produces by daylight and nothing at night; a <b>Wind Turbine</b> follows the wind. The Daylight and Wind tiles in the side panel show what you can expect.</li>
        <li><b>Link it.</b> Buildings that are within a tile of each other, or within an <b>energy antenna</b>'s reach (the <b>Power Pylon</b> is a small building that is all antenna), join a power network automatically. The game draws the links.</li>
        <li><b>Store it.</b> <b>Energy Storage</b> buildings fill up when there is a surplus and give it back when there is a shortage, so the night is covered by the day.</li>
        <li><b>Spend it.</b> Factories, builders, CPUs, weapons... everything on the network draws from it. The power balance strip tells you whether you are making more than you use.</li>
      </ol>
      <p>Units carry their own small store. A unit that runs flat goes dark, so the starter programs recharge below 25%. A <b>Charging Pad</b> tops up units that stand near it, and another unit can <i>supply</i> a flat one: select a healthy unit and right-click the flat one.</p>
      <p>More detail, including exactly how a network shares power each tick, is in <a href="#/energy">Energy &amp; power</a>.</p>
      ${tryIt('Count your solar arrays against your factories. If the power balance goes negative, build another array, or an Energy Storage, before you queue more units.')}`,
  },

  {
    id: 'm-build',
    title: 'Building & producing',
    render: () => `
      <h1>Building &amp; producing</h1>
      <h2>Buildings are built by builders</h2>
      <p>Buildings cost matter <i>and</i> energy, paid as the work proceeds. A <b>Builder</b> (a unit with a build arm) or a <b>Construction Tower</b> (a building with a build crane, reaching a few tiles) works on a construction
      site until it is finished. Sites can be attacked, so build in defended places. You can only place buildings where you can see.</p>
      <p>Idle builders spread out over the open sites, and team up on one only when there are no others. If your last builder dies you are not stuck: the HQ can always make another (see below).</p>
      <h2>Factories make units</h2>
      <p>Select a factory and pick a class from the production panel to queue one. The unit appears beside the building and goes to the <i>rally point</i>: with the building selected, right-click anywhere to set it.
      A factory shows the build time, and there is an overall limit of ${MAX_UNITS_PER_PLAYER} units per player (buildings do not count).</p>
      <h3>Factory modules decide what a building can make</h3>
      <p>A factory building has one or more <b>factory modules</b>. Chassis come in three size classes, and a unit is built at full speed when the building has enough modules for it:</p>
      <table>
        <tr><th>Unit</th><th>Modules for full speed</th><th>One module short</th><th>Two or more short</th></tr>
        <tr><td>Light</td><td>1</td><td>(none needed)</td><td>(none needed)</td></tr>
        <tr><td>Medium</td><td>2</td><td>a tenth of the speed</td><td>not possible</td></tr>
        <tr><td>Heavy</td><td>3</td><td>a tenth of the speed</td><td>not possible</td></tr>
      </table>
      <p>The <b>HQ</b> has one module: it makes light units quickly and medium ones, including the Builder, slowly, so you can never be locked out of rebuilding. For real production, build a
      <b>Light Factory</b> (1 module), a <b>Vehicle Factory</b> (2) or a <b>Heavy Factory</b> (3). Production buttons that the selected building cannot make at all are greyed out, with the reason.</p>
      <h2>Repair and upkeep</h2>
      <p>A <b>Repair Drone</b> (or a Construction Tower) mends damaged units and buildings for a little matter and energy. Right-click a damaged friend with a repair beam selected.</p>
      <h2>Demolishing</h2>
      <p>The demolish button (press twice to confirm) removes a building and refunds half its cost. Cancelled construction sites refund everything invested.</p>`,
  },

  {
    id: 'm-fight',
    title: 'Fighting, seeing & talking',
    render: () => `
      <h1>Fighting, seeing &amp; talking</h1>
      <h2>Weapons</h2>
      <table>
        <tr><th>Weapon</th><th>In short</th></tr>
        <tr><td>Light gun</td><td>Cheap, short range, needs no ammunition.</td></tr>
        <tr><td>Cannon</td><td>More damage per shot, uses matter as ammunition.</td></tr>
        <tr><td>Laser</td><td>Hits at once; costs a lot of energy per shot, and more energy means more damage.</td></tr>
        <tr><td>Tesla coil</td><td>Stuns the CPUs of everything near it, friend or foe. Switches things off rather than hurting them.</td></tr>
        <tr><td>Missile launchers</td><td>Slow, homing missiles that fly in arcs and burst on impact; bigger launchers hit harder and further. The <i>huge</i> launcher on a Rocket Artillery out-ranges every sensor and needs a spotter or radar.</td></tr>
        <tr><td>Flak</td><td>Only shoots incoming missiles, but never misses. Right-click a missile with an armed unit selected to shoot it down.</td></tr>
      </table>
      <p>Armour plates add hit points. Which weapon beats which is part of the game: flak makes missiles useless, tesla coils stop whole groups, long range beats short.</p>
      <h2>Seeing: fog, sensors and radar</h2>
      <ul>
        <li>Every unit and building sees a short distance. A <b>sensor</b> module sees further, and also lets the unit's program <i>react</i> to what it sees (a <code>Detected</code> block, see <a href="#/events">Events</a>).</li>
        <li><b>Radar</b> is a module with a spinning dish. A program fires a pulse with <code>radarPulse(energy)</code>: the more energy spent, the bigger the range, and every unit and building inside shows as a blip that slowly fades.
        A <b>Radar Tower</b> pings on its own.</li>
      </ul>
      <h2>Talking: radio and laser links</h2>
      <p>Units and buildings can message each other. A <b>radio</b> reaches allies with a radio within 12 tiles, through rock. A <b>laser link</b> reaches 40 tiles but needs a clear line of sight.
      A program sends with <code>radioSend(channel, value)</code> or <code>laserSend(channel, value)</code>, and receivers react in a <code>Message</code> block:</p>
      ${example('radio', 'Press Q on a selected radio unit; every allied radio on channel 1 answers. Notice the second block has no wire into it: events start it.')}
      <h2>A few tips</h2>
      <ul>
        <li>Keep fighters in a group and give them an attack-move by right-clicking the enemy's side of the map.</li>
        <li>Recharge before a fight, not during it. Many classes have a <b>Hold fire</b> button (${key('F')}) so they do not waste ammunition.</li>
        <li>Build a few Laser Turrets or Flak Turrets near your base, and a Radar Tower for early warning.</li>
      </ul>`,
  },

  {
    id: 'm-design',
    title: 'Designing your own classes',
    render: () => `
      <h1>Designing your own classes</h1>
      <p>Open the <b>Designer</b> from the side panel or the main menu (it works without a match too), and go to the <b>Design</b> tab. A design is a list of parts.</p>
      <ol class="manual-steps">
        <li><b>Choose a body.</b> Units use a <i>chassis</i>, buildings a <i>frame</i>. Chassis come in <b>light</b>, <b>medium</b> and <b>heavy</b>, each also as a <b>long</b> version, twice as long, with more slots.
        Frames come as square <b>1×1</b>, <b>2×2</b> and <b>3×3</b>, and as shapes in a 3×3 box: <b>L</b>, <b>T</b>, <b>cross</b>, <b>U</b> and <b>H</b>. The shaped frames cover fewer tiles, so units can walk into the gaps and two buildings can interlock; their slots,
        mass and hit points scale with the tiles they cover.</li>
        <li><b>Add modules</b> from the catalogue until the slots are full. Disabled tiles say why in red: it only fits buildings (or units), or there are no free slots left.</li>
        <li><b>Check the stats.</b> Mass sets the cost and build time; the energy a design uses is shown too. The preview shows what it will look like on the map in your colours and a rival's.</li>
        <li><b>Name it and create the class.</b> It appears in your class list and in the production panel (or the Build bar, for a building).</li>
        <li><b>Give it a program</b> in the <b>Code</b> tab (or start from a <b>Template</b>), then press <b>Upload</b>. A class with no CPU needs no program: it just provides its modules, like a solar array.</li>
      </ol>
      <h2>What the modules are for</h2>
      <table>
        <tr><th>Group</th><th>Modules</th></tr>
        <tr><td>Compute</td><td><b>CPU</b> (cycles per tick: the speed of thinking) and <b>memory</b> (how many variables a program can keep).</td></tr>
        <tr><td>Movement</td><td>Small, large and turbo <b>motors</b>, and the flying <b>rotor</b>. Heavier units need stronger motors to keep up.</td></tr>
        <tr><td>Weapons &amp; armour</td><td>Gun, cannon, laser, tesla, missiles, flak, armour plate.</td></tr>
        <tr><td>Sensors &amp; radar</td><td>Short and long <b>sensors</b>, and <b>radar</b>.</td></tr>
        <tr><td>Radio &amp; laser links</td><td>Short-range <b>radio</b> and long-range <b>laser link</b>.</td></tr>
        <tr><td>Industry</td><td>Cargo bay, build arm / crane, repair beam, factory, silo.</td></tr>
        <tr><td>Power</td><td>Battery cells and banks, charging pad, solar panel, wind turbine, energy antennas.</td></tr>
      </table>
      <p>Every module costs energy to use and adds mass. The <a href="#/parts">Parts catalogue</a> has the numbers.</p>
      <h2>Keeping your designs</h2>
      <p>Your classes are saved in your browser and come back next time. <b>Download</b> and <b>Upload</b> keep copies as a file; <b>Reset to defaults</b> restores the starters.
      When the game is updated and a default class has changed, you are asked whether to <b>merge</b> the new defaults with your edits, <b>replace</b> them, or keep your own.</p>
      ${tryIt('Make a fast scout: <i>Light chassis + CPU + small motor + short sensor</i>. Then a <i>Long medium chassis</i> with a large motor, a long sensor, a huge missile launcher and cargo bays: that is a Rocket Artillery.')}`,
  },

  {
    id: 'm-code',
    title: 'Programming from zero',
    render: () => `
      <h1>Programming from zero</h1>
      <p>You do not need to be a programmer, and you can do a great deal with the blocks alone. This page introduces the few ideas behind every program, one at a time.
      Where a topic is better taught elsewhere, there is a link; those sites are not ours and may change.</p>
      <h2>1. A program is a list of instructions for a computer</h2>
      <p>A computer does exactly what it is told, in order, and nothing else. A <b>program</b> is the instructions; <b>code</b> is how you write them down. Here the "computer" is a unit's CPU,
      and the instructions are things like <i>walk there</i>, <i>say something</i> and <i>shoot that</i>.</p>
      <h2>2. Events: "when this happens, do that"</h2>
      <p>Most programs start from a thing that happens (a click, a message, a timer). This style is called <b>event-driven</b> programming
      (${ext('https://en.wikipedia.org/wiki/Event-driven_programming', 'Wikipedia')}). Your unit's program is a set of <b>event blocks</b>. Here is the smallest useful one:</p>
      ${example('hello', 'One event block. The red header is the event, <b>Spawned</b>; the orange block under it, joined by a white wire, is an <b>action</b> that runs when it happens.')}
      <p>In words: <i>when this unit is spawned (built), show a speech bubble that says "Hello!" for 2000 milliseconds.</i> The text on the right is the same program in <b>TypeScript</b>-style code.
      Read it line by line: <code>on(Spawned, ...)</code> says "when Spawned happens", and what sits between the curly braces <code>{ }</code> is what to do.</p>
      <h2>3. Calls: asking the game to do or tell something</h2>
      <p>Almost every instruction is a <b>call</b>: a name followed by brackets holding what you want to give it, like <code>alert('Hello!', 2000)</code>. The things in the brackets are <b>arguments</b>.
      There are two kinds you will use all the time:</p>
      <ul>
        <li><b>Actions</b> (orange) make something happen: <code>goTo(x, y)</code>, <code>fire(enemy)</code>, <code>alert(text, time)</code>.</li>
        <li><b>Queries</b> (blue) ask a question and give back an answer: <code>hp()</code> is how healthy I am, <code>dist(h)</code> how far away something is.</li>
      </ul>
      <p>Every call is listed, with what it does, in the <b>API reference</b> section on the left.</p>
      <h2>4. Parameters: what the event tells you</h2>
      <p>An event can come with information. An <code>Order</code> event brings the order's <code>type</code> and the clicked tile <code>tx</code>, <code>ty</code>. You name those in the brackets after the arrow and use them in the block:</p>
      ${example('move', 'The blue dots on the event are its parameters; wire them into the action. Here the clicked tile is passed to goTo, so the unit walks to wherever you right-clicked.')}
      <p>The <code>{ types: [MOVE] }</code> part is the event's <b>setting</b>: it says "only for move orders". Settings filter events for free, so the program is not even woken for other orders.</p>
      <h2>5. Variables: a memory</h2>
      <p>A <b>variable</b> is a named box that holds a number. It keeps its value between events, so a unit can remember things. You declare one at the top with <code>let</code>, and change it with <code>=</code>.
      (Read the right-hand side first: <code>beeps = beeps + 1</code> means "take what is in <code>beeps</code>, add one, put it back".)</p>
      ${example('counter', 'A timer event (<b>Every</b> 20 ticks, two seconds) bumps a counter and shows it. Green nodes read a variable, grey nodes do the maths. The blue pipe-like wires carry values.')}
      <p>All numbers are whole numbers. <code>true</code> and <code>false</code> are just 1 and 0, so a comparison like <code>hp() &lt; 20</code> gives 1 or 0.
      Text is allowed only where a call asks for it, such as <code>alert</code>; you can join text and numbers with <code>+</code>.</p>
      ${example('join', 'Joining: <code>"HP " + hp()</code> turns the number into text. The result is cut at 40 characters.')}
      <h2>6. Choices: if / else</h2>
      <p>An <b>if</b> runs one thing or another depending on a condition:</p>
      ${example('branch', 'The purple Branch node has two white exits: True and False. Only one of them runs.')}
      <p>Conditions use comparisons (<code>&lt;</code> <code>&gt;</code> <code>&lt;=</code> <code>&gt;=</code> <code>===</code> equal, <code>!==</code> not equal) and can be combined with <code>&amp;&amp;</code> ("and"), <code>||</code> ("or") and <code>!</code> ("not").</p>
      <h2>7. Repeating: while</h2>
      <p>A <b>while</b> loop repeats its body for as long as the condition holds. It is the only loop there is, and you rarely need it, because the game's long-running jobs (walking, harvesting) are done for you, outside your program.</p>
      ${example('while', 'Adds 1 to 5. A loop that never ends, or runs for too long, crashes the unit\'s program: the unit reboots and tries again.')}
      <h2>8. Jobs that take time: activities and outcomes</h2>
      <p>Some calls start a <b>job</b> that takes a while: <code>goTo</code>, <code>harvest</code>, <code>charge</code>, <code>build</code>. The call returns straight away, and the job runs without costing your program anything.
      When the job ends it ends in one of a few <b>outcomes</b> (<i>arrived</i>, <i>full</i>, <i>empty</i>, ...). Each outcome is an extra white exit on the node, and you attach what happens next to it:</p>
      ${example('arrive', 'The goTo node has an exit called <b>arrived</b>. The block wired to it runs when the walk ends, however long that took.')}
      <h2>The text form</h2>
      <p>Everything you see in the graph has a text version, and you can switch freely: the Code tab's <b>Graph / Split / Text</b> switch shows either or both, side by side. The text is a small, strict part of
      <b>TypeScript</b>, which is JavaScript with extra checks. You only need the handful of forms above, but if you want to learn more about the language it came from:</p>
      <ul>
        <li>${ext('https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide', 'The JavaScript Guide (MDN)')}: variables, conditions, loops and functions, explained slowly with examples.</li>
        <li>${ext('https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html', 'TypeScript in 5 minutes')} and the ${ext('https://www.typescriptlang.org/docs/handbook/intro.html', 'TypeScript Handbook')}.</li>
        <li>${ext('https://www.freecodecamp.org/learn', 'freeCodeCamp')}: free, hands-on lessons if you would like to learn programming properly.</li>
        <li>${ext('https://scratch.mit.edu/', 'Scratch')}: if blocks and wires are how you like to think, this is a gentle visual way to practise the same ideas.</li>
      </ul>
      <p class="note">What this game uses is deliberately much smaller than TypeScript: whole numbers only, no objects, arrays or your own functions, and one loop. The <a href="#/language">Language</a> page lists exactly what is allowed.</p>`,
  },

  {
    id: 'm-graph',
    title: 'The graph editor',
    render: () => `
      <h1>The graph editor</h1>
      <p>Open the Designer, choose a class, and on the <b>Code</b> tab press <b>Graph</b>. The editor draws the program as <b>nodes</b> (blocks) joined by <b>wires</b>.</p>
      <h2>Reading a graph</h2>
      ${graphOnly('recharge', 'A real program. Read it from the red event block on the left, following the white wires to the right.')}
      <ul>
        <li><b>White wires and triangle pins</b> are the <b>order things happen in</b>: "do this, then that". A node runs when the wire coming into its left triangle fires.</li>
        <li><b>Blue wires and round pins</b> carry <b>values</b>: a number, a handle for a unit, the result of a question. A node on the left of a wire provides a value to the node on its right.</li>
        <li>The <b>colour of the title</b> tells you the kind of node:
          <span style="color:#d36a76">■ red</span> an <b>event</b> that starts a chain;
          <span style="color:#e08a4a">■ orange</span> an <b>action</b>;
          <span style="color:#5a9be0">■ blue</span> a <b>query</b>;
          <span style="color:#3fb5ae">■ teal</span> a <b>runtime setting</b>;
          <span style="color:#8b7ac6">■ purple</span> <b>flow</b> (branch, loop, set a variable);
          <span style="color:#6fb06e">■ green</span> a <b>variable</b>;
          <span style="color:#9aa3b5">■ grey</span> <b>maths and logic</b>;
          <span style="color:#7d8fe0">■ indigo</span> a ready-made <b>block</b> card.</li>
        <li>The small <b>number badge</b> on a node, like <code>9c</code>, is its cost in CPU cycles each time it runs. The number on the event is the most it could ever cost (see <a href="#/cost">CPU cost &amp; memory</a>).</li>
        <li>Fields on a node are <b>settings</b> you can type in. A field beside an input pin is that input's default value, used when no wire is connected to it.</li>
      </ul>
      <h2>Editing</h2>
      <ol class="manual-steps">
        <li><b>Add a node</b> from the palette on the left. Open a group (Blocks, Events, Flow, Actions, Queries, ...) and click the node you want; it is added to the graph.</li>
        <li><b>Wire it.</b> Drag from an output pin to an input pin. White to white (order), blue to blue (value).</li>
        <li><b>Type values.</b> Click a field on a node and type; <b>constants</b> like <code>MOVE</code> or <code>ENEMY</code> are allowed anywhere a number is.</li>
        <li><b>Cut a wire</b> by double-clicking it. <b>Delete</b> removes selected nodes. <b>Undo</b> and <b>Redo</b> (${key('Ctrl')}+${key('Z')}, ${key('Ctrl')}+${key('Y')}) work on every edit.</li>
        <li>Press <b>Tidy</b> to lay everything out again, and <b>Fit</b> to zoom to see it all.</li>
        <li>Nodes that are not wired to an event are dashed and marked <i>loose</i>: they do nothing until you connect them.</li>
      </ol>
      <h2>Problems</h2>
      <p>A node with something wrong has a red outline and says what is wrong on the node. The status line below the editor lists all problems; fix them and press <b>Upload</b>.
      You can use <b>Test run</b> to try a design and program in a private sandbox before it goes live.</p>
      <h2>Starting from a template</h2>
      <p>The <b>Template</b> chooser in the graph toolbar replaces the program with a ready-made one made of blocks: Worker, Builder, Medic, Fighter, Turret, Storage or Factory. It asks first. This is the quickest way to give a new class something sensible to do,
      and a good starting point to learn from.</p>
      <h2>Graph or text?</h2>
      <p>Use whichever is easier for the task. The graph is best for seeing how events lead to actions and what a program costs; the text is best for typing something long, copying, and sharing. The <b>Split</b> mode shows both, and a change in one
      appears in the other at once. If the text has a syntax error, the graph keeps the last good version until you fix it.</p>`,
  },

  {
    id: 'm-recipes',
    title: 'Recipes',
    render: () => `
      <h1>Recipes</h1>
      <p>Small programs you can build, one idea each. In every one: make a class in the Designer (with a CPU, and the modules mentioned), open <b>Code &gt; Graph</b>, build the nodes shown
      (or switch to <b>Text</b> and paste the text under the picture), then press <b>Upload</b>. Units of the class change at once.</p>

      <h2>1. Say hello when built</h2>
      <p><i>Modules:</i> chassis, CPU.</p>
      ${example('hello', 'Spawned fires once when the unit is built (or reboots). Try changing the text, or the 2000 (milliseconds).')}

      <h2>2. Obey move orders</h2>
      <p><i>Modules:</i> chassis, CPU, a motor.</p>
      ${example('move', 'Without a block for Order, right-click does nothing: orders are only events. This is the smallest class that can be steered.')}
      <p>Next, make it say something when it gets there:</p>
      ${example('arrive', 'goTo has an <b>arrived</b> exit. Wire the alert to it.')}

      <h2>3. Count with a variable</h2>
      ${example('counter', 'Add the variable first, in the Variables list under the palette (or write <code>let beeps = 0;</code> in the text). The Set node assigns; the Get node reads.')}

      <h2>4. React to damage</h2>
      <p>Changes what it does depending on how healthy it is.</p>
      ${example('branch', 'hp() is a query: it asks how many hit points are left. The Branch chooses between the two alerts.')}

      <h2>5. Guard duty</h2>
      <p><i>Modules:</i> chassis, CPU, a motor, a short sensor, a gun.</p>
      ${example('guard', 'The Detected event <i>is</i> the sensor setup: watch for ENEMY within 6 tiles, sweeping every 5 ticks. Nothing runs while nothing is there, so a guard costs almost nothing.')}
      <p>A smarter version closes in on faraway enemies and shoots near ones:</p>
      ${example('chase', 'dist(h) is how far the thing is. approach(h, 4) walks to within 4 tiles of it, as a job running outside your program.')}

      <h2>6. Recharge when low, and carry on</h2>
      <p><i>Modules:</i> chassis, CPU, a motor. Needs a Charging Pad to go to.</p>
      ${example('recharge', 'suspendActivity() puts the current job aside; charge() walks to the pad; when the unit is charged, resumeActivity() picks the old job back up. This is exactly what the RechargeWhenLow block does for you.')}

      <h2>7. Use blocks instead</h2>
      <p>Everything above is what the ready-made blocks are made of. Mix them freely: blocks for the usual jobs, your own event blocks for anything special.</p>
      ${example('blocks', 'Three cards: the unit obeys orders, recharges below 25%, and harvests. Press Expand on a card to turn it into plain event blocks you can edit.')}
      <p>Blocks can tell your own blocks that something happened. <code>HarvestLoop</code> raises <code>Delivered</code> whenever it unloads at a silo:</p>
      ${example('own', 'The HarvestLoop card says <i>raises Delivered</i>. The event block below hooks it, with no wire: events connect by name.')}

      <h2>8. Give the player a button</h2>
      ${example('button', 'A Button event block <i>is</i> a button in the action grid when units of this class are selected, with the hotkey you choose.')}

      <h2>9. Talk to other units</h2>
      <p><i>Modules:</i> a radio (or a laser link) on every class that should talk.</p>
      ${example('radio', 'radioSend(channel, value) sends; Message blocks receive. Filter by channel with the setting so each message only wakes the units that care.')}

      ${tryIt('Combine 5 and 6: a guard that retreats to recharge. Then add a <b>Button</b> that makes it say how healthy it is. If it will not upload, the problems list tells you what is missing, usually a module the program needs.')}`,
  },

  {
    id: 'm-blocks',
    title: 'Block gallery',
    render: () => {
      const cards = BLOCKS.map((b) => {
        const g = graphOf(`use(${b.name});`);
        const settings = b.settings
          .map((s) => `<li><code>${s.name}</code> (default <code>${esc(configToText(b.name, s, undefined, FLOW_HOST) || "''")}</code>): ${esc(s.doc)}</li>`)
          .join('');
        return `<section><h3>${b.name}</h3>${g.html}<p>${esc(b.doc)}</p>
          ${settings ? `<p class="muted">Settings:</p><ul>${settings}</ul>` : '<p class="muted">No settings.</p>'}
          ${b.emits?.length ? `<p>Raises ${b.emits.map((e) => `<code>${e}</code>`).join(', ')}, which your own event blocks can hook.</p>` : ''}</section>`;
      }).join('');
      const harvest = parseText("use(HarvestLoop, { minMatter: 10 });", FLOW_HOST).doc;
      const expanded = printText(expandBlocks(harvest, FLOW_HOST), FLOW_HOST);
      return `
      <h1>Block gallery</h1>
      <p>A <b>block</b> is a named behaviour with settings. In the graph it is one indigo <b>card</b>; in text it is one line, <code>use(Name, { settings })</code>. The starter classes are made of nothing else.
      The picture of each block below is exactly what the graph editor draws, with default settings.</p>
      <ul>
        <li>Type the settings on the card. Settings you leave out use the default shown here.</li>
        <li>Each block can be used <b>once</b> per class.</li>
        <li>A block costs exactly what its inside costs, because it is nothing but a template (see below).</li>
        <li>Press <b>Expand</b> on a card to replace it with the plain event blocks it stands for, so you can change them. That is one way: you cannot fold it back.</li>
        <li>Some blocks <b>raise events</b> (listed on the card). Add an event block of the same name to react: see <a href="#/m-recipes">Recipes</a> #7.</li>
      </ul>
      <h2>Inside a block</h2>
      <p>This is what <code>use(HarvestLoop, { minMatter: 10 })</code> expands into. It is ordinary event blocks, variables and calls, written the way you would:</p>
      ${code(expanded)}
      <p>If a block is nearly right, expand it and change the part that is not. If it is exactly right, leave it as a card: it is shorter, easier to read and gets fixed in updates.</p>
      <h2>All the blocks</h2>
      <div class="block-gallery">${cards}</div>`;
    },
  },

  {
    id: 'm-help',
    title: 'When something goes wrong',
    render: () => `
      <h1>When something goes wrong</h1>
      <h2>My unit does nothing</h2>
      <ul>
        <li><b>No CPU or no program.</b> A class needs a CPU module and a program with a block for what you want. A unit with no block for an order ignores that order.</li>
        <li><b>No energy.</b> Flat units go grey and stop. Recharge them at a pad or supply them from another unit; make sure your power balance is positive.</li>
        <li><b>The module is missing.</b> A <code>Detected</code> block does nothing without a sensor; <code>fire</code> needs a weapon; <code>goTo</code> needs a motor; <code>radioSend</code> needs a radio.</li>
        <li><b>Out of cycles.</b> A slow CPU still runs the program, only later. Use a faster CPU, or make the program cheaper (<a href="#/cost">CPU cost &amp; memory</a>).</li>
      </ul>
      <h2>My unit turns red</h2>
      <p>Its program crashed: it divided by zero, or one block ran too long. The unit reboots a moment later and starts again from the beginning, with its variables reset.</p>
      <h2>The editor says there is a problem</h2>
      <table>
        <tr><th>You see</th><th>Usually means</th></tr>
        <tr><td><i>Unknown name 'x'</i></td><td>A typo, or a variable used without being declared with <code>let</code> at the top. Names of variables cannot be the same as built-in names like <code>hp</code>.</td></tr>
        <tr><td><i>Declare variables at the top</i></td><td><code>let</code> only works at the top of the program, outside any block. Inside a block, only <code>const</code> results exist.</td></tr>
        <tr><td><i>Button key 'Y' is taken</i></td><td>That hotkey is already used by a common action, or by another button. Choose another letter.</td></tr>
        <tr><td><i>Message has no setting 'x'</i></td><td>Each event has its own settings; the Events page lists them.</td></tr>
        <tr><td><i>needs N variables, the class has M</i></td><td>The program uses more memory than the memory modules provide; add a memory bank or use fewer variables.</td></tr>
        <tr><td>A red-outlined node</td><td>Click it: the message is on the node.</td></tr>
      </table>
      <h2>Glossary</h2>
      <table>
        <tr><td><b>Action</b></td><td>A call that makes something happen now (orange).</td></tr>
        <tr><td><b>Activity</b></td><td>A job that runs outside the program, such as walking or harvesting. It ends in an <b>outcome</b>.</td></tr>
        <tr><td><b>Block</b></td><td>A ready-made behaviour with settings: <code>use(HarvestLoop)</code>.</td></tr>
        <tr><td><b>Call</b></td><td>A name followed by brackets that asks the game to do or tell something.</td></tr>
        <tr><td><b>Class</b></td><td>A design (chassis + modules) with one program, shared by every unit or building made from it.</td></tr>
        <tr><td><b>Cycle</b></td><td>The unit of CPU work. A CPU has so many per tick.</td></tr>
        <tr><td><b>Event</b></td><td>Something that happens to a unit; event blocks react to it.</td></tr>
        <tr><td><b>Handle</b></td><td>A number that stands for a particular unit, building or field, returned by sensing calls.</td></tr>
        <tr><td><b>Module</b></td><td>A part bolted onto a chassis or frame that gives it an ability.</td></tr>
        <tr><td><b>Query</b></td><td>A call that gives back an answer and changes nothing (blue).</td></tr>
        <tr><td><b>Tick</b></td><td>One step of the simulation: ${TICK_RATE} per second.</td></tr>
        <tr><td><b>Tile</b></td><td>One square of the map; distances and positions are in tiles.</td></tr>
        <tr><td><b>Variable</b></td><td>A named memory slot holding a whole number.</td></tr>
      </table>
      <p>Still stuck? Look at what the starter classes do: open one in the Designer, then read its graph. The <a href="#/examples">Starter programs</a> page lists them all in text form.</p>`,
  },
];
