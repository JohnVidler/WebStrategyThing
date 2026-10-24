import { describe, expect, it } from 'vitest';
import { CHANGELOG, parseChangelog } from '../src/changelog';

describe('changelog', () => {
  it('reads dated sections with an optional headline and summary, and ignores comments, blanks and stray text', () => {
    const text = '# a comment\r\nstray\n\n## 2026-02-02\n### Big day\nA short\nsummary.\n- Two\n-\n- Three\n\n## 2026-01-01\n- One\n## empty\n';
    expect(parseChangelog(text)).toEqual([
      { date: '2026-02-02', title: 'Big day', summary: 'A short summary.', changes: ['Two', 'Three'] },
      { date: '2026-01-01', title: '', summary: '', changes: ['One'] },
    ]);
  });

  it('the shipped changelog.md has dated entries, newest first, each with a headline and a summary', () => {
    expect(CHANGELOG.length).toBeGreaterThan(1);
    const dates = CHANGELOG.map((e) => e.date);
    expect(dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(CHANGELOG[0].changes.length).toBeGreaterThan(5);
    for (const e of CHANGELOG) {
      expect(e.title).not.toBe('');
      expect(e.summary).not.toBe('');
    }
  });
});
