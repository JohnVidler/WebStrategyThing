/**
 * Single Player scenarios: how a single-player game is set up. A scenario only changes
 * where the players start and how the opposition arrives; the rules are the same.
 *
 * - standard: you in one corner, one bot in another that sends growing waves.
 * - horde: you in one corner, no enemy base; a slow, endless trickle of units walks in from the
 *   opposite corner. There is nothing to win: survive and see how long you last.
 * - surrounded: you start in the middle of the map and a bot holds each of the four corners.
 *   Destroy all four to win.
 */
export type Scenario = 'standard' | 'horde' | 'surrounded';

export const SCENARIOS: readonly { id: Scenario; name: string; description: string }[] = [
  { id: 'standard', name: 'Classic', description: 'One bot in another corner, sending waves of units' },
  { id: 'horde', name: 'Horde', description: 'No enemy base: a slow, endless stream of units from the far corner. How long can you hold?' },
  { id: 'surrounded', name: 'Surrounded', description: 'You start in the middle of the map, with a bot in every corner' },
];

export const parseScenario = (id: string | null | undefined): Scenario => (id === 'horde' || id === 'surrounded' ? id : 'standard');
