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
    date: '2026-10-15',
    changes: [
      'Repairs: a new Repair beam module mends your own units and buildings (units can fix buildings and the other way round). It costs energy and matter, and armour is the most expensive to mend.',
      'New Repair Drone class you can build, with a Repair action (R, or right-click a damaged unit or building). The Construction Tower now repairs nearby things when it has nothing to build.',
      'Repairs show as a green beam with rising crosses, so they no longer look like weapon fire.',
      'Producing a unit now costs energy as well as matter, based on how many modules it has and what they are. Build buttons show both costs.',
      'Lasers draw five times the energy per shot, so a few of them will drain a small grid. Damage per shot is unchanged.',
      'Batteries hold half as much, and the starting base now has a small energy storage instead of a large one.',
      'Fixed: an energy storage that ran flat while discharging or holding could refuse to charge again even with surplus power.',
      'Daylight, wind and power are now large tiles at the top of the side panel, with the power balance on its own strip.',
      'The stats strip across the top of the map and the resource bars no longer jump around as numbers change.',
      'The main menu has an animated backdrop, a new font, larger text, and shows how many players are online.',
      'The music widget moves into the designer while it is open.',
    ],
  },
  {
    date: '2026-10-14',
    changes: [
      'New default building: the Radar Tower pings the map on its own while its radar module is switched on.',
      'New Radar module: a script calls radarPulse(energy) for a one-off scan whose range grows with the energy spent. Contacts appear as blips that slowly fade.',
      'New main menu: Single-player (you against a bot) and Multiplayer (every open game on the left, tagged free-for-all or co-op, with create-a-room on the right), plus the Designer and the API reference, both available without starting a game. Designs you make in the menu are the ones you get in your next match.',
      'Factory unit buttons respond on the first click, and now match the square action buttons, with a picture of each unit.',
      'Harvesters no longer stall: with nothing to do they return to the nearest storage building for new orders, switch to another nearby field when theirs runs low, and storage buildings send them to a random one of the nearest fields.',
      'Five new, larger maps: Great Plains, Sprawl, Long Valley, Bastion and Badlands, with extra resource fields between the bases. The lobby now shows ten maps in two rows.',
      'New game mode: Co-op vs bots. Up to two players on the same team, each facing a bot that never needs to mine and sends waves of units at you. Handy for testing your designs. The standard mode is a four-way free-for-all.',
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
