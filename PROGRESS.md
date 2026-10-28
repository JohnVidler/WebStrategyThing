# Progress log

Changes to the codebase, grouped by day (newest first). Recent days are in detail; older days are summarised in "Earlier work". The full pre-2026-10-27 log is in git (commit `b449816`, `git show b449816:PROGRESS.md`).

## 2026-10-28 (bouncing explosion fragments)

- Client only (`shrapnel.ts`). A thrown fragment has a 40% chance (`BOUNCE_CHANCE`) of bouncing 1 to 3 times. Each bounce launches from where it landed, in a random direction, over the same flight time and 0.75x the first hop's distance (so 0.75x its speed, `BOUNCE_SPEED`; not compounding). `landFragment` runs at every landing, so each bounce also gets the small blast and sparks. Bounces reuse the list entry (no allocation, cap unchanged); `landShrapnel` takes an optional `rand`. Tests: `shrapnel.test.ts`. Targeted test and `npm run typecheck` pass; full `npm test` not run. Not looked at in a browser (see `TODO.md`).

## 2026-10-28 (units approach buildings from the nearest side)

- Engine, `findPath` (`path.ts`). A goal a unit cannot stand on (the middle of a building or site) used to be replaced by one cell, `nearestFit`, which breaks ties in scan order, so it was always the cell above the building, however far round that was for the unit (a builder would walk round a whole run of walls). The search now ends at the first cell it reaches that fits and is as close to the goal as the nearest fit (`reach`: its squared distance plus the ring, so the cells beside it count but not the far ring corners). f uses `h - 14 * ring` so it stays a lower bound. Normal goals are unchanged. Tests: `path.test.ts` (fail on the old code).
- Side effect, not fixed: bots now get builders to sites sooner, and the player-like AI on Crossroads builds an expansion silo less often (silo seen in 18 of 40 seeds before, 8 of 40 after; first silo is late either way, tick 3000+). Final building counts are higher after (about 52 against 35 to 43 in the seeds that did expand), so the likely cause is the bot spending its matter on other buildings before it can save the 300 an expansion needs (`expand`, `ai.ts`), but I did not confirm that. The `ai.test.ts` silo test (seed 7) passes. Worth a look when the AI is next tuned.
- `npm test` and `npm run typecheck` pass (the `perf-scaling` 128-unit fight failed once on a full run, passed on two re-runs). Not looked at in a browser.

## 2026-10-28 (news pop-in)

- Client only. The main menu's "Latest News" pop-in is wider (560px, was 420px), fits its content up to 80% of the viewport height (then the text scrolls; it was full height), and shows only the day's summary, one `<p>` per paragraph (as the news article page does), without the change bullets (`newsPane` in `lobby.ts`, `.menu-columns > .menu-news` width in `style.css`). `npm run typecheck` passes. `npm test` has 3 failures not from this change (`path.test.ts` x2 and the `zz_tmp.test.ts` probe, engine work by another agent). Not looked at in a browser.

## 2026-10-28 (diagonal wall joins)

- Client only. Walls that touch only at a corner (and neither side next to that corner joins) link with a slanted arm that runs a little past the corner to overlap the neighbour's arm (the wall texture is padded evenly by `pad` pixels, the same for every wall, so it stays centred and nothing else changes size). A first version clipped arms to their own tile and pinched at the shared corner; checked by drawing real Pixi walls in headless Chrome (diagonal continuous, no seams at whole-pixel scale). Four new mask bits (`WALL_NE`..`WALL_NW`, `joinWalls` and `drawWall`), so up to 256 cached textures per wall class (in practice far fewer). A wall with only diagonal joins is a diagonal bar round a hub. Test: every mask drawn inside the footprint (`art.test.ts`). `npm test`/`npm run typecheck` see below. Not looked at in a browser.

## 2026-10-28 (building frames hold far less energy)

- Engine balance (`PART_TUNING`, `rules.ts`): building frame energy cut to a tenth: small 200 to 20, medium 500 to 50, large 1000 to 100, shaped frames 560/780 to 56/78. Storage now comes from battery modules. Not rebalanced against starter bases or bots beyond the tests passing (`npm test`, `npm run typecheck`; one `perf-scaling` timing failure on the first run, passing on re-run). Playtest: check that starter buildings without batteries (pylon, wind turbine, solar, chargers) and bots' bases still behave.

## 2026-10-28 (armoured buildings are walls that join up)

- Client only. A square building with more armour modules than other modules (`isWall` in `art.ts`, new `Look.modules`) is drawn as a wall (`drawWall`): a plus within its footprint when alone, arms running to the tile edge on sides that join a neighbouring wall (a bar, corner or T), cells of a 2x2/3x3 wall joined to each other. Outline drawn by growing each piece first, so joins have no seams. Shaped frames are left alone. The renderer (`joinWalls`, `skin` in `renderer.ts`) works out, whenever `structureVersion` changes, which sides touch a wall of the same owner and gives each wall the texture for its 4-bit side mask (`bp:<id>:wall<mask>`, at most 16 per class, cached), so adjacent walls read as one barricade. Walls have no night window light. Nothing changes in the engine: walls already block movement and sight like any building. Cost: one pass over structures on a building change, nothing per frame. Test: `art.test.ts` (`isWall`). `npm test` and `npm run typecheck` pass. Not looked at in a browser (see `TODO.md`).

## 2026-10-28 (script call lightLevel())

- New script call `lightLevel()` (group Sensing, cost 1): ambient light 0..100 at the unit, from `Simulation.lightAt(x, y)` = `MOONLIGHT` (8, `rules.ts`) + sunlight scaled into the rest, so it follows the time of day (and the dev sunlight override) but never reads 0. It is ambient only: `lightAt` takes the position so local sources (lit buildings, flares) can be added later, but nothing varies by place yet. Named `lightLevel`, not `light`, because a variable may not reuse a built-in name and `light` would break saved programs that use it. The docs page lists it automatically. Test in `sim.test.ts`. `npm test` (two `perf-scaling` timing failures on one run, passing on re-run) and `npm run typecheck` pass. Not tried in a graph or text program in the editor.

## 2026-10-28 (time of day and weather in the World line)

