/** Room list shown when the page is opened without ?room=: pick a match or create one. */
import { GAME_BRANCH, GAME_VERSION } from './version';
import { getPlayerName, getSavedPlayerName, NAME_MAX, setPlayerName } from './playerName';
import { showNews } from './newsMenu';
import { randomHex } from './random';
import { playSound, sound } from './sound';
import { musicPlayer, placeMusic } from './music';
import { fadeIn, growRow, isShown, setShown, shrinkRow, swapContent } from './transition';
import { startMenuBackground } from './menuBackground';
import { reduceMotion, setReduceMotion, setShowAlphaMaps, showAlphaMaps } from './settings';
import { campaignUrl, devMode, fetchCampaigns, showCampaigns } from './campaignMenu';
import { createMapTerrain, DEFAULT_MAP_ID, GAME_MODES, MAPS, parseGameMode, type GameMode } from '@wst/engine';
import type { LobbyDevTools } from './lobbyDevTools';

export interface RoomInfo {
  readonly name: string;
  readonly mapId: string;
  readonly mapName: string;
  readonly mode: GameMode;
  readonly width: number;
  readonly height: number;
  readonly players: number;
  readonly capacity: number;
  readonly over: boolean;
  /** Game time so far, in seconds (it stops while the game is paused). */
  readonly elapsed: number;
  readonly paused: boolean;
  /** Still gathering players: the host has not started the match. */
  readonly lobby: boolean;
  readonly scores: readonly { name: string; score: number; connected: boolean; eliminated: boolean }[];
  /** A made-up room from the dev tools (development builds only): it cannot be joined. */
  readonly example?: boolean;
}

const clock = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

const ROOM_NAME = /^[A-Za-z0-9_-]{1,24}$/;
const REFRESH_MS = 3000;
const randomRoomName = () => `room-${randomHex(6)}`;

interface CreditTrack {
  name: string;
  composer: string;
  url: string;
  license: string;
  licenseUrl: string;
}

interface CreditSound {
  name: string;
  author: string;
  url: string;
  license: string;
}

const CREDIT_PEOPLE = [
  { name: 'Dr John Vidler', role: 'Game design, direction and testing' },
  { name: 'Claude Opus 5.5', role: 'Chief Engineer: simulation engine and the flow language' },
  { name: 'Claude Sonnet 5.5', role: 'Sound Engineer and Keeper of the Credits' },
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const previews = new Map<string, string>();
/** A campaign level offered as a multiplayer map; the server does not send its terrain, so it has no preview. */
interface CampaignMap {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly description: string;
}
let campaignMaps: CampaignMap[] = [];
const preview = (id: string): string => {
  const cached = previews.get(id);
  if (cached) return cached;
  if (campaignMaps.some((item) => item.id === id)) return '';
  const map = MAPS.find((item) => item.id === id) ?? MAPS[0];
  const terrain = createMapTerrain(map);
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 200;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const tile = Math.min(canvas.width / map.width, canvas.height / map.height);
  const ox = (canvas.width - map.width * tile) / 2;
  const oy = (canvas.height - map.height * tile) / 2;
  context.fillStyle = '#182522';
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const index = y * map.width + x;
      context.fillStyle = terrain.passable[index]
        ? (x * 13 + y * 7) % 3 === 0 ? '#426b55' : '#365c4a'
        : (x + y) % 2 ? '#667166' : '#56635d';
      context.fillRect(ox + x * tile, oy + y * tile, Math.ceil(tile), Math.ceil(tile));
    }
  }
  const corners = [
    [8, 9, '#a8dd83'],
    [map.width - 9, map.height - 10, '#e77e72'],
    [map.width - 9, 9, '#e6c46e'],
    [8, map.height - 10, '#76b8df'],
  ] as const;
  for (const [x, y, color] of corners) {
    context.fillStyle = color;
    context.fillRect(ox + x * tile - 2, oy + y * tile - 2, Math.max(5, tile * 3), Math.max(5, tile * 3));
  }
  context.fillStyle = '#d8cf82';
  context.beginPath();
  context.arc(ox + (map.width / 2) * tile, oy + (map.height / 2) * tile, Math.max(2, tile * 1.3), 0, Math.PI * 2);
  context.fill();
  const image = canvas.toDataURL('image/png');
  previews.set(id, image);
  return image;
};

