# Plan

Planned work and decisions. Compacted 2026-10-27: finished milestones are summarised and the open work is listed first. The full earlier text (flowcode design sections 1 to 14, milestone tables, as-built notes) is in git: `git show b449816:PLAN.md`.

## Open work, in rough priority order

1. **Playtest phases P1 to P4** (below): simpler UI, unit identification, combat balance, a purpose for the designer. P1 first, then P3 and P2, then P4 (needs P3).
2. **Power bug (decision needed).** `powerSystem` (`systems.ts`) floors each generator's output a second time when transmission loss is applied (`gen[i] = Math.floor(gen[i] * efficiency)`). Any link gap makes efficiency just under 1, so a generator making 2 to 3 per tick loses 1 (two wind turbines one tile apart make about half). Expected failure in `engine/test/known-bugs.test.ts`. Fix: apply the efficiency to the exact total before the carry/floor step. It raises generation on every map with gapped links, so recheck the energy balance of starter bases and bots.
3. **Big-unit balance (decision needed).** Super-heavy and colossus cost x6.25 and x15.6 (`SIZE_COST_FACTOR`, `rules.ts`) but are no stronger, so per matter they lose to many cheap units. Buff hp/damage, shorten build time, or leave as expensive status units; then retune the Colossus-vs-scouts test in `tiers.test.ts`. Part of P3.
4. **Security and consistency leftovers** (details in `REVIEW.md`): S7 a Content-Security-Policy and CORS on the room list; S8 reconnect token out of the URL; S9 pin `tsx`/`ws`; S10 workflow permissions; S11 one name rule; S12 manifest cache; S13 to S17 consistency. Open question: add a process-level `uncaughtException` handler? Prefer fixing causes and keeping per-match isolation (`Match.crash`).
5. **Engine follow-ups**: one shared path search per command batch and `freeMoveTile`'s taken set once per batch (22 ms to issue 256 orders); script-system hot-path allocations (parked: median tick ~0.5 ms, revisit only with a profile); the player-like AI (`ai.ts`) fields light and medium units, missiles and flak but not heavy or super-heavy tiers or legs, and uses neither `config.aim` nor repair drones: teach it those and long-march energy (see `PROGRESS.md`); difficulty levels exist (`difficulty.ts`, 2026-10-30) with pickers on every mode that has bots; unit-cap weight per tier if micro swarms hurt.
5a. **Shield follow-ups** (see `PROGRESS.md`, 2026-10-29): pathfinding that plans round an enemy shield instead of waiting at it (the arc is a dynamic wall: needs a per-tick obstacle test in `findPath`, or a re-plan when a unit is blocked); bots and the player-like AI do not field shields or use `config.shieldAngle`; a missile's splash just outside the arc still hurts; maybe a second, heavier emitter tier (bigger arc and radius, `minSize` 3) and an "overload" the player can trigger; tesla and flak ignore shields by design (revisit if a counter is wanted).
6. **Module damage follow-ups**: starter programs and bots do not use `config.aim` or `brokenOf` yet; integrity numbers (25 + 6 per mass, legs 12/30/100) are a first guess; only the broken bit is networked; a broken factory or silo should be clear in the UI; flying units ignore height by design.
7. **Art follow-ups**: spinning helicopter rotors, scrolling tracks, role hints on the hull, turrets that track a lock before the first shot (needs a `Lock` event or the target networked), a broken-module look, antenna/sensor/CPU/wind glyphs and shaped buildings that do not yet grow with modules (the 2026-10-28 module pass covered batteries, factories, solar, silos, chargers), a browser check of the 2026-10-28 night lighting, crystal deposits and spark effects (see `TODO.md`), sounds for `Break` and `Harvest`, height shown only as shading plus a cliff rim.
8. **Sound**: hook the missile burst, `combat.shot.missile` (tag exists, no files), `SimEvent.Build` and `Charge` in `gameSounds.ts`; give any new combat/explosion tag `cooldownMs`/`maxVoices`; a global voice cap (~32) only if big fights still sound muddy; first-play drops (await decode for important tags); a `play()` test needs an `AudioContext` stub.
9. **Menus**: push the room list over the presence socket instead of polling every 3 s (keep keyed rows); migrate the designer tabs and Code tab view switch to `.glass-tabs` if the look works; remove or relocate dead CPU-profile code (`requestCpuProfile`, `cpuLines`); dev styles ship inert in production CSS; server dev code ships unreachable in the image (only worth removing with a server build step); a server-side "fake player" for Dev Rooms; Reduce motion is not yet honoured by the in-game renderer (screen shake, particles, build sparks); credits roll could get a skip-to-top.
10. **Flowcode M7 polish**: editor sounds, balance of cost constants (`flow/cost.ts`) and CPU cycles per tick, copy/paste of nodes, quick-add search on double-click, an error list panel, subgraphs/functions; optional M6 follow-ups (heat on data wires, per-class CPU summary, in-game profile in the Code tab). Readability review of the M12 graph cards with the user (do outcome pins and `emit` wires need arrows to the hooking `on(Name)` block? a settings inspector).
11. **Single Player scenarios** (below): playtest and tune Horde and Surrounded, show Horde progress, then more scenarios.
12. **Campaigns** (below): triggers, victory conditions, scripted starts, Tiled object layer.
13. **`REVIEW.md` architecture items** that need a design decision: explicit match/player state machine, per-tick elimination check, one per-entity renderer record, `SimEvent.Damage`, per-bridge flow in `NetworkInfo`, a `DesignStore` "designs synced" marker, `showPowerLabels` off `ClientState`.

14. **Steam vents and scenery follow-ups** (added 2026-10-28): bots do not build steam plants on vents (teach `ai.ts`: they already pick generators by count), and bot expansion should weigh scenery blocking a field. More scenery kinds and per-map clusters (made-by-hand layouts for the scenario maps), vents that sputter or cool down, a night glow for vents, `Wreck`-style destructible scenery, a sound for an open vent, and a minimap mark for vents.

15. **Water, lava and void** (W1 to W5 built 2026-10-30, as-built notes and follow-ups in the section below).

16. **New weapons and modules W-A to W-F** (decided and built 2026-10-31, section at the end): flak hits fliers, smoke launcher, point defence, railgun, ion gun, drone bay. Open: browser check and balance (`TODO.md`), sounds, bots that use them, drifting smoke, a unit cap for docked drones.

## Water, lava and void (planned and built 2026-10-30)

**As built (2026-10-30), where it differs from the plan below:**

