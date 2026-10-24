# Deployment

[← Back to the README](../README.md)

## Running locally

Requires Node 24+ (see `.nvmrc`) and npm 11.

```sh
npm install
npm run dev        # client on http://localhost:5173; /api/v1/* proxies to the server on port 8080
npm test           # engine + client tests (VM, pathing, energy, construction, orders, buttons, fog, sandbox,
                   # design files, docs, diff, sparklines, turrets)
npm run typecheck
```

## Docker

Requires Docker with Compose.

```sh
docker compose up
```

By default, Compose pulls the latest client and server images from GHCR. Use `docker compose up --build` to build both targets from the current checkout instead; the image has no `.git`, so pass the version shown on the main menu with `GIT_HASH=$(git rev-parse --short HEAD) GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD) docker compose up --build` (the published images get it from the CI workflow; without it the menu shows `unknown`). Set `IMAGE_TAG` to pull another published tag. Open `http://localhost:8081`. Compose publishes only the client port; its Nginx forwards `/api/v1/*` to the private game server, including WebSocket upgrades at `/api/v1/ws`. The room-list endpoint is `/api/v1/rooms`. For `nginx-proxy`, route the host to the client container on port 80. Set `CLIENT_PORT` to change the local published port. The client derives HTTP and WebSocket endpoints from the current origin, using `wss` on HTTPS. Set `VITE_SERVER_URL` only when the WebSocket endpoint is hosted elsewhere; it must include `/api/v1/ws`. Set `FOG=off` to disable fog of war. 

**Behind another proxy (e.g. nginx-proxy-manager):** the server limits sockets (30) and open rooms (5) per client address, so it needs the real address, not the proxy's. The client container's Nginx takes it from `X-Forwarded-For` (skipping private addresses, `set_real_ip_from` in `docker/nginx.conf`) and passes it on as `X-Real-IP`; the server trusts that header only when the connection comes from a private address. Make sure the outer proxy sends `X-Forwarded-For` (nginx-proxy-manager does), and if it sits behind a CDN, configure the real-IP header there too. If addresses still all look the same, raise or turn off the limits with `WST_MAX_SOCKETS_PER_ADDRESS` and `WST_MAX_ROOMS_PER_ADDRESS` (`0` = no limit; Compose passes both through).

### Background music

Music is not part of the repository: put the audio files and their `music_manifest.json` in a folder (default `./music`, or set `MUSIC_PATH`), which Compose mounts read-only into the server at `/app/music`. Outside Docker the server reads `./music` in the project root, or `MUSIC_DIR`. Each manifest entry's `tags` pick when it plays: `menu` (main menu), `idle` (in a match) and `combat` (while anything in view is losing health, plus 15 s). When a track ends another is chosen at random from the current tag. The server lists tracks at `/api/v1/music` and streams them from `/api/v1/music/<file>`; with no folder there is simply no music.

```sh
docker compose down
```

The `Publish Docker images` GitHub Action runs tests and typechecking on pull requests, then publishes the Dockerfile's two targets to GHCR on pushes to `main` and `v*` tags. The images are `ghcr.io/johnvidler/webstrategything-client` and `ghcr.io/johnvidler/webstrategything-server`; each gets branch/tag and short-SHA tags, and `latest` is updated from the default branch. The client and server images must run on the same Docker network so the client Nginx proxy can reach the server at `server:8080`.

### Sound effects

Sound effects live in `./sound` with `sound_manifest.json` and are copied into the server image (set `SOUND_DIR` to read another folder, or mount one over `/app/sound`). The manifest is an array of sound-file entries (`filename`, `name`, `author`, `license`, `url`, `tags`, optional `volume`, `pitchVariance`, `loop`) and tag entries (`{ "tag": "ui.click", "use": [] }`, optionally `use`, `only`, `cooldownMs`, `maxVoices`, `positional`). Every event the game can raise already has a tag entry that plays nothing: add a sound entry carrying the tag, or point a tag at another with `use`. See [SOUND_EVENTS.md](../SOUND_EVENTS.md).
