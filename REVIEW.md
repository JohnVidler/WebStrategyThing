# Code review: open actions

Compacted 2026-10-27. The reviews of 2026-10-18 and 2026-10-24 (security pass S1 to S17, engine and flow pass, correctness, performance and architecture passes) are in git with all their reproductions and fix notes: `git show b449816:REVIEW.md`. Tick an item when fixed and log it in `PROGRESS.md`.

## Done (for reference, nothing to do)

S1 to S3 server crashes, S4 budgets and rate limits, S5 class cap, S6 HTML escaping (with `client/test/html.test.ts`); stored-program nesting and stack depth, Visitor chains on entity 0, orders lost to a full event queue, Button hotkeys on the server compile path; path planning floods and group-order stalls; capped power bridges, bridge cap on total flow, `lastHp` leaks, resign state, lobby `loadDesigns`, pause-panel invite link, `powerSystem` per-tick bucketing, Pixi text pooling, menu spark timer; power topology moved to `power.ts` and precomputed; `forfeit`/`leave` messages and one shared message allowlist; `removeForces`; UI handlers moved into `UiActions`. "Parallel antenna bridges lose capacity" was closed as not a bug (links form a spanning forest).

## Open actions

### Security and web hardening
- [ ] **S7** Add a Content-Security-Policy (test in a browser) and tighten the open CORS header on the room list. nginx already sends `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
- [ ] **S8** The reconnect token is in the WebSocket URL (low: 128 random bits, usable only in the 60 s grace). Send it as a first message or keep it out of access logs.
- [ ] **S9** Pin `tsx` and `ws` in the server package. (`@wst/engine: "*"` is the normal workspace link, not a problem.)
- [ ] **S10** Per-job permissions in the GitHub workflows.
- [ ] **S11** One name rule (`cleanName`) for players and classes.
- [ ] **S12** A short cache on the sound/music manifests.

### Consistency (S13 to S17)
- [ ] **S13** Per-frame allocations in `renderer.ts`.
- [ ] **S14** Health is tracked twice on the client (`lastHp` and `Health.hp`): goes away with `SimEvent.Damage` below.
- [ ] **S15** `esc()` is copied into ten files: one shared `client/src/util/html.ts` that also escapes `'`.
- [ ] **S16** Dead CPU-profile code (`requestCpuProfile`, `cpuLines`, `state.cpuProfiles`): show it in Dev Options or delete it.
- [ ] **S17** `Math.random` is used for the start corner; use the simulation `Rng` for determinism.

### Engine
- [ ] **Script-system hot paths** (small, per unit per tick; parked until a profile shows it matters, median tick is ~0.5 ms at 256 a side): cache `resolveSweep` per (handler, stats); resolve `configInt`/`configInts` once onto `CompiledHandler`; per-event filter functions instead of a closure per `raise`; `sensorSweep` allocation for `limit: 1, sort: NEAREST` (use `spatial.nearest`).
- [ ] **Path planning**: one shared search per command batch; build `freeMoveTile`'s taken set once per batch (22 ms to issue 256 orders).
- [ ] **Side tables** not reset when an index is reused: `chargeFlow` (cosmetic; `repairCarry` and `radarReady` are done). Clear in `destroyEntity` / `addCommon`.
- [ ] Add a comment on `SpatialGrid.rebuild` that the grid is rebuilt once at the start of `step()` (new units and missiles are missing until next tick; destroyed indices linger, callbacks check `has`).
- [ ] **Power transmission floor bug** (see `PLAN.md`, Open work 2): decision needed, then flip the test in `known-bugs.test.ts`.

### Server: match lifecycle (needs a design decision)
- [ ] Replace the `started`/`over` and `defeated`/`spectating`/`hadForces`/`away` booleans in `match.ts` with an explicit `phase: 'lobby' | 'running' | 'over'` and per-player `status: 'playing' | 'defeated' | 'spectating'`, with named transitions (`startMatch`, `defeat`, `spectate`). `messageAllowed` already centralises what a client may send.
- [ ] Detect natural elimination every running tick (a `defeat(player)` check) instead of inside `reportScoreboard` (every 5 ticks, not while paused); the scoreboard should only report.
- [ ] A "designs synced" marker from the server after `blueprints` and `program` messages (or programs inside `blueprints`), so `DesignStore` autosave cannot save too early; then drop the `programsLoaded` guess and the silent empty-program restore.

### Client
- [ ] **`SimEvent.Damage`** (victim, amount, visibility-filtered like Shot/Death/Pulse) replaces damage numbers inferred from `Health.hp` deltas, and removes the `lastHp` map. Needs an engine event, codec change and a play-test of damage numbers.
- [ ] One per-entity renderer record created in `ensureSprite` and destroyed in a single `removeEntity(e)` path (today `lastHp`, `blastRadius` and `powerLabels` are separate maps, cleaned up together but not unified).
- [ ] Per-bridge flow (`bridgeFlow` from `powerSystem`) in `NetworkInfo` so the link animation shows caps and saturation; today a capped bridge looks as busy as an uncapped one. Check by eye.
- [ ] Move `showPowerLabels` off `ClientState` (a small `ViewState` or a renderer setter). Low priority.
- [ ] `POWER_GOOD`/`POWER_BAD` in `renderer.ts` copy the `--good`/`--bad` CSS values by hand: read them from CSS or share one source.