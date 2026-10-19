# Code review

Findings from reviewing the uncommitted changes (2026-10-18), for later actioning. Tick an item when it is fixed, and log the fix in PROGRESS.md.

Status after the first fixing pass (2026-10-18): items marked **Done** are implemented and covered by `npm test` and `npm run typecheck`, but nothing was checked in a browser. **Partly done** and **Open** items need a design decision or a play-test. One item was **Closed** as not a bug.

## Correctness and performance pass

Most severe first.

### Correctness

- [x] **Capped bridges strand a cluster's own supply.** [`engine/src/game/power.ts:163`](packages/engine/src/game/power.ts#L163) `routeEnergy`
  - Problem: per-cluster targets are split as if bridges had no cap, and supply that can't cross a bridge is never given back.
  - Example: cluster A makes 100 and wants 100. Cluster B makes 0 and wants 100, behind a bridge capped at 10. Targets come out [50, 50], so A serves itself 50, sends 10 to B and leaves 40 unused (it goes to charging, or is wasted). `systems.ts:78` then drains discharge storage to cover A's shortfall. Adding one capped outpost link roughly halves the base's own power.
  - Fix: after the first pass, give unused supply back to its own cluster (or iterate until no capacity is left), so capped targets are honoured before redistributing.
  - **Done (2026-10-18):** `routeEnergy` now gives each cluster its proportional share first, then a cleanup pass lets clusters still short take idle energy from their own cluster before others. In the example the base keeps 90 and the outpost gets the 10 the bridge can carry. Tests: `engine/test/power.test.ts`.