- Client only. New `weather.ts` (`timeOfDay(tick, sun, fixed)`, `weatherOf(wind)`) and the World row of the Energy drop-down (`ui.ts`) shows e.g. "Evening · Breezy" on its right (the row's existing `extra` slot, so no new elements). Times: Dawn, Morning, Midday, Afternoon, Evening, Dusk, Night from the tick's place in the cycle and the sunlight; with a dev-tools sunlight override only the level is used. Weather by wind %: Calm under 10, Light breeze, Breezy (25), Windy (45), Blustery (65), Gale (85+). Test: `weather.test.ts`. `npm test` and `npm run typecheck` pass. Not looked at in a browser (see `TODO.md`).

## 2026-10-28 (sight range shrinks at night)

- Sight range now follows daylight. `visionAt(stats, sun)` (`vision.ts`) takes up to `NIGHT_VISION_FRACTION` (a quarter) of the range, capped at `NIGHT_VISION_LOSS` (3 tiles), in proportion to `1 - sun/100`: a 4-tile unit sees 3 tiles at full dark, a 6-tile building 4.5, long-range sensors lose up to 3. `viewersOf` and `visibleTo` take an optional `sun` (default 100 = unchanged, so other callers behave as before); the server fog filter (`Match.visibleTo`), building placement (`Simulation`), the player-like AI and the client fog (`ClientState.updateVision`, `canPlaceInVision`) all pass the current sunlight (`sunNow()` / `daylight`, so the dev sunlight override applies). Flying units are affected too. Smaller radii only, so shadowcasting cost does not rise; not measured. Client and server compute it from the same tick, so the fog the client draws matches what the server sends. Test: `vision.test.ts`. `npm test` (one `perf-scaling` timing failure in two of four runs, passing on re-run; it ticks fights, which do no vision work) and `npm run typecheck` pass. Not looked at in a browser (see `TODO.md`).

## 2026-10-28 (News summaries in paragraphs)

- `changelog.ts` now keeps blank-line separated paragraphs in a summary (joined with a blank line); the News article shows each as its own paragraph (slightly looser line spacing), the list card shows only the first. The 2026-10-28 and 2026-10-27 summaries were rewritten as short, warmer paragraphs with a shorter headline; the one disruptive change (Unload key) has its own closing paragraph. The format is noted in `AGENTS.md` and the `changelog.md` header. Test added; not looked at in a browser.

## 2026-10-28 (docs and News catch-up)

- Docs only. `README.md` layout and next steps now mention line-of-sight vision, scenarios, bot AI and the playtest phases; `PLAN.md` art follow-ups list what the module pass left (small glyphs, shaped buildings) and the pending browser checks; the 2026-10-28 News summary (`changelog.md`) now also covers mining sparks, brighter guns, wheels versus tracks and Orders above Build. No code changed, so tests and typecheck were not re-run.

## 2026-10-28 (inward sparks while mining)

- Client only (`sparks.ts`, `renderer.ts`). `Spark` and `BurstOptions` gained `inward`: the streak starts `reach` tiles out and speeds into the centre (position `reach * (1 - t^2)`), instead of flying out and easing off. The harvest event now bursts inward sparks onto the resource node (reach 0.5 to 1.05 tiles, so they come from across the ground patch, 280 to 520 ms) instead of spraying away from it; the old outward spray remains only as a fallback when the node's sprite is unknown. Same count, colours and spark cap (240). Not looked at in a browser (see `TODO.md`).

## 2026-10-28 (square ground patch under matter crystals)

- Client only (`renderer.ts` `resourceTexture`). The patch round a matter node is now square-formed: the two translucent blobs are chamfered slabs with slightly uneven sides, the ripple arcs are square corner brackets (one corner missing per ring), the grit is small squares and the sub-crystals are spread over a square (Chebyshev) instead of a disc. Same sizes, stages and counts. `npm test` and `npm run typecheck` pass (one full run showed a single `perf-scaling` timing failure that passed on re-run; no engine change). Not looked at in a browser (see `TODO.md`).

## 2026-10-28 (building night lights follow the building's shape)

- Client only (`renderer.ts` `buildingLight`, `art.ts` exports `buildingHalf`). The warm window light at night was always a rounded square round the whole footprint box, so L, T, +, U and H buildings glowed as a square and one-tile buildings (now drawn at about half a tile) glowed far wider than their art. Square buildings now size the glow from `buildingHalf` (the art's real size); shaped ones draw the three spill rings and a brighter core cell by cell, with strips only on outside edges and a quarter disc on each outside corner (no overlapping fills, so no bright seams between cells). Same ring count and alphas, a few more path shapes per shaped building at night; frame cost not measured. `npm test` and `npm run typecheck` pass. Not looked at in a browser (see `TODO.md`).

## 2026-10-28 (crystal matter deposits)

- Sub-crystals: up to 19 small shards (3, 7, 11, 15, 19 by stage) are scattered over the ground patch round the main cluster (golden-angle spread, deterministic), nearest-the-cluster ones kept longest, so the field empties from the edges in. Baked into the same stage textures, so no extra sprites. Tests and typecheck pass; not looked at in a browser (see `TODO.md`).

- Follow-up: deposits now have five looks by how full they are (`resourceTexture(stage)`: 4 full to 0, or -1 bare patch): shards drop away outer-first, the rest shrink, and the ground patch thins; alpha no longer fades. `ResourcePatch` (its `maximum`) is now networked so clients know a node's full size (sent once at spawn; no codec change); a node without it falls back to `RESOURCE_PATCH_AMOUNT`. Clicking matter nodes in the client shows a "Matter" x/y bar row (totals for several) in the Selection section and a "Matter deposit" heading (`ui.ts`, `.node-bar` in `style.css`). Tests and typecheck pass; not looked at in a browser. Not measured: the extra snapshot bytes for the new component (one u16 per patch, once).

- Client only (`renderer.ts`, `resourceTexture`). The single diamond is now five faceted shards (dark body, lit facet, white edge, as the unit hulls) with a highlight, on a baked ground patch: two wobbly translucent blobs, partial ripple arcs and scattered grit, about 2.6 tiles across. It is part of the same texture (one sprite per node, still on the ground layer under everything) and purely visual, so it has no collision and pathing is unchanged. Alpha still falls as the node empties (patch included). Deterministic shapes, no per-frame work. `npm test` and `npm run typecheck` pass. Not looked at in a browser (added to `TODO.md`).

## 2026-10-28 (bulkier building modules)

- Client only (`art.ts`, `factoryFx.ts`, `renderer.ts`). Factory, battery, solar, silo and charger modules on a building are now drawn at the size of the whole cell they sit in (`BIG`) instead of as small symbols: batteries are large external banks (two side by side from two cells up, terminals on top, charge bars); a factory is a workshop with two roof stacks and a roller door on its south face; solar is a panel array; silos are ringed tanks; chargers are pads. A square building with few modules is drawn as a smaller block inside its tile (78% plus 8% per module, full size from three), so modules visibly bulk it up; a building with no modules, and shaped buildings, are unchanged in size.
- While a factory is producing, its door glows from inside (steady with Reduce motion), grey smoke puffs rise from each stack, and the sparks come out of the door. `factoryAnchor` gives door and stacks; the renderer caches them per class and zoom (no per-frame allocation beyond the existing effect drawing). Smoke is skipped with Reduce motion.
- Not done: antenna, sensor, CPU and wind glyphs are still small symbols; shaped buildings do not grow with modules. Another agent was editing the same building code in `art.ts` (building margin, wind radius) at the same time; I merged on top of it. Not looked at in a browser (added to `TODO.md`). `npm test` and `npm run typecheck` pass; frame cost of the smoke not measured.

## 2026-10-28 (higher-contrast guns)

- Client only (`art.ts`). Barrels, launcher tubes and turret rims are now pale gun metal (`GUN`) with a dark outline instead of mid-grey steel, turret housings get a dark halo, and laser and tesla arms are outlined dark, so guns stand out from any hull colour. Same shapes and sizes. Not looked at in a browser (added to `TODO.md`), including at night.

## 2026-10-28 (Orders above Build in the side panel)

- Client only (`index.html`). The Orders section now comes before the Build section in the left panel, so the order is Orders, Build, Production, Selection, Modules. Nothing in the script or CSS depended on the old order. Not looked at in a browser (added to `TODO.md`).

## 2026-10-28 (wheels versus tracks)

- Client only (`art.ts`). Small and turbo motors are now drawn as separate round-edged wheels on axles (two a side, three on a long chassis); large and huge motors stay as tracks (the grouser lines), so the two read apart. Art only: speeds, stats and hulls are unchanged. Not looked at in a browser (added to `TODO.md`).

## 2026-10-28 (build and repair stripes)

- Client only (`art.ts`). `Look` gained `repairers` (count of `repair` modules). Mobile units with a build arm get yellow hazard stripes (dashes with dark gaps) round their whole outer hull; repair-beam units get red ones; with both the dashes alternate. Square buildings get the same stripes round their edge (`hazardRim`). Buildings get a striped base under the build symbol and a new red cross-and-stripes repair symbol (`GlyphKind` `repair`). New `stripes()` helper draws the plate; it is baked into the class texture, so there is no per-frame cost.
- `npm test` (489 passed, 1 expected fail) and `npm run typecheck` pass. One earlier run had a single failing test that did not repeat on re-run (a long, time-based test; not investigated further). Not looked at in a browser (added to `TODO.md`).

## 2026-10-28 (flyer spotlight grows with flight)

- The pool of light under a flying unit now follows its lift (the value that already drives the shadow): `SPOT_MIN_RADIUS` 0.9 tile while the craft sits still (lift `AIR_HOVER_LIFT`) up to `SPOT_MAX_RADIUS` 5 tiles once it is moving (lift 1), easing with the lift (`AIR_LIFT_RATE`); the inner glows are 0.3 of the outer. Replaces `SPOT_SIZE`; the radius no longer depends on the craft's size. Flyers have no separate landed state in the client, so "landed" is read as "hovering still". Brightness is unchanged per glow (`SPOT_ALPHA` 0.4), so a tight pool is more concentrated. Not looked at in a browser; tests/typecheck pass.

## 2026-10-28 (flyer spotlight under the craft)

- The spotlight glows were in the glow layer, above the units. They are now their own pooled sprites (`spot()`, `SPOT_CAP` 200, same glow texture) in `beamLayer`, under the units and over the ground, tinted like the headlights to cancel the night multiply (`spotTint`). Intensity halved (`SPOT_ALPHA` 0.8 to 0.4) and the radius doubled again (`SPOT_SIZE` 4 to 8, so 8x the diameter it started at). I read "while flying" as "for the flying units" (only they have a spotlight); if you meant the radius should grow only while a craft is moving or climbing, that is a small change using `shadowLift`. Not looked at in a browser; frame cost not measured.

## 2026-10-28 (wider, brighter flyer spotlight)

- Follow-up: spotlight diameter 4x (`SPOT_SIZE` multiplies the near and far radii in `drawNight`; the path to the ground is unchanged) and `SPOT_ALPHA` 0.4 to 0.8 (so 5x the original 0.16 in total). The wider pool covers 16x the area at the same strength per glow, so it is much more visible and pools of several flyers will overlap and add; the `GLOW_CAP` pool (300) is unchanged, with the same 5 glows per flyer. Tests/typecheck pass. Not looked at in a browser; frame cost not measured (larger sprites, same count).

## 2026-10-28 (stronger flyer spotlight)

- `renderer.ts` `SPOT_ALPHA` 0.16 to 0.4: the downward spotlight of flying units at night is 2.5x as bright (additive glows, so the overlapping steps add up; `glow()` still clamps each to 1). Not looked at in a browser; may need trimming if it washes out the ground.

## 2026-10-28 (framework under turrets and pylons)

- `art.ts` `drawFramework`: one-tile buildings that are a weapon (any turret, including tesla) or just an antenna (the Power Pylon) get a lattice base under their plinth or plate: a dark filled square 0.92 tile wide, corner-to-corner braces, an inner square, a steel outer frame with a thin line in the owner's colour, and four corner feet with bolts. The texture size, footprint and turret/rotor anchors are unchanged (the base is drawn first, under everything). Other one-tile buildings (silo, solar, wind, charger...) are unchanged. `npm test`/`npm run typecheck`: client tests and typecheck pass; no new test (drawing only). Not looked at in a browser.

## 2026-10-28 (module symbols fill their building; bigger wind blades)

- `art.ts` `placeGlyphs`: module symbols on square buildings no longer stop at 9 px or sit in a fixed square grid. They share the whole top: `cols = ceil(sqrt(k))`, `rows = ceil(k / cols)`, each symbol sized to 0.46 of its cell (so a lone symbol fills the building, two sit side by side across the full height, the last row is centred). Shaped buildings use 0.38 of a tile (was 0.4 capped at 9). Turret housings follow the cell, so a building's guns are bigger too.
- Solar panels share their symbol's area by count: 1 panel fills it, 2 side by side, 3 two over one wide, 4 a 2x2 (`drawSolarPanel` unchanged).
- Wind blades (`windRadius`): radius is the smallest of 0.9 x the rotor's distance to the nearest edge of the footprint (or its tile for shaped buildings), half the share of the footprint its symbol has, and 0.9 tile. Two buildings side by side therefore cannot touch blades (each is less than its own edge distance), and a lone one-tile turbine has blades of 14.4 px (was about 10.3) overhanging its half-size walls. Replaces the earlier `PlacedGlyph.full`.
- `client/test/art.test.ts`: blade size test (bigger than 11 px, under a tile across, inside the footprint on other frames). `npm test` and `npm run typecheck` pass (one full run again hit a `perf-scaling` timing failure that passes alone; no engine change). Not looked at in a browser.

## 2026-10-28 (smaller one-tile buildings, margin round bigger ones)

- Client art only (`art.ts`): footprints, collision and placement are unchanged. One-tile buildings are drawn at about half the size (`SMALL_BUILDING_HALF` 0.23 of a tile from the centre; was about 0.44), and buildings of 2x2 and up leave `BUILDING_MARGIN` (0.09 tile) clear on every outside side, so neighbours no longer touch and everything reads a little smaller. Square buildings, one-tile gun plinths, module symbol grids and the hazard rim all follow `buildingHalf`; wind rotors keep their original size (`PlacedGlyph.full`) and may overhang a one-tile building's walls; shaped (L/T/+/U/H) buildings inset only the sides facing outside or a gap, and their outline now runs unbroken between cells. The texture stays the size of the footprint (a transparent rect), so shadows, night glow and selection are unchanged; module symbols in a one-tile building are now small (about 2 px at map zoom).
- `client/test/art.test.ts`: the one-tile laser tower's turret radius expectation moved from over 9 to between 5 and 8 for the new size. `npm test` and `npm run typecheck` pass. Not looked at in a browser (see `TODO.md`).

## 2026-10-28 (build menu icons show rotors and guns; proper solar panels)

- `Renderer.iconFor` (build bar, category buttons, designer class list, factory queue) used the bare in-game texture, which leaves out the wind rotor and gun turrets because they are separate child sprites in the game. It now adds those children (same cached rotor/turret textures) before extracting, so a wind turbine shows its blades and turret buildings and vehicles their guns in the menu.
- Solar panel art (`art.ts` `drawSolarPanel`): an aluminium frame round a 3x3 grid of blue cells with dark seams, a lighter top edge on each cell and a faint glint across the glass, replacing the plain blue squares (still 1 to 4 panels per building glyph).
- `npm test` and `npm run typecheck` pass (one full run showed two `perf-scaling` timing failures that passed when run alone; no engine change). Not looked at in a browser (see `TODO.md`).

## 2026-10-28 (gun lamps and idle turret sweep)

- Client only (`renderer.ts`). Every gun turret sprite (units and turret buildings) now has a lamp: `drawNight` adds one pooled additive beam per turret at the turret's centre of rotation (under the gun), rotated by hull plus turret angle, so it turns with the gun. Length 1.3x a headlight (`GUN_LAMP_LENGTH`), 85% brightness; same fade-in with dusk; not on construction sites. It uses the shared beam pool, so no new allocation per frame.
- Idle sweep in `aim()`: with no tracked target (no shot within `AIM_LINGER_MS`) a turret picks a random heading within `TURRET_SWEEP_RANGE` (2.2 rad) of the front every 1.5 to 4.5 s and turns to it at a quarter of the aiming speed. Per-turret state is a `WeakMap<Sprite, ...>` (one small object per turret, made once). Skipped with Reduce motion (turret returns to the front), for hidden sprites and for construction sites. Uses `Math.random`, which is fine here: client-only visuals, not the simulation.
- Follow-ups: the gun lamp is centred on the turret's centre of rotation. Headlights now depend on body type (`headlampsOf` in `art.ts`, cached per design in the renderer): micro 1 centred; light a matched pair; medium a slightly wide pair; heavy a bright matched pair; long light 1 on the left; long medium 2 (bright left, dim right); long heavy 3 (uneven); superheavy 3; colossus 2 (bright right, dim left-of-centre). Lamp power scales beam brightness and length. New tests in `client/test/lights.test.ts`. `npm test` and `npm run typecheck` pass. Frame cost not measured. Not looked at in a browser (added to `TODO.md`). `STYLE.md` and the player changelog updated.

## 2026-10-28 (fog of war by line of sight)

- Rock (`!passable`) and buildings (`Terrain.occupied`, sites included) now block vision. New `VisionGrid` in `engine/src/game/vision.ts`: recursive shadowcasting per viewer, writing a generation-stamped `Uint32Array` (no per-tick clear, no allocation; one grid per `Terrain`, `VisionGrid.of`). Opaque tiles are themselves seen (you see a wall's face); a building viewer's own footprint does not block it; flying viewers (`stats.flying`) get the plain circle. `Viewer` gained `air` and `size`.
- `visibleTo(world, owner, stats, terrain?)`: with a terrain, an entity is seen if its tile (or any tile of a building's footprint) is in the grid; without one it is the old circle (existing tests and callers unchanged). `match.ts` passes `sim.terrain`. `Simulation.canSeeTile` (placement rule) uses the new `inSight`. Client `updateVision`/`canPlaceInVision` use the same grid on the client terrain, so the fog drawn matches what the server sends.
- Not changed: program sensors (`scan`, `Detected`) still reach through walls (they have their own range); the bot's `observe` (`ai.ts`) still uses the circle (`inVision`), so bots see through walls; client fog uses own units only (server shares team vision in co-op), as before.
- Client occupancy only holds buildings the client can see; a hidden wall can only matter if it is behind something already blocking, so fog and server agree.
- Tests: `engine/test/vision.test.ts` (open circle, rock, building, gap, own footprint, flyer, edges, `visibleTo`). `perf-scaling.test.ts` now passes the terrain so it times the real path. `npm test` (488 passed, 1 expected fail), `npm run typecheck` and the perf budgets pass. Before/after timings were not measured. Not looked at in a browser. Docs page, manual and player changelog updated.

## 2026-10-28 (neutral Wanderers run on solar panels)

- Neutral Wanderers drained their battery and died. The `Wanderer` template (`content.ts`) now has two `solar.panel` modules (fits the 4 slots of the light chassis). `solar.panel` lost `structureOnly` (`parts.ts`), so any mobile class may carry panels. New `unitSolarSystem` (`systems.ts`, called after `powerSystem` in `Simulation.step`): each mobile unit with `stats.solar > 0` adds `solar * sunNow() * SOLAR_GENERATION_MULTIPLIER` (the same formula as a building's panels, leftover carried in `genCarry`) to its own energy, capped at capacity. Units are on no power network, so this is separate from `powerSystem`; it follows the dev sunlight override too.
- Rate: about 2.5 energy/tick per panel at full sun, 0 at night. Wanderers' map positions and random draws are unchanged (determinism untouched). Perf: the sweep checks `motion.has`/`energy.has` first; `perf.test.ts` budgets still pass unchanged (not separately measured).
- Players may put panels on their own units, but they are deliberately poor there (`rules.ts`): `MOBILE_SOLAR_MASS_FACTOR` 4 (mass counts 4x, so more cost and a slower unit; `deriveStats`), `MOBILE_SOLAR_INTEGRITY_PERCENT` 25 (breaks after a quarter of the damage a building's panel takes; `hitTableOf`), `MOBILE_SOLAR_EFFICIENCY_PERCENT` 25 (a quarter of the output; `unitSolarSystem`), so about 0.6 energy/tick per panel at full sun. Buildings are unchanged. With the old always-wandering program 30% could not keep a Wanderer alive (the light chassis only has room for two panels beside its CPU and motor), so the Wanderer program now rests: with `let resting`, it stops wandering below 25% energy and resumes above 95%, so by day its panels fill the battery and at night it spends the charge walking. That is what allows 25%.
- Test: the Wanderer test now also checks it never hits 0 energy, reaches over 90% full and still travels over 20,000 ticks. Not separately tuned beyond that; at 25% the rest period is long (hundreds of ticks of full sun to refill).
- Full run: the engine and server tests pass. `client/test/radarVision.test.ts` (2 failures) and a `VisionGrid` typecheck error in `client/src/state.ts` are another agent's uncommitted fog/radar work, not touched by this change.
- Test: `engine/test/solar-unit.test.ts` (charges by day, not at night; a Wanderer survives 20,000 ticks). `npm test` (478 passed, 1 expected fail) and `npm run typecheck` pass. Not looked at in a browser.

## 2026-10-28 (scripts can raise pop-up alerts: notify)

- New script call `notify(text, kind)` (Actions group, cost 2 cycles) with constants `NOTE_OK`/`NOTE_INFO`/`NOTE_WARN`/`NOTE_ERROR` (from `NOTICE_KINDS` in `api.ts`). Text follows the `alert()` rules (quoted or joined, 40 characters, one memory slot per distinct text). It queues a `Notice` in `Simulation.notices` (cleared in `commit()`), which `match.ts` sends as a new `notice` message to the owner only; `main.ts` shows it with `showToast`. `alert()` (speech bubble over the unit) is unchanged.
- Limits: a unit may raise one every `NOTICE_COOLDOWN_TICKS` (20, tracked in `Simulation.noticeReady`), a player at most `MAX_NOTICES_PER_OWNER_TICK` (2) a tick; extras are dropped and the call returns 0. Out-of-range kinds clamp. The client ignores unknown kinds. The toast list already caps at five and merges repeats.
- Graph editor: typing text into `notify`/`alert` inputs worked on existing nodes, but a call added from the palette started as `alert(0, 0)` and refused text ("not a whole number"). `addStatement`/`addExpression` calls now take the builtin's `text` positions (`graphView.ts` passes them) and start those arguments as the sample text 'message'. Covered in `client/test/graph.test.ts` (existing and palette-added nodes, via the graph operations; the rendered view was not opened).
- Tests: `engine/test/alert.test.ts` (parse/print, delivery, clamp, cooldown, per-tick cap), `server/test/notice.test.ts` (owner only). Docs page "Language" and the player changelog updated. Not looked at in a browser (added to `TODO.md`).

## 2026-10-28 (day/night on the map: dimming, headlights, nav lights)

- Module breaks (SimEvent.Break) also throw fragments (radius 0.5, so up to 4), on top of their existing spark burst; same landing blasts and Reduce motion rule.
- Explosion fragments: a Death now also throws 0 to 10 fragments (`shrapnel.ts`, capped at 120 in flight; more for bigger blasts, none with Reduce motion) that arc away and come down at staggered times (220 to 950 ms). Each landing sheds 4 to 8 sparks (existing `sparks.ts`) and 60% of the time a small blast (radius 0.3, capped at 160 live blasts). Draw loop has no per-frame allocation; landing allocates one small explosion. Unseen in a browser; frame cost not measured. New `client/test/shrapnel.test.ts`. Tests/typecheck pass (one run showed 2 unrelated failures that did not recur).

- Follow-up 3: flying units cast a spotlight (`drawNight`): `SPOT_STEPS` (5) round glows from the craft to its ground shadow point (uses the eased `shadowLift`), growing in radius and fading with distance; counted in the `GLOW_CAP` pool, whose per-frame reset moved to `frame()`. Unseen in a browser; frame cost not measured. Tests/typecheck pass.

- Follow-up 2: headlights are now pooled additive sprites (`lights.ts` gradient texture: long falloff, feathered sides, spill round the lamp) in `beamLayer` under the units; since that is under the night multiply, the beam colour is divided by the current tint per channel to cancel it. Night is lighter (`NIGHT_TINT` 0x3b4c80, `NIGHT_DEPTH` 0.7, was 0x2b3a66 at 0.85). New `drawGlows`: soft additive lights (round gradient texture, pool capped at `GLOW_CAP` 300) for explosions (radius follows the blast, white flash then orange), gun/laser muzzle flashes and impact points (size from weapon damage), missile launches, flying missiles' engines and tesla pulses; level is 0.35 by day up to 1.0 at night. No per-frame allocation beyond the existing `screenOf` calls. New `client/test/lights.test.ts` (falloff shape). Frame cost not measured; unseen in a browser. `npm test` (464 passed, 1 expected fail) and `npm run typecheck` pass.

- Follow-up: finished buildings (not construction sites) also get a warm interior glow at night: three faint rounded rings spilling `WINDOW_SPILL` tiles past the footprint plus a brighter core, same fade as the other lights. No extra allocation; unpowered buildings are not treated differently. Unseen in a browser. Tests/typecheck pass (462 passed, 1 expected fail).

- `renderer.ts` `drawNight`: a screen-sized white sprite with multiply blend and a tint that blends towards `NIGHT_TINT` (0x2b3a66, at 85% of full dark) as `state.daylight` falls, sitting above the units and below the fog and interface. Below `LIGHTS_ON_BELOW` (45) daylight, a `Graphics` with additive blend draws lights for visible, on-screen, non-building units: two warm headlight beams (a faint long triangle plus a brighter short core) on ground units, red/green nav lights plus a white strobe (every 1300 ms, steady with Reduce motion) on flying ones. Lights fade in over daylight 45 to 20. Nothing is drawn by day (the layer is hidden and cleared). No per-unit allocation (helpers `beam`/`navLight`, index loop). Client-only: no engine or network change; determinism untouched. Frame cost not measured. `STYLE.md` and the player changelog updated. Not looked at in a browser (check in `TODO.md`), so the darkness level, beam size and nav light placement are unproven.

## 2026-10-28 (units reach buildings from any angle)

- `simulation.ts` `edgeDistance`: for buildings it now measures to the nearest point of the square footprint instead of to a circle of half the footprint. The circle put a unit touching a corner about 1.33 tiles out while the approach/dock/take/harvest check wants 1 tile, so units only completed pickups and drop-offs when level with a side. Every side and corner now counts the same. Also widens range checks that use it (script `dist`, turret/repair/build reach, building energy transfer, which only gets more generous at corners). Test: "a building counts as reached from any side or corner". The silo dispatch test waits up to 6 ticks for its order instead of exactly 2, because earlier harvesters can now dock too and the silo sees one visitor a tick. `npm test` and `npm run typecheck` pass. Not looked at in a browser or a live match.

## 2026-10-28 (orders grid: 3 wide, Build units icon)

- `style.css`, `index.html`: the Orders grid is 3 columns (was 4) with bigger icon, label and hotkey text so the shortcut fits; the Build units button gets a 🏭 icon beside its label (both centred, label reads "Build Units") and `aspect-ratio: 3 / 1` (about one order-button cell high; the exact match depends on pane width, within a few px). Chevron is now absolutely positioned. CSS/HTML only; not looked at in a browser (added to `TODO.md`). `npm test`/`typecheck` not run (no code changed).

## 2026-10-28 (dev panel: alerts and sunlight/wind)

- Dev Options (`devTools.ts`) gets an **Alerts** section (buttons that show an OK, Info, Warn and Error pop-in, client only) and a **Sunlight and wind** section (fix each with a slider, presets Noon/gale and Night/calm, Natural cycle to release). New dev command `weather` (`net/dev.ts`) sets `Simulation.devSun`/`devWind` (-1 natural); `sunNow()`/`windNow()` replace the direct `daylight`/`wind` calls in `powerSystem` and the script API, and the server broadcasts a `weather` message (also to late joiners) that `ClientState.daylight`/`wind` honour, so the top bar, solar/wind output and scripts agree. Dev builds only in effect (the server ignores the command without WST_DEV_TOOLS=1). Test in `dev.test.ts`. Not looked at in a browser.

## 2026-10-28 (pop-in alerts instead of text in the left pane)

- New `toast.ts` (`showToast(text, kind)`; kinds ok / info / warn / error) and `.toast` glass styles in `style.css`. `Ui.showResult` (designs restored/uploaded/reset, program uploaded or rejected, server errors) now shows a toast instead of filling the left pane's `#result`, which is gone. `index.html`: the scoreboard and a new `#toasts` live in one `#alerts-column` at the top right so alerts always sit under the scoreboard. Slide in 220 ms, stay 4 s (7 s warn, 8 s error), slide out 260 ms; same text restarts the timer; five at most; no animation with Reduce motion. The designer's own result line is unchanged. Test: `toast.test.ts` (stubbed DOM). `STYLE.md` records the convention. Not looked at in a browser (check in `TODO.md`).

## 2026-10-28 (a clearer map edge)

- `renderer.ts`: the area outside the map is now `#05070a` (was `#0e1116`) so the edge reads by contrast alone; the map's own colours are unchanged. A bright border line and a lighter ground were tried and dropped. Not looked at in a browser (check in `TODO.md`).

## 2026-10-28 (more overscroll on the map)

- `renderer.ts` `layout()`: the camera may now go half a screen past each map edge (was a quarter), so the edge can sit at the middle of the view. Not looked at in a browser (check in `TODO.md`).

## 2026-10-28 (multiplayer Horde and Surrounded, with maps made for them)

- Engine: `MapDefinition` gained `scenario`, `starts` (where the humans' bases go), `foes` (Surrounded bots) and `hordeFrom`; `mapStarts()` and `mapsFor()` in `map.ts`. Maps without them behave as before (generation order and random draws unchanged; the symmetry and centre-base tests now skip the new maps). `generateTerrain` got an `asymmetric` flag so a cluster of bases is opened where it is, not mirrored on all four corners. Four new maps: Last Redoubt, Siege Line (Horde) and Crossfire, Pincer (Surrounded), each a block of four bases 22 tiles apart. `HordeSpawner` takes several enemies (`addEnemy`/`removeEnemy`) and `setUpHorde` an explicit spawn tile.
- Server (`match.ts`, `server.ts`): a Co-op room on a scenario map takes that scenario, holds up to four humans (seats filled in order) and one shared opposition made when the first human joins and taken down with the last; Free for all on such a map falls back to the default map. `BotSide` now has `seat` and `start` instead of a corner index; surrounded bots and a made-for-the-horde horde take no seat (this replaces the old Surrounded special cases). The room list now includes `scenario`.
- Client (`lobby.ts`): Create a room offers Co-op Horde and Co-op Surrounded, each map list shows only the maps that suit the type (Single Player lists general maps plus those made for the chosen scenario); rooms are tagged with the scenario.
- Four more maps per scenario (Dead End, High Ground, Long Night, Trench Works; Bullseye, Ridgeback, Clearing, Rubble), varying layout, size and where the cluster sits; the existing scenario-map tests cover fit and connectivity. Unseen in a browser.
- Follow-up: Single Player Horde and Surrounded also list only the maps made for them (they used to list the general maps too).
- Tests: scenario maps (four bases fit, are connected to the enemy start), horde with two targets (engine), co-op Horde and Surrounded rooms (server). `docs/game.md` and the player changelog updated. `npm test` and `npm run typecheck` pass. Not looked at in a browser; the new maps' look and balance are unseen (check in `TODO.md`). Perf budgets untouched (the shared horde keeps the 120-unit cap for the whole room).

## 2026-10-28 (multiplayer: inner glass panel for the game list)

- `lobby.ts`: the Games tab wraps the note and `#lobby-rooms` in `.lobby-games`; `style.css` gives it a darker inner glass panel (fixed height `60vh`, `overflow-y: scroll` so the bar is always visible and a long list scrolls inside it) that is always shown, so "No active games..." and "Can't reach the server" sit inside it. The player count line stays above it. Not looked at in a browser (added to the Multiplayer check in `TODO.md`).

## 2026-10-28 (main menu: big buttons centred)

- `style.css`: the Single Player / Multiplayer / Designer buttons centre their title and caption (`.menu-main .menu-buttons button`). CSS only; not looked at in a browser (covered by the main-menu layout check in `TODO.md`).

## 2026-10-28 (Controls rows: slots right-aligned)

- `style.css`: in Options > Controls each row's key/gesture slots take only the width they need and sit against the right edge (the name and description keep the left, with the rest of the width), instead of a fixed 2.4fr column; in a narrow window (700px) they stack under the name, left-aligned. CSS only; not looked at in a browser (added to the existing Controls check in `TODO.md`).

## 2026-10-28 (configurable control-group modifiers)

- `controls.ts`: three new modifier controls on the Selection tab: `groupAssign` (Save control group, default Ctrl and Meta), `groupAdd` (Add to control group, default Shift) and `groupSelect` (Select control group, default none: the bare number key recalls; if a modifier is bound it must be held). `Controls.hasModifier` added. `input.ts`: the digit branch of `keyDown` uses them (save beats add beats select; the old hard-coded Ctrl/Meta/Shift and the Alt exclusion are gone, so Alt + number does nothing unless bound). The digits 1-9 themselves are still fixed; the blocked-key message and Controls/manual text say so. Test in `controls.test.ts`; changelog bullet added. Not looked at in a browser (check in `TODO.md`). `npm test` and `npm run typecheck` pass.

## 2026-10-28 (main menu: buttons centred, news on the right)

- `style.css`, `lobby.ts`: the buttons are a 460px column centred in the window; the news pane is now a pop-in like the dev panel: a vertical "Latest News" tab (18px text) that is part of the panel, stuck to its left edge and centred vertically, so it slides in with it and no longer overlaps it (in a dev build it still overlaps the Dev Rooms tab when closed) slides it in from the right (up to 420px, 16px+2em from the top and bottom); the tab, Esc or a second click closes it; no slide with Reduce motion. Works at every window width (the old stacked layout is gone). Not looked at in a browser (check in `TODO.md`). `npm test` and `npm run typecheck` pass.

## 2026-10-28 (Options: General / Sound / Controls tabs)

- Follow-up: each Options tab panel had a second frame (the `.options` block carries the lobby panel styling), so it is now frameless inside `.options-panel` and the tab set itself takes the 920px centred width (`.options-tabs`). `lobby.ts`, `style.css`. Not looked at in a browser.

- `lobby.ts` `renderOptions`: Options is now a glass tab set (`optionsTab`, remembered while the page is open, arrow keys move between tabs, fade on change like the lobby). General: Reduce motion, Show alpha maps. Sound: Music volume, Effects volume, Mute all sound. Controls: the editor with its own sub-tabs, unchanged. Control ids and handlers are as before.
- `controlsMenu.ts`: the open sub-tab's panel keeps the tallest height seen as a `min-height`, so switching to a shorter sub-tab no longer shrinks the page and moves the browser's scroll position. The tabs are measured as they are visited, so the first visit to a taller tab can still extend the page (never shrink it). Not looked at in a browser (check added to `TODO.md`). `npm test` and `npm run typecheck` pass.

## 2026-10-28 (Options > Controls: tabs and a saner grouping)

- `controls.ts`: `ActionDef.section` is now `camera | selection | orders | building`, and `ACTIONS` is listed in tab order. Camera: pan, zoom and reset keys, then drag-pan, zoom and scroll-pan. Selection: Select, Add to selection, Cancel / deselect. Orders: Give order, Queue orders, then the order keys. Building and production: the build-menu keys, then Fill production queue. Ids, defaults and saved settings are unchanged.
- `controlsMenu.ts`: the editor shows these as the glass tabs used in the lobby (arrow keys move between tabs; the open tab survives redraws; only the open tab's rows are rendered), with small Keys / Mouse and trackpad headings where the kind of input changes. The "Orders (Shift queues them)" heading and the other long headings are gone; the short notes about selection-dependent keys moved into the Orders and Building tabs. `style.css`: a few `.controls-editor` tweaks. Not looked at in a browser (check added to `TODO.md`). `npm test` and `npm run typecheck` pass.

## 2026-10-28 (Ctrl-click fills the production queue)

- New configurable modifier control `fillQueue` ("Fill production queue", Options > Controls, mouse section, default `mod:ctrl`; `controls.ts`). In the Build units panel, a click with it held queues the clicked class into every free place (`MAX_PRODUCTION_QUEUE` minus what is queued, at least one); a plain click queues one as before. `UiActions.produce` gained a `count`; `main.ts` sends that many `produce` messages (at most 8, well inside the server's 200-message burst), so the server still validates each (full queue, unit cap, matter) and there is no protocol change. The client does not check matter: units that cannot be afforded are refused by the server one by one. Manual updated; test added to `controls.test.ts`. Not looked at in a browser; Ctrl + click on a Mac may be read as a right click (the controls menu only warns about that for mouse bindings).

## 2026-10-28 (left pane section order: Production and Modules sections)

- `index.html`: `#production` is now its own section under Orders (heading Production; Build units button, queue, status line, in that order); Selection keeps only the resource list; Modules is its own always-open section (`#modules-box` is a `<section>`, no longer a `<details>`). `ui.ts`: the Selection section now hides with its resource list alone (it no longer waits on production and modules); `modulesBox` typed `HTMLElement`. `style.css`: removed the `#modules-box` summary rules. Also fixed my earlier title-strip rule: the global `[hidden] { display: none !important }` beat it, so the empty strip collapsed; it now uses `!important` too. Not looked at in a browser. `npm test` and `npm run typecheck` pass.

## 2026-10-28 (unit build pop-over, music widget moved up)

- Factory unit options: the 4-column grid in `#production` is replaced by a `Build units` button (`#unit-menu-toggle`) that opens `#unitmenu`, a pop-over beside the pane that reuses the `#buildmenu` styles (shared via `:is(#buildmenu, #unitmenu)` in `style.css`) with 76px cards and 40px pictures in a panel wide enough for 5 columns (it shrinks to fewer columns on a narrow window); same name, `◆cost ϟenergy` text and tooltips. `ui.ts`: `wireUnitMenu`, `setUnitMenu`, `positionUnitMenu`; closes on Escape, an outside click, or when no factory is selected, and stays open after queueing so several units can be queued. The buttons are still only rebuilt when the key changes, and the affordability greying is unchanged.
- `music.ts` docks the widget before `#panel > header` (above the player/session line) instead of before the footer; the bottom stack is now music, player · session + Designer/Docs, footer. The `margin-top: auto` moved to `.music.docked`. Not looked at in a browser (checks added to `TODO.md`). `npm test` and `npm run typecheck` pass.

## 2026-10-28 (left pane: title removed, buttons and player info at the bottom)

- `index.html`: removed the "Digital Chaos" `<h1>`; the `<header>` (player · session line, then Designer / Docs / ↗) moved below `#result`, so the bottom stack is header, music widget (docked before `#designs-bar` by `music.ts`), footer. `style.css`: `#panel > header` takes `margin-top: auto` (the auto margin moved off `#designs-bar` and `.music.docked`); `#selection-title` is a strip as tall as the top bar, name centred both ways, and keeps its height while empty (`visibility: hidden`) so sections don't jump. `ui.ts`: a `ResizeObserver` on `#topbar` sets `--topbar-h`. Not looked at in a browser (check added to `TODO.md`). `npm run typecheck` passes; `npm test` still has only the `changelog.test.ts` bullet-count failure.

## 2026-10-28 (radar ghosts vanish when the fog is pushed back)

- `state.ts` `updateVision()`: with fog on, radar blips whose tile is now in view (vision 2) are removed in place (no allocation), so stale ghosts no longer sit over the real, visible state. Rings are unchanged. New `client/test/radarVision.test.ts`. Not looked at in a browser. `npm run typecheck` passes; `npm test` has one failure not from this change: `changelog.test.ts` wants more than 5 bullets in the newest entry and 2026-10-28 had only 3 (4 now).

## 2026-10-28 (small-window warning on the main menu)

- `lobby.ts`: the touch warning modal is now `showMenuWarning(title, text, onDismiss)`; a new `showSmallScreenWarning` uses it when `window.innerWidth < 900` or `innerHeight < 800` (`MIN_SCREEN_WIDTH`/`MIN_SCREEN_HEIGHT`), showing the current size and tips (bigger window, F11, zoom out). Touch devices get only the touch message. Dismissed per page load, checked when the main menu is drawn (not on live resize). Text is set with `textContent`. Not looked at in a browser (check added to `TODO.md`).

## 2026-10-28 (Skirmish is Single Player again)

- Renamed in the main menu button and the room-mode title (`lobby.ts`), the engine's mode name (`map.ts`), the manual, comments, tests, `docs/`, `PLAN.md`, `STYLE.md`, `TODO.md` and `SOUND_EVENTS.md`. The mode id (`solo`), the `scenario` parameter and all behaviour are unchanged, so no saved data or URLs are affected. Old `PROGRESS.md` and `REVIEW.md` entries and the 2026-10-27 changelog line that announced the Skirmish rename keep the old name as history; the other 2026-10-27 changelog lines were updated. Not looked at in a browser.

## 2026-10-28 (Unload defaults to Shift + D)

- `ORDER_DEFS` in `controls.ts`: Unload (`dock`) is `shift+key:KeyD`, so no default order key shares a key with a camera key any more (the shared-key warning still exists for custom bindings). Manual, docs table (reads the defaults) and tests updated. Unload cannot also be queued by key (Shift is part of its binding), which does not matter much as it is not aimed. Anyone who saved a change to the Unload row keeps it until they press Reset to default. Not looked at in a browser.

## 2026-10-28 (scroll hint: bottom fade on scrollable panels)

- `style.css` (end of file): scrollable panels (`#panel`, `.modal-body`, build grid, designer tab sections, news body, test run, diff body, dev panel) fade their last 2em with a CSS mask driven by a scroll timeline (`--scroll-fade`), clearing at the end of scroll or when nothing overflows. Guarded by `@supports (animation-timeline: scroll())`; no JS, no timers. Not looked at in a browser; not run: `npm test`, `npm run typecheck`. Not covered: the dropdown list near the end of the designer styles, and the flow editor list (own shadow styles).
- News panel also gets an accent glow along its bottom edge (`.menu-news::after`, opacity tied to the news body's named scroll timeline). Not looked at in a browser.

## 2026-10-27 (new default keys: M, Ctrl+A, Ctrl+S; select-all removed)

- Defaults: Move `M`, Attack `Ctrl + A`, Stop `Ctrl + S` (`ORDER_DEFS`, `controls.ts`). Only D now overlaps a camera key by default. Ctrl+A / Ctrl+S are `preventDefault`ed when they give an order, so the browser's select-all and save do not fire; with nothing that can take the order selected they are left alone. Queueing Move by keyboard works again (Shift + M); Attack and Stop cannot be queued by key (Ctrl is not a keyboard queue modifier).
- Removed the `selectAll` control completely: the action, its key handling, the manual sentence and the tests. A saved `selectAll` row is ignored on load. Double-click still selects a class on screen, drag still boxes.
- Players who changed any Move/Attack/Stop key earlier keep the old row until they press Reset to default. Tests and typecheck pass (see end of file for counts at the time).

## 2026-10-27 (controls section animates in like the other menus)

- The Controls rows were only fading in as plain panel children, and their "Controls" heading reused `.section-head`, so `revealScreen` treated it as a second screen header. `.control-row` is now one of the staggered list rows in `transition.ts` (`LIST_ROWS`), and the heading is a plain `<h3>`. Changing a binding redraws the rows without animation, as before. I could not see it run: this is my reading of `revealScreen`, not something I watched in a browser (check in `TODO.md`).

## 2026-10-27 (Shift+M / Shift+A defaults, per-control reset)

- Default keys: Move is Shift + M and Attack is Shift + A (`ORDER_DEFS` in `controls.ts`), which frees A for panning left. Consequence: with Shift now part of the binding, Shift cannot also queue those two by keyboard (the other orders still queue with Shift + key); queue them by clicking with Ctrl/Shift on the aimed target as before. Manual, docs table (`defaultKeyLabel`) and tests updated.
- Controls now save **only the rows that differ from the defaults** (so default changes reach everyone who never edited that row). Anyone who changed a control before this has the old Move/Attack letters saved; Reset to default fixes it.
- Options > Controls: a row that differs from its defaults shows "Reset to default" (`Controls.isDefault` / `resetAction`); it disappears once the row matches again. Not looked at in a browser. Tests and typecheck: see below.

## 2026-10-27 (configurable order keys and build-menu hotkeys)

- `controls.ts`: eight order controls generated from `COMMON_ACTIONS` plus Demolish (defaults are the old letters, so nothing changes until a player rebinds), and six build-menu controls (open/close `B`, category prev/next `Q`/`E`, building prev/next `,`/`.`, place highlighted `Enter`/`NumpadEnter`). `ActionDef.context: 'selection'` marks keys that act only when the selection can use them. `Controls.keyLabel` gives the text for buttons; `ActionButton.key` now comes from it (and `ActionButton.control` names the control) in `actions.ts`.
- `input.ts` key handling: candidates are tried in order: orders the selection can take now, build keys, then camera/other keys. A build key the menu cannot use (no builder, nothing highlighted) falls through to the next control. Holding a queue modifier that is safe on keys (Shift, Alt) queues an order key; Ctrl/Meta never do (they would swallow browser shortcuts). A class's own button letter still beats the camera. Behaviour change: a disabled order key no longer swallows its letter, so S pans when nothing selected can Stop.
- `ui.ts`: `buildKey()` and a keyboard highlight (`.kbd-focus`) over the pop-over grid (or the flat list when there is one category); wired through a new last argument of `Input`.
- Warnings: order/build keys clash with each other (Replace / Keep); a camera key sharing a key with them only warns, on the camera row (the default WASD and A/S/D overlap is intended). The old "letter is also an order key" warning is gone. Class-button keys stay fixed by the engine's `RESERVED_KEYS` (those still refuse M, A, S ... for classes even if a player rebinds them).
- Not looked at in a browser (check added to `TODO.md`). `npm test` (443 passed, 1 expected fail) and `npm run typecheck` pass.

## 2026-10-27 (configurable controls)

- New `controls.ts` (pure: bindings, matching, saving, warnings, wheel/trackpad classifier), `controlsMenu.ts` (the editor, mounted under Options by `renderOptions` in `lobby.ts`), `input.ts` reads bindings instead of hard-coded keys/buttons, ~20 lines of CSS at the end of `style.css`, `test/controls.test.ts` (17 tests).
- Actions: pan left/right/up/down, zoom in/out, reset view, select all, cancel (keys); select, order, pan-by-drag (mouse buttons), zoom and pan-by-scroll (wheel, two-finger scroll, pinch), and the add-to-selection and queue modifiers. Two slots each. Mouse/wheel slots are a drop-down plus Ctrl/Shift/Alt/Meta toggles; key slots capture a keypress with the modifiers held. Saved as JSON under `wst-controls` in **local storage** (not session storage: that would forget the settings when the tab closes; the designs use local storage too). Loaded defensively: unknown actions, malformed text and bindings of the wrong kind for an action are dropped.
- Matching: keys need exactly the bound modifiers; mouse and wheel need at least them and the binding with most modifiers wins (so Shift + wheel can pan while the wheel zooms, and Ctrl + right click still orders when Ctrl is the queue key). A mouse press remembers which action it started so its release finishes the same one. The letter-yields-to-order-hotkey rule from the WASD change is kept.
- Warnings (`checkBinding`): refused with a reason: browser/system shortcuts (Ctrl+W/T/N, Ctrl+Tab, Alt+F4, F11/F12 ...), the number keys and F1/F2 (fixed), scroll or pinch with Ctrl (indistinguishable from a pinch), Shift + right click in Firefox. Asks before replacing: an identical binding on another action. Kept with a warning: Shift + right click in other browsers, Meta combinations, Ctrl + click on a Mac, Alt + drag on Linux, a letter that is also an order key, a gesture that takes Shift/Ctrl from select/order, Shift as the only queue key.
- Behaviour changes: Meta (Cmd) no longer queues by default (queue is Ctrl and Shift; add Meta in Options); Escape, Home and Ctrl+A now need exactly their modifiers; ctrl + mouse wheel with whole 100-pixel notches zooms in steps (it used to zoom smoothly as a pinch). Not configurable yet: order hotkeys, control-group digits, F1/F2, class-button keys.
- Not looked at in a browser or on a trackpad (checks added to `TODO.md`). `npm test` (440 passed, 1 expected fail) and `npm run typecheck` pass.

## 2026-10-27 (smooth keyboard pan, WASD, trackpad pinch and two-finger pan)

- `input.ts` only (plus manual text and changelog). Pan keys are tracked as held (`panHeld`, physical `code`) and a `requestAnimationFrame` loop, running only while a key is held or the camera is still easing out, eases a velocity (900 px/s, `KEY_PAN_EASE` 0.08 s) into `Renderer.panBy`; diagonals are normalised. Replaces the 60 px step per keydown. Blur clears held keys.
- WASD pans too. **Conflict:** A, S and D are action hotkeys (attack, stop, unload), so a letter pans only if it is not an action for the current selection (so W always pans; with nothing selected all four pan). Ctrl/Meta/Alt+letter never pans (Ctrl+A is select all). Arrow keys always pan.
- Trackpad: ctrl + wheel (how browsers report a pinch) zooms at the cursor by `exp(-deltaY * 0.01)`; Safari `gesture*` events do the same; other wheel events pan, except mouse notches (line/page mode, or whole-pixel `deltaY` of 50+ with no `deltaX`), which zoom as before. A trackpad event makes the next 200 ms count as trackpad so a flick is not read as notches. The zoom sound is limited to one per 250 ms.
- Not looked at in a browser or on a real trackpad (check added to `TODO.md`); the notch/trackpad split is a heuristic.

## 2026-10-27 (tighter menu layout, two-column main menu)

- `style.css` only: `#lobby` top padding 10vh -> 3vh (about 32px at 1080p, was 108px), gaps in `#lobby` and `.lobby-view` 12 -> 8px; `.menu-panel` is 860px with `.menu-buttons` as a grid of `auto-fit` 360px+ columns (two on desktop, one when narrow). `STYLE.md` updated. Not looked at in a browser (check added to `TODO.md`); tests and typecheck run below.

## 2026-10-27 (touch warning is a modal)

- `showTouchWarning()` (`lobby.ts`) replaces the panel above the menu: a `.modal-back.touch-warning` appended to `body` (dim plus `blur(3px)`, the panels' blur) with a centred `.modal`; Got it / Enter / Esc dismiss it. Not looked at in a browser.

## 2026-10-27 (touch-device warning)

- (Now a modal, see below.) `renderMain` shows a warning on touch-only devices (`touchDevice()`: coarse pointer, no fine pointer), dismissed with "Got it" until reload. `?mobile` in the page URL forces it for testing. Not looked at on a device or in emulation.

## 2026-10-27 (news pane: only the text scrolls)

- `newsPane()` splits the pane into `.menu-news-head` (date, headline; fixed) and `.menu-news-body` (summary and changes; scrolls inside the 70vh cap). Not looked at in a browser.

## 2026-10-27 (news screens share the news pane style)

- `style.css`/`newsMenu.ts`: the News list cards and the article page use the main-menu pane's text styles (small muted date, headline, 0.8em summary, 0.75em muted changes); `.news-lead` dropped. `.menu-news` is capped at `max-height: 70vh` and its text scrolls inside (the "All news" button stays pinned). Not looked at in a browser.

## 2026-10-27 (main menu: news pane, one-line links, centred)

- `renderMain` (`lobby.ts`) reworked again: left column has the play panel and a second panel with one-line Options / Manual / Credits buttons; right is a `menu-news` pane (`newsPane()`: latest date, headline, summary, first 4 changes, "All news and updates" button to the News screen). `#lobby:has(.menu-columns)` centres the menu vertically (gap 16px). Not looked at in a browser.

## 2026-10-27 (main menu: play panel and side panel)

- `lobby.ts` `renderMain` now has two panels in `.menu-columns`: Campaigns (dev), Skirmish, Multiplayer, Designer on the left; News, Options, Manual, Credits (smaller buttons, shorter captions) on the right (`.menu-side`). Replaces the single two-column grid below. They stack when narrow. Not looked at in a browser.

## 2026-10-27 (stray explosions at the map origin)

- `renderer.ts` `sync()`: a `Death` event for an entity the client never saw (no blast radius recorded, so its position was unset) spawned an explosion at tile (0,0) via the `?? 0.9` fallback. It is now skipped. `npm run typecheck` fails only in untracked `engine/test/perf-scaling.test.ts` (another agent's file, `stdout` type); `npm test` not run; not looked at in a browser (add a check to `TODO.md` if wanted).

## 2026-10-27 (performance by unit count; test review)

`npm test` (423 passed, 1 expected fail) and `npm run typecheck` pass; the new file was run 8 times alone and 3 times inside the full suite without a failure. Whole suite takes about 6 s.

- **New `engine/test/perf-scaling.test.ts`.** Real fights, not parked armies: two armies of 64, 128, 256, 512 and 1024 units (Scouts and Tanks, attack-moving on each other on Great Plains), four armies of 256 in a free-for-all, and 120 horde units against a defended base. Each tick is timed as `Match.tick` does it: `sim.step()`, then per client the fog filter (`visibleTo` + `Interest.update`) and `encodeTick`. Checks: mean and p95 of step+net against a budget per size (3, 3, 4, 7, 15 ms mean for 64..1024; p95 2.5x that), four armies of 256 < 15 ms mean / 40 p95, full horde < 3 / 10, growth over 4x units (64 -> 256 -> 1024) under 8x, and wire size under 30 bytes per unit per tick. Every fight asserts that units were lost, so it cannot silently measure two parked blocks. `WST_PERF_REPORT=1` prints the table; `WST_PERF_SLACK` loosens the wall-clock budgets as in `perf.test.ts`.
- **Measured (desktop, 2026-10-27)**, step + net mean: 64 units 0.3 ms, 256 0.5, 512 1.0, 1024 2.3 (p95 8), four armies of 256 2.5 (p95 7.6), horde 120 v 64 0.3. Wire: about 10 bytes per unit per tick. Budgets are about 6x the mean. A doubling of units costs about x2 in the median (linear); the first version of the growth check compared doublings and flaked at the threshold because the medians are tiny, so it compares 4x steps.
- **Limit of the net measurement:** it repeats the per-client part of `Match.tick` by hand (it cannot import the server), so it can drift from it. Engine-only; nothing for the client renderer (needs a browser).
- **`perf.test.ts` budgets tightened to about 5x measured (owner's request).** Parked 256 v 256 tick: mean 15 -> 3 ms, p95 50 -> 12 ms (10x: p95 spiked to 7 ms once in a full parallel run, so 5x was too tight for it); corner-to-corner path 25 -> 14 ms; VM floor 1000 -> 1500 cycles/ms (measured 7500 to 8500); worst tick after a 256-unit order 100 -> 90 ms (measured 17). Left alone: the 256-unit order at 100 ms (measured 34, only 3x, so 5x would loosen it) and the ratio checks. CI runs with `WST_PERF_SLACK=2`, so the runner gets double; not yet checked on the GitHub runner (TODO.md, Deploy and CI). Six full `npm test` runs after the change passed.
- **Review of the existing tests** (names, timings and `perf.test.ts` read in full; most test bodies not read):
  - `perf.test.ts` budgets are far too loose to catch anything but a catastrophe. Measured now vs budget: parked 256 v 256 tick mean 0.62 ms vs 15 (24x), p95 1.15 vs 50 (43x), corner-to-corner path 2.7 ms vs 25 (9x), 256-unit order 34 ms vs 100 (3x, the one that is tight and the known O(n^2) item in `PLAN.md`). Its comments are stale ("mean ~2 ms", "~17 ms" for the order; now 0.6 and 34). Its armies stand 70 tiles apart, so it measures no combat, no sensors firing, no networking. Left unchanged here (budgets must not be loosened; tightening them is a decision for the owner, suggested: 5x measured).
  - `ai.test.ts` ("keeps four of them going in a free-for-all within a small share of the tick") is a performance check living in a behaviour file; fine, but not in the perf budget list.
  - `known-bugs.test.ts` still fails as expected (power floor, `PLAN.md` Open work 2).
  - `client/test/soundmanifest.test.ts` is skipped silently when the manifest is absent (`describe.skipIf`); a missing manifest should probably fail in CI.
  - `sim.test.ts` (780 lines, 38 tests) holds unrelated areas (power, economy, fog, tesla, repair, decay) under one name; works, but hard to find things. Not worth moving unprompted.
  - Gaps: nothing times a real `Match` (fog, encode, bots together), nothing covers the client renderer's frame cost, `Terrain.encode`/map-send size has no budget.

## 2026-10-27 (Skirmish scenarios: Horde and Surrounded)

`npm test` (408 passed, 1 expected fail) and `npm run typecheck` pass. **Not looked at in a browser, and not play-tested for balance** (checks in `TODO.md`). Plan in `PLAN.md` ("Skirmish scenarios").

- **Scenario setting** (`engine/src/game/scenario.ts`): `standard | horde | surrounded`, a Scenario picker on the Skirmish form, `scenario=` in the page URL and the socket query; the server honours it for `mode=solo` only.
- **Surrounded**: `centreCorner()` is a `Corner` with tile offsets (`offsetX/offsetY`, used by `setUpPlayer`, `placeField`, `clearAreas`); `createMatch(..., 'surrounded')` clears the centre, gives it a base field and skips the shared centre field and the neutral wanderers. Four `setUpBot` bases in the corners with `pace` 1.75 (new optional `pace` on `BotPlayer`/`setUpBot`).
- **Horde**: `HordeSpawner`/`setUpHorde` (`engine/src/game/horde.ts`), `HORDE_*` and `SURROUNDED_BOT_PACE` in `rules.ts`. Uses the existing `Simulation.cheaters`; no new random draws. The horde counts as fielded from the start and is never shown eliminated, so the match cannot be "won"; the human's defeat ends it.
- **`Match`** (`server/src/match.ts`): `bots` is now a list of opponents per human (`allBots`, `makeOpponents`), `scenario` option, human start at the centre for Surrounded. Standard and co-op behaviour unchanged (existing tests untouched). Default terrain and rng order for `standard` are unchanged (tested).
- Tests: `engine/test/scenario.test.ts`, `server/test/scenario.test.ts`. No perf budget yet for a full 120-unit horde (listed in `PLAN.md`). Changelog entry and `docs/game.md` section added.

## 2026-10-27 (player-like AI)

`npm test` and `npm run typecheck` pass. **Not played by a person**: only run bot against bot and bot against an idle player, in tests and a scratch harness.

- **New AI** (`engine/src/game/ai.ts`, `AiPlayer`, `setUpAi`) replaces the cheating bot for Skirmish, Co-op and Surrounded bot sides (`server/src/match.ts`; Horde is unchanged, `bot.ts` is untouched and still exported). It mines, builds power, silos, factories, turrets, towers and pads with builders, expands to other fields (pylon chains; under fog a builder has to walk ahead), scouts, trains a weighted mix of combat classes, attacks and defends. Details in `docs/game.md` ("Bots").
- Measured (scratch harness, then `engine/test/ai.test.ts`): against an idle player it destroys the whole base in about 2200 to 2400 ticks on Crossroads, Small Basin, Broken Country and Twin Ridges, 4400 on Highlands. Four bots in a free-for-all on Crossroads eliminate each other over 18000 ticks, costing about 0.026 ms a tick for all four on average (worst full tick about 8 ms). The same seed gives the same game.
- Fixed while building it: the weighted rotation made every unit a Scout (credit now only changes on a purchase); an expansion's silo was placed one tile off the checked spot.
- **Known limit**: on 128 to 160 tile maps (Great Plains, Badlands) armies run out of battery before reaching the enemy and forward charging pads are starved of power, so attacks there are slow and often fail (an idle player was not destroyed after 16000 ticks). Outposts help but do not solve it. Needs a decision on energy for long marches (bigger batteries, pad power, or shorter attacks).
- `server/test/match.test.ts`: the co-op test no longer expects the bot to be a cheater and expects at least 5 mobile units after 600 ticks.
- `rules.ts` was not touched: the AI's constants are exported from `ai.ts` (`AI_*`). Balance (first attack at 2100 ticks, 600 matter of army) is untested against people.

## 2026-10-27 (build pop-over)

`npm test` (392 passed, 1 expected fail) and `npm run typecheck` pass. **Not looked at in a browser** (check in `TODO.md`).

- **Build menu is now a pop-over.** The open category's buildings no longer nest in the left pane: `#buildmenu` moved into `#map` as a glass panel (same look as the top-bar drop-downs) with the buildings as a grid of icon tiles (`ui.ts` `renderBuildMenu`, `style.css`, `index.html`). Closes on picking a building (Ctrl/Shift keeps it open), Esc (captured before the input handler so it does not also deselect), a click outside, or no builder selected; hidden while spectating. A lone category still lists its buildings directly in the pane. Convention added to `STYLE.md`.
- **Pop-over lines up with its tab.** The category buttons act as tab headings: `#buildmenu` is now a fixed body-level element whose top is level with the open category button and whose left edge overlaps the pane's border line (`positionBuildMenu` in `ui.ts`, re-run on open, resize, pane scroll, bar rebuild). The open button extends across the pane padding to meet it. The pop-over keeps its left border, but a `::before` joint the height of the tab (`--tab-h`) hides it and the pane's border line along the tab only (the pop-over itself does not scroll, its grid does, otherwise the joint's 1px overhang is clipped), so the two join with no line between them and the edge shows above and below. Category buttons have no transition (the tab's right edge no longer flashes as it opens) and the other categories dim to 50% while one is open (`has-open` on `#buildbar`). Not seen in a browser.
- **Pop-over slide.** Opening the pop-over slides it out from under the left pane in 70 ms (`.opening`, `build-slide` in `style.css`; z-index 9 while moving, 12 after). Switching category slides the old panel back under the pane (`.closing`, reverse, 70 ms), then renders and slides in the new one (`swapped` in `ui.ts`; clicks during the slide-away just change which category the swap ends on). Closing is instant. None of it with Reduce motion. Not seen in a browser.
- **Left pane narrowed** from 340px to 228px (about 2/3) in `style.css`; the header row wraps and the Orders grid is 4 columns instead of 5, resource rows use narrower columns (the sparkline scales down), the Download/Upload designs buttons stack, the docked music slider is 56px and the selection heading is 16px and wraps. Not seen in a browser.

## 2026-10-27 (markdown tidy)

- `PLAN.md`, `TODO.md`, `PROGRESS.md` and `REVIEW.md` compacted: finished design history and old daily detail removed, open work kept. Originals are in commit `b449816`. No source changed.

## 2026-10-26 (turrets on buildings; modal left pane and top bar; agent A4)

`npm test` (380 passed) and `npm run typecheck` pass. **None of this was looked at in a browser** (checks are in `TODO.md`).

- **Building turrets.** Building weapons use the vehicle turret art (`drawTurret`, `turretAnchors` in `art.ts`) and swing to face their target; one turret per weapon module (up to 4); a 1x1 weapon building is a round plinth. Gun, cannon, rotary, flak and laser barrels are 1.5x longer. Ore draws under units (own `groundLayer`).
- **Modal left pane.** Build, Orders and Selection sections show only when relevant (builder selected, selection can take orders, something selected). The build list is one indented tree column. Module list, design file buttons and Resign are folded into rows.
- **Top bar.** Matter, Energy and Units tiles (whole-tile fill as the bar) with hover drop-downs: Matter (net per tick, silos), Energy (one heading per power grid with batteries and generators, then World with Solar and Wind), Units (count per class; click selects the class). Tiles are updated in place; classes with more than 3 batteries or silos collapse to one `(xN)` row; draining resources go red at every level. The hover stats bar over the map is gone; its name text is now a heading at the top of the left pane. Formulas live in `client/src/energy.ts` and are checked against the simulation.
- **Connecting screen** shows the five real stages as a progress tile (100% Ready, red Failed).
- **Sound.** Positional sound falls off with distance^2.5, pans hard at the screen edge and is low-passed with distance; `volume` in `sound_manifest.json` may be a `{min,max}` range.
- **Opening camera** frames your base once on joining (`frameBase` in `renderer.ts`).
- **Room names** take any characters: rooms have a generated id and the typed name is a cleaned display `title` (40 chars). Two rooms may share a title.
- **Skirmish** replaces "Single-player" in player-facing text (internal id `solo` unchanged).
- **Depth.** Tight contact shadows under units and buildings; flying units ride above theirs. News button caption shows the latest changelog date and headline.
- **Engine bug found, not fixed:** `powerSystem` floors each generator's output a second time when transmission loss is applied, so any link gap costs small generators a whole unit per tick. Expected failure in `engine/test/known-bugs.test.ts`; see `PLAN.md`.
- Playtest phases P1 to P4 written into `PLAN.md`.

## 2026-10-24 (summary of the day's work)

- **Update check at the main menu** (A3): the "game has been updated" review (Keep mine / Replace / Merge) now runs once per page load from `showLobby` (`reviewSavedDesigns` in `designs.ts`), not only once a match starts.
- **Server hardening** (A3): crashes S1 to S3 fixed (`GET //`, the same as a WebSocket upgrade, an over-size frame); `server.ts` exports `startServer(port)` and `server/test/http.test.ts` attacks a real server. Budgets: message and byte token buckets, 500 queued messages per player, 2000 menu sockets, 30 sockets and 5 rooms per address (`X-Real-IP`; nginx derives it from `X-Forwarded-For` via realip; both limits configurable with `WST_MAX_SOCKETS_PER_ADDRESS` / `WST_MAX_ROOMS_PER_ADDRESS`), 256 classes ever per owner. `esc()` in the build button plus `client/test/html.test.ts`. Limits are in `docs/server.md`.
- **Path planning** (A3): blocked goals retarget to the nearest cell the unit fits; smoothing gallops and bisects; deterministic per-tick work budget `PLAN_WORK_PER_TICK` (12,000) with a straight stand-in route for waiting units. 256 scouts across Great Plains: tick after the order 446 ms -> 18 ms, all routes planned in 11 ticks.
- **Engine review fixes** (A2): deeply nested programs checked without recursion, a tick exception ends only its own match (`Match.crash`), Visitor chains no longer hit entity 0, a full event queue no longer drops Orders (ranked eviction), `compileDoc` checks Button hotkeys and stack depth. Tests in `hardening.test.ts`; budgets in `perf.test.ts` (mean tick < 15 ms, p95 < 50 ms at 256 a side; measured 1.9 ms mean).
- **Dev tools** (A2): Dev Options panel, Dev Rooms sidebar and the Campaigns menu exist only in clients built with `WST_DEV_TOOLS=1` (`__WST_DEV_TOOLS__`); the Dockerfile fails the build if their strings are in the bundle. The server ignores `dev` messages under `NODE_ENV=production`.
- **Menus.** Two glass tabs on Multiplayer (Games, Create a room) with an animated keyed room list; reusable `.glass-tabs`; wider Options panel with Show alpha maps (campaign maps as `Campaign/Map` in Multiplayer); News and Updates screen fed by `client/src/changelog.md`; menu panel transitions; Reduce motion setting; credits roll; sound limiter; compact play sidebar; vertical end-screen buttons.
- **Size tiers** (A1): micro to colossus chassis, legs (climb 1/2/any), terrain height map with cliffs, clearance pathing, `size()`/`climb()`/`heightAt()` queries, heavy modules and starters (Titan Works, Mite, Strider, Walker, Juggernaut, Colossus). Typed factory modules (one per tier) with an 8-slot queue grid and `dequeue`. Unit cost grows exponentially with tier (`SIZE_COST_FACTOR`).
- **Module damage and animation** (A1): per-module `broken` mask, aimed fire (`config.aim`), repair prefers broken modules; hull shape from motor x tier, animated legs, turrets, rotors, harvest sparks.
- **Cost UI (M6)** (A1): worst-case `≤Nc` on blocks, "CPU by event block" and a heat map after a test run, `cpuProfile` request for the in-match readout (the readout itself was later removed from the UI).
- **Campaigns**: `campaigns/` folder, `mode=campaign` rooms, campaign menus, progress in `localStorage`; Tiled editor in `editor/` with drawn terrain (Tutorial level 3, "The Gauntlet").
- `AGENTS.md` gained "Performance goals" and "What to avoid"; `STYLE.md` created.

## Earlier work

- **2026-10-20**: missiles (`game/missile.ts`), flak and missile shoot-down orders, tesla discharge art, `motor.turbo` (Dart, Pathfinder), starters Tank, Lancer, Stormer, Rocket Truck. Phase 2 of flowcode: durable activities with outcomes (`game/activity.ts`), `Order { urgent }`, custom events, built-in blocks (`flow/blocks.ts`), block cards in the graph, template chooser. Harvester CPU use fell from 16.8 to 0.17 cycles per tick.
- **2026-10-19**: flowcode M2 to M5: Flow IR, events, TypeScript-subset parser and printer, cost model, resumable runtime, 1024-unit benchmark (~1.3 ms/tick), old VM removed, Code tab with graph, text and split views (Rete + Lit). Checked in headless Chrome. An incident deleted part of `node_modules` through a Windows junction when cleaning up a temporary worktree (see the memory note on junctions).
- **2026-10-18**: first code review fixes: capped power bridges, damage-number cleanup, resign state, lobby `loadDesigns`, pause-panel invite link, bridge cap counts both directions, power and renderer hot-path fixes, `forfeit`/`leave` messages and one shared message allowlist (`messageAllowed`).
- **2026-10-15**: repair beam/drone and Repair button, unit production energy, laser drain, halved batteries, Daylight/Wind/Power tiles.
- **2026-10-14**: pausing with fewer than two players, rooms (one `Match` each), reconnect and resync, LEB128/u16 wire format, transmission losses, tesla pulse, scoreboard and names, merge-upload, program history, storage discharge limit, factory scripts, resource bars, construction energy cost, unit decay.
- **2026-10-13**: class buttons, demolish/cancel, construction towers, retire/restore classes, program diff review, sandbox test run, terrain and A* pathfinding, unit separation, energy and power networks, module system, starting base, owner-only task queues, tile-scaled rendering, generated docs overlay.
