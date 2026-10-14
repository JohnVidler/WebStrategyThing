# WebStrategyThing

A browser RTS where the player gives the orders and **scripts decide the behaviour**. You select units and right-click as in StarCraft or Total Annihilation, but each order only lands in the unit's **task queue**: the program written for that unit's **class** decides how (and whether) to carry it out. Units and buildings are designed from the same modules: compute (cycles per tick), memory, sensors, motors, batteries, generators and more. Every module costs energy to use, units recharge at charging pads (or from each other), buildings share power through automatically linked networks, and resources live in silos that builders draw on to construct new buildings.

## Documentation

- [Client and controls](docs/client.md): playing, the designer, saved designs and the docs overlay
- [Game design and engine](docs/game.md): ECS, scripts, energy, construction, weapons, bots, language reference
- [Server](docs/server.md): authority, rooms, fog of war, reconnecting, music streaming
- [Deployment](docs/deployment.md): local running, Docker, CI images, music folder

## Quick start

```sh
npm install
npm run dev        # client on http://localhost:5173; /api/v1/* proxies to the server on port 8080
npm test           # engine + client tests (VM, pathing, energy, construction, orders, buttons, fog, sandbox,
                   # design files, docs, diff, sparklines, turrets)
npm run typecheck
```

See [deployment](docs/deployment.md) for Docker, and open the client in two browser tabs for two players.

## Stack

| Concern    | Choice | Why |
|------------|--------|-----|
| Rendering  | **PixiJS v8** (WebGL/WebGPU 2D) | Fast sprite batching, TypeScript-first, and only a renderer. The simulation must run headless on the server, so a full engine (Phaser and similar) would give us little we could use. |
| Simulation | Custom SoA ECS in TypeScript (`@wst/engine`) | Runs the same code on Node and in the browser, uses no per-entity objects, and its schemas double as the wire format. |
| Unit code  | Custom bytecode VM + tiny language | Exact, deterministic cycle metering, so compute is a game resource. Programs are shared per class (flyweight). |
| Transport  | `ws` (server) / native WebSocket (client) | Binary frames for tick deltas, JSON text frames for rare control messages. |
| Code editor | CodeMirror 6 | Modular and TypeScript-native; a small custom language mode plus autocomplete, hover docs and lint driven by the game's own compiler. |
| Tooling    | npm workspaces, Vite, tsx, Vitest | |

## Layout

```
packages/
  engine/   headless, deterministic core shared by server + client
    ecs/      component schemas, SoA stores, World (entities, handles, queries, change tracking)
    vm/       compiler (source -> bytecode), VM (metered interpreter), Program/HostApi types
    game/     parts, blueprints, components, terrain + A*, power networks, unit API, action buttons,
              vision, systems, map setup, Simulation, designer sandbox, design files
    net/      binary tick codec, JSON protocol + validation
  server/   authoritative match loop: command queue -> step -> broadcast delta
  client/   mirror World + PixiJS renderer + DOM play UI (action grid, info bar, fog, charging zones,
            selection sparklines, saved designs); designer overlay
            with a CodeMirror script editor, upload diffs and sandbox test runs (loaded on demand);
            docs.html = generated script API docs
```

## Extension points / next steps

- **Fog follow-ups:** remembered enemy buildings in explored areas, and a spatial-grid visibility pass if unit counts grow.
- **Script-driven buttons:** let scripts enable, disable or relabel their buttons at runtime.
- **Design sets:** several named loadouts per browser.
- **Scaling the sim:** cached or archetype queries in `World.query`, and moving each match into a `worker_thread`.
- **Language:** `break`/`continue`, user functions, and per-unit messaging (`send(handle, value)`) as builtins with costs.
- **Bandwidth:** per-field dirty masks if components grow wide.
- **Reconnect:** a client that has been away longer than the grace period joins as a new player; a manual "rejoin" could be offered instead.
