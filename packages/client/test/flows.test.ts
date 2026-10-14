import { describe, expect, it } from 'vitest';
import { flowSpeed } from '../src/renderer';
import { measureFlows } from '../src/state';

describe('power flow over links', () => {
  // A chain: generator 1 - 2 - 3, plus 4 hanging off 2.
  const neighbours = new Map([
    [1, [2]],
    [2, [1, 3, 4]],
    [3, [2]],
    [4, [2]],
  ]);

  it("routes each building's draw back to the givers", () => {
    const flows = measureFlows({ members: [1, 2, 3, 4], flow: [-9, 2, 3, 4] }, neighbours);
    const over = (from: number, to: number) => flows.find((f) => f.from === from && f.to === to)?.amount;
    expect(over(2, 3)).toBe(3);
    expect(over(2, 4)).toBe(4);
    expect(over(1, 2)).toBe(9); // everything downstream, plus 2's own draw
  });

  it('splits between equally close routes and shows nothing without a giver', () => {
    const ring = new Map([
      [1, [2, 3]],
      [2, [1, 4]],
      [3, [1, 4]],
      [4, [2, 3]],
    ]);
    const flows = measureFlows({ members: [1, 2, 3, 4], flow: [-4, 0, 0, 4] }, ring);
    expect(flows.filter((f) => f.to === 4).map((f) => f.amount)).toEqual([2, 2]);
    expect(measureFlows({ members: [1, 2], flow: [0, 0] }, neighbours)).toEqual([]);
  });

  it('moves dots faster for more energy', () => {
    expect(flowSpeed(16)).toBeGreaterThan(flowSpeed(4));
    expect(flowSpeed(4)).toBeGreaterThan(flowSpeed(0));
    expect(flowSpeed(1e6)).toBe(8);
  });
});
