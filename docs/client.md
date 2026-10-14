# Client and controls

[← Back to the README](../README.md)

The browser side: PixiJS renderer, play UI, designer and docs. Simulation rules are in [game.md](game.md).

## Playing

Open the client in two browser tabs to see two players (up to four, one per corner). Each starts with a powered base (HQ, charging pads, solar array, wind turbine, energy storage, power pylon), two harvesters, two scouts and a builder. Open **Controls** in the side panel for the key bindings. A drag selects your combat units first, then your turrets, then anything else; Ctrl+1..9 saves **control groups**, 1..9 recalls them (twice to centre the view), and Shift+1..9 adds to one. Other controls: the mouse wheel zooms, middle-drag pans, the **build bar** under the map places buildings (pick a category to pop up its buildings over the map), and the **action grid** in the side panel holds the common commands (move, attack, stop, harvest, unload, recharge, demolish) plus any buttons your class scripts declare. The bar along the top of the map shows the stats of whatever is under the cursor, or of the selection (totals for several units), and the side panel lists the selection's resources with sparklines of the last 30 seconds. Faint green areas show where your units recharge, and placing a building previews its power links as dashed lines. The top of the side panel shows **resource bars** (matter in your silos, energy stored in your power networks), and a **scoreboard** at the top right of the map lists every present player (set your name in the lobby; the default is `anon` plus five random digits) with their score (silo contents plus the cost of everything they own) and units/buildings made, lost and destroyed. When only one side has anything left, a final standings screen appears. The map is under **fog of war**: you only see (and the server only sends) what your units and buildings can see. Start the server with `FOG=off` to see everything.

## Designer and scripts

Classes are designed and programmed in the **Designer** (button or F2): an overlay over the running game with a live preview, a module catalogue grouped by category (drag installed modules to reorder them), and a CodeMirror editor that highlights the script language, completes builtins and constants, shows their docs on hover, and runs the real compiler as you type. Uploads show a diff first, earlier versions can be reloaded from the history picker, classes can be retired, and **Test run** tries the unsaved design in a private sandbox simulation in the browser.

## Saved designs and files

Your designs and scripts are **saved in the browser** and restored whenever you rejoin. The buttons at the bottom of the side panel **download** them as a JSON file, **upload** a file (replacing your designs, or merging its classes into them), or **reset** everything to the defaults; upload and reset show what will change and ask first. If a new build changes a default class you had edited, you're asked whether to keep your version or take the new default.

## Docs

The **script API docs** open with the Docs button (or F1) as an overlay while the game keeps running, or in a new tab at `/docs.html`. They are generated from the engine's own metadata, so they always match the build.
