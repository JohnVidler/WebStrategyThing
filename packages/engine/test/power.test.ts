import { describe, expect, it } from 'vitest';
import { powerTopology, routeEnergy, type PowerNode } from '../src';

const node = (e: number, x: number): PowerNode => ({ e, owner: 1, x, y: 0, size: 1, reach: 10 });

/** Two clusters (nodes 0-1 and 2) joined by one bridge of the given capacity. */
function twoClusters(cap: number) {
  const nodes = [node(0, 0), node(1, 1), node(2, 8)];
  const { topologies } = powerTopology(nodes, [0, 0, 0], [[0, 1], [1, 2]], 1, () => cap);
  return topologies[0];
}

describe('routeEnergy', () => {
  it('does not strand own supply behind a capped bridge', () => {
    const topo = twoClusters(10);
    expect(topo.clusters).toBe(2);
    const used = topo.bridges.map(() => 0);
    const r = routeEnergy(topo, used, [100, 0], [100, 100]);
    expect(r.got).toEqual([90, 10]); // 10 crosses the bridge; the rest stays home instead of idling
    expect(r.gave).toEqual([100, 0]);
    expect(used[0]).toBe(10);
  });

  it('sends surplus across a bridge only up to its cap', () => {
    const topo = twoClusters(10);
    const used = topo.bridges.map(() => 0);
    const r = routeEnergy(topo, used, [150, 0], [100, 100]);
    expect(r.got).toEqual([100, 10]);
    expect(r.gave).toEqual([110, 0]);
  });

  it('counts flow in both directions against the same cap', () => {
    const topo = twoClusters(20);
    const used = topo.bridges.map(() => 0);
    routeEnergy(topo, used, [120, 0], [100, 100]); // 20 crosses a -> b
    const back = routeEnergy(topo, used, [0, 50], [50, 0]); // already spent: nothing may cross back
    expect(back.got).toEqual([0, 0]);
    expect(used[0]).toBe(20);
  });

  it('is uncapped inside one network without long links', () => {
    const nodes = [node(0, 0), node(1, 1)];
    const { topologies } = powerTopology(nodes, [0, 0], [[0, 1]], 1, () => 0);
    expect(topologies[0].clusters).toBe(1);
    expect(topologies[0].bridges).toEqual([]);
    expect(routeEnergy(topologies[0], [], [30], [50]).got).toEqual([30]);
  });
});
