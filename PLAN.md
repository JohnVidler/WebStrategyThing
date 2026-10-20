# flowcode plan: event-driven visual and textual programming

Branch: `flowcode`. Status: **M0-M5 done** (see section 12 and "What changed from the plan" below); M6 (cost UI) and M7 (polish) remain. Update this file as decisions change.

Decisions already made (section 14): automatic `Idle` event, configuration nodes visibly separate from actions, handlers suspend when out of cycles, literals use memory not energy, and the old text language is retired on this branch (it stays on `main`).

## 1. Goals

1. Replace polling text scripts (the whole program reruns every pass, `sleep()` to idle) with **event-driven programs**: a unit does nothing, and pays nothing, until an event it handles arrives.
2. Let players program in **a node graph (Unreal Blueprint style) or in TypeScript-syntax text, and swap between them at will**, always in sync, from one underlying model.
3. **CPU cost = nodes executed + arcs traversed** by an event. An event with no handler costs nothing, with no special case.
4. Programs are **plain text**, so they fit the existing JSON paths: `setProgram` (`LIMITS.sourceLength`), design files, `localStorage` history, session storage.
5. The editor is built from **reusable, extensible components**, not hand-rolled DOM.
6. Designer split into two tabs: **Design** (class list, preview, stats, modules) and **Code** (full-panel editor, graph or text).

Non-goals for the first milestone: multiplayer-visible graphs, user-defined functions or subgraphs (but the model must not block them, see section 10), line-of-sight sensing (the sensor events are shaped so it can arrive later, section 4).

The old text language and VM are **removed on this branch**; every existing behaviour is rewritten in the new language (section 9). `main` keeps the old version.

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
- Size: the 8000 character `LIMITS.sourceLength` will be tight for graphs with layout. Plan: raise it to 32000 for flow programs, store layout compactly (integers, short ids), and strip `views` when sending to the server (the server only needs the logic; the owner's copy keeps views).
- Legacy text-script programs (anything not starting with `{"format":"wst-flow"`) keep working through the old VM. See section 9.

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

- Display: the CPU panel shows cycles per event type (rolling), which handlers fired, and the most expensive path. The sandbox test run reports the same.

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
- Each node shows a small cost badge (cycles if it runs) and each handler shows its worst-case path cost; the last test run overlays actual hit counts on nodes and wires (heat-map), so players see where their CPU goes.

## 9. Retiring the old language

The old text language is removed on this branch (it remains on `main`). There is no converter and no dual-language period.

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
- **Unit-to-unit messages:** an event `Message(from, data)` and a `send(h, data)` call, with an energy cost per message; the event model already supports it.
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
| **M6** Cost UI | Badges, handler totals, test-run heat-map, per-event CPU panel in the sidebar, memory meter | Players can see where cycles and memory go |
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
| O5 | Old language | **Retired on this branch**, existing behaviours rewritten in the new language (section 9); `main` keeps the old one. |

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

## Remaining (M6 and M7)

- M6: the per-event CPU panel in the sidebar (cycles per event, dropped events), a test-run heat map on nodes and wires, handler worst-case cost on event nodes (`handlerWorstCase` already computes it).
- M7: sounds for the editor, balance pass on the cost constants (`flow/cost.ts`) and CPU cycles per tick (the harvester now saturates a basic CPU), copy/paste of nodes, a quick-add search on double-click, an error list panel, subgraphs/functions.


---

# Phase 2: event-first programs and higher-level blocks

Status: proposed, not started. Prompted by the first look at the graph: it is a faithful drawing of the old *polling* programs, and polling code is unreadable as a graph (nested branches, queue juggling, `Idle` doing everything). The fix is not a nicer drawing of the same logic; it is to stop writing polling logic. A useful smell test: **if a program hooks `Idle` for its main behaviour, it is wrong.** Starter programs must not use `Idle` at all, except where a periodic check is the point (the storage controller uses `Every`).

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
| **M10** Custom events | `emit` / `on(Name)` in IR, text, runtime and graph | Two blocks of one program talk through an event |
| **M11** Blocks | `use` nodes, template registry with the block list above, settings and hardware limits, `Expand` | Each starter class is expressed as blocks plus small event blocks, passes the same scenarios as now, and no starter uses `Idle` (a test enforces it) |
| **M12** Graph pass | Block cards, causality layout, template chooser, palette groups, inspector for settings, readability review with the user | The user can read and change a starter class in the graph without opening the text |

## Risks and open points

- **Frames across time:** a continuation must see the locals of the call that started the activity. The saved frame is small (event parameters and results, at most a handful of ints), but it counts toward memory and queue capacity.
- **Interrupting and resuming** (recharge in the middle of a harvest) needs an activity stack with a clear rule; proposed: only blocks may push, and they resume what they interrupted.
- **Balance:** activities make busy units nearly free in CPU, so CPU cost and `cyclesPerTick` need a pass.
- **Old programs again:** this removes the polling style (`approach`, `harvest`, `dock`, `build` calls become activity starts), so the starters are rewritten a second time, and saved designs from the current branch need the same replacement treatment as before.

## Phase 2: decisions and status (2026-10-20)

Decided with the user: completion is reported by **outcome pins** (a node per way an activity can end); reusable behaviours are a **built-in library** of templates with settings, each able to `Expand` into plain event blocks; **orders start activities directly** (the task queue is no longer a program concept; queued orders are a simple order list read with `nextOrder`, `swapOrder`, `clearOrders`, `orderCount`).

Done: engine activities, outcome chains in IR, text, checker, compiler and interpreter; `Free` and `Order { urgent }`; starters rewritten without `Idle` (a test enforces it); graph outcome pins and `outcome` ExecRef in `graphOps`/`graphModel`/`graphView`; docs page "Orders & activities". Measured: base income unchanged; Harvester about 0.17 cycles/tick (16.8 in the polling language).
Next: M10 custom events, M11 block library, M12 graph pass.
