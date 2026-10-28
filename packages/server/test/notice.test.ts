import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
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

describe('notify() over the wire', () => {
  it('sends a pop-up alert only to the player whose program raised it', () => {
    const match = new Match({ mode: 'coop', mapId: 'small-basin' });
    const sock = new FakeSocket();
    match.join(sock as unknown as WebSocket);
    match.receive(sock as unknown as WebSocket, { t: 'startGame' });
    const tick = () => (match as unknown as { tick(): void }).tick();
    for (let i = 0; i < 3; i++) tick();
    const id = sock.messages.find((m) => m.t === 'welcome')!.playerId as number;
    match.sim.notices.push({ owner: id, kind: 2, text: 'Low power' }, { owner: id + 100, kind: 3, text: 'Not yours' });
    tick();
    const notices = sock.messages.filter((m) => m.t === 'notice');
    expect(notices).toEqual([{ t: 'notice', kind: 2, text: 'Low power' }]);
    expect(match.sim.notices).toEqual([]);
  });
});
