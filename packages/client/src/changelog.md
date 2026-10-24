# Player-facing release notes, shown as articles under News and Updates on the main menu.
# One "## YYYY-MM-DD" heading per update (newest first). Under it: an optional "### Headline",
# a short upbeat summary paragraph (careful and plain for breaking or serious changes), then
# one "- " line per change. Write for players: no file names or internals.
# Other lines starting with # and blank lines are ignored.

## 2026-10-24
### Security and resilience patch, plus bigger units
This update hardens the game servers: malformed or malicious requests, floods of messages and booby-trapped class names or programs can no longer take a server down, and a server error now ends only the one match it happens in. Alongside it come Micro, Super-heavy and Colossus units, climbing walkers and specialised factories, smoother big group orders, and a leaner match sidebar.

- Sturdier servers: a malformed request, an oversized message or a broken or malicious class program can no longer bring a server down for everyone. If a match ever does hit a server error, only that match ends (with a message) instead of every game on the server.
- Flood protection: a client that sends far more messages than a real player could is disconnected, and there are now limits on how many connections and rooms one address can hold open.
- Class names are now safely displayed in the build menu and designer, so a crafted name can no longer disturb the page.
- One thing to know: a match now allows at most 256 classes per player in total, counting retired ones, on top of the existing limit of 48 active classes.

- Legs now have a price: they climb rock, but they are fragile. Every hit also damages one of the target's modules, and when a module has taken enough it breaks and does nothing until a repair module mends it. Broken legs leave a walker stuck where it stands; a broken gun cannot fire. Armour, batteries and memory soak up some of the hits. Repair beams fix broken modules first. The module list of a selected unit shows what is broken.
- Programs can aim: `config.aim(M_MOTOR)` (or `M_WEAPON`, `M_CPU`, ... or `M_ANY` for a random module each hit, the default) chooses which kind of module a weapon goes for. New queries `moduleBroken(i)` and `brokenOf(h)` tell you what is broken.
- Gun turrets now swing round to face their target, and big guns (cannons, siege cannons, rotary guns, missile racks, lasers) sit in armoured turret housings. Weapons on large buildings are drawn bigger the heavier they are.
- Wind turbines have spinning blades, faster in stronger wind. Harvesters throw sparks off the resource they are mining, more of them the more they have just taken. Modules that break burst into sparks.
- New unit silhouettes: a unit’s body shape now comes from its drive and its chassis size together, so a tracked Heavy, a wheeled Light and a walking Colossus no longer look like scaled copies of each other. Walkers have a pinched insect body, tracks a boxy tank hull, rotors a cross, and each size reshapes the body (rounded Micro, tapered Light, belted Heavy, flared Super-heavy, bastioned Colossus).
- Walking units now move their legs, in step with how fast they go, and stand still when they stop. Medium and bigger walkers have at least six legs; a Colossus has twelve.
- The main menu is reordered: Single-player, Multiplayer, Designer, News and Updates, Options, Manual and Credits, and the old What’s new box is now the News and Updates screen with an article per day.
- Three new unit sizes: Micro (tiny, cheap and quick), Super-heavy and Colossus. The biggest two need the new Titan Works (5 factory modules) and a road three tiles wide: they will not squeeze through narrow gaps.
- Factories are specialised: each factory module builds units of one size (micro, light, medium, heavy, super-heavy or colossus), so a building needs a module for each size it should make. The HQ builds light and medium units, the Light Factory micro and light, the Vehicle Factory medium, the Heavy Factory heavy and the Titan Works super-heavy and colossus. Factories you saved before keep working but build light units only: check them in the designer.
- A factory now animates while it works, so you can see which enemy factories are busy. The production panel shows the queue as eight slots with a picture of each unit and a filling bar on the one being built; click a slot to cancel it and get the matter back.
- Balance change: units now get exponentially more expensive as their hull grows. Micro, light and medium units cost what they did; each size above medium multiplies the matter and the production energy by 2.5 (heavy ×2.5, super-heavy ×6.25, colossus about ×15.6), so a Juggernaut now costs around 5,000 matter and a Colossus around 17,000. Designs you saved keep working; check the cost shown in the designer.
- Legs: light legs climb onto the rim of rock outcrops, heavy legs two levels in, and colossus legs stride over anything, cliffs included. Units on legs move at half speed on rock.
- Sending a whole army across the map no longer makes the game hitch: every unit sets off at once, and its exact route is worked out over the next moments.
- Units heading for a building to dock, charge or repair now find their way there much faster.
- The map now has heights: rock is higher the deeper inside an outcrop, and some outcrops are cliffs (marked with a sandy rim) that only colossus legs and flying units cross.
- Heavy modules for the big hulls: Huge motor, Siege cannon, Rotary gun, Heavy armour, Cargo hold and Large battery. New starter units Mite, Strider, Walker, Juggernaut and Colossus.
- Programs can ask size(), climb(), unitSize(h) and heightAt(x, y).
- See where your CPU goes: event blocks and block cards show the most one run can cost, and a test run lists cycles by event block and paints a heat map on the graph.
- Your orders always get through: a unit flooded with events (taking many hits at once, say) used to drop an order and then ignore every order after it.
- Expressions too deep for the CPU are now refused with a clear message when you save the program, instead of crashing the unit while it runs. Button hotkeys taken by Move, Attack and the other common actions are refused for uploaded designs too.
- A building that runs a long action from its Visitor block (for example goTo with a chain) can no longer pick up the wrong visitor when the chain runs.
- The Detected block’s watch setting now offers MISSILE in the editor (programs could already use it).
- Victory and defeat screens now list their choices top to bottom, with room for longer labels, and slide in one by one like the main menu.
- Victory and defeat screens now list their choices top to bottom, with room for longer labels, and slide in one by one like the main menu.
- The match sidebar no longer shows the Controls accordion or unit details above the resource graphs; the selected-unit sparklines remain.
- Factory production queues now show all eight compact unit icons in one horizontal row.

