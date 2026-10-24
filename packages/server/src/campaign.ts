import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CAMPAIGN_ID, type Briefing, type CampaignInfo, type CampaignLevelInfo, type MapDefinition, type TerrainLayout } from '@wst/engine';

/** Where the campaign folders live (see campaigns/README.md for the file formats). */
export const CAMPAIGNS_DIR = resolve(process.env.CAMPAIGNS_DIR ?? resolve(import.meta.dirname, '../../../campaigns'));

const LAYOUTS: readonly TerrainLayout[] = ['standard', 'open', 'scattered', 'ridges', 'dense', 'citadel'];
const SIZE = { min: 24, max: 192 };

/** What the server needs to start a level; the client only ever sees the CampaignLevelInfo part. */
export interface CampaignLevel {
  readonly map: MapDefinition;
  readonly seed: number;
  /** Only 'eliminate' exists: destroy every enemy. */
  readonly victory: 'eliminate';
  /** Reserved for the trigger system (not run yet, never sent to clients). */
  readonly triggers: readonly Record<string, unknown>[];
}

export interface LoadedCampaigns {
  readonly info: CampaignInfo[];
  /** Keyed `campaignId/levelId`. */
  readonly levels: ReadonlyMap<string, CampaignLevel>;
}

const warned = new Set<string>();
function warn(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[campaign] ${message}`);
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const lines = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);
const record = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const clamp = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    warn(`${path} is missing`);
    return undefined;
  }
  try {
    const json = record(JSON.parse(raw));
    if (!json) warn(`${path} must be a JSON object; skipping it.`);
    return json;
  } catch (err) {
    warn(`${path} is not valid JSON, so it is skipped: ${(err as Error).message}`);
    return undefined;
  }
}

/** Hand-drawn terrain: rows of digits ('0' open, '1'-'9' rock height), all one length, as written by editor/tiled-to-level.mjs. */
function parseDrawn(where: string, v: unknown): { width: number; height: number; cells: string } | undefined {
  const rows = Array.isArray(v) ? v : undefined;
  const width = typeof rows?.[0] === 'string' ? rows[0].length : 0;
  const ok = rows && rows.length >= SIZE.min && rows.length <= SIZE.max && width >= SIZE.min && width <= SIZE.max && rows.every((r) => typeof r === 'string' && r.length === width && /^[0-9]+$/.test(r));
  if (!ok) {
    warn(`${where}: "map.terrain" must be ${SIZE.min}-${SIZE.max} equal-length rows of digits; skipping the level.`);
    return undefined;
  }
  return { width, height: rows.length, cells: rows.join('') };
}

/** One level file, or undefined (with a warning) when it cannot be used. */
export function parseLevel(campaign: string, id: string, json: Record<string, unknown>): { info: CampaignLevelInfo; level: CampaignLevel } | undefined {
  const where = `${campaign}/maps/${id}.json`;
  const b = record(json.briefing) ?? {};
  const story = lines(b.story);
  const name = text(json.name) || id;
  const title = text(b.title) || name;
  if (!story.length) warn(`${where}: briefing.story is empty.`);
  const m = record(json.map);
  const drawn = m?.terrain !== undefined ? parseDrawn(where, m.terrain) : undefined;
  if (!m || (m.terrain !== undefined ? !drawn : !LAYOUTS.includes(m.layout as TerrainLayout))) {
    if (m?.terrain === undefined) warn(`${where}: "map.layout" must be one of ${LAYOUTS.join(', ')}; skipping the level.`);
    return undefined;
  }
  const victory = record(json.victory)?.type ?? 'eliminate';
  if (victory !== 'eliminate') warn(`${where}: victory type "${String(victory)}" is not supported yet; using "eliminate".`);
  const rawTriggers = Array.isArray(json.triggers) ? json.triggers : [];
  const triggers = rawTriggers.filter((t): t is Record<string, unknown> => typeof record(t)?.id === 'string');
  if (triggers.length !== rawTriggers.length) warn(`${where}: every trigger needs a string "id"; the others are dropped.`);
  const width = drawn?.width ?? Math.round(clamp(m.width, SIZE.min, SIZE.max, 64));
  const height = drawn?.height ?? Math.round(clamp(m.height, SIZE.min, SIZE.max, 64));
  const layout = LAYOUTS.includes(m.layout as TerrainLayout) ? (m.layout as TerrainLayout) : 'open';
  const briefing: Briefing = { title, story, objectives: lines(b.objectives), tips: lines(b.tips) };
  const map: MapDefinition = {
    id: `${campaign}/${id}`,
    name,
    width,
    height,
    layout,
    description: title,
    density: clamp(m.density, 0, 5, 1),
    outposts: Math.round(clamp(m.outposts, 0, 6, 0)),
    ...(drawn && { terrain: drawn.cells }),
  };
  return {
    info: { id, name, briefing, width, height, layout },
    level: { map, seed: Math.round(clamp(m.seed, 0, 0x7fffffff, 0x5eed)), victory: 'eliminate', triggers },
  };
}

/** Every usable campaign, ordered. A missing folder just means no campaigns. */
export async function loadCampaigns(dir = CAMPAIGNS_DIR): Promise<LoadedCampaigns> {
  const levels = new Map<string, CampaignLevel>();
  const found: { order: number; info: CampaignInfo }[] = [];
  let folders: string[] = [];
  try {
    folders = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return { info: [], levels };
  }
  for (const id of folders.sort()) {
    if (!CAMPAIGN_ID.test(id)) {
      warn(`folder "${id}" is skipped: campaign ids use letters, digits, - and _.`);
      continue;
    }
    const json = await readJson(resolve(dir, id, 'campaign.json'));
    if (!json) continue;
    const list: CampaignLevelInfo[] = [];
    for (const levelId of Array.isArray(json.maps) ? json.maps.map(text) : []) {
      if (!CAMPAIGN_ID.test(levelId) || levels.has(`${id}/${levelId}`)) {
        warn(`${id}: map "${levelId}" is skipped (bad or repeated id).`);
        continue;
      }
      const file = await readJson(resolve(dir, id, 'maps', `${levelId}.json`));
      const parsed = file && parseLevel(id, levelId, file);
      if (!parsed) continue;
      levels.set(`${id}/${levelId}`, parsed.level);
      list.push(parsed.info);
    }
    if (!list.length) {
      warn(`${id}: no usable maps, so the campaign is skipped.`);
      continue;
    }
    found.push({
      order: clamp(json.order, -1e6, 1e6, 100),
      info: { id, name: text(json.name) || id, summary: text(json.summary), story: lines(json.story), levels: list },
    });
  }
  found.sort((a, b) => a.order - b.order || a.info.name.localeCompare(b.info.name));
  return { info: found.map((f) => f.info), levels };
}

let cache: LoadedCampaigns = { info: [], levels: new Map() };

/** Re-reads the folder (so edits show without a restart) and remembers the result for starting levels. */
export async function refreshCampaigns(dir = CAMPAIGNS_DIR): Promise<LoadedCampaigns> {
  return (cache = await loadCampaigns(dir));
}

export const campaignLevel = (campaign: string, level: string): CampaignLevel | undefined => cache.levels.get(`${campaign}/${level}`);

/** A campaign level used as an ordinary multiplayer map: id `campaign/level`, shown as `Campaign name/Map name`. */
export function campaignMap(mapId: string): { map: MapDefinition; seed: number } | undefined {
  const [campaign, id, ...rest] = mapId.split('/');
  const found = rest.length === 0 && id !== undefined ? campaignLevel(campaign, id) : undefined;
  if (!found) return undefined;
  const name = cache.info.find((c) => c.id === campaign)?.name ?? campaign;
  return { map: { ...found.map, name: `${name}/${found.map.name}` }, seed: found.seed };
}
