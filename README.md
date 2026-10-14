# WebStrategyThing

A browser RTS where the player gives the orders and **scripts decide the behaviour**. You select units and right-click as in StarCraft or Total Annihilation, but each order only lands in the unit's **task queue**: the program written for that unit's **class** decides how (and whether) to carry it out. Units and buildings are designed from the same modules: compute (cycles per tick), memory, sensors, motors, batteries, generators and more. Every module costs energy to use, units recharge at charging pads (or from each other), buildings share power through automatically linked networks, and resources live in silos that builders draw on to construct new buildings.

## Running

Requires Node 24+ (see `.nvmrc`) and npm 11.

```sh
npm install
npm run dev        # client on http://localhost:5173; /api/v1/* proxies to the server on port 8080
npm test           # engine + client tests (VM, pathing, energy, construction, orders, buttons, fog, sandbox,
                   # design files, docs, diff, sparklines, turrets)
npm run typecheck
```

Open the client in two browser tabs to see two players (up to four, one per corner). Each starts with a powered base (HQ, charging pads, solar array, wind turbine, energy storage, power pylon), two harvesters, two scouts and a builder. Open **Controls** in the side panel for the key bindings. A drag selects your combat units first, then your turrets, then anything else; Ctrl+1..9 saves **control groups**, 1..9 recalls them (twice to centre the view), and Shift+1..9 adds to one. Other controls: the mouse wheel zooms, middle-drag pans, the **build bar** under the map places buildings, and the **action grid** in the side panel holds the common commands (move, attack, stop, harvest, unload, recharge, demolish) plus any buttons your class scripts declare. The bar along the top of the map shows the stats of whatever is under the cursor, or of the selection (totals for several units), and the side panel lists the selection's resources with sparklines of the last 30 seconds. Faint green areas show where your units recharge, and placing a building previews its power links as dashed lines. The top of the side panel shows **resource bars** (matter in your silos, energy stored in your power networks), and a **scoreboard** at the top right of the map lists every present player (set your name in the lobby; the default is `anon` plus five random digits) with their score (silo contents plus the cost of everything they own) and units/buildings made, lost and destroyed. When only one side has anything left, a final standings screen appears. The map is under **fog of war**: you only see (and the server only sends) what your units and buildings can see. Start the server with `FOG=off` to see everything.

Classes are designed and programmed in the **Designer** (button or F2): an overlay over the running game with a live preview, a module catalogue grouped by category (drag installed modules to reorder them), and a CodeMirror editor that highlights the script language, completes builtins and constants, shows their docs on hover, and runs the real compiler as you type. Uploads show a diff first, earlier versions can be reloaded from the history picker, classes can be retired, and **Test run** tries the unsaved design in a private sandbox simulation in the browser.

Your designs and scripts are **saved in the browser** and restored whenever you rejoin. The buttons at the bottom of the side panel **download** them as a JSON file, **upload** a file (replacing your designs, or merging its classes into them), or **reset** everything to the defaults; upload and reset show what will change and ask first. If a new build changes a default class you had edited, you're asked whether to keep your version or take the new default.

The **script API docs** open with the Docs button (or F1) as an overlay while the game keeps running, or in a new tab at `/docs.html`. They are generated from the engine's own metadata, so they always match the build.

## Docker

Requires Docker with Compose.

```sh
docker compose up --build
```

Open `http://localhost:8081`. Compose publishes only the client port; its Nginx forwards `/api/v1/*` to the private game server, including WebSocket upgrades at `/api/v1/ws`. The room-list endpoint is `/api/v1/rooms`. For `nginx-proxy`, route the host to the client container on port 80. Set `CLIENT_PORT` to change the local published port. The client derives HTTP and WebSocket endpoints from the current origin, using `wss` on HTTPS. Set `VITE_SERVER_URL` only when the WebSocket endpoint is hosted elsewhere; it must include `/api/v1/ws`. Set `FOG=off` to disable fog of war.

```sh
docker compose down
```

The `Publish Docker images` GitHub Action runs tests and typechecking on pull requests, then publishes the Dockerfile's two targets to GHCR on pushes to `main` and `v*` tags. The images are `ghcr.io/<owner>/<repo>-client` and `ghcr.io/<owner>/<repo>-server`; each gets branch/tag and short-SHA tags, and `latest` is updated from the default branch. The client and server images must run on the same Docker network so the client Nginx proxy can reach the server at `server:8080`.

## Stack

