# Player-facing release notes, shown as articles under News and Updates on the main menu.
# One "## YYYY-MM-DD" heading per update (newest first). Under it: an optional "### Headline",
# a short upbeat summary of one to four short paragraphs separated by blank lines (careful and plain
# for breaking or serious changes; the news list shows only the first), then
# one "- " line per change. Write for players: no file names or internals.
# Other lines starting with # and blank lines are ignored.

## 2026-11-01
### More than one weapon
Bigger hulls and buildings can now carry several weapons, each locking on and firing for itself. A micro hull still takes just one, light and medium hulls take two, heavy hulls three, and the very largest four; a building takes as many as its footprint is wide, up to four. All of a unit's weapons draw on the same cargo bay and battery, so a unit with a cannon and a flamethrower pays matter for both from the one hold.

Programs can see them as a list: count them, pick one by its kind (a laser, say) and aim it alone, or order the plain fire(target) to put every weapon on the target. For now the unit picture still shows a single turret however many weapons it carries.
- Hulls carry more weapons as they grow: micro 1, light 2, medium 2, heavy 3, super-heavy and colossus 4.
- Hive drones now fly out and attack the enemies the Hive spots, and Wasps have a new, smaller drone hull so swarms look the part.
- Buildings carry as many weapons as their footprint is wide, up to 4.
- Every weapon on a unit pays for its own shots, but they all draw on the same cargo bay and battery.
- The Designer's stats panel lists each weapon with its damage, range and energy per shot.
- Programs: fire(target) and the engage order now put every weapon on the target; the unit closes in until even its shortest-ranged weapon reaches.
- Programs: self.modules.weapon.length counts the weapons, self.modules.weapon[i].fire(target) locks just weapon i, and a filter by kind (W_LASER, W_CANNON and so on) picks one.

## 2026-10-31
### Railguns, ion guns, smoke, point defence and drone carriers, plus faster units, a tidier Designer and Spotlight Towers
Five new ways to fight arrive today. The Longbow charges a railgun that fires a line through up to four enemies, the Disruptor's ion gun holds one module of its target down for a few seconds, the Smoke Screen throws a volley of sight-blocking clouds, the Guardian's point defence shoots missiles and shells out of the air, and the Hive carrier launches and recalls its own Wasp drones. Flak now shoots down enemy aircraft too. Alongside them, every unit has twice its old top speed (and has to work up to it), damaged buildings smoke and burn, and the Spotlight Tower lights up the dark.

Every unit now has twice its old top speed, but they have to work up to it: small hulls pull away quickly, big ones take their time, and sharp turns make everything ease off before speeding up again. Damaged buildings now smoke and burn, so you can see how a fight is going at a glance, and new building sites only reveal the map once they are finished. The new Spotlight Tower throws a long beam of light into the dark and shows you everything it falls on. The more power you feed it, the further it sees, and a Light power slider in the side panel lets you choose how much it gets.

Programs can now put their own sliders and on/off switches in the side panel, so any class you design can offer live controls for the things you want to tune mid-match. Select several kinds of unit and you see every control they offer, each marked with how many units it affects.

You no longer need a unit watching a spot to build there: any ground you have already explored is fair game for new buildings. Ground you have never seen now fades to black the further it lies from anything you know, so the deep unknown really is unknown.

The Designer is easier to find your way around: search the module catalogue or jump between categories, start from a full-screen library of your units and buildings, spot modules by their icons, and give your programs the whole screen on the Code tab.

Programs now read more naturally. A unit's own readings and orders hang off a single `self` object (`self.hp`, `self.energy`, `self.moveTo(x, y)`), and each module has an object of its own under `self.modules`, such as `self.modules['weapon'].fire(foe)` or `self.modules.shield.angle(90)`. Programs you have already written keep working unchanged; the text view simply shows them in the new form, and `self` can no longer be used as a variable name.

Please note the speed change: the same designs now cover ground twice as fast at full tilt, so journeys, chases and attack timings will feel different, and a program that counts on a unit arriving after a fixed delay may need adjusting. Planes now begin circling their landing spot from twice as far out, to suit their speed. Harvesters have also changed: they now spend more time at a matter source, and the bigger the hull, the faster it gathers. Existing harvester designs take longer to fill up than before, so expect slower deliveries until you add larger hulls or more cargo modules.

Mass crystals now glitter as proper fields where they cluster, and ground vehicles driving across them kick up clouds of crystal dust.

