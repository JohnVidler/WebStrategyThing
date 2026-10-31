/**
 * How well a computer opponent plays. A level changes how fast it thinks, how big an economy it
 * builds and how soon and how hard it attacks; the rules it plays by are the same at every level.
 * `ai.ts` reads these numbers; level 4 (Hard) is the AI exactly as it was before levels existed.
 */
export interface BotSkill {
  readonly name: string;
  /** Multiplies the time before the first attack and the army needed to launch each wave (more is slower and gentler). */
  readonly pace: number;
  /** Ticks between decisions (10 ticks = 1 second). */
  readonly thinkTicks: number;
  /** Resource fields it will claim beyond its home field. */
  readonly maxExpansions: number;
  /** Units each factory keeps queued. */
  readonly queueDepth: number;
  /** Construction sites it may have open at once, before one more per two builders. */
  readonly maxSites: number;
  /** Multiplies when each unit type joins its rotation (more is a later, simpler army). */
  readonly techDelay: number;
  /** Multiplies how many harvesters it wants. */
  readonly economy: number;
}

export const BOT_SKILLS: readonly BotSkill[] = [
  { name: 'Patsy', pace: 3, thinkTicks: 40, maxExpansions: 0, queueDepth: 1, maxSites: 1, techDelay: 2.5, economy: 0.5 },
  { name: 'Beginner', pace: 2, thinkTicks: 25, maxExpansions: 1, queueDepth: 1, maxSites: 2, techDelay: 1.8, economy: 0.7 },
  { name: 'Normal', pace: 1.5, thinkTicks: 15, maxExpansions: 2, queueDepth: 2, maxSites: 2, techDelay: 1.3, economy: 0.85 },
  { name: 'Experienced', pace: 1.2, thinkTicks: 12, maxExpansions: 3, queueDepth: 2, maxSites: 3, techDelay: 1.1, economy: 1 },
  { name: 'Hard', pace: 1, thinkTicks: 10, maxExpansions: 3, queueDepth: 2, maxSites: 3, techDelay: 1, economy: 1 },
  { name: 'Insane', pace: 0.75, thinkTicks: 5, maxExpansions: 4, queueDepth: 3, maxSites: 4, techDelay: 0.7, economy: 1.25 },
];

/** What a bot added in the waiting room starts at: Normal. */
export const DEFAULT_BOT_LEVEL = 2;
/** The AI as it played before levels: Surrounded, Co-op and Single Player bots use this. */
export const HARD_BOT_LEVEL = 4;

/** Reads an untrusted level number; anything that is not a whole level falls back to `fallback`. */
export function parseBotLevel(value: unknown, fallback = DEFAULT_BOT_LEVEL): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < BOT_SKILLS.length ? value : fallback;
}