## 2026-10-20
### A full Manual, missiles and flak
The documentation is now a complete Manual, and the arsenal grew: missiles, flak, radio and laser links, fast units and new building shapes. Saved designs now remember their game version, so after an update that changes the defaults you will be asked how to merge them.

- The documentation is now a full Manual: how the game works, controls, economy, building, fighting, designing classes, programming from zero (with links to learn more), a tour of the graph editor, nine worked recipes drawn as real graphs, and a gallery of every built-in block. The reference pages follow it.
- Drag while placing a building to lay a straight line of them, side by side (up to 12; spots that are blocked are skipped, and builders take them in order). Right-drag with units selected to spread them evenly along the path you drew.
- Units and buildings with a Radar module now carry a spinning radar dish on top.
- New double-length vehicle chassis (Long light, Long medium, Long heavy) with more module slots, drawn twice as long as they are wide, and a Rocket Artillery unit built on one: its huge missile launcher reaches 26 tiles, further than any sensor sees, so it needs spotters or radar.
- New building shapes: L, T, cross, U and H-shaped frames. They cover 5 or 7 tiles of a 3×3 box, leave the empty tiles walkable, and hold modules in proportion to the tiles they cover; construction energy is now charged per tile covered.
- Your saved designs now remember which version of the game they were made with. After an update that changes the default units, you are asked whether to merge the new defaults with your edits, replace your versions, or keep yours.
- Factory modules decide what a building can make: a light unit is built at full speed with 1 factory module, a medium one with 2, a heavy one with 3. One module short, a unit takes ten times as long (the HQ, with 1 module, builds Builders slowly); two or more short, the building cannot make it at all. New Light Factory, Vehicle Factory and Heavy Factory buildings are specialised producers.
- The graph editor shows blocks as cards with their settings and an Expand button, has a Blocks group in the palette and a Template chooser for new classes; the Docs have a new page on blocks and your own events.
- Starter units are now built from ready-made behaviour blocks (orders, recharging, harvesting, building, repairing, fighting), written as use(HarvestLoop, { minMatter: 10 }) and expandable into plain events to edit.
- Radio and Laser link modules: units and buildings of a team can now talk. radioSend(channel, value) reaches allies with a radio within 12 tiles (even through rock); laserSend reaches allies with a laser link up to 40 tiles away, but only along a clear line of sight. Receivers react in a new Message event block.
- Text can now be joined with +, for example alert('HP: ' + hp(), 2000); numbers and true/false values are turned into text for you.
- Scripts can now raise events of their own: emit(Name, values) and an on(Name) block in the same unit react to each other, in text and as nodes in the graph.
- New alert(text, duration_ms) function: a speech bubble with your text appears over the unit for a set time, visible to anyone who can see the unit.
- Long jobs (walking, harvesting, docking, building, repairing) now report how they ended through outcome pins instead of being polled, so busy units cost almost no CPU.
- Flak: a new anti-missile weapon that bursts every enemy missile near its target and never misses, with a Flak Truck and a Flak Turret. You can now also order any armed unit to shoot a missile down by right-clicking it.
- Fast units and a lightning discharge: a Turbo motor, the Dart and Pathfinder light units that are twice as quick as a Scout, and a visible tesla discharge.
- The designer opened from the main menu now has Download, Upload and Reset-to-defaults buttons for your saved designs, like the in-game menu.
- Missiles: three launcher sizes fire slow, homing missiles that fly in wide arcs and burst on their own at the end of their flight. Damage grows with the matter each costs; bigger ones are slower, turn wider and are easier to shoot down. Each has a shadow under it so you can see it is flying.
- New starter units so every weapon gets played: Tank (cannon), Lancer (laser), Stormer (tesla coil) and Rocket Truck (missiles). Tanks and Rocket Trucks fetch more matter from a silo when they run low.

