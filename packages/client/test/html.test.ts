import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Class and player names come from other players: they must pass through esc() before they reach innerHTML. */
describe('innerHTML', () => {
  it('never interpolates a name or label without esc()', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      text.split(/\r?\n/).forEach((line, i) => {
        if (!/innerHTML\s*\+?=/.test(line)) return;
        // Drop esc(...) calls (one level of nested parentheses) before looking for bare interpolations.
        const bare = line.replace(/esc\((?:[^()]|\([^()]*\))*\)/g, '');
        if (/\$\{[^}]*\.(name|label|title|message)\b/.test(bare)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
