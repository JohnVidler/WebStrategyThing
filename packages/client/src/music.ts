/** What the background music should suit. */
export type MusicContext = 'menu' | 'idle' | 'combat';

interface Track {
  file: string;
  name: string;
  composer: string;
  url: string;
  tags: string[];
}

const FADE_MS = 1500;
const STORAGE_KEY = 'wst-music';

interface Saved {
  muted: boolean;
  volume: number;
}

function loadSaved(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Saved>;
    return { muted: v.muted === true, volume: typeof v.volume === 'number' ? Math.min(1, Math.max(0, v.volume)) : 0.4 };
  } catch {
    return { muted: false, volume: 0.4 };
  }
}

/** One playing track: its element and where its fade (0..1) is heading. */
interface Voice {
  audio: HTMLAudioElement;
  gain: number;
  target: number;
  /** The next track has already been started from this one. */
  handedOver: boolean;
}

/**
 * Background music chosen by game context from the server's tagged track list.
 * A track that suits the new context keeps playing; otherwise the next, random
 * fitting track cross-fades in over the current one. The same happens shortly
 * before a track ends. Does nothing at all if the server has no music.
 */
let instance: MusicPlayer | undefined;

/** Moves the widget into `slot` (e.g. a toolbar), or back where it started when `slot` is null. */
export function placeMusic(slot: HTMLElement | null): void {
  instance?.mountIn(slot);
}

export class MusicPlayer {
  private tracks: Track[] = [];
  private context: MusicContext = 'menu';
  private current: Track | undefined;
  /** Every sounding voice; the last is the newest, the others are fading out. */
  private voices: Voice[] = [];
  private readonly saved = loadSaved();
  private ticker: number | undefined;
  private failures = 0;
  private lastNudge = 0;
  private gestured = false;
  private readonly label: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly root: HTMLElement;

