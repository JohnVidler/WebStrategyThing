# Client and controls

[← Back to the README](../README.md)

The browser side: PixiJS renderer, play UI, designer and docs. Simulation rules are in [game.md](game.md).

## Playing

Open the client in two browser tabs to see two players (up to four, one per corner). Each starts with a powered base (HQ, charging pads, solar array, wind turbine, energy storage, power pylon), two harvesters, two scouts and a builder. Open **Controls** in the side panel for the key bindings. A drag selects your combat units first, then your turrets, then anything else; Ctrl+1..9 saves **control groups**, 1..9 recalls them (twice to centre the view), and Shift+1..9 adds to one. Other controls: the mouse wheel zooms, middle-drag pans, the **build bar** under the map places buildings (pick a category to pop up its buildings over the map), and the **action grid** in the side panel holds the common commands (move, attack, stop, harvest, unload, recharge, demolish) plus any buttons your class scripts declare. The bar along the top of the map shows the stats of whatever is under the cursor, or of the selection (totals for several units), and the side panel lists the selection's resources with sparklines of the last 30 seconds. Faint green areas show where your units recharge, and placing a building previews its power links as dashed lines. The top of the side panel shows **resource bars** (matter in your silos, energy stored in your power networks), and a **scoreboard** at the top right of the map lists every present player (set your name in the lobby; the default is `anon` plus five random digits) with their score (silo contents plus the cost of everything they own) and units/buildings made, lost and destroyed. When only one side has anything left, a final standings screen appears. A free-for-all or co-op room opens in a **waiting room** overlay listing who has joined, with an invite link; the host (the first in) presses **Start game** once enough players are in, and everyone else waits. **Resign** (press twice) gives up your forces. When you have none left (resigned or destroyed) while the match goes on, you can **Spectate**, which lifts the fog of war entirely and hides the controls (the button then reads **Leave**), or **Leave to menu**; losers see the same choices on the final standings. The map is under **fog of war**: you only see (and the server only sends) what your units and buildings can see. Start the server with `FOG=off` to see everything.

A full-screen **Connecting…** cover (`connecting.ts`) shows while a match page loads its assets and waits for the server's welcome. It lists real steps with ticks among made-up progress lines, turns red if the server refuses the connection, and fades out once the map arrives.

## Designer and scripts

Classes are designed and programmed in the **Designer** (button or F2): an overlay over the running game with a live preview, a module catalogue grouped by category (drag installed modules to reorder them), and a CodeMirror editor that highlights the script language, completes builtins and constants, shows their docs on hover, and runs the real compiler as you type. Uploads show a diff first, earlier versions can be reloaded from the history picker, classes can be retired, and **Test run** tries the unsaved design in a private sandbox simulation in the browser.

## Saved designs and files

Your designs and scripts are **saved in the browser** and restored whenever you rejoin. The buttons at the bottom of the side panel **download** them as a JSON file, **upload** a file (replacing your designs, or merging its classes into them), or **reset** everything to the defaults; upload and reset show what will change and ask first. If a new build changes a default class you had edited, you're asked whether to keep your version or take the new default.

## Docs

The **script API docs** open with the Docs button (or F1) as an overlay while the game keeps running, or in a new tab at `/docs.html`. They are generated from the engine's own metadata, so they always match the build.

## Sound effects

Sounds are picked by event tag from the server's sound manifest (see [SOUND_EVENTS.md](../SOUND_EVENTS.md) for every tag and the manifest format). `soundbank.ts` resolves the manifest once on load (own sounds, `use` references, parent-tag fallback) so playing is a map lookup and a random pick; `sound.ts` plays them with Web Audio (positional sounds fade with distance from the view and pan left/right, with per-tag cooldowns and voice limits, and looping ambient beds on layers). `uiSounds.ts` gives every button, select, slider, checkbox and text box on the page its sound, overridden with `data-sound="some.tag"` (`none` to play nothing). `input.ts` plays the selection, order and building sounds; `gameSounds.ts` turns server messages and each tick's world changes (shots, deaths, damage, new units, finished buildings, cargo, charge, power and credit alerts) into tags. Nothing plays before the first click or key press (a browser rule), and a tag with no sound costs a failed lookup. The speaker button mutes effects as well as music, and the music widget has a separate effects volume slider.
