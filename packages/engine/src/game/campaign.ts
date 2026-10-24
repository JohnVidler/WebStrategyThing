import type { TerrainLayout } from './terrain';

/** What the player reads before a level starts. */
export interface Briefing {
  readonly title: string;
  readonly story: readonly string[];
  readonly objectives: readonly string[];
  readonly tips: readonly string[];
}

/** One level as the client sees it (the server keeps the triggers to itself). */
export interface CampaignLevelInfo {
  /** The map file's name, unique within the campaign. */
  readonly id: string;
  readonly name: string;
  readonly briefing: Briefing;
  readonly width: number;
  readonly height: number;
  readonly layout: TerrainLayout;
}

/** `GET /api/v1/campaigns`: every campaign in order, with its levels in play order. */
export interface CampaignInfo {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly story: readonly string[];
  readonly levels: readonly CampaignLevelInfo[];
}

/** Level ids are file names; campaign ids are folder names. */
export const CAMPAIGN_ID = /^[A-Za-z0-9_-]{1,40}$/;
