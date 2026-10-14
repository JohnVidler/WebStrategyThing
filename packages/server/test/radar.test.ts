import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { TILE } from '@wst/engine';
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

describe('radar over the wire', () => {
  it('reports contacts the player cannot otherwise see', () => {
    const match = new Match({ mode: 'coop', mapId: 'small-basin' });
    const sock = new FakeSocket();
    match.join(sock as unknown as WebSocket);
    const tick = () => (match as unknown as { tick(): void }).tick();
    for (let i = 0; i < 3; i++) tick();
    const id = sock.messages.find((m) => m.t === 'welcome')!.playerId as number;
    const sim = match.sim;
    const bp = sim.blueprints.all().find((b) => b.owner === id && b.name === 'Radar Tower')!;
    expect(bp).toBeDefined();
    const tower = sim.spawnStructure(bp, 20, 20);
    expect(tower).toBeGreaterThanOrEqual(0);
    sim.energy.f.amount[tower] = sim.stats(tower).energyCapacity;
    for (let i = 0; i < 60; i++) tick();
    const pulses = sock.messages.filter((m) => m.t === 'radar');
    expect(pulses.length).toBeGreaterThan(0);
    expect(TILE).toBeGreaterThan(0);
    expect((pulses[0].contacts as number[][]).length).toBeGreaterThan(0);
  });
});