| Concern    | Choice | Why |
|------------|--------|-----|
| Rendering  | **PixiJS v8** (WebGL/WebGPU 2D) | Fast sprite batching, TypeScript-first, and only a renderer. The simulation must run headless on the server, so a full engine (Phaser and similar) would give us little we could use. |
| Simulation | Custom SoA ECS in TypeScript (`@wst/engine`) | Runs the same code on Node and in the browser, uses no per-entity objects, and its schemas double as the wire format. |
| Unit code  | Custom bytecode VM + tiny language | Exact, deterministic cycle metering, so compute is a game resource. Programs are shared per class (flyweight). |
| Transport  | `ws` (server) / native WebSocket (client) | Binary frames for tick deltas, JSON text frames for rare control messages. |
| Code editor | CodeMirror 6 | Modular and TypeScript-native; a small custom language mode plus autocomplete, hover docs and lint driven by the game's own compiler. |
| Tooling    | npm workspaces, Vite, tsx, Vitest | |

## Layout

```
packages/
  engine/   headless, deterministic core shared by server + client
    ecs/      component schemas, SoA stores, World (entities, handles, queries, change tracking)
    vm/       compiler (source -> bytecode), VM (metered interpreter), Program/HostApi types
    game/     parts, blueprints, components, terrain + A*, power networks, unit API, action buttons,
              vision, systems, map setup, Simulation, designer sandbox, design files
    net/      binary tick codec, JSON protocol + validation
  server/   authoritative match loop: command queue -> step -> broadcast delta
  client/   mirror World + PixiJS renderer + DOM play UI (action grid, info bar, fog, charging zones,
            selection sparklines, saved designs); designer overlay
            with a CodeMirror script editor, upload diffs and sandbox test runs (loaded on demand);
            docs.html = generated script API docs
```

## Key design decisions

### Flyweight: classes vs. units
- **Intrinsic (shared, per class):** a `Blueprint` holds the part ids, derived `BlueprintStats`, and the compiled `Program`. The part catalogue is code, so it is never transmitted. A blueprint goes over the wire once, as `{id, owner, name, parts}`, and clients re-derive stats from the shared catalogue.
- **Extrinsic (per unit):** a few typed-array fields (`Position`, `Unit{blueprint, owner}`, `Health`, …) plus a `VmState` (pc, stack, memory) that stays on the server.
- Uploading a new program swaps one reference on the blueprint, and every unit of that class reboots into it on the next tick.

### ECS
- `defineComponent(name, schema, {networked})` declares numeric fields. Each store keeps one typed array per field, indexed by entity.
- Systems write the arrays directly and call `store.markChanged(e)`. Only components marked `networked` are tracked and replicated; intents and cooldowns stay on the server.
- `EntityHandle` (generation + index) is what scripts hold, so a handle to a dead unit resolves to `-1` and never to whatever reused its slot.
- `GAME_COMPONENTS` order is the wire id. Only append to it.

### Compute as a resource
- Every instruction costs 1 cycle, and builtins add their own `cost` (sensing is expensive). A unit gets `cyclesPerTick` from its CPU parts.
- A program that runs out of budget **pauses and resumes next tick**, so a weak CPU runs the same code but reacts more slowly. An expensive call can overspend, and the unit pays the debt back over later ticks.
- Memory parts set how many variables a program may declare. A program that needs more is rejected for that class.
- Faults (division by zero, stack overflow) cost the unit one tick to reboot, and the client shows them as a red tint.

### Orders, task queues and scripts
- Every unit and building has a fixed-size `TaskQueue` (`game/tasks.ts`) of high-level tasks: `MOVE`, `ATTACK`, `HARVEST`, `DOCK`, `STOP`, `CHARGE`, `BUILD` and `SUPPLY`, each with x/y, a target handle and flags.
- **Right-click** is resolved on the server (`Simulation.issueOrder`) into the context task for each selected unit: an enemy means `ATTACK` (if it can fight), a resource means `HARVEST` (if it has a cargo bay), your own construction site means `BUILD` (if it has a build arm), your own depot means `DOCK`, your own charging pad means `CHARGE`, your own unit below 25% energy means `SUPPLY`, otherwise `MOVE`. With a building selected, a right-click queues a `MOVE` on the building, which its script treats as the rally point.
- Player tasks are always **appended** and flagged `FROM_PLAYER`. Unless the player holds Ctrl (or Shift, in browsers other than Firefox, which always opens its own menu on Shift + right click) they are also flagged `URGENT`. The script decides what that means: the starter classes drop their plan for an URGENT order, but a class could ignore it, finish its current job first, or refuse orders while in combat. Scripts read and edit their queue with `taskCount/taskType/taskX/taskY/taskTarget/taskFlags/taskDrop/taskFirst`, and acknowledge an order with `taskAck` so its URGENT flag isn't mistaken for a new order later.
- Each owner (and only the owner) is sent the full queues of their units whenever they change. The client routes a path through every queued task with the same A* the server uses, so no path data crosses the wire.

