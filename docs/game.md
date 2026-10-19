# Game design and engine

[← Back to the README](../README.md)

How the simulation works: classes, scripts, energy, construction and combat. Server-side match handling is in [server.md](server.md); the browser side is in [client.md](client.md).

## Flyweight: classes vs. units
- **Intrinsic (shared, per class):** a `Blueprint` holds the part ids, derived `BlueprintStats`, and the compiled `Program`. The part catalogue is code, so it is never transmitted. A blueprint goes over the wire once, as `{id, owner, name, parts}`, and clients re-derive stats from the shared catalogue.
- **Extrinsic (per unit):** a few typed-array fields (`Position`, `Unit{blueprint, owner}`, `Health`, …) plus a `VmState` (pc, stack, memory) that stays on the server.
- Uploading a new program swaps one reference on the blueprint, and every unit of that class reboots into it on the next tick.

## ECS
- `defineComponent(name, schema, {networked})` declares numeric fields. Each store keeps one typed array per field, indexed by entity.
- Systems write the arrays directly and call `store.markChanged(e)`. Only components marked `networked` are tracked and replicated; intents and cooldowns stay on the server.
- `EntityHandle` (generation + index) is what scripts hold, so a handle to a dead unit resolves to `-1` and never to whatever reused its slot.
- `GAME_COMPONENTS` order is the wire id. Only append to it.

## Compute as a resource
- Every instruction costs 1 cycle, and builtins add their own `cost` (sensing is expensive). A unit gets `cyclesPerTick` from its CPU parts.
- A program that runs out of budget **pauses and resumes next tick**, so a weak CPU runs the same code but reacts more slowly. An expensive call can overspend, and the unit pays the debt back over later ticks.
- Memory parts set how many variables a program may declare. A program that needs more is rejected for that class.
- Faults (division by zero, stack overflow) cost the unit one tick to reboot, and the client shows them as a red tint.

## Orders, task queues and scripts
- Every unit and building has a fixed-size `TaskQueue` (`game/tasks.ts`) of high-level tasks: `MOVE`, `ATTACK`, `HARVEST`, `DOCK`, `STOP`, `CHARGE`, `BUILD` and `SUPPLY`, each with x/y, a target handle and flags.
- **Right-click** is resolved on the server (`Simulation.issueOrder`) into the context task for each selected unit: an enemy means `ATTACK` (if it can fight), a resource means `HARVEST` (if it has a cargo bay), your own construction site means `BUILD` (if it has a build arm), your own depot means `DOCK`, your own charging pad means `CHARGE`, your own unit below 25% energy means `SUPPLY`, otherwise `MOVE`. With a building selected, a right-click queues a `MOVE` on the building, which its script treats as the rally point.
- Player tasks are always **appended** and flagged `FROM_PLAYER`. Unless the player holds Ctrl (or Shift, in browsers other than Firefox, which always opens its own menu on Shift + right click) they are also flagged `URGENT`. The script decides what that means: the starter classes drop their plan for an URGENT order, but a class could ignore it, finish its current job first, or refuse orders while in combat. Scripts read and edit their queue with `taskCount/taskType/taskX/taskY/taskTarget/taskFlags/taskDrop/taskFirst`, and acknowledge an order with `taskAck` so its URGENT flag isn't mistaken for a new order later.
- Each owner (and only the owner) is sent the full queues of their units whenever they change. The client routes a path through every queued task with the same A* the server uses, so no path data crosses the wire.

## Action buttons
- The side panel's action grid has the **common actions** (`game/actions.ts`: move, attack, stop, harvest, unload, recharge) plus Demolish. Each is enabled when at least one selected unit has the modules for it, and the server re-checks per unit (`Simulation.issueCommand`), so a mixed selection only commands the units that can comply.
- Class scripts declare their own buttons: `button boost "Overdrive" key "O"` (add `aim` for buttons that take a map target). The name becomes a compile-time constant, the task type pushed when the button is pressed (`CUSTOM_TASK_BASE` + index), so the script handles it like any task: `if taskType(0) == boost { ... }`. The client compiles the owner's program sources itself to learn the buttons, so no extra metadata crosses the wire.
- A button press is still only a task: the script decides what it does.

