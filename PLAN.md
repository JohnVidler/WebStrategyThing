# flowcode plan: event-driven visual and textual programming

Merged into `main`. Status: **M0-M6 done** (see section 12 and "What changed from the plan" below); M7 (polish) remains. Update this file as decisions change.

Decisions already made (section 14): automatic `Idle` event, configuration nodes visibly separate from actions, handlers suspend when out of cycles, literals use memory not energy, and the old text language is retired (removed; commit `8d2f1d5` and earlier still have it). Sections 1-11 are the original design, kept as the reference for how the language works; where the build differed, see "What changed from the plan".

## 1. Goals

1. Replace polling text scripts (the whole program reruns every pass, `sleep()` to idle) with **event-driven programs**: a unit does nothing, and pays nothing, until an event it handles arrives.
2. Let players program in **a node graph (Unreal Blueprint style) or in TypeScript-syntax text, and swap between them at will**, always in sync, from one underlying model.
3. **CPU cost = nodes executed + arcs traversed** by an event. An event with no handler costs nothing, with no special case.
4. Programs are **plain text**, so they fit the existing JSON paths: `setProgram` (`LIMITS.sourceLength`), design files, `localStorage` history, session storage.
5. The editor is built from **reusable, extensible components**, not hand-rolled DOM.
6. Designer split into two tabs: **Design** (class list, preview, stats, modules) and **Code** (full-panel editor, graph or text).

Non-goals for the first milestone: multiplayer-visible graphs, user-defined functions or subgraphs (but the model must not block them, see section 10), line-of-sight sensing (the sensor events are shaped so it can arrive later, section 4).

The old text language and VM are **removed**; every existing behaviour is rewritten in the new language (section 9).

## 2. Key decision: one model, two views

The graph and the text are both **projections of one canonical model, the Flow IR**. Neither view is the source of truth.

```
            edit                     edit
   Graph view ───►  Flow IR  ◄─── Text view (TypeScript subset)
   (Rete + Lit)  ◄───  (JSON)  ───►  (CodeMirror)
                       │
                       ▼ compile
              FlowProgram (flat tables)  ── run by the engine on server and client sandbox
```

- The IR is **structured**: no free-form `goto`. Control flow is nested statement lists, the same shape as the text. This is what makes the round trip lossless. A graph the player draws must be a structured graph (rules in section 5).
- The text is a **deterministic pretty-print of the IR** (a formatter, like Prettier). Parsing text gives back the same IR. Swapping views never changes meaning; it can only normalise formatting.
- **View-only data** (node x/y, collapsed groups, comment boxes, colours) lives in a `views` block beside the IR and is never needed to run the program. Text-only data (comments) is IR `comment` nodes so both views keep them.
- **Unfinished work** in the graph (orphan nodes, dangling wires) cannot be code. It is kept in `views.graph.scratch` and never compiled. Text edits that do not parse keep a `views.text.draft` buffer; the IR stays at the last good state and the graph view is read-only-with-banner until the text parses again.

### Stored form

One JSON string, versioned, in the existing `source` fields:

```json
{ "format": "wst-flow", "version": 1,
  "vars":     [ { "name": "target", "init": 0 } ],
  "handlers": [ { "event": "detected", "config": { "watch": [1, 2], "range": 6 }, "params": ["kind", "h"], "body": [ ...statements ] } ],
  "views":    { "graph": { "pos": { "<nodeId>": [x, y] }, "scratch": { ... } } } }
```

