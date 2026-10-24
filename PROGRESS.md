# Progress log

Changes to the codebase, grouped by day (newest first).

## 2026-10-24 (dev tools compiled out of production builds)

- **Checked**, then tightened. Before: the client panels (Dev Options, Dev Rooms), the Campaigns menu and a `window.__wstGraph` debug hook were gated on Vite's `import.meta.env.DEV` (false in any `vite build`), so a Docker build already dropped them, but nothing tied that to the `WST_DEV_TOOLS` variable. Now they are gated on one compile-time constant, `__WST_DEV_TOOLS__` (`vite.config.ts` defines it from `WST_DEV_TOOLS=1` at build time; declared in `client/src/globals.d.ts`), so they exist in a client only when it was built with that variable (`scripts/dev.mjs` sets it for `npm run dev`; running `npm run dev -w @wst/client` alone no longer shows them).
- **Verified with real builds**: with the variable unset, no file in `packages/client/dist` contains `dev-panel`, `Dev Options`, `Dev Rooms`, `__wstGraph` or the example room names, and there are no dev chunks; with `WST_DEV_TOOLS=1` they are present and `devTools-*.js` / `lobbyDevTools-*.js` chunks appear. The Dockerfile's client stage now sets `WST_DEV_TOOLS=0` and fails the build if those strings are found in the bundle. The dev styles in `style.css` are still shipped (inert rules for elements that never exist).
- **Server**: it runs from TypeScript source (no compile step), so the developer-command code is in the image but unreachable: `devToolsEnabled()` (`server/src/devTools.ts`) is true only with `WST_DEV_TOOLS=1` and never under `NODE_ENV=production`, which the server image sets, so even setting the variable on a production container is ignored and every `dev` message is refused. Tests in `server/test/devflag.test.ts`. Removing the server code from the image altogether would need a build step; not done.
- `npm test` (366 passed, 2 expected failures) and `npm run typecheck` pass; the Docker build itself was not run.

## 2026-10-24 (Dev Rooms sidebar)

- A **Dev Rooms** tab on the right edge of the Multiplayer screen (`lobbyDevTools.ts`) opens a sidebar to make and remove example rooms in the room list, for testing the list and its animations: add a room (name, type, map, players, state) or a random one, remove a random room or all of them, change a room (new players and state, to see a row update in place), a per-room remove button, and a **churn** option that adds or removes a room every 2 s. The example rooms exist only in the page (the server never hears of them), are merged into the list and the online count, and have their Join buttons disabled (`RoomInfo.example` in `lobby.ts`). They are kept when you leave the screen and come back, and the sidebar only exists while the Multiplayer screen is up.
- Development builds only: `lobby.ts` imports it behind `import.meta.env.DEV`; a production `vite build` was checked and contains neither "Dev Rooms" nor the example room names. It reuses the Dev Options styles (`#dev-panel`, with `.dev-lobby` making it fixed over the page) and `make()` from `devTools.ts`. `npm test` (364 passed, 2 expected failures) and `npm run typecheck` pass. **Not looked at in a browser** (`TODO.md`).

## 2026-10-24 (campaign menus gated on the development build)

- The Campaigns button and the `?campaign=&level=` briefing link now show only in a development build (`devMode()` in `campaignMenu.ts` is `import.meta.env.DEV`, so `npm run dev` has them and a production build does not), instead of needing `?dev=1` on the page address. The `dev=1` parameter is no longer read or added to campaign addresses. The campaign maps in Multiplayer are still controlled by Options > Show alpha maps, not by this. `npm test` (364 passed, 2 expected failures) and `npm run typecheck` pass; a production `vite build` was not run to confirm the button is absent (`TODO.md`).

## 2026-10-24 (glass tabs)