- All five phases landed in one go, so there was no interim "liquids blocked for everyone": shallow water is wadable by every ground drive from the start (`DEFAULT_WADE` 2), amphibious reaches 5, hover 8.
- Path cost was measured first (`PROGRESS.md`): a corner-to-corner search on the river map costs 2716 cells against 2527 for a dry map of the same size, so no extra mitigation was needed. `perf.test.ts` has a budget for it.
- Generator: `LiquidSpec` has `lakes`, `lava`, `chasms`, `rivers`, `bridges` and `free`. `free` scatters bodies over the whole map instead of mirroring them (the user asked for asymmetric maps; what matters is that bases are joined). Rivers are never mirrored and are crossed by dry bridge strips, not shallow fords. Connectivity is checked from the first base, not the map centre (the centre can be a river), and only carves a dry corridor where a base is cut off. Four maps: Lakeland, Twin Rivers, Cinder Fields (free-form) and The Rift (mirrored chasms and lava).
- Scripts: `depthAt`, `wade`, `escapeX`/`escapeY` calls, a `LeaveLava` block, and starter classes Skimmer (hover), Amphibian and Wader (amphibious). Bots and the horde add a hover Skimmer on a map with liquid; dry maps are unchanged (checked against the old generator on 88 map and seed pairs).
- Dev tools: a `terrain` command (paint radius 0 to 20 at the target) and a `terrainPatch` server message (cells as index and signed elevation, at most 4096 a message), on a new Terrain tab.
- Not built: rain ripples on water, flames not burning on water, hover spray, a minimap mark. Old routes of units already walking do not re-plan after a dev paint until they get stuck.

**Open follow-ups:** bridges are only dry strips (no bridge art, and nothing a player can build or destroy: a buildable or breakable bridge would be a gameplay feature of its own); the Tiled campaign editor's tile palette (`editor/make-assets.mjs`, `terrain.tsx`) has no liquid tiles yet (the level JSON and `Terrain.decode` already take the letters `a` to `i`); hover and amphibious unit art is a plain larger hull (`art.ts`), and the numbers (costs, speeds `WADE_SPEED_PERMILLE`, lava damage, the 5 per tier heat) are first guesses to tune by playing; bots field Skimmers but do not use Waders or Amphibians for harvesting or assault; the player-like AI (`ai.ts`) does not know liquids; a sound for wading or lava; `Terrain.roomFor` is keyed by climb and wade, so a hover or amphibious big hull adds one more full-map pass whenever buildings change (no such unit exists yet; watch it if one does).

Why: the map is rock or open ground. Liquids add terrain that slows or blocks ground units without blocking sight or shells, and gives hover and amphibious motors a reason to exist. Performance analysis (2026-10-30): per-tick and per-frame cost is negligible (one byte read per moving ground unit, as the legs slowdown already does in `movementSystem`; the bed is drawn once per map). The real costs are (a) pathfinding once some cells are slow rather than blocked, and (b) the many places that read `passable === 1` as "open ground at height 0" (82 uses in 23 files).

**Decisions (agreed 2026-10-30):**

- **Elevation is one signed scale per cell**: 1..9 rock (unchanged), 0 dry ground, below 0 liquid, with the kind fixed by depth band:
  - -1, -2 **shallow water**: ground units may enter, slowed (W4; blocked until then). Hover at full speed.
  - -3 to -5 **deep water**: blocked for ground units unless amphibious or hover.
  - -6 to -8 **lava**: blocked for every ground unit; hover may cross but burns (W5).
  - -9 **void**: flying units only.
  - Tradeoff accepted: no shallow lava or shallow void. If that is ever wanted, add a separate liquid-kind byte layer (about 25 KB on the largest map; no speed cost) instead of stretching the scale.
- **In memory**: a new `Terrain.depth: Uint8Array` (0 dry, 1..9 = the bands above) beside `heights`, rather than turning `heights` into an `Int8Array`, so rock code is untouched. `elevationAt(x, y)` returns the signed value.
- **`passable` keeps meaning "dry open ground"** (1 only at height 0, depth 0). So every existing check that does not know about liquids is conservative: it treats liquid like rock, i.e. blocked. Only the places that must tell rock from liquid change (the W1 audit below).
- **Wire form**: still one character per cell, sent once. '0'-'9' as today; depth 1..9 as 'a'-'i'. `Terrain.decode` clamps unknown characters to '0' as it does now. Server and client ship together, so no version flag is needed.
- **Player programs**: `heightAt(x, y)` keeps its 0..10 contract (liquid reads 0) so existing programs keep working. New `depthAt(x, y)` returns 0..9 (0 dry). Document in `api.ts` and the manual that "height 0" no longer means "you can stand there". Mention it carefully in the changelog when W2 ships.
- **Gameplay is per cell; drawing is smoothed.** A drawn shoreline may cut a corner by at most about 0.35 tile, but every liquid cell's centre is drawn as liquid and every dry cell's centre as dry (tested).

**W1. Encoding, drawing, liquids blocked** (no new parts; nothing slower yet)

1. `Terrain.depth`, `elevationAt`, `encode`/`decode`, a `MAX_LIQUID_DEPTH` and band constants in `rules.ts`.
2. **The `passable` audit**:
   - `heightAt` must return 0 (not `max(1, heights)`) on a liquid cell.
   - `enterable` (legs) must refuse liquid.
   - Vision opacity (`vision.ts`, `!passable || occupied`) becomes rock-or-building, so lakes do not block sight.
   - The renderer's rock fill (`fillShape((x, y) => !open(x, y))`) and wall outline must use "rock", not "not passable".
   - `features.ts`, `simulation.ts` spawning/landing and `footprintFree` stay correct by the conservative rule, but get a test each.
   - Shells (`shell.ts`) need no change: liquid is below every shell.
3. **Dev tools**: a `terrain` `DevCommand` that paints an elevation (dry, a rock height, a water depth, lava, void) over a radius at the target, on a new **Terrain** tab in Dev Options, covered in `server/test/dev.test.ts`. It bumps `terrain.version` (path and room caches already key on it).
   - This needs the first **terrain change message**: `TerrainPatch { cells: [index, char][] }`, size-capped (e.g. 4096 cells a message) and rate-limited. It is sent to every player only when cells change, never per tick. It is also the hook for any future terraforming.
4. **Rendering**: see "Rendering liquids" below. W1 ships the static bed, shoreline and depth shading; animation can follow in W2.
5. **Perf**: bake time of the liquid layer on a 160x160 map with large lakes (measure; set a budget about 5x measured in a client test), and the existing perf tests unchanged.

**W2. Liquids on maps**

1. **Generator**: lakes, rivers, lava pools and void chasms as new `TerrainLayout` options or a `liquids` field on `MapDef`. They are drawn after rock and after every existing random draw, so existing maps and their RNG order are unchanged (test: encode every existing map before and after).
   - Mirrored like rock.
   - The connectivity step (`flood`) treats anything a wheeled unit cannot cross as a wall, so every base still reaches the centre on wheels.
   - Depth follows distance from the shore (the `computeHeights` BFS, run inward over liquid).