### Action buttons
- The side panel's action grid has the **common actions** (`game/actions.ts`: move, attack, stop, harvest, unload, recharge) plus Demolish. Each is enabled when at least one selected unit has the modules for it, and the server re-checks per unit (`Simulation.issueCommand`), so a mixed selection only commands the units that can comply.
- Class scripts declare their own buttons: `button boost "Overdrive" key "O"` (add `aim` for buttons that take a map target). The name becomes a compile-time constant, the task type pushed when the button is pressed (`CUSTOM_TASK_BASE` + index), so the script handles it like any task: `if taskType(0) == boost { ... }`. The client compiles the owner's program sources itself to learn the buttons, so no extra metadata crosses the wire.
- A button press is still only a task: the script decides what it does.

### Buildings talk to units only while they visit
- A unit **visits** a building when it is produced there or docks there (`dock()`). The building's script takes visits one at a time with `nextVisitor()` (which returns `PRODUCED` or `DOCKED`), can inspect the visitor (`visitorCaps()`, `visitorLastHarvest()`), and gives it tasks with `order(type, x, y, target)`.
- The link lasts until the next `nextVisitor()` call or the end of the building's current pass, whichever comes first. `order()` only ever targets the current visitor, so storing a unit's handle gives a building no lasting control over it.
- The harvest loop is built from this: the HQ sends a new harvester to a field, the harvester's script gathers until full and docks, and docking hands it back to the HQ's script for the next job. A factory script can also queue units itself with `unitClassCount()`, `queueUnit(i)` and `queueLength()`.

### Terrain and movement
- `Terrain` (`game/terrain.ts`) is a pass/no-pass grid generated in one quadrant and mirrored, so every corner is equally fair. Building footprints block cells too.
- Ground units follow A* paths (`game/path.ts`: 8-way, no corner cutting, string-pulled). Flying units (rotor) go straight and only land on passable, free cells.
- Units push apart each tick (ground and air separately). Crowded arrivals count as "arrived", and jammed units re-plan.

### Energy, modules and power
- Every unit and building stores energy (chassis buffer + batteries). Modules use energy when used: the CPU per 100 cycles actually executed (`yield` and `sleep()` are free), motors per tick moving, sensors per scan, weapons per shot, cargo bays per tick harvesting, build arms per tick building, factories per tick producing. Without energy the action doesn't happen.
- Energy moves by **transfer** (`Simulation.transferEnergy`), with one rule: the giver must hold at least the amount offered, and reach depends on the giver's scale (units 1 tile; buildings 3 tiles from their edge). **Charging pads** are buildings that transfer to nearby own units automatically every tick; scripts use `giveEnergy()`. The starter scripts push a `CHARGE` task below 25%, and a `SUPPLY` order sends a healthy unit to revive a flat one.
- Buildings link into **power networks** (`game/power.ts`) when their edges are within reach: 1 tile by default, more with energy antenna modules (3/6/12). Only the shortest links that keep a network connected are kept (a minimum spanning forest), so links re-route when a building is lost; unfinished construction sites hang off one finished building and never bridge others. Each tick, solar (day/night cycle) and wind (drifting) generation (deliberately small: `SOLAR_PANEL_OUTPUT`, `WIND_TURBINE_OUTPUT` in `game/parts.ts`) goes first to normal buildings, then to storage in `CHARGE_STORE` mode. Storage in `DISCHARGE` mode covers shortfalls (at most 2% of its capacity per tick, `STORAGE_DISCHARGE_FRACTION`). Storage buildings choose their mode in script. Each owner is sent their networks' totals (`networks` message), shown in the info bar and header, with the selected building's network highlighted. The report also gives the energy each building took from or gave to its network. The client routes that back to the sources to find the load on each link, and the dots moving along a link go faster the more energy it carries.
- Modules can be switched on/off per unit (`setModule()` from scripts, or from the side panel). Stats for each on/off mask are derived once and shared by every unit with that mask (`statsFor`), so the flyweight survives per-unit switches.

### Resources, production and construction
- Resources are physical: they live in buildings with **silo** modules, and a player's **common pool** is the total across all their silos. Silos fill up, and a destroyed silo loses its contents. `dock()` fills a depot (as much as fits); `take()` loads from one back into a cargo bay.
- A class costs `10 × mass + cycles`, and its build time scales with mass. Buildings with a `factory` part have a production queue; the cost is paid from the pool when an item is queued.
- New buildings are placed from the **build bar** as construction sites. Builders (units with a `build.arm` module) invest resources each tick: from their own cargo first, then from the common pool, but only if the site is linked by the power grid to a silo. Remote sites need resources carried to them (the starter Builder script hauls them automatically) or a chain of pylons. Buildings with a `build.crane` (the starter Construction Tower) build sites within 4 tiles.
- **Demolish** (X, pressed twice) cancels a site with a full refund, or knocks down a building for half its cost. Classes can be **retired** in the designer so they can no longer be produced or placed.
- Building frames (1×1, 2×2, 3×3 with 8/16/31 slots) are immobile and are the only frames that can carry factory, silo, charger, generator, battery-bank and antenna modules.
- **Building costs energy** as well as matter: `footprint² × 50`, in proportion to the matter invested (`game/rules.ts`). A site linked to a silo's network draws it from that network; otherwise the builder pays, and stops at 25% of its capacity so it can retreat to a charger (the default Builder script goes at 30%). Idle default builders pick up the nearest unfinished site.
- **Decay:** a unit with no energy for 60 seconds (`DECAY_TICKS`) breaks down into a matter block worth its cost. Charging or supplying it first resets the countdown.

