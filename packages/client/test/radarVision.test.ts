import { describe, expect, it } from 'vitest';
import { Position, Terrain, TILE, Unit, type BlueprintStats } from '@wst/engine';
import { ClientState } from '../src/state';

const blip = (tx: number, ty: number) => ({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, owner: 1, structure: false, blueprint: 0, born: 0 });

function makeState(): ClientState {
  const s = new ClientState();
  s.terrain = new Terrain(40, 40);
  s.fog = true;
  s.myId = 1;
  s.radarBlips = [blip(5, 5), blip(30, 30)];
  return s;
}

/** An own unit at tile (tx, ty) so updateVision() sees something. */
function addViewer(s: ClientState, tx: number, ty: number, owner = 1): void {
  const e = s.world.create();
  s.world.store(Unit).add(e, { owner });
  s.world.store(Position).add(e, { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
  (s as { stats: (e: number) => BlueprintStats | undefined }).stats = () => ({ sensorRange: 0, structure: false }) as BlueprintStats;
}

describe('radar ghosts and fog of war', () => {
  it('keeps ghosts on tiles that are not in view', () => {
    const s = makeState();
    s.updateVision();
    expect(s.radarBlips).toHaveLength(2);
  });

  it('drops a ghost once the fog is pushed back over its tile, and keeps the rest', () => {
    const s = makeState();
    addViewer(s, 5, 5);
    s.updateVision();
    expect(s.radarBlips).toHaveLength(1);
    expect(Math.floor(s.radarBlips[0].x / TILE)).toBe(30);
  });

  it('lends vision from allied units on my team, not from others', () => {
    const s = makeState();
    addViewer(s, 5, 5, 2);
    s.setTeams([{ id: 1, team: 1 }, { id: 2, team: 1 }, { id: 3, team: 2 }]);
    s.updateVision();
    expect(s.vision[5 * 40 + 5]).toBe(2);
    const t = makeState();
    addViewer(t, 5, 5, 3);
    t.setTeams([{ id: 1, team: 1 }, { id: 3, team: 2 }]);
    t.updateVision();
    expect(t.vision[5 * 40 + 5]).toBe(0);
  });
});