2. Two or three new maps that use them. Campaign maps: extend `tiled-to-level.mjs` and the editor palette with the new characters.
3. `depthAt` in the API, the manual and `docs/game.md`; changelog entry.
4. Bots (`ai.ts`, `bot.ts`): base and expansion placement already go through `footprintFree`; check that harvest fields across water do not strand harvesters (the path ends at the nearest reachable cell).

**W3. Hover and amphibious motors**

1. New motor parts, for example `motor.hover` (shallow and deep water at full speed; can cross lava, see W5; light hulls only, high `use`) and `tracks.amphibious` (deep water slowed, heavier).
   - New stat `wade` in `deriveStats` (`blueprint.ts`), the deepest band the unit may enter.
   - Mixing rules like legs (`blueprint.ts:214`).
   - Designer stats row (`DesignTab.ts`).
2. `Mobility` gains `wade`. `fits`/`enterable` take it into account. The room cache (`Terrain.roomFor`, keyed by climb today) is keyed by `(climb, wade)`. Watch the number of keys: each is a full-map pass whenever `version` moves, and every building placed moves it. If that shows in the perf tests, rebuild only the dirty region instead.
3. A unit cannot both climb and wade (legs are not waterproof) unless a later part says so: one less key combination.
4. Flying units never land on liquid (`ensureLanded` already needs walkable; test it).

**W4. Slowdowns** (shallow water for every ground unit, deep water for amphibious)

1. **Measure first**: add a perf case for a corner-to-corner path on a lake map, and a 256-unit order across a river, with `searchWork()` counts before and after. Path planning is already an open item (`REVIEW.md`, Open work 5); do not make it worse unchecked.
2. **Weighted A*** in `findPath`: per-band step-cost multipliers (keep them low and few, e.g. 2x shallow, 3x deep), with the octile heuristic still at open-ground cost so it stays admissible. Searches that touch no liquid cost the same as now.
3. **Smoothing guard**: `smooth`/`lineWalkable` must refuse a shortcut that enters slower ground than the cells it replaces. Otherwise string-pulling turns a planned detour back into a straight wade.
4. **Movement**: one depth read per moving ground unit per tick, as with `CLIMB_SPEED_PERMILLE`. Per-band, per-motor speed permille constants in `rules.ts`.
5. Rebalance check: harvester round trips on maps with shallow fords.

**W5. Lava and void extras**

- Hover units over lava take heat damage (one `sim.damage` per hover unit on lava every few ticks; cap and cost like the flame burn).
- A unit pushed or stranded on lava by a dev paint or terraforming dies.
- Lava glows at night through the shared glow pool.
- Flames do not burn on water and burn longer on lava edges (optional).
- Rain feeds shallow water visuals only (no gameplay).

### Rendering liquids

Follows `STYLE.md` (add a "Liquids" section there when W1 lands). Everything static is baked once per map (and re-baked only for a `TerrainPatch`, just the patched region if a full re-bake is too slow). Nothing is rebuilt per frame.

**Smooth edges (the waterline and lavaline)**:

- Treat each cell centre as a sample of a liquid field (1 inside a liquid of that band or deeper, 0 outside). Run marching squares on the dual grid (corners at cell centres) at threshold 0.5, with linear interpolation. Straight shores then fall exactly on the cell boundary, and diagonal shores cut corners instead of stair-stepping.
- Then 2 iterations of Chaikin corner-cutting on each closed outline, so shores read as curves. A single-cell pool becomes a small round pond, not a diamond.
- `contours.ts` already does marching squares; reuse its approach and keep the new code in a client-only `liquids.ts` that Node tests can drive (outlines are plain number arrays; Pixi only in the renderer).
- Test: every liquid cell centre is inside its outline, every dry cell centre outside, and outlines are closed and do not self-cross on the generator's maps.

**Depth shading**:

- One outline set per depth level, drawn shallowest first as translucent fills, so water darkens step by step towards the middle (-1 pale teal over sand, down to deep blue at -5) and the steps blend rather than band.
- Each deeper level's outline is pulled in a fraction of a tile by the smoothing, so the tiers do not share edges.
- Lava runs dark crust at -6, through orange, to a bright yellow-white core at -8.
- Void is near-black with a cold gradient into the drop.

**Soft shore**:

- On the dry side, a wet-ground band: 2 or 3 strokes of the shoreline at falling alpha and growing width, like the soft flame sprites rather than one hard line.
- On the liquid side, a pale foam line for water, a dark cooled-crust rim with a hot inner line for lava, and a crumbling light rim for void.
- Where rock meets liquid, the rock's wall outline is kept, so cliffs over water still read as walls.
- Open-ground grid lines and `contours.ts` lines skip liquid cells.

**Animation** (cheap, capped, off with Reduce motion, extras behind the Fancy weather setting):

- Water: pooled soft highlight sprites drifting with `state.wind`, spawned only over visible water cells (cap about 60, like `SOFT_CAP`), and a slow alpha "breathing" of the foam line (one alpha write per frame).
- Lava: a slow pulse of the core layer's alpha, plus pooled bubbles that swell and pop (cap about 30).
- Rain: ripple rings on water instead of splashes (`precipitation.ts`).
- Units in shallow water: a pooled wake ring under moving ground units; hover units a spray.
- Under Reduce motion everything is static: no drift, pulse, bubbles or wakes.
- Liquids sit in the ground layer, under units, the night tint and fog, like rock.

**Option if the CPU outlines show artefacts at high zoom**: a single fragment shader over a cell-resolution depth texture with linear filtering and a `smoothstep` at the shore. It gives resolution-free edges, depth ramp and animation in one draw call, but it would be the project's first custom shader (check the WebGL and WebGPU renderers both). Not the first choice; only with a measured reason.

## Lists and chains: follow-ups (added 2026-10-29)

Done: find calls, chains and the harvester rewrite (see `PROGRESS.md`). Open: (1) graph editing of chains (steps are text-only in the graph today: add step nodes or an inspector); (2) lists you can keep in a variable (needs a bounded per-unit list heap; today a list lives only inside a chain so the VM needs no per-unit memory); (3) more sources (`findUnits(kind)`, `findHarvesters()`) and per-thing queries once a program needs them; (4) the player-like AI (`ai.ts` `assignHarvesters`) could use the same depot/field choice; (5) the other starter blocks (`BuildJobs`, `RepairJobs`, `MaintainNearby`) still use `nearestSite()` / `nearestDamaged()` and could spread builders over sites with `findSites().minBy(s => dist(s) + 8 * crowd(s, 2))`; (6) harvesters whose silos are all full could say so with `notify`.

## Single Player scenarios (started 2026-10-27)

Why: Single Player was one shape (you in a corner, one bot sending waves). A scenario changes where you start and how the opposition arrives; rules, units and designs stay the same. `Scenario` (`engine/src/game/scenario.ts`) is chosen on the Single Player form, travels as `scenario=` in the URL and socket query, and applies to `mode=solo` only. Design in `docs/game.md` ("Single Player scenarios").

