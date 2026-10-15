# TODO

Outstanding actions. Tick items off (or delete them) as they are done, and log the change in PROGRESS.md.

## For you (the user)
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
- [ ] Decide whether to put the project under git (`git init`); nothing is committed yet.

- [ ] Eyeball the new module-driven unit/building art and designer preview in a browser; tune glyph sizes and colours for readability at low zoom.

- [ ] Play-test Co-op vs bots: wave timing and size (`BOT_*` in `rules.ts`; recently slowed so waves start at 2 units, +1 each, 4 min apart — check the difficulty feels right), the bot roster and base layout in `game/bot.ts`, and the lobby mode picker.

- [ ] Check the new main menu in a browser: section navigation, room lists per mode, Single-player start, API overlay, and the offline Designer (create/edit/retire a class, then start a match and confirm it is restored).

- [ ] Try the background music in a browser: menu tracks, switch to combat when units are hit and back after ~15 s, track-end shuffle, mute/volume widget placement (top-left on the menus, docked in the side panel in a match), and the mounted music folder under Docker.

- [ ] Check the new tree-style build bar in a browser: category buttons, pop-up menu placement, single-building folding into Other, and whether the category choice feels right for your custom buildings.

- [ ] Eyeball the new scrolling menu background in a browser: speed, grid/fill opacity (`menuBackground.ts` constants), and that menu text stays readable over it.

- [ ] Play-test the 2026-10-15 changes in a browser: the Daylight/Wind/Power tiles (long numbers must not break the box), the top-of-map stats strip widths, the Repair beam/drone/Repair button (R) and its green effect, repair matter cost (`REPAIR_*` in `rules.ts`), unit production energy (`PRODUCTION_ENERGY_*`, check factories on a small grid still produce), laser drain (`laser.beam` use 100) and halved batteries with the new Small Energy Storage start, and that a flat storage now recharges.
- [ ] Decide whether players need a way to switch the repair effect off, and whether a repair order should also exist for buildings (currently towers repair automatically).

## For the model
- [ ] Visual polish after the play-test (sidebar header/resources and CPU status width updated; link widths and route decluttering remain untested guesses).
- [ ] Fog follow-ups: remembered ("ghost") enemy buildings in explored areas; per-tick visibility cost if unit counts grow (use the spatial grid).
- [ ] Action buttons: let scripts enable/disable or relabel their own buttons at runtime (needs owner-only replication).
- [ ] Designs: named design sets (several saved loadouts).
- [ ] Designer: let the sandbox test run take scripted scenarios (several units, custom terrain).

## Later / ideas
- [ ] Language: `break`/`continue`, functions, unit-to-unit messaging.
- [ ] Check the online count in a browser: open the menu in two tabs and confirm both count ("In the menu: N"), and that joining a room moves a tab from the menu count to its match.
- [ ] Check the terrain edge highlight in a browser: colour/width (`layout()` in `renderer.ts`) at several zoom levels, and that it doesn't compete with units and links.
