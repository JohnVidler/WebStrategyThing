/**
 * Player-facing release notes, shown on the lobby page. Newest first, one short
 * line per change, written for players (no file names or internals). Add a
 * block here when a change is worth telling players about.
 */
export interface ChangelogEntry {
  /** ISO date of the update. */
  readonly date: string;
  readonly changes: readonly string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    date: '2026-10-14',
    changes: [
      'Units and buildings now look different depending on their modules: weapons, motors, cargo, sensors and armour all change the hull and fittings.',
      'Units turn to face the way they last moved.',
      'The designer has a larger preview, with true-size thumbnails in your colours and a rival’s.',
      'Sprites are sharper when zoomed in.',
      'Matter patches slowly regrow after being harvested.',
      'Solar panels and wind turbines produce twice as much energy.',
      'Units are much more forgiving about energy use.',
      'Five maps to choose from when creating a room.',
      'Balance values are gathered in one place, so tuning is easier for the next update.',
    ],
  },
  {
    date: '2026-10-13',
    changes: [
      'Rooms: create a named room, share an invite link, and reconnect if you drop. The game pauses until two players are present.',
      'Matches end when one side is eliminated, with a winner screen and final standings.',
      'Scoreboard, matter and energy bars, and a live game clock.',
      'Control groups (Ctrl+1–9), priority band-select and a unit action grid with hotkeys.',
      'Fog of war, power-flow animation along links and charging-zone shading.',
      'Laser turret and tesla coil, construction towers, and building now costs energy.',
      'The class designer: code editor, test run sandbox, program history and design download/upload.',
    ],
  },
];