## Buildings talk to units only while they visit
- A unit **visits** a building when it is produced there or docks there (`dock()`). The building's script takes visits one at a time with `nextVisitor()` (which returns `PRODUCED` or `DOCKED`), can inspect the visitor (`visitorCaps()`, `visitorLastHarvest()`), and gives it tasks with `order(type, x, y, target)`.
- The link lasts until the next `nextVisitor()` call or the end of the building's current pass, whichever comes first. `order()` only ever targets the current visitor, so storing a unit's handle gives a building no lasting control over it.
- The harvest loop is built from this: the HQ sends a new harvester to a field, the harvester's script gathers until full and docks, and docking hands it back to the HQ's script for the next job. A factory script can also queue units itself with `unitClassCount()`, `queueUnit(i)` and `queueLength()`.

## Terrain and movement
- `Terrain` (`game/terrain.ts`) is a pass/no-pass grid generated in one quadrant and mirrored, so every corner is equally fair. Building footprints block cells too.
- Ground units follow A* paths (`game/path.ts`: 8-way, no corner cutting, string-pulled). Flying units (rotor) go straight and only land on passable, free cells.
- Units push apart each tick (ground and air separately). Crowded arrivals count as "arrived", and jammed units re-plan.

## Energy, modules and power
- Every unit and building stores energy (chassis buffer + batteries). Modules use energy when used: the CPU per 100 cycles actually executed (`yield` and `sleep()` are free), motors per tick moving, sensors per scan, weapons per shot, cargo bays per tick harvesting, build arms per tick building, factories per tick producing. Without energy the action doesn't happen.
- Energy moves by **transfer** (`Simulation.transferEnergy`), with one rule: the giver must hold at least the amount offered, and reach depends on the giver's scale (units 1 tile; buildings 3 tiles from their edge). **Charging pads** are buildings that transfer to nearby own units automatically every tick; scripts use `giveEnergy()`. The starter scripts push a `CHARGE` task below 25%, and a `SUPPLY` order sends a healthy unit to revive a flat one.
- Buildings link into **power networks** (`game/power.ts`) when their edges are within reach: 1 tile by default, more with energy antenna modules (3/6/12). Only the shortest links that keep a network connected are kept (a minimum spanning forest), so links re-route when a building is lost; links up to 1 tile are uncapped, but a longer antenna link carries at most `ANTENNA_THROUGHPUT_PER_TILE` (`rules.ts`) per tick per antenna times the host building's footprint, shared by everything crossing it, in total over both directions (`routeEnergy` in `power.ts`; the clusters, bridges and routes are built once per rebuild by `powerTopology`; because the links are a spanning forest the bridges form a tree, and a cluster is served its proportional share first, then takes any energy still idle from its own cluster and the nearest others); unfinished construction sites hang off one finished building and never bridge others. Each tick, solar (day/night cycle) and wind (drifting) generation (deliberately small: `SOLAR_PANEL_OUTPUT`, `WIND_TURBINE_OUTPUT` in `game/parts.ts`) goes first to normal buildings, then to storage in `CHARGE_STORE` mode. Storage in `DISCHARGE` mode covers shortfalls (at most 2% of its capacity per tick, `STORAGE_DISCHARGE_FRACTION`). Storage buildings choose their mode in script. Each owner is sent their networks' totals (`networks` message), shown in the info bar and header, with the selected building's network highlighted. The report also gives the energy each building took from or gave to its network. The client routes that back to the sources to find the load on each link, and the dots moving along a link go faster the more energy it carries.
- Modules can be switched on/off per unit (`setModule()` from scripts, or from the side panel). Stats for each on/off mask are derived once and shared by every unit with that mask (`statsFor`), so the flyweight survives per-unit switches.

## Resources, production and construction
- Resources are physical: they live in buildings with **silo** modules, and a player's **common pool** is the total across all their silos. Silos fill up, and a destroyed silo loses its contents. `dock()` fills a depot (as much as fits); `take()` loads from one back into a cargo bay.
- A class costs `10 × mass + cycles`, and its build time scales with mass. Buildings with a `factory` part have a production queue; the cost is paid from the pool when an item is queued.
- New buildings are placed from the **build bar** as construction sites. Builders (units with a `build.arm` module) invest resources each tick: from their own cargo first, then from the common pool, but only if the site is linked by the power grid to a silo. Remote sites need resources carried to them (the starter Builder script hauls them automatically) or a chain of pylons. Buildings with a `build.crane` (the starter Construction Tower) build sites within 4 tiles.
- **Demolish** (X, pressed twice) cancels a site with a full refund, or knocks down a building for half its cost. Classes can be **retired** in the designer so they can no longer be produced or placed.
- Building frames (1×1, 2×2, 3×3 with 8/16/31 slots) are immobile and are the only frames that can carry factory, silo, charger, generator, battery-bank and antenna modules.
- **Building costs energy** as well as matter: `footprint² × 50`, in proportion to the matter invested (`game/rules.ts`). A site linked to a silo's network draws it from that network; otherwise the builder pays, and stops at 25% of its capacity so it can retreat to a charger (the default Builder script goes at 30%). Idle default builders pick up the nearest unfinished site.
- **Decay:** a unit with no energy for 60 seconds (`DECAY_TICKS`) breaks down into a matter block worth its cost. Charging or supplying it first resets the countdown.