Electrical discharges look the part too: tesla blasts, lightning rings and failing batteries and shields now arc from target to target, lighting up the night and the mist as they go.
- New Railgun module and the Longbow, a heavy railgun tank. It spends 400 energy and charges for five seconds in plain sight, with a blue aim line and a glint that grows at the muzzle, then fires a bright beam through up to four enemies in a line (each one after the first takes less), stopped by rock and shields. A charge spoils if the carrier takes a beating, is stunned, loses its target or starts to move, so a railgun wants an escort. Scripts can ask `charging(unit)` to see one coming.
- New Ion gun module and the Disruptor. Its violet bolt does no damage: it holds one working module of its target down for six seconds (pick which with `config.aim`, or it chooses at random), then the target cannot be ion-struck again for four. It costs 350 energy a shot, so it empties its batteries in a few shots. A shield stops the bolt, and the Modules list shows what is held down.
- New Smoke launcher module and the Smoke Screen unit. A volley of three smoke canisters (no matter, a 30-second rest) makes soft grey clouds that block sight for 15 seconds: sensors, the fog and spotlights cannot see into or through them, and lasers lose half their damage crossing them. Radar and radio see straight through. The `SmokeScreen` block throws smoke towards whoever hits the unit, and scripts can call `smoke(degrees)`.
- New Point defence module and the Guardian escort. It shoots down enemy missiles and cannon shells that come within three tiles, by itself, for 3 energy a shot, and sits beside the unit's normal weapon.
- New Drone bay module and the Hive carrier. The bay builds small drones (the stock Wasp) from the carrier's cargo and battery, keeps them safe, recharged and mended while docked, launches them when an enemy appears and calls them home afterwards. New script calls: `config.droneClass("Wasp")`, `launchDrones()`, `recallDrones()`, `dronesDocked()` and `dronesOut()`, plus the `DroneBay` and `Hunt` blocks.
- Four new default buildings to match: the Rail Tower, the Ion Tower, the Smoke Tower and the Point Defence Tower, all in the Defence section of the build menu. Link them to a power network, since the railgun and ion gun are thirsty.
- Flak Trucks and Flak Turrets now shoot down enemy aircraft as well as missiles (8 damage to every aircraft in the burst), and still do nothing to ground units and buildings. Their programs now watch for the new `AIR` kind in a `Detected` block (`FLIER` finds only aircraft); computer opponents build flak when they see aircraft too. If you wrote your own flak programs, add `AIR` to what they watch.
- Scripts: the unit is now `self`, with its own readings (`self.hp`, `self.energy`, `self.x`) and orders (`self.moveTo(x, y)`), and every module has an object under `self.modules` (`self.modules['weapon'].fire(foe)`). Existing programs keep working and are shown in the new form.
- Shields put on a much bigger show when they take a hit: the whole field flares, ripples run along the arc from the point struck, and a shower of sparks flies off.
- Designer: search the module catalogue, jump between categories (each shows how many modules it holds) and hide modules your chassis cannot carry.
- Designer: it now opens on a full-screen library of your units and buildings, split into tabs and sorted by size, with search; pick one to start working, and use the class name in the top bar to return to it.
- Designer: every module in the catalogue has its own coloured icon, and the unit preview is much larger.
- Designer: headline stats sit beside the preview with the full list one click away, and installed modules show how many slots are left.
- Designer: the graph editor's block palette can be hidden for more canvas, and the view switch, memory meter and version history now sit in the top bar.
- Harvesters now take their time at a matter source. Gathering is slower and proportional to hull size: a light harvester takes about 2 seconds to fill a cargo bay, and larger hulls gather more per second.
- Every unit's top speed is doubled. Units now accelerate: tiny hulls reach full speed in about half a second, the biggest take nearly two, so heavy armour is slow to get going.
- Cornering now matters: a unit eases off before a sharp turn in its route (down to a quarter of its top speed for a right angle or worse) and accelerates again afterwards; straight routes are unaffected.
- Damaged buildings and units now smoulder: below 90% health they give off smoke, and badly hurt ones burn with tall flames, with more smoke and flames the worse they get.
- A building site no longer lights up the map the moment you place it; it only sees once it is finished.
- New default building: the Spotlight Tower. Its beam follows the nearest enemy it senses and otherwise pans left and right across the way out from your base, lighting up the edge of the fog and the night, and turns back rather than shine on your own units.
- New Spotlight module for your own designs: its beam is 4 tiles long for every point of energy it is given each tick (20 tiles to start, up to 40), so more power peers further. Rock and buildings still cast shadows. When the energy stored in the building drops below 100 the light dims and shortens smoothly, going out at 30 units of stored energy instead of flickering (full strength needs 100).
- Class programs can add sliders and on/off switches to a new Controls section in the side panel; the Docs explain how. Controls are shared across a mixed selection, and one that only some of the selected units have says how many it affects.
- Every Spotlight Tower now has a Light power slider (0 to 10) in the side panel.
- A lit spotlight shows its beam as soft warm light that glides as it turns, brighter at night, and ends where rock or a building blocks it.
- Buildings can now be placed anywhere you or your team have explored, not only where you can see right now.
- While placing a building, a clear green line now marks the edge of the ground you can build on.
- Never-explored ground grows darker the further it is from known territory, until the map cannot be made out at all.
- Mass crystals that sit close together are now joined by a soft glow that fades smoothly into the ground, forming one crystal field, scattered with small shards across the whole area, which shrinks back as the crystals are mined out. Harvesting works exactly as before: units still go to each crystal.
- Ground vehicles and walkers driving over crystals kick up puffs of crystal dust; aircraft fly over without disturbing it.
- Electrical discharges from tesla coils, lightning strikes, bursting battery banks and failing shields now leap from point to point instead of fanning out in straight spokes, preferring to jump to nearby units and buildings. Every arc flashes with its own light, glowing on the ground and in the mist.

## 2026-10-30
### Lakes, rivers, lava and chasms to fight across, plus clearer building alerts, opponent skill levels, the flamethrower, rain and thunderstorms
The battlefield now has depth. Maps can hold shallow and deep water, winding rivers with bridged crossings, pools of lava and bottomless chasms, drawn with smooth, curving shores, foam on the water and a hot glow on the lava. Ground units wade the shallows slowly, new amphibious and hover drives take you across deep water and lava, and the same day brings clear alerts when a building cannot go where you wanted it, opponent skill levels, the flamethrower, rain and thunderstorms, bolder blasts and some gentler-on-the-eyes options.