**Done (first cut, tests pass, not yet seen in a browser):**

- **Classic**: unchanged.
- **Horde**: no enemy base; `HordeSpawner` feeds a small group from the opposite corner every 6 s after 90 s, groups grow by one unit per 5 min, a new bot class joins the mix every 6 min, at most 120 alive. Endless: only the human can lose. Balance numbers are first guesses (`HORDE_*` in `rules.ts`).
- **Surrounded**: human base at the map centre, a bot in each corner, bots wave 1.75x slower (`SURROUNDED_BOT_PACE`); destroy all four to win. `Match.bots` now holds a list of opponents per human.

**Next, in order:**

1. **Playtest and tune** both (see `TODO.md`): is Horde survivable on Crossroads for 10+ minutes with sensible play, does it get dull, do 120 units hurt the tick (add a perf budget for a full horde), is Surrounded winnable (starting credits? slower pace? bots staggered so the four waves do not land together?).
2. **Show progress in Horde**: time survived and units destroyed on screen (the scoreboard already has tallies), a "Survived 12:30" line on the defeat screen, a best time per map in `localStorage` (client only).
3. **Options on the form** once the defaults feel right: difficulty (pace and cap multipliers), horde direction (one corner, two, or all four edges), starting matter; keep the form short.
4. **More scenarios, one at a time**, each a small setup function plus a victory rule: *Last stand* (survive N minutes, then win; shares the survive-N-minutes rule with campaign victory conditions, item 2 under Campaigns, so build that once), *Two fronts* (horde from two corners), *Boss waves* (every Nth group is one big unit; needs bots to field the new tiers, Open work 5), *Scarcity* (fewer resource fields, forces expansion), *Neutral outposts* (capturable defences).
5. **Bots and the horde field the new tiers and legs** (Open work 5) so late Horde is not only light guns.
6. **Rooms** (done 2026-10-28): Co-op Horde and Co-op Surrounded, up to four humans on maps made for them (see `docs/game.md`). Open: tune the cap and pace for four players, more scenario maps, a scenario hint in the waiting room.
7. Manual page and a short in-game hint per scenario.

## flowcode: how it works (done)

Event-driven visual and textual programming, merged into `main` and fully replacing the old polling text language (last commit with it: `8d2f1d5`).

- **One model, two views.** The canonical Flow IR (JSON, `format: wst-flow`) is shown as a node graph (Rete.js + Lit, `client/src/flow/`) or as TypeScript-subset text (Lezer parser, deterministic printer). Both edit one `FlowDocument`; invalid text freezes the graph with a banner. View-only data (positions, loose pieces) lives in `views`, stripped before upload. Stored in the existing `source` fields (`LIMITS.sourceLength` 32000).
- **Events are the only entry points** (`Spawned`, `Idle`, `Every`, `Timer`, `Order`, `Arrived`, `Damaged`, `Detected`, `Visitor`, `Button`, `EnergyLow/Full`, `Message`, own events). Configuration (sensor `watch/range/interval/sort/limit`, filters, button label/key) lives on the event block and is checked against hardware limits; runtime settings are `config.*` nodes. An event with no handler costs nothing.
- **Cost model**: 1 cycle per node executed plus the API call cost, 1 per arc; literals cost memory (distinct values), not cycles. Handlers suspend between statements when a tick's cycles run out (a statement may overdraw and repay); a hard per-handler cap faults and reboots the unit. Everything is in `flow/cost.ts`.
- **Engine** (`engine/src/flow/`): `ir`, `events`, `nodes`, `text`, `check`, `compile` (flat instruction list with jumps), `run` (resumable interpreter, struct-of-arrays state), `blocks`. Reactive units are skipped by a flag check. The 1024-unit benchmark runs a tick in about 1.3 ms.
- **Phase 2**: durable activities (`goTo`, `approach`, `harvest`, `dock`, `take`, `build`, `repair`, `charge`, `supply`, `engage`) run in the engine and report outcomes as continuations (outcome pins in the graph), so busy units cost no CPU; `Order { urgent }` policy and `nextOrder`; custom events with `emit`/`on(Name)`; built-in blocks (TakeOrders, RechargeWhenLow, ReviveFlatUnits, HarvestLoop, BuildJobs, RepairJobs, MaintainNearby, EngageEnemies, Resupply, RallyPoint, DispatchHarvesters, StorageController, RadarPing) that `Expand` into plain event blocks. Every starter class is blocks only and none uses `Idle` (a test enforces it).
- **Decisions still standing**: `Detected` reports what is in range on each sweep (a `fresh` option may come later); source options are fixed at upload (runtime override deferred); `rest(n)` exists as `config.rest`; event parameter names avoid API names (`Order(type, tx, ty, target)`); a variable may not reuse a built-in name.

## Unit size tiers (done 2026-10-24)

Tier is `size` 0 Micro, 1 Light, 2 Medium, 3 Heavy, 4 Super-heavy, 5 Colossus. `PartDef.radius` sets drawn size, separation and reach. Terrain has a height map (`Terrain.heights`: 0 open, 1..9 rock; some outcrops are cliffs starting at `CLIFF_HEIGHT` 3); the wire form is one digit per cell. `Mobility { climb, clearance }`: legs climb 1 (light), 2 (heavy) or any (colossus, slowly: `CLIMB_SPEED_PERMILLE`); super-heavy and colossus need a 3-wide corridor, and a unit that starts in a tight spot may squeeze out but never enter one. Program queries `size()`, `unitSize(h)`, `climb()`, `heightAt(x, y)`.

**Typed factory modules**: one factory module per tier (`factory.micro` ... `.colossal`); a building builds a unit only with a module of exactly that tier; `factory.basic` is an alias of the light module for old saves. Starters: HQ light + medium, Light Factory micro + light, Vehicle Factory medium, Heavy Factory heavy, Titan Works super + colossal. The production queue is replicated (8-slot grid, `dequeue` refunds). Open ideas: one production line per module of a tier, tier-scaled module costs, a "can build" legend in the designer.

## Campaigns (framework done 2026-10-24)

`campaigns/` folder (formats in `campaigns/README.md`), `mode=campaign` rooms, menus (`campaignMenu.ts`), progress in `localStorage`, Tiled editor in `editor/` with drawn terrain, and campaign levels playable in Multiplayer as `Campaign/Map` (behind Options > Show alpha maps). A level is solo vs the standard bot; victory is "destroy every bot". Next, in order:

