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
