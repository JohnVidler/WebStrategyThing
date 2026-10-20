import { BLOCKS } from '@wst/engine';
import { describe, expect, it } from 'vitest';
import { graphOf } from '../src/docsGraph';
import { MANUAL } from '../src/manual';
import { EXAMPLES } from '../src/manualExamples';

describe('the manual', () => {
  for (const [id, text] of Object.entries(EXAMPLES)) {
    it(`example "${id}" is a valid program and draws as a graph`, () => {
      const g = graphOf(text);
      expect(g.errors).toEqual([]);
      expect(g.html).toContain('gnode');
    });
  }

  it('draws every built-in block as a card with its settings', () => {
    for (const b of BLOCKS) {
      const g = graphOf(`use(${b.name});`);
      expect(g.errors, b.name).toEqual([]);
      expect(g.html).toContain('gnode block');
      expect(g.html).toContain(b.name);
    }
  });
});

describe('the manual pages', () => {
  for (const page of MANUAL) {
    it(`"${page.title}" renders`, () => {
      const html = page.render();
      expect(html.length).toBeGreaterThan(500);
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('[object');
    });
  }
});