- [x] **`lastHp` is never cleared, so fake damage numbers appear.** [`client/src/renderer.ts:406`](packages/client/src/renderer.ts#L406)
  - Problem: entries survive despawn (fog or interest drop), entity id reuse, and full snapshots.
  - Example: an enemy leaves vision, takes 40 damage elsewhere, comes back into view, and a "40" pops up. The same happens to every damaged entity when a defeated player clicks Spectate (`info.full` clears sprites but not `lastHp`). A reused id with lower HP than the previous entity also shows a fake hit. `blastRadius` leaks the same way for entities that despawn without a Death event.
  - Fix: delete `lastHp`/`blastRadius` entries wherever a sprite is removed, and clear both maps on a full snapshot.
  - **Done (2026-10-18):** `lastHp` is cleared when a sprite despawns and on full snapshots; `blastRadius` likewise (kept for entities with a Death event this tick). The `SimEvent.Damage` rewrite below is still open.

- [x] **Resign can leave a player neither defeated nor playing.** [`server/src/match.ts:604`](packages/server/src/match.ts#L604)
  - Problem: a forfeit only takes effect once `reportScoreboard` marks the player defeated, which needs `hadForces` set and a tick where `tick % 5 === 0`.
  - Example: a player resigns within 5 ticks of joining, or while the game is paused on a tick that isn't a multiple of 5. They are never marked defeated, Resign just forfeits again, Spectate is refused, and closing the tab sets them to `away`, which pauses the match for everyone for the full reconnect grace period.
  - Fix: mark the player defeated (and send `defeated`) directly in the forfeit handler.
  - **Done (2026-10-18):** `forfeit` marks the player defeated synchronously (`defeat()`), so closing the tab can no longer start a reconnect wait. Natural elimination is still noticed at scoreboard cadence (see the defeat item below). Test: `a forfeit defeats the player at once…`.

- [x] **`loadDesigns` is silently dropped in the lobby.** [`server/src/match.ts:650`](packages/server/src/match.ts#L650)
  - Problem: before the match starts, the server ignores every message except `setName`/`startGame`/`spectate`, and replies with nothing.
  - Example: in the waiting room the player uses "Upload designs" or "Reset designs to defaults…". The client turns off autosave and waits for `designsLoaded`, which never arrives. The upload is lost without notice, and autosave stays off.
  - Fix: accept `loadDesigns` in the lobby (the designs apply at start), or reply with an error and have the client restore autosave.
  - **Done (2026-10-18):** The server answers a `loadDesigns` it can't apply (lobby or spectating) with a `designsLoaded` that carries an error, so the client's store recovers. Applying uploads made in the lobby once the match starts is not done: the message is refused, not queued. Test: `lobby designs`.

- [x] **The pause panel's invite link can no longer be reached.** [`client/src/ui.ts:136`](packages/client/src/ui.ts#L136)
  - Problem: `main.ts` no longer passes `inviteUrl` to `showPause`, so the `inviteHtml` branch is dead code.
  - Example: in versus, the opponent leaves for good and the game pauses "Waiting for another player". The copyable invite link that used to appear is gone, and late joiners can't be invited from that screen.
  - Fix: decide whether this is intended. If so, delete the parameter and branch. If not, pass the URL again for a paused match that is waiting for a player.
  - **Done (2026-10-18):** Intentional or not, it was a regression: the pause panel offers the invite link again whenever the pause reason is "Waiting for another player" (the old `tick === 0` condition is gone, since the waiting room now covers the pre-start case). Needs a look in a browser.

- [x] **The bridge cap is enforced on net flow, not total flow.** [`engine/src/game/power.ts:199`](packages/engine/src/game/power.ts#L199)
  - Problem: free capacity is computed from the signed net flow, so a later pass can push more than the cap back the other way. The docs say "at most cap in total, both ways".
  - Example: cap 20. Pass 1 sends 20 a→b (`used = +20`). The charging pass sees 40 free b→a and moves 40, so 60 crosses a bridge meant to carry 20.
  - Fix: track absolute usage per bridge, or reword the docs to say "net".
  - **Done (2026-10-18):** Bridge usage is now counted as total flow in both directions (`used[bi] += free`), matching the documented cap. Test: `counts flow in both directions against the same cap`.

### Performance

- [x] **`powerSystem` does O(K·n + n²) work per tick.** [`engine/src/game/systems.ts:99`](packages/engine/src/game/systems.ts#L99)
  - Problem: `normal.filter` runs for each cluster with `normal.indexOf` inside the map, and the same is done for `charging` and `gen`, every tick, for every network.
  - Fix: bucket member indices by cluster once per network (keeping each member's index), or cache the buckets on the network in `rebuildNetworks`.
  - **Done (2026-10-18):** Members are bucketed per cluster once per tick with a single pass (`bucket()`), and generators come from the precomputed `byCluster`. No `filter`/`indexOf` inside loops any more.

- [x] **Pixi `Text` textures are regenerated on the hot path.** [`client/src/renderer.ts:509`](packages/client/src/renderer.ts#L509)
  - Problem: `drawPowerLabels` assigns `label.style.fill` every frame for every label, which forces a texture regeneration. `spawnDamageNumber` creates and destroys a canvas-backed `Text` for every hit.
  - Fix: set `fill`/`text` only when they change. Pool the damage numbers, or switch both to `BitmapText`.
  - **Done (2026-10-18):** Power-label fill is set only when it changes (tracked in a `WeakMap`); damage-number `Text` objects are pooled (up to 64). `BitmapText` was not used; revisit only if profiling shows it matters.

- [x] **The menu spark timer keeps running during matches.** [`client/src/menuBackground.ts:89`](packages/client/src/menuBackground.ts#L89)
  - Problem: `spawn()` reschedules itself every 80–220 ms forever and only checks `host.hidden`, so it fires about 5–12 times a second for the whole session.
  - Fix: stop the timer while the backdrop is hidden and restart it from the existing `MutationObserver`.
  - **Done (2026-10-18):** The spark timer stops while the backdrop or tab is hidden and is restarted from the `MutationObserver` / `visibilitychange`.

## Architecture pass

These are structural issues: where the new code doesn't fit the existing patterns, or where state and rules are split or duplicated. Several are the root cause of a bug above, so fixing the structure fixes the bug too. Rough priority order.

### Engine: power routing

- [x] **The bridge "tree" assumption isn't enforced, so parallel or looping antenna links lose capacity.** [`engine/src/game/simulation.ts:1138`](packages/engine/src/game/simulation.ts#L1138), [`power.ts:153`](packages/engine/src/game/power.ts#L153)
  - `routeEnergy` is documented as working on a tree, but `rebuildNetworks` pushes every long link between two different clusters. Two pylons both linking the same pair of clusters create two bridges between them. The BFS in `routeEnergy` skips any cluster it has already reached, so the second bridge's capacity is never used. Loops (A–B, B–C, C–A) are also only ever routed along the BFS tree.
  - Fix: merge parallel bridges in `rebuildNetworks` (sum their caps, keyed by the sorted cluster pair). Then either accept that loops are under-used and document it, or route over a spanning tree on purpose. Add a test with two antenna pylons between the same two clusters.
  - **Closed (2026-10-18):** Not a bug. `powerLinks` returns a minimum spanning forest, so contracting each cluster leaves a tree: two clusters never share two long links and there are no loops. The invariant is now documented on `PowerTopology`. No code change needed.

- [x] **Cluster/bridge topology is built inside `Simulation`, not next to the other topology helpers in `power.ts`.** [`simulation.ts:1089-1140`](packages/engine/src/game/simulation.ts#L1089)
  - `powerNetworks`, `powerLinks` and `gap` are pure functions in `power.ts` with their own tests. The new union-find, cluster numbering and bridge extraction are inlined into `rebuildNetworks`, and the `PowerNetwork` object literal there now has 12 fields.
  - Fix: add a pure `powerClusters(nodes, links, throughputOf)` to `power.ts` that returns `{ clusterOf, clusters, bridges }`, plus an `emptyNetwork()` factory. That makes the parallel-bridge case above unit-testable without a full `Simulation`.
  - **Done (2026-10-18):** New pure `powerTopology()` and `emptyNetwork()` in `power.ts`; `rebuildNetworks` is now a short caller.

- [x] **Static topology is recomputed on every tick.** [`power.ts:164-188`](packages/engine/src/game/power.ts#L164), [`systems.ts:68-119`](packages/engine/src/game/systems.ts#L68)
  - `routeEnergy` rebuilds the adjacency list and a BFS order for every target cluster on each call. It is called three times per network per tick. `powerSystem` also re-buckets members by cluster with `filter` and `indexOf`, which is perf finding 1 above. All of this only changes when `powerDirty` triggers a rebuild.
  - Fix: compute adjacency, per-cluster BFS order and parent bridges, and member-to-cluster buckets once in `rebuildNetworks`, and store them on `PowerNetwork`. `routeEnergy` then takes that precomputed routing table.
  - **Done (2026-10-18):** Adjacency, per-cluster BFS routes (`PowerRoute`) and member buckets are built once in `powerTopology` and stored on the network; `routeEnergy` just reads them.

- [ ] **The flow animation and the hover labels disagree with the capped model.** (Already noted in PROGRESS.md as "not changed".)
  - `NetworkInfo.flow` is per building. The link-dot animation still infers per-link flow from it, so a capped bridge looks as busy as an uncapped one. Consider sending per-bridge flow (`bridgeFlow` already exists in `powerSystem`) in `NetworkInfo`, so the client can show caps and saturation.
  - **Open (2026-10-18):** Needs the client link animation changed and checked by eye. Suggested: add per-bridge flow (`bridgeFlow` in `powerSystem`) to `NetworkInfo`.

### Server: match lifecycle

- [ ] **Match and player phases are spread across independent booleans.** [`server/src/match.ts`](packages/server/src/match.ts)
  - The match uses `started` and `over`. Each player uses `defeated`, `spectating` and `hadForces`, plus whether they're in the `away` map. The legal combinations are re-derived separately in `handle()` (allowlist gate), `resign()`, `leave()`, the `spectate` case, `pauseReasons` and `reportScoreboard`. Each new feature adds another boolean and another gate.
  - Fix: use an explicit `phase: 'lobby' | 'running' | 'over'` on the match and `status: 'playing' | 'defeated' | 'spectating'` on the player. Put transitions in named methods (`startMatch`, `defeat(player)`, `spectate(player)`), and drive each gate from a small table.
  - **Partly done (2026-10-18):** Partly: what a client may send is now one `ClientPhase` rule (`messageAllowed`), and the server computes the phase in one place. The match/player booleans themselves (`started`/`over`, `defeated`/`spectating`/`hadForces`) are still separate; replacing them with explicit states is a larger refactor of `match.ts`.

- [ ] **Defeat is detected as a side effect of the scoreboard report.** [`match.ts:494-497`](packages/server/src/match.ts#L494)
  - `reportScoreboard` is a throttled broadcast (it runs every 5 ticks and not while paused), but it now also changes game state (`p.defeated = true`) and sends `defeated`. This is the root cause of correctness finding 3 (resign limbo).
  - Fix: move elimination detection into the tick, or into a `defeat(player)` transition called from the `forfeit` command and from an elimination check that runs every running tick. The scoreboard should then only report.
  - **Partly done (2026-10-18):** Partly: forfeits go through `defeat()` immediately, and the scoreboard loop calls the same method. Detecting a natural elimination is still done inside `reportScoreboard` (every 5 ticks); move it into its own per-tick check if the delay matters.

- [x] **The "remove a side's forces" logic is duplicated, and differs for co-op.** [`match.ts:604-623`](packages/server/src/match.ts#L604)
  - `forfeit` and `leave` both loop over units and call `destroyEntity`. `leave` also removes the player's co-op bot and its teams/cheater entries, but `forfeit` doesn't. So a co-op player who resigns leaves their bot fighting on until they actually leave the room. That may be intended, but nothing says so.
  - Fix: add one `sim.removeForces(owner)` (or `eliminate(owner)`) in the engine, next to `destroyEntity`. Decide explicitly whether forfeiting in co-op also removes the bot.
  - **Done (2026-10-18):** New `removeForces(...owners)` used by both. The co-op difference is deliberate and now documented on `forfeit()`: the bot stays, and the bots win once every human is out.

- [x] **The same rules are written in two places.** [`match.ts:155-164`](packages/server/src/match.ts#L155), [`match.ts:379`](packages/server/src/match.ts#L379), [`match.ts:426`](packages/server/src/match.ts#L426)
  - Host: the `host` getter (lowest id in `players`) and `reportLobby` (`players[0]` after sorting) work it out separately.
  - Minimum players: the `minPlayers` getter vs `const needed = this.botted ? 1 : 2` in `pauseReasons`.
  - Fix: use the getters everywhere.
  - **Done (2026-10-18):** `lobbyMessage()` uses the `host` getter, and `pauseReasons` uses `minPlayers`.

- [x] **`sendWelcome` resets `lastLobby` as a hidden side effect.** [`match.ts:243`](packages/server/src/match.ts#L243)
  - It forces a lobby re-broadcast to everyone whenever anyone is welcomed, including a spectator mid-match, when the lobby is irrelevant. It works, but it's coupling through a cache field.
  - Fix: send the lobby message directly to the welcomed player when `!started`.
  - **Done (2026-10-18):** `sendWelcome` sends `lobbyMessage()` directly to the welcomed player when the match hasn't started; the cache field is no longer reset.

### Protocol: shared rules between client and server

- [x] **`resign` means two different things.** [`engine/src/net/protocol.ts:24`](packages/engine/src/net/protocol.ts#L24)
  - It means "forfeit" while you have forces and "leave the room" otherwise, so the meaning depends on server state the client can only guess at. The client tracks its own `defeated` flag in `main.ts` to predict which one will happen. This also makes Resign → Leave a two-step dance that races with the 5-tick defeat detection.
  - Fix: split it into `forfeit` and `leave` messages. (Keep `resign` as an alias for a release if old clients matter.)
  - **Done (2026-10-18):** Added `forfeit` and `leave` messages; the client sends those (so it no longer has to predict). `resign` remains as a legacy alias on the server (forfeit if possible, otherwise leave); it can be removed once old clients are gone.

- [x] **The spectator/lobby message allowlist is written twice, and the two copies differ.** [`client/src/main.ts:37`](packages/client/src/main.ts#L37), [`server/src/match.ts:650`](packages/server/src/match.ts#L650)
  - The client lets `resign`/`setName` through. The server lets `setName`/`startGame`/`spectate` through (and handles `resign` elsewhere). The lobby case has the same split, which is why `loadDesigns` falls through the gap (correctness finding 4).
  - Fix: export one `allowedWhile(phase, status): ReadonlySet<ClientMessage['t']>` (or a constant per state) from `protocol.ts`, and use it on both sides.
  - **Done (2026-10-18):** One `messageAllowed(phase, t)` in `net/protocol.ts`, used by the server's `handle()` and the client's `send`.

- [x] **`lobby.mode` is typed as `string`.** [`protocol.ts:72`](packages/engine/src/net/protocol.ts#L72)
  - The server has a `GameMode` type (`parseGameMode`), but the client compares `lobby.mode === 'coop'` against a bare string. Use the shared type.
  - **Done (2026-10-18):** `lobby.mode` is now `GameMode`.

### Client: state and UI wiring

- [ ] **Per-entity renderer state lives outside the sprite lifecycle.** [`client/src/renderer.ts:160-182`](packages/client/src/renderer.ts#L160)
  - `lastHp`, `blastRadius` and `powerLabels` are separate maps keyed by entity id, each with its own partial cleanup, and none of them is cleared on a full snapshot. This is the root cause of correctness finding 2.
  - Fix: keep one per-entity record (sprite plus derived visuals) created in `ensureSprite`, and destroy it in a single `removeEntity(e)` path. Clear it in the same place `info.full` clears sprites.
  - **Partly done (2026-10-18):** Partly: the maps are now cleaned up together where sprites are removed and on full snapshots. They are still separate maps rather than one per-entity record.

- [ ] **Damage numbers are guessed from health diffs, but deaths use engine events.** [`renderer.ts:399-411`](packages/client/src/renderer.ts#L399), [`engine/src/game/events.ts`](packages/engine/src/game/events.ts)
  - `SimEvent` already carries Shot, Death, Pulse and Repair, and the client handles them uniformly. Damage is instead inferred from `Health.hp` deltas, which misreads fog re-entry, id reuse and full snapshots as hits, and can't tell repair from regeneration. A `SimEvent.Damage` (victim, amount), filtered by visibility like the other events, would match the pattern and remove the `lastHp` map altogether. It costs a few bytes per hit on the wire.
  - **Open (2026-10-18):** Needs an engine event, codec and visibility-filtering change and a play-test of damage numbers; left for later.

- [x] **UI callbacks are wired inconsistently.** [`client/src/ui.ts:104`](packages/client/src/ui.ts#L104), [`ui.ts:160-219`](packages/client/src/ui.ts#L160)
  - `Ui` takes a handlers object in its constructor for every other action. The new panels take callbacks on each call instead (`showWaitingRoom(…, onStart, onLeave)`, `showDefeat(onSpectate, onLeave)`). `showStandings` has a default `leave` that navigates directly, duplicating `main.ts`'s `leave`.
  - The Power-tile hover listener is bound lazily inside the per-tick render (`envHoverBound` flag) rather than in the constructor.
  - Fix: add `startGame`, `spectate` and `leave` to the constructor handlers, drop the per-call parameters and the default, and bind the hover listener in the constructor.
  - **Done (2026-10-18):** `startGame`, `spectate` and `leave` are constructor handlers (`UiActions`); the per-call callbacks and the default navigating `leave` are gone; the Power-tile hover is bound in the constructor.

- [x] **The client's defeat/spectator state is split.** [`client/src/main.ts:139`](packages/client/src/main.ts#L139), [`client/src/state.ts:94`](packages/client/src/state.ts#L94)
  - `spectating` lives on `ClientState`, but `defeated` is a local `let` in `main.ts`, declared after the closure that reads it. Put both on `ClientState` (or one `status` field that mirrors the server's), next to `fog`.
  - **Done (2026-10-18):** `defeated` and `inLobby` now live on `ClientState` next to `spectating`.

- [ ] **View-only flags are stored on `ClientState`.** [`state.ts:90`](packages/client/src/state.ts#L90)
  - `ClientState` is described as the mirror of networked state, but `showPowerLabels` is a UI hover flag that the renderer polls. It's minor, but a small `ViewState` (or a renderer setter) keeps the mirror clean as more overlays are added.
  - **Open (2026-10-18):** Low priority; left alone. A `ViewState` or a renderer setter would do.

- [ ] **Constants are duplicated across files.** [`renderer.ts:61-62`](packages/client/src/renderer.ts#L61), [`menuBackground.ts:96`](packages/client/src/menuBackground.ts#L96)
  - `POWER_GOOD`/`POWER_BAD` copy the `--good`/`--bad` CSS values by hand. The two new Pixi text styles repeat the same font stack literal.
  - The spark code hard-codes `40000` ms to match `animation: menu-bg-drift 40s` in `style.css`, and nothing ties the two together. Pass the duration through a CSS custom property, or read it from `getAnimations()[0].effect.getTiming().duration`.
  - **Partly done (2026-10-18):** Partly: one `TEXT_FONT` constant, and the spark drift period is read from the running animation instead of a hard-coded 40 s. `POWER_GOOD`/`POWER_BAD` still mirror the CSS by hand.

- [ ] **The empty-program fix in `DesignStore` treats the symptom, not the cause.** [`client/src/designs.ts:251-258`](packages/client/src/designs.ts#L251), [`designs.ts:332`](packages/client/src/designs.ts#L332)
  - Autosave now guesses whether the server has finished sending programs (`programsLoaded`: any program present, or no CPU classes). It can still save too early if only some programs have arrived. The restore step then silently swaps any empty default-class program for the template.
  - Fix: have the server send an explicit "designs synced" marker after `blueprints` and `program` messages (or include programs in `blueprints` for the owner), and only autosave after it.
  - **Open (2026-10-18):** Needs a server-side "designs synced" marker (or programs sent with `blueprints`) and a browser check of save/restore; left for later.

### Docs drift

- [x] **The `menuBackground.ts` header and PROGRESS.md no longer describe the code.** [`menuBackground.ts:1-9`](packages/client/src/menuBackground.ts#L1), [`menuBackground.ts:70-78`](packages/client/src/menuBackground.ts#L70)
  - The header still says "no per-frame JavaScript" and that `display: none` stops the animation entirely. Both stopped being true when sparks were added.
  - PROGRESS.md says sparks spawn "every 2.5–6 s (max 3 alive)" at 160 px/s over 4–10 cells. The code spawns every 80–220 ms, max 30, at 180 px/s over 10–25 cells. Settle on the intended values and update both.
  - **Done (2026-10-18):** `menuBackground.ts` header rewritten to describe the sparks and the stopping timer; the PROGRESS.md spark entry now carries the code's real values (every 80–220 ms, up to 30 alive, 180 px/s, 10–25 cells). Pick different numbers by changing `menuBackground.ts`.
