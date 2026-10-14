# Progress log

Changes to the codebase, grouped by day (newest first).

## 2026-10-14

### Docker deployment
- Added multi-stage images for the static Nginx client and the Node server with production-only dependencies; Compose publishes only the client port and health-checks the internal server.
- `/api/v1/rooms` and `/api/v1/ws` are reverse-proxied to the server, including WebSocket upgrades; Vite mirrors the same-origin proxy during development. Promoted `tsx` to a server runtime dependency and added `.dockerignore`.
- Validation: both images built; the versioned API returned 200 in Docker and Vite; the browser connected through the single published port and received a room invite link.
- Added a GitHub Actions workflow to build and push client/server image tags to GHCR on `main` and version-tag pushes.

### Selectable maps and silo dispatch
- Kept Crossroads and added Small Basin (48×48), Broken Country (72×72), Twin Ridges (80×56) and Highlands (96×80) with distinct deterministic terrain layouts. The lobby renders previews from each map's generated terrain and passes the selection into room creation; active rooms report their map and dimensions.
- The default Resource Silo now has compute/memory and sends visiting harvesters back to their last field, like the HQ.
- Tests: 82 pass. Browser-checked all five previews and map-specific room creation through the one-port Docker proxy.

### Sidebar header and resources
- Removed the duplicate matter amount/capacity readout from the header while retaining its internal value for production affordability.
- The header now shows the player's name and room on row one, then daylight, wind and net grid balance on row two. Matter and Energy resource bars now include matching symbols.
- CPU status in the map's top info bar now has a fixed 160px slot, so changing status text does not shift following stats. Client typecheck/build passed; browser-checked equal widths across status strings.

### Disconnect pause and resignation
- A server connection loss uses the existing pause modal while reconnecting. Disconnected players shown to the room have a live reconnect-timeout countdown.
- Added an explicit resignation message and server acknowledgment; resigning players are removed immediately instead of entering the reconnect grace period.
- Tests: 79 pass, including countdown updates and immediate resignation.

### Lobby rooms and invites
- Removed the implicit `main` room and hid rooms with no connected players. Creating a room without a name now generates a random room name.
- First-time players, including visitors following a direct invite, choose a name before joining. At game time zero, a waiting room's pause dialog offers a copyable invite link.
- Browser-checked name entry, unnamed room creation, zero-player filtering, direct invite naming and invite copying.

### Victory conditions
- A match ends (`matchOver`, now with a `reason`) once two sides have fielded forces, game time is non-zero and any of: every other side is eliminated (`eliminated`); every other player has left, including after the reconnect grace (`last-player`); only one player still has powered mobile units, i.e. non-zero energy (`no-power`).
- The winner's overlay offers "Quit as victor" (back to the lobby) or "Keep playing"; others get "Keep watching". Tests: 77.

### Game clock, pausing and room scores
- Player names are now entered in the lobby (default `anon` + 5 random digits, remembered in the browser) and sent when the game connects; the box in the game's side panel is gone.
- The server tracks game time (`Match.elapsedSeconds`, from the tick count, so it stops while paused). `GET /rooms` now also returns `elapsed`, `paused` and each player's name, score, connected and eliminated flags; the lobby shows "m:ss in" (or "not started"), "(paused)", and the scores per room.
- **Pausing**: the simulation only steps with at least two connected players and nobody away. Otherwise the server sends a `pause` message with the reasons ("Waiting for another player…", "<name> disconnected — waiting for them to come back") and the client shows a "Game paused" overlay; an empty list hides it. Commands still apply while paused, so a lone player's base is set up. A solo room therefore waits for an opponent.
- The reconnect grace period is now 60 s of wall-clock time (it was ticks, which would never elapse in a paused game).
- Tests: 74 (pause with one player, pause and resume on disconnect/reconnect, game time and roster).

### Lobby
- Opening the page without `?room=` shows a lobby: open rooms with player counts and full/finished state (refreshed every 3 s), a Join button each, `main` always offered, and a box to create a room (letters, digits, `-`, `_`). Joining reloads the page with `?room=name`; a **Resign and Quit** button at the bottom of the side panel (press twice within 3 s, like demolish) goes back (it only leaves; the base is held for the reconnect grace period). The side panel status shows the room name.
- The server now serves `GET /rooms` (JSON, CORS open) from the same port as the websocket.

