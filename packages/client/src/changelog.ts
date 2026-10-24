/**
 * Player-facing release notes, shown as articles under News and Updates on the main menu. The notes
 * live in changelog.md: per update a "## date" heading, an optional "### Headline", a short summary
 * paragraph, then one "- " line per change. Edit that file to add an update. Write for players: no
 * file names or internals.
 */
import source from './changelog.md?raw';

export interface ChangelogEntry {
  /** ISO date of the update. */
  readonly date: string;
  /** Short headline; empty when the entry has none. */
  readonly title: string;
  /** A brief, human-readable summary of the day; empty when the entry has none. */
  readonly summary: string;
  readonly changes: readonly string[];
}

/** Reads the changelog.md format. Text outside a dated section, `#` comment lines and blank lines are ignored. */
export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: { date: string; title: string; summary: string[]; changes: string[] }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const last = entries[entries.length - 1];
    const heading = /^##\s+(\S.*)$/.exec(line);
    const title = /^###\s+(\S.*)$/.exec(line);
    if (heading) entries.push({ date: heading[1].trim(), title: '', summary: [], changes: [] });
    else if (!last || !line) continue;
    else if (title) last.title = title[1].trim();
    else if (line.startsWith('#')) continue;
    else if (line === '-' || line.startsWith('- ')) {
      if (line.slice(2).trim()) last.changes.push(line.slice(2).trim());
    } else last.summary.push(line);
  }
  return entries.filter((e) => e.changes.length).map((e) => ({ ...e, summary: e.summary.join(' ') }));
}

export const CHANGELOG: readonly ChangelogEntry[] = parseChangelog(source);