### Weapons
- Each weapon kind pays differently (`game/parts.ts`): the **light gun** is free, the **cannon** uses matter (from the cargo bay on a vehicle, from the silos on a building), and the **laser** uses a lot of energy per shot. The **tesla coil** stuns the CPU of every unit and building around it, friend or foe, then recharges slowly; on a vehicle it stuns the vehicle too, for half as long. Tesla range, stun length and cooldown are constants in `game/rules.ts`.
- Buildings can carry weapons (the starter **Laser Turret**); a building's weapon is activated when construction finishes.

### Saved designs
- A design file (`game/designs.ts`) is plain JSON: `{format, version, build, savedAt, classes: [{name, parts, program, retired, base}]}`. `build` fingerprints the default class set, and `base` is the hash of the default a class was saved against. Together they separate "the player edited this default" from "the default changed upstream since".
- The client autosaves the player's classes to `localStorage` and restores them on join; downloads and uploads use the same format. The server applies a whole set with one `loadDesigns` message (`Simulation.loadDesigns`). Classes are matched by name: same parts means the program is updated in place; different parts means a new class, with the old one retired. Units already built keep their class.

### Networking
- The **server is authoritative** and runs all scripts, so opponents never receive your code and clients can't cheat by editing it.
- Each tick the server encodes a binary delta (despawns, component removals, changed networked fields, transient events); entity ids and counts are varints, and positions travel as u16 at 1/64-tile precision (`wireShift` on the component). A joining client gets a full snapshot first.
- **Rooms:** each room is its own `Match`, created on first use and closed a minute after it empties. A client picks one with `?room=name&map=map-id`; opening the page without a room shows the **lobby**, with open rooms and a new-game form offering five maps with terrain previews. The room list is served at `GET /api/v1/rooms`; WebSockets use `/api/v1/ws`. The maps are Crossroads (64×64), Small Basin (48×48), Broken Country (72×72), Twin Ridges (80×56) and Highlands (96×80). The **Resign and Quit** button at the bottom of the side panel (press twice, like demolish) leaves the match and returns to the lobby (up to 20 rooms). **Reconnecting:** each tab sends a per-tab token (`sessionStorage`); if the connection drops the client retries with backoff, and the server keeps the player's base for 60 seconds and, on reconnect, resends the welcome, a full snapshot, class programs and task queues. Players without a token are removed immediately. **Pausing:** a match only runs with at least two connected players and nobody missing; otherwise the server stops stepping the simulation (orders and base set-up still apply) and clients show a "Game paused" overlay listing the reasons (waiting for another player, or a named player disconnected). The reconnect grace period is measured in wall-clock time, so a paused game can't wait forever. The game clock only counts unpaused time, and the lobby shows it per room, along with each player's score and whether they are away or out, so it's clear which games are already well under way.
- **Fog of war** (`game/vision.ts`, `Interest` in `net/codec.ts`): each client's delta is filtered to its own entities, resource fields and anything within its vision. Entities entering view are sent in full and entities leaving view are despawned on the client, so hidden positions, health and module switches never leave the server. With `FOG=off`, one shared buffer goes to everyone.
- All client input is queued and applied at tick boundaries. With a seeded RNG, integer positions and deterministic iteration order, **seed + command log reproduces a match exactly**: the basis for replays (and verified by a test).

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

## Extension points / next steps

- **Fog follow-ups:** remembered enemy buildings in explored areas, and a spatial-grid visibility pass if unit counts grow.
- **Script-driven buttons:** let scripts enable, disable or relabel their buttons at runtime.
- **Design sets:** several named loadouts per browser.
- **Scaling the sim:** cached or archetype queries in `World.query`, and moving each match into a `worker_thread`.
- **Language:** `break`/`continue`, user functions, and per-unit messaging (`send(handle, value)`) as builtins with costs.
- **Bandwidth:** per-field dirty masks if components grow wide.
- **Reconnect:** a client that has been away longer than the grace period joins as a new player; a manual "rejoin" could be offered instead.
