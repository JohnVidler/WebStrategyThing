import './style.css';
import { applyTick, DEFAULT_MAP_ID, Terrain, type ClientMessage, type ServerMessage } from '@wst/engine';
import { Connection } from './connection';
import { DesignStore } from './designs';
import type { Designer } from './designer';
import { Input } from './input';
import { showLobby } from './lobby';
import { getPlayerName, getSavedPlayerName } from './playerName';
import { randomHex } from './random';
import { Renderer } from './renderer';
import { ClientState } from './state';
import { Ui } from './ui';

async function main(): Promise<void> {
  const apiBase = `${location.origin}/api/v1`;
  const socketProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socketBase = import.meta.env.VITE_SERVER_URL ?? `${socketProtocol}//${location.host}/api/v1/ws`;
  // ?room=name picks a match; without it the page shows the room list instead of joining.
  const room = new URLSearchParams(location.search).get('room');
  const mapId = new URLSearchParams(location.search).get('map') ?? DEFAULT_MAP_ID;
  if (!room || !getSavedPlayerName()) {
    showLobby(apiBase, room || undefined, mapId);
    return;
  }

  // The client keeps a mirror of the networked components only; it never runs unit scripts.
  const state = new ClientState();
  const send = (msg: ClientMessage) => conn.send(msg);

  const ui = new Ui(state, {
    produce: (building, blueprint) => send({ t: 'produce', building, blueprint }),
    setModule: (entity, index, on) => send({ t: 'setModule', units: [entity], index, on }),
    place: (blueprint) => {
      const bp = state.blueprints.get(blueprint);
      if (bp) input.beginPlacement(bp);
    },
    iconFor: (blueprint) => renderer.iconFor(state.blueprints.get(blueprint)!),
    press: (id, queue) => input.press(id, queue),
    recallGroup: (n) => input.recallGroup(n),
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
          preview: (stats) => renderer.previewImage(stats, 96),
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
  const resign = document.getElementById('resign') as HTMLButtonElement;
  let resignArmedUntil = 0;
  let resignFallback: number | undefined;
  resign.onclick = () => {
    if (performance.now() < resignArmedUntil) {
      resign.disabled = true;
      resign.textContent = 'Leaving…';
      send({ t: 'resign' });
      resignFallback = window.setTimeout(() => (location.href = location.pathname), 1500);
      return;
    }
    resignArmedUntil = performance.now() + 3000;
    resign.classList.add('armed');
    resign.textContent = 'Press again to confirm';
    setTimeout(() => {
      resign.classList.remove('armed');
      resign.textContent = 'Resign and Quit';
    }, 3000);
  };

  const handle = (msg: ServerMessage) => {
    switch (msg.t) {
      case 'welcome':
        state.myId = msg.playerId;
        state.resetSession();
        state.seed = msg.seed;
        state.tickRate = msg.tickRate;
        state.terrain = Terrain.decode(msg.width, msg.height, msg.terrain);
        state.fog = msg.fog;
        state.refreshStructures();
        ui.setPlayer(getPlayerName(), room);
        send({ t: 'setName', name: getPlayerName() });
        renderer.configure(msg.tickRate);
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
        ui.showPause(
          msg.reasons,
          msg.away,
          state.tick === 0 && msg.reasons.some((reason) => reason.includes('Waiting for another player')) ? location.href : undefined,
        );
        break;
      case 'resigned':
        if (resignFallback !== undefined) window.clearTimeout(resignFallback);
        location.href = location.pathname;
        break;
      case 'matchOver':
        ui.showStandings(msg.winner, msg.standings, msg.reason);
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
  const url = `${socketBase}${socketBase.includes('?') ? '&' : '?'}room=${encodeURIComponent(room)}&token=${token}&map=${encodeURIComponent(mapId)}`;
  const conn = new Connection(url, {
    open: () => ui.setStatus('connected'),
    close: (retrying) => {
      ui.setStatus(retrying ? 'connection lost — reconnecting…' : 'refused (match full or invalid room) — refresh to retry');
      ui.showPause([retrying ? 'Connection to server lost — reconnecting…' : 'Server refused the connection — refresh to retry']);
    },
    json: handle,
    binary: (data) => {
      const info = applyTick(state.world, data);
      state.tick = info.tick;
      state.afterTick();
      if (state.fog) state.updateVision();
      renderer.sync(info);
      input.prune();
      ui.sampleHistory();
      renderPanel();
      state.world.flush();
    },
  });
}

main().catch((err) => console.error(err));