Four new maps put the liquids to work: Lakeland, Twin Rivers, Cinder Fields and The Rift. Most of them are deliberately uneven, with lakes, rivers and lava pools wherever the land took them, though every base can still reach the others on foot. Water is no wall to the eye or to a shell, so you can see and shoot across a lake you cannot drive over. Three new starter units take advantage: the Skimmer, a quick hover scout that skims across water and can cross lava (scorched as it goes), the Amphibian, a cannon carrier that wades deep water, and the Wader, a harvester for fields across a lake. Computer opponents field hover units on these maps too.

If you write programs, take note: heightAt still reads 0 over water and lava, so use the new depthAt(x, y) to tell liquid from dry ground (passable now says 0 on liquid as well). wade() tells a unit how deep it can go, escapeX() and escapeY() find the nearest ground that is not lava, and the new LeaveLava block uses them to walk a hover unit off lava it stopped on. Existing programs and designs keep working.
You now choose how tough your computer opponents are. Free-for-all and Co-op hosts add computer players in the waiting room, naming each one and setting a difficulty from Patsy, a gentle first opponent, up through Beginner, Normal, Experienced and Hard to Insane, for players who want a real fight. On the Single Player form you pick your opponents the same way, and Surrounded has one difficulty that all four bots share. Computer opponents used to play at what is now Hard, so everything starts at Normal: if you liked the old challenge, pick Hard.

Co-op changes a little with this. The host now decides how many bots the team faces (at least one, leaving a seat for the second player) instead of each player getting a bot of their own.

The weather has more to say now. Every so often rain, a thunderstorm, a heatwave, a dust storm or a bank of mist drifts over the battlefield, and each one slides in and out gradually rather than switching on. Rain is light on the eyes and ears, with a soft patter that swells and fades with the weather, and little splashes where drops land in the parts of the map you can see. Storms add lightning, and a strike briefly stuns the controls of whatever it hits, so it is worth knowing when one is overhead. Heat favours solar power, dust and mist close your sight in, and the World section of the Energy drop-down names whatever is in the air.

There is a new weapon to play with: the flamethrower. It sprays a jet of slow balls of burning fuel, about five a second, that land, stick and burn where they fell, glowing and smoking, and hurt everything standing in the flames a little at a time, yours as well as theirs, so aim with care. The fires add up, so a steady stream wears a target down fast while using very little matter. Enemy shields turn the fireballs back. The fuel is dangerous to carry: a unit or building with a flamethrower takes extra damage, and when it is destroyed it throws fire in every direction at once. Try the new Flamer, a costly and slow unit that holds its fire when one of your own stands beside its target, or add the part to your own designs. Keep Flamers well spread out: packed together, one loss can set off the whole group. Rain helps, though: fires burn out much faster the wetter it is, and a downpour smothers them in moments.

The main menu also has a small live indicator beside Multiplayer showing how many players are in a game right now and how many are online, so you can see at a glance whether it is a good time to join someone.

Explosions and gunfire have more character too. Cannon hits, missiles, falling units and collapsing buildings each blow up in their own style, battery banks and failing shields go out with a flourish of their own, shot-down aircraft sometimes tumble on for a moment, trailing fire, before they hit the ground, and lasers, guns and flak cannons now look like what they are instead of a plain line.

Please note: the game now shows a photosensitivity warning the first time you load any part of the game, whether the main menu or a join link (once you accept it, it stays away), because lightning and flickering lamps can be a problem for people with photosensitive epilepsy. Nothing flashes or flickers while that message is open. In Options you can now turn off full-screen flashes and light flicker, and choose Simple or Fancy weather; the Reduce motion option still turns all of it off at once.

