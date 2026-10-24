const STORAGE_KEY = 'wst-campaigns';

/** How many levels of each campaign have been completed, in order, by campaign id. */
type Saved = Record<string, number>;

function load(): Saved {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const saved: Saved = {};
    if (raw && typeof raw === 'object') {
      for (const [id, n] of Object.entries(raw)) if (typeof n === 'number' && n > 0) saved[id] = Math.floor(n);
    }
    return saved;
  } catch {
    return {};
  }
}

/** Levels completed so far (they are played in order, so this is also the index of the next one). */
export function completedLevels(campaign: string): number {
  return load()[campaign] ?? 0;
}

/** Levels the player may start: everything completed plus the next one, never more than the campaign has. */
export function unlockedLevels(campaign: string, total: number): number {
  return Math.min(total, completedLevels(campaign) + 1);
}

/** Records that level `index` (0-based) was won. Replaying an earlier level never lowers progress. */
export function completeLevel(campaign: string, index: number): void {
  const saved = load();
  saved[campaign] = Math.max(saved[campaign] ?? 0, index + 1);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Not persisted; the player just loses their place next visit.
  }
}
