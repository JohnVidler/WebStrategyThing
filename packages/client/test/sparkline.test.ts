import { describe, expect, it } from 'vitest';
import { sparkline } from '../src/resources';

describe('selection sparklines', () => {
  it('draws one line per unbroken run, right-aligned, scaled to the maximum', () => {
    const svg = sparkline([1, 2, NaN, 4, 4], 4, '#fff', 90, 20);
    expect(svg.match(/<polyline/g)).toHaveLength(2);
    // The newest sample sits at the right edge, at the top (4 of max 4).
    expect(svg).toMatch(/90\.0,1\.0"/);
  });

  it('copes with no history yet', () => {
    expect(sparkline([], 10, '#fff')).not.toMatch(/<polyline/);
  });
});
