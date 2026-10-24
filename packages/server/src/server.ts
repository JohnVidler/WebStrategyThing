import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mapById, parseClientMessage, parseGameMode } from '@wst/engine';
import { WebSocketServer, type WebSocket } from 'ws';
import { Match } from './match';
import { campaignLevel, campaignMap, refreshCampaigns } from './campaign';
import { devToolsEnabled } from './devTools';
import { loadTracks, sendTrack } from './music';
import { loadSounds, sendSound } from './sound';

const MAX_ROOMS = 20;
const API_ROOT = '/api/v1';
const ROOMS_PATH = `${API_ROOT}/rooms`;
const SOCKET_PATH = `${API_ROOT}/ws`;
const MUSIC_PATH = `${API_ROOT}/music`;
const SOUND_PATH = `${API_ROOT}/sound`;
const MENU_PATH = `${API_ROOT}/menu`;
const CAMPAIGNS_PATH = `${API_ROOT}/campaigns`;
void refreshCampaigns();
/** Presence sockets of players who are on the menu rather than in a match. */
const menuSockets = new Set<unknown>();
/** How long an empty room is kept before it is shut down. */
const EMPTY_ROOM_MS = 60_000;
const NAME = /^[A-Za-z0-9_-]{1,24}$/;
const TOKEN = /^[A-Za-z0-9_-]{8,64}$/;
/** Per connection, a burst of messages that refills steadily; a client that outruns it is dropped. */
const MESSAGE_BURST = 200;
const MESSAGES_PER_SECOND = 100;
/** The same for payload bytes (a full design upload is the biggest legitimate message). */
const BYTE_BURST = 4 * 1024 * 1024;
const BYTES_PER_SECOND = 1024 * 1024;
const MAX_MENU_SOCKETS = 2000;
/** A limit from the environment (`0` turns it off), else the default. */
function limit(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return process.env[name] !== undefined && Number.isInteger(n) && n >= 0 ? n || Infinity : fallback;
}
// Per client address, which is only as good as the proxy in front: see clientAddress.
const MAX_SOCKETS_PER_ADDRESS = limit('WST_MAX_SOCKETS_PER_ADDRESS', 30);
const MAX_ROOMS_PER_ADDRESS = limit('WST_MAX_ROOMS_PER_ADDRESS', 5);
const MAX_PAYLOAD = 1024 * 1024;

/** The path and query of a request target, or undefined when it is not a plain absolute path (`//`, `*`, garbage). Never throws. */
export function parseTarget(raw: string | undefined): URL | undefined {
  if (!raw || raw[0] !== '/' || raw[1] === '/') return undefined;
  try {
    return new URL(raw, 'http://localhost');
  } catch {
    return undefined;
  }
}

