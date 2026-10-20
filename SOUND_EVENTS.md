# Sound event tags

Tags a sound manifest entry can attach to. Several entries on one tag: pick one at random per trigger.

Manifest: the existing JSON array, with two kinds of entry.

```json
[
  { "file": "ui-authorised.mp3", "name": "UI Authorised", "author": "Jurij", "License": "Pixabay License", "url": "...",
    "tags": ["ui.confirm", "match.start"], "volume": 1.0 },

  { "tag": "ui.cancel",     "use": ["ui.click"] },
  { "tag": "match.victory", "use": ["sting.victory"] },
  { "tag": "order.move",    "use": ["order.acknowledge"], "only": true }
]
```

- **Sound entry** (has `file`): plays on every tag in `tags`. One file may serve many tags; many files may share a tag.
- **Reference entry** (has `tag` and `use`): the tag also plays whatever the tags in `use` play. Pools are merged, so the random pick runs over the tag's own sounds plus the referenced ones. Add `"only": true` to ignore the tag's own sounds and use just the references.
- References chain (`a` uses `b` uses `c`) and may point at any tag, including ones with no sounds of their own. A cycle is reported when the manifest loads and the loop is cut.
- Credits keep working: only sound entries carry author/licence, so reference entries are skipped when listing them.

Naming: `group.event`. Falling back to a parent tag is automatic (see below), so references are for reuse across unrelated tags.

"Source" notes where the game already has a hook: **sim** = `SimEvent` / simulation state, **msg** = server message in `protocol.ts`, **ui** = client DOM/UI code, **new** = needs a new event emitted (not available today).

## 1. Menus and UI (out of game)

| Tag | Trigger | Source |
|---|---|---|
| `ui.click` | Any button press, generic | ui |
| `ui.confirm` | Primary/positive action (Start, Create, Save, Join) | ui |
| `ui.cancel` | Back, Close, Cancel | ui |
| `ui.hover` | Pointer enters a button (keep very quiet) | ui |
| `ui.error` | Refused action, invalid input, `error` message | msg `error` |
| `ui.notify` | Toast / notice appears | ui |
| `ui.toggle_on` / `ui.toggle_off` | Checkbox / switch changed | ui |
| `ui.select` | List row or option picked (map, mode, room) | ui |
| `ui.tab` | Tab or panel switch (docs, designer, changelog) | ui |
| `ui.panel_open` / `ui.panel_close` | Overlay opens/closes (docs, credits, designer) | ui |
| `ui.type` | Key typed in a text field (optional) | ui |
| `ui.slider` | Volume or similar slider tick | ui |
| `menu.enter` | Main menu shown (first load or return from a match) | ui |
| `menu.click` | Any main-menu item that opens a section or overlay (Single-player, Multiplayer, Credits, API reference, Designer, and the Designer / Docs buttons in game) | ui |
| `menu.back` | Browser/on-screen Back | ui |
| `music.mute` / `music.unmute` | Music toggle | ui |

## 2. Lobby and match lifecycle

| Tag | Trigger | Source |
|---|---|---|
| `lobby.join` | You enter a room (`welcome` with `lobby`) | msg |
| `lobby.player_joined` | Another player appears in `lobby.players` | msg |
| `lobby.player_left` | A player disappears from `lobby.players` | msg |
| `lobby.host_changed` | `hostId` changes | msg |
| `lobby.invite_copied` | Invite link copied | ui |
| `lobby.ready` | Enough players, Start becomes enabled | msg |
| `match.countdown` | Pre-start countdown tick (if added) | new |
| `match.start` | `started` received | msg |
| `match.pause` / `match.resume` | `pause` received / cleared | msg |
| `match.player_away` | A player disconnects, reconnect timer starts | msg |
| `match.player_back` | A player reconnects | msg |
| `match.victory` | `matchOver` and you (or your side) won | msg |
| `match.defeat` | `defeated` received, or `matchOver` and you lost | msg |
| `match.draw_or_over` | `matchOver` for a spectator | msg |
| `match.forfeit` | You confirm Resign | ui |
| `match.spectate` | You switch to the spectator view | ui |
| `match.leave` | You leave to the menu | ui |
| `match.standings` | Standings screen appears | ui |

## 3. In-game interface (feedback to the player's own input)

