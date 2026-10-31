import { GENERATION_SCALE, SOLAR_GENERATION_MULTIPLIER, STEAM_GENERATION_MULTIPLIER, WIND_GENERATION_MULTIPLIER } from '@wst/engine';

/**
 * Energy per tick a building makes at the given daylight and wind (both 0..100), before transmission
 * losses. `solar` and `wind` are the building's peak outputs (`BlueprintStats.solar` / `.wind`). This is the
 * formula `powerSystem` uses, so the power drop-down shows what the grid really gets.
 */
export function generationPerTick(solar: number, wind: number, daylight: number, windLevel: number): number {
  return (solar * daylight * SOLAR_GENERATION_MULTIPLIER + wind * windLevel * WIND_GENERATION_MULTIPLIER) / (100 * GENERATION_SCALE);
}

/** Energy per tick from steam turbines: `steam` is the building's peak (`BlueprintStats.steam`), and only as many turbines run as there are vents under it. */
export function steamPerTick(steam: number, turbines: number, vents: number): number {
  return turbines > 0 ? (steam * Math.min(vents, turbines) * STEAM_GENERATION_MULTIPLIER) / (turbines * GENERATION_SCALE) : 0;
}

/** A class with more than this many buildings is listed as one "Name (xN)" row instead of one row each. */
export const COLLAPSE_OVER = 3;

/**
 * Rows for a list of buildings, in order of first appearance: a class with more than `over` of them becomes one
 * row labelled "Name (xN)" holding all of them; fewer are listed one by one (numbered when they share a name),
 * so a long list stays short. `key` is stable for a collapsed class and per building otherwise.
 */
export function collapseByClass<T extends { name: string; e: number }>(items: readonly T[], over = COLLAPSE_OVER): { key: string; label: string; items: T[] }[] {
  const byName = new Map<string, T[]>();
  for (const it of items) (byName.get(it.name) ?? byName.set(it.name, []).get(it.name)!).push(it);
  const out: { key: string; label: string; items: T[] }[] = [];
  for (const [name, list] of byName) {
    if (list.length > over) out.push({ key: `class:${name}`, label: `${name} (x${list.length})`, items: list });
    else list.forEach((it, i) => out.push({ key: `e:${it.e}`, label: list.length > 1 ? `${name} ${i + 1}` : name, items: [it] }));
  }
  return out;
}

/** Names for a list of buildings: a class that appears more than once is numbered ("Resource Silo 2"). */
export function numberedNames(names: readonly string[]): string[] {
  const total = new Map<string, number>();
  for (const n of names) total.set(n, (total.get(n) ?? 0) + 1);
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return (total.get(n) ?? 0) > 1 ? `${n} ${k}` : n;
  });
}
