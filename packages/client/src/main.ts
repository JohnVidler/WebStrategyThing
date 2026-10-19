import './style.css';
import { applyTick, DEFAULT_MAP_ID, MAX_UNITS_PER_PLAYER, messageAllowed, parseGameMode, Terrain, type ClientMessage, type ServerMessage } from '@wst/engine';
import { Connection } from './connection';
import { ConnectingScreen } from './connecting';
import { DesignStore } from './designs';
import { GameSounds } from './gameSounds';
import type { Designer } from './designer';
import { Input } from './input';
import { showLobby } from './lobby';
import { MusicPlayer } from './music';
import { getPlayerName, getSavedPlayerName } from './playerName';
import { randomHex } from './random';
import { Renderer } from './renderer';
import { playSound, sound } from './sound';
import { ClientState } from './state';
import { Ui } from './ui';
import { installUiSounds } from './uiSounds';

/** Combat music lingers this long (seconds) after the last damage seen. */
const COMBAT_MUSIC_SECONDS = 15;

async function main(): Promise<void> {
  const apiBase = `${location.origin}/api/v1`;
  const socketProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socketBase = import.meta.env.VITE_SERVER_URL ?? `${socketProtocol}//${location.host}/api/v1/ws`;
  // ?room=name picks a match; without it the page shows the room list instead of joining.
  const room = new URLSearchParams(location.search).get('room');
  const mapId = new URLSearchParams(location.search).get('map') ?? DEFAULT_MAP_ID;
  const mode = parseGameMode(new URLSearchParams(location.search).get('mode'));
  // Background music follows the game: menu tracks in the lobby, idle or combat tracks in a match.
  const music = new MusicPlayer(apiBase, !!room && !!getSavedPlayerName());
  const musicLoaded = music.load();
  // Sound effects: the manifest loads in the background, and every button on the page gets its click sound.
  installUiSounds();
  const soundLoaded = sound.load(apiBase);
  if (!room || !getSavedPlayerName()) {
    sound.setAmbient('bed', 'ambient.menu');
    playSound('menu.enter');
    showLobby(apiBase, room || undefined, mapId, mode);
    return;
  }

  // A cover over the whole page until the server has sent the map; real steps show as they finish.
  const connecting = new ConnectingScreen(document.getElementById('connecting')!);
  connecting.show();
  void musicLoaded.then(() => connecting.step('Music library indexed'));
  void soundLoaded.then(() => connecting.step('Sound bank loaded'));

  // The client keeps a mirror of the networked components only; it never runs unit scripts.
  const state = new ClientState();
  const gameSounds = new GameSounds(state);
  // Nothing is ordered before the match starts or while spectating: the server would ignore it anyway.
  const send = (msg: ClientMessage) => {
    if (messageAllowed(state.inLobby ? 'lobby' : state.spectating ? 'spectating' : 'playing', msg.t)) conn.send(msg);
  };

  const ui = new Ui(state, {
    produce: (building, blueprint) => {
      send({ t: 'produce', building, blueprint });
      // The server refuses a unit past the cap; say so straight away.
      if (state.ownUnitCount() >= MAX_UNITS_PER_PLAYER) {
        playSound('produce.rejected');
        playSound('alert.unit_cap');
      } else {
        playSound('produce.queue');
      }
    },
    setModule: (entity, index, on) => send({ t: 'setModule', units: [entity], index, on }),
    place: (blueprint) => {
      const bp = state.blueprints.get(blueprint);
      if (bp) input.beginPlacement(bp);
    },
    iconFor: (blueprint) => renderer.iconFor(state.blueprints.get(blueprint)!),
    press: (id, queue) => input.press(id, queue),
    recallGroup: (n) => input.recallGroup(n),
    startGame: () => send({ t: 'startGame' }),
    spectate: () => spectate(),
    leave: () => leave(),
  });
  // Designs and scripts persist in this browser and can be downloaded, uploaded or reset.
  const designs = new DesignStore(state, { send, notify: (text, ok) => ui.showResult(text, ok) });
  const fileInput = document.getElementById('designs-file') as HTMLInputElement;
  document.getElementById('designs-download')!.onclick = () => designs.download();
  document.getElementById('designs-upload')!.onclick = () => fileInput.click();
  document.getElementById('designs-reset')!.onclick = () => void designs.reset();
  fileInput.onchange = () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void designs.upload(file);
  };
  const renderPanel = () => {
    ui.renderSelection(input.selection);
    ui.renderActions(input.actions(), input.aiming, performance.now() < input.demolishArmedUntil);
    ui.renderInfo(input.hovered, input.selection);
  };
  const input = new Input(
    state,
    send,
    renderPanel,
    () => ui.setPlacing(input.placement?.bp.id ?? -1),
    () => ui.renderInfo(input.hovered, input.selection),
    () => ui.renderActions(input.actions(), input.aiming, performance.now() < input.demolishArmedUntil),
    () => ui.renderGroups(input.groupList()),
  );
  const renderer = await Renderer.create(document.getElementById('map')!, state, input);
  input.attach(renderer);
  connecting.step('Graphics engine ready');

  // Designing and coding live in their own overlay, separate from playing. It (and the
  // code editor) loads on first use, keeping the game itself quick to start.
  let designer: Designer | undefined;
  let loading: Promise<Designer> | undefined;
  const openDesigner = async () => {
    loading ??= import('./designer').then(
      ({ Designer }) =>
        (designer = new Designer(document.getElementById('stage')!, state, {
          defineClass: (name, parts) => send({ t: 'defineBlueprint', name, parts }),
          uploadProgram: (blueprint, source) => send({ t: 'setProgram', blueprint, source }),
          retireClass: (blueprint, retired) => send({ t: 'retireClass', blueprint, retired }),
          preview: (parts, pxPerTile, rival) => renderer.previewImage(parts, pxPerTile, rival ? (state.myId === 1 ? 2 : 1) : state.myId),
          iconFor: (blueprint) => renderer.iconFor(state.blueprints.get(blueprint)!),
        })),
    );
    (await loading).toggle(true);
  };
  document.getElementById('designer-open')!.onclick = () => void openDesigner();
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'F2' && !designer) {
      ev.preventDefault();
      void openDesigner();
    }
  });

  // Like demolish: the first press arms the button, a second one within 3 s confirms.
  // Resigning gives up the forces and brings up the defeat choice (spectate or leave).
  const resign = document.getElementById('resign') as HTMLButtonElement;
  const idleLabel = () => (state.spectating ? 'Leave' : 'Resign');
  let resignArmedUntil = 0;
  let resignFallback: number | undefined;
  /** Goes back to the menu: the server frees the seat first, with a fallback if it never answers. */
  const leave = () => {
    resign.disabled = true;
    resign.textContent = 'Leaving…';
    conn.send({ t: 'leave' });
    resignFallback = window.setTimeout(() => (location.href = location.pathname), 1500);
  };
  resign.onclick = () => {
    if (performance.now() < resignArmedUntil) {
      resignArmedUntil = 0;
      resign.classList.remove('armed');
      if (state.spectating || state.defeated) {
        playSound('match.leave');
        leave();
      } else {
        playSound('match.forfeit');
        send({ t: 'forfeit' });
        resign.textContent = idleLabel();
      }
      return;
    }
    playSound('ui.click');
    resignArmedUntil = performance.now() + 3000;
    resign.classList.add('armed');
    resign.textContent = 'Press again to confirm';
    setTimeout(() => {
      if (resign.disabled) return;
      resign.classList.remove('armed');
      resign.textContent = idleLabel();
    }, 3000);
  };
  /** Out of the game but not yet watching or gone: the choice is on screen. */
  const spectate = () => {
    send({ t: 'spectate' });
    ui.hideDefeat();
  };

  const handle = (msg: ServerMessage) => {
    gameSounds.onMessage(msg);
    switch (msg.t) {
      case 'welcome':
        state.myId = msg.playerId;
        state.resetSession();
        state.seed = msg.seed;
        state.tickRate = msg.tickRate;
        state.terrain = Terrain.decode(msg.width, msg.height, msg.terrain);
        state.fog = msg.fog;
        state.spectating = msg.spectating;
        state.inLobby = msg.lobby;
        ui.setSpectating(msg.spectating);
        if (!msg.lobby) ui.hideWaitingRoom();
        resign.textContent = idleLabel();
        state.refreshStructures();
        ui.setPlayer(getPlayerName(), room);
        send({ t: 'setName', name: getPlayerName() });
        renderer.configure(msg.tickRate);
        connecting.step('Map received');
        connecting.done();
        break;
      case 'blueprints':
        for (const info of msg.list) state.blueprints.register(info);
        state.refreshStructures();
        ui.updateClasses();
        designer?.updateClasses();
        renderer.restyle();
        designs.onClassesChanged();
        break;
      case 'program':
        state.programs.set(msg.blueprint, msg.source);
        ui.renderActions(input.actions(), input.aiming, performance.now() < input.demolishArmedUntil); // its buttons may have changed
        designs.onClassesChanged();
        designer?.setSource(msg.blueprint, msg.source);
        break;
      case 'programResult':
        designer?.showResult(msg.ok ? 'Program uploaded — all units of this class rebooted.' : msg.error ?? 'Error', msg.ok);
        ui.showResult(msg.ok ? 'Program uploaded.' : 'Program rejected — see the designer.', msg.ok);
        break;
      case 'credits':
        state.pool = msg.amount;
        state.poolCapacity = msg.capacity;
        ui.setCredits(msg.amount);
        ui.renderResourceBars();
        break;
      case 'tasks':
        state.applyTasks(msg.updates);
        break;
      case 'scoreboard':
        ui.setScoreboard(msg.players);
        break;
      case 'pause':
        // A match waiting for another player offers the invite link again.
        ui.showPause(msg.reasons, msg.away, msg.reasons.some((reason) => reason.includes('Waiting for another player')) ? location.href : undefined);
        break;
      case 'lobby':
        ui.showWaitingRoom(msg, location.href);
        break;
      case 'started':
        state.inLobby = false;
        ui.hideWaitingRoom();
        break;
      case 'defeated':
        state.defeated = true;
        ui.showDefeat();
        break;
      case 'resigned':
        if (resignFallback !== undefined) window.clearTimeout(resignFallback);
        location.href = location.pathname;
        break;
      case 'matchOver':
        ui.showStandings(msg.winner, msg.standings, msg.reason, msg.winners);
        break;
      case 'radar':
        state.addRadar(msg.x, msg.y, msg.range, msg.contacts);
        break;
      case 'networks':
        state.setNetworks(msg.list);
        ui.renderResourceBars();
        renderer.highlightNetwork();
        break;
      case 'designsLoaded':
        designs.onLoaded(msg);
        break;
      case 'error':
        ui.showResult(msg.message, false);
        if (designer?.isOpen) designer.showResult(msg.message, false);
        break;
    }
  };

  // The per-tab token lets a dropped connection reclaim its player.
  let token = '';
  try {
    token = sessionStorage.getItem('wst-token') ?? '';
    if (!token) sessionStorage.setItem('wst-token', (token = randomHex()));
  } catch {
    token = randomHex();
  }
  const url = `${socketBase}${socketBase.includes('?') ? '&' : '?'}room=${encodeURIComponent(room)}&token=${token}&map=${encodeURIComponent(mapId)}&mode=${mode}`;
  const conn = new Connection(url, {
    open: () => {
      ui.setStatus('connected');
      connecting.step('Server link open');
    },
    close: (retrying) => {
      if (retrying) connecting.retrying('Server not answering, retrying');
      else connecting.fail('Server refused the connection (match full or invalid room). Refresh to retry.');
      ui.setStatus(retrying ? 'connection lost — reconnecting…' : 'refused (match full or invalid room) — refresh to retry');
      ui.showPause([retrying ? 'Connection to server lost — reconnecting…' : 'Server refused the connection — refresh to retry']);
    },
    json: handle,
    binary: (data) => {
      const info = applyTick(state.world, data);
      state.tick = info.tick;
      state.afterTick();
      const inCombat = state.tick - state.lastCombatTick <= COMBAT_MUSIC_SECONDS * state.tickRate;
      music.setContext(inCombat ? 'combat' : 'idle');
      sound.setAmbient('combat', inCombat ? 'ambient.combat' : undefined);
      if (state.fog) state.updateVision();
      renderer.sync(info);
      const view = renderer.listener();
      sound.setListener(view.x, view.y, view.radius);
      gameSounds.onTick(info);
      input.prune();
      ui.sampleHistory();
      if (state.tick % 5 === 0) ui.renderResourceBars();
      renderPanel();
      state.world.flush();
    },
  });
}

main().catch((err) => console.error(err));
