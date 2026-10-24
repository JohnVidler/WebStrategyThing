# From previous agent sessions, for later work reference:

Module damage, aimed fire and the four animations are all in, but I haven't seen any of it in a live match. `npm test` (362 pass) and the typecheck are clean. I drew the art on a throwaway sheet in headless Chrome and deleted it afterwards. That sheet showed hulls, turrets at angles, building turrets, rotors and leg frames.

**Module damage**
- **How a hit works:** every hit still costs the hull its hit points, and it also lands on one module for the same amount. A module breaks once it has taken its integrity, and a broken module counts as switched off until repaired.
- **Which module takes it:** by default the hit goes to a random part, so armour, batteries and memory soak up some. If a weapon is aimed at a kind of module the target doesn't have, it falls back to a random hit.
- **Integrity:** 25 plus 6 per mass by default. Legs are deliberately fragile at 12, 30 and 100 for light, heavy and colossus.
- **Broken legs:** a broken walker has no speed and can't be ordered to move. A broken gun can't fire, and a broken CPU stops its program.
- **Repair:** beams mend module damage first (broken modules before worn ones), then the hull, paying matter for both. The modules panel shows broken modules in red, and their switches are disabled.
- **Balance risk:** every fight now breaks modules on every unit, not just legs. Integrity for non-legs modules is a first guess, and it's the main thing to tune after a play-test.

**Aimed fire**
- `config.aim(M_MOTOR)` (or any module kind) picks which kind of module a weapon goes for. `M_ANY` is the default and picks a random module each hit. Missiles keep the aim of the launcher that fired them.
- New queries `moduleBroken(i)` and `brokenOf(h)` let programs see what's broken. They show up in the block editor and manual automatically.
- Starter programs and bots don't use any of this yet. That's in PLAN.

**Animations**
- **Turrets:** they are now their own sprites. They swing to the target of the unit's last shot, hold for 1.5 s, then return to the front. A unit locked on but not yet firing doesn't turn, because the target isn't sent to clients. Tesla coils don't aim.
- **Housings:** housings scale with the weapon's mass, with their own looks for the rotary gun, siege cannon and a three-tube missile rack. Weapons on large buildings are drawn bigger the heavier they are.
- **Wind turbines:** the blades spin at up to 9 rad/s, in proportion to the current wind.
- **Harvest sparks:** the count follows the cargo gained since the last Harvest event, which comes every other tick, and the sparks spray from the resource toward the harvester. Breaking a module also bursts sparks.

I added tests in `engine/test/modules.test.ts` and `client/test/art.test.ts`, and updated the legs descriptions, docs/game.md, changelog, PROGRESS and PLAN. TODO.md has an item listing what to check in a live match. The AGENTS.md claim is released.

PLAN also lists the other follow-ups: sounds for the break and harvest events, a broken-module look, and spinning helicopter rotors.

---

Factories now come in size-specific modules, the factory side panel shows the queue as eight slots, and working factories animate. Typecheck is clean and `npm test` passes (354 tests, plus 2 expected failures in another agent's known-bugs file). I haven't looked at the queue grid or the animation in a browser, and I haven't played a match with the new factories.

**Factory modules (option 2, as planned in `PLAN.md`):**
- **Six modules:** `factory.basic` is replaced by `factory.micro`, `.light`, `.medium`, `.heavy`, `.super` and `.colossal`. A building can build a unit only if it has the module for that exact size. The old "one module short builds at a tenth of the speed" rule is gone, and an unbuildable unit now gets a clear refusal message.
- **Starter buildings:**
  - The HQ builds light and medium units, so you can always make harvesters and Builders.
  - The Light Factory builds micro and light, and the Vehicle Factory builds medium.
  - The Heavy Factory builds heavy, and the Titan Works builds super-heavy and colossus.
  - The bot's Assembler builds every size.
- **Old designs:** saved designs that use `factory.basic` still load, as the light module. A saved multi-module factory will now build light units only. I added a warning about this to the changelog.

**Queue grid:**
- **Grid:** the production panel shows eight slots with a picture of each queued unit and a fill that rises on the one being built.
- **Removing items:** clicking a slot removes that item and refunds its matter. Removing the item being built also loses the work done on it. I used a new `dequeue` command, so a click on a slot cancels it on the server.
- **Wire format:** to draw every slot, the factory's whole queue is now sent to clients. Enemies who can see a factory also receive its queue contents. They already received the item being built.

**Animation:** a building factory shows a pulsing outline in the owner's colour, a sweeping scan line, rotating tick marks and sparks at the exit edge. Everyone who can see the factory sees it. With Reduce motion on, you only get a steady outline. The code is in the new `factoryFx.ts`, with one small hook in `renderer.ts`.

I used the claim process in `AGENTS.md` and removed my line when done. A1 had claimed `simulation.ts` and the renderer, so I kept my edits small there. I rewrote the tests in `factory.test.ts` for the new rules and adjusted `tiers.test.ts`. PROGRESS.md and the changelog entry are updated.

A stalled factory with no power still animates, because I couldn't tell stalled from working without more state. Say if you want it to dim when stalled.

---

I've added a "Dev Options" tab on the right edge of the map. It opens a panel of playtest buttons and leaves the map usable underneath. I haven't opened it in a browser; typecheck passes and `npm test` gives 362 passed with the 2 expected failures. I added a click-through item to `TODO.md`.

**What the panel does**
- **Fog of war:** a toggle for everyone in the room. Switching it reloads each client's view once.
- **Pause and connection:**
  - Pause and resume the simulation.
  - A "Fake disconnect" button that shows the waiting-for-a-player notice.
  - "Drop my connection", which cuts the socket so you can test reconnecting.
- **Spawn:** any starter class, unit or building, for any team including Neutral. It appears fully built and charged, around the middle of your view. Neutral spawns use the Wanderer-style team, so they are hostile to everyone.
- **Matter:** give matter to a team's silos, or add a matter field.
- **Remove:**
  - Delete units, buildings or matter fields within a radius of the view centre, for one team or anyone.
  - "Destroy all" for a whole team.
- **Repair:** heal and recharge a team (or everyone), and finish all construction sites for free.
- **End the match:** six endings:
  - Victory: opponents eliminated.
  - Victory: others left.
  - Victory: no power.
  - Defeat: eliminated.
  - Defeat: no power.
  - Draw.
- **Defeat prompt:** "Knocked out" shows the spectate/leave prompt without ending the match.
- **Normal ending:** "Allow normal ending again" lets the real win check run after a dev ending.

**Only in dev builds, twice over**
- The client loads the menu only in a development build. I ran a production build and found no trace of it.
- The server obeys the dev commands only when started with `WST_DEV_TOOLS=1`. I made `npm run dev` set that, via `scripts/dev.mjs`. Production images and `npm start` don't, so a deployed server refuses the commands even if someone crafts the message. Every command is validated and size-limited.

**Choices to check**
- The panel is a docked window, not a dimmed full-screen modal, because spawning happens at the view centre and you need to pan the map while it's open.
- Spawn and remove work from the view centre, not a map click, so you pan first. I haven't added click-to-place; say if you want it.
- Dev-only features stay out of the main-menu updates list, per `STYLE.md`.

I recorded the work in `PROGRESS.md` and added a convention to `STYLE.md`: new playtest shortcuts go in this menu, not hidden hotkeys. I also added a line to `docs/server.md` and released my claim in `AGENTS.md`. The server tests are in `packages/server/test/dev.test.ts`.

For the click-through, run `npm run dev`, join a solo match and open the tab. Check that the panel fits and scrolls at a small window size, and that the fog toggle really removes fog.