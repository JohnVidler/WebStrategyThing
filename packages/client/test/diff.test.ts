import { describe, expect, it } from 'vitest';
import { diffLines, withContext } from '../src/diff';

describe('program diff', () => {
  it('reports added, removed and unchanged lines in order', () => {
    const d = diffLines('a\nb\nc\nd', 'a\nc\nx\nd');
    expect(d.map((l) => l.op + l.text)).toEqual([' a', '-b', ' c', '+x', ' d']);
  });

  it('trims long unchanged runs to context with gap markers', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 10', 'changed');
    const ctx = withContext(diffLines(before, after), 1);
    expect(ctx.map((l) => (l ? l.op + l.text : '...'))).toEqual(['...', ' line 9', '-line 10', '+changed', ' line 11', '...']);
    expect(withContext(diffLines(before, before))).toEqual([]);
  });
});
