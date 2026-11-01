import type { PartDef } from '@wst/engine';

/** Stroke-only 24×24 glyphs, drawn in the current colour; the tile tints them by what the module does. */
const G = {
  body: '<rect x="4" y="7" width="16" height="10" rx="2"/><path d="M6 7V5h12v2M6 17v2h12v-2"/>',
  building: '<path d="M4 20V9l8-5 8 5v11zM9 20v-6h6v6"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  memory: '<rect x="4" y="5" width="16" height="4" rx="1"/><rect x="4" y="11" width="16" height="4" rx="1"/><path d="M7 19h10"/>',
  motor: '<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/>',
  hover: '<path d="M3 9c3-3 6 3 9 0s6 3 9 0M3 15c3-3 6 3 9 0s6 3 9 0"/>',
  legs: '<path d="M6 4l6 8-4 8M18 4l-6 8 4 8"/>',
  sensor: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  radar: '<circle cx="12" cy="12" r="2"/><path d="M12 12l7-7M5 12a7 7 0 0 1 7-7M2 12A10 10 0 0 1 12 2"/>',
  gun: '<circle cx="12" cy="12" r="7"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>',
  cannon: '<rect x="3" y="9" width="14" height="6" rx="1"/><path d="M17 10h4v4h-4M6 15v4h4v-4"/>',
  laser: '<path d="M3 12h13M16 7l5 5-5 5M3 8v8"/>',
  tesla: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  missile: '<path d="M4 20l5-5M9 15l-1-6 6-5 6 1-1 6-5 6z"/>',
  flak: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  armor: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  shield: '<path d="M4 15a8 8 0 0 1 16 0M12 15v5M9 20h6"/>',
  cargo: '<path d="M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8"/>',
  battery: '<rect x="3" y="8" width="16" height="9" rx="1"/><path d="M21 11v3M8 12.5h6M11 10v5"/>',
  factory: '<path d="M3 20V10l6 4v-4l6 4V6h3v14z"/>',
  depot: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3 3 7 3s7-1.3 7-3V6"/>',
  charger: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5"/>',
  solar: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  wind: '<path d="M12 12v10M12 12l-1-9M12 12l8 4M12 12l-8 4"/>',
  steam: '<path d="M7 20c-2-2 2-4 0-6s2-4 0-6M13 20c-2-2 2-4 0-6s2-4 0-6M19 20c-2-2 2-4 0-6"/>',
  antenna: '<path d="M12 12v9M8 21h8"/><circle cx="12" cy="9" r="2"/><path d="M7.5 5.5a6 6 0 0 0 0 7M16.5 5.5a6 6 0 0 1 0 7"/>',
  builder: '<path d="M4 20l9-9M12 4l8 8-3 3-8-8z"/>',
  crane: '<path d="M4 21h16M8 21V7h8M8 7l8-4M16 7v7"/>',
  comms: '<circle cx="12" cy="12" r="1"/><path d="M5 12a7 7 0 0 1 14 0M8 12a4 4 0 0 1 8 0M12 13v8"/>',
  repair: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
  light: '<path d="M9 3h6l2 7H7zM8 14l-3 7M12 14v7M16 14l3 7"/>',
  generic: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
};

/** What colour family a slot belongs to, matching the palette's category order. */
const TINT: Record<string, string> = {
  chassis: 'body', cpu: 'compute', memory: 'compute', motor: 'move', weapon: 'weapon', armor: 'weapon', shield: 'weapon',
  sensor: 'sense', radar: 'sense', light: 'sense', comms: 'link', cargo: 'industry', builder: 'industry', repair: 'industry',
  factory: 'industry', depot: 'industry', battery: 'power', charger: 'power', generator: 'power', antenna: 'power', defence: 'weapon', hangar: 'industry', smoke: 'sense',
};

function glyphOf(p: PartDef): string {
  switch (p.slot) {
    case 'chassis': return p.structure ? G.building : G.body;
    case 'motor': return p.id.startsWith('legs') ? G.legs : p.hover ? G.hover : G.motor;
    case 'weapon': return G[(p.weapon?.kind ?? 'gun') as 'gun'] ?? G.gun;
    case 'generator': return p.id.startsWith('wind') ? G.wind : p.id.startsWith('steam') ? G.steam : G.solar;
    case 'builder': return p.id.includes('crane') ? G.crane : G.builder;
    default: return (G as Record<string, string>)[p.slot] ?? G.generic;
  }
}

/** The module's icon as an inline SVG inside a tinted tile. Pure markup from the module's own data. */
export function partIcon(p: PartDef | undefined): string {
  if (!p) return '';
  return `<span class="part-icon tint-${TINT[p.slot] ?? 'body'}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${glyphOf(p)}</svg></span>`;
}