- Rain now ripples the water, and lava gives off soft rising steam, thicker in the wet.
- Shores meet cliffs and tall rock with a crisp, straight edge, and foam and lava glow no longer spill onto the rock.
- Lakeland now has far more lakes, scattered wherever the land took them
- The Rift now has a vast bottomless void at its heart: only fliers cross the middle, so the lanes around it matter more
- When a building cannot be placed, an alert now tells you why (something in the way, rock, water, lava, a chasm, the map edge, no vision there, or too many construction sites), and each reason has its own sound cue.
- Lava has more character: darker, cooled patches drift through the glow, and every so often a glowing fragment is spat out and arcs back down
- You can now keep up to 128 classes at once (it was 48), so there is room for plenty of your own designs beside the starter ones
- Maps can now have shallow water, deep water, lava and chasms with no floor, drawn with smooth, curving shores: foam on the waterline, darker colour towards the middle of a lake, a cooled crust and a glowing line on lava, and a dark crumbling edge on chasms
- Water glints drift on the wind, lava bubbles and glows at night, and units wading leave a ring behind them (all of it still when Reduce motion is on; the glints, bubbles and wakes with Fancy weather effects)
- Ground units wade shallow water at about 60% speed and plan their route round the water when the detour is short; deep water stops them
- New Amphibious drive: wades deep water (at under half speed). New Hover skirt: skims over water at full speed and can cross lava, which scorches it. Neither can climb rock or mix with legs or rotors
- A ground unit left in lava burns up, a unit over a chasm is lost, and only flying units cross a chasm
- Liquid does not block sight or shots, but you cannot build on it
- Four new maps: Lakeland (lakes and shallows), Twin Rivers (two winding rivers, each bridged in two places), Cinder Fields (pools of lava) and The Rift (chasms and lava); the map previews show the liquids
- New Skimmer, Amphibian and Wader units in the starter classes, and computer opponents send hover Skimmers on maps with liquid
- For programs: new depthAt(x, y), wade(), escapeX() and escapeY() calls and a LeaveLava block; heightAt reads 0 over liquid and passable reads 0 on it
- New Flamethrower weapon: a jet of slow, lobbed fireballs that land and burn in place for several seconds, hurting every unit and building in the fires, whoever owns it. It uses matter as fuel, one for every four fireballs
- Shields glow brighter when struck, with a soft bloom that swells where a shot lands, and a hot bloom in both colours where two shields overlap
- Enemy shields turn flamethrower fireballs back
- Anything carrying a flamethrower is fragile and explodes in a ring of fire when it is destroyed, and units packed close together can set each other off in a chain, so keep Flamers apart and away from your own army and base
- Rain and storms put out flamethrower fires faster, the heavier the weather
- Shot-down aircraft that crash are now sometimes left burning where they come down for a while: the bigger the aircraft, the likelier and longer the fire, and the very biggest throw fragments now and then as they burn (less often, and not for long, in the rain)
- Fragments that bounce away from an explosion now and then leave a small fire where they come to rest (rain smothers them)
- New Flamer unit in the starter classes: expensive to build and slow, and it will not fire when its own units are right next to the target
- Shot-down aircraft now sometimes spin out of control and fly on a short way, burning, before they crash and explode (not shown with Reduce motion).
- The main menu shows how many players are playing right now and how many are online, floating beside the Multiplayer button
- Hosts can add computer players to a free-for-all or a co-op game in the waiting room, up to the number of seats on the map, and remove them again
- Each computer player has its own name and a difficulty: Patsy, Beginner, Normal, Experienced, Hard or Insane (new ones start at Normal), changeable until the match starts
- Easier levels build up and attack later and with smaller armies; Insane thinks fastest, expands furthest and builds the biggest economy
- You can start a free-for-all on your own against computer players
- Single Player lets you add up to three opponents, each with its own name and difficulty
- Surrounded has a single difficulty for all four bots, chosen when you create the game
- Computer opponents in Single Player, Co-op and Surrounded now start at Normal rather than the old, tougher level, which is now called Hard
- Rain and storms now appear now and then, shown in the World section of the Energy drop-down
- Under rain, solar panels get less sunlight, and the wind never drops as low as it can on a clear day
- Rain now has a sound: a soft, steady patter that fades in as the rain sets in, swells as it gets heavier and fades away as it clears
- Storms take more sun away and blow harder still, so a wind farm is worth having when the sky turns dark
- Lightning flashes during a storm with a jagged bolt across the sky, and a strike briefly stuns the controls of any unit or building it hits (a short, tesla-style stun), so a storm can catch a group off guard
- Heatwaves make solar panels produce more, but the wind drops away
- Dust storms and mist close in your sight range; dust also dims the sun and blows a strong wind
- Mist now plays like a real fog: soft wisps drift across the battlefield, over units and effects, and the edge of what you can see closes in with a pale, soft haze
- In mist, muzzle flashes, laser zaps, fire and explosions light up the air around them with a soft halo
- In mist and dust, headlights come on even in the middle of the day, with wider, whiter beams and a pale glow round each vehicle
- The edge of what you can see now fades softly instead of stepping tile by tile
- Lightning flashes are gentler on the eyes, and the ring of sparks now appears on some strikes only, centred where the bolt lands
- Falling raindrops that splash now fall at the same speed and in the same style as the rest of the rain
- Weather now creeps in gradually, taking anywhere from about 15 to 45 seconds to change, so sun, wind and sight shift a step at a time
- The World section of the Energy drop-down now names the weather (for example "Storm, windy") and, while it rains, shows a bar for how heavy it is
- Raindrops splash on the ground as they land, but only where you can see
- Rain eases in and clears gradually rather than switching on and off
- Solar-powered units charge more slowly in the rain, just like solar buildings
- Wind turbines spin faster when the wind is kept up, and the Solar and Wind bars in the Energy drop-down show the real figures
- With Reduce motion on, the rain stands still and the lightning flashes are left out
- Units now burst in one of three flavours (a classic fireball, a quick bright flash, or a slow smoky burn)
- Cannon shells go off with a short, sharp pop; missiles with a bigger fireball and a rolling smoke plume
- Buildings collapse in a chain of blasts inside a cloud of dust and smoke
- Battery banks discharge in a ring of blue-white arcs, bigger the fuller they were
- A shield that gives out folds in on itself, then shatters into glowing shards in its owner's colour
- Lasers are now glowing beams in their owner's colour, with a bloom at the muzzle, a hot spot and ripple where they land, and lights that pick out the ground at night; stronger lasers burn thicker
- Guns fire bright tracers that cross the gap, with a muzzle flash and sparks on impact; rotary guns send two at once
- Flak cannons leave a string of puffs and end in a pale air-burst with hanging smoke
- A photosensitivity warning appears the first time you load the game, from the main menu or a join link, and no flashing or flickering happens until you close it; you can also choose Go to Options Menu there without connecting to anything
- New Options: turn full-screen flashes (lightning) on or off, and turn light flicker (lamps stuttering as they switch) on or off
- New Options: choose Simple weather for just the basic effect of rain, storms, dust, mist and heat, or Fancy for splashes, grit, mist banks, heat shimmer and lightning bolts (Fancy is the default)