- Every statement and expression node has a stable string `id` (short, generated) so layout and diffs survive edits.
- Size: `LIMITS.sourceLength` is 32000 (was 8000) to fit graphs with layout; layout is stored compactly (integers, short ids), and `views` is stripped when sending to the server (the server only needs the logic; the owner's copy keeps views).
- Programs that are not `wst-flow` documents (the old text language) are replaced on load; see section 9.

## 3. The text language: a TypeScript subset

Looks like TypeScript, parses as TypeScript, and is checked against a strict subset. Players get real TS syntax highlighting and familiar code; nothing else from TS exists (no classes, closures, `any`, imports).

```ts
let target = -1;               // vars: memory slots, integers only (memorySlots stat)

// An event source block: the object is its configuration (fixed at upload, checked
// against the sensor's real limits). The program only sees the resulting events.
on(Detected, { watch: [ENEMY, RESOURCE], range: 6, interval: 5, sort: NEAREST, limit: 1 }, (kind, h) => {
  target = h;                  // event parameters become data output pins
  if (kind === ENEMY) fire(h); // fire(h) is an action: a statement with an exec pin
});

on(Order, { types: [MOVE] }, (type, x, y) => {   // other order types are dropped before they cost anything
  moveTo(x, y);
});

on(Idle, { interval: 10 }, () => {               // heartbeat every 10 ticks, only if nothing else is happening
  if (taskCount() > 0) {
    // ...
  }
});
```

### Mapping table (the contract between the two views)

| Text | IR node | Graph node |
|---|---|---|
| `on(Event, { ...config }, (a, b) => { ... })` (config optional) | `handler` with `config` | Event source block: its configuration fields shown on the block, exec out, one data out per parameter |
| `foo(args);` | `call` (statement) | Function node with exec in/out, data in per argument |
| `const v = foo(args);` | `call` with `result` binding | same node; its data out feeds later nodes |
| `let x = 0;` (top level) | `vars[]` | Variable declaration in the sidebar |
| `x = expr;` | `set` | Set Variable node |
| `config.laserPower(12);` | `call` with `kind: config` | Runtime setting node (gear icon, distinct colour, section 3.1) |
| `on(Button, { label: 'Hold fire', key: 'H', aim: false }, () => { ... })` | `handler` with `config` | Button event block: the label, key and aiming are its configuration |
| `x` (read) | `get` expr | Get Variable node (pure) |
| `if (c) {A} else {B}` | `branch` | Branch node: exec outs True / False, exec out Done |
| statements in order | list | exec wire chain |
| `while (c) { ... }` (bounded) | `loop` | While node: exec outs Body / Done |
| `a + b`, `a < b`, `a && b`, `!a`, `c ? a : b` | `op` expr | Math / Compare / Logic / Select nodes (pure) |
| `42`, `MOVE`, `true` | `lit` / `const` | Pin default value (free), or Constant node |
| `// note` | `comment` | Comment box attached to the following node |

Restrictions that keep the mapping one-to-one:
- Integers only (the engine is integer): `true`/`false` are 1/0. `/` is integer division.
- Only the API functions exposed by `UNIT_API` plus the node-only helper `after(ticks, id)` (raises a `Timer` event once).
- Event configuration is an object literal of constants only (numbers, named constants, arrays of constants): no variables or expressions, so it is data the engine can read without running the program.
- No early `return` in the first milestone (graph equivalent: a "Stop" node; added with both views at once).
- `while` loops are always cost-bounded by the handler budget (section 6); no `for`, `break`, `continue` yet.

### 3.1 Node kinds: events, actions, queries, configuration

Every call in the language belongs to exactly one kind, and the UI makes the kind obvious at a glance (header colour, icon, and shape of the exec pin), so players never confuse "set up how I behave" with "do something now":

| Kind | Meaning | Examples | In the graph | In the text |
|---|---|---|---|---|
| **Event source** | Entry point. Starts a handler, and carries the configuration of the thing that raises it (sensor sweep, filters, intervals, button label) | `Spawned`, `Order`, `Idle`, `Detected`, `Every`, `Button` | red header with the configuration fields on the block, no exec input | `on(Event, { config }, ...)` |
| **Action** | A one-shot effect on the world now, usually costing energy | `moveTo`, `fire`, `harvest`, `build`, `order` | orange header, lightning icon | plain call: `moveTo(x, y)` |
| **Query** | Reads state, no effect (may cost energy, e.g. a scan) | `hp`, `dist`, `taskX`, `nearestDepot` | blue header | plain call returning a value |
| **Runtime setting** | Changes a persistent standing setting of a module *while running*; the module then acts by itself | `laserPower`, `setModule`, `storageMode` | teal header, gear icon, "standing setting" tooltip | `config.` namespace: `config.laserPower(12)` |
| **Logic / data** | Pure maths, comparison, variables, literals | `a + b`, `x < y`, Get/Set Variable | grey, compact | operators and identifiers |

**Configuration lives on the event source block, not in the program flow.** Setting up the sensor, a filter or a timer is a property of the block that raises the event, so it is visible where the event enters the graph, cannot be forgotten in some other handler, and costs no cycles (it is not executed). Two kinds of configuration therefore exist, and the UI keeps them apart:

| | Event source configuration | Runtime setting (`config.*`) |
|---|---|---|
| Where | fields on the event block | a node in the flow |
| When fixed | at upload; constants only | whenever the node runs |
| Examples | sensor `range`, `interval`, `watch`, `sort`, `limit`; `Order` `types`; `Idle`/`Every` `interval`; `Damaged` `minAmount`; `EnergyLow` `below`; `Button` label and key | `laserPower`, `setModule`, `storageMode` |
| Costs | nothing to run; the hardware (sensor sweep) pays its own energy | normal node cycles |

Rules:
- Source configuration is declarative. Filters run in the engine *before* an event is queued, so a filtered-out event costs nothing, which extends "unhandled events cost nothing" to "events you filtered out cost nothing". To stop filters becoming free programming, they are limited to the fixed field list of each event (constants only, no expressions). Configuration values are program data, not memory slots.
- Every field has a schema in `events.ts` (type, range, default, and the **hardware limit** where one applies). Values beyond the hardware are clamped, and the block shows the applied value with a hint ("sensor.short: max range 6"). The same limit check runs when a program is uploaded.
- The consequence of configuring a source arrives later as an event (a sensor set to sweep every 5 ticks eventually raises `Detected`). The inspector says so in plain words ("this sets how your sensor sweeps; it does not scan now").
- Runtime settings (`config.*`) persist on the unit until changed or the unit reboots, and setting the same value again is harmless.
- The Code tab palette has separate groups and colours per kind, and the docs page lists them in separate sections.

### Parser and tooling

- Parse with **`@lezer/javascript` (TypeScript dialect)**: already in the CodeMirror/lezer family the project pins, error tolerant (good while typing), incremental. Walk the syntax tree into IR and reject everything outside the subset with a readable message pointing at the range. Alternative if lezer trees prove awkward: `acorn` (ESTree; no types needed).
- The repo's `typescript` dependency is the native 7.x toolchain with no embeddable compiler API, so **we do not run the TS compiler in the browser**. Types are enforced by our own small checker (int, event parameter names and counts, arity from `UNIT_API`).
- Editor: `@codemirror/lang-javascript` (TS mode) for highlighting and indentation, plus our existing completion, hover docs and lint hooks, regenerated from `UNIT_API` and an events table. A generated `.d.ts`-style reference page goes into the docs.
- Printer: IR to text, deterministic (fixed indent, minimal parentheses, one statement per line). Used for the Text view, the upload diff and version history, so diffs of graph-authored programs read as code.

## 4. Events

Events are the only entry points. Each has a fixed id (append only, like `UNIT_API`), a parameter list, and a rule for who raises it. The sim raises events from things it already knows, so raising them is cheap and does not need energy.

| Event | Parameters | Configuration (on the block) | Raised when |
|---|---|---|---|
| `Spawned` | reason | none | unit just built or just rebooted |
| `Idle` | none | `interval` (ticks, default 1) | **the CPU is evaluated and nothing else is queued or running** (see below) |
| `Every` | none | `ticks` | a repeating timer fires |
| `Timer` | id | `ids` (optional filter) | a one-shot timer set by the action `after(ticks, id)` fires |
| `Order` | type, x, y, target | `types` (which task types to accept), `from` (player / building / any) | a task is pushed to the front of the queue |
| `Arrived` | none | none | movement finished |
| `Damaged` | amount, attacker | `minAmount` | took damage |
| `Detected` | kind, handle | `watch`, `range`, `interval`, `sort`, `limit` (see below) | the unit's sensors newly pick up something |
| `Visitor` | reason | `reasons` | building: unit produced or docked (replaces `nextVisitor`) |
| `Button` | none | `label`, `key`, `aim` | player pressed the button this block declares (replaces `button` declarations) |
| `EnergyLow` / `EnergyFull` | none | `below` / `above` (percent) | energy crosses the threshold |

A class may have several `Detected`, `Every`, `Order`, `Button` and `Timer` blocks (each with its own configuration, so "enemies within 8, check often" and "resources within 20, check rarely" are two blocks). The other events have at most one block per class. Two `Detected` blocks sweep independently, and each sweep pays the sensor's energy, so the price of watching more things is visible.

**`Idle`** is the default heartbeat and replaces both `Tick` and `sleep`:
- Each tick, when a unit's CPU is evaluated, it takes the oldest queued event. If there is none, no handler is still suspended mid-run, and the class has an `Idle` handler, `Idle` fires. If there is any other work, `Idle` does not fire, so it can never starve real events.
- A class with no `Idle` handler never pays for idling, so a purely reactive unit is free between events.
- The block's `interval` (default 1) makes `Idle` fire at most every n ticks, which is the replacement for `sleep(n)`.
- `Idle` is where polling-style logic lives for players who want it (`const t = taskType(0)` and so on), and the cost model charges exactly for that.

**`Detected` and the sensor (configuration on the block, not behaviour in the flow):**
- The `Detected` block holds the whole sensor setup: `watch` (an **ordered** list of kinds, the order being their priority), `range`, `interval`, `sort` (which candidate of a kind is reported first) and `limit` (most reports per sweep). The sensor then sweeps on its own schedule, paying its normal energy per sweep. Nothing is swept if no `Detected` block exists.
- **Better sensors unlock more configuration.** Each sensor part gains capability fields, so the block's options grow with the hardware (the editor greys out and explains what the installed sensor cannot do):

| Field | Basic sensor | Better sensors |
|---|---|---|
| `watch` | 1 kind | up to 3 kinds, in the player's chosen priority order |
| `sort` | `NEAREST` only | adds `WEAKEST`, `STRONGEST`, `MOST_DAMAGED`, ... |
| `limit` | 1 | several reports per sweep |
| `range` | up to the part's range | up to the part's range |
| `interval` | floor set by the part | lower floor, so faster sweeps |

  The initial kinds are **enemy unit, resource and damaged ally** (P3); more can be added to the table without changing the language.
- `Detected(kind, handle)` is raised for things that are *newly* seen since the last sweep (not every sweep for the same thing). Reports within a sweep are delivered in the configured `watch` priority order, then `sort`, up to `limit`. The queries `dist(h)`, `posx(h)` and so on keep working while the thing is visible.
- The event deliberately says only "something was detected". When line of sight and finer fog of war arrive, the engine changes *what the sweep finds*; programs and events stay the same. The sweep is one function in the sim (`sensorSweep(unit)`), so that is the single place that changes.
- The old explicit `scan()` stays as a query for players who want a one-off look (it costs energy as today).

Rules:
- An event with **no handler is dropped before it is queued**. Zero cost, zero memory.
- Each unit has a small bounded event queue (capacity from the class's `stackDepth` stat, so better hardware buffers more). On overflow the oldest `Timer`/`Detected` event is dropped first, then the newest; the CPU panel shows "events dropped".
- Handlers run in arrival order, one at a time, and **may be suspended** between statements when the cycles for the tick are used up (section 6). A suspended handler resumes next tick before any new event is taken.

`sleep(n)` disappears: a unit with nothing to do has no events, or uses a longer `Idle` `interval`. Timers (`Every` blocks and `after`) are cheap scheduled events held by the sim, not by the program.

## 5. Graph structure rules (what keeps it isomorphic to text)

- **Exec wires** form trees: each exec input has exactly one incoming wire, except the dedicated `Done` pin of Branch/While (which is how Blueprint-style "completed" joins are expressed in text: the code after the `if`). No two wires may merge into an arbitrary node. The editor prevents invalid connections (typed sockets: exec to exec only, one wire into an exec input, a new connection replaces the old).
- **Data wires** come from **pure** nodes (math, compare, logic, variable get, literal, select) or from the data outputs of a call/event that has already run. A call node's result is computed once, when its exec pin fires (it is `const v = call()` in text), so reading it twice never re-runs the call or charges the cost twice.
- A pure node whose output feeds several inputs is re-evaluated on each pull, exactly like the text where the expression is repeated. The printer may hoist a repeated subexpression into a `const`; the parser may fold it back. Either way the cost model counts pulls, so the player sees the price of reuse and is nudged toward a `const`/call-result.
- Data wires may not cross handler boundaries (a value from one handler cannot be pulled by another; use variables).
- Loops: While's body can not contain wires back to its own entry; the loop is the node.

Anything the player draws that breaks these is either refused at connect time or shown as a red wire with a message, and kept in `scratch` until fixed.

## 6. CPU cost model

Defined **on the IR, not on bytecode or on a view**, so text and graph programs cost exactly the same.

For one event delivered to a handler:

- **Node cost:** each statement or expression node executed costs `1` cycle. Calls add the API function's `cost` (the existing `UNIT_API` numbers, e.g. `scan` +8) on top.
- **Arc cost:** each exec wire followed costs `1`; each data wire pulled costs `1`.
- **Free:** pin default literals and unconnected inputs (a literal typed inline in text), declarations, comments, the event node itself, and branches not taken (nothing downstream of them runs).
- **Event with no handler:** costs nothing (never queued).
- **Literals:** cost **no cycles and no energy**, but take up **memory** (below).
- **Budget and suspension:** each tick a unit's CPU receives `cyclesPerTick` cycles. The unit runs statements until its balance is spent, then **suspends** the handler (saving the program counter) and resumes next tick. A statement is never split: it runs whole if the balance is above zero when it starts, and may overdraw it; the overdraft is repaid from the next ticks' cycles. So a statement that costs more than a small CPU's per-tick budget still completes (just slowly) instead of starving. Energy is billed from cycles actually run with the existing `cpuDebt` mechanism (`cpuUse` per 100 cycles).
- **Unspent cycles are not banked** (balance is capped at one tick's worth) so an idle unit cannot save up a burst.
- **Safety cap:** one event handler may run at most a hard limit of cycles (default 4096, tune) in total across its ticks; beyond that it faults like the old VM: reboot next tick, event dropped.

### Memory

Memory (`memorySlots` stat, raised by memory modules on the chassis) is what a program *occupies*, checked when the program is uploaded and compiled; a program that does not fit is rejected with the number needed. Counted:
- 1 slot per declared variable;
- 1 slot per **distinct literal value** in the program (a constant pool: `5` used ten times is one slot, and an inline literal in a pin default or in text is the same thing);
- 1 slot per event parameter and per call-result local, taking the **largest handler's** need (locals are reused between handlers since only one runs at a time);
- queued timers and button declarations do not use memory.

So memory never costs energy, but a program with many different magic numbers needs more memory hardware, and sharing a constant (`const RANGE = 6` as a variable) is cheaper than repeating several distinct values. The editor shows "memory used/available" live, and the Design tab stats show the same. The old `stackDepth` stat now sizes the event queue (section 4, decision P2). Event source configuration values are program data and use no memory slots.

- Display (done in M6): the info panel shows cycles per second and runs by event block, and dropped events; each event block shows its worst-case cost; the sandbox test run reports cycles by event block and a heat map.

A worked example: `Order` arrives, handler is Event -> Branch -> Call(moveTo) with literal args. Cost: branch `1` + its condition expression (compare `1` + two reads `2` + 2 data arcs) + 1 exec arc + moveTo `1+1` + 1 exec arc. The exact table is a unit test, and every number is a named constant in one file (`flowCost.ts`) for easy rebalancing.

## 7. Engine architecture

New files in `packages/engine/src/flow/` (pure, no DOM, runs on server and client):

| File | Purpose |
|---|---|
| `ir.ts` | IR types, `validate(ir)`, id generation, canonical JSON (stable key order) |
| `events.ts` | event table: ids, parameters, docs, and the **configuration schema** of each event source (field type, range, default, hardware limit derived from the installed parts) |
| `nodes.ts` | node catalogue: ops, API calls (wrapping `UNIT_API`), pin types, docs. Single source for the graph palette, text completion, the checker and the docs page |
| `text.ts` | parser (lezer tree to IR) and printer (IR to text), error type with source ranges |
| `compile.ts` | IR to `FlowProgram`: flat instruction list with jumps, constant pool, per-handler entry, memory requirement; shared per class (flyweight) |
| `run.ts` | resumable interpreter: `step(state, ctx, budget)` runs whole statements until the budget is spent, returns cycles used and whether the handler finished |
| `cost.ts` | the constants and cost accounting (section 6) |

Sim integration (`systems.ts`, `simulation.ts`):
- `bp.program` becomes a `FlowProgram` only (the old `Program` is removed with the VM). `scriptSystem` is rewritten around it; units get a `FlowState` instead of a `VmState`.
- **Compiled form is a flat instruction list with jumps** (`if`/`while` become conditional jumps), not a tree. Suspension is then trivial and cheap: the state to save is one program counter, the cycle balance, the current event id, and a small locals window.
- **Performance for 1024 units (256 per player):**
  - Per-unit state is struct-of-arrays in typed arrays (`pc`, `balance`, `busy`, queue head/tail, a shared `Int32Array` for variables and locals with a per-unit offset) so a tick allocates nothing.
  - A unit with an empty queue, no suspended handler, no due timer and no `Idle` handler is skipped by one flag check, so purely reactive units cost nothing per tick. Events are pushed onto queues when they happen, so the work is O(events), not O(units).
  - Worst case is every unit running an `Idle` handler: at most `cyclesPerTick` instruction steps per unit per tick (single digits to a few dozen steps for current CPUs), so 1024 units is on the order of tens of thousands of steps per tick, roughly what the old VM already did.
  - A **benchmark test gates M3**: 1024 units each with a typical `Idle` handler and a stream of events must run a tick in well under the 100 ms tick budget (target under 10 ms on the dev machine, written into the test as a generous ceiling to avoid flakiness).
- A new `eventSystem` raises events (order push, arrival, damage, visitor, timers, thresholds) before `scriptSystem` runs. Raising checks `program.handles(eventId)` first, which is the "unhandled events cost nothing" rule.
- Builtins are reused as they are: `UNIT_API` entries already take `(ctx, args)`. Flow call nodes invoke the same functions, so the game API is identical in both languages.
- Replication and `UnitView` CPU fields extend naturally (`used`, `state`, plus `busy` and per-event counters).
- Determinism: nothing new is non-deterministic; timers are tick numbers, the queue is FIFO.

## 8. Editor architecture (client)

### Library and components

- **Rete.js v2**: `rete`, `rete-area-plugin`, `rete-connection-plugin`, plus `rete-history-plugin` (undo/redo), `rete-context-menu-plugin` (add-node menu), `rete-minimap-plugin`, `rete-comment-plugin` (group/comment boxes), `rete-auto-arrange-plugin` (+ `elkjs`) for "tidy" after a text-to-graph swap.
- **Rendering with Lit (`@retejs/lit-plugin` 2.x, `lit` 3.x)**, not hand-written DOM. Each visual part is a custom element, so it can be reused and extended without touching the editor:
  - `<wst-flow-node>`, `<wst-flow-socket>` (typed, colour-coded: exec white, int blue, bool red, handle green), `<wst-flow-connection>`, `<wst-flow-control>` (inline literal field on a pin), `<wst-flow-palette>`, `<wst-flow-inspector>`, `<wst-flow-cost-badge>`.
  - Custom elements fit the project (vanilla TS + Vite, no framework runtime to add or keep in sync), and are reusable elsewhere in the UI (for example showing the cost badge in the unit info panel).
- Why Lit over the official React/Vue/Svelte plugins: those would bring in a whole UI framework for one panel. Svelte 5 (compiled, tiny runtime, `rete-svelte-plugin` 2.1) is the fallback if Lit's plugin proves rough. Components are written against Rete's interfaces and our own element attributes, so a swap is local.
- **Risk to verify first (spike, M0):** `@retejs/lit-plugin` is the maintained successor of the 2023 community plugin (2.0.8, July 2026) but is the least-used of the render plugins. Spike a node with sockets and a connection in the Vite build before committing.

### Adapter layer (keeps Rete replaceable)

`packages/client/src/flow/`:

| File | Purpose |
|---|---|
| `graphModel.ts` | IR <-> Rete `NodeEditor` conversion. IR is truth: editing in Rete dispatches **IR edit operations** (add node, connect, set literal, delete) through `FlowDocument`; Rete is re-synced from the IR, never the other way round |
| `FlowDocument.ts` | holds IR + views + undo history; emits `change` events; both views subscribe. Validates after each op (section 5) |
| `graphView.ts` | mounts Rete + Lit, layout, minimap, context menu |
| `textView.ts` | CodeMirror (TS mode), parse on edit (debounced ~250 ms), error diagnostics, "unparsed draft" state |
| `codeTab.ts` | the Code tab: toolbar (Graph / Text / Split toggle, Tidy, Undo/Redo, Test run, Upload), cost badges, palette/inspector, console of test results |

Sync rules:
- Single edit stream: graph ops and text edits both end as `FlowDocument` changes. A text edit that parses replaces the IR (diffed by node id where possible so layout survives; new nodes get auto-placed near their parent, then Tidy if asked).
- **Split view** (graph left, text right) works because both subscribe to the same document. A text edit that does not parse freezes the graph with a banner and keeps the last good IR; fixing the text unfreezes.
- Switching view never changes the program. Opening an old text program as a graph runs the parser; if the program is outside the subset, only the text view is available and the reason is shown.

### Designer tabs

`Designer` (currently 641 lines in one class) splits into:
- **Design tab:** class list, preview, stats, modules, palette (today's left and middle columns, now with room to breathe).
- **Code tab:** the full panel for the editor; class list collapses to a dropdown above it. History, upload diff, and test run move here.
- Tab choice persisted in `sessionStorage`; footer buttons (Upload program / Create class) stay visible on both.
- Refactor `designer.ts` into `designer/DesignTab.ts`, `designer/CodeTab.ts`, `designer/Designer.ts` (shell + shared state: selected class, edits, history) as part of M1, before the editor lands.

### Cost feedback in the editor

- Node kinds are visually distinct (section 3.1): header colour, icon and pin shape per kind, configuration nodes in a separate palette group, with a tooltip saying what is a standing setting versus an action. Colours are CSS custom properties on the elements so themes can restyle them.
- Each handler shows its worst-case path cost and the last test run overlays actual hit counts on nodes and execution wires (heat map), so players see where their CPU goes (done in M6; per-node cost badges and heat on data wires were not built).

## 9. Retiring the old language

The old text language is removed (done in M4). There is no converter and no dual-language period.

**Deleted:** `packages/engine/src/vm/*` (compiler, opcodes, vm, types), the CodeMirror unit-script language and linter in `editor.ts` (replaced by the TS-mode text view), `compileUnitProgram`, `ProgramButton` as a VM concept, the legacy sections of the docs overlay and `docs/game.md`, and `vm.test.ts`.

**Rewritten in the new language** (text first, since it is quicker to author and review; graphs follow automatically through the shared model):
- `content.ts`: all `STARTER_CLASSES` programs, `NEW_CLASS_PROGRAM`, `NEUTRAL_CLASS`, and the shared fragments (`OBEY_URGENT`, `RECHARGE_WHEN_LOW`, `HANDLE_CHARGE`, ...).
- `bot.ts`: `FIGHTER_PROGRAM` and the other bot programs.
- Tests: `sim.test.ts`, `bot.test.ts`, `designs.test.ts`, `radar.test.ts`, `turret.test.ts`, the server tests that upload programs.
- The sandbox `testRun` runs flow programs and reports per-event cycle costs.
- Each ported class must pass the same scenario as before (builders build, harvesters deliver, fighters engage) before the old version is deleted from that test.

**Behavioural mapping from polling to events** (guidance for the port):
- The player's task queue stays a game concept. A pushed task raises `Order`; the handler decides what to do; `Idle` handles what is left (continuing a move, harvest-and-dock loops), so most worker logic is a small state machine on variables.
- `button` declarations become `Button` event blocks (label, key and aim are the block's configuration).
- `sleep(n)` becomes the `interval` of an `Idle` block, or simply no handler.
- `nextVisitor()` loops in buildings become `Visitor` handlers.

**Saved data:** design files and the `localStorage` history carry a `version`. Bump `DESIGN_VERSION` to 2: entries whose `program` is not a `wst-flow` document are **replaced by the current default for a class of that name** (or the new-class starter), with a one-time notice listing what was replaced. Old text is kept in the download file under `legacyProgram` so nothing is lost for players who want to port by hand. History entries in the old format are dropped.

**Docs:** `docs.ts` and the docs page are regenerated from `nodes.ts` and `events.ts`, with separate sections for events, actions, queries, configuration and logic.

## 10. Extensibility hooks (designed for, not built in M1)

- **Subgraphs and functions:** IR `functions[]` with params and a result; the text is `function f(a, b) { ... }`. Graph shows it as a collapsible node. Needs recursion limits (none: no recursion).
- **Custom node components:** the catalogue in `nodes.ts` is data plus an optional Lit element name, so new node kinds (and mod-provided ones) only add data and a component.
- **Unit-to-unit messages:** done (2026-10-20) as radio and laser link modules: `radioSend` / `laserSend` and the `Message` event.
- **Shared libraries of snippets** exported as `wst-flow` fragments through the existing design download.

## 11. Testing

- `flow/ir`: validation (all rule violations from section 5), canonical JSON stability.
- `flow/text`: **round-trip property tests**: `parse(print(ir)) == ir` over generated IRs, and `print(parse(text)) == text` for formatted text. Corpus of rejected constructs with expected messages.
- `flow/cost`: table-driven tests that fix every number in section 6, including "unhandled event = 0".
- `flow/run`: semantics (branch, loop cap, variables, call results computed once, pure re-evaluation counted), determinism (same seed, same cycles).
- Sim: event raising (order, arrival, damage, visitor, timers), queue overflow, busy time versus `cyclesPerTick`, energy billing parity with the old CPU.
- Client: `FlowDocument` ops with undo, graph<->IR conversion, view sync (text edit updates graph, graph edit updates text, invalid text freezes graph). The Rete/Lit layer gets a thin smoke test only (jsdom or a Vite browser test), logic stays in `FlowDocument`.
- Equivalence: for every starter-class port, a scenario test that old and new programs get the same job done.

## 12. Milestones

| M | Deliverable | Done when |
|---|---|---|
| **M0 spike** (done) | Vite page with Rete + `@retejs/lit-plugin`: two nodes, typed sockets, one connection, pan/zoom. Lezer TS parse of a sample. | **Result:** works. Rete 2.0.6 + `@retejs/lit-plugin` 2.0.8 + `lit` 3.3.3 render our own `<wst-flow-node>` and `<wst-flow-socket>` elements through the preset's `customize` hooks (sockets via `<rete-ref>`), typed-socket refusal and one-wire-per-exec-input work in a connection pipe, area gives pan/zoom/drag/selection, production build is 326 KB (87 KB gzip) for the spike page including Lit. `@lezer/javascript` (TS dialect) parses the `on(...)` sample and still finds the calls and error positions on broken input. Spike lives in `packages/client/spike/` (`/spike/flow.html` in dev). Notes: classic preset draws every wire in one colour (exec vs data wire styling needs `customize.connection`); with ES2024 class fields, Lit elements must declare properties with `static properties` plus `declare` fields, not decorators |
| **M1** Designer tabs (done) | Split designer into Design / Code tabs; Code tab hosts the editor | **Result:** `designer.ts` became `src/designer/` (`Designer.ts` shell, `DesignTab.ts`, `CodeTab.ts`, `shared.ts`). Design tab has three columns (classes, preview/stats/installed, catalogue); Code tab is full width with a class picker and the history select in its header; tab choice is kept in `sessionStorage`; Upload on the Design tab switches to Code to show the diff. Tests and typecheck pass; driven once in headless Chrome (open, switch tabs, pick a class, selection persists) |
| **M2 (done)** Flow IR + text | `ir.ts`, `events.ts`, `nodes.ts` (kinds, math, branch, set, calls, config), `text.ts` parser and printer, memory accounting, round-trip tests | Text <-> IR is lossless on the test corpus **Result:** IR, events table with settings schema, node catalogue (call kinds from `UNIT_API`), TypeScript-subset parser and deterministic printer (Lezer), checker with memory accounting, and round-trip tests over every starter program. |
| **M3 (done)** Runtime | `compile.ts`, `run.ts` (suspend/resume), `cost.ts`, `eventSystem` (incl. `Idle`, timers, configurable sensor sweep with part-limited options), `scriptSystem` rewrite, 1024-unit benchmark | A flow program runs in a match; costs match tests; benchmark passes **Result:** flat compiler, resumable interpreter (suspend between statements, overdraw and repay), per-unit event queue, `Idle`/`Every`/`Timer`/`Detected`/`Order`/`Button`/`Visitor`/`Arrived`/`Damaged`/`EnergyLow`/`EnergyFull`, sensor tiers (`game/sensor.ts`). 1024-unit benchmark: about 1.3 ms per tick (budget 100 ms). |
| **M4 (done)** Port and retire | Rewrite starters, `NEW_CLASS_PROGRAM`, bot programs and tests in the new language; delete the old VM, compiler, editor language and docs; design file v2 migration; text-only Code tab (TS-mode CodeMirror, lint, completion, hover docs, diff, history, test run) | Game is fully playable on flow programs; old language gone from the branch; all tests pass **Result:** old VM, compiler, editor language and docs removed; starters, bot fighters and tests rewritten; design files version 2 (old programs replaced by the default of that name or the new-class starter); text Code tab (TS mode, lint with places, completion, hover docs, memory meter, diff of printed text, history, test run); docs regenerated. Played a short match end to end (solo room, upload over the wire) with no errors. |
| **M5 (done)** Graph view | `FlowDocument`, Rete adapter, Lit components, kind styling, palette, context menu, inspector, undo, Tidy, Split view | Edit in either view, other view follows; invalid text freezes the graph cleanly **Result:** `FlowDocument` (one model, undo/redo, frozen graph on a syntax error), `graphOps` (every graph edit as an IR operation: exec/data wiring with the structure rules, loose pieces kept in `views.graph.scratch`), `graphModel` + `layout`, Rete.js + Lit components (`wst-flow-node/socket/wire/palette/variables`), palette, variables panel, Tidy/Fit/Delete/Undo/Redo, Graph / Split / Text switch. Driven in headless Chrome: add a node, wire it, type a literal, undo, edit the text and watch the graph follow, break the text and see it freeze. |
| **M6** Cost UI (done 2026-10-24) | Badges, handler totals, test-run heat-map, per-event CPU panel in the sidebar, memory meter | Players can see where cycles and memory go **Result:** `≤Nc` worst case on event nodes and block cards; per-handler cycles/runs in `FlowState` and per-statement hits while profiling; test run table "CPU by event block" and graph heat map (nodes and execution wires; cleared on edit); `cpuProfile` request/answer feeds the in-game info panel (cycles per second by event block, dropped events); Design tab memory row shows program use. Not yet seen in a browser. |
| **M7** Polish | Docs, sounds for the editor, balance pass on the cost constants, subgraph/function groundwork if wanted | Play-tested |

M0 can run any time and gates M5 only. M1 and M2 can run in parallel. Putting the port (M4) before the graph (M5) keeps the game playable and gives the graph editor real programs to display.

## 13. Risks

1. **Lit render plugin maturity** (M0 spike answers it; Svelte fallback). Because the graph view lands after the port, a delay there does not block the game.
2. **Round-trip fidelity:** layout and formatting preferences are lost when text is edited. Mitigated by stable ids kept through a text-to-IR diff, auto-placement for new nodes, and a Tidy button. Comments are IR nodes so none are lost.
3. **Graphs that cannot be text:** prevented by the structure rules; the editor must make them impossible, not just flag them. Unit tests include random graph-edit sequences checked against the text round trip.
4. **Cost model balance:** per-node cost may make small CPUs useless or large ones trivial. All numbers live in one file; sandbox shows actual costs; tune in play-tests.
5. **Source size limit** with layout data; handled by stripping `views` server-side and raising the limit.
6. **Scope:** this replaces the central programming experience and the old language is deleted. Mitigation: the work lands in milestones where each ends with passing tests, M4 is the point of no return, and `main` still has the old version.
7. **Performance at 1024 units:** guarded by the flat instruction list, SoA state, skip flags and a benchmark test in M3. If the benchmark fails, the first fallback is to compile expression trees to closures; the cost model does not change.
8. **Memory accounting surprises:** distinct-literal counting may push the existing starter programs over their small memory limits. M2 reports the memory need of every starter; adjust the rule (for example free small integers 0..3) or the starter hardware in M4 if needed.
9. **Saved-design migration** replaces player programs with defaults; the legacy text is preserved in the download file to soften this.

## 14. Decisions

| # | Question | Decision |
|---|---|---|
| O1 | Automatic per-tick event? | Yes, as a ticking **`Idle`** event: fires when the CPU is evaluated and nothing else is queued or running; classes without an `Idle` handler never pay for it. The `Idle` block's `interval` slows it (section 4). |
| O2 | Sensor events and configuration | A `Detected` event raised by the sensor sweep. **Configuration lives on the event source block** (`watch`, `range`, `interval`, `sort`, `limit`, and filters on other events), not in the program flow; only genuinely runtime settings (`laserPower`, `setModule`, `storageMode`) remain as `config.*` nodes, visually distinct (section 3.1). The sweep is one function so line-of-sight can change what is found later without touching programs. |
| O3 | Suspend or run to completion? | **Suspend**: handlers pause between statements when the tick's cycles are spent and resume next tick; a statement may overdraw. Performance plan and a 1024-unit benchmark in section 7. |
| O4 | Literal cost | **No cycles, no energy; they occupy memory** (distinct literal values, variables, locals), which memory modules provide (section 6). |
| O5 | Old language | **Retired**, existing behaviours rewritten in the new language (section 9); the last commit with it is `8d2f1d5`. |

### Also decided

| # | Question | Decision |
|---|---|---|
| P1 | Memory granularity | One slot per distinct literal value, **provided trivial values really are trivial**: M2 measures every starter, and small integers (such as 0 and 1) are made free if that is what keeps trivial programs on a bare chassis. |
| P2 | Event queue size | Reuse the `stackDepth` stat. |
| P3 | `Detected` kinds and order | Initial kinds: enemy, resource, damaged ally. **The priority order is configurable on the block, and better sensors unlock more** (more watched kinds, more sort modes, several reports per sweep, faster intervals; table in section 4). |
| E1 | Event sources as blocks | Event blocks carry their own configuration and filters (suggested by the user), replacing `config.sensor*`, `config.idleInterval` and the top-level `button` declarations. |
| Q1 | Sensor tier numbers | **Match today's behaviour.** `Detected.range` is capped at the part's existing `sensorRange` (the same range `scan()` and the fog of war use now: `sensor.short` and `sensor.long` keep their current values; `visionRange` is unchanged). Each sweep costs the part's existing `sensorUse` energy, the price of one `scan()` today, and the minimum `interval` is 1 tick, since `scan()` can already run every tick. A `Detected` block needs a working sensor module, as `scan()` does. `sensor.short` is tier 1 (one kind, `NEAREST`, `limit` 1: exactly what `scan()` does today, but pushed as an event); `sensor.long` is tier 2 (up to 3 kinds, extra sort modes, `limit` up to 3). The tier fields are added to the sensor parts in `parts.ts` in M3 and the tier 2 extras are the only new capability; nothing senses further or cheaper than now. |
| Q2 | Runtime override of source options | **Deferred.** Wanted eventually (for example adaptive sensor range), but source options are fixed at upload while the language and UX are tested. |

### Still open

None for the plan itself. Numbers to tune in play-tests: the cost constants (section 6), tier 2 extras, and the memory rule for small integers.


## What changed from the plan (found while building M2-M5)

- **`rest(n)`** exists as the runtime setting `config.rest(n)` (pauses `Idle` for n ticks). The static `Idle` `interval` alone could not express the old programs' variable naps, and a faithful port needed them.
- **`Detected` reports what is in range on each sweep** (up to `limit`, in priority and sort order), and nothing when there is nothing, rather than only "newly seen" things. "Newly seen" would lose enemies that were already known when the current target died. A `fresh` option can be added later.
- **Memory numbers were raised** to make room for the new accounting (distinct numbers use memory): `cpu.basic` 16 (was 4), `cpu.fast` 24, `cpu.quantum` 64, `mem.small` 16 (was 8), `mem.large` 64 (was 32). Scout and Hawk need 14 of 16. Balance to revisit.
- **Event parameter names** avoid the API names (`x`, `y` are queries): `Order(type, tx, ty, target)`, `Button(tx, ty, target)`. A variable, parameter or result may not reuse any built-in name.
- **Parsing reports program problems too** (unknown names, an action inside an expression, a Button key already taken) with their places in the text; `ParseResult.syntaxErrors` separates the problems that stop the text becoming a program (the graph freezes) from the ones found in a program that parsed.
- **Graph editing rules:** an operator or query node feeds exactly one input (to reuse a value, bind it with `const`); event parameters and call results can fan out, but only where they are in scope; connecting an exec output replaces what it fed (that chain becomes a loose piece); wiring into a taken pin is one undo step.
- **Rete ids are the program's ids** (node id = statement id, or `owner#path` for a value node), so the graph and the IR can never disagree about what a node is. Loose pieces (`views.graph.scratch`) share the id space with the program: text parsing reserves their ids.
- **`packages/client/spike/`** (the M0 spike) was removed once the real editor existed.

## Remaining (M7 and follow-ups)

- M6 follow-ups (optional): heat on value (data) wires and pure nodes (only statements are counted today), a per-class CPU summary across all units of a class, and showing the in-game profile in the Code tab next to the program.
- M7: sounds for the editor, balance pass on the cost constants (`flow/cost.ts`) and CPU cycles per tick (the harvester now saturates a basic CPU), copy/paste of nodes, a quick-add search on double-click, an error list panel, subgraphs/functions.


---

# Phase 2: event-first programs and higher-level blocks

Status: **M8-M12 done** (2026-10-20); only the readability review of M12 with the user is left (see "Phase 2: decisions and status"). Prompted by the first look at the graph: it is a faithful drawing of the old *polling* programs, and polling code is unreadable as a graph (nested branches, queue juggling, `Idle` doing everything). The fix is not a nicer drawing of the same logic; it is to stop writing polling logic. A useful smell test: **if a program hooks `Idle` for its main behaviour, it is wrong.** Starter programs must not use `Idle` at all, except where a periodic check is the point (the storage controller uses `Every`).

## Why the current graphs are bad

1. Every long-running job (`approach`, `harvest`, `dock`, `build`, `repair`) is written as "call it again every tick and look at the answer", so each job is a state machine hand-built out of `if`/`else` and the task queue.
2. The boilerplate every class repeats (obey urgent orders, recharge when low, revive flat units) is 40 lines of branching copied into each program.
3. One giant `Idle` handler holds the whole behaviour, so a class is one big chain instead of a set of small reactions.

## The three ideas

### 1. Durable activities that report back (no polling)

A unit does one **activity** at a time, and the engine runs it. The program starts it and gets told how it ended. Starting a new activity cancels the current one.

| Activity | Ends with (outcomes) |
|---|---|
| `goTo(x, y)` | `arrived`, `blocked` |
| `approach(target, range)` | `arrived`, `lost`, `blocked` |
| `harvest(field)` | `full`, `empty`, `lost` |
| `dock(depot)` | `docked`, `noRoom`, `lost` |
| `take(depot, n)` | `taken`, `lost` |
| `build(site)` | `built`, `gone`, `starved` |
| `repair(target)` | `repaired`, `gone`, `starved` |
| `charge(pad)` | `charged`, `lost` |
| `supply(target)` | `revived`, `refused` |
| `engage(target)` | `destroyed`, `lost` |

The engine does the walking, gathering and checking each tick without running the program, so a busy unit costs no CPU between outcomes (the harvester no longer saturates its CPU). The program only runs when an activity starts and when it ends.

**Outcome pins.** In the graph an activity node has an execution pin for what happens straight away (`started`) and one per outcome. In text the outcomes are continuations:

```ts
on(Order, { types: [HARVEST], urgent: REPLACE }, (type, tx, ty, field) => {
  harvest(field, {
    full: () => dock(nearestDepot(), { docked: () => nextOrder() }),
    empty: () => harvest(randomResource(4, 10), {}),
  });
});
```

A continuation runs in the frame the call was made in (the event parameters and earlier results are still there), as its own short handler. IR: a call statement gets an optional `outcomes` map of statement lists. Each outcome is a chain in the graph, so a job reads left to right instead of nesting.

### 2. Higher-level blocks (behaviours) with settings

A **block** is a named, reusable piece of behaviour with settings, input events and output events, written once in the engine and used by name. It replaces the copied boilerplate and is one node in the graph:

| Block | What it does | Settings |
|---|---|---|
| `TakeOrders` | Starts the right activity for each player order, drops the order when it ends, takes the next | `urgent`: replace the plan or queue; which order types |
| `RechargeWhenLow` | Below a threshold, pauses the current activity, charges, then resumes it | `below`, `until` |
| `ReviveFlatUnits` | Right-click a flat unit: bring it back to 50% | `give` |
| `HarvestLoop` | Harvest, dock when full, swap an empty field for a nearby one | `fieldsToChooseFrom`, `minMatter` |
| `BuildJobs` / `RepairJobs` | Pick the nearest unfinished or damaged thing when idle | `range` |
| `EngageEnemies` | Shoot what the sensor finds, with a Hold fire toggle | `watch`, `range`, `sort`, `holdFireKey` |
| `RallyPoint`, `DispatchHarvesters` | Building behaviours for the HQ and silos | |
| `StorageController` | Charge / discharge / hold, with buttons | `interval` |
| `RadarPing` | Pulse when ready and energy allows | `energy`, `interval` |

Blocks are built from the lower-level pieces (they are templates that expand into ordinary event blocks and activities at compile time), so they cost what the expanded program costs. **Expand** turns a block into its plain event blocks in the editor so a player can change anything; it is one way, like ejecting. The existing toolbox (event blocks, branches, queries, actions, operators, variables) stays, as the "Script" level inside a block or beside it.

In text a block is one statement, `use(HarvestLoop, { minMatter: 10 });`, and in the graph one node, so the text and the graph keep round-tripping.

### 3. Events that programs make and use

Programs can `emit(Name, args)` an event of their own and `on(Name, ...)` it, inside one unit. Blocks use this to talk to each other and to the player's code: `HarvestLoop` emits `Delivered(amount)`, `TakeOrders` emits `OrderFinished(type)`, `RechargeWhenLow` emits `Charged`. A player can hook those without touching the block. (Messages between units come later, on the same mechanism.)

## What a class looks like

Harvester, today (about 110 lines, one `Idle` handler) against the proposal:

```ts
use(TakeOrders, { urgent: REPLACE });      // MOVE, STOP, CHARGE, SUPPLY, DOCK, HARVEST handled
use(RechargeWhenLow, { below: 25 });
use(ReviveFlatUnits, {});
use(HarvestLoop, { minMatter: 10 });
```

Fighter:

```ts
use(TakeOrders, { urgent: REPLACE });
use(RechargeWhenLow, { below: 25 });
use(EngageEnemies, { watch: [ENEMY], interval: 5, holdFireKey: 'F' });
```

Silo: `use(DispatchHarvesters, {})`. Storage: `use(StorageController, { interval: 4 })` (its `Hold charge` and `Automatic` buttons come with the block). A player adding a behaviour writes a small event block, for example "when the harvester delivers, count it", rather than another branch in a big handler.

## The graph becomes the primary view

- The default picture is **blocks and events**, not statements: a block is one card with its settings, event inputs on the left and outputs (outcomes, emitted events) on the right. Wires between cards are event flow. Event blocks and statement chains are the same cards when expanded.
- Activity nodes show outcome pins, so "what happens when this finishes" is visible where it is started.
- New classes start from a **template chooser** (Worker, Fighter, Builder, Turret, Storage, Blank) made of blocks, and the palette's first groups are Blocks and Events; the low-level nodes sit under "Script".
- Layout follows causality: an event source at the left, what it starts to its right, each outcome as a branch.

## Engine changes

1. **Activities** (`game/activity.ts`): one `ActivityState` per unit (kind, target, parameters, the saved frame of locals, the continuation to run on each outcome); an `activitySystem` that drives and checks them each tick by reusing the movement, harvest, build and repair systems, and raises the outcome as an internal event; cancelling raises `interrupted` where wanted. Start and outcome cost CPU; the time in between does not.
2. **Continuations** in the compiler and runtime: outcome chains compile to extra entry points; the runtime starts one with the saved frame.
3. **Order policy** on the `Order` event (`urgent: REPLACE | QUEUE`), so the "urgent replaces the plan" boilerplate is the engine's job, and `nextOrder()` drops the front order and raises `Order` for the next one.
4. **Custom events**: `emit`/`on(Name)` with the event table extended by names declared in the program (parameters and a per-unit queue entry like any other).
5. **Blocks**: IR node `use` with `{ block, settings }`; a template registry (`flow/blocks.ts`) that expands each block into events, activities and variables; settings schema like event settings (typed, ranged, hardware-limited); `Expand` as an editor operation.

## Client changes

Block cards and outcome pins in `graphModel`/`graphView`; the palette gets Blocks and Script groups; template chooser for new classes; block settings in the inspector; compact layout by causality; text printer/parser for `use(...)`, outcomes and `emit`/`on(Name)`; docs pages for blocks and activities.

## Milestones (phase 2)

| M | Deliverable | Done when |
|---|---|---|
| **M8** Activities (done) | Engine activities with outcomes, `urgent` policy and `nextOrder`, behaviour tests per activity (walking, gathering, docking, building, repairing, charging) and the CPU saving | A hand-written program using only outcomes harvests, docks and repeats with no `Idle` |
| **M9** Continuations (done: engine and graph pins) | IR `outcomes`, text syntax, compile and run with saved frames, graph outcome pins | A graph and its text show and edit outcome chains and round-trip |
| **M10** Custom events (done) | `emit` / `on(Name)` in IR, text, runtime and graph | Two blocks of one program talk through an event |
| **M11** Blocks (engine done 2026-10-20; graph cards are M12) | `use` nodes, template registry with the block list above, settings and hardware limits, `Expand` | Each starter class is expressed as blocks plus small event blocks, passes the same scenarios as now, and no starter uses `Idle` (a test enforces it) |
| **M12** Graph pass (done except the readability review with you, 2026-10-20) | Block cards, causality layout, template chooser, palette groups, inspector for settings, readability review with the user | The user can read and change a starter class in the graph without opening the text |

## Risks and open points

- **Frames across time:** a continuation must see the locals of the call that started the activity. The saved frame is small (event parameters and results, at most a handful of ints), but it counts toward memory and queue capacity.
- **Interrupting and resuming** (recharge in the middle of a harvest) needs an activity stack with a clear rule; proposed: only blocks may push, and they resume what they interrupted.
- **Balance:** activities make busy units nearly free in CPU, so CPU cost and `cyclesPerTick` need a pass.
- **Old programs again:** this removes the polling style (`approach`, `harvest`, `dock`, `build` calls become activity starts), so the starters are rewritten a second time, and saved designs from the current branch need the same replacement treatment as before.

## Phase 2: decisions and status (2026-10-20)

Decided with the user: completion is reported by **outcome pins** (a node per way an activity can end); reusable behaviours are a **built-in library** of templates with settings, each able to `Expand` into plain event blocks; **orders start activities directly** (the task queue is no longer a program concept; queued orders are a simple order list read with `nextOrder`, `swapOrder`, `clearOrders`, `orderCount`).

Done: engine activities, outcome chains in IR, text, checker, compiler and interpreter; `Free` and `Order { urgent }`; starters rewritten without `Idle` (a test enforces it); graph outcome pins and `outcome` ExecRef in `graphOps`/`graphModel`/`graphView`; docs page "Orders & activities". Measured: base income unchanged; Harvester about 0.17 cycles/tick (16.8 in the polling language).
M10 done (2026-10-20): `emit` statement, capitalised own events (ids from 64, max 16, 4 values), `Op.Emit`, graph emit node and own-event blocks.
Also done (2026-10-20, by request): joined text with `+` (run-time templates, `Op.Concat`), and radio / laser link modules with the `Message` event.
M11 engine done (2026-10-20): `flow/blocks.ts` registry (TakeOrders, RechargeWhenLow, ReviveFlatUnits, HarvestLoop, BuildJobs, RepairJobs, MaintainNearby, EngageEnemies, Resupply, RallyPoint, DispatchHarvesters, StorageController, RadarPing), `FlowDoc.blocks` with `use(Block, { settings })` in text, expansion into plain handlers at check and compile time (ids `<use>~<id>`), `expandOne` for Expand, every starter class is blocks only (a test enforces it). Only `Charged` and `Delivered` are emitted by blocks so far (TakeOrders cannot emit OrderFinished: finishing an order is the engine's job).
M12 done (2026-10-20): block cards with settings and Expand, palette group Blocks, template chooser, blocks-first layout, docs page. Left for the readability review with the user: whether the cards read well, whether outcome pins/emit wires need arrows from a block to the `on(Name)` block that hooks it, and a settings inspector panel (settings are on the card for now).

---

# Unit size tiers (done 2026-10-24)

Asked for (2026-10-20): unit sizes both larger and smaller than the original three (light, medium, heavy), without breaking the paradigms (part catalogue, flyweight blueprints, deterministic engine, designs referencing parts by id). The first proposal (point-like units, a `SIZE` constant, a 2-slot micro) is superseded by what was built, below.

| S | Deliverable | Status |
|---|---|---|
| **S1** | Factory modules limit chassis size; HQ has 2 modules; Light / Vehicle / Heavy Factory classes | done 2026-10-20 |
| **S2** | Tier ladder with Micro, Super-heavy, Colossus chassis, `radius` on the part, rendering and separation from `radius`, designer and docs | done 2026-10-24 |
| **S3** | Heavy modules and starters, tier-aware balance check, size queries in programs | done 2026-10-24 (a Colossus beats 10 scouts and its own cost in scouts) |
| **S4** | Clearance-aware pathing per tier | done 2026-10-24 (a Colossus never plans through a 1- or 2-tile gap) |

## As built: tiers, legs, terrain height (2026-10-24, agent A1)

The user asked for Micro, Super-heavy and Colossus chassis plus modules to go with them, **legs** that climb some rock (light legs 1 deep into a wall, heavy legs 2 deep, colossus legs any height, slowly), and a **height map** so cliffs exist and "what height am I on" is a lookup.

- **Height map.** `Terrain.heights` (one byte per cell, read with `heightAt`): 0 = open ground, 1..9 = rock. Generated rock gets its depth (steps to the nearest open cell, so the rim is 1 and the core of a big outcrop is higher); some outcrops are **cliffs** whose height starts at `CLIFF_HEIGHT` (3) right at the edge, so only colossus legs and rotors cross them. `passable` stays as "height 0" for everything that only knows wheels (buildings, spawning, fog, the map preview). The wire form is one digit per cell, the height ('0' open), replacing the old '1'/'0'; the same form is what the Tiled editor writes into `map.terrain`, so drawn levels can have cliffs.
- **Mobility** = `{ climb, clearance }` from the blueprint. `climb` is the highest rock a unit may enter (0 wheels and tracks, 1 `legs.light`, 2 `legs.heavy`, 9 `legs.colossus`). Legs and wheels (and rotors) do not mix. On rock a legged unit moves at `CLIMB_SPEED_PERMILLE` of its speed. Buildings block every ground unit.
- **Tier ladder.** `size` is the tier: 0 Micro, 1 Light, 2 Medium, 3 Heavy, 4 Super-heavy, 5 Colossus (the long chassis are 1/2/3). Factory modules for full speed = `max(1, size)`, so light/medium/heavy keep needing 1/2/3. A **Titan Works** starter building has 5 factory modules. `PartDef.radius` (tiles) on chassis decides the drawn size, separation (`radius a + radius b + SEPARATION_GAP`) and edge distance (weapons and docking reach the hull, not the centre).
- **Clearance (S4).** `clearance` = cells a unit needs clear on each side of its centre, `ceil(radius - 0.5)`: 0 up to Heavy, 1 for Super-heavy and Colossus (a 3-wide corridor). A per-climb Chebyshev distance map (cached on `Terrain.version`) answers it; units with clearance 0 and climb 0 use the old fast path. A unit that starts in a tight spot may squeeze out through tight cells, but never enter one from open space.
- **Programs.** Queries `size()` (own tier; a constant cannot differ per unit), `unitSize(h)` (a known unit's tier, -1 otherwise), `climb()` and `heightAt(x, y)`, plus constants `SIZE_MICRO` ... `SIZE_COLOSSUS`. Micro has 3 slots (a CPU and two modules), not 2.
- **S3 modules**: `motor.huge`, `legs.light` / `legs.heavy` / `legs.colossus`, `battery.large` (mobile), `cargo.hold`, `cannon.siege`, `gun.rotary`, `armor.heavy` (most with a `minSize`); starter classes Titan Works, Mite (micro scout), Strider (light legs), Walker (heavy legs), Juggernaut (super-heavy), Colossus. `MAX_CLASSES_PER_PLAYER` is 48.

Still open (pick up here; claim in `AGENTS.md`):
1. **Bots field the new tiers** (`bot.ts`): a bot never builds a Titan Works, legs or big hulls.
2. **Unit-cap weight per tier** (a colossus counting as several units) if micro swarms hurt in play-tests.
3. **Art**: hull silhouettes come from drive x chassis tier, walkers animate their legs, turrets aim, wind rotors spin and harvesters spark (2026-10-24, `art.ts`, `renderer.ts`, `sparks.ts`); still procedural placeholders. Open: spinning helicopter rotors, scrolling tracks, role hints on the hull (gun, cargo, arm are only drawn on top of it now), turrets that track a locked target before the first shot (needs the target networked or a `Lock` event), a broken-module look (smoke, dangling legs), sounds for `Break` and `Harvest`, and height is shading plus a cliff rim only (no shadow direction).

### Module damage: open follow-ups (done 2026-10-24: broken mask, aimed fire, repair order)

1. **Bots and starter programs**: none of them uses `config.aim` or `brokenOf` yet. Fighters could aim at `M_MOTOR` against walkers or `M_WEAPON` against turrets; repair drones could prefer units with broken modules.
2. **Balance**: integrity numbers (25 + 6 per mass, legs 12 / 30 / 100) are a first guess; every hit now wears a random module. Measure how often units lose a CPU / gun in a normal match.
3. **Per-module state on the wire**: only the broken bit is networked; clients cannot show partly worn modules. A `health %` per module would need a compact delta.
4. **Buildings**: factory, generator and other building modules break the same way; check a broken factory or silo is clear in the UI (the modules panel lists it, nothing else does).
4. Flying units ignore height entirely (by design for now; revisit if tall cliffs should block low flyers).

## Sound: combat and explosion effects (planned 2026-10-24)

Review of `client/src/sound.ts` found overlapping voices work (each `play()` has its own source and gain nodes, nodes are released on `ended`). A fixed limiter now sits after the master gain. Still to do:

1. ~~Give the new tags limits~~ (done: `combat.shot*`, `combat.hit*`, `death.unit` and `death.building` have `cooldownMs` / `maxVoices` in `sound/sound_manifest.json`). Give any new combat or explosion tag the same before hooking it; both default to 0 (unlimited).
2. **Hook the events** in `gameSounds.ts`: the missile burst, `combat.shot.missile` (tag exists, no files), `SimEvent.Build` and `Charge`.
3. **Global voice cap** (only if a big fight still sounds muddy): when total live voices pass ~32, drop the quietest or farthest new sound. Needs a shared voice count in `SoundPlayer`, not per pool.
4. **First-play drops**: a sound is skipped if its file is still decoding (the first one after load can be missing). Option: await `decode` for tags marked important.
5. A `play()` test would need an `AudioContext` stub; today only `soundbank` is tested.

## Credits and options (2026-10-24)

- Credits roll (`renderCredits` in `lobby.ts`) lists people (`CREDIT_PEOPLE`), music (`GET /music`) and sound effects (`GET /sound`). Add anyone who contributes there.
- `client/src/settings.ts` holds client-only settings (today: reduce motion, stored in `wst-reduce-motion`, sets `data-reduce-motion` on `<html>`). New motion should key off that attribute in CSS or `reduceMotion()` in code. Not yet honoured by the in-game renderer (screen shake, particles, build sparks): possible follow-up.
- Credits follow-ups: the roll now always scrolls with a Pause / Resume button (no hover pause). If the roll grows long, consider a skip-to-top control. Agents who add a substantial feature can add a line to `CREDIT_PEOPLE`; keep roles short.

## Engine review fixes (2026-10-24, review by agent A2)

From the "Engine and flow pass" in `REVIEW.md`. **Done** (A2, 2026-10-24; details in `PROGRESS.md`, tests in `engine/test/hardening.test.ts` and `server/test/match.test.ts`): 1, player programs can no longer crash the server; 2, orders are never lost to a full queue; 3, the server-side hotkey check and small fixes. **Parked**: 6, script-system allocations: the sweep cache and nearest-only fast path changed nothing measurable (median tick ~0.5 ms at 256 a side); revisit only with a profile showing the script system matters.

**Open: items 4-5, where the tick spikes come from.** Both touch `path.ts` / `planPath`, which are free to claim (A1 released them). Keep `findPath(..., m)` respecting `Mobility` and the squeeze-out rule (tests in `engine/test/tiers.test.ts`). Each has a waiting `it.fails` test in `engine/test/perf.test.ts`: when the fix lands the test starts passing, which `it.fails` reports as a failure; change it to `it`.

4. **A\* to buildings** (`path.ts`, `planPath`): retarget a blocked goal to the nearest tile next to the target's footprint that the unit fits on (`Terrain.fits` / `nearestFit` with the unit's mobility) before searching, or cut the search off once the best h stops improving. Budget: within 10x of a path to the open tile beside it (today ~100x).
5. **Group orders without a stall** (`simulation.ts` movement, `systems.ts`): a path-planning queue with a per-tick budget (e.g. 8 ms), where units with no plan yet head straight for the goal; then optionally one shared search per command batch (per mobility class, since legs and big hulls plan differently). Build `freeMoveTile`'s taken set once per batch. Budget: no tick over 100 ms after ordering 256 units across Great Plains (today ~460 ms).

Perf budgets (`engine/test/perf.test.ts`, run in CI by `npm test`; `npm run test:perf` runs only them; `WST_PERF_SLACK=3` loosens the wall-clock ones on a slow machine): a 256-a-side match ticks at mean < 15 ms and p95 < 50 ms; 4x the units costs < 8x the median tick; the VM runs > 1000 cycles/ms; a purely reactive unit uses 0 cycles between events (exact); a corner-to-corner path on Badlands takes < 25 ms; a 256-unit order takes < 100 ms to issue. Add a budget with any new system that runs per unit per tick.

## Typed factory modules (decided 2026-10-24, option 2; being implemented)

Problem: one factory module count decided everything, so a big factory built every smaller unit as well and one building could do far too much. Decision: replace `factory.basic` with one factory module per size tier (`factory.micro`, `.light`, `.medium`, `.heavy`, `.super`, `.colossal`, all in the `factory` slot). A building can build a unit only if it has a module of exactly that unit's tier; several tiers need several modules (so a big factory is not automatically a better small one). No more "one module short = a tenth of the speed". Module mass and use grow with the tier. Starter buildings: HQ light + medium (so a Builder can always be made), Light Factory micro + light, Vehicle Factory medium, Heavy Factory heavy, Titan Works super + colossal. The old `factory.basic` id stays as an alias of the light module so saved designs still load (a saved multi-module factory becomes light-tier). The bot Assembler gets every tier. Also in this change: a factory animation while it builds (other players can see it), the full production queue replicated (`Production` component) and shown as an 8-slot icon grid with a progress fill, a `dequeue` command (click a slot to remove it, matter refunded). Open ideas: one production line per module of a tier (parallel builds), tier-specific module costs scaling like units (x2.5), a "can build" legend in the designer.

## Big-unit balance (follow-up to the cost scaling, 2026-10-24)

Super-heavy and colossus units now cost x6.25 and x15.6 (`SIZE_COST_FACTOR` in `rules.ts`) but are no stronger than before, so per matter they lose to many cheap units. Decide with the user whether to buff their hp/damage, shorten their build time, or leave them as expensive status units; then retune a Colossus-vs-scouts fight in `tiers.test.ts`.

## Campaigns (framework done 2026-10-24; triggers still to plan)

- **Tiled objects (next step for the editor):** `editor/` only carries the terrain layer so far (done 2026-10-24). Plan it together with triggers: an object layer for start positions, resource fields, neutral units, pre-placed buildings and named trigger regions, read by `tiled-to-level.mjs` into the level file. On drawn maps the game still places fields, starts and neutrals itself.

Done: `campaigns/` folder (formats in `campaigns/README.md`), `GET /api/v1/campaigns`, `mode=campaign` rooms (`server/src/campaign.ts`, `Match` option `level`), a Campaigns menu with campaign list, level list and briefing screens (`client/src/campaignMenu.ts`), progress in `localStorage` (`wst-campaigns`, levels completed per campaign, `campaignProgress.ts`), end-of-mission buttons (Next mission / Retry) in `ui.ts`. A level is played as solo against the existing bot; victory is the existing "destroy every bot" check, and winning saves progress.

Next, in order:
1. **Trigger system** (needs its own design pass before code; `triggers` in the map files is a reserved array of `{ "id": string, ... }`, kept by the server and never sent to clients). Questions to settle: event sources (tick, area entered, unit/building destroyed, resource held, timer), actions (spawn units, show message, set objective, change the victory rule, play sound), where it runs (server `Match`, deterministic in the tick like commands), how state is saved for replays, whether it reuses the flow language, and an in-level objective list/message UI.
2. **Victory conditions beyond `eliminate`** (survive N minutes, destroy a target, reach an area), driven by triggers; replace the `victory` field's single value.
3. **Scripted starts**: fixed start corner, starting units/buildings/resources, enemy composition and bot aggressiveness per level (today every level uses the random-corner solo setup and the standard bot).
4. ~~Hand-placed terrain~~ (done 2026-10-24: `map.terrain` drawn in Tiled via `editor/`, heights 1-9 included, so drawn levels can have cliffs). What is left is the object layer (first bullet above).
5. **Server-side progress / accounts** if saves should follow the player across browsers (today the client is trusted and progress is per browser; any level can be started by editing the URL).
6. Campaign-specific design/unit restrictions, per-level music tags, a briefing image, and a "campaign complete" screen.
