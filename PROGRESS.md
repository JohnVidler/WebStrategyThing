# Progress log

Changes to the codebase, grouped by day (newest first).

## 2026-10-19

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
