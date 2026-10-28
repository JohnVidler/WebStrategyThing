# Plan

Planned work and decisions. Compacted 2026-10-27: finished milestones are summarised and the open work is listed first. The full earlier text (flowcode design sections 1 to 14, milestone tables, as-built notes) is in git: `git show b449816:PLAN.md`.

## Open work, in rough priority order

1. **Playtest phases P1 to P4** (below): simpler UI, unit identification, combat balance, a purpose for the designer. P1 first, then P3 and P2, then P4 (needs P3).
2. **Power bug (decision needed).** `powerSystem` (`systems.ts`) floors each generator's output a second time when transmission loss is applied (`gen[i] = Math.floor(gen[i] * efficiency)`). Any link gap makes efficiency just under 1, so a generator making 2 to 3 per tick loses 1 (two wind turbines one tile apart make about half). Expected failure in `engine/test/known-bugs.test.ts`. Fix: apply the efficiency to the exact total before the carry/floor step. It raises generation on every map with gapped links, so recheck the energy balance of starter bases and bots.
3. **Big-unit balance (decision needed).** Super-heavy and colossus cost x6.25 and x15.6 (`SIZE_COST_FACTOR`, `rules.ts`) but are no stronger, so per matter they lose to many cheap units. Buff hp/damage, shorten build time, or leave as expensive status units; then retune the Colossus-vs-scouts test in `tiers.test.ts`. Part of P3.
4. **Security and consistency leftovers** (details in `REVIEW.md`): S7 a Content-Security-Policy and CORS on the room list; S8 reconnect token out of the URL; S9 pin `tsx`/`ws`; S10 workflow permissions; S11 one name rule; S12 manifest cache; S13 to S17 consistency. Open question: add a process-level `uncaughtException` handler? Prefer fixing causes and keeping per-match isolation (`Match.crash`).
5. **Engine follow-ups**: one shared path search per command batch and `freeMoveTile`'s taken set once per batch (22 ms to issue 256 orders); script-system hot-path allocations (parked: median tick ~0.5 ms, revisit only with a profile); the player-like AI (`ai.ts`) fields light and medium units, missiles and flak but not heavy or super-heavy tiers or legs, and uses neither `config.aim` nor repair drones: teach it those, long-march energy (see `PROGRESS.md`) and a difficulty setting; unit-cap weight per tier if micro swarms hurt.
6. **Module damage follow-ups**: starter programs and bots do not use `config.aim` or `brokenOf` yet; integrity numbers (25 + 6 per mass, legs 12/30/100) are a first guess; only the broken bit is networked; a broken factory or silo should be clear in the UI; flying units ignore height by design.
7. **Art follow-ups**: spinning helicopter rotors, scrolling tracks, role hints on the hull, turrets that track a lock before the first shot (needs a `Lock` event or the target networked), a broken-module look, antenna/sensor/CPU/wind glyphs and shaped buildings that do not yet grow with modules (the 2026-10-28 module pass covered batteries, factories, solar, silos, chargers), a browser check of the 2026-10-28 night lighting, crystal deposits and spark effects (see `TODO.md`), sounds for `Break` and `Harvest`, height shown only as shading plus a cliff rim.
8. **Sound**: hook the missile burst, `combat.shot.missile` (tag exists, no files), `SimEvent.Build` and `Charge` in `gameSounds.ts`; give any new combat/explosion tag `cooldownMs`/`maxVoices`; a global voice cap (~32) only if big fights still sound muddy; first-play drops (await decode for important tags); a `play()` test needs an `AudioContext` stub.
9. **Menus**: push the room list over the presence socket instead of polling every 3 s (keep keyed rows); migrate the designer tabs and Code tab view switch to `.glass-tabs` if the look works; remove or relocate dead CPU-profile code (`requestCpuProfile`, `cpuLines`); dev styles ship inert in production CSS; server dev code ships unreachable in the image (only worth removing with a server build step); a server-side "fake player" for Dev Rooms; Reduce motion is not yet honoured by the in-game renderer (screen shake, particles, build sparks); credits roll could get a skip-to-top.
10. **Flowcode M7 polish**: editor sounds, balance of cost constants (`flow/cost.ts`) and CPU cycles per tick, copy/paste of nodes, quick-add search on double-click, an error list panel, subgraphs/functions; optional M6 follow-ups (heat on data wires, per-class CPU summary, in-game profile in the Code tab). Readability review of the M12 graph cards with the user (do outcome pins and `emit` wires need arrows to the hooking `on(Name)` block? a settings inspector).
11. **Single Player scenarios** (below): playtest and tune Horde and Surrounded, show Horde progress, then more scenarios.
12. **Campaigns** (below): triggers, victory conditions, scripted starts, Tiled object layer.
13. **`REVIEW.md` architecture items** that need a design decision: explicit match/player state machine, per-tick elimination check, one per-entity renderer record, `SimEvent.Damage`, per-bridge flow in `NetworkInfo`, a `DesignStore` "designs synced" marker, `showPowerLabels` off `ClientState`.

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