## 2026-10-29
### Energy shields, smarter harvesters, cannon shells and shorter nights
Missiles finally meet their match: the new shield emitter casts a glowing arc of energy that enemy units cannot cross and enemy shells, missiles and gunfire cannot get through. It drinks power every moment it is up and pays for every hit from the battery, so a shielded unit or tower is a real commitment, and one that is pushed too far blows up. Units move more like they mean it: ground units steer around each other instead of jamming, and flyers sweep through the air in smooth arcs and circle before landing. Harvesters work like a crew that knows its base: they favour fields close to a silo or depot, spread out so no field or depot gets swamped, and move on to another depot when one is overcrowded. Cannons fire real shells you can watch cross the battlefield, and nights are much shorter, so you spend more of the match fighting in the light: each two-minute day gives you 84 seconds of sun and 36 seconds of darkness. Attacking units are smarter about distance too: they stop and fire as soon as the enemy, or the shield in front of it, is in range, rather than charging in.

The new Shield Tower and Aegis escort carry a shield and a ready-made behaviour that turns it to face the nearest incoming fire. If you write your own unit programs, you can aim a shield yourself, widen it and push it further out, and there is also a new toolkit for choosing well: find calls that return lists of resources, depots, enemies and more, and short chains such as filter, sort and minBy to pick the best one. The Docs have a new Lists & chains page with worked examples.

Heads up for cannon users: shells take a moment to arrive, so fast movers can dodge them, and rock higher than the gun now blocks the shot. New tanks and other matter-fed units leave the factory with ten shots already loaded. Harvesters built from the ready-made behaviour now choose their fields differently from before; programs you wrote yourself are unchanged.
- New shield emitter module: a translucent arc of energy that enemy units cannot walk through and that stops enemy shells, missiles, guns and lasers. Your own units and allies pass straight through.
- Shields run on the unit's or building's battery: a steady drain while they are up (more for a wider or longer arc), and a share of every hit they stop. If the battery runs flat under fire the emitter is destroyed in an explosion as big as the energy it held, and the unit or building takes damage too.
- A new ShieldGuard behaviour turns a shield to face the nearest incoming shell or missile, or the nearest enemy; shields do nothing on their own, so your own programs can aim them any way you like. Switching the module off in the Modules list drops the shield.
- Shields throw sparks where a shot lands, light up where they are struck, and throw showers of sparks where two shields overlap.
- New Shield Tower building and Aegis escort unit, both with a shield emitter. Tesla pulses and flak pass through shields.
- New script calls to take charge of a shield: config.shieldAngle, config.shieldArc, config.shieldRange, plus shieldUp, bearing and incomingBearing; the Docs and Manual cover them.
- Harvesters favour fields closest to a depot or silo instead of the biggest or farthest ones.
- Harvesters spread over fields and depots, and move to another depot when one is overcrowded.
- Harvesters with a full load wait for room at a silo instead of circling it, and pick a new field when theirs cannot be reached.
- New list tools for unit programs: find lists of resources, depots, chargers, sites, damaged friends and enemies, then filter, sort, map and reduce them with short chains.
- New Lists & chains page in the Docs.
- Flying units now fly in smooth arcs with a gentle weave, circle briefly over their destination, and then come in to land.
- Ground units now steer around each other when they meet head on or find a unit in their way, instead of shoving into it and getting stuck.
- Cannons and siege cannons fire visible shells instead of instant hits.
- Shells sometimes glance off rock or units in a shower of sparks, and explode with a small blast on a hit.
- Cannons, siege cannons and missile launchers now see a thin wedge along their barrel out to their full range, so long guns can spot targets far down the line they are aiming along.
- Cannon range is three times longer: 21 tiles for the cannon, 27 for the siege cannon.
- Guns standing on higher ground than their target reach further.
- New units with cannons or missiles start with ten shots in the cargo bay.
- Nights last 36 seconds instead of a full minute.
- Daylight lasts longer, so solar panels have more time to charge, and dusk and dawn come round sooner.
- Gun lamps on turrets and tanks have a shorter, dimmer beam, easier to tell from headlights.
- Units sent to attack now stop and fight as soon as the enemy is in weapon range, instead of charging right up to it. On an Attack order across open ground they halt to deal with the first enemy they meet, then carry on. Enemy shields count too: a unit stops once it can hit the shield in front of its target.

## 2026-10-28
### Steam vents, settlements, nightfall and a harder look at the battlefield
The map has more to find. Wrecked units now leave piles of scrap that harvesters can recycle. Steam vents now hiss in open ground, one for each quarter of the map, and a building with a steam turbine standing on one gets a low, steady trickle of power, day and night, wind or no wind. Small clusters of old neutral buildings (shacks, tanks, halls and ruins) now dot the open country: they do nothing, but they block the way and give you cover to fight around. And the sun now sets on the battlefield: after dusk the map goes dark, vehicles switch on their headlights, and your buildings show lit windows against the gloom.

Nights are harder to fight in, and a long match now has a rhythm of daylight to work in and darkness to survive.

The ground itself also has a little more character: faint contour lines now sweep across open country.

Sight has limits. Fog of war follows line of sight, so a ridge or a wall hides whatever is behind it, and an enemy can sit just out of view until you go round the cover and look. After dark your units and buildings see a little less, so the fog closes in round them. Flying units still see over everything, and at night they throw a pale spotlight on the ground beneath them.

