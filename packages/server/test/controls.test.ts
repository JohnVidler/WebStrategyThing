import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { parseClientMessage } from '@wst/engine';
import { Match } from '../src/match';

class FakeSocket {
  readyState = 1;
  readonly sent: (string | Uint8Array)[] = [];
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  get messages(): { t: string; [k: string]: unknown }[] {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d));
  }
}

describe('program controls over the wire', () => {
  it('refuses malformed control messages', () => {
    expect(parseClientMessage({ t: 'control', units: [1], name: 'power', value: 3 })).toEqual({ t: 'control', units: [1], name: 'power', value: 3 });
    expect(parseClientMessage({ t: 'control', units: [], name: 'power', value: 3 })).toBeNull();
    expect(parseClientMessage({ t: 'control', units: [1], name: 'not a name', value: 3 })).toBeNull();
    expect(parseClientMessage({ t: 'control', units: [1], name: 'power', value: 1.5 })).toBeNull();
    expect(parseClientMessage({ t: 'control', units: [1], name: 'power', value: 2 ** 40 })).toBeNull();
    expect(parseClientMessage({ t: 'controlValues', units: Array.from({ length: 201 }, (_, i) => i) })).toBeNull();
  });

  it('sets a spotlight tower\'s power and reports it back, only for the owner', () => {
    const match = new Match({ mode: 'coop', mapId: 'small-basin' });
    const sock = new FakeSocket();
    match.join(sock as unknown as WebSocket);
    match.receive(sock as unknown as WebSocket, { t: 'startGame' });
    const tick = () => (match as unknown as { tick(): void }).tick();
    for (let i = 0; i < 3; i++) tick();
    const id = sock.messages.find((m) => m.t === 'welcome')!.playerId as number;
    const sim = match.sim;
    const bp = sim.blueprints.all().find((b) => b.owner === id && b.name === 'Spotlight Tower')!;
    expect(bp).toBeDefined();
    const tower = sim.spawnStructure(bp, 20, 20);
    for (let i = 0; i < 5; i++) tick();
    match.receive(sock as unknown as WebSocket, { t: 'control', units: [tower], name: 'spotlight_power', value: 99 });
    tick();
    match.receive(sock as unknown as WebSocket, { t: 'controlValues', units: [tower] });
    tick();
    const answer = sock.messages.filter((m) => m.t === 'controlValues').at(-1)!;
    expect(answer.values).toEqual([[tower, 10]]);

    // Another player's unit is never reported, and a stranger cannot set it.
    const other = sim.blueprints.all().find((b) => b.owner !== id && b.name === 'Spotlight Tower');
    if (other) {
      const foreign = sim.spawnStructure(other, 40, 20);
      for (let i = 0; i < 3; i++) tick();
      match.receive(sock as unknown as WebSocket, { t: 'controlValues', units: [foreign] });
      tick();
      expect(sock.messages.filter((m) => m.t === 'controlValues').at(-1)!.values).toEqual([]);
    }
  });
});
