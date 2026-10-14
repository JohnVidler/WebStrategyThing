# TODO

Outstanding actions. Tick items off (or delete them) as they are done, and log the change in PROGRESS.md.

## For you (the user)
- [ ] Fix the global npm shadowing: `npm install -g npm@11` (or delete `%AppData%\npm\node_modules\npm`). Node's `npm` currently runs an old 9.8.1.
- [ ] If PowerShell blocks `npm`: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`, or use `npm.cmd`.
- [x] Play-test in a browser (the model cannot see the rendered game): action grid (common buttons, aiming, hotkeys, class buttons such as the fighters' Hold fire), info bar for one and several selected units, fog of war shading, green charging zones, selection sparklines in the side panel, power-flow dot speeds (do busy links read as busier?), band-select priority and control groups (check Ctrl+1..9 is not taken by the browser's tab switching), design download/upload/reset (and rejoining after editing a class to check it is restored), dashed power-link preview while placing, demolish/cancel (press X twice), construction towers, grid totals and highlighted networks, health bars and decluttered routes for big groups, designer (module drag-reorder, retire/restore, history and upload diff, sandbox test run), zoom/pan, build bar, power links, reviving flat units, terrain/flying, docs overlay.
- [x] Two-tab check of fog of war: each tab should only show the other player's units once its own units get close.
- [x] Silos fill up (the HQ holds 2000): build Resource Silos to keep harvesting.
- [x] Balance pass: energy costs, generation, charge rates, part costs (numbers live in `game/parts.ts` and `game/rules.ts`). Generators were cut sharply and building now costs energy, so check that bases stay powered and builders don't stall; also weapon costs, tesla range/stun/cooldown and the decay timer.
- [x] Play-test the newer features: scoreboard (names, eliminated rows, the final standings screen when one side is wiped out), resource bars, laser turret and tesla (pulse ring, stun tint), off-grid building and builder retreat, unit decay, sparser power links, camera overscroll, merge-upload, program history after a reload, storage discharge speed, factory scripts using `queueUnit()`.
- [ ] Decide whether to put the project under git (`git init`); nothing is committed yet.

- [ ] Eyeball the new module-driven unit/building art and designer preview in a browser; tune glyph sizes and colours for readability at low zoom.

## For the model
- [ ] Visual polish after the play-test (sidebar header/resources and CPU status width updated; link widths and route decluttering remain untested guesses).
- [ ] Fog follow-ups: remembered ("ghost") enemy buildings in explored areas; per-tick visibility cost if unit counts grow (use the spatial grid).
- [ ] Action buttons: let scripts enable/disable or relabel their own buttons at runtime (needs owner-only replication).
- [ ] Designs: named design sets (several saved loadouts).
- [ ] Designer: let the sandbox test run take scripted scenarios (several units, custom terrain).

## Later / ideas
- [ ] Language: `break`/`continue`, functions, unit-to-unit messaging.