const PRIVATE_ADDRESS = /^(::ffff:)?(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|^::1$/;
const FORWARDED_ADDRESS = /^[0-9A-Fa-f:.]{1,45}$/;

/** Who is on the other end: the proxy's X-Real-IP, but only when the connection really comes from a private address (the proxy). */
export function clientAddress(request: Pick<IncomingMessage, 'socket' | 'headers'>): string {
  const direct = request.socket.remoteAddress ?? 'unknown';
  const forwarded = request.headers['x-real-ip'];
  return PRIVATE_ADDRESS.test(direct) && typeof forwarded === 'string' && FORWARDED_ADDRESS.test(forwarded) ? forwarded : direct;
}

function failed(res: ServerResponse): void {
  if (res.headersSent) res.destroy();
  else res.writeHead(500).end();
}

/** A token bucket: `take` says whether the request fits the allowance. */
class Allowance {
  private level: number;
  private last = Date.now();
  constructor(
    private readonly burst: number,
    private readonly perSecond: number,
  ) {
    this.level = burst;
  }
  take(cost: number): boolean {
    const now = Date.now();
    this.level = Math.min(this.burst, this.level + ((now - this.last) * this.perSecond) / 1000);
    this.last = now;
    if (this.level < cost) return false;
    this.level -= cost;
    return true;
  }
}

// Large enough for a full design set (up to 80 classes with programs).
// The same port serves the versioned room-list API and WebSocket endpoint.
const http = createServer((req, res) => {
  const url = parseTarget(req.url);
  if (!url) {
    res.writeHead(400).end();
    return;
  }
  const path = url.pathname;
  if ((req.method === 'GET' || req.method === 'HEAD') && path === MUSIC_PATH) {
    void loadTracks()
      .then((tracks) => {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(tracks));
      })
      .catch(() => failed(res));
    return;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && path.startsWith(`${MUSIC_PATH}/`)) {
    let file = '';
    try {
      file = decodeURIComponent(path.slice(MUSIC_PATH.length + 1));
    } catch {
      // malformed escape: falls through to 404
    }
    void sendTrack(req, res, file).catch(() => failed(res));
    return;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && path === CAMPAIGNS_PATH) {
    // Re-read on every request, so edits to the campaigns folder show without a restart.
    void refreshCampaigns()
      .then(({ info }) => {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(info));
      })
      .catch(() => failed(res));
    return;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && path === SOUND_PATH) {
    void loadSounds()
      .then((bank) => {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(bank));
      })
      .catch(() => failed(res));
    return;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && path.startsWith(`${SOUND_PATH}/`)) {
    let file = '';
    try {
      file = decodeURIComponent(path.slice(SOUND_PATH.length + 1));
    } catch {
      // malformed escape: falls through to 404
    }
    void sendSound(req, res, file).catch(() => failed(res));
    return;
  }
  if (req.method === 'GET' && path === MENU_PATH) {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ players: menuSockets.size }));
    return;
  }
  if (req.method === 'GET' && path === ROOMS_PATH) {
    const list = [...rooms]
      // Single-player rooms are private: they never appear in the list.
      .filter(([, { match }]) => match.playerCount > 0 && match.mode !== 'solo' && match.mode !== 'campaign')
      .map(([name, { match }]) => ({
      name,
      mapId: match.map.id,
      mapName: match.map.name,
      width: match.map.width,
      height: match.map.height,
      players: match.playerCount,
      mode: match.mode,
      capacity: match.capacity,
      over: match.isOver,
      elapsed: match.elapsedSeconds,
      paused: match.pauseReasons.length > 0,
      lobby: match.inLobby,
      scores: match.roster(),
      }));
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(JSON.stringify(list));
    return;
  }
  res.writeHead(404).end();
});
const wss = new WebSocketServer({ server: http, maxPayload: MAX_PAYLOAD });
// Without a listener an 'error' on the server (or on any socket) is an uncaught exception that ends every match.
wss.on('error', (err) => console.error('websocket server error:', err));

// Each room is its own match, created on first use: connect with ws://host:port/?room=name.
// FOG=off sends everything to everyone (handy for debugging).
interface Room {
  match: Match;
  emptySince: number | undefined;
  /** Who opened it, for the per-address room limit. */
  creator: string;
}
const rooms = new Map<string, Room>();
/** Open sockets per client address. */
const socketsByAddress = new Map<string, number>();

function roomFor(address: string, name: string, mapId?: string, mode?: string, campaign?: string, levelId?: string): Room | undefined {
  let room = rooms.get(name);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) return undefined;
    let opened = 0;
    for (const r of rooms.values()) if (r.creator === address) opened++;
    if (opened >= MAX_ROOMS_PER_ADDRESS) return undefined;
    const parsed = parseGameMode(mode);
    // A campaign room needs a level that exists; the client's saved progress is trusted (it is a single-player game).
    const level = parsed === 'campaign' ? campaignLevel(campaign ?? '', levelId ?? '') : campaignMap(mapId ?? '');
    if (parsed === 'campaign' && !level) return undefined;
    room = { match: new Match({ fog: process.env.FOG !== 'off', mapId: mapById(mapId).id, mode: parsed, level, devTools: devToolsEnabled() }), emptySince: undefined, creator: address };
    room.match.start();
    rooms.set(name, room);
    console.log(`room "${name}" opened`);
  }
  return room;
}

setInterval(() => {
  const now = Date.now();
  for (const [name, room] of rooms) {
    if (!room.match.empty) {
      room.emptySince = undefined;
    } else if (room.emptySince === undefined) {
      room.emptySince = now;
    } else if (now - room.emptySince > EMPTY_ROOM_MS) {
      room.match.stop();
      rooms.delete(name);
      console.log(`room "${name}" closed`);
    }
  }
}, 5000).unref();

function byteLength(data: Buffer | ArrayBuffer | Buffer[]): number {
  if (Array.isArray(data)) return data.reduce((n, b) => n + b.length, 0);
  return data.byteLength;
}