| Tag | Trigger | Source |
|---|---|---|
| `select.unit` | Single click selects one of your units | ui |
| `select.units` | Box/band select of several | ui |
| `select.building` | Select a building | ui |
| `select.deselect` | Selection cleared | ui |
| `select.group_assign` / `select.group_recall` | Ctrl+N / N control groups | ui |
| `order.move` | Move order issued | ui |
| `order.attack` | Attack order issued | ui |
| `order.harvest` | Harvest order | ui |
| `order.repair` | Repair order | ui |
| `order.supply` | Supply energy order | ui |
| `order.charge` | Charge / dock order | ui |
| `order.stop` | Stop | ui |
| `order.queue` | Order added with the queue modifier | ui |
| `order.invalid` | Order rejected (nothing selected, wrong target) | ui |
| `order.acknowledge` | Generic fallback for any order | ui |
| `build.menu_open` / `build.menu_close` | Build bar opens/closes | ui |
| `build.choose` | Building blueprint picked from the bar | ui |
| `build.place` | Site placed (`place` sent) | ui |
| `build.place_invalid` | Placement refused (fog, blocked, no funds) | ui |
| `build.cancel_placement` | Placement ghost cancelled | ui |
| `build.demolish` | Demolish / cancel site confirmed | ui |
| `produce.queue` | Unit queued at a factory | ui |
| `produce.rejected` | Not enough credits / cap reached | ui |
| `module.on` / `module.off` | Module switched | ui |
| `action.hotkey` | Action grid button pressed | ui |
| `camera.pan_edge` | Optional: map edge reached | ui |
| `camera.zoom` | Optional: zoom step | ui |
| `ui.minimap_click` | Minimap jump | ui |
| `ui.power_overlay` | Power meter hover/overlay toggled | ui |
| `ui.designer_save` / `ui.designer_run` / `ui.designer_error` | Designer compile/save/test results (`programResult`) | msg |
| `ui.design_upload` / `ui.design_download` / `ui.design_reset` | Design file actions (`designsLoaded`) | msg |

## 4. World sound effects (positional, so should be attenuated by distance and only heard when visible)