## Weapons
- Each weapon kind pays differently (`game/parts.ts`): the **light gun** is free, the **cannon** uses matter (from the cargo bay on a vehicle, from the silos on a building), and the **laser** uses a lot of energy per shot (its damage scales with the energy spent, which a script can set with `laserPower(energy)`; 8 damage at the full 20). The **tesla coil** stuns the CPU of every unit and building around it, friend or foe, then recharges slowly; on a vehicle it stuns the vehicle too, for half as long. Tesla range, stun length and cooldown are constants in `game/rules.ts`.
- Buildings can carry weapons (the starter **Laser Turret**); a building's weapon is activated when construction finishes.

## Saved designs
- A design file (`game/designs.ts`) is plain JSON: `{format, version, build, savedAt, classes: [{name, parts, program, retired, base}]}`. `build` fingerprints the default class set, and `base` is the hash of the default a class was saved against. Together they separate "the player edited this default" from "the default changed upstream since".
- The client autosaves the player's classes to `localStorage` and restores them on join; downloads and uploads use the same format. The server applies a whole set with one `loadDesigns` message (`Simulation.loadDesigns`). Classes are matched by name: same parts means the program is updated in place; different parts means a new class, with the old one retired. Units already built keep their class.

## Radar
- The `radar.pulse` module (slot `radar`, `M_RADAR`, capability `HAS_RADAR`) is a one-shot scan, not a continuous one. A script calls `radarPulse(energy)`: it spends that energy (capped by the module's `radarMaxEnergy`), range is `RADAR_ENERGY_PER_TILE` energy per tile, and the module rests `RADAR_COOLDOWN_TICKS` afterwards (`radarCooldown()`). It returns the contact count, or -1 on failure.
- Contacts (every non-allied unit and building in range) are not entities: `Simulation.radarPulse` records a `RadarPulse`, the server sends it to the owner and allies as a `radar` message, and the client draws fading blips (`RADAR_FADE_TICKS`) above the fog. Pulses are cleared in `commit()`.

## Co-op bots
- Single-player and co-op matches add bots (`game/bot.ts`). A bot owns a fortified base of assemblers and turrets and never mines (`Simulation.cheaters` keeps its energy and silos full).
- Bots build **waves on demand**: only as many units as the next wave needs, then they wait. A wave leaves once it is both fully staged and due; the first wave is `BOT_WAVE_BASE_SIZE` units and each later wave adds `BOT_WAVE_GROWTH`, with at least `BOT_WAVE_INTERVAL_TICKS` between waves. Survivors that finish a push press on to the next target. All constants are in `game/rules.ts`.

## Language quick reference

```
var target = -1            # memory slot, initial value applied once at boot
target = scan()            # nearest enemy handle, or -1
if target >= 0 && fire(target) == 0 {
  moveTo(posx(target), posy(target))
} else if moving() == 0 {
  move(rand(11) - 5, rand(11) - 5)
}
while cond { ... }
yield                      # end this tick here
button boost "Boost" key "B"   # a player UI button; `boost` is its task type
```

32-bit integers only. Operators, loosest first: `||`, `&&`, `== !=`, `< <= > >=`, `|`, `&`, `+ -`, `* / %`, unary `- !`. `&&` and `||` short-circuit, and `|`/`&` are bitwise and bind tighter than comparisons (as in Python), so `taskFlags(0) & URGENT` works without brackets. Game constants (`MOVE`, `URGENT`, `CAN_HARVEST`, ...) are built in. Reaching the end of the program ends the tick and restarts from the top. The full builtin list is `UNIT_API` in `packages/engine/src/game/api.ts`, documented in the in-game docs.