### Rooms, reconnect, bandwidth and power losses
- **Rooms**: the server keeps one `Match` per room (`?room=name`, default `main`, at most 20), created on first use and closed a minute after it empties. A full or invalid room is refused with close code 1013.
- **Reconnect and resync**: each tab sends a token (`sessionStorage`). The client retries a dropped connection with backoff (`Connection`); the server keeps the player's base for 60 seconds (`RECONNECT_GRACE_TICKS`), and on reconnect resends welcome, blueprints, a full snapshot, the player's programs and task queues. After the grace period the player is removed as before. Players without a token are removed immediately.
- **Bandwidth**: entity ids, counts and event payloads are LEB128 varints; positions are sent as u16 at 1/64-tile precision (`wireShift` option on `defineComponent`).
- **Transmission losses**: each network loses `TRANSMISSION_LOSS_PER_TILE` (1%) of its generation per tile of total link gap, up to `MAX_TRANSMISSION_LOSS` (50%); touching buildings lose nothing (`PowerNetwork.linkTiles`).
- Tests: 71 (adds server tests for reconnect, grace expiry and match end, and a transmission loss test). The position replication tests now allow the wire precision.

### TODO sweep
- **Tests** for the newer rules (`test/rules.test.ts`): tesla stun and recharge, cannon matter use, building energy draw and the builder reserve, decay, the link tree with sites, scoreboard tallies, `queueUnit()`, storage discharge limit, merge-upload. 66 tests in all.
- **Tesla pulse**: a `Pulse` event draws an expanding ring the size of the coil's range.
- **Scoreboard names and match end**: players set a name (saved in the browser, sent as `setName`, sanitised and shortened by the server). Eliminated players (no units or buildings left after having had some) are struck through. When two sides have fielded forces and only one remains, the server sends `matchOver` once and the client shows a standings overlay ("Keep watching" dismisses it; the game keeps running).
- **Merge-upload**: the design upload dialog has a *Merge into mine* option that adds or updates only the classes in the file and leaves the player's other classes alone (`loadDesigns` takes a `merge` flag).
- **Program history** is kept in the browser (by class name and parts) and survives reloads.
- **Storage discharge** is limited to 2% of a building's capacity per tick (`STORAGE_DISCHARGE_FRACTION`).
- **Factory scripts** can queue units themselves: `unitClassCount()`, `queueUnit(i)` and `queueLength()`.
- Not done (see TODO): visual polish (needs play-testing), fog ghosts and the visibility optimisation, runtime script-driven buttons, named design sets, scripted sandbox scenarios, lobby/reconnect, transmission losses, bandwidth work, language features.
### Scoreboard and resource bars
- **Scoreboard** (top-right of the playfield): one row per present player (colour, name, yours in bold) with score, units/buildings made, lost and destroyed. Score = resources in the player's silos + the cost of every finished building and living unit. The server keeps per-player tallies (`Simulation.tallies`), credits kills to the owner of the last weapon that hit (`lastHitBy`), and broadcasts a `scoreboard` message every 5 ticks when it changes. Sites, demolition and disconnects don't count as losses or kills.
- **Resource bars** at the top of the side panel: Matter (silo pool / capacity) and Energy (stored / capacity across the player's power networks), shown only for resources the player has capacity for.

### Power links and construction
- Power links are now a **minimum spanning forest** (`powerLinks` in `game/power.ts`): shortest links that keep everything connected, so a building joins its nearest neighbours instead of everything in range, and re-routes when a link breaks. Unfinished sites hang off one finished building and never bridge others.
- **Construction costs energy**: `footprint² × BUILD_ENERGY_PER_TILE` (50), in proportion to matter invested. Supplied sites draw from their network; otherwise the builder pays and stops at `BUILDER_ENERGY_RESERVE` (25%). The default Builder script retreats to charge at 30%.
- Idle default builders pick up the nearest unfinished site (`nearestSite()` + `taskPush`).
- **Decay**: units with no energy for `DECAY_TICKS` (600) become a matter block worth their cost (`decaySystem`).
- Generators are far weaker: `SOLAR_PANEL_OUTPUT` 0.5, `WIND_TURBINE_OUTPUT` 1 per tick, stored in tenths (`GENERATION_SCALE`) with the fractional remainder carried per building.

### Weapons
- Weapon kinds (`WeaponKind`): light gun (free), cannon (3 matter per shot: from the cargo bay on vehicles, from the silos on buildings), **laser** (20 energy per shot) and **tesla coil** (stuns the CPU of every unit and building in range, friend or foe; slow recharge; on a vehicle it also stuns the vehicle at half duration). Tesla range, stun length, cooldown and self-stun factor are in `game/rules.ts`. New `Stunned` CPU state and tint.
- New starter class **Laser Turret**.
- Fixed: buildings never got a `Weapon` component, so no building could fire (they now get it when finished).

### Smaller changes
- Map camera allows a quarter-screen of overscroll past each edge.
- Move is only enabled for mobile units and factories (rally points); Stop is disabled for buildings.
- Tests: 52 (adds a laser turret regression test).

## 2026-10-13

### Power-flow dots follow the energy on each link
- The power system records, per network member, the energy it took from or gave to the network each tick (`PowerNetwork.flow`; sources negative, the values sum to zero).
- The owner's `networks` reports carry these as averages over the 5-tick report window.
- The client routes each building's draw back towards the givers along shortest paths, splitting evenly between equally close routes (`measureFlows` in `state.ts`), to get a load per link.
- Dots move faster for more energy (about 0.4 to 8 tiles/s, square-root scale) and disappear on links with nothing moving. Each link keeps its own dot position and eases between reports, so speed changes are smooth.
- Other players' links, which have no reports, keep the old fixed speed.
- Tests: 51 (adds flow accounting in the engine, and routing and speed in the client).

### Band selection priority and control groups
- A drag selection now takes your combat units (anything with a weapon that can move) if the band holds any, otherwise your combat buildings (turrets), otherwise everything of yours in the band.
- Control groups: Ctrl+1..9 saves the selection as a group, Shift+1..9 adds to it, 1..9 selects it, and pressing the number twice quickly centres the view on the group. Keys are read by physical key (`KeyboardEvent.code`), so they also work on the number pad and on AZERTY keyboards. Groups drop units as they die. The side panel shows a chip per group (number and size); clicking one selects the group.

### Saved designs: browser storage, download, upload, reset
- The player's classes (parts, programs, retired flags) are saved in the browser (`localStorage`) and restored automatically when they rejoin, on any server.
- Side panel footer: **Download designs** saves them as a JSON file (`wst-designs-<date>.json`), easy to edit with other tools. **Upload designs** loads one. **Reset designs to defaults…** is a secondary link. Upload and reset first show a summary (changed / added / brought back / retired) and ask for confirmation.
- Version drift: files record a fingerprint of the default classes they were saved against, and a per-class `base` hash. On restore or upload, each class is classified (`classifyDesigns` in `game/designs.ts`):
  - **Applied without asking:** unchanged defaults, the player's edits of the current defaults, and custom classes.
  - **Replaced by the new default:** untouched copies of an older default.
  - **Player asked to choose:** classes the player edited whose default has since changed (keep mine / use the new default, per class or all at once).
  - **Broken classes:** those that no longer build or compile fall back to the default of the same name, or are left out.
- Server: one `loadDesigns` message applies a whole set (`Simulation.loadDesigns`). Same parts means the program and retired flag are updated in place; new parts means a new class, with the old one retired. Own classes not in the set are retired, except defaults the file predates. The server replies with a `designsLoaded` report (added / updated / retired, per-class errors). The WebSocket message limit was raised to 1 MB to fit a full set.
- Tests: 47 (adds design file round-trip, classification, and loading/reset into a match).

### Selection sparklines
- With own units selected, the side panel lists each resource they have: health, energy, cargo, silos, build progress and CPU. Each row has a sparkline of the last 30 s and the current amount out of the maximum, totalled across a group. The client keeps a rolling history of every own entity (`ResourceHistory` in `client/src/resources.ts`, sampled every 2 ticks), so a fresh selection shows its recent trend straight away.
- Tests: 43 (adds sparkline drawing).

### Charging zones and placement link preview
- The areas where own units are charged are shaded faint green: a disc around each working charging building, with the same reach the server uses (`chargeZoneRadius` in `game/rules.ts`). Overlapping zones are flattened so they don't get darker. A charging building being placed previews its zone too.
- While placing a building, dashed lines run from the ghost to every own building its power links would connect to (the server's `gap`/reach rule, `ClientState.linksFor`). They are dimmed when the spot is blocked.

### Layout fix: map canvas covering the build bar
- The map canvas could overlap the build bar until the window was resized. Pixi only resized it on window resize, and the build bar grows after the class list arrives. The canvas is now taken out of the layout flow, clipped to the map area and resized by a `ResizeObserver`. The side panel and build bar stack above the map.

### Action buttons and selection info bar
- Sidebar **action grid** of square buttons. The common actions are always shown: Move (M), Attack (A), Stop (S), Harvest (H), Unload (D), Recharge (C) and Demolish (X). Each is disabled unless a selected unit has the modules for it, and only reaches the units that do. Aimed actions wait for a left-click on the map (Ctrl keeps aiming; right-click/Esc cancels). Attack on open ground is an attack-move.
- **Class buttons** declared in scripts: `button name "Label" [key "K"] [aim]`. The name becomes a constant, the task type (100, 101, …) pushed when the button is pressed. With several classes selected, every class's buttons show (merged by name), and each press reaches only the units whose class declares that button. The compiler checks for duplicates, reserved keys, label length and top-level placement. The editor highlights and completes button declarations, and a new docs guide page covers them.
- Starter scripts: fighters got a **Hold fire** toggle (F), and their ATTACK handling now does attack-move and chases targets out of their own sensor range to where they were. Energy storage got **Hold charge / Automatic** (K/U).
- Server: `command` (common action with a fixed task type, capability-checked, with nearest field/depot/pad filled in) and `button` messages (`Simulation.issueCommand`, `issueButton`).
- The **info bar** across the top of the map follows the selection when nothing is hovered: one unit or building shows its own stats (enemies: health only); several own units show totals (health, energy, cargo, silos, CPUs running, tasks) as "N selected units".

### Construction follow-ups
- **Demolish / cancel** (press X twice): sites refund everything invested; finished buildings refund 50% of their cost; a demolished silo's contents move to the other silos. Refunds go to the common pool.
- **Construction towers**: new `build.crane` module for buildings (6/tick, reaches 4 tiles from the edge), a `nearestSite()` builtin, and a starter **Construction Tower** class.

### Fog of war
- The server encodes each tick per client (`Interest` in `net/codec.ts`): only own entities, resource fields and whatever is within own vision (4 tiles for units, 6 for buildings, or the sensor range if further; `game/vision.ts`). Entities entering view are sent in full; leaving view, they are despawned on the client. Events are filtered the same way. `FOG=off` disables it.
- The client shades tiles out of view (lighter where explored before).

### Network inspection
- Owner-only `networks` reports (every 5 ticks, when changed): members, supply, demand, stored and capacity, and whether a silo is on the network. They are shown in the info bar (Grid, Grid store), in the selection details and as header totals; a selected building's network links are highlighted.

### Visual polish
- Health/energy bars scale with zoom and colour by health; damaged units show a health bar even when not selected. Power links scale with zoom and have round caps. With more than 6 units selected, shared route legs and waypoints are drawn once and each unit's first leg is drawn faint.

### Designer follow-ups
- Drag installed modules to reorder them (the frame stays first).
- **Retire / restore** classes: retired classes leave the build bar and production menus, can't be produced or placed, and don't count towards the class limit; existing units carry on.
- **Program history** (this session) with a picker to load an older version, and a **diff review** before every upload.
- **Sandbox test run** (`testRun` in `game/sandbox.ts`): runs the unsaved design and program for 10–60 s next to a copy of the starting base, optionally with an enemy scout and a move/attack order. It reports a sampled table plus notes on CPU use, distance, shots, faults, running flat and being destroyed.
- Tests: 41 (adds button compilation and commands, demolish/towers, retire, fog-of-war replication, sandbox, diff, button highlighting).
- Fixed a Windows encoding slip during editing: a non-UTF-8 dash in the compiler (repaired).

### Designer overlay and code editor
- Designing and coding moved out of the side panel into a full overlay over the running game (Designer button / F2; Esc closes): class list (units and buildings, with sprite icons), design panel (name, live preview drawn with the game's sprite art, stats, installed modules with indices, module catalogue grouped as unit bodies, building frames, compute, movement, sensors & weapons, industry, power), and the program editor.
- Existing classes keep fixed parts (every unit of a class shares them); their programs can be edited and uploaded, or the design copied as a new one. A new design is created on the server and its program uploaded automatically once the class arrives.
- Code editor: CodeMirror 6 with a language mode for the script language (keywords, builtins, constants, declared variables, numbers, comments), autocomplete for builtins (with arguments, cycle cost and docs) and constants, hover docs, and live diagnostics from the real compiler (syntax errors, unknown names, too many variables for the class's memory, no-CPU warning).
- The designer and CodeMirror load on first use (separate 372 kB chunk; the game bundle stays at 268 kB). Hotkeys are ignored while the designer is open.
- Dependencies: `@codemirror/*` and `@lezer/highlight` pinned to releases at least two weeks old, with root overrides (including `@lezer/lr` 1.4.10).
- Tests: 32 (adds editor highlighting).

### Hover bar
- Hovering an own unit or building shows one row along the top of the map: health, energy, then other resources (cargo, silos, construction, production, CPU, tasks), with the class name pinned to the far right.

### Energy transfer and CPU energy
- One transfer rule (`Simulation.transferEnergy`): the giver must hold at least the amount offered; reach depends on the giver's scale (units 1 tile, buildings 3 tiles from their edge). Charging pads use it automatically each tick; scripts use `giveEnergy(h, n)` and `energyOf(h)`.
- Reviving flat units: right-clicking an own unit below 25% energy queues a `SUPPLY` task; the starter scripts hand over 10% of their capacity per pass until it reaches 50%, never dropping below half themselves.
- CPU energy is billed per 100 cycles actually executed (`cpuDebt` accumulator); `yield` and `sleep()` are free (VM `freeCycles`, builtin `free` flag). Idle units now drain very slowly.

### Zoom, construction and resource silos
- Mouse-wheel zoom at the cursor; middle-drag or arrow keys pan; Home resets.
- Build bar under the map: one button per own building class (icon rendered from the game sprite, name, cost). Placement ghost with valid/blocked tint and link-reach outline; left-click places (Ctrl/Shift places several), right-click/Esc cancels; selected builders get a `BUILD` task.
- Construction sites block their footprint, start at 10% HP and do nothing until finished. Builders (`build.arm` module) invest up to their rate each tick: from cargo first, then the common pool if the site is linked by the grid to a silo (`siteSupplied`); remote sites need resources hauled (the starter Builder script does this with `take()`).
- Resources are physical: the common pool is the total held in a player's silos (`silo` module; the HQ has 2, the new Resource Silo building has 6). Docking fills only up to capacity, `take()` loads from a depot, production is paid from the pool, and a destroyed silo loses its contents.
- Animated power links: dots flow away from each network's generators (or its storage), computed client-side.
- `taskAck(i)`: fixes starter scripts mistaking an old URGENT order for a new one (which made units drop their own CHARGE tasks). `approach()` now tells crowd stops from unreachable goals.
- New starter classes: Builder (unit) and Resource Silo (building). Interaction ranges moved to `game/rules.ts`.
- Tests: 31 (construction supplied and remote, silo capacity and take, builders not sent harvesting, energy transfer rules, CPU billing, reviving flat units).

### Energy, terrain, pathing and API docs
- **Terrain** (`game/terrain.ts`): pass/no-pass grid, generated in one quadrant and mirrored; bases/fields kept clear and connected; building footprints block cells. Sent to clients once in `welcome`.
- **Pathfinding** (`game/path.ts`): deterministic A*, 8-way without corner cutting, string-pulled; falls back to the closest reachable cell. Ground units follow paths; flying units (new `rotor` part) fly straight and only land on passable, free cells.
- **Movement**: unit separation (ground/air separately, never into blocked cells), arrival detection for crowds, re-planning when jammed. `goTo`/`approach` handle "as close as possible".
- **Energy**: every unit/building has an energy store; per-module use costs (CPU per tick run, motor per tick moving, sensor per scan, weapon per shot, cargo per tick harvesting, factory per tick producing); brown-outs (`CpuState.NoPower`); `sleep(n)` builtin. Units recharge only at charging pads.
- **Power networks** (`game/power.ts`): buildings link edge-to-edge within reach (1 tile, or antenna 3/6/12); solar follows a day/night cycle, wind drifts; distribution to normal consumers, then to storage in charge mode; storage in discharge mode covers shortfalls (`storageMode()`, `netSupply/netDemand/netStored/netCapacity`).
- **Modules**: building frames (1×1/2×2/3×3; 8/16/31 slots), batteries, charger, solar, wind, antennas. Modules switch on/off (`setModule()` from scripts, or the player from the side panel); stats memoised per on/off mask (`statsFor`).
- **Starting base**: HQ, two charging pads, solar array, wind turbine, energy storage (battery banks + CPU), power pylon; plus a flying `Hawk` class. Starter scripts recharge below 25% and sleep when idle. Shared match setup in `game/map.ts` (four mirrored corners, max 4 players).
- **Owner-only task queues**: the server sends each player the full queues of their own units (`tasks` message); `TaskView` component removed (it leaked targets to opponents). The client routes paths through every queued task with the same A* and draws them.
- **Client**: tile-scaled rendering (buildings at footprint size), terrain, power links, energy bars, low-energy and no-power indicators, module toggles, sun/wind readout.
- **Docs**: `docs.html` — generated script API reference (per group, all functions, constants, parts, starter scripts) plus guides; opens as an overlay over the running game (Docs button / F1) or in a new tab. Test renders every page.
- Fixed: harvester script race (a pass spanning ticks could drop a task while carrying cargo).
- Tests: 24 (pathing, flying, separation, energy, networks, storage, modules, orders, economy, visits, determinism, replication, docs).

### RTS controls (task queues, buildings, economy)
- Every unit and building has a fixed-size task queue (`game/tasks.ts`): MOVE, ATTACK, HARVEST, DOCK, STOP. Player right-clicks are resolved server-side into the context task and appended (URGENT unless queued); class scripts decide priority.
- Buildings instruct units only while visiting (`nextVisitor()` / `order()`), on production or docking. Harvest loop and rally points built on this.
- Credits, production queues with cost/build time, structure frames with factory/depot parts, resource fields.
- Language: bitwise `&`/`|` and host constants (`MOVE`, `URGENT`, ...).
- Client: click and box selection, right-click context orders, Ctrl/Shift queueing (Firefox reserves Shift+right-click), S/Esc/control groups, waypoint lines, production panel, credits.
- Server: starting base (HQ, harvesters, scouts), order/stop/produce commands.

### Toolchain modernisation
- Node 24+, TypeScript 7, Vite 8, Vitest 5, @types/node 24; exact pins and npm `overrides`; `concurrently` replaced by `scripts/dev.mjs`; `verbatimModuleSyntax`, ES2024 target. `npm audit`: 0 vulnerabilities.

### Initial scaffold
- npm workspaces: `@wst/engine` (SoA ECS, metered bytecode VM + compiler, game rules, binary delta codec), `@wst/server` (authoritative `ws` match loop), `@wst/client` (PixiJS v8 renderer, editor UI).
- Flyweight blueprints (shared stats + program per class), deterministic simulation, per-tick binary deltas broadcast to all clients.
