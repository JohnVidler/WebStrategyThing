import { connect } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { clientAddress, parseTarget, startServer, type RunningServer } from '../src/server';

let server: RunningServer;
beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  server = await startServer(0);
});
afterAll(async () => {
  await server.close();
  vi.restoreAllMocks();
});

/** Sends the bytes as they are and resolves with whatever the server answers before it closes the connection. */
function raw(request: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(server.port, '127.0.0.1', () => socket.write(request));
    let text = '';
    socket.on('data', (d) => (text += d.toString()));
    socket.on('close', () => resolve(text));
    socket.on('error', () => resolve(text));
    setTimeout(() => socket.destroy(), 1500).unref();
  });
}

const get = (path: string) => fetch(`http://127.0.0.1:${server.port}${path}`);

/** Opens a socket and resolves with how it ended. */
function closing(path: string, act?: (ws: WebSocket) => void): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}${path}`);
    ws.on('open', () => act?.(ws));
    ws.on('error', () => {});
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

describe('request targets', () => {
  it('parseTarget accepts plain paths and refuses the rest without throwing', () => {
    expect(parseTarget('/api/v1/rooms?x=1')?.pathname).toBe('/api/v1/rooms');
    for (const bad of [undefined, '', '//', '//evil.example/x', '*', 'http://x/', 'rooms']) expect(parseTarget(bad)).toBeUndefined();
  });

  it('clientAddress believes X-Real-IP only from a private address', () => {
    const headers = { 'x-real-ip': '203.0.113.9' };
    expect(clientAddress({ socket: { remoteAddress: '172.18.0.2' }, headers } as never)).toBe('203.0.113.9');
    expect(clientAddress({ socket: { remoteAddress: '::ffff:10.0.0.5' }, headers } as never)).toBe('203.0.113.9');
    expect(clientAddress({ socket: { remoteAddress: '198.51.100.7' }, headers } as never)).toBe('198.51.100.7');
    expect(clientAddress({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': 'not an ip' } } as never)).toBe('127.0.0.1');
  });
});

describe('a real server', () => {
  it('answers a bad request target with 400 and keeps serving', async () => {
    expect(await raw('GET // HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')).toMatch(/^HTTP\/1\.1 400/);
    expect(await raw('OPTIONS * HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')).toMatch(/^HTTP\/1\.1 400/);
    expect((await get('/api/v1/rooms')).status).toBe(200);
    expect((await get('/nothing')).status).toBe(404);
  });

  it('refuses the same bad target as a WebSocket upgrade without crashing', async () => {
    const answer = await raw('GET // HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
    expect(answer).toMatch(/^HTTP\/1\.1 (101|400)/);
    expect((await get('/api/v1/rooms')).status).toBe(200);
  });

  it('closes an unknown endpoint and an unknown room, and keeps serving', async () => {
    expect((await closing('/elsewhere')).code).toBe(1008);
    expect((await closing('/api/v1/ws?room=bad%20name')).code).toBe(1013);
    expect((await get('/api/v1/rooms')).status).toBe(200);
  });

  it('survives a frame over the size limit', async () => {
    const ended = await closing('/api/v1/ws?room=huge', (ws) => ws.send('x'.repeat(2 * 1024 * 1024)));
    expect(ended.code).toBe(1009);
    expect((await get('/api/v1/rooms')).status).toBe(200);
  });

  it('survives malformed and unexpected messages', async () => {
    const ended = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/v1/ws?room=junk`);
      ws.on('open', () => {
        ws.send('{not json');
        ws.send(Buffer.from([1, 2, 3]));
        ws.send(JSON.stringify({ t: 'order', units: 'nope' }));
        ws.send(JSON.stringify({ t: 'startGame' }));
        setTimeout(() => ws.close(1000), 100);
      });
      ws.on('close', (code) => resolve(code));
    });
    expect(ended).toBe(1000);
    expect((await get('/api/v1/rooms')).status).toBe(200);
  });

  it('drops a client that floods it with messages', async () => {
    const ended = await closing('/api/v1/ws?room=flood', (ws) => {
      for (let i = 0; i < 2000; i++) ws.send('{}');
    });
    expect(ended).toEqual({ code: 1008, reason: 'Too many messages' });
    expect((await get('/api/v1/rooms')).status).toBe(200);
  });

  it('counts menu sockets in the online number', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/v1/ws?menu=1`);
    await new Promise((resolve) => ws.on('open', resolve));
    expect(((await (await get('/api/v1/menu')).json()) as { players: number }).players).toBeGreaterThanOrEqual(1);
    ws.close();
  });
});