Units and buildings are easier to tell apart under fire. Builders wear yellow hazard stripes and repairers red ones, guns stand out against any hull, small motors run on wheels and big ones on tracks, and buildings sit tidier, with gaps between them. Heavily armoured buildings now stand as walls that join up into barricades. Wrecks throw glowing fragments, and some of them bounce on across the ground before they burn out. Matter fields are drawn as crystal and thin out as they are mined, so you can see how much is left before a harvester runs dry. Units also route more sensibly to buildings: builders and others now go to whichever side of a building is quickest to reach, instead of always heading for the tile above it.

Horde and Surrounded can now be played co-op, up to four players on maps built for them, and Skirmish is Single Player again. Unit programs can raise pop-up alerts, and the neutral Wanderers now run on solar power, so they keep moving through the night.

Please note: the default Unload key has moved to Shift + D, so W, A, S and D are all free for panning the camera. If you prefer the old key, you can set it back, and re-key your control groups, in Options.

- Open ground now shows a few faint contour lines, hinting at gently rolling terrain.
- Lights now go out when a unit or building runs out of energy, and come back on when it is recharged. Radar dishes stop turning and turrets stop scanning too. Lamps also flicker for a moment as they switch on at dusk or fail and recover, with Reduce motion turning the flicker off.
- Units that break down after running out of energy now leave a pile of debris instead of a block of matter: scorched ground strewn with gears, bent plates, tyres, pipes and bolts, wider for bigger hulls. Harvesters still recycle it for matter, the pile thins out as they work, and once it is used up it is gone for good.
- Steam vents are new on every standard map: open ones puff a big, breathing cloud of steam. Put a building with a steam turbine over one and the cloud settles to a calm, steady column ringed with pulses of energy; put any other building over one and only thin wisps slip out round the edges.
- New Steam Turbine module and Steam Plant building: a Steam Plant makes a small, constant amount of power while it stands on a vent (a building with several turbines needs a vent under it for each one). Off a vent it makes nothing.
- Neutral settlements: small clusters of grey shacks, round storage tanks, halls and ruins now stand on the maps. They cannot be attacked or used, but they block movement and line of sight, so they work as cover. They always leave room to walk round, and never sit in a starting base or on a matter field.
- The Energy drop-down lists your steam plants alongside solar and wind, and the designer shows the steam output of a design.
- Glowing fragments thrown from explosions can now bounce up to three times, skipping off in random directions with a little less energy each hop, before they burn out.
- Units heading for a building, such as builders going to a construction site, now walk to the nearest reachable side instead of always the tile above it, so they no longer take the long way round a run of walls.
- The World line in the Energy drop-down now says what time of day it is (dawn, morning, midday, afternoon, evening, dusk or night) and how the weather is (calm through to a gale), alongside the solar and wind meters.
- Unit programs can read the light level where they stand with the new lightLevel() call: bright by day, dim at night but never fully dark, following the time of day. That makes night-time behaviour possible, such as a scout that holds back when it gets dark.
- Your units and buildings now see a little less as the light fades: at full dark sight shrinks by a quarter, up to three tiles, and widens again towards midday. Enemies can get closer before you spot them at night, so keep an eye on your outskirts.
- Matter deposits are redrawn as clusters of green crystal shards, with a faint cracked and rippled patch of ground around each one. Units can still drive straight over the patch.
- Each deposit now has small crystals scattered across the ground around it, and they vanish from the outside in as it is mined.
- At night, the warm glow from your buildings now follows their real outline, so L, T, U and other shaped buildings light up in their own shape instead of a square.
- The ground around matter crystals now has crisp, square-edged markings that fit the look of the rest of the game.
- While a harvester mines a deposit, glittering sparks now stream in from the ground around it towards the crystals.
- A deposit visibly runs down as it is mined: its crystals disappear one by one until only the bare patch is left, and they grow back as it recovers.
- Click a deposit (or several) to see how much matter is left, as a bar with the amount out of its full size, in the left-hand pane.
- Building frames now hold only a tenth of the energy they used to (a small frame 20, medium 50, large 100). A wall or other building with no batteries no longer carries a hidden reserve; add battery modules where you want to store energy. Existing designs keep working but buildings that relied on the frame's reserve may run dry sooner.
- A building with more armour plating than other modules is now drawn as a wall: a plus shape on its own, which stretches into a straight bar (| or -) when walls stand beside it, with corners and junctions where lines meet. Walls that only touch corner to corner link up with a diagonal arm, so you can run a barricade across a slope. Lines of walls read as solid barricades. Shaped frames look as before.
- One-tile buildings are drawn at about half their old size, and larger buildings now leave a small gap round them, so your base looks tidier and less chunky. Nothing about how much room buildings take on the map has changed.
- Turrets and power pylons now stand on a sturdy lattice base that fills the tile they sit on, with corner feet and a thin edge in your colour.
- Modules now fill their buildings: a lone module fills the building's whole top, and several share it evenly. Solar panels spread across the full roof, and wind turbine blades are bigger, though never wide enough to touch the blades of the turbine next to them.
- Solar panels are redrawn as proper panels: a metal frame round a grid of blue cells, with a glint across the glass.
- Wind turbines now show their blades in the build menu, and turret buildings and vehicles show their guns in menu icons too.
- Building modules now have real presence: batteries are big storage banks, factories are workshops with a roller door and exhaust stacks, solar panels spread into arrays, and silos and chargers fill their tiles. A building with only a module or two sits as a smaller block in its tile and grows as you add more.
- Working factories now glow at their doors and puff smoke from their stacks while they build, and finished units roll out of the door.
- Guns are now much easier to see: barrels, missile tubes and turret rings are pale and outlined, so they stand out against any hull colour.
- With a builder selected, the side panel now shows Orders first and the building choices just below, so your commands stay in the same place.
- Units with small and turbo motors now roll on proper separate wheels, while large and huge motors keep their tracks, so you can tell light runabouts from heavy tracked units at a glance.
- Units with a build arm now wear yellow hazard stripes round their whole hull, and units with a repair beam red ones, so you can tell your workers and menders apart in the middle of a battle. Buildings with these modules show matching striped symbols.
- Fog of war now follows line of sight. Rock and buildings block your units' view: you see the face of a wall or cliff but not what is behind it, so enemies sheltering behind cover stay hidden until you get a clear look. Buildings see out from their own walls, and flying units see over everything. Building placement follows the same rule.
- Neutral Wanderers now carry two solar panels and recharge in daylight; when their battery runs low they pause to soak up the sun, then set off again, so they keep roaming indefinitely.
- Solar panels can now be fitted to your own mobile units in the designer, charging that unit's battery while the sun is up. On the move they are heavy, fragile and only a quarter as efficient as on a building, so they suit patient, lightly armed units best.
- Explosions now throw out glowing fragments that fly clear and burst a moment later in small flashes and showers of sparks, so a big fight feels more explosive. Modules breaking off a unit shed a few of these too.
- The map now darkens and brightens with the day and night cycle, so you can see the sun setting on your solar panels.
- At night, flying units shine a big, bright pale spotlight down onto the ground below them, spreading wider and fading the higher they fly.
- At dusk, finished buildings give off a soft warm glow, as if their lights were on inside.
- Explosions, gunfire, missile launches, missile engines and tesla discharges now light up their surroundings, with bigger blasts and bigger guns throwing more light. It is most striking at night.
- Headlights now fade out softly along the beam and spill a little light around the vehicle, and they shine from under it. Nights are also a touch brighter.
- Gun turrets, on units and on turret buildings, now carry a lamp that swings with the gun at night. When there is nothing to shoot at, turrets slowly look around on watch (they stay facing front with Reduce motion on).
- At dusk, ground vehicles switch on their headlights: each body type has its own pattern of one to three lamps, some bright and some dim, and a few are lopsided. Flying units show red and green navigation lights and a flashing white strobe (steady with Reduce motion on).
- New Co-op Horde and Co-op Surrounded game types in Multiplayer. In Horde, up to four players hold out side by side against one endless stream of units; in Surrounded, up to four players share the middle of the map with a bot in every corner, and win together by destroying all four.
- New maps for them, with bases packed close together: Last Redoubt, Siege Line, Dead End, High Ground, Long Night and Trench Works for Horde, and Crossfire, Pincer, Bullseye, Ridgeback, Clearing and Rubble for Surrounded. Each game type shows only the maps that suit it, Single Player Horde and Surrounded use them as well.
- Harvesters and other units now deliver to and collect from silos and other buildings from any side or corner, instead of having to line up with one face of the building.
- Messages such as "Restored your saved designs" now pop in as small glass alerts at the top right, under the scoreboard, then slide away after a few seconds. A green, amber or red edge tells you at a glance whether it is good news, a heads-up or a problem.
- Programs can now send you a short pop-up alert with the new notify call, for example notify('Fuel low', NOTE_WARN). Choose NOTE_OK, NOTE_INFO, NOTE_WARN or NOTE_ERROR for green, plain, amber or red; only you see it, and each unit can send one every two seconds.
- The edge of the map is easier to see: the ground beyond it is now a darker shade, so you can always tell where it ends.
- You can now scroll further past the edge of the map, so bases and fights near the edge are easier to see and command.
- If your game window is smaller than 900 by 800 pixels, the main menu shows a short note suggesting a bigger window, full screen or zooming out, so you can get around comfortably. Close it with Got it, Enter or Esc.
- The left pane is tidier: the selected unit's name now sits centred at the top, level with the resource bar, while the Designer and Docs buttons and your player and session name live at the bottom, just above the music player.
- Choosing what a factory builds is easier to read: a Build units button opens a panel beside the left pane, like the building panels, with each unit shown larger alongside its name and cost. The music player has also moved up above your player and session name.
- Hold Ctrl while clicking a unit in the Build units panel to fill the rest of the factory's queue with it. You can pick a different key under Options > Controls.
- Control groups are now yours to set up: under Options > Controls > Selection you can choose which key saves a group (Ctrl or Meta), which adds to one (Shift), and, if you like, a key to hold with the number to select one. Selecting still works with just the number unless you choose otherwise.
- Radar ghosts now disappear as soon as your own vision reaches their spot, so you only ever see the real units and buildings there.
- Scrollable panels, menus and lists fade at the bottom edge while more content is hidden, and show everything clearly once you reach the end. News and Updates also gets a soft blue glow along its bottom edge while there is more to read.
- Skirmish is called Single Player again on the main menu, in the manual and in the match list. It is the same game against a bot, with the same scenarios (Classic, Horde and Surrounded).
- Unload now defaults to Shift + D instead of D, so pressing D pans the camera right. If you prefer the old key, set it in Options > Controls (or press Reset to default on that row after changing it).