let presence: WebSocket | undefined;
/** Holds an idle socket open while this tab is on the menu, so it counts as "online". Joining reloads the page, which drops it. */
const announceMenuPresence = (apiBase: string) => {
  if (presence && presence.readyState <= WebSocket.OPEN) return;
  try {
    presence = new WebSocket(`${apiBase.replace(/^http/, 'ws')}/ws?menu=1`);
  } catch {
    presence = undefined;
  }
};

const join = (room: string, name: string, mapId = DEFAULT_MAP_ID, mode: GameMode = 'versus') => {
  setPlayerName(name);
  location.href = `${location.pathname}?room=${encodeURIComponent(room)}&map=${encodeURIComponent(mapId)}&mode=${mode}`;
};

/** Starts a campaign level: a private room whose map comes from the campaign folder. */
const joinCampaign = (campaign: string, level: string, index: number) => {
  location.href = campaignUrl(campaign, level, index);
};

/** "?campaign=id&level=n" opens that level's briefing (where "Continue" after a won mission lands). */
const campaignTarget = (): { campaign: string; level: number } | undefined => {
  if (!devMode()) return undefined;
  const params = new URLSearchParams(location.search);
  const campaign = params.get('campaign');
  return campaign ? { campaign, level: Number(params.get('level') ?? 0) || 0 } : undefined;
};

type View = 'main' | 'multi' | 'solo' | 'credits' | 'options' | 'campaigns' | 'news';
/** The views that are a room list / map picker. */
type RoomView = 'multi' | 'solo';

const modeName = (mode: GameMode): string => GAME_MODES.find((m) => m.id === mode)?.name ?? mode;

/** What each room-based section is called and offers. */
const SECTIONS: Record<RoomView, { title: string; blurb: string }> = {
  multi: { title: 'Multiplayer', blurb: 'Join a game from the list, or create your own: a free-for-all, or co-op against bots.' },
  solo: { title: 'Single-player', blurb: 'You against a bot that never needs to mine and sends waves of units at you. A private game; good for testing designs.' },
};

const mapCaption = (id: string): string => {
  const extra = campaignMaps.find((item) => item.id === id);
  if (extra) return `<b>${esc(extra.label)}</b> · ${extra.width} × ${extra.height}<br>${esc(extra.description)}`;
  const map = MAPS.find((item) => item.id === id) ?? MAPS[0];
  return `<b>${esc(map.name)}</b> · ${map.width} × ${map.height}<br>${esc(map.description)}`;
};

/** The map list's options; multiplayer also lists campaign levels after the built-in maps. */
const mapOptions = (selectedId: string, withCampaign: boolean): string =>
  [
    ...MAPS.map((map) => ({ id: map.id, label: `${map.name} (${map.width}×${map.height})` })),
    ...(withCampaign ? campaignMaps.map((map) => ({ id: map.id, label: `${map.label} (${map.width}×${map.height})` })) : []),
  ]
    .map((option) => `<option value="${esc(option.id)}"${option.id === selectedId ? ' selected' : ''}>${esc(option.label)}</option>`)
    .join('');

/** A list of maps with one preview, for the selected map only. */
const mapPicker = (selectedId: string, withCampaign: boolean): string =>
  `<fieldset class="map-picker">
    <legend>Map</legend>
    <div class="map-layout">
      <select name="map" size="5" aria-label="Map">${mapOptions(selectedId, withCampaign)}</select>
      <div class="map-preview"><img${preview(selectedId) ? '' : ' hidden'} src="${preview(selectedId)}" alt="Terrain preview"><small>${mapCaption(selectedId)}</small></div>
    </div>
  </fieldset>`;

let refreshTimer: ReturnType<typeof setInterval> | undefined;
let rememberedMap = DEFAULT_MAP_ID;
let rememberedMode: GameMode = 'versus';
let designs: import('./localdesigns').LocalDesigns | undefined;
let popHandler: ((ev: PopStateEvent) => void) | undefined;