/** Counts the socket against its address and applies the per-connection message budget; returns the guard for each message. */
function admit(socket: WebSocket, address: string): ((data: Buffer | ArrayBuffer | Buffer[]) => boolean) | undefined {
  const open = socketsByAddress.get(address) ?? 0;
  if (open >= MAX_SOCKETS_PER_ADDRESS) {
    socket.close(1013, 'Too many connections');
    return undefined;
  }
  socketsByAddress.set(address, open + 1);
  socket.once('close', () => {
    const left = (socketsByAddress.get(address) ?? 1) - 1;
    if (left > 0) socketsByAddress.set(address, left);
    else socketsByAddress.delete(address);
  });
  const messages = new Allowance(MESSAGE_BURST, MESSAGES_PER_SECOND);
  const bytes = new Allowance(BYTE_BURST, BYTES_PER_SECOND);
  return (data) => {
    if (messages.take(1) && bytes.take(byteLength(data))) return true;
    socket.close(1008, 'Too many messages');
    return false;
  };
}

function accept(socket: WebSocket, request: IncomingMessage): void {
  const url = parseTarget(request.url);
  if (!url || url.pathname !== SOCKET_PATH) {
    socket.close(1008, 'Unknown endpoint');
    return;
  }
  const address = clientAddress(request);
  const roomName = url.searchParams.get('room');
  if (!roomName && url.searchParams.get('menu') === '1') {
    // Presence only: someone sitting on the menu, not in any match.
    if (menuSockets.size >= MAX_MENU_SOCKETS) {
      socket.close(1013, 'Too many connections');
      return;
    }
    const allowed = admit(socket, address);
    if (!allowed) return;
    menuSockets.add(socket);
    // The menu socket says nothing; anything it does send only counts against its budget.
    socket.on('message', (data) => void allowed(data));
    socket.on('close', () => menuSockets.delete(socket));
    return;
  }
  const allowed = admit(socket, address);
  if (!allowed) return;
  const mapId = url.searchParams.get('map') ?? undefined;
  const mode = url.searchParams.get('mode') ?? undefined;
  const token = url.searchParams.get('token') ?? undefined;
  const room = roomName && NAME.test(roomName) ? roomFor(address, roomName, mapId, mode, url.searchParams.get('campaign') ?? undefined, url.searchParams.get('level') ?? undefined) : undefined;
  if (!room) {
    socket.close(1013, 'No such room');
    return;
  }
  const { match } = room;
  match.join(socket, token && TOKEN.test(token) ? token : undefined);
  console.log(`player connected to "${roomName}" (${match.playerCount} online)`);

  socket.on('message', (data, isBinary) => {
    if (!allowed(data)) return;
    if (isBinary) return;
    try {
      const msg = parseClientMessage(JSON.parse(data.toString()));
      if (msg) match.receive(socket, msg);
    } catch (err) {
      // Malformed JSON, or a bug triggered by this one message: it must not end the process.
      if (!(err instanceof SyntaxError)) console.error(`message from a player in "${roomName}" failed:`, err);
    }
  });

  socket.on('close', () => {
    try {
      match.leave(socket);
    } catch (err) {
      console.error(`leaving "${roomName}" failed:`, err);
    }
    console.log(`player disconnected from "${roomName}" (${match.playerCount} online)`);
  });
}

wss.on('connection', (socket, request) => {
  // First, so that no error on this socket (an over-size frame, a reset) can go unhandled and end the process.
  socket.on('error', () => {});
  try {
    accept(socket, request);
  } catch (err) {
    console.error('connection failed:', err);
    socket.close(1011, 'Server error');
  }
});

export interface RunningServer {
  readonly port: number;
  close(): Promise<void>;
}

/** Listens on `port` (0 picks a free one). */
export function startServer(port: number): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, () => {
      http.off('error', reject);
      const actual = (http.address() as AddressInfo).port;
      console.log(`WebStrategyThing server listening on ws://localhost:${actual}`);
      resolve({
        port: actual,
        close: () =>
          new Promise<void>((done) => {
            for (const client of wss.clients) client.terminate();
            for (const { match } of rooms.values()) match.stop();
            rooms.clear();
            menuSockets.clear();
            wss.close(() => http.close(() => done()));
            http.closeAllConnections();
          }),
      });
    });
  });
}
