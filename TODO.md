# TODO

Outstanding actions. Tick items off (or delete them) as they are done, and log the change in PROGRESS.md.

## For you (the user)
- [ ] Browser-check the new terrain look in `Renderer.layout`: corner radius (`rad`, 0.23 tile), the two highlight tiers (`0x414a58`, `0x4d5767`; the deepest should only show in big outcrops like Badlands), no grid lines through rock, and no seams in the fog (`drawFog`) at several zooms.
- [ ] Play-check Badlands and the shuffled start corners: terrain is now mirrored exactly, and each match should put you (and your bot) in a random corner. Existing seeds produce different rock layouts than before.
- [ ] Browser-check the new Options screen and the slimmer music widget (glass toggle look and thumb alignment in menu, designer and module list; mute sync, volume persistence, widget in the match panel and designer bar).
- [ ] Browser-check the new build visuals: the cyan build beam from builders and construction towers (colour, sweep speeds, 350 ms linger in `drawBuildBeams`), the odd mid-build sparks (10% chance per Build event, 1-2 sparks) and the bigger completion burst with flash (`makeBuildSparks` / `drawBuildSparks`); watch for clutter with many builders on one site.
- [ ] Browser-check the charging-pad pulse: a green ring every 2 s while a pad is really charging, none when units only sip a little. Tune `CHARGE_PULSE_THRESHOLD` / `CHARGE_FLOW_SMOOTHING` / `CHARGE_PULSE_TICKS` in `systems.ts` and `CHARGE_PULSE_MS` in `renderer.ts`.
- [ ] Play-check builder spreading: place several sites and send idle builders; they should take different sites first (`Simulation.nearestSite`). Orders you give by hand are unchanged.
- [ ] Decide on sounds for the new Build and Charge events (`SimEvent.Build` / `Charge`); neither is hooked into `gameSounds.ts` yet.
- [ ] Watch a building finish in a browser: sparks should fan out along the grid from its edge, turning at crossings and fading. Tune `SPEED`, `TAIL`, `STEPS` and the spark count in `buildSparks.ts`; check it reads at low zoom and for big footprints, and that it also shows for allied/enemy buildings you can see (it is not limited to your own).
- [ ] Check the new Connecting screen in a browser: it should cover the page on entering a match, tick off real steps among the technobabble, and fade once the map arrives. Also try it with the server stopped (should keep saying it is retrying) and with a full/invalid room (should turn red). Tune the lines in `TECHNOBABBLE` and `MIN_SHOWN_MS` in `connecting.ts`.
- [ ] Restart the server and reload, then confirm sounds play again (the manifest comma fix) and that a deliberately broken `sound_manifest.json` / `music_manifest.json` prints a `[manifest]` warning in the server console.
- [ ] Try sending a big group to one spot in a browser: units should fan out to free tiles around the click (`freeMoveTile` in `simulation.ts`). Note the spread is by tile, in order of the orders, so a tight formation isn't preserved.
- [ ] Check the new explosion effects in a browser (flash, fireball, sparks, debris, smoke): tune the colours and fragment counts in `makeExplosion` / `drawExplosion` in `renderer.ts`, and watch for slowdown when many things die at once.
- [ ] Browser-check the menu transitions: Main menu <-> Single-player / Multiplayer / Credits should slide and fade (direction flips on Back), and the API reference and Designer should fade in and out, including via Esc, F1/F2 and the browser Back button. Tune `OUT_MS`/`IN_MS`/`OVERLAY_MS`/`SLIDE_PX` in `transition.ts`. Not animated yet: the name screen to menu, and menu to game.
- [ ] Listen-check the sound system in a browser: add sounds to the manifest (a tag entry with `use: []` plays nothing; give a sound entry the tag, or point a tag at another with `use`), then check menu clicks/hover, order and selection sounds, shots/deaths fading with distance and panning, the effects volume slider (it lives in the music widget, which is hidden when there is no music) and the speaker mute. Tune the per-tag `cooldownMs` / `maxVoices` in the manifest and the thresholds at the top of `gameSounds.ts`.
- [ ] Decide what to do about the tags that are not hooked yet (list at the end of SOUND_EVENTS.md): movement / construction / turret loops need per-entity start and stop tracking, and `unit.charge`, `unit.supply`, `unit.stop` need more from the server. Prune the ones you will never use.
- [ ] Browser-check the review fixes (they pass `npm test` and typecheck, but nothing was seen running): (1) power: build a base plus an outpost over one antenna link and confirm the base keeps its own power while the outpost gets about the link's cap; (2) resign in the first seconds of a match, and while paused, then close the tab: the others must not pause, and you should get Spectate/Leave; (3) in the waiting room, upload or reset designs: you should see a notice and autosave should keep working afterwards; (4) in a versus match whose opponent left for good, the paused panel should show the invite link again; (5) damage numbers: no phantom number when an enemy re-enters vision or after clicking Spectate; (6) the menu sparks still run on the menu and stop once a match starts.
- [ ] Confirm the "units halt / ignore orders" fix in a browser: reload and start a game (single-player or multiplayer); units should keep working and obey orders. If it still happens, open the Designer and check the classes have programs, or use "Reset designs to defaults…", and tell me what the console shows.
- [ ] Two/three-tab check of the waiting room and spectating in a browser: join a Multiplayer room (host sees Start disabled until 2 players, others see "Waiting for the host"; invite link copies; room list shows "in lobby"), start, then resign in one tab (press Resign twice) and defeat another: each should get the Spectate / Leave choice, spectating should lift the fog entirely and hide the build bar/actions, Leave should return to the menu, and the others should not be paused by a defeated player leaving. Also check the standings screen's Spectate/Leave buttons, and that Co-op starts with one player.
- [ ] Balance-check the link caps: `ANTENNA_THROUGHPUT_PER_TILE` (20/tick per antenna per footprint tile, `rules.ts`) against real generation and battery sizes; confirm a distant battery bank behind one antenna charges at a sensible pace, and that the Power meter now reads calmly (surplus green, red only while storage drains). Consider showing a link's cap in the build/link UI.
- [ ] Check the death explosions in a browser: red expanding ring for units and larger for buildings; tune `EXPLOSION_MS`, colour and the radii (`blastRadius` in `renderer.ts`). Also confirm they appear for kills seen in fog and don't show for unseen deaths.
- [ ] Check the Power-meter hover labels in a browser: hover the Power tile and confirm on-screen own buildings show `+N` (green) / `-N` (red), readable at low zoom, and that they vanish when the pointer leaves.
- [ ] Check the floating damage numbers in a browser: size/colour, rise distance and fade time (`DAMAGE_NUMBER_*` and the style in `spawnDamageNumber`, `renderer.ts`), and whether many simultaneous hits get too cluttered.
- [ ] Try the radar in a browser: design a class with `radar.pulse`, call `radarPulse(400)` from its script (e.g. when `radarCooldown() == 0`), and check the ring, blip colours and fade. The default Radar Tower now exists; check its ping rate and energy use feel right, and whether blips need an art/icon for the part.
- [ ] Feel-check charging: pads now deliver 2x (`CHARGE_PAD_RATE_MULTIPLIER` in `rules.ts`); confirm units recharge at a good pace and a pad on a small grid drains sensibly.
- [ ] Check the Back button in a browser: from Single-player, Multiplayer, Credits, the API reference and the Designer it should return to the main menu (Forward should reopen), and the on-screen Back/close buttons should behave the same.
- [ ] Read through the new `docs/*.md` pages: the README split was mechanical, so check links and wording (e.g. `docs/server.md` intro repeats a bullet).
- [ ] Keep docs in step: engine/design notes go in `docs/game.md`, UI/controls in `docs/client.md`, server/network in `docs/server.md`, run/Docker/music in `docs/deployment.md`.
- [ ] Fix the global npm shadowing: `npm install -g npm@11` (or delete `%AppData%\npm\node_modules\npm`). Node's `npm` currently runs an old 9.8.1.
- [ ] If PowerShell blocks `npm`: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`, or use `npm.cmd`.
- [x] Play-test in a browser (the model cannot see the rendered game): action grid (common buttons, aiming, hotkeys, class buttons such as the fighters' Hold fire), info bar for one and several selected units, fog of war shading, green charging zones, selection sparklines in the side panel, power-flow dot speeds (do busy links read as busier?), band-select priority and control groups (check Ctrl+1..9 is not taken by the browser's tab switching), design download/upload/reset (and rejoining after editing a class to check it is restored), dashed power-link preview while placing, demolish/cancel (press X twice), construction towers, grid totals and highlighted networks, health bars and decluttered routes for big groups, designer (module drag-reorder, retire/restore, history and upload diff, sandbox test run), zoom/pan, build bar, power links, reviving flat units, terrain/flying, docs overlay.
- [x] Two-tab check of fog of war: each tab should only show the other player's units once its own units get close.
- [x] Silos fill up (the HQ holds 2000): build Resource Silos to keep harvesting.
- [x] Balance pass: energy costs, generation, charge rates, part costs (numbers live in `game/parts.ts` and `game/rules.ts`). Generators were cut sharply and building now costs energy, so check that bases stay powered and builders don't stall; also weapon costs, tesla range/stun/cooldown and the decay timer.
- [x] Play-test the newer features: scoreboard (names, eliminated rows, the final standings screen when one side is wiped out), resource bars, laser turret and tesla (pulse ring, stun tint), off-grid building and builder retreat, unit decay, sparser power links, camera overscroll, merge-upload, program history after a reload, storage discharge speed, factory scripts using `queueUnit()`.
- [x] Decide whether to put the project under git (`git init`); nothing is committed yet.

- [x] Eyeball the new module-driven unit/building art and designer preview in a browser; tune glyph sizes and colours for readability at low zoom.

- [x] Play-test Co-op vs bots: wave timing and size (`BOT_*` in `rules.ts`; recently slowed so waves start at 2 units, +1 each, 4 min apart — check the difficulty feels right), the bot roster and base layout in `game/bot.ts`, and the lobby mode picker.

- [x] Check the new main menu in a browser: section navigation, room lists per mode, Single-player start, API overlay, and the offline Designer (create/edit/retire a class, then start a match and confirm it is restored).

- [x] Try the background music in a browser: menu tracks, switch to combat when units are hit and back after ~15 s, track-end shuffle, mute/volume widget placement (top-left on the menus, docked in the side panel in a match), and the mounted music folder under Docker.

- [x] Check the new tree-style build bar in a browser: category buttons, pop-up menu placement, single-building folding into Other, and whether the category choice feels right for your custom buildings.

- [x] Eyeball the new scrolling menu background in a browser: speed, grid/fill opacity (`menuBackground.ts` constants), and that menu text stays readable over it.
- [x] Check the online count in a browser: open the menu in two tabs and confirm both count ("In the menu: N"), and that joining a room moves a tab from the menu count to its match.
- [x] Check the terrain edge highlight in a browser: colour/width (`layout()` in `renderer.ts`) at several zoom levels, and that it doesn't compete with units and links.
- [x] Profile a match at the 256-unit cap (tick time on the server, frame rate in the client); lower `MAX_UNITS_PER_PLAYER` or optimise if it hurts.
- [x] Check building placement in a browser: the ghost goes red outside vision, placing at the edge of vision works, and a co-op teammate's vision counts.
- [x] Check the new Units bar under Matter/Energy: it tracks production and losses, and the server refuses production at the cap (buildings no longer count towards it).

- [x] Play-test the 2026-10-15 changes in a browser: the Daylight/Wind/Power tiles (long numbers must not break the box), the top-of-map stats strip widths, the Repair beam/drone/Repair button (R) and its green effect, repair matter cost (`REPAIR_*` in `rules.ts`), unit production energy (`PRODUCTION_ENERGY_*`, check factories on a small grid still produce), laser drain (`laser.beam` use 100) and halved batteries with the new Small Energy Storage start, and that a flat storage now recharges.
- [ ] Decide whether players need a way to switch the repair effect off, and whether a repair order should also exist for buildings (currently towers repair automatically).

- [ ] Eyeball the flat CSS menu background in a browser: drift speed (40 s animation in `style.css`), grid/fill opacity and cell size (`menuBackground.ts`), no visible seam, and smooth menu performance.

## For the model
- [ ] Finish `REVIEW.md` (code review of the 2026-10-18 changes). 21 of 29 items are done; what remains needs a design decision: explicit match/player state machine in `match.ts`, per-tick elimination check, one per-entity renderer record, a `SimEvent.Damage` event, per-bridge flow in `NetworkInfo` for the link animation, a `DesignStore` sync marker, and moving `showPowerLabels` off `ClientState`.
- [ ] Visual polish after the play-test (sidebar header/resources and CPU status width updated; link widths and route decluttering remain untested guesses).
- [ ] Fog follow-ups: remembered ("ghost") enemy buildings in explored areas; per-tick visibility cost if unit counts grow (use the spatial grid).
- [ ] Action buttons: let scripts enable/disable or relabel their own buttons at runtime (needs owner-only replication).
- [ ] Designs: named design sets (several saved loadouts).
- [ ] Designer: let the sandbox test run take scripted scenarios (several units, custom terrain).

## Later / ideas
- [ ] Language: `break`/`continue`, functions, unit-to-unit messaging.