  /** `dock`: sit in the side panel, above the designs bar, instead of floating bottom-right. */
  constructor(
    private readonly apiBase: string,
    dock = false,
  ) {
    instance = this;
    this.root = document.createElement('div');
    this.root.className = 'music';
    this.root.hidden = true;
    this.toggle = document.createElement('button');
    this.toggle.className = 'music-toggle';
    this.toggle.onclick = () => {
      this.saved.muted = !this.saved.muted;
      this.save();
      this.applyVolume();
      if (!this.saved.muted) for (const v of this.voices) if (v.audio.paused) void v.audio.play().catch(() => undefined);
      this.renderToggle();
    };
    this.label = document.createElement('span');
    this.label.className = 'music-label';
    const volume = document.createElement('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '1';
    volume.step = '0.05';
    volume.value = String(this.saved.volume);
    volume.title = 'Music volume';
    volume.oninput = () => {
      this.saved.volume = Number(volume.value);
      this.save();
      this.applyVolume();
    };
    this.root.append(this.toggle, volume, this.label);
    const bar = dock ? document.getElementById('designs-bar') : null;
    if (bar) {
      this.root.classList.add('docked');
      bar.before(this.root);
    } else {
      document.body.append(this.root);
    }
    this.renderToggle();
    // Capture phase on the window, so nothing in the page can swallow the gesture.
    for (const type of ['pointerdown', 'mousedown', 'touchend', 'keydown', 'click'])
      window.addEventListener(type, this.onGesture, true);
  }

  private home: { parent: Node; next: Node | null } | undefined;

  mountIn(slot: HTMLElement | null): void {
    if (slot) {
      this.home ??= { parent: this.root.parentNode!, next: this.root.nextSibling };
      slot.append(this.root);
      this.root.classList.add('inbar');
    } else if (this.home) {
      const { parent, next } = this.home;
      parent.insertBefore(this.root, next && next.parentNode === parent ? next : null);
      this.root.classList.remove('inbar');
      this.home = undefined;
    }
  }

  /** Fetches the track list; call once. Starts playing straight away if there is any. */
  async load(): Promise<void> {
    // The server may still be starting: try a few times before giving up.
    for (let attempt = 0; attempt < 4 && !this.tracks.length; attempt++) {
      try {
        const res = await fetch(`${this.apiBase}/music`);
        if (res.ok) this.tracks = (await res.json()) as Track[];
        else break;
      } catch {
        await new Promise((done) => setTimeout(done, 3000));
      }
    }
    if (!this.tracks.length) return;
    this.root.hidden = false;
    this.playNext();
  }

  setContext(context: MusicContext): void {
    this.nudge();
    if (context === this.context) return;
    this.context = context;
    if (!this.tracks.length) return;
    if (this.current?.tags.includes(context)) return; // it still fits: keep it
    this.playNext();
  }

  /**
   * Called often by the game: if the newest track was refused at autoplay and the page
   * has since been interacted with (the click may never have reached our listeners),
   * start it now.
   */
  private nudge(): void {
    const voice = this.voices[this.voices.length - 1];
    const now = performance.now();
    if (!voice?.audio.paused || voice.audio.error || now - this.lastNudge < 1000) return;
    this.lastNudge = now;
    this.start(voice);
  }

  private candidates(): Track[] {
    // Fall back to idle music if nothing carries the tag (e.g. no combat tracks).
    const fit = this.tracks.filter((t) => t.tags.includes(this.context));
    return fit.length ? fit : this.tracks.filter((t) => t.tags.includes('idle'));
  }

  /** Starts a random fitting track, fading it in while everything already playing fades out. */
  private playNext(): void {
    const options = this.candidates();
    if (!options.length) return;
    // Avoid an immediate repeat when there is a choice.
    const pool = options.length > 1 ? options.filter((t) => t !== this.current) : options;
    const track = pool[Math.floor(Math.random() * pool.length)];
    this.current = track;
    this.showCredit(track);

    for (const v of this.voices) v.target = 0;
    const voice: Voice = { audio: new Audio(`${this.apiBase}/music/${encodeURIComponent(track.file)}`), gain: 0, target: 1, handedOver: false };
    this.voices.push(voice);
    const handOver = () => {
      if (voice.handedOver || voice !== this.voices[this.voices.length - 1]) return;
      voice.handedOver = true;
      this.playNext();
    };
    voice.audio.onended = handOver;
    // Cross-fade into the next track as this one runs out.
    voice.audio.ontimeupdate = () => {
      const left = voice.audio.duration - voice.audio.currentTime;
      if (Number.isFinite(left) && left <= FADE_MS / 1000) handOver();
    };
    voice.audio.onplaying = () => {
      this.failures = 0;
      this.root.classList.remove('blocked');
    };
    voice.audio.onerror = () => {
      this.drop(voice);
      // A bad file: try another, but give up once everything has failed in a row.
      if (++this.failures < this.tracks.length) this.playNext();
    };
    this.applyVolume();
    this.start(voice);
    this.startTicker();
  }

  private showCredit(track: Track): void {
    this.label.textContent = '';
    const text = document.createTextNode(`♪ ${track.name}${track.composer ? ` — ${track.composer}` : ''}`);
    if (track.url) {
      const link = document.createElement('a');
      link.href = track.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.append(text);
      this.label.append(link);
    } else {
      this.label.append(text);
    }
  }

  /**
   * Browsers only allow audio once the page has had a click or key press. Until then
   * nothing is started (a refused play() is handled differently by each browser: Chrome
   * rejects, Firefox leaves it pending); the first gesture starts the newest track.
   */
  private start(voice: Voice): void {
    if (!this.activated()) {
      this.root.classList.add('blocked');
      return;
    }
    voice.audio.play().then(
      () => this.root.classList.remove('blocked'),
      (err: unknown) => {
        if (!this.voices.includes(voice)) return; // superseded or dropped meanwhile
        console.warn('Music could not start:', err);
        this.root.classList.add('blocked');
      },
    );
  }

  private activated(): boolean {
    return this.gestured || (navigator.userActivation?.hasBeenActive ?? false);
  }

  /** The page was just clicked or typed into: start whatever should be playing. */
  private readonly onGesture = (): void => {
    this.gestured = true;
    const voice = this.voices[this.voices.length - 1];
    if (voice?.audio.paused) this.start(voice);
  };

  private startTicker(): void {
    if (this.ticker !== undefined) return;
    let last = performance.now();
    this.ticker = window.setInterval(() => {
      const now = performance.now();
      const step = (now - last) / FADE_MS;
      last = now;
      for (const v of [...this.voices]) {
        if (v.gain < v.target) v.gain = Math.min(v.target, v.gain + step);
        else if (v.gain > v.target) v.gain = Math.max(v.target, v.gain - step);
        if (v.target === 0 && v.gain === 0) this.drop(v);
      }
      this.applyVolume();
      if (this.voices.every((v) => v.gain === v.target)) {
        window.clearInterval(this.ticker);
        this.ticker = undefined;
      }
    }, 50);
  }

  private drop(voice: Voice): void {
    voice.audio.onended = voice.audio.ontimeupdate = voice.audio.onerror = null;
    voice.audio.pause();
    voice.audio.removeAttribute('src');
    voice.audio.load();
    this.voices = this.voices.filter((v) => v !== voice);
  }

  private applyVolume(): void {
    for (const v of this.voices) v.audio.volume = this.saved.muted ? 0 : this.saved.volume * v.gain;
  }

  private renderToggle(): void {
    this.toggle.textContent = this.saved.muted ? '🔇' : '🔊';
    this.toggle.title = this.saved.muted ? 'Unmute music' : 'Mute music';
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saved));
    } catch {
      // Not persisted; fine.
    }
  }
}
