/** Transient per-tick events, replicated alongside the component delta. Payloads are entity indices. */
export const SimEvent = {
  Shot: 1,
  Death: 2,
  /** A tesla discharge: the coil's entity index (twice, so visibility filtering sees it). */
  Pulse: 3,
  /** A repair beam at work: repairer, repaired (sent every other tick while it runs). */
  Repair: 4,
  /** A build arm at work: builder, site (sent every other tick while it invests). */
  Build: 5,
  /** A charging pad actively topping up units: the pad's entity index (twice). Rate-limited, and only above a delivery threshold. */
  Charge: 6,
  /** A module broke: the unit or building, and the index of the part. */
  Break: 7,
  /** A harvester at work: harvester, resource (sent every other tick while it mines). */
  Harvest: 8,
} as const;