1. **Trigger system** (needs a design pass first; `triggers` in map files is a reserved array, kept by the server, never sent to clients). Settle: event sources (tick, area entered, destroyed, resource held, timer), actions (spawn, message, objective, change victory rule, sound), where it runs (server `Match`, deterministic per tick, replay-safe), whether it reuses flowcode, and the in-level objective/message UI.
2. **Victory conditions beyond `eliminate`** (survive N minutes, destroy a target, reach an area).
3. **Scripted starts**: fixed corner, starting units/buildings/resources, enemy composition and bot aggressiveness per level.
4. **Tiled object layer**: start positions, resource fields, neutral units, pre-placed buildings and named trigger regions, read by `tiled-to-level.mjs`.
5. Server-side progress/accounts (today progress is per browser and any level can be started by URL); per-campaign design restrictions, music, briefing image, a "campaign complete" screen.
6. Campaign maps in Multiplayer: a terrain preview (send `Terrain.encode()` on `GET /api/v1/campaigns` or add a preview endpoint); whether levels balanced for one human suit four players; triggers and scripted starts do not run in rooms. When campaigns go live, drop the alpha option and the dev gating on the Campaigns button (`devMode()`).

## Credits, options, perf budgets (reference)

- `client/src/settings.ts` holds client-only settings (reduce motion in `wst-reduce-motion`, sets `data-reduce-motion` on `<html>`; show alpha maps). New motion keys off that attribute or `reduceMotion()`. Add contributors to `CREDIT_PEOPLE` in `lobby.ts`.
- Perf budgets (`engine/test/perf.test.ts`, run by `npm test`; `npm run test:perf` alone; `WST_PERF_SLACK` loosens wall-clock ones): 256-a-side tick mean < 15 ms and p95 < 50 ms; 4x units costs < 8x the median tick; VM > 1000 cycles/ms; a reactive unit uses 0 cycles between events; corner-to-corner path on Badlands < 25 ms; issuing a 256-unit order < 100 ms. Add a budget with any new per-unit per-tick system. `engine/test/perf-scaling.test.ts` times real fights of 64 to 1024 units including fog filtering and encoding, and checks growth over 4x units; add a case there for any new per-unit system that shows up only in combat. The single-number budgets in `perf.test.ts` were tightened to about 5x measured on 2026-10-27 (the 256-unit order stays at 3x: the open O(n^2) item).

---

# Playtest phases P1 to P4 (decided 2026-10-26, after playtesting with other players)

Findings: (1) the in-game UI is too complex and inconsistent; (2) units are almost impossible to tell apart; (3) multiplayer performs well, but weapons and armour need balancing, because mass-producing basic units is a viable strategy; (4) new players have no reason to use the designer.

Open decisions for the project owner: keep or drop the designer (P4); which damage model (P3 step 2); whether to unlock modules by tech (P4 step 3).

## P1. Simpler in-game UI: one left pane, shown by mode (steps 1 and 3 mostly done 2026-10-26)

Done: modal Build/Orders/Selection sections, extras folded, meters in a top bar with drop-downs, hover bar removed (see `PROGRESS.md`). Still open:

1. **Factory selected**: production queue and unit buttons as a clear mode; **combat units selected**: the command grid (move, stop, attack, hold fire, charge, custom actions) with hotkeys and a compact health/energy summary; **other buildings**: compact stats and custom actions.
2. Move the design download/upload/reset buttons into the Designer (and Options); Docs and Designer from one menu button; decide whether any hover bar over the map is needed after a play-test.
3. **Consistent components**: one panel/section style, one command button size, one icon tile style; record the conventions in `STYLE.md` (modes appear/disappear, Reduce motion respected; a first draft exists).
4. Phone width and small windows: the pane may collapse to icons; keyboard shortcuts keep working in every mode.

Done when: with nothing selected the screen is the map plus a slim pane; selecting a builder shows building options, selecting a unit shows its commands, and nothing a player needs is lost.

## P2. Unit identification and silhouettes

Why: the hull outline depends only on drive and chassis tier; weapon, sensor and CPU are small marks inside a hull about 0.3 tile across, and team colour fills the whole hull. Scout, Hawk, Dart and Strider differ only by drive.

1. Role-led silhouettes (combat, worker, scout, artillery, support first; drive second).
2. Team colour as a rim or stripe, not a fill.
3. A steeper size ladder on screen (tiers 0 to 5 clearly different).
4. Barrels and launchers long enough to read at normal zoom, one shape per weapon kind.
5. Zoomed-out class icons (with a tier pip) below a zoom threshold.
6. Solar arrays visibly respond to `daylight` (glint/brightness, dark at night).
7. Selection outline and health bar sizes follow the tier. Check with several teams and 100+ units at 60 fps (textures cached per class).

## P3. Combat balance: counters and a reason to build bigger

Why: damage is flat (`Simulation.damage`), armour only adds hit points, ground shots never miss, a design carries one weapon, and the light gun does the most damage per matter with no energy or ammo. Per 1000 matter, Scouts bring about twice the damage of Tanks for the same hit points. The Lancer spends 100 energy for 8 damage and empties its batteries in about 22 shots.

1. **Armour reduces damage** per hit with a minimum per hit, so many weak shots stop working against heavy units.
2. **Damage profiles / counters**: rapid-fire (strong vs light/micro, weak vs armour), heavy single shots (strong vs armour and buildings, wasteful vs swarms), energy weapons (ignore some armour, cost power), area damage vs groups; data in `PART_TUNING` plus an armour-vs-profile table in `rules.ts`.
3. **Light gun upkeep** (small energy or matter per shot); re-balance Lancer and laser costs.
4. **Big units worth their price** (see Open work 3).
5. **Balance harness**: deterministic, fast test running equal-cost armies against each other and failing if one composition wins every matchup. Do not weaken `perf.test.ts`.
6. Update starters, bot waves (`bot.ts`), the manual and the player changelog. Damage changes are disruptive to saved designs: say so plainly in the changelog.

## P4. A purpose for the designer

Why: 34 ready-made designs exist, factories build them straight away and the stock units are already best value. Dropping the designer would remove the game's idea (programmable units), so make it part of play. Depends on P3.

1. A small starting roster (about six combat designs plus workers and buildings); the designer is where the rest comes from.
2. Designs that answer the opponent, with the matchup shown in the designer (damage vs each armour class, cost, build time).
3. Optional tech path: modules unlock by building the matching structure during the match (decide with the owner).
4. First-time guidance: a short guided design in the campaign or Single Player, and a clearer "why design" blurb in the Designer and Manual.
5. Fallback if the designer stays optional: keep it as the advanced mode and make stock units a deliberate, balanced traditional-RTS roster.

---

# Several weapons per class (script side done 2026-11-01; engine side open)

