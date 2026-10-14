import { createServer } from 'node:http';
import { DEFAULT_PORT, mapById, parseClientMessage } from '@wst/engine';
import { WebSocketServer } from 'ws';
import { Match } from './match';

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const MAX_ROOMS = 20;
const API_ROOT = '/api/v1';
const ROOMS_PATH = `${API_ROOT}/rooms`;
const SOCKET_PATH = `${API_ROOT}/ws`;
/** How long an empty room is kept before it is shut down. */
const EMPTY_ROOM_MS = 60_000;
const NAME = /^[A-Za-z0-9_-]{1,24}$/;
const TOKEN = /^[A-Za-z0-9_-]{8,64}$/;

// Large enough for a full design set (up to 80 classes with programs).
// The same port serves the versioned room-list API and WebSocket endpoint.
const http = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (req.method === 'GET' && path === ROOMS_PATH) {
    const list = [...rooms]
      .filter(([, { match }]) => match.playerCount > 0)
      .map(([name, { match }]) => ({
      name,
      mapId: match.map.id,
      mapName: match.map.name,
      width: match.map.width,
      height: match.map.height,
      players: match.playerCount,
      capacity: match.capacity,
      over: match.isOver,
      elapsed: match.elapsedSeconds,
      paused: match.pauseReasons.length > 0,
      scores: match.roster(),
      }));
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(JSON.stringify(list));
    return;
  }
  res.writeHead(404).end();
});
const wss = new WebSocketServer({ server: http, maxPayload: 1024 * 1024 });
http.listen(port);

// Each room is its own match, created on first use: connect with ws://host:port/?room=name.
// FOG=off sends everything to everyone (handy for debugging).
const rooms = new Map<string, { match: Match; emptySince: number | undefined }>();

function roomFor(name: string, mapId?: string): { match: Match; emptySince: number | undefined } | undefined {
  let room = rooms.get(name);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) return undefined;
    room = { match: new Match({ fog: process.env.FOG !== 'off', mapId: mapById(mapId).id }), emptySince: undefined };
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

wss.on('connection', (socket, request) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname !== SOCKET_PATH) {
    socket.close(1008, 'Unknown endpoint');
    return;
  }
  const roomName = url.searchParams.get('room');
  const mapId = url.searchParams.get('map') ?? undefined;
  const token = url.searchParams.get('token') ?? undefined;
  const room = roomName && NAME.test(roomName) ? roomFor(roomName, mapId) : undefined;
  if (!room) {
    socket.close(1013, 'No such room');
    return;
  }
  const { match } = room;
  match.join(socket, token && TOKEN.test(token) ? token : undefined);
  console.log(`player connected to "${roomName}" (${match.playerCount} online)`);

  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      return;
    }
    const msg = parseClientMessage(raw);
    if (msg) match.receive(socket, msg);
  });

  socket.on('close', () => {
    match.leave(socket);
    console.log(`player disconnected from "${roomName}" (${match.playerCount} online)`);
  });
});

console.log(`WebStrategyThing server listening on ws://localhost:${port}`);