## 2026-10-19
### Polish and sound effects
Sound effects have arrived, with their own volume slider, alongside a polish pass: sparks on finished buildings, build beams and smoother unit spreading. Maps are now perfectly symmetrical and start corners are shuffled each match.

- Rock on the map now has rounded outer corners and gets lighter towards the middle of big outcrops, the grid no longer shows through it, and thin lines in the fog of war are gone.
- Maps are now perfectly symmetrical (Badlands no longer favours player 1), and start corners are shuffled each match so you never know where your enemies are.
- A new Options screen on the main menu holds the music and effects volume sliders and a mute switch; the music widget now shows just the mute button and the track title.
- Units ordered to move to one spot now spread out over free tiles around it instead of all heading for the same place.
- Finished buildings now burst with sparks that run outwards along the grid lines, turning at crossings and fading, with a flash as they complete.
- Builders now fire a scanning cyan build beam across their site, and sites throw off the odd spark while under construction.
- Idle builders now spread out over the available building sites, and only team up on one when there are no others left.
- Charging pads send out a slow green pulse while they are actively charging units.
- A new Connecting screen covers the game while it loads and links up to the server, with progress as it goes.
- Sound effects: menus, orders, combat and alerts now have an effects system with its own volume slider.

## 2026-10-18
### Waiting rooms and spectating
Multiplayer rooms now open in a waiting room, so friends can gather before the host starts. If you are defeated you can spectate the rest of the match.

- Multiplayer and co-op rooms now open in a waiting room: friends join with the invite link and the host starts the game when everyone is in.
- When you are defeated or resign, you can now spectate the rest of the match with the fog of war lifted, or leave for the menu.
- The Resign button gives up your forces instead of quitting at once.

## 2026-10-15
### Repairs, a bigger unit cap and balance changes
Repair beams and a Repair Drone join the roster, the unit cap jumps to 256 and the menu gets an animated backdrop. Balance note: units now cost energy to build, lasers draw much more per shot and batteries hold less, so some designs may need a power rethink.