/**
 * Browser history for the lobby: each sub-menu or overlay is one history entry,
 * so the Back button steps up a level instead of leaving the page.
 */
interface LobbyState {
  lobby: true;
  view: View;
  depth: number;
  overlay?: 'docs' | 'designer';
}
const lobbyState = (): LobbyState | undefined => {
  const st = history.state as Partial<LobbyState> | null;
  return st?.lobby ? (st as LobbyState) : undefined;
};

/** `apiBase` is the same-origin API root, e.g. /api/v1. */
export function showLobby(apiBase: string, joinRoom?: string, preferredMapId = DEFAULT_MAP_ID, preferredMode: GameMode = 'versus'): void {
  const root = document.getElementById('lobby')!;
  const VERSION_TAG = `<div class="lobby-version">Version: ${esc(GAME_BRANCH)} / ${esc(GAME_VERSION)}</div>`;
  document.getElementById('panel')!.hidden = true;
  document.getElementById('stage')!.hidden = true;
  root.hidden = false;
  startMenuBackground(root);
  announceMenuPresence(apiBase);
  rememberedMap = preferredMapId;
  rememberedMode = preferredMode === 'coop' ? 'coop' : 'versus';

  if (!getSavedPlayerName()) {
    root.innerHTML = `
      <h1>Digital Chaos</h1>
      ${VERSION_TAG}
      <form id="lobby-name-form" class="lobby-name-screen">
        <h2>Choose your player name</h2>
        ${joinRoom ? `<p>Joining <strong>${esc(joinRoom)}</strong></p>` : ''}
        <label>Your name <input id="lobby-name-input" maxlength="${NAME_MAX}" autocomplete="nickname" required /></label>
        <button type="submit" data-sound="ui.confirm">Continue</button>
      </form>`;
    const nameInput = root.querySelector<HTMLInputElement>('#lobby-name-input')!;
    root.querySelector<HTMLFormElement>('#lobby-name-form')!.onsubmit = (ev) => {
      ev.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return;
      setPlayerName(name);
      if (joinRoom) join(joinRoom, name, preferredMapId, preferredMode);
      else showLobby(apiBase);
    };
    nameInput.focus();
    return;
  }

  root.innerHTML = `
    <h1>Digital Chaos</h1>
    ${VERSION_TAG}
    <label class="lobby-player">Your name <input id="lobby-player" maxlength="${NAME_MAX}" autocomplete="off" /></label>
    <div id="lobby-view" class="lobby-view"></div>
    <div id="lobby-docs" hidden>
      <div class="docs-bar">
        <span>Manual &amp; API reference</span>
        <span>
          <span class="docs-music"></span>
          <button id="lobby-docs-back" data-sound="menu.back" title="Back to the previous manual page">← Back</button>
          <a class="button" href="docs.html" target="_blank" rel="noopener">Open in new tab ↗</a>
          <button id="lobby-docs-close" data-sound="ui.panel_close" title="Close (Esc)">✕</button>
        </span>
      </div>
      <iframe id="lobby-docs-frame" title="Script API documentation"></iframe>
    </div>`;
  const view = root.querySelector<HTMLDivElement>('#lobby-view')!;
  const player = root.querySelector<HTMLInputElement>('#lobby-player')!;
  player.value = getSavedPlayerName() ?? getPlayerName();
  // An emptied box falls back to the saved name.
  const myName = () => player.value.trim() || getPlayerName();
  const docs = root.querySelector<HTMLDivElement>('#lobby-docs')!;
  let current: View = 'main';
  let lobbyDev: LobbyDevTools | undefined;
  /** Moves one step up the history stack if this level was pushed, else runs `fallback`. */
  const up = (fallback: () => void) => {
    if ((lobbyState()?.depth ?? 0) > 0) history.back();
    else fallback();
  };
  const push = (view: View, overlay?: LobbyState['overlay']) => {
    history.pushState({ lobby: true, view, depth: (lobbyState()?.depth ?? 0) + 1, overlay } satisfies LobbyState, '');
  };
  const showDocs = (open: boolean) => {
    const frame = root.querySelector<HTMLIFrameElement>('#lobby-docs-frame')!;
    if (open && !frame.src.endsWith('docs.html')) frame.src = 'docs.html';
    setShown(docs, open);
    placeMusic(open ? docs.querySelector<HTMLElement>('.docs-music') : null); // the player sits in the docs bar meanwhile
  };
  // Closes the manual itself. Pages visited inside it add browser history entries of their own, so a
  // history.back() here would only step back a page: the open entry is rewritten instead.
  const closeDocs = () => {
    const st = lobbyState();
    if (st?.overlay === 'docs') history.replaceState({ ...st, overlay: undefined } satisfies LobbyState, '');
    showDocs(false);
  };
  root.querySelector<HTMLButtonElement>('#lobby-docs-back')!.onclick = () => root.querySelector<HTMLIFrameElement>('#lobby-docs-frame')!.contentWindow?.history.back();
  const openDocs = () => {
    push(current, 'docs');
    showDocs(true);
  };
  root.querySelector<HTMLButtonElement>('#lobby-docs-close')!.onclick = closeDocs;
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && isShown(docs)) {
      playSound('ui.panel_close');
      closeDocs();
    }
  });

  const go = (to: View, pushEntry = true) => {
    if (pushEntry && to !== current) push(to);
    else if (!lobbyState()) history.replaceState({ lobby: true, view: to, depth: 0 } satisfies LobbyState, '');
    current = to;
    lobbyDev?.dispose();
    lobbyDev = undefined;
    clearInterval(refreshTimer);
    refreshTimer = undefined;
    // Going back to the main menu slides the other way from going deeper into it.
    const render = () => {
      if (to === 'main') renderMain();
      else if (to === 'credits') void renderCredits();
      else if (to === 'options') renderOptions();
      else if (to === 'news') showNews({ view, back: () => up(() => go('main', false)) });
      else if (to === 'campaigns') void showCampaigns({ view, apiBase, back: () => up(() => go('main', false)), play: joinCampaign }, campaignTarget());
      else renderSection(to);
    };
    void swapContent(view, render, to === 'main' ? -1 : 1);
  };

  const renderMain = () => {
    view.innerHTML = `
      <section class="menu-panel"><nav class="menu-buttons" aria-label="Main menu">
        ${devMode() ? '<button data-go="campaigns" data-sound="menu.click"><b>Campaigns</b><small>Story missions and the tutorial</small></button>' : ''}
        <button data-go="solo" data-sound="menu.click"><b>Single-player</b><small>You against a bot that sends waves of units</small></button>
        <button data-go="multi" data-sound="menu.click"><b>Multiplayer</b><small>Free-for-all, or co-op against bots</small></button>
        <button id="menu-designer" data-sound="menu.click"><b>Designer</b><small>Design units and buildings and write their programs</small></button>
        <button data-go="news" data-sound="menu.click"><b>News and Updates</b><small>What’s new in the game</small></button>
        <button data-go="options" data-sound="menu.click"><b>Options</b><small>Music and sound effect volume</small></button>
        <button id="menu-docs" data-sound="menu.click"><b>Manual</b><small>How to play, design and program; every function</small></button>
        <button data-go="credits" data-sound="menu.click"><b>Credits</b><small>The music and its licences</small></button>
      </nav></section>`;
    view.querySelectorAll<HTMLButtonElement>('button[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go as View)));
    view.querySelector<HTMLButtonElement>('#menu-docs')!.onclick = () => openDocs();
    const designer = view.querySelector<HTMLButtonElement>('#menu-designer')!;
    designer.onclick = async () => {
      designer.disabled = true;
      try {
        designs ??= new (await import('./localdesigns')).LocalDesigns();
        push(current, 'designer');
        designs.onClose = () => {
          if (lobbyState()?.overlay === 'designer') history.back();
        };
        await designs.open();
      } finally {
        designer.disabled = false;
      }
    };
  };

  const renderOptions = () => {
    const music = musicPlayer();
    const row = (id: string, label: string, value: number) =>
      `<label class="option-row">${label}<input id="${id}" type="range" min="0" max="1" step="0.05" value="${value}" /></label>`;
    view.innerHTML = `
      <div class="section-head"><button id="lobby-back" data-sound="menu.back">← Main menu</button><h2>Options</h2></div>
      <div class="options">
        ${music ? row('opt-music', 'Music volume', music.volume) : ''}
        ${row('opt-effects', 'Effects volume', sound.volume)}
        <label class="option-row">Reduce motion (stops the menu background moving)<input id="opt-motion" type="checkbox"${reduceMotion() ? ' checked' : ''} /></label>
        <label class="option-row">Show alpha maps (unfinished campaign maps in the Multiplayer map list)<input id="opt-alpha" type="checkbox"${showAlphaMaps() ? ' checked' : ''} /></label>
        ${music ? `<label class="option-row">Mute all sound<input id="opt-mute" type="checkbox"${music.muted ? ' checked' : ''} /></label>` : ''}
      </div>`;
    view.querySelector<HTMLButtonElement>('#lobby-back')!.onclick = () => up(() => go('main', false));
    view.querySelector<HTMLInputElement>('#opt-music')?.addEventListener('input', (ev) => music?.setVolume(Number((ev.target as HTMLInputElement).value)));
    const effects = view.querySelector<HTMLInputElement>('#opt-effects')!;
    effects.oninput = () => sound.setVolume(Number(effects.value));
    // A sample on release, so the level can be judged.
    effects.onchange = () => playSound('ui.confirm');
    view.querySelector<HTMLInputElement>('#opt-motion')!.onchange = (ev) => setReduceMotion((ev.target as HTMLInputElement).checked);
    view.querySelector<HTMLInputElement>('#opt-alpha')!.onchange = (ev) => setShowAlphaMaps((ev.target as HTMLInputElement).checked);
    view.querySelector<HTMLInputElement>('#opt-mute')?.addEventListener('change', (ev) => music?.setMuted((ev.target as HTMLInputElement).checked));
  };

  /** A scrolling credits roll: the people, then every music track and sound effect with its licence. */
  const renderCredits = async () => {
    view.innerHTML = `
      <div class="section-head"><button id="lobby-back" data-sound="menu.back">← Main menu</button><h2>Credits</h2></div>
      <div id="credits-view" class="muted">Loading…</div>`;
    view.querySelector<HTMLButtonElement>('#lobby-back')!.onclick = () => up(() => go('main', false));
    const box = view.querySelector<HTMLDivElement>('#credits-view')!;
    const load = async <T>(path: string, pick: (json: unknown) => T[] | undefined): Promise<T[]> => {
      try {
        const res = await fetch(`${apiBase}/${path}`);
        if (res.ok) return pick(await res.json()) ?? [];
      } catch {
        // Left out of the roll.
      }
      return [];
    };
    const [tracks, effects] = await Promise.all([
      load<CreditTrack>('music', (j) => (Array.isArray(j) ? (j as CreditTrack[]) : undefined)),
      load<CreditSound>('sound', (j) => (j as { sounds?: CreditSound[] }).sounds),
    ]);
    // A sound listed under several tags is one credit.
    const seen = new Set<string>();
    const sounds = effects.filter((s) => {
      const key = `${s.name}|${s.author}|${s.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const link = (href: string, text: string) => (/^https?:\/\//i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));
    const entry = (name: string, by: string, url: string, license: string, licenseUrl?: string) => `<div class="credit">
        <b>${esc(name)}</b>${by ? ` — ${esc(by)}` : ''}
        <small>${url ? link(url, url) : ''}${url && license ? '<br>' : ''}${license ? (licenseUrl ? link(licenseUrl, license) : esc(license)) : ''}</small>
      </div>`;
    const person = (name: string, role: string) => `<div class="credit-person"><b>${esc(name)}</b><span>${esc(role)}</span></div>`;
    const html =
      '<h3>Made by</h3>' +
      CREDIT_PEOPLE.map((p) => person(p.name, p.role)).join('') +
      (tracks.length ? '<h3>Music</h3>' + tracks.map((t) => entry(t.name, t.composer, t.url, t.license, t.licenseUrl)).join('') : '') +
      (sounds.length ? '<h3>Sound effects</h3>' + sounds.map((s) => entry(s.name, s.author, s.url, s.license)).join('') : '') +
      '<p class="credits-end">Thank you for playing.</p>';
    box.className = '';
    box.innerHTML = `<div class="credits-roll">${html}</div>`;
    const pause = document.createElement('button');
    pause.id = 'credits-pause';
    pause.textContent = 'Pause';
    pause.onclick = () => {
      pause.textContent = box.classList.toggle('paused') ? 'Resume' : 'Pause';
    };
    box.after(pause);
    // Roughly three seconds per credit, so the pace is the same however long the list grows.
    box.style.setProperty('--roll-s', `${Math.max(40, (CREDIT_PEOPLE.length + tracks.length + sounds.length) * 3)}s`);
  };

  const renderSection = (which: RoomView) => {
    const withCampaign = which === 'multi' && showAlphaMaps();
    if (!withCampaign && !MAPS.some((map) => map.id === rememberedMap)) rememberedMap = DEFAULT_MAP_ID;
    const section = SECTIONS[which];
    const modes = GAME_MODES.filter((m) => m.id === 'versus' || m.id === 'coop');
    const form = `
      <form id="lobby-create">
        ${
          which === 'solo'
            ? '<h3>Choose a map</h3>'
            : `<input id="lobby-name" maxlength="24" placeholder="Room name (optional)" autocomplete="off" />
        <fieldset class="mode-picker"><legend>Game type</legend>${modes
          .map((m) => `<label><input type="radio" name="mode" value="${m.id}"${m.id === rememberedMode ? ' checked' : ''}> <b>${esc(m.name)}</b> <small>${esc(m.description)}</small></label>`)
          .join('')}</fieldset>`
        }
        ${mapPicker(rememberedMap, withCampaign)}
        <button type="submit" class="primary" data-sound="ui.confirm">${which === 'solo' ? 'Start game' : 'Create room'}</button>
      </form>
      <div id="lobby-error" class="muted"></div>`;
    view.innerHTML = `
      <div class="section-head"><button id="lobby-back" data-sound="menu.back">← Main menu</button><h2>${esc(section.title)}</h2></div>
      <p class="muted section-blurb">${esc(section.blurb)}</p>
      ${
        which === 'solo'
          ? form
          : `<div class="glass-tabs"><div class="glass-tab-list" role="tablist" aria-label="Multiplayer">
          <button type="button" role="tab" id="tab-games" data-tab="games" aria-selected="true" aria-controls="panel-games" data-sound="menu.click">Games</button>
          <button type="button" role="tab" id="tab-create" data-tab="create" aria-selected="false" aria-controls="panel-create" tabindex="-1" data-sound="menu.click">Create a room</button>
        </div>
        <div id="panel-games" class="glass-tab-panel lobby-panel" role="tabpanel" aria-labelledby="tab-games"><p id="lobby-online" class="lobby-online muted">Counting players…</p><p id="lobby-rooms-note" class="muted">Looking for rooms…</p><div id="lobby-rooms"></div></div>
        <div id="panel-create" class="glass-tab-panel lobby-panel" role="tabpanel" aria-labelledby="tab-create" hidden>${form}</div></div>`
      }`;
    view.querySelector<HTMLButtonElement>('#lobby-back')!.onclick = () => up(() => go('main', false));
    const tabs = [...view.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const panels = [...view.querySelectorAll<HTMLElement>('.lobby-panel')];
    const pick = (id: string, focus = false) => {
      for (const tab of tabs) {
        const on = tab.dataset.tab === id;
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
        if (on && focus) tab.focus();
      }
      for (const panel of panels) {
        const open = panel.id === `panel-${id}`;
        const wasHidden = panel.hidden;
        panel.hidden = !open;
        if (open && wasHidden) fadeIn(panel);
      }
    };
    tabs.forEach((tab, i) => {
      tab.onclick = () => pick(tab.dataset.tab!);
      tab.onkeydown = (ev) => {
        if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
        ev.preventDefault();
        pick(tabs[(i + (ev.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].dataset.tab!, true);
      };
    });
    const error = view.querySelector<HTMLDivElement>('#lobby-error')!;
    const input = view.querySelector<HTMLInputElement>('#lobby-name');
    view.querySelector<HTMLFormElement>('#lobby-create')!.onsubmit = (ev) => {
      ev.preventDefault();
      const name = which === 'solo' ? `solo-${randomHex(6)}` : input!.value.trim() || randomRoomName();
      const mapId = view.querySelector<HTMLSelectElement>('select[name="map"]')?.value ?? DEFAULT_MAP_ID;
      const mode: GameMode = which === 'solo' ? 'solo' : parseGameMode(view.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value);
      if (ROOM_NAME.test(name)) join(name, myName(), mapId, mode);
      else error.textContent = 'Room names use letters, digits, - and _ (up to 24 characters).';
    };
    view.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((radio) => {
      radio.onchange = () => (rememberedMode = parseGameMode(radio.value));
    });
    const select = view.querySelector<HTMLSelectElement>('select[name="map"]')!;
    const showMap = () => {
      rememberedMap = select.value;
      const src = preview(select.value);
      const img = view.querySelector<HTMLImageElement>('.map-preview img')!;
      img.src = src;
      img.hidden = !src;
      view.querySelector('.map-preview small')!.innerHTML = mapCaption(select.value);
    };
    select.onchange = showMap;
    if (withCampaign) {
      void fetchCampaigns(apiBase).then((campaigns) => {
        if (!campaigns || !select.isConnected) return;
        campaignMaps = campaigns.flatMap((c) =>
          c.levels.map((l) => ({ id: `${c.id}/${l.id}`, label: `${c.name}/${l.name}`, width: l.width, height: l.height, description: l.briefing.title })),
        );
        select.innerHTML = mapOptions(rememberedMap, true);
        showMap();
      });
    }
    if (which === 'solo') return;

    const list = view.querySelector<HTMLDivElement>('#lobby-rooms')!;
    const note = view.querySelector<HTMLElement>('#lobby-rooms-note')!;
    const online = view.querySelector<HTMLElement>('#lobby-online')!;
    /** "N players online" with a per-mode breakdown of matches and players, solo included. */
    const renderOnline = (all: RoomInfo[], inMenu: number) => {
      const live = all.filter((r) => r.players > 0);
      const inMatches = live.reduce((n, r) => n + r.players, 0);
      const total = inMatches + inMenu;
      if (!total) {
        online.textContent = 'No players online right now.';
        return;
      }
      const parts = GAME_MODES.map((m) => {
        const rooms = live.filter((r) => r.mode === m.id);
        if (!rooms.length) return '';
        const people = rooms.reduce((n, r) => n + r.players, 0);
        const matches = `${rooms.length} ${rooms.length === 1 ? 'match' : 'matches'}`;
        return `${esc(m.name)}: ${people} ${people === 1 ? 'player' : 'players'} in ${matches}`;
      }).filter(Boolean);
      if (inMenu) parts.push(`In the menu: ${inMenu}`);
      online.innerHTML = `<strong>${total} ${total === 1 ? 'player' : 'players'} online</strong><br>${parts.join(' · ')}`;
    };
    const roomHtml = (r: RoomInfo): string => {
      const full = r.players >= r.capacity;
      const locked = full || r.example === true;
      const state = r.over ? 'finished' : r.lobby ? 'in lobby' : full ? 'full' : 'open';
      // A game that is already under way is easy to spot: its clock is running or has run.
      const time = r.lobby ? 'waiting to start' : r.elapsed > 0 ? `${clock(r.elapsed)} in${r.paused ? ' (paused)' : ''}` : 'not started';
      const scores = r.scores
        .map((p) => `${esc(p.name)} ${p.score}${p.connected ? '' : ' (away)'}${p.eliminated ? ' (out)' : ''}`)
        .join(' · ');
      return `<span class="name">${esc(r.name)} <span class="mode-tag ${esc(r.mode)}">${esc(modeName(r.mode))}</span><small>${esc(r.mapName)} · ${r.width} × ${r.height}<br>${scores || 'no players yet'}</small></span><span class="muted">${r.players}/${r.capacity} · ${state} · ${time}</span><button data-sound="ui.confirm" data-room="${esc(r.name)}" data-map="${esc(r.mapId)}" data-mode="${esc(r.mode)}"${locked ? ' disabled' : ''}${r.example ? ' title="Example room from the dev tools: not a real match"' : ''}>Join</button>`;
    };
    // One element per room, kept between refreshes: a new room grows in, a room that has gone collapses away.
    const rows = new Map<string, { el: HTMLElement; html: string }>();
    const syncRooms = (active: RoomInfo[]) => {
      const seen = new Set<string>();
      let prev: ChildNode | null = null;
      let added = 0;
      for (const r of active) {
        seen.add(r.name);
        const html = roomHtml(r);
        let row = rows.get(r.name);
        const isNew = !row;
        if (!row) {
          const el = document.createElement('div');
          el.className = 'lobby-room';
          row = { el, html: '' };
          rows.set(r.name, row);
        }
        if (row.html !== html) {
          row.el.innerHTML = html;
          row.html = html;
        }
        const at: ChildNode | null = prev ? prev.nextSibling : list.firstChild;
        if (row.el !== at) list.insertBefore(row.el, at);
        if (isNew) growRow(row.el, Math.min(added++, 8) * 60);
        prev = row.el;
      }
      for (const [name, row] of rows) {
        if (seen.has(name)) continue;
        rows.delete(name);
        row.el.querySelectorAll('button').forEach((b) => (b.disabled = true));
        void shrinkRow(row.el);
      }
    };
    list.onclick = (ev) => {
      const b = (ev.target as Element).closest<HTMLButtonElement>('button[data-room]');
      if (b && !b.disabled) join(b.dataset.room!, myName(), b.dataset.map, parseGameMode(b.dataset.mode));
    };
    let devRooms: () => RoomInfo[] = () => [];
    let lastReal: RoomInfo[] = [];
    let lastInMenu = 0;
    const render = (real: RoomInfo[], inMenu: number) => {
      lastReal = real;
      lastInMenu = inMenu;
      const all = [...real, ...devRooms()];
      renderOnline(all, inMenu);
      const active = all.filter((r) => r.players > 0 && r.mode !== 'solo');
      note.textContent = 'No active games. Create a room to invite others.';
      note.hidden = active.length > 0;
      syncRooms(active);
    };
    const refresh = async () => {
      try {
        const [res, menu] = await Promise.all([fetch(`${apiBase}/rooms`), fetch(`${apiBase}/menu`).catch(() => undefined)]);
        const inMenu = menu?.ok ? ((await menu.json()) as { players: number }).players : 0;
        render((await res.json()) as RoomInfo[], inMenu);
      } catch {
        syncRooms([]);
        note.textContent = 'Can’t reach the server.';
        note.hidden = false;
        online.textContent = '';
      }
    };
    void refresh();
    if (__WST_DEV_TOOLS__) {
      void import('./lobbyDevTools').then(({ LobbyDevTools, exampleRooms }) => {
        if (current !== 'multi') return;
        lobbyDev?.dispose();
        lobbyDev = new LobbyDevTools(() => render(lastReal, lastInMenu));
        devRooms = exampleRooms;
        render(lastReal, lastInMenu);
      });
    }
    refreshTimer = setInterval(() => void refresh(), REFRESH_MS);
  };

  // A name typed here is remembered straight away, so every section joins under it.
  player.onchange = () => {
    if (player.value.trim()) setPlayerName(player.value.trim());
  };
  if (popHandler) window.removeEventListener('popstate', popHandler);
  popHandler = () => {
    const st = lobbyState();
    if (!st) return;
    showDocs(st.overlay === 'docs');
    if (st.overlay !== 'designer') designs?.close();
    if (st.view !== current) go(st.view, false);
  };
  window.addEventListener('popstate', popHandler);
  const startView: View = preferredMode === 'solo' ? 'solo' : 'multi';
  history.replaceState({ lobby: true, view: 'main', depth: 0 } satisfies LobbyState, '');
  go(joinRoom ? startView : campaignTarget() ? 'campaigns' : 'main', false);
}