- New reusable tab look in `style.css` (`.glass-tabs`, `.glass-tab-list`, `.glass-tab-panel`; the markup is described in `STYLE.md`): the tab buttons are glass like the panels and joined to the panel's top edge. The strip draws the panel's top edge (closed tabs have a bottom border, the open tab has none and takes the panel's fill, with an accent top edge), so the open tab and the panel flow together; closed tabs are darker and muted. The Multiplayer screen uses it (`lobby.ts`); `transition.ts` reveals the strip and panels like other glass panels and has `fadeIn` for switching panels. No new dependencies. `npm test` (364 passed, 2 expected failures) and `npm run typecheck` pass. **Not looked at in a browser**: the join between the open tab and the panel (no visible seam or doubled line, corners lining up) needs a look (`TODO.md`).

## 2026-10-24 (tabbed Multiplayer screen)

- The Multiplayer screen is now two tabs over full-width panels instead of two columns: **Games** (the room browser, selected first) and **Create a room** (name, game type and a wider map list with a larger preview; `lobby.ts`, `.lobby-tabs` / `.lobby-panel` in `style.css`). Switching fades the new panel in; the left and right arrow keys move between tabs. Single-player is unchanged.
- The room list keeps one element per room and updates it in place: new rooms grow in and fade in (staggered when several arrive at once), rooms that close fade and collapse away, and the Join buttons use one delegated handler, so a refresh no longer rebuilds the list (`growRow` / `shrinkRow` in `transition.ts`, which do nothing under Reduce motion or while the Games tab is hidden). The "Can't reach the server" and "No active games" messages are now a separate line above the list.
- `npm test` (364 passed, 2 expected failures) and `npm run typecheck` pass. **Not looked at in a browser** (`TODO.md`). `STYLE.md` records the tab and list-row conventions.

## 2026-10-24 (wider Options panel)

- The Options panel is twice as wide (`#lobby .options` in `style.css`: 460px to 920px, still `min(…, 100%)` so it shrinks on small screens). **Not looked at in a browser**; the check is in `TODO.md`.

## 2026-10-24 (campaign maps in Multiplayer)

- **Options > Show alpha maps** (off by default, stored in `localStorage` as `wst-show-alpha-maps`, `settings.ts`): the campaign maps are listed in the Multiplayer map list only when it is on, and the campaign list is not even fetched otherwise. If a campaign map was selected and the option is turned off, the picker falls back to the default map. Joining a room already on a campaign map still works either way.
- The Multiplayer "Game type" list now offers only Free for all and Co-op vs bots (the Campaign mode is gone from it). Its map list also shows every campaign level after the built-in maps, named `[campaign name]/[map name]` (`lobby.ts`, fetched from the campaigns API; no terrain preview, since the client is not sent hand-drawn terrain, so the caption shows size and briefing title). Single-player still lists only the built-in maps.
- Server: a room whose `map` is `campaign/level` (`campaignMap` in `server/src/campaign.ts`) plays that level's terrain and seed in the chosen mode, and the room list and waiting room show the `Campaign/Map` name. Direct `mode=campaign` rooms are unchanged. Not mentioned in `changelog.md`, since campaigns are still hidden behind `?dev=1`; the campaign maps in Multiplayer are not gated by it.
- Tests: two new cases in `server/test/campaign.test.ts`. `npm test` (364 passed, 2 expected failures) and `npm run typecheck` pass. **Not looked at in a browser** (`TODO.md`).

## 2026-10-24 (compact gameplay sidebar)

- Removed the Controls accordion and the selection name/count/details above the selected-unit resource sparklines (the graphs and Selection heading remain), along with the code that built that text and polled the selected unit's CPU profile. Production queues now place all eight slots in one horizontal row, each slot and icon about half the previous width, and empty slots have a lighter dashed border (`--muted`, opacity 0.75) so they read clearly.
- `ui.ts` was damaged part-way through this work by a bad multi-hunk patch (the class fields and constructor were duplicated and the end-screen, `scoreTable`, resource-bar and `renderInfo` methods displaced); it was rebuilt from the previous diff, keeping the campaign buttons, `revealScreen` calls, queue grid and module-break work. `requestCpuProfile` (`UiActions`, `main.ts`) and `cpuLines` (`cpuPanel.ts`) are now unused by the play UI; the server and state side are unchanged.
- `npm test` (362 passed, 2 expected failures) and `npm run typecheck` pass. **Not looked at in a browser**; the click-through is in `TODO.md`.

## 2026-10-24 (Dev Options menu; agent A2)

- **A "Dev Options" tab on the right of the map** (`client/src/devTools.ts`) opens a panel (the map stays usable under it) with: **fog of war** on/off for the room; **pause**, resume and a **fake disconnect** pause; **drop my connection** (tests the reconnect); **spawn** any starter class (units and buildings, instant, built and charged) for **any team including neutral** around the middle of the view; **give matter** to a team's silos and **add a matter field**; **remove** units/buildings/fields within a radius (of any or one team), or **destroy all** of a team; **heal and recharge** and **finish construction sites** for a team or everyone; **end the match** as Victory (opponents eliminated / others left / no power), Defeat (eliminated / no power) or Draw; **knocked out** (shows the defeat prompt without ending) and **allow normal ending again**.
- **Dev builds only, twice over.** The client imports the menu behind `import.meta.env.DEV` (checked: a production `vite build` has no trace of it). The server obeys the new `dev` message (`net/dev.ts`: validated and size-limited commands; `game/dev.ts`: the simulation helpers; `Match.dev`) only when started with `WST_DEV_TOOLS=1`, which `scripts/dev.mjs` sets for `npm run dev`; otherwise it answers with a note that the tools are off. Production images and `npm start` never set it. Neutral spawns define the starter classes for owner 0 on first use and broadcast them. Fog toggling re-sends each client's welcome and programs (`rejoin`), so the client view resets once.
- Tests: `server/test/dev.test.ts` (refused without the flag; spawn for neutral and a player; unknown team/class refused; matter, fields, remove, clear; every ending; fog and pause; validation). `npm test` (362 passed, 2 expected failures) and `npm run typecheck` pass. **Not looked at in a browser**: the panel layout and the buttons need a click-through (`TODO.md`).

## 2026-10-24 (victory/defeat buttons in a vertical list; agent A2)

- The victory/loss (`#standings`) and defeat (`#defeat`) screens list their buttons in a column (`.end-actions` in `style.css`, full width) instead of a row. `showStandings`/`showDefeat` in `ui.ts` call `revealScreen`, and `.end-actions > button` joined `LIST_ROWS` in `transition.ts`, so the buttons slide in one after another like menu rows (no animation under Reduce motion). `#standings` got `min-width: min(460px, 100vw - 32px)` so it is never narrower than before. **Not looked at in a browser** (added to `TODO.md`); typecheck and tests below.

## 2026-10-24 (module damage, aimed fire, turret / rotor / spark animations; agent A1)

- **Module damage** (engine): `Modules` gained a networked `broken` mask; `Blueprint.hit` (`HitTable`: slot code and integrity per part) is built in `register`. `Simulation.damage(t, amount, owner, aim = 0)` now also calls `hitModule`: pick a part of class `aim` (SLOT_CODES; 0 = any) that is not broken, else any part but the chassis (armour, memory and batteries soak the hit), wear it by `amount`, and when it reaches its integrity set its broken bit (`modulesChanged` halts a unit that can no longer move, marks power dirty for buildings), emit `SimEvent.Break`. Integrity is `MODULE_HP_BASE` 25 + `MODULE_HP_PER_MASS` 6 x mass, or `PartDef.integrity`; legs.light / heavy / colossus are 12 / 30 / 100. `stats(e)` uses `off | broken`; `setModule` refuses to enable a broken module; the hit roll is a hash of tick, victim and a counter (does not touch `sim.rng`, so no stream shift). `repairSystem` mends module damage first (`repairModules`: broken modules before worn ones), then the hull, paying matter for both. Missiles carry the launcher's aim (`MissileFlight.aim`) to the burst.
- **Aim** (`Weapon.aim`, script API): `config.aim(kind)` (a runtime setting, so it appears in the block editor and manual by itself), constant `M_ANY` = 0 beside the `M_*` kinds, queries `moduleBroken(i)` and `brokenOf(h)`; `moduleOn(i)` reads 0 for a broken module. New events `Break` (unit, part) and `Harvest` (harvester, resource; every other tick while it mines).
- **Client**: broken modules show in the modules panel (red, switch disabled); effective stats use `off | broken`. New `client/src/sparks.ts` (streak particles, capped at 240) for harvest sparks (count follows the cargo the harvester gained since its last Harvest event, spraying from the resource towards it) and break bursts. Art: `Look.weaponMass`; turrets are now their own sprites (`turretAnchor`, `drawTurretSprite`) that the renderer's `aim` swings to the target of the unit's last Shot event for 1.5 s and then back to the front; housings (`housing()`: rim, inner ring and rivets) scale with the weapon's mass, with distinct rotary-gun, siege-cannon and three-tube missile art; building weapons are drawn bigger the heavier they are. Wind turbine glyphs are a spinning rotor sprite (`windAnchor`, `drawRotor`, speed = wind/100 x 9 rad/s from `state.wind`). The hull texture leaves out dish, turret and rotor in game (`drawLook`'s `staticDish` still draws all of them for the designer preview and icons). Tesla coils do not aim.
- Tests: `engine/test/modules.test.ts` (11: breaking, legs vs wheels, aimed vs any, determinism, armour soak, scripts and the API, repair order and cost) and three more in `client/test/art.test.ts`. All 362 tests and the typecheck pass. The art was checked in headless Chrome on a throwaway sheet (hulls, turrets at angles, building turrets, rotors, leg frames), which is not in the repo; **nothing was looked at in a live match**.
- **Balance note**: random hits now break modules in every fight (a unit's CPU, gun or motor can break), not only legs. Integrity is deliberately generous for the others (25 + 6 per mass), but this needs play-testing: see `TODO.md`.

## 2026-10-24 (unit silhouettes and walking legs; agent A1)

- **Hull shape from motor x chassis tier** (`client/src/art.ts`): `hullOutline` no longer depends on what the unit carries (gun, cargo, arm, sensor now only change the parts drawn on the hull). Each drive has a base half-width profile (pod, wheels, tracks, huge tracks, legs; rotors are a cross), and each size tier reshapes it (micro rounded, light tapered, medium plain, heavy belted, super-heavy prow and sponsons, colossus bastions round a waist), so all 36 combinations differ and a tier is not a scaled copy. Long chassis still stretch lengthwise. Checked by eye on a raster of all 36 outlines (not in the game).
- **Animated legs**: leg pairs by tier 2, 2, 3, 4, 5, 6 (so 6 legs from medium up, 12 on a colossus), alternating gait with lifted swinging feet. The renderer (`walk` in `renderer.ts`) advances a per-unit gait by distance walked divided by `gaitLength` (1.6 body radii), so leg speed follows unit speed, and shows a rest pose after 150 ms still. Eight cached poses per class (textures swapped, no per-frame drawing or allocation).
- Tests in `client/test/art.test.ts` replace the old "jobs give different hulls" test: 36 distinct, symmetric outlines, tiers differ in proportion, six legs from medium, strides grow with size. `npm test` and `npm run typecheck` pass. **Not looked at in a browser**: the leg animation and the new silhouettes need a look in game (added to `TODO.md`).

## 2026-10-24 (PLAN tidy; agent A1)

- `PLAN.md` brought up to date: stale "on this branch / `main` keeps the old language" notes corrected (the last commit with the old VM is `8d2f1d5`); finished items marked done (source limit 32000, CPU display, unit-to-unit messages, phase 2 M8-M12, sound tag limits, hand-drawn campaign terrain); the superseded size-tier proposal replaced by an S1-S4 status table above the as-built notes, with the open follow-ups numbered; the engine review section condensed to the done/parked summary plus the open items 4-5 (now free to claim, adjusted for `Mobility`). No code changed.

## 2026-10-24 (engine review fixes 1-3 and 6; agent A2)

- **Server crashes fixed (PLAN item 1)**: `parseDoc` (`flow/ir.ts`) now checks the stored JSON's shape without recursion before anything else walks it: every handler, statement and expression has the fields and kinds the IR expects, operators are known, and nesting is at most `MAX_NESTING` (200). Wrong shapes raise `FlowError` instead of a `TypeError` / `RangeError` deep in the checker. `compileDoc` counts the expression stack each statement needs (`stackNeed` / `stmtNeed`) and refuses one over `STACK_SIZE`, so the runtime stack-overflow fault cannot be reached by a compiled program.
- **Visitor chains**: a chain started by a long-running call now starts with event arguments of -1, not 0 (0 is a real entity handle), so a chain from a Visitor block no longer "visits" entity 0. `currentVisitor` (`api.ts`) also requires a live unit of the building's own side.
- **Server safety net** (`server/src/match.ts`): an exception from the tick is caught; the match logs it, tells its players, closes their sockets, refuses new joins and reports itself `empty`, so the room sweep removes it. Other matches keep running.
- **Orders never lost (item 2)** (`flow/run.ts`): queued entries are ranked (periodic 0, other events 1, Order events and chains 2); a full queue evicts the oldest periodic entry, or for an order or chain the oldest lesser one. `raise` now returns how many blocks the event was really queued for. `activity.finish` treats a dropped chain as the order's end (on to the next order) instead of leaving it stuck.
- **Item 3**: `compileDoc` falls back to `host.reservedKeys`, so the server compile path refuses Button keys taken by common actions. `CONFIG_NAMES['Detected.watch']` includes `MISSILE`. `destroy` resets `repairCarry` and drops the entity's `radarReady` entry (`chargeFlow` is cosmetic and left as is).
- **Item 6, measured**: `sweepFor` caches the resolved sweep per (handler, stats); `sensorSweep` keeps only the best hit for a one-report, nearest-first sweep (no list, no sort). A 256-a-side Great Plains match ticks at the same median (~0.5-0.6 ms) and mean (~2 ms) before and after: the script system is not where the time goes. The spikes are path planning (items 4-5; A1 has since released `path.ts` / `planPath`, so they are free to claim), so the rest of item 6 was not done.
- Tests: `engine/test/known-bugs.test.ts` became `engine/test/hardening.test.ts` (the five review bugs now pass as plain tests, plus wrong-shape and deeply nested programs); `server/test/match.test.ts` checks that a throwing tick ends only that match. 327 tests pass (2 expected failures: the A* cases in `perf.test.ts`, waiting for items 4-5); typecheck clean. Nothing was looked at in a browser.

## 2026-10-24 (size tiers, legs, terrain height, CPU cost UI; agent A1)

### S2-S4: size tiers, legs, terrain heights, clearance pathing
- **Terrain height map** (`terrain.ts`): `Terrain.heights` beside `passable`; `computeHeights(cliff?)` sets rock depth (rim 1, capped 9) and cliffs (`CLIFF_HEIGHT` 3 from the edge, every `CLIFF_EVERY`-th outcrop plus the citadel wall, chosen by index so no extra random numbers: existing seeds keep their rock layout). `heightAt` copes with tests that edit `passable` by hand. Wire form is now one height digit per cell ('0' open), decoded on the client. Rules: `MAX_TERRAIN_HEIGHT`, `CLIFF_HEIGHT`, `CLIFF_EVERY`, `CLIMB_SPEED_PERMILLE` (500), `SEPARATION_GAP`.
- **Mobility**: `Mobility { climb, clearance }` (blueprint stats satisfy it), `Terrain.enterable/fits/nearestFit/roomFor` (per-climb Chebyshev distance map, cached on `version`), `lineWalkable(..., m)`, `findPath(..., m)` with the squeeze-out rule. Used by `planPath`, `spawnUnit` (room for the hull), `freeMoveTile`, separation (never onto ground a unit cannot walk on) and the client route preview. Wheels with clearance 0 keep the old fast path.
- **Tiers**: `size` renumbered to the tier (micro 0 ... colossus 5; light/medium/heavy are now 1/2/3, long chassis 1/2/3); `factoryModulesFor = max(1, size)` (same need as before for the old three). New chassis `chassis.micro` (3 slots), `chassis.superheavy`, `chassis.colossus`; `PartDef.radius`, `minSize`, `climb`; `TIER_NAMES`. Stats `radius`, `climb`, `clearance`, `legs`; validation for `minSize` and legs mixed with wheels/rotors. Separation = both radii + gap (light pair unchanged at 0.7 tile); `edgeDistance` reaches the hull of units over a tile across; hit test, selection ring and health bar scale with the hull.
- **Modules (S3)**: `motor.huge`, `legs.light/heavy/colossus`, `cannon.siege`, `gun.rotary`, `armor.heavy`, `cargo.hold`, `battery.large`. Starters: Titan Works (5 factory modules), Mite, Strider, Walker, Juggernaut, Colossus. `MAX_CLASSES_PER_PLAYER` 40 -> 48 (34 starters).
- **Programs**: `size()`, `climb()`, `unitSize(h)`, `heightAt(x, y)` (appended to `UNIT_API`) and constants `SIZE_MICRO` ... `SIZE_COLOSSUS`.
- **Client**: `Look.radius` and `Look.legs` (`unitRadius(look, tex)`), procedural legs (three pairs on a colossus) and wider tracks for the huge motor; rock shading from the real heights (an extra tier at 5+) and a sandy rim on cliffs; designer palette sorts unit bodies by tier, shows tier / climb / minimum tier and disables modules the hull is too small for; stats show Size (and the width it needs) and Legs.
- **Balance check** (`tiers.test.ts`): a Colossus (cost 1070) beats 10 scouts and its own cost in scouts (13), and loses to three times its cost. 13 new tests (ladder, validation, Titan Works production, heights and cliffs, wire round trip, legs over walls and cliffs, half speed on rock, API, clearance through 1/2/3-wide gaps, squeezing out, Juggernaut in the sim).
- Player-facing lines for all of this are in `client/src/changelog.md` (2026-10-24).
- Not looked at in a browser: legs art, cliff rims, big-hull sprites and selection. Bots do not field the new units; that and the other follow-ups are listed in `PLAN.md` ("Unit size tiers", "Still open").

### M6: CPU cost UI
- Engine: `Op.Stmt` now carries a statement index (`FlowProgram.stmtIds`, `blockNames`, `handlerLabel`). `FlowState.cycles` / `runs` per handler (always counted, kept across reboots) and `hits` per statement while profiling (`profileFlow`); `cpuProfile(fs)` summarises them. The sandbox profiles its test unit: `TestRunResult.profile` (cycles by event block, dropped events, heat map by graph node id; block cards get the runs of their event blocks) and a note when events were dropped.
- Protocol: `cpuProfile` request/answer for own units (server `match.ts`); the info panel of one selected own unit polls it once a second and shows cycles per second by event block, runs and dropped events (`client/src/cpuPanel.ts`, `ClientState.cpuProfiles`).
- Graph: event nodes and block cards show their worst-case cost (`≤Nc`, `handlerWorstCase`, expanded for blocks); after a test run nodes get a `×N` badge and a warm glow, execution wires glow by how often they were followed and unused ones fade (`FlowDocument.heat`, cleared when the program changes; "Clear heat map" button). The Code tab's test run shows a "CPU by event block" table. The Design tab's Memory row shows program use against slots.
- Tests: `engine/test/profile.test.ts`, `client/test/cost.test.ts`. All 330 tests pass (2 expected failures belong to A2's perf file); typecheck clean. Nothing of M6 has been looked at in a browser.

## 2026-10-24 (typed factory modules, factory animation, queue grid)

- Factories: `factory.basic` is replaced by one module per size tier (`factory.micro`, `.light`, `.medium`, `.heavy`, `.super`, `.colossal`; mass 3/5/8/14/24/40). A building builds a unit only with a module of exactly its tier (`factoryCanBuild`, `BlueprintStats.factoryTiers`); the "one module short = a tenth of the speed" rule is gone. Starter buildings: HQ light + medium, Light Factory micro + light, Vehicle Factory medium, Heavy Factory heavy, Titan Works super + colossal, bot Assembler all tiers. Saved designs with `factory.basic` still load (alias of the light module, so an old multi-module factory builds light units only). Plan in `PLAN.md`.
- Queue: the `Production` component now replicates the whole queue (`q1`-`q7`); new `dequeue` command (`dequeueProduction`) removes an item and refunds its matter (the front item loses its work). Note: enemies who can see a factory also receive its queue (already true of its current item).
- Client: the production panel shows an 8-slot queue grid with an icon per queued unit, a progress fill on the one being built, and click-to-remove. Factories that are building show an animation to everyone who sees them (`factoryFx.ts`: pulsing outline, scan line, rotating ticks, sparks at the exit edge; steady outline only with Reduce motion).
- Tests: `factory.test.ts` rewritten (tier rule, starter buildings, refusal message, legacy alias, queue replication, dequeue/refund); `tiers.test.ts` adjusted. Not looked at in a browser (queue grid, animation).

## 2026-10-24 (unit cost scaling)

- Unit costs now grow exponentially with the hull size tier (`sizeCostMultiplier` in `rules.ts`, applied in `deriveStats`): micro, light and medium are unchanged (x1); heavy x2.5, super-heavy x6.25, colossus about x15.6, on both matter cost and production energy (`buildEnergy`). Buildings are not scaled. Juggernaut 800 -> about 5,000 matter, Colossus 1,070 -> about 16,700 (production energy 240 -> about 3,750). Build time is unchanged. Docs (`docs.ts`, `docs/game.md`) and the changelog updated.
- Tests: `tiers.test.ts` now stocks extra silos to afford a Colossus; the old "beats its own cost in scouts" balance test is replaced by "beats ten scouts" plus a multiplier test, because price is now set by tier rather than strength. The Colossus is therefore poor value per matter until its strength is looked at (see `PLAN.md`).

## 2026-10-24 (Tiled map editor, menu order)

- Menu panels now expand down (150 ms, `clip-path`) before their contents appear (`revealScreen` in `transition.ts`, replacing `slideInList`): rows slide in after the panel opens, other content fades in. Reduce motion: everything just appears. Not looked at in a browser.
- List slide-in is now used for every menu list (main menu buttons, campaign and news lists, level lists, option rows, and the screen header): `swapContent` slides the rows in one by one instead of the whole screen when the screen has a list (`slideInList`, `LIST_ROWS` in `transition.ts`); delay between rows raised from 50 to 70 ms, 200 ms each, at most 12 staggered. Reduce motion: everything just appears. The room list does not animate (it refreshes by polling). Not looked at in a browser.
- Reading screens (campaign pages, news) now use up to 900px of width instead of 700px (120ch was too wide); the header lines up with the panel (`:has()` rule on `.lobby-view`). Not looked at in a browser.
- New News and Updates screen on the main menu (`newsMenu.ts`, between Designer and Options) replaces the "What's new" box: one article card per update day (headline + summary), opening to the full change list. `changelog.md` gained an optional `### headline` and a summary paragraph per day (written for all seven existing days); `parseChangelog` reads them. AGENTS.md rule 5 now asks agents to add entries. Not looked at in a browser.
- Menu glass panels (`#lobby section, aside, fieldset, …` in `style.css`) are more transparent (alpha 0.62 → 0.5) and have 0.25em more padding all round (first 0.5em, then trimmed).
- Manual: the ✕ button now really closes it (in the menu it rewrites the history entry instead of `history.back()`, which only stepped back a manual page), and a new "← Back" button goes back a page (`lobby.ts`, `ui.ts`, `index.html`). Not looked at in a browser.
- `AGENTS.md`: new "Performance goals" and "What to avoid" sections (tick budget, hot-path rules, determinism, untrusted input, dependencies, test integrity).
- Main menu buttons now sit on the same translucent panel as the other screens (`.menu-panel`). New `STYLE.md` records the UI style intent; `AGENTS.md` points to it (rule 8).
- Campaign screens (list, campaign page, briefing) are wrapped in a `<section class="campaign-panel">`, so they get the same translucent menu panel as the other screens.
- Reduce motion now also switches off every menu transition (`transition.ts` reads the option, falling back to the system preference, instead of only the system media query): screens change instantly and overlays just appear.
- Campaigns menu: the list no longer slides in twice (the "Loading…" placeholder is replaced in place); its cards now slide in from the right one by one (`staggerIn` in `transition.ts`), or just appear with Reduce motion on.
- The Campaigns button (and the `?campaign=&level=` deep link) is hidden unless the page address has `dev=1` (`devMode()` in `campaignMenu.ts`); campaign addresses keep `dev=1`. The campaign lines are out of the player-facing updates list until campaigns go live; remove the `devMode()` checks in `lobby.ts` then.
- The main-menu "What's new" list now comes from one plain-text file, `packages/client/src/changelog.md` (`## date` heading, then `- ` lines; newest first). `changelog.ts` imports it (`?raw`) and `parseChangelog` reads it; no new dependency (YAML would need a parser package). Tests in `client/test/changelog.test.ts`. To add an update, edit only that file.
- Main menu order is now Campaigns, Single-player, Multiplayer, Designer, Options, Manual, Credits (`lobby.ts`). The player-facing updates list (now `client/src/changelog.md`) has entries for campaigns and the menu order.
- New `editor/` folder for drawing maps in Tiled (details in `editor/README.md`): `wst.tiled-project` (with a "Save into a campaign level" command), tileset `terrain.tsx` + `terrain.png` (open ground and rock heights 1-9), `template.tmj`, and scripts `tiled-to-level.mjs` (Tiled map -> `map.terrain` in a level file, with a check that every start corner reaches the centre), `level-to-tiled.mjs` (level or blank template -> `.tmj`) and `make-assets.mjs` (regenerates the png and template).
- Levels can now carry drawn terrain: `MapDefinition.terrain` (`engine/src/game/map.ts`, `Terrain.encode()` form) replaces generation, with the four start areas always forced open (`handMadeTerrain`); `server/src/campaign.ts` reads `map.terrain` as equal-length digit rows (24-192 each way) and takes the size from it, skipping bad ones with a warning. Documented in `campaigns/README.md`.
- Example: Tutorial level 3, "The Gauntlet" (`campaigns/tutorial/maps/03-the-gauntlet.json`, drawn in `editor/maps/03-the-gauntlet.tmj`).
- Tests: three new cases in `server/test/campaign.test.ts` (drawn terrain and size, start areas forced open, bad terrain skipped). The Tiled files themselves have not been opened in Tiled (only round-tripped through the two scripts); the main menu and The Gauntlet have not been looked at in a browser.

## 2026-10-24 (campaigns)

### Single-player campaigns (framework)
- New game mode `campaign` (`GameMode` in `engine/src/game/map.ts`; types `CampaignInfo` / `CampaignLevelInfo` / `Briefing` in `engine/src/game/campaign.ts`). A campaign room is a private one-human room like solo (no lobby, a bot opponent, same victory check) on a hand-made level: `Match` takes `level: { map, seed }` (fixed terrain seed); `index.ts` creates the room from `?mode=campaign&campaign=<id>&level=<map>` and refuses unknown levels. Campaign rooms are hidden from the room list.
- New `campaigns/` folder (formats and fields in `campaigns/README.md`): `<campaign>/campaign.json` (name, order, summary, story, ordered `maps`) and `<campaign>/maps/<id>.json` (briefing, generator layout/size/seed, `victory`, reserved `triggers: []`). Example content: Tutorial (First Steps, Making a Stand) and Digital Chaos (Landfall, The Long Ridge, The Citadel). `server/src/campaign.ts` validates and loads them (bad files are skipped with a `[campaign]` warning; `CAMPAIGNS_DIR` overrides the folder); `GET /api/v1/campaigns` re-reads the folder on each request and lists campaigns with their levels and briefings (never the triggers). The Dockerfile copies `campaigns/` into the server image.
- Client: main menu "Campaigns" (`campaignMenu.ts`): campaign list with progress, a campaign page (story, Start/Continue, level list with Completed / Ready / Locked) and a briefing screen (story, objectives, tips, map size) before each level; "Begin mission" starts the level. Progress is the number of levels completed per campaign, stored in `localStorage` (`wst-campaigns`, `campaignProgress.ts`); any unlocked level can be replayed. On a win the level is saved and the end screen offers "Next mission" (opens its briefing via `?campaign=&level=`) or, after the last level, a way back to the campaign; a loss offers "Retry mission" (new room, same level). `Ui.setCampaign` adds the buttons.
- Triggers are NOT implemented: only the empty `triggers` array exists. Planning notes are in `PLAN.md`.
- Tests: `server/test/campaign.test.ts` (loading, ordering, skipping bad files, shipped campaigns load without warnings, campaign match, fixed terrain), `client/test/campaignProgress.test.ts`. 310 tests pass (7 expected failures are the known-bugs file); typecheck clean. Checked `GET /campaigns` against a running server; the menu screens and the end-of-mission flow have not been looked at in a browser.

## 2026-10-24

### Engine and flow code review; performance budgets in CI (agent A2)
- Reviewed the flow compiler, checker and VM, the script host (`api.ts`, `activity.ts`, `sensor.ts`) and the tick path after the flowcode migration. Findings are in `REVIEW.md` ("Engine and flow pass (2026-10-24)") and the fix plan in `PLAN.md` ("Engine review fixes"). No engine code was changed.
- Confirmed and reproduced: two ways a player's program can crash the whole server (a deeply nested stored program overflows the compiler's recursion with a `RangeError`; a chain started from a Visitor handler makes `visitorCaps()` throw a `TypeError` in `step()`, because continuations reset the visitor to entity 0). Neither error is caught by `Match.apply` or the tick loop, so Node exits. Also: a full event queue drops an Order and the unit ignores every later order; the server compile path skips the Button hotkey check; too-deep expressions compile and then crash-loop.
- Performance: on Great Plains with 256 units a side, the mean tick is 1.9 ms but spikes reach 14 ms, almost all from A* on goals inside buildings (docking or charging), which flood the map (86 such plans took 396 ms; 240 open-goal plans took 4 ms). A 256-unit group order across the map makes the next tick take ~460 ms.
- New `engine/test/perf.test.ts` (in `npm test`, so in CI; ~4.5 s): wall-clock budgets (large-match tick, unit scaling ratio, VM cycles/ms, corner-to-corner path on Badlands, issuing a 256-unit order), an exact "reactive units cost 0 cycles" check, and two `it.fails` budgets for the A* problems. `WST_PERF_SLACK` loosens the wall-clock budgets; CI sets it to 2. New script `npm run test:perf`.
- New `engine/test/known-bugs.test.ts`: the five confirmed bugs as `it.fails` tests. They flip to failing when a fix lands, and the fixer changes them to `it`.
- `npm test`: my new files pass (6 budgets pass, 7 expected failures). At the time of writing, A1's in-progress size-tier work had one failing client test (`art.test.ts`) and a typecheck error in its new `tiers.test.ts`; neither is from this change.

### Sound limiter
- `SoundPlayer` now routes `master` through a `DynamicsCompressorNode` (threshold -14 dB, ratio 12, 3 ms attack, 200 ms release) before the destination, so many overlapping explosions and shots are squashed instead of clipping. One native node on the audio thread; no per-play cost. Review of overlapping playback and the remaining gaps (unlimited `cooldownMs` / `maxVoices` by default, no global voice cap) are in `PLAN.md`. Not listened to in a browser.

### Credits roll and sound credits
- The Credits screen is a vertically scrolling roll (`#credits-view` / `.credits-roll`, CSS animation, always scrolling with a Pause / Resume button under it (hover no longer pauses; the button is hidden under Reduce motion), speed scales with the number of entries, about 3 s per credit, halved from the first version): "Made by" (Dr John Vidler, Claude Opus 5.5, Claude Sonnet 5.5; `CREDIT_PEOPLE` in `lobby.ts`), then music (`/music`) and now also sound effects (`/sound`, one entry per distinct file) with author, link and licence. Not looked at in a browser.

### Reduce motion option
- New `client/src/settings.ts` (`reduceMotion`, `setReduceMotion`, `onReduceMotionChange`, `initSettings`); Options has a "Reduce motion" checkbox, stored in `wst-reduce-motion`, defaulting to the system `prefers-reduced-motion`. It sets `data-reduce-motion` on `<html>`: the menu background stops scrolling (CSS) and its sparks stop (`menuBackground.ts`, restarts when switched off), and the credits become a normal scrolling list. The in-game renderer ignores it for now.

### Agent coordination
- New `AGENTS.md`: rules for several agents working at once (read TODO/PLAN/PROGRESS, claim areas, small edits to shared files, where to record work).
- 281 tests pass; client typecheck clean.

## 2026-10-20

### Version string in Docker images
- The image build has no `.git` (and `.dockerignore` excludes it), so the menu version and the stamp in saved designs fell back to `unknown`. The publish workflow now passes `GIT_HASH` (`github.sha`) and `GIT_BRANCH` (`head_ref` or `ref_name`) as build args to both targets; `docker-compose.yml` forwards `GIT_HASH` / `GIT_BRANCH` to the client build (documented in `docs/deployment.md`); Vite shortens `GIT_HASH` to 7 characters, like `git rev-parse --short`. Only an image built after this change shows the real version; not tried in CI.

### Changelog starts folded
- The main menu's "What's new" accordions are all closed at first (the newest used to be open); `changelogHtml` in `lobby.ts`.

### The manual
- New section "Manual" at the top of the docs (`client/src/manual.ts`, 11 pages: Welcome, How the game works, Playing: controls, Matter & energy in practice, Building & producing, Fighting/seeing/talking, Designing your own classes, Programming from zero, The graph editor, Recipes, Block gallery, When something goes wrong + glossary). The old Guide and API reference pages are unchanged and linked from it. Docs title and the lobby / in-game button labels now say Manual.
- `client/src/docsGraph.ts` draws a program as the graph editor shows it (static HTML + SVG wires, from the editor's own `buildGraph` + `layout`, same colours and pins), so pictures cannot drift from the editor. `client/src/manualExamples.ts` holds the example programs (hello, move, arrive, counter, branch, guard, chase, recharge, blocks, own events, button, radio, join, while); `client/test/manual.test.ts` checks every example parses and checks cleanly, every built-in block draws as a card, and every manual page renders. The block gallery shows each `use(Block)` card with its settings, what it raises and the expansion of HarvestLoop as text.
- The music widget no longer overlaps the manual: while the docs overlay is open (menu and in-game) the player moves into the docs bar, on the right before "Open in new tab" (`placeMusic` into `.docs-music`), and goes back to its usual place when the docs close. Not looked at in a browser.
- Layout: the prose is a centred 900 px column (`#page > *`); rendered graphs are allowed to be wider than it (`figure.graph` is `fit-content`, max 100% of the page) and scroll sideways only once they outgrow the page; no vertical scroll inside a graph. Checked in headless Edge at 2000 and 1100 px.
- Looked at in headless Edge (Recipes and Block gallery): nodes, wires and cards line up. 281 tests pass; `vite build` works.

### Drag to build a line; right-drag to spread units
- Placing: left-press starts a drag (`placeStart`), the line is `lineSpots()` (one spot every `footprint` tiles along the longer axis from the press to the cursor, at most 12, so neighbours touch and never overlap; each spot has its own validity), previewed with a ghost sprite per spot (`lineGhosts`) and green/red tiles; release calls `placeLine` (one `place` message per valid spot, the later ones queued so builders work through them in order, `queue` from Ctrl/Shift as before). A release without a drag is the old single placement.
- Orders: right-press no longer sends at once; it starts `orderDrag` (path of screen points, 4 px apart). Release without a drag = the old order (attack / harvest / move). With a drag, `spreadUnits` puts the selected non-building units at even steps along the path (one alone goes to the end), sorted along the path's overall direction by their screen positions so routes tend not to cross, and sends one `order` (move) per unit; a green line with a dot per stop is drawn while dragging (`ViewState.orderPath`). Ctrl/Shift at release queues.
- Not looked at in a browser and not covered by tests (it lives in `input.ts` and needs a canvas). Orders now go out on release, not on press.

### Spinning radar dish
- `Look.radar`; `drawDish` / `dishAnchor` in `art.ts` (units: just behind the middle; buildings: the middle, or the covered tile nearest the middle of a shaped one). The renderer adds the dish as a child sprite of the unit or building sprite (`spinDish`, 2.4 rad/s, shared texture per dish size, tracked in `dishes` / `noDish`), so it follows, scales and hides with its parent. The designer preview and build-bar icons draw it static (`drawLook(..., staticDish)`). Not looked at in a browser.

### Double-long chassis, shaped building frames, Rocket Artillery
- Chassis `chassis.long.light/medium/heavy` (size 0/1/2, `long: true`; slots 7/11/16, mass 4/9/19, hp 75/190/420): the size class decides factory need as before. `BlueprintStats.long`. Art: hull, tracks, cargo and battery pips are stretched 1.9x lengthwise and the weapon sits forward of the middle (`LONG` in `art.ts`).
- Frames `frame.l / t / plus` (5 tiles), `frame.u / h` (7 tiles) in a 3x3 box: `PartDef.shape` rows ('X' covered), stats `shape` and `area`; slots/mass/hp per tile match the square frames (3.4 slots per tile). Only covered tiles block movement and placement (`Terrain.occupy/footprintFree` take the shape; simulation, sandbox, client state, input and the placement ghost pass it), so units can enter the notches. `buildEnergyCost` now takes the area (covered tiles). Position, power links, charging zones, selection, hit tests, completion sparks and fog stay on the bounding box. Art draws the plate per covered tile, outline only on outer edges, one module symbol per tile.
- `missile.huge` (mass 16, 60 matter, range 26, 100-tick cooldown, slow big warhead with blast 3) and the starter class Rocket Artillery (long medium chassis, large motor, long sensor, 3 cargo bays). Tests: `shapes.test.ts`. 254 tests pass.
- Not looked at in a browser; the art for long hulls and shaped buildings is untested by eye. No starter building uses a shaped frame yet.

### Factory modules set build speed; two sizes short is not allowed
- Rule (`factoryRatePermille(have, need)`, `need = size + 1`): at least `need` modules = full speed (more give nothing extra); exactly one short = a tenth of the speed (`FACTORY_ONE_SHORT_PERMILLE`); two or more short = `enqueueProduction` refuses ("too big for ..."), production buttons are dimmed. So the HQ (1 module) builds light units normally, medium units (the Builder, so nobody is deadlocked) at a tenth speed, heavy units not at all. This replaces the first version (a hard limit, then a (have / need)² curve).
- `productionTicks` counts thousandths of a build tick; the unit's energy cost is spread over the work (total unchanged, a slow factory pays module upkeep for longer). HQ back to 1 module; Light / Vehicle / Heavy Factory 1 / 2 / 3; the bot's Assembler now has 3 modules (Bulwark is heavy). Tooltips show the real build time and the slowdown. Tests: `factory.test.ts`; sim test for HQ builders waits 10x.

### Designer module catalogue as a wrapping grid
- Palette groups are now plain sections with a heading and rule; modules are equal-size tiles (name in bold, details under it) in an auto-fill grid (min 170 px). Groups: Unit bodies, Building frames, Compute, Movement, Weapons & armour, Sensors & radar, Radio & laser links, Industry, Power (weapons no longer share a group with sensors and radio). Not looked at in a browser. Disabled tiles show a red reason at the bottom ("Only fits buildings/units", "No free slots", "This class can’t be edited").
- Disabled palette tiles show a red reason at the bottom ("Only fits buildings/units", "No free slots", "This class can’t be edited").

### Game version stamp in saved designs; update prompt
- Vite defines `__GIT_HASH__` (`GIT_HASH` env, else `git rev-parse --short HEAD`; the Dockerfile has a `GIT_HASH` build arg since the image has no .git). `client/src/version.ts` exports `GAME_VERSION`. Design files get a `game` field (engine `DesignFile.game`, `makeDesignFile(classes, game)`).
- In a match, if the saved `game` differs from `GAME_VERSION` and some default-named class differs from this build's default, a dialog "The game has been updated" offers Keep mine / Replace with new defaults / Merge (new default for unchanged classes, your edits kept, per-class choice for both-changed ones). Own classes are never touched. Saves keep the old stamp until the question is answered (so the menu designer cannot hide it); upload and reset also settle it.
- The main menu (and the name screen) shows "Version: <branch> / <hash>" (`GIT_BRANCH` env or `git rev-parse --abbrev-ref HEAD`; Docker build arg `GIT_BRANCH`) fixed in the top-right corner (`.lobby-version`).
- Not tried in a browser; no automated test for the dialog (it lives in the DOM).

### M12: graph pass for blocks (client)
- Block cards: `GNode` kind `block` (settings as text fields with constant names, "raises ..." line, Expand button, problem shown on the card); `NodeCallbacks.action`. Ops `addBlock` (each block once), `setBlockSetting` (validated), `expandBlock` (via `expandOne`), `deleteNode` knows blocks, `ownEvents` includes what the blocks in use raise, so `on(Delivered)` can be added from the palette at once. `configFromText` accepts block settings.
- Palette: new first group "Blocks" (open by default), then Events, Flow...; "Your events" group for events of your own. Graph toolbar: Template... chooser (`CLASS_TEMPLATES`: Blank, Worker, Builder, Medic, Fighter, Turret, Storage, Factory) that replaces the program after a confirm. Layout: block cards in rows of three at the top, event chains (event left, what it starts to its right, outcomes as branches) below.
- Problems found inside a block's expansion are mapped to the block (`FlowDocument.findProblems`). Docs: page "Blocks & your own events" generated from the registry; editor completion has `use <Block>` snippets.
- Tests: graph tests for cards, settings, add/expand/delete round trip; `vite build` succeeds. Not yet looked at in a browser: how the cards and the template chooser look is for you to review (the readability review in M12 is yours).

### Factory size follows factory modules; specialised factories
- `BlueprintStats.factoryModules` counts working factory modules; `enqueueProduction` refuses a unit whose chassis size needs more (`factoryModulesFor(size) = size + 1`: 1 light, 2 medium, 3 heavy). The HQ and the bot Assembler now have two factory modules (so everything below heavy is still built there); new starter buildings Light Factory (1), Vehicle Factory (2) and Heavy Factory (3), each running `use(RallyPoint)`. The production panel dims classes that do not fit, with a tooltip saying why. More modules also use more energy while producing (`factoryUse` sums).
- Tests: `factory.test.ts`. PLAN.md has a new "Unit size tiers" section (plan only): a longer chassis ladder (micro to colossus) on the same part catalogue, `radius` per chassis, tier-aware factory rule, optional clearance pathing, milestones S1-S4.

### M11: built-in block library (engine side)
- `flow/blocks.ts`: 13 blocks as text templates with typed settings. `FlowDoc.blocks` (`BlockUse`), text `use(Block, { ... })` (parse, print, id alignment), `expandBlocks` (check and compile run on the expanded program, so cost is the expanded cost), `expandOne` (Expand), `checkBlocks` (unknown block, used twice, unknown or out-of-range setting). Block variables are prefixed (`harvestLoop_x`). Blocks emit `Charged` (RechargeWhenLow) and `Delivered(amount)` (HarvestLoop).
- All starter classes are now a few `use(...)` lines; a test checks that no starter has event blocks of its own and none hooks `Idle` once expanded. The silo scenario test now waits 2 ticks and refills the fields so it no longer depends on the random sequence. Tests: `blocks.test.ts`; 246 tests pass.
- Client graph cards for blocks are M12 (not started): until then the graph editor does not draw `use` blocks.

### Joining text with + (playtest bug)
- A `+` with text on either side is a join (`isTextExpr` / `textParts` in `ir.ts`); whole numbers print as digits, comparisons and logic as `true` / `false`, left to right like JavaScript (`'a' + 1 + 2` is `a12`, `1 + 2 + 'a'` is `3a`). Only allowed where a built-in takes text (`alert`); elsewhere the checker refuses it.
- Compiler: `Op.Concat` with a per-program template (`FlowProgram.templates`); the join is built at run time into `running.dynamic` (cleared at the next statement) and passed to the built-in as a handle past the static strings (`textAt`). Result cut at `MAX_TEXT` (40). Cost: one node + wire per `+`, so the graph's cost model still matches.
- Tests: `alert.test.ts` (join result, misuse errors, 40-character cut).

### Radio and laser link modules
- New slot `comms` (module kind `M_COMMS`, 18, switchable) and parts `radio.basic` (mass 1, 12 tiles, 1 energy per message, ignores terrain) and `radio.laser` (mass 3, 40 tiles, 3 energy, needs open ground: rock blocks the line, buildings and units do not). Stats `radioRange/laserRange/radioUse/laserUse`; capabilities `HAS_RADIO`, `HAS_LASER`.
- Language: actions `radioSend(channel, value)` and `laserSend(channel, value)` (group Communication; return how many received it, -1 without a working module or energy); event `Message(channel, value, sender, link)` with settings `channels` (filter) and `link` (RADIO / LASER, 0 either); constants `RADIO`, `LASER`. Receiving needs the same kind of module on a unit or building of the same team, and a `Message` block; receiving costs nothing.
- `Simulation.transmit` / `clearLine`. Designer lists the modules under Sensors & weapons.
- Tests: `comms.test.ts` (range, through rock, laser line of sight, allies only, channel filter, sending from a program).

### M10: events of the program's own (`emit` / `on(Name)`)
- IR: statement `{ k: 'emit', event, args }`; a handler may name any capitalised event that is not built in (`isCustomEventName`, up to 16 per class, up to 4 values each). Text: `emit(Greeted, 7, 3);` and `on(Greeted, (who, times) => { ... })`; `emit` and `use` are now reserved words. Checker: emitting a built-in event is an error; an emit nobody handles is allowed (blocks will emit events the player may hook).
- Compiler/runtime: custom events get ids from 64 (`CUSTOM_EVENT_BASE`) in order of first use; new `Op.Emit` pops four values and `raise`s the event on the unit's own queue, so it costs the statement plus its argument wires and nothing when no block handles it.
- Graph: `emit` node (event name, 0-4 values; value pins take the receiving block's names), own-event blocks (name control renames everywhere, values control), palette group "Your events" (`New event block...`, `emit (new event)`); ops `setEmitEvent`, `setEmitArgs`, `renameEvent`, `setHandlerParams`, `newEventName`, `ownEvents`.
- Tests: `custom-events.test.ts` (round trip, two blocks talking, errors) and graph tests; existing tests that used `on(Nope, ...)` as the unknown event now use a lower-case name. 234 tests pass; typecheck clean.

### Flak, shooting missiles by order, designer file buttons
- **Gap found**: only sentries could target missiles. `issueOrder`/`issueCommand(Attack)` required a `Unit` target and the client `pick` ignored missiles, so a player could not click one. Now an enemy missile is a valid Attack target (engine) and `Renderer.pick(sx, sy, true)` returns enemy missiles (drawn lifted above the shadow) for right-click and aimed actions; own missiles are never picked.
- **Flak**: `flak.cannon` (mass 3, range 10, 12 damage, cooldown 3, 2 energy): `combatSystem` bursts every enemy missile within `FLAK_BURST_RADIUS` (1.5 tiles) of its target, no hit roll; it only locks on missiles (clears any other target before spending). New `DetectKind.Missile` / `MISSILE` constant for `Detected`. Starters **Flak Truck** (medium, motor.small, short sensor, one cell) and **Flak Turret** (small frame, battery bank). Art: twin-barrel turret; sound tag `combat.shot.flak`.
- **Designer**: `loadDesigns` body extracted to `loadDesignsInto(host, ...)` (simulation.ts; the method delegates). `LocalDesigns` reuses `DesignStore` with it, and `Designer` shows Download / Upload / Reset buttons when `actions.designFiles` is given (menu designer only; in a match they stay on the menu).
- Tests: shoot-down order, own-missile refusal, flak kills a 30% missile surely and spares units, flak refuses ground targets (`missile.test.ts`).

### Fast light units and a visible tesla discharge
- **Engine**: `motor.turbo` (mass 2, thrust 150, 2 energy/tick); starters **Dart** (turbo, short sensor, light gun; fighter program) and **Pathfinder** (turbo, long sensor, no weapon; move/stop/charge only). A light chassis with turbo is about 2.1x the Scout's speed (514 vs 240 sub-tiles/tick).
- **Client**: tesla discharge (`drawTesla` in `renderer.ts`): a ring that eases out to the weapon's range with 11 jagged, crackling lightning arcs (re-rolled every 55 ms) and sparks at the tips; replaces the faint ring. Tune `PULSE_MS`, `TESLA_*`.
- Test: speed comparison in `missile.test.ts`.

### Missiles, and a starter unit for every weapon
- **Engine**: `game/missile.ts` (new). A launcher (`missile.small/medium/large`, `WeaponKind` `'missile'`) spawns a missile entity (`Missile` component: owner, size = matter, heading, blast; plus `Position`, `Health`) instead of dealing damage. `missileSystem` runs after `combatSystem`: turn-limited homing, straight flight when the target is gone, burst on proximity fuse / end of flight / map edge, splash on enemies only with linear falloff. Damage = matter x `MISSILE_DAMAGE_PER_MATTER` (12). Numbers in `rules.ts` (`MissileTuning`, `missileLauncher`). Shots at a missile connect with its `hitChance` (`shotHitsMissile`, from the sim rng). New `Simulation.damage()` replaces the inline damage code in `combatSystem`; `Simulation.flights` holds the non-replicated flight state.
- **Visibility/sensors**: `visibleTo` always includes the viewer's own missiles; `Detected` with `ENEMY` reports enemy missiles.
- **Content**: starter classes Tank (cannon), Lancer (laser), Stormer (tesla), Rocket Truck (medium missile); `resupply()` handler (fetch matter from the nearest stocked silo when low); HQ and Resource Silo no longer send armed units harvesting (`CAN_FIGHT`).
- **Client**: missiles are drawn from the `Missile` component, not as sprites (so they can't be selected): rocket with flame, owner-coloured nose, trail of the last 14 positions, ground shadow offset below the body, launch flash; burst uses the normal explosion at the missile's blast size; art for the missile launcher on vehicles and buildings; `combat.shot.missile` sound tag.
- **Tests**: `missile.test.ts` (11): damage per matter, speed ordering, turn limit, burst and allies, shoot-down odds, sentry targeting, fog visibility, wire round trip, Rocket Truck resupply. 223 tests pass; typecheck clean.

### alert(text, duration_ms): speech bubbles over units
- Language: text in quotes (`{ k: 'str' }` in the IR) is allowed only as an argument a built-in declares as text (`BuiltinSig.text`); anywhere else it is an error. Up to 40 characters, no control characters, each distinct text takes one memory slot. Compiled to an index into `FlowProgram.strings`.
- `alert(text, duration_ms)` (Actions group, 2 cycles): 100 ms to 30 s, converted to ticks; a newer alert replaces the unit's current one. `Simulation.alerts` is replicated by `encodeTick` (new trailing section, only for units the client can see) and arrives as `TickInfo.alerts`; the server passes it on.
- Client: the renderer draws a white speech bubble above the unit (fades in the last 250 ms); graph text inputs accept the text (quoted or not); docs mention it.
- Tests: `alert.test.ts` (round trip, errors, memory, tick conversion, network round trip); 212 tests pass.


### flowcode phase 2: activities, outcome pins, event-first starters
- **Engine**: durable activities (`game/activity.ts`: goTo, approach, harvest, dock, take, build, repair, charge, supply, engage) that run outside the program and end in named outcomes; outcome chains (`outcomes` in the IR, `name: () => {}` object argument in text, continuation ops in the compiler and interpreter with a saved frame); `Free` event (repeat setting); `Order { urgent: QUEUE|REPLACE }`; order list calls `nextOrder`, `swapOrder`, `clearOrders`, `orderCount`; `activity`, `suspendActivity`, `resumeActivity`; `EnergyLow` repeats while low. The task API (`taskCount`, `taskType`, ...) is gone.
- **Behaviour changes**: orders no block wants are dropped; fighters shoot whenever not on Hold fire; the HQ rally point is its single order; starters use no `Idle`.
- **Measured**: silo stock after 600 ticks unchanged (980); Harvester 0.17 cycles/tick average (16.8 before), 98% of ticks asleep; Scout 0.00.
- **Client**: outcome pins on call nodes (`out:<name>` exec outputs), `outcome` ExecRef in `graphOps` (find, chain, ids, scope, delete, empty-chain pruning); `docs.ts` rewritten for events and activities (new "Orders & activities" page, samples parse); client tests ported off the removed task calls, plus a new outcome-pin test.
- **Checks**: typecheck clean; 208 tests pass (27 files).

## 2026-10-19

### flowcode M2-M5: event-block programs replace the old language (text and graph views)
- **Language (`packages/engine/src/flow/`)**: Flow IR (`ir.ts`), events with settings schemas (`events.ts`, `config.ts`), TypeScript-subset parser and printer on Lezer (`text.ts`), checker with memory accounting (`check.ts`), flat compiler (`compile.ts`), resumable interpreter with per-unit event queue, timers and `Idle` (`run.ts`), cost constants (`cost.ts`). Events: Spawned, Idle, Every, Timer, Order, Arrived, Damaged, Detected, Visitor, Button, EnergyLow, EnergyFull.
- **Game side**: `UNIT_API` calls are queries, actions or runtime settings (`config.`); `sleep` became `config.rest`, `after` added, `nextVisitor` removed; `game/sensor.ts` (sweep rules, sensor tiers 1 and 2, clamping notes); `scriptSystem` rewritten (timers, sweeps, energy thresholds, CPU billing from cycles run); events raised from orders, buttons, visits, arrivals and damage; memory raised on CPUs and memory banks.
- **Old language removed**: `vm/` (compiler, VM, opcodes, types) deleted. Starter classes, `NEW_CLASS_TEXT`, the wanderer and the bot fighters are written as text in `content.ts` and stored as JSON. Design files are version 2: old programs are replaced by the default of that name (or the new-class starter), and the old file is kept in `localStorage` as `wst-designs-before-flowcode`.
- **Tests**: 180 engine+server tests (new `flow.test.ts`: text round trips, errors, exact cost table, suspension and overdraft, timers, queue overflow, faults; `events.test.ts`: Order/Button/Visitor/Arrived/Damaged/EnergyLow, rest, Detected tiers, sweeps, a 1024-unit benchmark at about 1.3 ms per tick) and 15 more client tests (`flowdocument`, `graph`, editor, docs: every program shown in the guide parses). The old sim and bot tests were ported; one bot test now runs long enough for the second wave.
- **Client**: `designer/` Code tab shows a node graph, text, or both (`flow/FlowDocument.ts`, `graphOps.ts`, `graphModel.ts`, `layout.ts`, `components.ts`, `graphView.ts`; Rete.js + Lit, loaded on demand); `editor.ts` is the TypeScript-mode text view with completion for calls, events and event settings, hover docs, diagnostics with places and a memory meter; `docs.ts` rewritten (language, events, cost and memory pages; kind badges in the API reference).
- **Checked in a browser** (headless Chrome): Code tab on starter classes, adding and wiring a node, typing a literal, undo, text edits driving the graph, the frozen banner, and a solo match with an upload over the wire.
- **Incident**: cleaning up a temporary `git worktree` of `main` (used to compare old and new behaviour) deleted part of `node_modules` through a Windows junction (`node_modules/.bin`, some packages). `npm ci` is needed to restore it, which requires stopping the running `npm run dev` processes (they hold native files open).
- Docs updated: `docs/game.md` (programs section), `docs/client.md`, `README.md`, `PLAN.md` (status and "What changed from the plan").

### flowcode M0: Rete + Lit spike
- Added exact-pinned client dependencies: `rete`, `rete-area-plugin`, `rete-connection-plugin`, `rete-render-utils`, `@retejs/lit-plugin`, `lit`, `@lezer/javascript`.
- `packages/client/spike/flow.html` + `flow.ts`: a throwaway page with four nodes and five wires using our own `<wst-flow-node>` and `<wst-flow-socket>` Lit elements (header colour by node kind, triangle exec pins, round data pins), typed-socket checks, pan/zoom/selection, and a Lezer TypeScript parse button for the `on(Detected, {...}, ...)` sample (good and broken). Checked in headless Chrome and in a production build (87 KB gzip). `tsconfig.json` now includes `spike`.

### flowcode M1: designer split into Design and Code tabs
- `designer.ts` is now `src/designer/`: `Designer.ts` (shell: tabs, footer, selected class, draft, unsaved edits), `DesignTab.ts` (class list, preview, stats, installed modules, catalogue), `CodeTab.ts` (editor, class picker, history, upload diff, sandbox test run), `shared.ts` (`DesignerActions`, `ProgramHistory`, the `DesignerModel` interface the tabs use), `index.ts`. Imports of `./designer` are unchanged.
- Design tab is three columns (classes, design, catalogue); Code tab gives the editor the full width, with the class chosen from a dropdown above it. The tab is remembered in `sessionStorage`. Upload on the Design tab switches to Code to show the diff. `style.css` and `docs/client.md` updated.
- Behaviour is otherwise unchanged; `npm test` (150 tests) and typecheck pass.

### flowcode branch: library research (no code yet)
- Compared editor libraries for the node-graph language: Rete.js v2 (maintained, TypeScript, framework-agnostic core, MIT), LiteGraph (original last released 2024; the maintained fork `@comfyorg/litegraph` is 3.7 MB and tied to ComfyUI), Drawflow (stale, untyped sockets), xyflow system (d3-based, React/Svelte oriented), Blockly (blocks, not wires).
- Pick: Rete.js core + area + connection plugins, rendered with Lit custom elements (`@retejs/lit-plugin`) rather than hand-written DOM. The engine owns the graph JSON format and interpreter, so the editor library stays swappable.
- `PLAN.md`: Q1 settled (sensor limits match the existing ranges, energy per sweep equals one `scan()`, short sensor = tier 1, long sensor = tier 2), Q2 deferred.
- `PLAN.md`: P1-P3 settled, and event sources became blocks that carry their own configuration (sensor `watch`/`range`/`interval`/`sort`/`limit`, `Order` filters, `Idle`/`Every` intervals, `Button` label and key). Only runtime settings stay as `config.*` nodes. Better sensors unlock more watched kinds, sort modes and reports per sweep.
- Updated `PLAN.md` with the O1-O5 decisions: `Idle` heartbeat event, configuration nodes distinct from actions, suspendable handlers (1024-unit benchmark), literals cost memory not energy, old language retired and ported (milestones re-ordered so the port comes before the graph view).
- Wrote `PLAN.md`: a single Flow IR shown as a graph or as TypeScript-subset text (kept in sync), event model, cost model (nodes + arcs), engine and editor architecture, milestones M0-M7, risks and open questions.

### Sounds and music mounted from outside the image
- `sound/` is no longer copied into the server image; `docker-compose.yml` mounts `${SOUND_PATH:-./sound}` read-only at `/app/sound` (with `SOUND_DIR`), next to the existing music mount.
- `soundmanifest.test.ts` loads the manifest with an optional `import.meta.glob` and skips when `sound/` is absent, which fixed the ENOENT failure in the GitHub Action `verify` job.

### Terrain visuals: rounded rock, depth shading, seam fixes
- `Renderer.layout` draws rock through a shared `fillShape` helper: convex corners (both sides facing tiles outside the shape) are rounded with radius 0.23 tile, in the fill and in the outline (edges trimmed, arc added). Concave corners stay sharp.
- Three rock tones by depth: base `0x343b47`; depth 2 (all eight neighbours solid, map edge counts as solid) `0x414a58`; depth 3 (all neighbours depth 2, the heart of large outcrops) `0x4d5767`. Inner tiers share the rounded corners. Depth is a small per-layout pass, not per frame; layout only reruns when its key changes.
- The 8-tile grid is drawn before the rock fills so it no longer shows through solid sections.
- The horizontal lines over rock were the fog layer: its row rects overlapped by 0.5px, doubling the translucent fill into a seam every tile. `drawFog` now snaps rect edges to whole pixels so rows meet exactly.
- Not yet checked in a browser.

### Fair maps, shuffled starts
- `generateTerrain` now opens base clearings and the carved connecting corridors through a four-way mirrored `open()`, and only checks the top-left quadrant for reachability. Previously corridors were carved per corner in order, so player 1 (first corner) got a private straight route to the centre on Badlands. Every map is now exactly symmetric (new test).
- Start corners are random: `Match.freeCorner/randomFreeCorner` pick a free corner for each human and each human's bot (was fixed slots 0/2 with the bot next door). Bots are named by free name ("Bot 1"/"Bot 2"). Uses `Math.random` server-side, not the sim RNG.
- sim.test: the harvester swap test now empties the harvester's cargo (it was seed-dependent and shifted by the terrain change).

### Options screen; slimmer music widget
- Main menu has an Options view (music volume, effects volume, mute all). `MusicPlayer` now exposes `muted/setMuted/volume/setVolume` and `musicPlayer()`; the widget is just the mute button plus the track title (no sliders).
- Options panel uses the shared glass panel style; every checkbox in the app is now a glass slide toggle (global `input[type=checkbox]` rule in style.css).
- Not yet checked in a browser.

### Charging pad pulse
- New `SimEvent.Charge` (pad, pad). `chargingSystem` keeps a smoothed (10% per tick) energy/tick delivery rate per pad; while it is at least 5 (about a quarter of one unit's full rate) the pad emits the event every 20 ticks, so a unit sipping the last few points doesn't keep it running. Renderer draws a slow (2 s) green ring easing out from the pad centre to the edge of its charge zone, with a faint fill. Typecheck and tests pass; not seen in a browser, no dedicated test.

### Mid-build sparks and a bigger completion burst
- `makeBuildSparks` takes an optional `count`. While a site is being built, each Build event has a 10% chance to throw off 1-2 grid sparks (renderer, capped at 100 live effects). With no count it is the completion burst: now 16 + 8 per footprint tile sparks (max 64, was 8 + 4/tile, max 28), plus a 450 ms flash: white wash over the footprint and two expanding rings. Test added. Typecheck and tests pass; not seen in a browser.

### Build beam effect
- New `SimEvent.Build` (builder, site), emitted by `buildSystem` every other tick while a builder actually invests matter. Renderer (`drawBuildBeams`) draws a continuous cyan laser from the build arm to a point that rasters across the site's footprint (fast sideways sweep, slow top-to-bottom), with a faint scan line across the site at the current row, a glow, a white core and a hot spot. Lingers 350 ms after the last event. Distinct from shots (instant owner-coloured line) and repair (green ribbon with dots). Typecheck and tests pass; not seen in a browser.

### Builders spread over free sites
- `Simulation.nearestSite` (used by the Builder and Construction Tower programs when idle) now counts how many other own builders already have a site as their BUILD task / current target, and prefers the least-claimed site (nearest among ties). Builders only share a site once every site has someone on it. Orders given by the player are unchanged. Test in `engine/test/sim.test.ts`.

### Building completion sparks
- New `client/src/buildSparks.ts`: when a construction site finishes and the building stands, bright streaks (same colours as the menu sparks, soft blue glow) leave the footprint outline and run along the tile grid lines. At every crossing a spark goes straight or turns left/right at random, but never towards the building, and each fades with distance covered. Routes are rolled up front (`makeBuildSparks`); `drawBuildSparks` walks them each frame. Hooked into `renderer.ts` `sync` (via `Construction.removed`) and the Graphics pass beside the explosions. Count scales with footprint (8 + 4 per tile, max 28). Test in `client/test/buildSparks.test.ts`. Typecheck passes; not seen in a browser.

### Connecting screen
- New `client/src/connecting.ts` (`ConnectingScreen`) and a `#connecting` element in `index.html`/`style.css`: a full-screen cover with a centred "Connecting…" title, a scrolling list of progress lines and a sweeping bar, shown from when a match page starts until the server's `welcome` arrives. Real steps (music library, sound bank, graphics engine, server link open, map received) get a green tick; grey made-up lines ("Calibrating flux capacitors…") fill the gaps. It fades out via `setShown`, after a 600 ms minimum so it never flashes. A refused connection turns it red with the reason; a dropped first connection adds a "retrying" line. Typecheck and tests pass; not seen in a browser.

### Warn on unparseable manifests
- New `server/src/manifest.ts` `readManifest(dir, name)`, used by `loadSounds` and `loadTracks`: a missing file is silent, but invalid JSON or a non-array logs a `[manifest] ...` warning (once per distinct message, since manifests are re-read per request). Test in `server/test/manifest.test.ts`.
- Main-menu updates list (`changelog.ts`): added a 2026-10-19 entry for group move spreading and the sound effects system.

### Sound manifest fix
- `sound/sound_manifest.json` was invalid JSON (missing comma after the last sound entry, before the tag entries), so the server returned an empty bank and no effects played. Added the comma. The server drops a bad manifest silently, which hid it.

### Group move orders spread out
- `Simulation.freeMoveTile`: plain Move orders (right-click on ground, and the Move button) pick the nearest walkable tile to the click that no other unit is parked on or already ordered to, so a group fans out around the point instead of stacking. Attack-move, harvest and other target orders are unchanged. Test in `engine/test/sim.test.ts`.

### More dramatic explosions
- `renderer.ts` `drawExplosion`: deaths now add a white-yellow light flash with a warm glow, a two-tone fireball, a second thin white shockwave, spark streaks, falling debris and drifting smoke, on top of the red ring. Fragments are rolled per blast (`makeExplosion`) and scale with blast radius; bigger blasts last longer (`EXPLOSION_MS` + `EXPLOSION_MS_PER_TILE`). All expansion uses ease-out. Typecheck passes; not seen in a browser.

## 2026-10-18

### Animated menu transitions
- New `client/src/transition.ts` (Web Animations API, honours `prefers-reduced-motion`): `swapContent` eases the old menu view out (ease-in, slides and fades), swaps it, then eases the new one in (ease-out); the slide reverses when returning to the main menu. `setShown`/`isShown` fade-and-rise overlays with ease-in-out and set `hidden` only after the close finishes.
- Used for the lobby view changes (`lobby.ts` `go`), the lobby and in-game API docs overlays, and the Designer overlay (`designer.ts`, which now reads `isOpen` instead of `root.hidden`). Typecheck passes; nothing was seen in a browser.

### Sound tags: one `menu.click`
- The per-section `menu.single_player` / `menu.multiplayer` / `menu.credits` / `menu.docs` / `menu.designer` tags are replaced by a general `menu.click` (next to `menu.enter` and `menu.back`) in the manifest, `lobby.ts`, `index.html` and SOUND_EVENTS.md.

### Sound effects system (SOUND_EVENTS.md)
- Server: `server/src/sound.ts` loads `sound/sound_manifest.json` (sound-file entries plus tag entries; missing files and malformed tags dropped) and serves `GET /api/v1/sound` and `/api/v1/sound/<file>` (manifest-named files only). `SOUND_DIR` overrides the folder; the Dockerfile copies `sound/` into the server image. Tests in `server/test/sound.test.ts`.
- Client: `soundbank.ts` flattens the manifest once (own sounds + chained `use` references, `only`, cycle warnings, parent-tag fallback, inherited cooldown/voice/positional settings) and picks at random without repeating the last choice. `sound.ts` plays with Web Audio (decoded buffers, pitch variance, distance attenuation and panning, cooldown, voice limit, looping ambient layers with fades, effects volume saved in `wst-sfx`, follows the music mute button, unlocks on the first gesture). `uiSounds.ts` covers every button/select/checkbox/slider/typing on the page (`data-sound` overrides, `none` silences). `input.ts` plays selection/order/build sounds; `gameSounds.ts` maps server messages and per-tick world changes (shots, deaths, hits, spawns, completions, cargo, charge, CPU state, power and credit alerts, radar) to tags; `renderer.listener()` gives the view for positional sounds. Tests: `soundbank.test.ts`, and `soundmanifest.test.ts` (every tag the client plays must be listed in the manifest).
- Manifest: `sound/sound_manifest.json` now has an empty ("plays nothing") tag entry for each of the 142 events in SOUND_EVENTS.md, with cooldowns/voice limits for the noisy ones; the existing UI Authorised sound is tagged `ui.confirm` and `match.start`. Several tags are not hooked yet (listed at the end of SOUND_EVENTS.md). No sim events were added. Docs: `docs/client.md`, `docs/server.md`, `docs/deployment.md`. `npm test` and typecheck pass; nothing was heard in a browser.

### Sound event tag list (SOUND_EVENTS.md)
- Update: the whole tag list is kept. Added reference entries to the manifest design (`{ "tag", "use": [...], "only"? }`, chained, merged random pool, cycles reported at load) and a load-time flattening scheme so triggering is one lookup plus one random index. The file now lives at the repo root.
- New `SOUND_EVENTS.md`: proposed manifest tags for menu, lobby, match lifecycle, in-game UI, world SFX, alerts and ambience, each marked with its source (existing `SimEvent`, server message, client UI, or a new sim event still needed), plus the random-pick rule, fallback chain and optional entry fields. Documentation only; no code or manifest changes and no audio player exists yet.

### Review fixes: power routing, match lifecycle, renderer (REVIEW.md)
- Engine power: `power.ts` gains `powerTopology()` (clusters, bridges, per-cluster routes and member buckets, built once per rebuild) and `emptyNetwork()`; `Simulation.rebuildNetworks` is now a short caller. `routeEnergy` gives each cluster its proportional share, then a cleanup pass lets clusters still short take idle energy (own cluster first), so a capped bridge no longer strands a base's own generation; bridge caps count flow in both directions. `powerSystem` buckets members per cluster in one pass (no `filter`/`indexOf` in loops). New `engine/test/power.test.ts`. The bridges form a tree because `powerLinks` is a spanning forest, so the "parallel bridges" review item was closed as not a bug.
- Protocol: new `forfeit` and `leave` client messages (`resign` stays as a legacy alias), `ClientPhase` + `messageAllowed()` shared by server and client, `lobby.mode` typed as `GameMode`.
- Server (`match.ts`): `forfeit` marks the player defeated immediately via `defeat()` (the scoreboard loop uses it too), so a resign can't leave a player in limbo or start a reconnect wait; `removeForces()` shared by forfeit and leave; `loadDesigns` outside a match is answered with an error `designsLoaded`; `lobbyMessage()` used by the report and by `sendWelcome`; host and `minPlayers` come from their getters only. Tests added for forfeit, leave and the lobby design reply.
- Client: renderer clears `lastHp`/`blastRadius` on despawn and full snapshots (no more phantom damage numbers), pools damage-number `Text`s and restyles power labels only when the colour changes; menu spark timer stops while hidden and reads the drift period from the animation; `Ui` takes `startGame`/`spectate`/`leave` as constructor handlers and binds the Power hover there; `defeated` and `inLobby` moved to `ClientState`; the pause panel offers the invite link again while waiting for another player; the Resign button sends `forfeit`, and leaving sends `leave`.
- Docs: `docs/server.md`, `docs/game.md` updated. Not done (see REVIEW.md): explicit match/player state machine, per-tick elimination check, one per-entity renderer record, `SimEvent.Damage`, per-bridge flow animation, `DesignStore` sync marker, `showPowerLabels` off `ClientState`. Nothing here was checked in a browser.

### Code review of today's changes (REVIEW.md)
- New `REVIEW.md`, a checklist for later fixing. It has two sections: correctness/performance (9 findings: capped bridges strand a cluster's own supply, `lastHp` causes fake damage numbers, resign limbo, `loadDesigns` dropped in the lobby, O(n²) cluster bucketing in `powerSystem`, Pixi text regenerated every frame, spark timer runs during matches, bridge cap enforced on net flow, dead invite link) and architecture (power topology belongs in `power.ts` and should be precomputed; parallel bridges are ignored; match/player phase booleans should become explicit states; defeat detection is inside the scoreboard report; `resign` is overloaded; the message allowlist is duplicated between client and server; renderer per-entity maps sit outside the sprite lifecycle; UI callback wiring is inconsistent; docs drift in `menuBackground.ts`). No code changed.

### Fix: units halting and ignoring orders (empty programs saved)
- Symptom: units move briefly after the game starts, then stop and stack up orders; the rest of the sim runs. Units execute tasks through their class program, and a class with an empty program goes CPU-offline.
- Cause (most likely, not yet confirmed against your browser's saved data): `DesignStore` autosaves `state.programs` into localStorage, and a save made while programs were missing wrote empty programs for default classes; the next game's session restore then applied them as "modified" designs ~300 ms after the start. My spectator switch triggered exactly that (the second `welcome` clears programs, and `blueprints` schedules a save).
- `client/src/designs.ts`: autosave is skipped while spectating or while no programs are loaded (`programsLoaded`); `restoreSession` now replaces an empty saved program of a default class with the default program, which also repairs data already saved.

### Game lobby and spectating
- Protocol (`net/protocol.ts`): new client messages `startGame`, `spectate`; new server messages `lobby` (players, hostId, mode, mapName, capacity, minPlayers), `started`, `defeated`; `welcome` gains `lobby` and `spectating`. `resign` now means "forfeit" while a player has forces.
- `server/match.ts`: `started` flag (solo starts at once; versus/co-op begin in a lobby with no bases and no game time). `reportLobby` broadcasts the occupant list on change; the host (lowest id present) sends `startGame` (needs `minPlayers`: 2 versus, 1 co-op/solo) and `startMatch` runs `setUpSide` for everyone (the old join-time set-up, shared with late joiners). Leaving the lobby is immediate (no reconnect grace); hosting passes on. Late joiners to a running match behave as before.
- Defeat/spectating: new `forfeit` command destroys the resigner's forces; `reportScoreboard` marks newly eliminated humans `defeated` and sends `defeated`. `spectate` (defeated players, or anyone once the match is over) sets `spectating` and re-sends `welcome` (fog false) with a full unfiltered snapshot; spectators then receive the unfiltered per-tick frame and their orders are ignored. A second `resign` from a defeated player (or in the lobby / a finished match) leaves for good; a defeated player disconnecting no longer starts the reconnect pause. Room list API adds `lobby`.
- Client: `ui.ts` waiting room (player list, host/you tags, invite link, Start/Leave), defeat dialog (Spectate / Leave to menu), spectating badge and `body.spectating` CSS hiding build bar/actions; standings screen now offers Spectate and Leave to the losers. `main.ts` wires them; Resign button text is Resign (Leave while spectating); orders are dropped client-side while spectating. `lobby.ts` room list shows "in lobby / waiting to start". The pause overlay no longer carries the invite link (the waiting room does).
- Tests: existing server tests start matches via `begin()` (host `startGame`); new `lobby` and `spectating` suites in `server/test/match.test.ts`. Docs (`docs/server.md`, `docs/client.md`) and changelog updated.
- Not changed: spectators do not appear in the room list or scoreboard; there is no way to join a room purely as a spectator, and no ready toggle (host starts).

### Link throughput caps and an honest Power meter
- Cause of the huge Power numbers: `demand` is the free room in every normal-mode store, not a draw, so `supply - demand` swung with how empty batteries/units were.
- Meter now uses `NetworkInfo.delivered` (new; energy normal consumers actually received last tick, incl. discharged storage): balance = generated - delivered (deficit only while storage is drained), bar = delivered / wanted. Script API `netDemand()` unchanged.
- Throughput caps: links up to `BASE_LINK_RANGE` (1 tile) are uncapped. Longer (antenna) links carry at most `antennas x footprint x ANTENNA_THROUGHPUT_PER_TILE` (20) energy per tick, using the stronger end; links to construction sites stay uncapped. New `BlueprintStats.linkThroughput`.
- `rebuildNetworks` splits each network into clusters (joined by uncapped links) and capped `bridges` (`PowerNetwork.clusterOf/clusters/bridges`). `powerSystem` now distributes per cluster with `routeEnergy` (`power.ts`): each cluster gets its proportional share, pulls from itself then nearest clusters limited by free bridge capacity; same three phases (generation to normal, discharge for the shortfall, leftover to charging). Networks with no long links behave exactly as before (all 114 existing tests pass). New tests in `sim.test.ts`; docs updated (`docs.ts`, `docs/game.md`).
- Not changed: the link-flow dot animation still approximates flow from per-building take/give, so it does not show a cap.

### Death explosions
- `renderer.ts`: `SimEvent.Death` now spawns an `Explosion` at the entity's last position: a red (`EXPLOSION_COLOUR`) filled ring that expands and fades over `EXPLOSION_MS` (500 ms), drawn in the overlay. Radius is remembered per entity in `blastRadius` (0.9 tiles for units, 0.75 x footprint for buildings) since stats are gone once it dies. Also fires for decay deaths. Not yet seen in a browser.

### Power meter hover labels
- Hovering the Power tile (`ui.ts`, listeners on the stable `#environment` container since the tiles are rebuilt every tick) sets `ClientState.showPowerLabels`. While set, `renderer.ts` `drawPowerLabels` puts a Pixi `Text` on every on-screen own building with non-zero network `flow`: `+N` in the meter's green for supply (negative flow), `-N` in its red for load. Colours are `POWER_GOOD`/`POWER_BAD` (mirror `--good`/`--bad`). Units are energy per tick, last tick. Not yet seen in a browser.

### Floating damage numbers
- `renderer.ts`: when a replicated `Health.hp` drops for a visible entity (compared with `lastHp`), a Pixi `Text` with the damage is spawned just above it in `damageLayer` (above the overlay). It is pinned to a world position, rises `DAMAGE_NUMBER_RISE` (1.2 tiles) and fades out over `DAMAGE_NUMBER_MS` (900 ms), then is destroyed. Client-only: derived from health deltas, so no engine/event changes. Not yet seen in a browser.

### Menu background sparks
- `menuBackground.ts` `startSparks`: every 80-220 ms (max 30 alive) a short bright streak is spawned on a random on-screen grid line and runs 10-25 cells along it (180 px/s), fading in and out. Sparks are children of the scrolling layer so they stay on their line as the grid drifts; each is one element moved by the Web Animations API (compositor) and removed on finish. Skipped when the menu is hidden, the tab is in the background, or reduced motion is set. Styles `.menu-bg-spark` in `style.css`. Not yet seen in a browser.

### Menu frame alignment
- `style.css`: `#lobby fieldset { margin: 0; min-width: 0 }`. The Game type fieldset (`.mode-picker`) kept the browser's default 2px side margin while the Map fieldset reset it, so their borders were offset by a few pixels.

### Spark tail length parameter
- `menuBackground.ts`: new `SPARK_TAIL` (px, default 48) sets each spark's `--spark-tail` CSS variable, which `.menu-bg-spark` in `style.css` uses for its length.

### Sparks: longer-lived and more frequent
- `menuBackground.ts`: sparks now spawn about every 100 ms (~10 Hz), run 10-25 cells at 80 px/s (about 5x the previous lifetime, ~10 s on average), and the cap rose from 3 to 120 so it no longer throttles the spawn rate (~100 alive at steady state). If this costs frame rate, lower `MAX_SPARKS` or the spawn rate.

### Hover highlight
- `style.css`: buttons, `a.button`, selects, `summary`, map choices and designer class items brighten (`filter: brightness(1.25)`) with a faint accent glow on hover, with a 0.12 s transition; enabled text inputs/textareas get an accent border. Disabled buttons and `button.link` are excluded. Not yet seen in a browser.

### Menu panel falloff
- `style.css`: menu panels (`#lobby section, aside, fieldset, .lobby-name-screen`) gained a soft dark `box-shadow` halo (`0 0 22px 8px`) so the backdrop grid fades out around each panel; the glass `backdrop-filter: blur(3px)` and fill are unchanged.

### Lighter menu background
- Revised: the 3D tilt was dropped in favour of a flat 2D scroll (same pre-painted tile, 48px cells, 40 s per tile, radial edge darkening; no `perspective`/`rotateX`). The description below is of the first, perspective attempt.
- `menuBackground.ts` no longer redraws a perspective grid on a canvas every frame (thousands of path segments, three glow strokes and a gradient per frame). It paints one seamless 1280px grid-and-terrain texture once (value noise wrapped so it tiles), and CSS does the rest: `#menu-bg` in `style.css` tilts a plane with `rotateX(70deg)` under `perspective: 500px`, a transform animation scrolls the texture diagonally (55 s per tile), and a gradient overlay fades the distance. No JS per frame; a `MutationObserver` on the lobby's `hidden` attribute hides it (`display: none` stops the animation) when a match starts. Reduced-motion still disables the scroll.

## 2026-10-15

### Wrap-up: What's new, TODO
- `changelog.ts`: 2026-10-15 block gained the online-count, terrain-edge, unit-cap, placement-vision and Units-bar entries. TODO.md: play-test items for each of those.

### Unit count bar
- The bars redraw every 5 ticks from the tick handler in `main.ts`, so the unit count follows production and losses between credits/network messages.
- Resource bars (`ui.ts` `renderResourceBars`) gained a third "Units" bar under Matter and Energy: own mobile units / `MAX_UNITS_PER_PLAYER` (`GameState.ownUnitCount`).
- The server's produce check (`match.ts`) now counts only mobile units too (it counted buildings and sites before, which the bar would have misreported); buildings are limited by sites/cost, not the unit cap.

### Buildings must be placed inside vision
- `Simulation.placeBlueprint` rejects a site whose centre is outside the vision of the owner (or their team; unfinished sites don't give vision for this) with "You can only build where you have vision". Enabled via `sim.requirePlacementVision`, which `Match` sets from its `fog` option (so `FOG=off` keeps placing anywhere). Shared helpers `inVision` and a `skip` filter on `viewersOf` in `vision.ts`.
- Client: `GameState.canPlaceInVision` feeds the placement ghost's validity (red outside vision, `input.ts`); API docs "Placing buildings" mention it. Test added in `sim.test.ts`.
- Note: `sim.test.ts` "a harvester with nothing to do goes back to a storage building" fails with the working-tree `NEUTRAL_UNITS = 15` (passes at 4) - unrelated to this change.

### Unit cap 80 -> 256
- `MAX_UNITS_PER_PLAYER` in `rules.ts` raised from 80 to 256 (single constant; the server's cap check and error message follow it). ECS storage grows on demand, so no other limit changed. Cost is linear in unit count (scripts, separation, spatial grid, sprites); not yet profiled with a full cap.

### Terrain edge highlight
- `renderer.ts` `layout()`: after the solid fill, only the tile sides of solid terrain that border passable terrain are stroked (light blue-grey, width scales with zoom); interior wall faces and the map border get no line. Not yet seen in a browser.

### Menu players count as online
- Players sitting on the menu now count in the multiplayer "N players online" line. The lobby holds an idle presence WebSocket (`/api/v1/ws?menu=1`, `announceMenuPresence` in `lobby.ts`); the server tracks them in `menuSockets` and reports `GET /api/v1/menu` -> `{players}` (`server/src/index.ts`). The lobby adds that to the in-match total and shows "In the menu: N". Room list and `/rooms` shape unchanged. Not yet tried in a browser.

### Wrap-up: dev-server stale module, changelog, TODO
- Diagnosed a broken map (all sprites at the origin) as Vite serving a stale transform of `renderer.ts` (the `drawRepairs` call without the method), which threw every frame and stopped Pixi's ticker. Touching the file fixed it; a headless-Edge probe of `/?room=...&mode=solo` showed no exceptions afterwards. No code change. If it recurs: hard-reload, save the file again or restart `npm run dev`.
- Main-menu "What's new" (`changelog.ts`): new 2026-10-15 block covering the larger environment tiles, smaller batteries and starting storage, laser drain, unit production energy, storage recharge fix, repair module/drone/action/effect, and the menu background/font/layout changes.
- TODO.md: added play-test items for this day's changes.

### Repairs cost matter; Repair action; repair effect
- Repairs now cost energy **and matter**: `REPAIR_MATTER_PER_HP` 0.1 per hp mended, `REPAIR_ARMOR_MULTIPLIER` 4x for armour plating (`rules.ts`); per-class stat `repairMatterPerHp` (`blueprint.ts`). Matter comes from the cargo bay on a unit, the owner's silos on a building (`canSpendMatter`/`spendMatter`); bought in whole units with leftover credit in `sim.repairCarry`; no matter = no repair. `repair()` docs and the Designer's Repair row say so.
- Repair Drone gained a cargo bay: it fetches matter from the nearest stocked silo (`take`) and works REPAIR tasks, picking the nearest damaged own thing itself when idle (`content.ts`).
- New task type `TaskType.Repair` (script constant `REPAIR`) and a common **Repair** action (key R, aimed, `actions.ts`; needs a repair module and a motor). Click a damaged own unit/building, or a point (nearest damaged); right-clicking a damaged own unit/building with a repair-capable unit issues it too (`simulation.ts` `issueCommand`/`issueOrder`, new `nearestDamagedOwn`). `order()` accepts it for buildings. Class scripts decide how to carry it out, like every other task.
- New `SimEvent.Repair` (every other tick while repairing); `renderer.ts` `drawRepairs`: soft green ribbon with white dots running repairer -> target, a breathing ring on the target, and rising "+" crosses; repair routes are drawn in the same green. Tests updated/added in `rules.test.ts` (113 pass); not yet seen in a browser.

### Repair module, Repair Drone, tower repairs
- New module `repair.beam` (slot `repair`, code 17 / `M_REPAIR`, `Caps.Repair` / `CAN_REPAIR`; mass 3, 4 hp/tick, 8 energy/tick; fits units and buildings; switchable; production energy 40). Stats `repairRate`/`repairUse` in `blueprint.ts`, tuning in `rules.ts`, catalogue in `parts.ts`.
- Reach follows the build range: 1.5 tiles from a unit, 4 from a building's edge. Works both ways (units mend buildings, buildings mend units), own units and finished buildings only, never beyond max hp.
- New `Repairer` component and `repairSystem` (`systems.ts`, runs after `buildSystem`). New script builtins appended to `UNIT_API` (`api.ts`): `repair(h)`, `nearestDamaged()`, `hpOf(h)`.
- New starter class **Repair Drone** (medium chassis, CPU, small motor, repair beam, cell; `content.ts`): follows MOVE/STOP/CHARGE/SUPPLY, idles by repairing the nearest damaged own unit/building. It is in `STARTER_CLASSES`, so it is buildable from factories, but not in the starting base.
- Construction Tower gained a repair beam; with nothing to build its script mends the nearest damaged own thing in reach.
- Client: Designer lists the module under Industry and shows a Repair stats row; buildings with a repair module are categorised Construction. Two tests in `rules.test.ts`; suite passes (112).

### Fix: energy storage refusing to charge
- Cause: a storage left in DISCHARGE or HOLD that drained to 0 energy had no power for its CPU (`NoPower`), so its script could never switch it back; DISCHARGE/HOLD stores take no charge, so it stayed dead even with surplus on the grid.
- Fix (`powerSystem`, `systems.ts`; `STORAGE_RESERVE_FRACTION` = 2% in `rules.ts`): a store below 2% of capacity is treated as a normal consumer whatever its mode, and discharging never takes it below that floor. Regression tests in `rules.test.ts`.

### Energy cost on build buttons
- Building buttons show `◆matter ϟenergy` (energy = `buildEnergyCost(footprint)`) and unit production buttons show `◆matter ϟbuildEnergy` (`ui.ts`); tooltips include both. Typecheck only.

### Energy cost to produce units
- New stat `buildEnergy` (`blueprint.ts`): `PRODUCTION_ENERGY_PER_MODULE` (5) per non-chassis module plus `PRODUCTION_ENERGY_BY_SLOT[slot]` (cpu 30, memory 10, motor 40, sensor 20, weapon 60, armor 15, cargo 20, battery 10, factory 50, depot 10, charger 20, generator 30, antenna 15, builder 40, radar 40), in `rules.ts`.
- `productionSystem` (`systems.ts`) spends it on top of `factoryUse`, spread evenly over the build time with exact whole-number steps; a factory short of energy stalls like before. Shown in the build-bar tooltip and the Designer's Cost row (`ϟ`). New test in `sim.test.ts`.

### Lasers drain the grid
- `laser.beam` energy per shot 20 -> 100 (`rules.ts`); damage per shot is unchanged at full power (it scales with energy spent / max), so a firing laser now draws 12.5/tick (was 2.5), about five solar panels at peak sun. Suite passes (107).

### Environment tiles re-laid out
- `.env-tiles` (`style.css`) is now two columns (Daylight, Wind) with the Power tile as a full-width strip beneath (icon, label, value on one row, bar under). Tiles have `min-width: 0` and values are non-wrapping with an ellipsis, so long numbers can't stretch the panel. Typecheck n/a (CSS only).

### Top strip made compact
- The map's top strip (`#hoverbar`) overflowed the screen: bars 60 -> 36px, gaps 16 -> 10px, CPU cell 160 -> 130px and each stat's value cell cut to its minimum width (`style.css`). The single-unit Energy stat now shows just the percentage (capacity is in the Designer and `energyMax()`). Typecheck only.

### Fixed-width stats in the map's top strip
- `#hoverbar` stats (`ui.ts` `stat()` adds a `stat-<label>` class; `style.css`) get a fixed-width value cell per stat (health, energy, cargo, silos, built, making, tasks, grid, grid store), so neighbouring stats no longer shift as values change digits. Typecheck only.

### Fixed-width resource amounts
- The side-panel resource bars' amount column (`#resource-bars .res`, `style.css`) is a fixed `14ch`, right-aligned and non-wrapping, instead of `auto`, so the bars no longer change width as matter/energy values change digits.

### Smaller batteries; small starting storage
- `battery.cell` 1000 -> 500 and `battery.bank` 5000 -> 2500 energy (`rules.ts`). Frames' own energy is unchanged.
- New `SMALL_STORAGE_CLASS` ('Small Energy Storage': small frame, CPU, 2 banks = 5000 energy, was 40000 for the starter store) in `content.ts`, sharing the storage program with `STORAGE_CLASS`. The starting base now uses it (`BASE_LAYOUT`); the full Energy Storage remains a buildable starter class. `sim.test.ts` updated; full suite passes (107).

### Bigger daylight / wind / power indicators
- The side-panel `#environment` line is now three tiles (`.env-tiles`, `style.css`; built in `Ui.renderSelection`, `ui.ts`): Daylight (yellow), Wind (blue) and Power balance (green, red when in deficit), each with a 24px icon, 16px bold value and a fill bar (power bar = supply / demand). Typecheck/browser check pending.

### Animated menu background
- New `client/src/menuBackground.ts`: a fixed canvas (`#menu-bg`) behind the lobby draws a slowly, diagonally scrolling grid (48px cells, ~9px/s) with some cells filled from deterministic value noise of their world coordinates, so it reads like map terrain and scrolls endlessly with no wrap seam. Started from `showLobby`; pauses itself when the lobby is hidden; static under `prefers-reduced-motion`. `#lobby` now sits above it (`style.css`). Typecheck only; not yet seen in a browser.
- Follow-up: the backdrop is now a perspective ground plane (`menuBackground.ts`): the grid recedes to a horizon at 30% screen height, drifts diagonally towards the viewer, and fades into near-black with distance (gradient overlay). Cells and noise are unchanged; constants (`TILE`, `DRIFT_*`, `V_FAR`, `HORIZON`) tune the look. Typecheck only.
- Grid lines now glow: two wider, faint blue strokes under a brighter 1px core, drawn before the distance fade so the glow fades too.
- Lobby title (`#lobby h1`, `style.css`) enlarged from 16px to `clamp(32px, 6vw, 56px)` with a soft blue glow; the in-game `h1` is unchanged.
- UI font is now Electrolize (Google Fonts links in `index.html`; first in the `:root` font stack in `style.css`, falling back to system-ui). Code/monospace areas keep their monospace stacks. Needs network access to fonts.googleapis.com; offline it falls back to system-ui.
- Menu text bumped by 0.5em: `#lobby` font-size is `1.5em` (13px -> 19.5px) and the lobby's px font sizes (menu buttons and their sub-text, mode tags, changelog, map-picker legend, h2s, link buttons) became em values so they scale with it. The docs overlay stays at 13px; the Designer and in-game UI are unaffected.
- Menu sections, asides, fieldsets and the name screen (`#lobby section/aside/fieldset/.lobby-name-screen`, `style.css`) now share a translucent panel (62% panel colour, border, rounded, 3px backdrop blur); rooms and changelog entries are translucent too. The split layout's right aside lost its left-border/padding special case since it is a full panel now.
- Music widget (`.music`, `style.css`) moved from bottom-right to top-left on the main menu and sub-menus. In a match it is still docked in the side panel.
- Multiplayer screen: an "N players online" line above the room list (`#lobby-online`, `lobby.ts`) with a per-mode breakdown (players in matches for Free for all, Co-op and Single-player). It is built from the same `/rooms` poll, counting every room with a connected player, solo rooms included (which the list itself still hides). Typecheck only.
- Designer: the music widget moves into the designer's top bar (before the close button) while the designer is open and returns to its old place on close (`placeMusic` in `music.ts`, slot `.designer-music` in `designer.ts`, `.music.inbar` in `style.css`). Typecheck only.

### Laser damage scales with power; `laserPower(energy)`
- Laser base damage cut 14 -> 8 (`rules.ts`, at its full 20 energy per shot). Damage is now `damage × energy spent / max energy`, so half power is half damage (minimum 1).
- New script builtin `laserPower(energy)` (`api.ts`) sets the energy per shot (1..max; 0 restores max) and returns the energy in use, or 0 without a laser. Stored as `Weapon.power` (`components.ts`), applied in `combatSystem` (`systems.ts`). The laser turret script mentions it; the default behaviour is unchanged (full power).
- Test added to `engine/test/turret.test.ts`; full suite passes.

### Tree-style build bar
- The build bar no longer lists every building in one scrolling row. The top level now shows **categories** derived from each building's modules (Production: factory; Construction: build crane; Defence: weapon/radar; Power: generator, battery, antenna; Logistics: silo, charging pad; Other), in `Ui.buildCategory`/`renderBuildBar` (`client/src/ui.ts`). Categories with a single building are folded into "Other", and if only one category exists its buildings are shown directly.
- Clicking a category pops a menu of its buildings up over the map (`#buildmenu`, fixed above the bar, closes on outside click or re-click); the category buttons stay in place. Custom building classes are categorised by the same rules. Typecheck passes; not yet seen in a browser.

## 2026-10-14

### Radar contacts drawn as the real unit art
- Report: radar seemed to show only enemies already in view. Checked the whole path: `Simulation.radarPulse` returns every non-allied unit in range regardless of fog (engine test with a contact 30 tiles away), and a new server test (`server/test/radar.test.ts`) confirms a Radar Tower in a fogged co-op match sends a `radar` message whose contacts include units the player cannot see. I could not find a fault in the client path by reading it, and could not run a browser here, so the cause is not confirmed.
- Made contacts unmistakable: each contact now carries its class (`RadarContact.blueprint`, 5th element of the wire entry) and the client draws a faded copy of that class's real art (pooled sprites in `radarLayer`, above the fog) with the blip marker still on top. Typecheck and the full suite pass.

### Radar Tower default class
- New starter class **Radar Tower** (`content.ts`: small frame, basic CPU, radar module, battery bank). Its script looks for a switched-on `M_RADAR` module and, when the radar has rested and the tower holds over half its energy, calls `radarPulse(500)` (a 20-tile ping) every few seconds; with the module off it does nothing. Joins `STARTER_CLASSES`, so it appears in the build bar and the docs; saved designs see it as a new default. Test added to `engine/test/radar.test.ts`; full suite passes.

### Radar module (pulse scan)
- New part `radar.pulse` (slot `radar`, tuning `radarMaxEnergy` 800) and script builtins `radarPulse(energy)` / `radarCooldown()`, constant `HAS_RADAR`, module kind `M_RADAR`. Range is `RADAR_ENERGY_PER_TILE` (25) energy per tile, cooldown `RADAR_COOLDOWN_TICKS` (100), blips fade over `RADAR_FADE_TICKS` (300) — all in `rules.ts`.
- Engine: `Simulation.radarPulse/radarCooldown/radarPulses` (cleared in `commit`). Server: `radar` message to the owner and allies. Client: `ClientState.addRadar`, blips and an expanding ring drawn in `Renderer.drawRadar` above the fog. Designer lists it under Sensors & weapons.
- Tests in `engine/test/radar.test.ts`; typecheck and the full suite pass. Not yet seen in a browser; no default class carries a radar yet.

### Charging pads deliver 2x
- New tunable `CHARGE_PAD_RATE_MULTIPLIER` (2) in `rules.ts`; `chargingSystem` gives each unit up to `chargeRate × multiplier` per tick, capped by the unit's free capacity and by what the pad's own store holds (so a pad on a weak grid or small battery is limited by supply, and a pad holding less than a full step now hands over what it has instead of nothing). The part description shows the effective rate.
- Fixed the server co-op test, which still expected the old endless bot production (now at least the 2-unit first wave).

### Browser Back button steps up a menu level
- The lobby now keeps browser history (`lobby.ts`): opening Single-player, Multiplayer or Credits, the API reference overlay, or the Designer each pushes a history entry, and Back pops it instead of leaving the page. The on-screen "← Main menu" button and the docs/designer close buttons (and Esc) use the same history step, so the stack stays consistent. `Designer.onClose` / `LocalDesigns.close()` let the lobby notice the designer closing itself. Typecheck passes; not checked in a browser.

### README split into docs pages
- `README.md` is now a short overview (stack, layout, next steps, quick start) linking to `docs/client.md` (playing, designer, saved designs), `docs/game.md` (engine design decisions, co-op bots, language reference), `docs/server.md` (authority, rooms, fog, reconnect, music streaming) and `docs/deployment.md` (local running, Docker, CI images, music folder). Content moved, not rewritten, apart from a new co-op bots section in `game.md`.

### Bots build waves on demand instead of endlessly
- Bots no longer keep assemblers queued up to a unit cap. `BotPlayer.produce` builds only what the upcoming wave needs (staged + queued units count) and then stops; the next wave grows by `BOT_WAVE_GROWTH` and leaves no sooner than `BOT_WAVE_INTERVAL_TICKS` after the last. Tuned in `rules.ts`: first wave 2 units (was 4), +1 per wave (was +2), 2400 ticks between waves (was 1200), `BOT_MAX_UNITS` 24 (was 40). Test updated in `engine/test/bot.test.ts`.

### Music start made deterministic
- `MusicPlayer` no longer calls `play()` before the page has user activation (`navigator.userActivation` or its own capture-phase gesture listener) and does not rely on how a browser reports a refused `play()` (Chrome rejects, Firefox leaves it pending). The first click or key press starts the newest track; the widget shows the "click anywhere" hint until something is actually playing, and a real failure is logged as "Music could not start". Checked that the server serves the files correctly (200 and 206 with Range). The browser side is not yet confirmed.

### Idle music silent until the first fight
- The idle track was refused at autoplay and its retry only listened for window input events, which the map canvas can swallow; combat music then played because the page had sticky user activation by then. `MusicPlayer.nudge()` (called from `setContext`, at most once a second) now retries a paused newest track, so it starts as soon as the browser allows it.

### Music silent until a click
- Likely cause of "no music on the menu": the browser blocks autoplay until the page gets a click or key press, and the retry listeners were removed after the first gesture even if play still failed. Now the retry stays armed (capture phase, several event types) until playback really starts, the widget shows "click anywhere to start the music" meanwhile, and the track list fetch retries a few times if the server is slow. Failures are logged to the console.

### Credits screen
- New **Credits** button on the main menu lists every track from the server's music manifest (name, composer, site link, licence link), fetched from `/api/v1/music`. Only http(s) links are made clickable. Not yet checked in a browser.

### Music cross-fades
- `MusicPlayer` keeps one audio element per track: a context change, or a track reaching its last 1.5 s, starts the next random fitting track fading in while the old one fades out (previously fade-out, then start). Not yet checked in a browser.

### Music widget moved into the side panel
- In a match the music widget sits at the bottom of the left panel, directly above the designs bar (`MusicPlayer` `dock` option, `.music.docked`); in the menu it still floats bottom-right.

### Background music
- Server (`server/src/music.ts`): `GET /api/v1/music` lists the tracks in `music_manifest.json` (only files that exist, with known tags); `GET /api/v1/music/<file>` streams a manifest file with Range support. Folder is `MUSIC_DIR` (default `<project>/music`); Compose mounts `${MUSIC_PATH:-./music}` read-only at `/app/music`.
- Client (`client/src/music.ts`, `MusicPlayer`): `menu` tracks in the lobby, `idle` in a match, `combat` while any visible unit or building has lost health in the last 15 s (`ClientState.lastCombatTick`, set in `afterTick`). A track that fits the new context keeps playing; otherwise it fades out and a random fitting one starts. Track end picks another at random (no immediate repeat). Mute, volume (saved in localStorage) and a credit line linking to the composer's site sit bottom-right. Autoplay blocked by the browser is retried on the first click or key press.
- Tests: `server/test/music.test.ts`. Not yet checked in a browser.

### Compact map picker
- The map choice is now a five-row list (name and size) with a single preview and description for the selected map beside it, instead of ten preview cards. Previews are generated only when a map is selected. Not yet checked in a browser.

### Merged multiplayer browser
- Multiplayer and Co-op are one "Multiplayer" screen split in two: every open game (free-for-all and co-op, each tagged with its type) on the left, and on the right a create-room panel with a game-type choice (free-for-all or co-op), room name and a two-column map picker. Single-player keeps its own map screen. The Co-op menu button is gone; joining a game uses that room's own type.
- Stacks to one column on narrow screens. Not yet checked in a browser.

### Menu buttons dead after closing the designer
- The offline designer's full-page host element stayed on top of the menu after the designer was hidden and caught every click. It now ignores pointer events itself; only the designer inside it takes them (`#lobby-designer` in `style.css`).

### Main menu, offline designer and single-player
- The lobby is now a main menu: Single-player, Co-op, Multiplayer, Designer and API reference, with the player's name on top and "What's new" below. Each of the three game sections has a back button, a short description, its own room list (Multiplayer = free-for-all rooms, Co-op = co-op rooms) and a create form with the map picker; Single-player is just the map picker and Start.
- New game mode `solo` (`GameMode`): one human, one bot, same team and victory rules as co-op; capacity 1, a private room that never appears in the room list.
- API reference opens in an overlay over the menu (Esc closes; link to open in a new tab).
- Designer from the menu: new `client/src/localdesigns.ts` loads the designs saved in this browser (or the defaults) into a local class registry, compiles and checks programs with the engine's own compiler, and saves every change back to the same storage key, so the next match restores them. Class art previews use an off-screen Pixi renderer; the drawing code moved to `artstudio.ts` (`renderClassImage`) and `Renderer.previewImage` uses it. `snapshotDesigns`, `readStorage` and `writeStorage` are now exported from `designs.ts`.
- Tests: solo room case added (97 pass). The menu, overlay and offline designer are not yet checked in a browser.

### Factory buttons: responsive and square
- Cause of the missed clicks: the unit-creation buttons were rebuilt whenever the matter total changed (it was part of the rebuild key), so the element under the cursor was often replaced between press and release. They are now built once per building and class list, and only their greyed-out state is updated in place (`updateAffordability`).
- They now use the square action-button style in a 4-column grid, with the class's sprite, name and cost; tooltip gives cost and build time.
- Client typecheck, tests and build pass. Not yet checked in a browser.

### Harvesters no longer stall
- New script builtins: `nearestStorage()` (nearest own finished silo building, even if full) and `randomResource(k, min)` (a random one of the k nearest resources holding at least min matter, known map-wide).
- Starter Harvester: a field that drops to 4 or less is swapped for a random nearby one (`randomResource(4, 10)`) instead of ending the task; a full harvester waits when every silo is full; with no tasks left it docks at the nearest storage building (when carrying cargo or more than 2 tiles away) for new orders, otherwise picks a field itself.
- HQ and Resource Silo scripts now send each visiting harvester to a random one of the 4 nearest fields (no longer back to its last field), so one field isn't farmed out. The docs example matches.
- Tests: silo spread and the idle and spent-field cases (96 pass). A 12,000-tick single-player run kept both harvesters busy throughout, waiting only while silos were full. Players with edited copies of these default classes will be offered the new versions (the default fingerprint changed).

### Five larger maps
- Added Great Plains (128×128, open), Sprawl (112×112, scattered), Long Valley (160×80, ridges), Bastion (128×96, a rock ring around the centre with four gates; new `citadel` layout) and Badlands (144×112, dense). `MapDefinition` gained `density` (scales the amount of rock) and `outposts` (extra resource fields, three patches each, strung along each corner's route to the centre). Existing maps are unchanged.
- The lobby map picker is a fixed 5-column grid (two rows of five; two columns on narrow screens). Existing map tests cover the new maps (deterministic, clear starts); 95 pass.

### Co-op mode: bot opponents (humans on one team vs bots)
- New game mode `coop` (`GameMode`, `GAME_MODES`, `parseGameMode` in `game/map.ts`), chosen in the lobby's create form and carried in the URL and socket as `mode`. Rooms report their `mode`; the room list tags practice rooms.
- Co-op rooms hold at most two humans, in corners 0 and 2; each human gets a bot in the next corner (1 and 3). One human is enough for the game to run. A human leaving (or their reconnect grace expiring) removes their bot too. Bots are scored and listed like players and can win or lose the match.
- New `game/bot.ts`: a Bot Core (silos), three Assemblers (factories that produce non-stop) and two laser turrets, plus bot classes Grunt, Wasp, Lancer and Bulwark that unlock wave by wave. `BotPlayer` keeps assembler queues topped up (cap `BOT_MAX_UNITS`), holds the first wave until `BOT_FIRST_WAVE_TICKS`, then sends all staged fighters in attack-move at the human's nearest building to the bot's base. Later waves need more staged units; idle attackers keep pressing the next target.
- Cheating: `Simulation.cheaters` and `cheatSystem` refill every energy store and silo of a bot owner each tick, so bots never mine or run flat. Tunables (`BOT_*`) are in `rules.ts`.
- Teams: `Simulation.teams`/`allied()`. In co-op the humans are allied (no friendly targeting by scans or orders, shared vision) as are the bots. The match ends only when every bot (humans win together) or every human (bots win) is eliminated; `matchOver` now carries `winners`. The no-power rule is off in co-op (it ended a co-op match instantly because bots start with no mobile units). The standard mode is renamed Free for all in the lobby (id still `versus`).
- Tests: `engine/test/bot.test.ts` (base, churn, waves) and co-op cases in `server/test/match.test.ts`; 94 pass. Not yet play-tested; wave timing and strength are first guesses.

### Lobby release notes
- New `client/src/changelog.ts` holds short player-facing notes per update (newest first). The lobby shows them as a "What’s new" section under the room list: latest update open, older ones folded. Add a block there when a change matters to players.

### Player-facing text audit
- The tesla coil's description said "Range and timing are in rules.ts"; it now states the actual range, stun length, recharge time and self-stun share, generated from the `TESLA_*` rules. Checked the other part descriptions, API docs and starter scripts: no other developer references (script `#` comments are player-facing teaching notes).

### rules.ts is now the balance sheet
- `game/rules.ts` now owns `TILE` (re-exported from `parts.ts`) and every tunable gameplay number. Moved in: `DAY_LENGTH`, new `WIND_CHANGE_TICKS`, `UNIT_VISION`/`BUILDING_VISION`, new `SEPARATION_RADIUS`, `SPEED_FACTOR`, `BASE_STACK`, `BASE_LINK_RANGE`, new `COST_PER_MASS`/`CYCLE_COST`/`BUILD_TIME_BASE`/`BUILD_TIME_PER_MASS`, `SITE_START_HP`, `MAX_SITES_PER_PLAYER`, `MAX_PRODUCTION_QUEUE`, `MAX_UNITS_PER_PLAYER`, `MAX_CLASSES_PER_PLAYER` (server), `STARTING_CREDITS` (server), new `BASE_FIELD_PATCHES`/`CENTRE_FIELD_PATCHES`/`NEUTRAL_UNITS` (map), and `SOLAR_PANEL_OUTPUT`/`WIND_TURBINE_OUTPUT`.
- New `PART_TUNING` table: mass, hp, slots, energy, cycles, memory, thrust, sensor/weapon/antenna ranges, damage, cooldown, matter, cargo, harvest/charge/build rates, outputs and energy use for every module. `parts.ts` builds the catalogue from it, and module names and descriptions are generated from the numbers so they can't drift. Verified the catalogue is identical to before (only `gun.light` now states `kind: 'gun'` explicitly, its old default).
- Values are unchanged, so balance is as before; all 89 tests and typechecks pass.
- Not moved (design or technical, not tuning): starter class designs, base layout and starting units/charge in `content.ts`, VM limits, pathfinding costs and stuck detection, reconnect grace time.

### Tunable resource patch size
- New `RESOURCE_PATCH_AMOUNT` (400) in `game/rules.ts` sets how much matter a new natural patch holds; it replaces the private `FIELD_AMOUNT` in `map.ts`, and the patch sprite fade in the renderer scales against it. Patches regenerate up to this amount.

### Sharper sprites when zoomed in
- Sprite textures (units, buildings, resources) are now rasterised at 2× (`TEX_RESOLUTION` in `renderer.ts`); logical size and layout are unchanged.

### Hull variety and unit facing
- `art.ts` hulls now vary by loadout (`hullOutline`): arrowhead (gun), squat tank (cannon), swept dart (laser), spiked gear (tesla), cab-and-bed hauler (cargo), notched dozer (build arm), quad cross (rotor), teardrop and diamond (long/short sensor), octagon pod (no motor), capsule (batteries), disc otherwise. The armour rim follows the hull outline.
- Units now turn to face their last direction of movement (renderer keeps a per-unit facing, eased per frame by shortest angle, kept while stopped). Buildings, icons and designer previews stay facing up.
- Added a silhouette-distinctness test. Not yet checked visually in a browser.

### Module-driven unit and building art
- New `client/src/art.ts`: `lookOf(parts)` reduces a design to its role and features, and `drawLook` draws it. Hull shape follows the main job (arrowhead for armed, rounded box for workers/builders, slim diamond for scouts, disc otherwise); tracks, rotors, barrels (gun/cannon/laser/tesla), cargo box, sensor nub/dish, build arm, batteries, CPU chip and armour rim are added per module. Buildings get a plate style per role plus a grid of module glyphs (weapon, factory, solar, wind, charger, silo, battery, antenna, sensor, CPU) and an armour border.
- The chassis/frame still fixes the size (unit radius, building footprint). Sprites, build-bar icons and the placement ghost all use the new art.
- Designer: bigger preview on a one-square-per-tile grid at a fixed scale (so body sizes compare), plus true-size thumbnails in your colours and a rival's. `previewImage` now takes parts and pixels per tile.
- Added `client/test/art.test.ts`. Not yet checked visually in a browser.

### Solar and wind generation multipliers
- Added separate solar and wind output multipliers to `game/rules.ts`; the current user-edited values are 2× each, applied after daylight or wind intensity.
- The in-game power guide displays both current multiplier values.
- Transmission-loss coverage now derives its full-output expectation from the solar panel output and multiplier rather than assuming 1×; all 85 tests and workspace typecheck pass.

### Regenerating matter fields
- Natural map patches regenerate one matter every 10 ticks (1 second), capped at their starting amount. Depleted patches stay available for regrowth; matter drops remain finite, and resource scans skip empty patches.
- The in-game resource guide describes the rate and cap. Focused simulation and docs tests pass (31 tests).

### HTTP random-ID compatibility
- Replaced `crypto.randomUUID()` in reconnect-token and room-name generation with a shared helper that uses `crypto.getRandomValues()` when available and falls back when Web Crypto is missing.
- Tests: 84 pass. Browser-checked room creation and joining with `crypto.randomUUID` disabled.

### Docker deployment
- Added multi-stage images for the static Nginx client and the Node server with production-only dependencies; Compose publishes only the client port and health-checks the internal server.
- `/api/v1/rooms` and `/api/v1/ws` are reverse-proxied to the server, including WebSocket upgrades; Vite mirrors the same-origin proxy during development. Promoted `tsx` to a server runtime dependency and added `.dockerignore`.
- Validation: both images built; the versioned API returned 200 in Docker and Vite; the browser connected through the single published port and received a room invite link.
- Added a GitHub Actions workflow to build and push client/server image tags to GHCR on `main` and version-tag pushes.
- Compose now pulls `ghcr.io/johnvidler/webstrategything-{client,server}:latest` by default, with `IMAGE_TAG` override; `docker compose up --build` retains local builds.

### Selectable maps and silo dispatch
- Kept Crossroads and added Small Basin (48×48), Broken Country (72×72), Twin Ridges (80×56) and Highlands (96×80) with distinct deterministic terrain layouts. The lobby renders previews from each map's generated terrain and passes the selection into room creation; active rooms report their map and dimensions.
- The default Resource Silo now has compute/memory and sends visiting harvesters back to their last field, like the HQ.
- Tests: 82 pass. Browser-checked all five previews and map-specific room creation through the one-port Docker proxy.

### Sidebar header and resources
- Removed the duplicate matter amount/capacity readout from the header while retaining its internal value for production affordability.
- The header now shows the player's name and room on row one, then daylight, wind and net grid balance on row two. Matter and Energy resource bars now include matching symbols.
- CPU status in the map's top info bar now has a fixed 160px slot, so changing status text does not shift following stats. Client typecheck/build passed; browser-checked equal widths across status strings.
- Single-selection details now render as one `Key: value` attribute per line with tabular numerals; the live browser confirmed the multiline layout.

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

