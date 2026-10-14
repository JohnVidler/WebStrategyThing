/** Room list shown when the page is opened without ?room=: pick a match or create one. */
import { getPlayerName, getSavedPlayerName, NAME_MAX, setPlayerName } from './playerName';
import { randomHex } from './random';
import { createMapTerrain, DEFAULT_MAP_ID, MAPS } from '@wst/engine';

interface RoomInfo {
  readonly name: string;
  readonly mapId: string;
  readonly mapName: string;
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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

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

const join = (room: string, name: string, mapId = DEFAULT_MAP_ID) => {
  setPlayerName(name);
  location.href = `${location.pathname}?room=${encodeURIComponent(room)}&map=${encodeURIComponent(mapId)}`;
};

/** `apiBase` is the same-origin API root, e.g. /api/v1. */
export function showLobby(apiBase: string, joinRoom?: string, preferredMapId = DEFAULT_MAP_ID): void {
  const root = document.getElementById('lobby')!;
  document.getElementById('panel')!.hidden = true;
  document.getElementById('stage')!.hidden = true;
  root.hidden = false;

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
      if (joinRoom) join(joinRoom, name, preferredMapId);
      else showLobby(apiBase);
    };
    nameInput.focus();
    return;
  }

  root.innerHTML = `
    <h1>Digital Chaos</h1>
    <h2>Choose a match</h2>
    <label class="lobby-player">Your name <input id="lobby-player" maxlength="${NAME_MAX}" autocomplete="off" /></label>
    <div id="lobby-rooms" class="muted">Looking for rooms…</div>
    <form id="lobby-create">
      <input id="lobby-name" maxlength="24" placeholder="New room name (optional)" autocomplete="off" />
      <fieldset class="map-picker">
        <legend>Map for new game</legend>
        <div class="map-grid">${MAPS.map((map) => `<label class="map-choice${map.id === preferredMapId ? ' selected' : ''}"><input type="radio" name="map" value="${map.id}"${map.id === preferredMapId ? ' checked' : ''} required><img src="${preview(map.id)}" alt="${esc(map.name)} terrain preview"><span><b>${esc(map.name)}</b><small>${map.width} × ${map.height} · ${esc(map.description)}</small></span></label>`).join('')}</div>
      </fieldset>
      <button type="submit">Create room</button>
    </form>
    <div id="lobby-error" class="muted"></div>`;
  const list = root.querySelector<HTMLDivElement>('#lobby-rooms')!;
  const input = root.querySelector<HTMLInputElement>('#lobby-name')!;
  const error = root.querySelector<HTMLDivElement>('#lobby-error')!;
  const player = root.querySelector<HTMLInputElement>('#lobby-player')!;
  player.value = getSavedPlayerName() ?? getPlayerName();
  // An emptied box falls back to the saved name.
  const myName = () => player.value.trim() || getPlayerName();

  root.querySelector<HTMLFormElement>('#lobby-create')!.onsubmit = (ev) => {
    ev.preventDefault();
    const name = input.value.trim() || randomRoomName();
    const mapId = root.querySelector<HTMLInputElement>('input[name="map"]:checked')?.value ?? DEFAULT_MAP_ID;
    if (ROOM_NAME.test(name)) join(name, myName(), mapId);
    else error.textContent = 'Room names use letters, digits, - and _ (up to 24 characters).';
  };
  root.querySelectorAll<HTMLInputElement>('input[name="map"]').forEach((radio) => {
    radio.onchange = () => root.querySelectorAll('.map-choice').forEach((choice) => choice.classList.toggle('selected', choice.contains(root.querySelector('input[name="map"]:checked'))));
  });

  const render = (rooms: RoomInfo[]) => {
    const active = rooms.filter((r) => r.players > 0);
    list.className = active.length ? '' : 'muted';
    if (!active.length) {
      list.textContent = 'No active rooms. Create a room to invite others.';
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
        return `<div class="lobby-room"><span class="name">${esc(r.name)}<small>${esc(r.mapName)} · ${r.width} × ${r.height}<br>${scores || 'no players yet'}</small></span><span class="muted">${r.players}/${r.capacity} · ${state} · ${time}</span><button data-room="${esc(r.name)}" data-map="${esc(r.mapId)}"${full ? ' disabled' : ''}>Join</button></div>`;
      })
      .join('');
    list.querySelectorAll<HTMLButtonElement>('button[data-room]').forEach((b) => (b.onclick = () => join(b.dataset.room!, myName(), b.dataset.map)));
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
  setInterval(() => void refresh(), REFRESH_MS);
}