Scripts already see weapons as a list: `self.modules.weapon.length`, `self.modules.weapon[i].fire(h)` / `.laserPower(n)` / `.aim(k)` / `.kind` / `.range`, and `self.modules.weapon.filter(i => self.modules.weapon[i].kind === W_LASER).first()` (builtins `weaponCount`, `weapons`, `weaponKind`, `weaponRange`, `weaponFire`, `weaponLaserPower`, `weaponAim` in `game/api.ts`, names in `game/members.ts`). **Update 2026-11-01: steps 1 to 3 are built** (see `PROGRESS.md`): a class carries up to `WEAPONS_BY_SIZE` weapons (micro 1, light 2, medium 2, heavy 3, super-heavy and colossus 4; a building up to its footprint, at most 4), each with its own target, cooldown, laser power and aim; the plain `fire(h)`, `laserPower(n)` and `aim(k)` act on every weapon, the indexed forms on one. Decisions from the owner: a weapon never picks its own target (a weapon with no lock holds fire; the owner's "fire at its current angle" is NOT built, see below), matter is shared through the one cargo bay, and the limit follows chassis size. Still open: step 4 (the hull shows one turret and one beam origin whatever the number of weapons), the dev tools, the balance pass, and bots designing multi-weapon classes.

Steps, each shippable on its own (the owner chose full multi-weapon on 2026-11-01; decide the open questions with them first):
1. **State per weapon.** `Weapon` component (target, aim, power, cooldown, charge) becomes per weapon index; `BlueprintStats.weapon` becomes `weapons[]` (same fields). About 70 uses in 20 files (`systems.ts` combat, `shell/missile/flame/rail/ion/aim.ts`, `ai.ts`, `activity.ts`, `vision.ts`, `dev.ts`, client `art/renderer/DesignTab/gameSounds`). Keep the hot path allocation-free: parallel typed arrays indexed by `e * MAX_WEAPONS + i`, `MAX_WEAPONS` small (say 4).
2. **Make the script builtins real.** `weaponCount`/`weaponKind`/`weaponRange` read the list; `weaponFire(i, h)` etc. act on weapon i; `fire(h)` stays weapon 0. `engage(h)` and the automatic fire pick every weapon in reach.
3. **Blueprint and designer.** Allow several weapon modules (by chassis size and slots); the designer shows each; the CPU/energy/matter cost per shot adds up; the balance pass (P3) and the factory cost need a look.
4. **Rendering and sound.** Mount positions on the hull, one beam/shell origin per weapon, per-weapon cooldown flashes.
5. **Same for shield, light and smoke** only if wanted (they are objects, not lists, today).
Open questions: does a weapon the script did not aim fire on its own target (nearest enemy in its reach) or hold fire? Do two weapons share the cargo bay's matter? Is the limit by chassis size?

# New weapons and modules W-A to W-F (decided with the owner 2026-10-31; ALL BUILT 2026-10-31, see `PROGRESS.md` for what differs from the text below: AIR detect kind, no cloud drift, drones are micro or light and are records not entities, no Rail or Point Defence tower, no sounds or bot use yet; looks and balance await a person, see `TODO.md`)

Six additions, to be built one at a time in this order (each one is a separate, finished change: tests, typecheck, docs, `PROGRESS.md`, changelog). They also serve P3 (counters): flak gets an air role, the railgun punishes massed units, point defence and smoke counter missiles, shells and lasers, and the drone bay gives big hulls a reason to exist. All numbers below are **first guesses**: put them in `rules.ts` (`PART_TUNING` and named constants), never inline, so they can be tuned later. If a step needs a design decision this plan does not cover, stop and ask the owner rather than guessing.

## How every new part is added (checklist for each step)

Read the code named here before writing anything; copy the closest existing part rather than inventing a new pattern.

1. **Rules**: tuning in `PART_TUNING` (`engine/src/game/rules.ts`, around line 525) plus any named constants near the related ones (e.g. next to `FLAK_BURST_RADIUS`, `TESLA_*`).
2. **Catalogue**: an entry in `CATALOGUE` (`engine/src/game/parts.ts`) with a player-facing `description` built from the tuning values (see how `flak.cannon` and `shield.emitter` do it). A new weapon kind goes in the `WeaponKind` union; a new module type needs a new `PartSlot`, a new number at the end of `SLOT_CODES` (never renumber existing codes: scripts use them), and an entry in `SWITCHABLE` if it uses energy.
3. **Blueprint stats** (`engine/src/game/blueprint.ts`, `statsFor`, around line 270): add the fields the systems need. **A blueprint has only one `weapon` stat** (the last weapon module wins), so anything that must work alongside a weapon (point defence, smoke, drone bay) is its own slot, not a weapon.
4. **System**: the game logic, in `systems.ts` or a new file beside it when it is more than a few dozen lines (follow `light.ts`, `shield.ts`, `flame.ts`, `shell.ts`, `missile.ts`: a header comment explaining the rule, state that does not replicate in a side table on `Simulation`, state the client must draw in a small replicated component in `components.ts`). Register the system in the tick in `simulation.ts` with a small, focused edit.
5. **Hot path rules** (`AGENTS.md`, "Performance goals"): no new arrays, objects or closures per unit per tick; use `sim.spatial.forEachInRadius`, never all-pairs; do expensive work only when a cooldown is ready or a projectile/effect exists. Randomness only from `sim.rng` (determinism). Hard caps on anything that spawns entities (like `MAX_FLAMES`).
6. **Script API** (`engine/src/game/api.ts`, `flow/blocks.ts`, `flow/check.ts`): any new call gets a cycle cost and its docs string; actions go in the action list, settings in `SETTINGS` and are called as `config.x(...)`. Keep the checker and the sandbox in step. A starter block for the common use (like the ShieldGuard and Spotlight blocks) is welcome.
7. **Network**: new replicated fields are encoded compactly like the existing components; nothing big per tick. Validate anything new arriving from clients (`net/protocol.ts`).
8. **Client**: a turret/glyph per new weapon kind in `client/src/art.ts` (the `weapon` union around line 44 and the `case` list around line 574: one readable shape per weapon kind, see P2 step 4), shot effects (`beams.ts`, `blasts.ts`, or a new file like `spotBeam.ts`), sounds (`gameSounds.ts`, with `cooldownMs`/`maxVoices`), Reduce motion respected (`STYLE.md`). Do not rebuild Pixi objects per frame.
9. **Content**: at least one stock design using the part in `engine/src/game/content.ts` (with a short program, like `FLAK_PROGRAM_TEXT`), so the Dev Options Spawn tab and the factory list can produce it.
10. **Dev tools** (`AGENTS.md` rule 9): a `DevCommand` in `engine/src/net/dev.ts` handled in `Match.dev` where the effect can be forced (named in each step below), a control on the matching tab of `client/src/devTools.ts`, and a test in `server/test/dev.test.ts`.
11. **Docs**: the in-game Docs (`client/src/docs.ts`), the Manual (`client/src/manual.ts`) and `docs/game.md`.
12. **Tests**: an engine test file per step in `engine/test/` (e.g. `railgun.test.ts`) covering the rule and its edge cases; `npm test` and `npm run typecheck` pass, including `engine/test/perf.test.ts` (do not loosen a budget; add one if the step adds a per-unit per-tick system).
13. **Record**: `PROGRESS.md`, a `TODO.md` entry for what only a person can check in a browser (looks, feel, balance), and a player changelog bullet (`AGENTS.md`, "Player-facing changelog"). Rebalances that change what an existing unit does (W-A) are disruptive: say so plainly in the changelog.
14. **Bots** (`engine/src/game/ai.ts`, `bot.ts`): optional per step, noted where it matters.

## W-A. Flak hits flying units

Flak today damages only missiles (`systems.ts` `combatSystem`: the target check around line 737 drops any target that is not a missile, and the air-burst around line 760 only hurts missiles). New rule: **flak also hits enemy flying units** (`sim.stats(t).flying`, never structures or ground units).

1. Target check: allow a target that is a missile **or** an enemy flying unit.
2. Air-burst: inside `FLAK_BURST_RADIUS` of the target, damage every enemy missile (as now, `stats.damage`) and every enemy flying unit by a new `FLAK_AIR_DAMAGE` (first guess 8 per burst; flak fires every 3 ticks, so about 27 damage per second against each flier caught in the burst). Never misses, as now. Flak still ignores shields (`shell.ts` `rangeBonus` and the shield code treat flak as special: keep that).
3. Sensing: check `sensor.ts` (`DetectKind`, around line 103) for a way to detect only fliers. If there is none, add a `FLIER` detect kind (enemy flying units only) to the Detected block and the API constants, with docs.
4. Programs: update `FLAK_PROGRAM_TEXT` and the Flak Turret program (`content.ts` around lines 197 to 205) to engage missiles first, then fliers.
5. Descriptions: the `flak.cannon` description in `parts.ts` ("Harmless to units and buildings" becomes "harmless to ground units and buildings").
6. Bots: `ai.ts` builds Flak Turrets/Trucks when it has seen missiles (`seenMissiles`, around lines 522, 547, 737); make seeing enemy fliers count too.
7. Dev tools: none needed beyond spawning a Flak Truck and a helicopter (already possible).
8. Tests: flak damages an enemy flier in the burst; does not damage an enemy ground unit or building beside it; does not damage own or allied fliers; still kills missiles as before.
9. Changelog: this changes what an existing unit does, so say it plainly (Flak Trucks and Turrets now also shoot aircraft).

## W-B. Smoke launcher (module, slot `smoke`)

A module any unit or building can carry (any chassis size, including micro; one per class). It **uses no matter**, costs some energy per volley, has a **long cooldown**, and each use throws a **volley of 3 canisters**.

1. **Firing**: script action `smoke(degrees)` (and a block, e.g. "Pop smoke when hit" using the existing damage event). Three canisters thrown at the heading ±`SMOKE_SPREAD` (first guess 25 degrees; the middle one straight), each landing `SMOKE_THROW` tiles out (4), costing `use` energy for the volley (60), then `SMOKE_COOLDOWN` ticks (300 = 30 s). A switched-off or broken launcher cannot fire.
2. **Clouds**: each canister makes a cloud entity (replicated `Smoke` component: position, radius, age, for drawing) of radius `SMOKE_RADIUS` (1.5 tiles) lasting `SMOKE_TICKS` (150 = 15 s). Drifts slowly with the weather's wind (`sim.weatherNow()`), deterministic. Rain may shorten it (optional). Cap with `MAX_SMOKE`.
3. **Effect**: smoke **blocks sight** like rock does: sensors, vision and fog (`vision.ts`: the `VisionGrid` shadowcaster treats a wall tile as blocking; add a per-tile smoke grid, e.g. a `Uint16Array` of "smoky until tick" per tile, filled when a cloud lands or moves, so the shadowcaster can test it cheaply), weapon sight cones, spotlight beams (`light.ts`) and laser links. Radar and radio are **not** blocked (they are the counter). Lasers that cross smoke do `SMOKE_LASER_FACTOR` (0.5) damage. Check whether `combatSystem` needs the shooter to see its target today (it does not appear to): if not, smoke stops **new** targets being found by sensors and the Detected block, and a locked target that disappears into smoke is dropped once the shooter's owner can no longer see it. Decide this with the owner if it turns out larger than that.
4. **Client**: soft grey drifting puffs (pooled sprites, no per-frame rebuilds), canister arcs, a pop sound; with Reduce motion, static fading discs. Smoke over fog must not reveal anything (clouds in fog are hidden like other entities).
5. **Dev tools**: a "Smoke at point" control (Combat tab) that drops a volley at a clicked spot.
6. **Tests**: three clouds per volley; no matter spent; cooldown respected; a unit behind a cloud is not seen and not detected; radar still sees it; laser damage halved through smoke; clouds expire; the cap holds.

## W-C. Point defence (module, slot `defence`)

An automatic close-in turret that shoots down **incoming enemy missiles and cannon shells** (and optionally fireballs in flight). No script needed, unlike flak (which must be aimed with `fire()`): it is the passive alternative. Not a weapon slot, so it works alongside the class's real weapon.

1. **Tuning** (first guesses): range `PD_RANGE` 3 tiles, cooldown 4 ticks, `use` 3 energy per shot, mass 2, any chassis size.
2. **Rule**: when the module's cooldown is ready **and at least one enemy missile or shell exists in the match** (keep a cheap count; do no work otherwise), find the nearest enemy missile (`sim.missile`) or shell (`sim.shell`; shells are entities with a position, see `shell.ts` `launchShell`) within range with `sim.spatial.forEachInRadius`. Shoot it: a missile is hit with its own `hitChance` (`missile.ts` `shotHitsMissile`) and takes `PD_DAMAGE` (4); a shell is destroyed with `PD_SHELL_HIT_CHANCE` (0.35, drawn from `sim.rng`). Pay energy per shot; a flat battery means no shots. More than one module: more shots per cooldown (one each).
3. Shields: point defence shoots out from inside its own shield fine (the projectile is the target, not a unit).
4. Script: `setModule` can switch it off; no new API needed. Optionally a sensing call for "shots fired by my point defence" is not needed: skip it.
5. **Client**: a small twin-barrel glyph, short bright tracers (reuse `beams.ts` gun shots), a puff where a shell is stopped; sound with a low `maxVoices`.
6. **Content**: a stock design (e.g. an escort truck) and a point-defence building.
7. **Dev tools**: none new needed (spawn a Rocket Truck and the escort); add one if testing proves awkward.
8. **Tests**: shoots an incoming enemy missile and shell in range; ignores own and allied ones and anything out of range; spends energy; does nothing with no battery or when switched off; deterministic for a seed. Add a perf check: a 256-a-side fight with point defence on many units stays within the existing budgets.

## W-D. Railgun (weapon kind `rail`)

A heavy line weapon with a **long charge-up**: very high damage that pierces through several targets, but the carrier is exposed while it charges, so a swarm can kill or interrupt it before it ever fires.

1. **Tuning** (first guesses): `minSize` 3 (heavy and bigger hulls, and buildings), mass 8, range 18 tiles, damage 120, charge `RAIL_CHARGE_TICKS` 50 (5 s), cooldown 60 ticks after a shot, `use` 400 energy taken **when the charge starts** (lost if the charge is broken).
2. **Charge**: when the weapon is ready and has a target in range, it starts charging (side table on `Simulation`, e.g. a charge counter per entity; do not reuse `weapon.power`, which the laser and flamethrower use). The charge **breaks** (energy lost, cooldown starts) if, during it: the carrier takes at least `RAIL_BREAK_DAMAGE_FRACTION` (0.15) of its max hit points, or is stunned (tesla, lightning), or the weapon module is switched off or broken, or the target leaves range. A mobile carrier cannot move while charging (it stops; a move order cancels the charge).
3. **Shot**: an instant line from the muzzle to full range along the aim at release. It damages every enemy unit and building the line passes through, up to `RAIL_PIERCE` (4) targets, each one after the first taking `RAIL_PIERCE_FALLOFF` (0.6) of the previous one's damage. Rock stops it (trace the terrain like the shell code does). An enemy shield across the line takes the whole remaining hit (`shieldAbsorb`) and stops it. Own units on the line are not hurt (a first guess; ask the owner if friendly fire seems better). Ignores missiles.
4. **Telegraph**: a replicated "charging" state (start tick and heading) so every client sees a glint at the muzzle and a faint aim line for the whole charge, and so enemy programs can react: a sensing call `charging(h)` (1 if a known unit is charging a railgun, else 0), with a cycle cost.
5. **Client**: a long barrel glyph, growing glow during the charge, a bright straight beam with a fading trail on release, a heavy crack sound; with Reduce motion, no flicker.
6. **Content**: one stock heavy design (e.g. "Lancer"-style naming is taken: pick a new name) and a railgun tower.
7. **Dev tools**: "Charge railguns instantly" or a "Fire selected railgun" control (Combat tab) so the shot can be seen at once.
8. **Tests**: the charge takes the full time; energy is taken at the start; damage to 1, 2 and 4 targets in a line with falloff; the fifth is not hit; rock and an enemy shield stop it; each break condition (damage threshold, stun, switched off, target out of range, move order) cancels the charge and loses the energy; the `charging(h)` call.

## W-E. Ion gun (weapon kind `ion`)

A single-target hit-scan weapon that **switches one of the target's modules off for a while** instead of doing damage. It must be **expensive in energy** so it is a deliberate choice, not something that keeps a player's units permanently disabled.

1. **Tuning** (first guesses): `minSize` 2, mass 4, range 9 tiles, `use` 350 energy per shot, cooldown 80 ticks (8 s), disable time `ION_TICKS` 60 (6 s), immunity after an ion effect ends `ION_IMMUNITY_TICKS` 40 (4 s: the target cannot be ion-disabled again in that time, by anyone).
2. **Which module**: the one `config.aim(M_...)` points at if the target has a working switchable one of that kind, else a random working switchable module (draw from `sim.rng`; use the same pick rule as module damage in `simulation.ts` around lines 790 to 830). Passive modules (chassis, armour, batteries, memory) cannot be disabled. Only one module per target at a time; hitting a target that is already disabled or immune wastes the shot (it still costs energy).
3. **State**: a third module mask alongside `modules.f.off` and `modules.f.broken`, combined into the stats the same way (`simulation.ts` around line 883: `off | broken | ion`), with the existing "working modules changed" refresh (around line 864) called when it starts and ends. Keep a short list of active ion effects and check only those each tick (never sweep all units). Networked like the broken bit so the Modules list can show it. Scripts see the module as unusable while it lasts (as for a broken module), and a sensing call (e.g. `ionOf(slot)` beside `brokenOf`) says how long is left.
4. Shields block it like any shot: the shot stops at the arc and the shield's battery loses a flat `ION_SHIELD_DRAIN` (100) energy. Point defence ignores it.
5. **Client**: a blue-violet bolt, crackle on the target, and a clear "disabled" look on the module glyph (it can share the planned broken-module look, Open work 7).
6. **Dev tools**: "Ion selected" (Combat tab): disables a module of the selected units or buildings.
7. **Tests**: the aimed module is disabled for exactly `ION_TICKS`, then works again; a random pick when nothing is aimed; passive modules never chosen; immunity window; energy cost and cooldown; a shield stops it and drains energy; a disabled motor stops a unit and a disabled weapon stops it firing.

## W-F. Drone bay (module, slot `hangar`)

A carrier module for heavy and bigger **mobile** hulls (buildings later, if wanted). It builds, carries, launches and recalls a few **micro** units, each a full unit with its own program. This is the largest step: build it last, and split it into sub-steps (carrying, then building, then launch/recall, then UI) with tests for each.

1. **Tuning** (first guesses): `minSize` 3, mass 6, `mobileOnly`, capacity `DRONE_BAY_CAPACITY` 2 per module, recharge docked drones 10 energy per tick from the carrier's battery, repair docked drones 1 hit point per tick, launch one drone every 5 ticks.
2. **Which drone**: a script setting naming a micro class, following how `queueUnit` names a class (check `api.ts`); only micro chassis (tier 0) classes are accepted. The designer can show the chosen class later.
3. **Building**: the bay builds its drones itself, as a micro factory would, paying the class's matter from the carrier's cargo and its energy from the battery, at `DRONE_BUILD_FACTOR` (1.5) times the normal build time. Drones count against the unit cap.
4. **Carrying**: a docked drone is a real unit that is not on the map: out of the spatial index, vision and collision, cannot be targeted or seen, and its position follows the carrier (side table `carrier[e]`). Its program keeps running but cannot move or fire while docked (or is paused: pick the simpler one and say which). If the carrier dies, docked drones die with it.
5. **Launch and recall**: actions `launchDrones()` and `recallDrones()` (with cycle costs and caps), and events for the drone's program (e.g. a Visitor-style "launched" and "docked", see `Simulation.addVisitor`). A recalled drone drives or flies back and docks when it reaches the carrier.
6. **Client**: a hatch on the carrier hull, drones fly out of and into it; the selection panel shows docked drones.
7. **Content**: one stock carrier and one stock drone design.
8. **Dev tools**: "Fill drone bays" and "Launch/recall selected drones" (Spawn or Combat tab).
9. **Tests**: build up to capacity and no further; matter and energy paid; docked drones invisible and untargetable; launch and recall; recharge and repair while docked; carrier death kills docked drones; unit cap respected; deterministic. A perf case in `engine/test/perf-scaling.test.ts` with many carriers.
10. Bots: not required in this step.