- Repairs: a new Repair beam module mends your own units and buildings (units can fix buildings and the other way round). It costs energy and matter, and armour is the most expensive to mend.
- New Repair Drone class you can build, with a Repair action (R, or right-click a damaged unit or building). The Construction Tower now repairs nearby things when it has nothing to build.
- Repairs show as a green beam with rising crosses, so they no longer look like weapon fire.
- Producing a unit now costs energy as well as matter, based on how many modules it has and what they are. Build buttons show both costs.
- Lasers draw five times the energy per shot, so a few of them will drain a small grid. Damage per shot is unchanged.
- Batteries hold half as much, and the starting base now has a small energy storage instead of a large one.
- Fixed: an energy storage that ran flat while discharging or holding could refuse to charge again even with surplus power.
- Daylight, wind and power are now large tiles at the top of the side panel, with the power balance on its own strip.
- The stats strip across the top of the map and the resource bars no longer jump around as numbers change.
- The main menu has an animated backdrop, a new font, larger text, and shows how many players are online.
- The music widget moves into the designer while it is open.
- The unit cap is now 256 per player (it was 80), and only units count towards it, not buildings. A new Units bar under Matter and Energy shows how close you are.
- Buildings can now only be placed inside your vision, so you can no longer build in the dark; the placement ghost turns red there.
- The edges of solid terrain are now outlined where they meet open ground, so walls and ridges stand out.
- Players waiting in the menu now count towards the players online total, shown as "In the menu".

## 2026-10-14
### Bigger maps and co-op
Five large new maps, a co-op mode against bots, radar and a refreshed main menu make this a big one. Units and buildings also now look different depending on their modules.

- New default building: the Radar Tower pings the map on its own while its radar module is switched on.
- New Radar module: a script calls radarPulse(energy) for a one-off scan whose range grows with the energy spent. Contacts appear as blips that slowly fade.
- New main menu: Single-player (you against a bot) and Multiplayer (every open game on the left, tagged free-for-all or co-op, with create-a-room on the right), plus the Designer and the API reference, both available without starting a game. Designs you make in the menu are the ones you get in your next match.
- Factory unit buttons respond on the first click, and now match the square action buttons, with a picture of each unit.
- Harvesters no longer stall: with nothing to do they return to the nearest storage building for new orders, switch to another nearby field when theirs runs low, and storage buildings send them to a random one of the nearest fields.
- Five new, larger maps: Great Plains, Sprawl, Long Valley, Bastion and Badlands, with extra resource fields between the bases. The lobby now shows ten maps in two rows.
- New game mode: Co-op vs bots. Up to two players on the same team, each facing a bot that never needs to mine and sends waves of units at you. Handy for testing your designs. The standard mode is a four-way free-for-all.
- Units and buildings now look different depending on their modules: weapons, motors, cargo, sensors and armour all change the hull and fittings.
- Units turn to face the way they last moved.
- The designer has a larger preview, with true-size thumbnails in your colours and a rival’s.
- Sprites are sharper when zoomed in.
- Matter patches slowly regrow after being harvested.
- Solar panels and wind turbines produce twice as much energy.
- Units are much more forgiving about energy use.
- Five maps to choose from when creating a room.
- Balance values are gathered in one place, so tuning is easier for the next update.

## 2026-10-13
### The first multiplayer release
Rooms with invite links, fog of war, winners and standings, and the class designer all arrive in the first playable release.

- Rooms: create a named room, share an invite link, and reconnect if you drop. The game pauses until two players are present.
- Matches end when one side is eliminated, with a winner screen and final standings.
- Scoreboard, matter and energy bars, and a live game clock.
- Control groups (Ctrl+1–9), priority band-select and a unit action grid with hotkeys.
- Fog of war, power-flow animation along links and charging-zone shading.
- Laser turret and tesla coil, construction towers, and building now costs energy.
- The class designer: code editor, test run sandbox, program history and design download/upload.
