# Working with several agents

Several LLM instances may work in this repo at the same time. To avoid collisions:

1. **Read first**: `TODO.md` (open actions), `PLAN.md` (planned work and decisions), the top of `PROGRESS.md` (recent changes), and `git status` / `git diff` for uncommitted work by someone else. Treat uncommitted changes you did not make as in progress: do not revert or reformat them.
2. **Claim your area**: add a line under "Active work" below before starting (who/what, the files or packages you will touch), and remove it when done. Pick work that does not overlap with another line; if it does, do something else or ask the user.
3. **Stay in your files**. Shared hot spots (`lobby.ts`, `style.css`, `main.ts`, `rules.ts`, `simulation.ts`) get small, focused edits: re-read the file right before editing it, and never rewrite a whole file.
4. **Do not touch** another checkout's `node_modules`, and do not stop dev servers the user is running (ask first).
5. **Record your work** (and add a dated entry with a short summary to `packages/client/src/changelog.md` for anything players will notice; follow "Player-facing changelog" below for format and tone): planned future steps go in `PLAN.md`; things only the user can check go in `TODO.md`; every change goes in `PROGRESS.md` under today's date (newest first).
6. **Verify**: `npm test` and `npm run typecheck` must pass before you finish. Say plainly what was not run or not looked at in a browser.
7. Do not commit or push unless the user asks.
8. **UI work follows `STYLE.md`**: the visual and interaction intent (panels, colours, motion, sound, reduce motion, dev-only features). Read it before adding or changing any screen, and update it when you set a new convention.

## Player-facing changelog (`packages/client/src/changelog.md`)

This file feeds News and Updates on the main menu. You are the game's community manager here: write for players, not developers. Rule 5 says when to add an entry; this is how.

**Format** (parsed by `packages/client/src/changelog.ts`; entries with no `- ` lines are dropped):

```
## 2026-10-24
### Short headline
One or two sentence summary of the day.
- One line per change a player would notice.
```

- Newest date first. If today's date already has a section, add your bullets to it instead of starting a second one.
- **Regenerate the summary** (and the headline, if it no longer fits) every time you add to an existing day, so it covers all the bullets and reads as one piece. Do not just append a sentence.
- Bullets and summary use player words: units, buildings, the designer, matches. No file names, function names, package names or internals. Say what changed for the player, not how.
- Skip changes nobody would notice (refactors, tests, docs, internal tooling).

**Tone:**

- **Positive and upbeat**, like a community manager announcing news for a game they love. Be enthusiastic about new and improved things; say what players can now do and why it is fun. Keep it genuine and specific, not generic hype: no walls of exclamation marks, no empty superlatives.
- **Bug fixes** are good news. Describe them in a positive light: what now works smoothly (for example "Orders now always get through, even under heavy fire"), not what used to be broken or whose fault it was.
- **Breaking or disruptive changes** (saved designs or programs that stop working, changed controls or hotkeys, rebalanced units, anything that needs the player to act) get a cautious, careful tone: say plainly what is different, who is affected and what to do about it, and be considerate rather than cheerful. Keep the rest of the day's summary friendly, but do not gloss over the change.
- Never promise future features or dates. Do not claim something works if it has not been checked (see rule 6); keep the summary to what shipped.

## Performance goals

- **The server tick is 10 Hz: a tick has 100 ms**, shared by every match on the process. The engine should use a small fraction of that (about 2 ms mean for a 256-unit-a-side match today; see `REVIEW.md`). `packages/engine/test/perf.test.ts` holds the budgets and runs with `npm test`: a change that fails it is a regression, not a flaky test. Do not loosen a budget to make a change pass; fix the change, or say why in `PROGRESS.md`.
- **Hot paths** are anything that runs per unit, per tick or per frame: `systems.ts`, `simulation.ts`, the flow VM (`flow/run.ts`), pathfinding, the sensors, and the client `renderer.ts`. Keep them allocation-light: no new arrays, objects, closures, `Map`s or string building per unit per tick; reuse buffers and the existing side tables. Prefer typed arrays and index loops there.
- **Work must scale with what changed, not with map size or unit count squared.** No all-pairs scans (use the existing spatial lookups), no whole-map sweeps per tick, no path search per unit per tick (path planning cost is an open item in `REVIEW.md`; do not make it worse).
- **Player programs are untrusted and metered.** They run under a CPU budget and must never be able to stall or crash the tick. Never add a script API call, event or loop with unbounded cost; give it a cycle cost and a cap, and keep the sandbox and the checker in step.
- **Network:** send deltas and compact forms (as `Terrain.encode()` and the snapshots do), not full state per tick. Anything big sent once (map, definitions) must not be re-sent per tick.
- **Client:** 60 fps on an ordinary laptop with a big match. Do not rebuild Pixi objects, textures or `Text` per frame; update existing ones. Menu code may be simple, but must not run timers or animations while hidden or when Reduce motion is on (see `STYLE.md`).
- **Measure before and after** any change that claims to be faster, and say the numbers in `PROGRESS.md`. Do not add speculative optimisations without a measurement.

## What to avoid

- **Breaking determinism.** The simulation is server-authoritative and replayable from a seed: no `Math.random`, `Date.now` or iteration over unordered data in engine code. Use the simulation's `Rng` and tick counter. Any change to the order random numbers are drawn in changes every generated map; if that is unavoidable, say so in `PROGRESS.md`.
- **Trusting the client or a player's files.** Validate everything that arrives over the socket or HTTP (sizes, ids, ranges) and uploaded designs and programs. A crafted message must not crash the server or other players' matches. New endpoints and messages get a size and rate limit.
- **Whole-file rewrites and reformatting** of shared files; drive-by refactors; renaming exports others use. Keep diffs small and on topic.
- **New dependencies.** Versions are pinned and the project is deliberately small; prefer a few lines of code. If one is truly needed, pin the exact version and record why in `PROGRESS.md`.
- **Bash heredocs for source files** (backslashes and quotes get mangled): use the Write/Edit tools. On Windows, mind CRLF: keep each file's existing line endings.
- **Hiding failures.** Do not skip, delete or weaken tests, add `@ts-ignore`/`any` to get green, or catch and swallow errors in the engine. Known failing cases live in `engine/test/known-bugs.test.ts` as expected failures; leave them for whoever owns the fix.
- **Putting game rules in the client**, or UI code in the engine. The engine is shared by both and has no DOM or Node globals.
- **Claiming unseen things work.** If you did not look at it in a browser, say so (rule 6) and add the check to `TODO.md`.

## Active work







Note from A1 (2026-10-24, released): S2-S4 and M6 are done. `path.ts`, `planPath` and `Terrain` (now with `Mobility`, `fits`, `nearestFit`) are free, so review items 4-5 in `PLAN.md` can be claimed; keep `findPath(..., m)` respecting mobility and the squeeze-out rule (tests in `engine/test/tiers.test.ts`).
