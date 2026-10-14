/** Room list shown when the page is opened without ?room=: pick a match or create one. */
import { getPlayerName, getSavedPlayerName, NAME_MAX, setPlayerName } from './playerName';
import { CHANGELOG } from './changelog';
import { randomHex } from './random';
import { createMapTerrain, DEFAULT_MAP_ID, GAME_MODES, MAPS, parseGameMode, type GameMode } from '@wst/engine';

interface RoomInfo {
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
  readonly scores: readonly { name: string; score: number; connected: boolean; eliminated: boolean }[];
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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** "What's new": the latest update open, older ones folded away. */
const changelogHtml = (): string =>
  `<section class="lobby-changes"><h2>What’s new</h2>${CHANGELOG.map(
    (entry, i) =>
      `<details${i === 0 ? ' open' : ''}><summary>${esc(entry.date)}</summary><ul>${entry.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>`,
  ).join('')}</section>`;

const previews = new Map<string, string>();
const preview = (id: string): string => {
  const cached = previews.get(id);
  if (cached) return cached;
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

const join = (room: string, name: string, mapId = DEFAULT_MAP_ID, mode: GameMode = 'versus') => {
  setPlayerName(name);
  location.href = `${location.pathname}?room=${encodeURIComponent(room)}&map=${encodeURIComponent(mapId)}&mode=${mode}`;
};

type View = 'main' | 'multi' | 'solo' | 'credits';

const modeName = (mode: GameMode): string => GAME_MODES.find((m) => m.id === mode)?.name ?? mode;

/** What each room-based section is called and offers. */
const SECTIONS: Record<Exclude<View, 'main' | 'credits'>, { title: string; blurb: string }> = {
  multi: { title: 'Multiplayer', blurb: 'Join a game on the left, or create one on the right: a free-for-all, or co-op against bots.' },
  solo: { title: 'Single-player', blurb: 'You against a bot that never needs to mine and sends waves of units at you. A private game; good for testing designs.' },
};

const mapCaption = (id: string): string => {
  const map = MAPS.find((item) => item.id === id) ?? MAPS[0];
  return `<b>${esc(map.name)}</b> · ${map.width} × ${map.height}<br>${esc(map.description)}`;
};

/** A list of maps with one preview, for the selected map only. */
const mapPicker = (selectedId: string): string =>
  `<fieldset class="map-picker">
    <legend>Map</legend>
    <div class="map-layout">
      <select name="map" size="5" aria-label="Map">${MAPS.map((map) => `<option value="${map.id}"${map.id === selectedId ? ' selected' : ''}>${esc(map.name)} (${map.width}×${map.height})</option>`).join('')}</select>
      <div class="map-preview"><img src="${preview(selectedId)}" alt="Terrain preview"><small>${mapCaption(selectedId)}</small></div>
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
  document.getElementById('panel')!.hidden = true;
  document.getElementById('stage')!.hidden = true;
  root.hidden = false;
  rememberedMap = preferredMapId;
  rememberedMode = preferredMode === 'coop' ? 'coop' : 'versus';

  if (!getSavedPlayerName()) {
    root.innerHTML = `
      <h1>Digital Chaos</h1>
      <form id="lobby-name-form" class="lobby-name-screen">
        <h2>Choose your player name</h2>
        ${joinRoom ? `<p>Joining <strong>${esc(joinRoom)}</strong></p>` : ''}
        <label>Your name <input id="lobby-name-input" maxlength="${NAME_MAX}" autocomplete="nickname" required /></label>
        <button type="submit">Continue</button>
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
    <label class="lobby-player">Your name <input id="lobby-player" maxlength="${NAME_MAX}" autocomplete="off" /></label>
    <div id="lobby-view" class="lobby-view"></div>
    <div id="lobby-docs" hidden>
      <div class="docs-bar">
        <span>Script API reference</span>
        <span>
          <a class="button" href="docs.html" target="_blank" rel="noopener">Open in new tab ↗</a>
          <button id="lobby-docs-close" title="Close (Esc)">✕</button>
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
    docs.hidden = !open;
  };
  const closeDocs = () => (lobbyState()?.overlay === 'docs' ? history.back() : showDocs(false));
  const openDocs = () => {
    push(current, 'docs');
    showDocs(true);
  };
  root.querySelector<HTMLButtonElement>('#lobby-docs-close')!.onclick = closeDocs;
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !docs.hidden) closeDocs();
  });

  const go = (to: View, pushEntry = true) => {
    if (pushEntry && to !== current) push(to);
    else if (!lobbyState()) history.replaceState({ lobby: true, view: to, depth: 0 } satisfies LobbyState, '');
    current = to;
    clearInterval(refreshTimer);
    refreshTimer = undefined;
    if (to === 'main') renderMain();
    else if (to === 'credits') void renderCredits();
    else renderSection(to);
  };

  const renderMain = () => {
    view.innerHTML = `
      <nav class="menu-buttons" aria-label="Main menu">
        <button data-go="solo"><b>Single-player</b><small>You against a bot that sends waves of units</small></button>
        <button data-go="multi"><b>Multiplayer</b><small>Free-for-all, or co-op against bots</small></button>
        <button id="menu-designer"><b>Designer</b><small>Design units and buildings and write their programs</small></button>
        <button data-go="credits"><b>Credits</b><small>The music and its licences</small></button>
        <button id="menu-docs"><b>API reference</b><small>The scripting language and every function</small></button>
      </nav>
      ${changelogHtml()}`;
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

  /** Every track in the server's music manifest, with its composer and licence. */
  const renderCredits = async () => {
    view.innerHTML = `
      <div class="section-head"><button id="lobby-back">← Main menu</button><h2>Credits</h2></div>
      <div id="credits" class="muted">Loading…</div>`;
    view.querySelector<HTMLButtonElement>('#lobby-back')!.onclick = () => up(() => go('main', false));
    const box = view.querySelector<HTMLDivElement>('#credits')!;
    let tracks: CreditTrack[] = [];
    try {
      const res = await fetch(`${apiBase}/music`);
      if (res.ok) tracks = (await res.json()) as CreditTrack[];
    } catch {
      // Handled below.
    }
    if (!tracks.length) {
      box.textContent = 'No music credits available.';
      return;
    }
    const link = (href: string, text: string) => (/^https?:\/\//i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));
    box.className = '';
    box.innerHTML =
      '<h3>Music</h3>' +
      tracks
        .map(
          (t) => `<div class="credit">
            <b>${esc(t.name)}</b>${t.composer ? ` — ${esc(t.composer)}` : ''}
            <small>${t.url ? link(t.url, t.url) : ''}${t.url && t.license ? '<br>' : ''}${t.license ? (t.licenseUrl ? link(t.licenseUrl, t.license) : esc(t.license)) : ''}</small>
          </div>`,
        )
        .join('');
  };

  const renderSection = (which: Exclude<View, 'main' | 'credits'>) => {
    const section = SECTIONS[which];
    const modes = GAME_MODES.filter((m) => m.id !== 'solo');
    const form = `
      <form id="lobby-create">
        <h3>${which === 'solo' ? 'Choose a map' : 'Create a room'}</h3>
        ${
          which === 'solo'
            ? ''
            : `<input id="lobby-name" maxlength="24" placeholder="Room name (optional)" autocomplete="off" />
        <fieldset class="mode-picker"><legend>Game type</legend>${modes
          .map((m) => `<label><input type="radio" name="mode" value="${m.id}"${m.id === rememberedMode ? ' checked' : ''}> <b>${esc(m.name)}</b> <small>${esc(m.description)}</small></label>`)
          .join('')}</fieldset>`
        }
        ${mapPicker(rememberedMap)}
        <button type="submit" class="primary">${which === 'solo' ? 'Start game' : 'Create room'}</button>
      </form>
      <div id="lobby-error" class="muted"></div>`;
    view.innerHTML = `
      <div class="section-head"><button id="lobby-back">← Main menu</button><h2>${esc(section.title)}</h2></div>
      <p class="muted section-blurb">${esc(section.blurb)}</p>
      ${
        which === 'solo'
          ? form
          : `<div class="lobby-split"><section class="lobby-left"><h3>Games</h3><div id="lobby-rooms" class="muted">Looking for rooms…</div></section><aside class="lobby-right">${form}</aside></div>`
      }`;
    view.querySelector<HTMLButtonElement>('#lobby-back')!.onclick = () => up(() => go('main', false));
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
    select.onchange = () => {
      rememberedMap = select.value;
      view.querySelector<HTMLImageElement>('.map-preview img')!.src = preview(select.value);
      view.querySelector('.map-preview small')!.innerHTML = mapCaption(select.value);
    };
    if (which === 'solo') return;

    const list = view.querySelector<HTMLDivElement>('#lobby-rooms')!;
    const render = (all: RoomInfo[]) => {
      const active = all.filter((r) => r.players > 0 && r.mode !== 'solo');
      list.className = active.length ? '' : 'muted';
      if (!active.length) {
        list.textContent = 'No active games. Create a room to invite others.';
        return;
      }
      list.innerHTML = active
        .map((r) => {
          const full = r.players >= r.capacity;
          const state = r.over ? 'finished' : full ? 'full' : 'open';
          // A game that is already under way is easy to spot: its clock is running or has run.
          const time = r.elapsed > 0 ? `${clock(r.elapsed)} in${r.paused ? ' (paused)' : ''}` : 'not started';
          const scores = r.scores
            .map((p) => `${esc(p.name)} ${p.score}${p.connected ? '' : ' (away)'}${p.eliminated ? ' (out)' : ''}`)
            .join(' · ');
          return `<div class="lobby-room"><span class="name">${esc(r.name)} <span class="mode-tag ${esc(r.mode)}">${esc(modeName(r.mode))}</span><small>${esc(r.mapName)} · ${r.width} × ${r.height}<br>${scores || 'no players yet'}</small></span><span class="muted">${r.players}/${r.capacity} · ${state} · ${time}</span><button data-room="${esc(r.name)}" data-map="${esc(r.mapId)}" data-mode="${esc(r.mode)}"${full ? ' disabled' : ''}>Join</button></div>`;
        })
        .join('');
      list.querySelectorAll<HTMLButtonElement>('button[data-room]').forEach((b) => (b.onclick = () => join(b.dataset.room!, myName(), b.dataset.map, parseGameMode(b.dataset.mode))));
    };
    const refresh = async () => {
      try {
        const res = await fetch(`${apiBase}/rooms`);
        render((await res.json()) as RoomInfo[]);
        error.textContent = '';
      } catch {
        list.className = 'muted';
        list.textContent = 'Can’t reach the server.';
      }
    };
    void refresh();
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
  go(joinRoom ? startView : 'main', false);
}