### Combat (existing `SimEvent`)
| Tag | Trigger | Source |
|---|---|---|
| `combat.shot` | Generic weapon fire (`SimEvent.Shot`) | sim |
| `combat.shot.gun` / `combat.shot.cannon` / `combat.shot.laser` / `combat.shot.missile` / `combat.shot.flak` | Per weapon kind (a tesla discharge uses `combat.tesla`; the missile tag plays at the launch, the burst is a normal death) | sim (kind from the shooter's class) |
| `combat.tesla` | Tesla discharge (`SimEvent.Pulse`) | sim |
| `combat.repair` | Repair beam running (`SimEvent.Repair`, every 2 ticks: loop or throttle) | sim |
| `combat.hit` | Projectile impact on a unit | new |
| `combat.hit_building` | Impact on a building | new |
| `combat.miss` | Optional shot that missed | new |
| `combat.shield_hit` | Optional, if shields exist | new |
| `combat.damage_critical` | Unit/building drops below ~25% | new |

### Destruction (`SimEvent.Death`)
| Tag | Trigger | Source |
|---|---|---|
| `death.unit` | Any unit destroyed | sim |
| `death.unit_small` / `death.unit_large` | By size or class | sim (size from blueprint) |
| `death.unit_air` | Flying unit crashes | sim |
| `death.building` | Building destroyed | sim |
| `death.building_large` | Big building / construction tower / silo | sim |
| `death.own` / `death.enemy` | Variant by whose it was (for mixing or announcer) | sim |

### Units and buildings
| Tag | Trigger | Source |
|---|---|---|
| `unit.spawn` | Unit produced and leaves the factory | sim |
| `unit.move_loop` / `unit.move_loop.ground` / `unit.move_loop.air` / `unit.move_loop.heavy` | Engine loop while moving; the general tag is the fallback for the classes | sim |
| `unit.stop` | Unit comes to rest (optional) | sim |
| `unit.harvest` | Harvesting in progress / resource gathered | sim |
| `unit.deposit` | Cargo dropped at a silo / dock | sim |
| `unit.charge` | Starts charging at a pad | sim |
| `unit.charged` | Fully charged | sim |
| `unit.flat` | Unit ran out of energy | sim |
| `unit.revived` | Flat unit supplied and restarts | sim |
| `unit.supply` | Energy handed to another unit | sim |
| `unit.cpu_offline` | Class has no working program | sim |
| `building.construction_start` | Site begins | sim |
| `building.construction_loop` | Builders working (throttled) | sim |
| `building.complete` | Construction finishes | sim |
| `building.demolished` | Refund on demolish | sim |
| `building.silo_fill` / `building.silo_full` | Credits at capacity | msg `credits` |
| `building.turret_turn` | Optional | sim |
| `building.radar_ping` | Own or allied radar pulse (`radar` message) | msg |
| `building.radar_contact` | Pulse found enemy contacts | msg |
| `building.link_connected` / `building.link_broken` | Power antenna/bridge forms or drops | msg `networks` |

### Power and economy alerts (global, not positional)
| Tag | Trigger | Source |
|---|---|---|
| `alert.low_power` | Network supply below demand | msg `networks` |
| `alert.power_restored` | Back in surplus | msg `networks` |
| `alert.power_out` | Zero stored and zero supply | msg `networks` |
| `alert.low_credits` | Credits fall under a threshold | msg `credits` |
| `alert.credits_gained` | Optional harvest delivery tick | msg `credits` |

### Threat and awareness (global, rate-limited)
| Tag | Trigger | Source |
|---|---|---|
| `alert.under_attack` | Own unit/building takes damage (cooldown ~10 s) | new |
| `alert.base_under_attack` | Own building damaged | new |
| `alert.enemy_spotted` | First sight of an enemy in the fog | new |
| `alert.unit_lost` | Own unit destroyed | sim |
| `alert.building_lost` | Own building destroyed | sim |
| `alert.unit_cap` | Unit limit reached | new |
| `alert.score_change` | Optional, scoreboard update | msg |

## 5. Ambience and music stings

| Tag | Trigger | Source |
|---|---|---|
| `ambient.menu` | Looping bed on the menu | ui |
| `ambient.battlefield` | Looping bed in a match | ui |
| `ambient.wind` | Optional, wind is seeded in the world | sim |
| `ambient.combat` | Fades in when music context becomes `combat` | ui (`music.ts`) |
| `sting.victory` / `sting.defeat` | Short music stings accompanying `match.victory`/`match.defeat` | msg |

Background music stays with the existing `music.ts` track list and is not part of this manifest.

## Implementation notes

- **Low overhead:** all resolution happens once, when the manifest loads. Each tag is flattened into a plain array of ready sounds (own sounds + references + parent-tag fallback, de-duplicated) and stored in a `Map<string, Sound[]>` (or an object keyed by tag id). Triggering is one lookup, one `Math.random()` index and one play call, with no string splitting or manifest walking at event time. Tags with no sound at all resolve to an empty array, so an unused event costs a single failed lookup. Audio files are decoded once into `AudioBuffer`s (Web Audio) on first use or idle preload and reused, so repeated plays don't make new elements.
- **Random pick:** uniform over the flattened array. When it has more than one entry, skip the one played last for that tag.
- **Fallback chain:** `combat.shot.laser` -> `combat.shot`; `ui.confirm` -> `ui` (flattened at load by trimming trailing `.segments`). Cross-group fallbacks such as `ui.cancel` -> `ui.click` are expressed with a reference entry instead.
- **Entry fields worth supporting:** `volume` (0..1), `pitchVariance` (e.g. 0.05), `cooldownMs` (per tag, stops machine-gun spam), `maxVoices` (per tag), `loop` (for `*_loop` tags), `positional` (default true for sections 4; false for UI/alerts).
- **Sim events:** none were added. The "new" rows are worked out client-side from component changes (hit points down = hit, a new unit or construction site = spawn / start, a site marker removed = complete); only the movement and charging loops would need the server to say more.
- **Browser audio:** nothing can play before the first user gesture (`music.ts` already handles this); the sound player has its own gate, follows the music mute button and has a separate effects volume.
- **Existing sound:** `UI Authorised` fits `ui.confirm` / `match.start`.

## Status

The player, the server endpoints and the hooks below are in place; the manifest lists every tag below as an empty entry (`{ "tag": "...", "use": [] }`) so sounds can be added a tag at a time. `packages/client/test/soundmanifest.test.ts` fails if the client plays a tag the manifest does not list.

How the tags that are not obvious are triggered:

- **UI:** any button plays `ui.click` unless it has `data-sound="tag"`; hover, select/radio change, checkbox, slider and typing have their own tags (`uiSounds.ts`). Module switches use `module.on` / `module.off`.
- **Orders:** from the right-click or action grid; `order.queue` replaces the specific tag when queued. `order.invalid` is a right-click with nothing selected.
- **Credits:** `alert.credits_gained` on any increase, `building.silo_fill` when the pool first passes 75% of capacity, `building.silo_full` at capacity, `alert.low_credits` when it drops under 50.
- **Power:** `alert.low_power` when demand exceeds what was delivered, `alert.power_out` when there is no supply and no stored energy, `alert.power_restored` when either clears; `building.link_connected` / `building.link_broken` when the number of grids falls or rises without buildings being added or lost.
- **Deaths:** the most specific of `death.building_large` (footprint 3+), `death.building`, `death.unit_air`, `death.unit_large` (150+ hit points), `death.unit_small`, plus `death.own` or `death.enemy`; an empty specific tag falls back to its parent (`death.unit_small` to `death.unit`).
- **Unit states** (own units only): `unit.harvest` / `unit.deposit` from cargo changes, `unit.charged` at 100% energy, `unit.flat`, `unit.revived`, `unit.cpu_offline` from the processor state.
- **Constructed things:** `unit.spawn` and `building.construction_start` for own units and sites, `building.complete` when a site finishes, `building.demolished` when an own building vanishes without dying.
- **Ambient:** `ambient.menu` loops on the menu, `ambient.battlefield` in a match and `ambient.combat` on top of it while a fight is in view (give those sounds `"loop": true`).
- **Positional** tags (`combat`, `death`, `unit`, `building` groups) are heard only near the view; set `"positional": false` on a tag entry to change that.

Not hooked to anything yet (the entries exist but nothing plays them): `ui.notify`, `ui.tab`, `ui.panel_open`, `music.mute` (muting silences it), `match.countdown`, `camera.pan_edge`, `ui.minimap_click` (there is no minimap), `combat.miss`, `combat.shield_hit` (neither exists in the game), `unit.move_loop` and its `.ground` / `.air` / `.heavy` variants, `unit.stop`, `unit.charge`, `unit.supply`, `building.construction_loop`, `building.turret_turn`, `alert.score_change`, `ambient.wind`. The loops need per-entity start and stop tracking, and several need the server to say more (movement is not replicated, nor who supplied whom).