## 2026-10-27
### Opponents that play like people, new Single Player scenarios, and a smoother camera
Enemy bots now play the whole game the way you do: they mine, power their base, build factories and defences, claim new resource fields, scout you out and attack in waves. Expect a much sharper opponent than before, with a first attack after about three and a half minutes, so get your economy and defences going early.

Single Player has more than one way to play now. Hold the line against an endless Horde, or start in the middle of the map with an enemy bot in every corner.

Choosing what to build is easier to scan, and the camera glides: pan with W, A, S, D or the arrow keys, and pinch and scroll on a trackpad. If you would rather play another way, Options lets you set your own controls, from camera keys to order hotkeys.
- The camera now pans smoothly with the arrow keys, easing in and out instead of jumping in steps.
- W, A, S and D pan the camera too. When a letter is also an order for your selection (A attack, S stop, D unload), it still gives that order, so your hotkeys work as before.
- Trackpads work in the battlefield: pinch to zoom at the cursor and scroll with two fingers to pan.
- Options has a new Controls section: choose your own keys for panning, zooming, resetting the view, selecting all and cancelling, and decide which mouse button selects, gives orders or drags the map. Zoom and pan can be put on the mouse wheel, a pinch or a two-finger scroll, and every control can include Ctrl, Shift, Alt or Meta. Each control has two slots, and a button resets everything to the defaults.
- The order keys (Move, Attack, Stop, Harvest, Unload, Repair, Recharge, Demolish) can be changed too, and each control that you have changed gets a Reset to default button. Attack is now Ctrl + A and Stop is Ctrl + S, which leaves A and S free to pan the camera together with W and D. If you were used to pressing A or S for those orders, please note the change; you can set them back in Options. Other order keys still queue with Shift, and the buttons show your keys.
- New building menu keys: with a builder selected, B opens the build menu, Q and E switch category, comma and full stop step through the buildings and Enter starts placing the highlighted one. All of them can be changed in Options.
- The Controls section tells you when a choice will not work, for example browser shortcuts such as Ctrl+W, or Shift + right click in Firefox, and asks before it takes a key away from another control. Your choices are saved in your browser.
- The main menu now puts the ways to play on the left, with Options, Manual and Credits just below, and the latest news in its own panel on the right. The whole menu now sits in the middle of the screen.
- Menus start closer to the top and sit a little more snugly, leaving more room for each screen.
- Bots no longer get free matter and energy: they harvest, and pay for everything they build and train.
- Bots expand, setting up silos and turrets at extra resource fields, and on big maps chains of pylons and charging pads to keep their army powered.
- Bots scout, build laser turrets between their base and yours, and bring a mix of Scouts, Darts, Tanks, Lancers, Stormers and Rocket units.
- Single Player has a new Scenario choice: Classic (the usual single bot), Horde and Surrounded.
- Horde: there is no enemy base, just a slow, never-ending stream of units from the far corner. The groups grow and tougher units join in over time. See how long you can hold.
- Surrounded: you begin in the centre of the map with a bot base in each corner. Destroy all four to win; they send their waves a little more slowly to give you time to dig in.
- Build categories now open a grid of buildings over the map, in the same glass style as the meters at the top.
- Pick a building and the panel clears away so you can place it straight away.
- Hold Ctrl or Shift while picking to keep the panel open and place several buildings in a row.
- Esc or a click elsewhere closes the panel; Esc leaves your selection alone.
- The left pane is about a third narrower, giving the battlefield more space.
- Orders, resource rows and the session buttons are rearranged to fit the slimmer pane: orders sit four to a row and the design buttons stack.
- Explosions now only appear where units and buildings were actually destroyed in view, with no stray blasts in the top-left corner of the map.

