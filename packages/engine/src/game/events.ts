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
  /** A cannon shell struck an enemy: the shell's entity index (twice). It stays one tick at the spot. */
  ShellHit: 9,
  /** A shell glanced off rock or a unit and flew on (sparks), or landed at the end of its range (a small thud): the shell's index (twice). */
  ShellBounce: 10,
  ShellLand: 11,
  /** A shield stopped a hit: the shield's owner, and the direction of the hit (256ths of a turn from east) plus 256 times the damage stopped (capped at 255). */
  ShieldHit: 12,
  /** A shield ran its owner's battery flat and blew up: the owner (twice). */
  ShieldBurst: 13,
  /** Lightning struck a unit or building: its entity index (twice). Strikes on open ground need no event: the client works out where they land. */
  Lightning: 14,
  /** A fireball landed and set a fire: the flame entity's index (twice). */
  FlameLand: 15,
  /** A smoke launcher threw a volley: the carrier (twice). */
  Smoke: 16,
  /** Point defence shot at an incoming missile or shell: the defender, and the thing shot at (hit or not). */
  Intercept: 17,
  /** A railgun fired: the carrier and the point the line ends at is read from its Charge heading; the second payload is the first target hit, or the carrier. */
  RailShot: 18,
  /** An ion bolt struck: the shooter and the target. */
  IonHit: 19,
  /** A drone launched from or docked in a carrier: the carrier, and the drone (launch) or the carrier again (dock). */
  DroneLaunch: 20,
  DroneDock: 21,
} as const;