## 2026-10-26
### A calmer match screen
The match screen is now easier to read at a glance. Your matter, energy and unit counts and the daylight, wind and power meters sit in a bar across the top, and the left pane shows only what your current selection can do. Pick a builder and the building options appear; pick something else and they get out of the way. Matches now open zoomed in on your base. Defensive buildings look the part too, with proper gun turrets like your vehicles' and one for each weapon they carry. The main menu also has a new name for solo play: Single-player is now called Skirmish.
- Defensive buildings now carry proper gun turrets, the same style as your vehicles', and a building with several weapons shows a turret for each one.
- Matches now open with the camera zoomed in on your base, with some room around it, so you can start building straight away.
- Room names can now use any characters (letters from any language, spaces, emoji), up to 40 characters, and show exactly as you typed them.
- Single-player is now Skirmish on the main menu, in the manual and in the match list: same game against a bot, new name.
- Matter, energy and unit meters run along a bar at the top of the screen, each tile filling up like a bar.
- Hover the Energy meter to see solar and wind levels, the generators behind each with their output, and your power balance.
- If your power network is split in two, the Energy meter shows a separate bar for each part, and the drop-down lists every grid on its own with its batteries and generators.
- The drop-down panels are slightly see-through, so you can still see the battlefield behind them.
- Units and buildings now cast a soft contact shadow, so the battlefield has more depth, and flying units visibly rise above theirs when they move.
- The strip of figures across the top of the map is gone, giving you a clearer view; the name of the unit you point at or select now appears at the top of the left pane.
- Hover the Units meter to see which unit classes you have in play and how many of each. Click a class to select all of those units, or hold Shift to add them to your selection.
- Hover the Matter meter to see your income per second and how full each of your silos is.
- Building options now live in the left pane and appear when a builder is selected, instead of in a bar under the map.
- Pick a building category and its buildings are listed right underneath it, rather than in a pop-up over the map.
- The Orders section appears only when your selection can take orders.
- The Selection section appears only when there is something to show, such as a factory queue or resource graphs.
- The module list is folded away until you open it.
- Saving, loading and resetting designs, and Resign, now sit together in a folded "Designs and match" row at the bottom.

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
