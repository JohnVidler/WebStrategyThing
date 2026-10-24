import { pick, SoundBank, type Pool, type SoundFileInfo, type SoundManifest } from './soundbank';

const STORAGE_KEY = 'wst-sfx';

interface Saved {
  volume: number;
}

function loadSaved(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Saved>;
    return { volume: typeof v.volume === 'number' ? Math.min(1, Math.max(0, v.volume)) : 0.7 };
  } catch {
    return { volume: 0.7 };
  }
}

export interface PlayOptions {
  /** Where it happens, in tiles. Sounds of positional tags fade with distance from the view and pan left/right. */
  x?: number;
  y?: number;
  /** Extra gain, 0..1. */
  volume?: number;
  /** Loop whatever is chosen, whatever the manifest says. */
  loop?: boolean;
  /** Fade in over this long. */
  fadeInMs?: number;
}

/** A looping sound that can be stopped. */
export interface SoundHandle {
  /** Stops it, fading out over `fadeMs` if given. */
  stop(fadeMs?: number): void;
  /** Set once it has stopped for any reason. */
  readonly ended: boolean;
}

/** Where the view is, in tiles: centre and how far away things can still be heard. */
interface Listener {
  x: number;
  y: number;
  radius: number;
}

/**
 * Sound effects, chosen by event tag from the server's sound manifest (see SOUND_EVENTS.md).
 * Everything is resolved when the manifest loads, so play() is a map lookup, a random index and
 * a buffer source. It does nothing at all until the manifest arrives, for tags without sounds,
 * and while the browser has not yet allowed audio.
 */
export class SoundPlayer {
  private bank: SoundBank | undefined;
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private readonly saved = loadSaved();
  private muted = false;
  private listener: Listener = { x: 0, y: 0, radius: 40 };
  private apiBase = '';
  /** Fetched but not yet decoded files, then decoded ones. */
  private readonly raw = new Map<string, Promise<ArrayBuffer | undefined>>();
  private readonly decoded = new Map<string, AudioBuffer | Promise<AudioBuffer | undefined> | null>();
  /** Looping beds by layer (e.g. 'bed', 'combat'): the tag wanted and the sound currently carrying it. */
  private readonly layers = new Map<string, { tag: string; handle?: SoundHandle }>();
  private ambientTimer: number | undefined;

  constructor() {
    // Capture phase on the window, so nothing in the page can swallow the gesture that unlocks audio.
    for (const type of ['pointerdown', 'mousedown', 'touchend', 'keydown', 'click']) window.addEventListener(type, this.onGesture, true);
  }

  /** Fetches the manifest and starts fetching its files. Safe to call once; a missing server just means no effects. */
  async load(apiBase: string): Promise<void> {
    this.apiBase = apiBase;
    for (let attempt = 0; attempt < 4 && !this.bank; attempt++) {
      try {
        const res = await fetch(`${apiBase}/sound`);
        if (!res.ok) break;
        const manifest = (await res.json()) as SoundManifest;
        const bank = new SoundBank({ sounds: manifest.sounds ?? [], tags: manifest.tags ?? [] });
        for (const w of bank.warnings) console.warn(w);
        this.bank = bank;
        for (const sound of manifest.sounds ?? []) this.fetchRaw(sound.file);
        this.decodeAll();
        if (this.layers.size) this.syncAmbient();
      } catch {
        await new Promise((done) => setTimeout(done, 3000));
      }
    }
  }

  get volume(): number {
    return this.saved.volume;
  }

  setVolume(volume: number): void {
    this.saved.volume = Math.min(1, Math.max(0, volume));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saved));
    } catch {
      // Not persisted; fine.
    }
    this.applyGain();
  }

  /** Follows the music mute button. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  /** Where the camera looks: sounds beyond `radius` tiles are not played. Call whenever the view changes. */
  setListener(x: number, y: number, radius: number): void {
    this.listener.x = x;
    this.listener.y = y;
    this.listener.radius = Math.max(1, radius);
  }

  /** Plays one of the sounds for `tag`, if there are any. Returns a handle for looping sounds. */
  play(tag: string, options?: PlayOptions): SoundHandle | undefined {
    const bank = this.bank;
    const ctx = this.ctx;
    if (!bank || !ctx || !this.master) return undefined;
    const pool = bank.pool(tag);
    if (pool.sounds.length === 0 || this.muted || this.saved.volume <= 0) return undefined;
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => undefined);
      return undefined;
    }
    const now = performance.now();
    if (now - pool.lastPlayed < pool.cooldownMs) return undefined;
    if (pool.maxVoices > 0 && pool.voices >= pool.maxVoices) return undefined;

    let gain = options?.volume ?? 1;
    let pan = 0;
    if (pool.positional && options?.x !== undefined && options.y !== undefined) {
      const dx = options.x - this.listener.x;
      const dy = options.y - this.listener.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= this.listener.radius) return undefined;
      const near = 1 - distance / this.listener.radius;
      gain *= near * near;
      pan = Math.max(-1, Math.min(1, dx / this.listener.radius)) * 0.8;
    }

    const sound = pick(pool);
    if (!sound) return undefined;
    const buffer = this.buffer(sound);
    if (!buffer) return undefined; // still loading: skipped this once
    pool.lastPlayed = now;
    return this.start(ctx, this.master, pool, sound, buffer, gain * sound.volume, pan, options);
  }

  /**
   * Keeps a looping background sound going on `layer` (undefined = none). Starts when audio is
   * allowed and the file is ready, and fades between tags.
   */
  setAmbient(layer: string, tag: string | undefined): void {
    const have = this.layers.get(layer);
    if (have?.tag === tag) return;
    have?.handle?.stop(1500);
    if (tag) this.layers.set(layer, { tag });
    else this.layers.delete(layer);
    this.syncAmbient();
  }

  private syncAmbient(): void {
    let waiting = false;
    for (const layer of this.layers.values()) {
      if (layer.handle && !layer.handle.ended) continue;
      layer.handle = this.play(layer.tag, { loop: true, fadeInMs: 1500 });
      if (!layer.handle && this.bank?.pool(layer.tag).sounds.length) waiting = true; // has sounds, just not ready yet
    }
    if (waiting && this.ambientTimer === undefined) this.ambientTimer = window.setInterval(() => this.syncAmbient(), 1000);
    else if (!waiting && this.ambientTimer !== undefined) {
      window.clearInterval(this.ambientTimer);
      this.ambientTimer = undefined;
    }
  }

  private start(
    ctx: AudioContext,
    out: AudioNode,
    pool: Pool,
    sound: SoundFileInfo,
    buffer: AudioBuffer,
    gain: number,
    pan: number,
    options?: PlayOptions,
  ): SoundHandle {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = options?.loop ?? sound.loop;
    if (sound.pitchVariance > 0) source.playbackRate.value = 1 + (Math.random() * 2 - 1) * sound.pitchVariance;
    const level = ctx.createGain();
    if (options?.fadeInMs) {
      level.gain.value = 0;
      level.gain.linearRampToValueAtTime(gain, ctx.currentTime + options.fadeInMs / 1000);
    } else {
      level.gain.value = gain;
    }
    source.connect(level);
    let tail: AudioNode = level;
    let panner: StereoPannerNode | undefined;
    if (pan !== 0) {
      panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      level.connect(panner);
      tail = panner;
    }
    tail.connect(out);
    pool.voices++;
    let ended = false;
    source.onended = () => {
      if (ended) return;
      ended = true;
      pool.voices--;
      source.disconnect();
      level.disconnect();
      panner?.disconnect();
    };
    source.start();
    const handle = {
      get ended() {
        return ended;
      },
      stop: (fadeMs = 0) => {
        if (ended) return;
        if (fadeMs > 0) {
          level.gain.cancelScheduledValues(ctx.currentTime);
          level.gain.setValueAtTime(level.gain.value, ctx.currentTime);
          level.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeMs / 1000);
          source.stop(ctx.currentTime + fadeMs / 1000);
        } else {
          source.stop();
        }
      },
    };
    return handle;
  }

  // --- loading ----------------------------------------------------------------------

  private fetchRaw(file: string): Promise<ArrayBuffer | undefined> {
    let raw = this.raw.get(file);
    if (!raw) {
      raw = fetch(`${this.apiBase}/sound/${encodeURIComponent(file)}`).then(
        (res) => (res.ok ? res.arrayBuffer() : undefined),
        () => undefined,
      );
      this.raw.set(file, raw);
    }
    return raw;
  }

  /** The decoded file, or undefined if it is not ready yet (decoding is started). */
  private buffer(sound: SoundFileInfo): AudioBuffer | undefined {
    const have = this.decoded.get(sound.file);
    if (have instanceof AudioBuffer) return have;
    if (have === undefined) this.decode(sound.file);
    return undefined;
  }

  private decode(file: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const done = this.fetchRaw(file)
      .then((data) => (data ? ctx.decodeAudioData(data.slice(0)) : undefined))
      .then(
        (buffer) => {
          this.decoded.set(file, buffer ?? null);
          return buffer;
        },
        () => {
          this.decoded.set(file, null); // a bad file: never tried again
          return undefined;
        },
      );
    this.decoded.set(file, done);
  }

  private decodeAll(): void {
    if (!this.ctx || !this.bank) return;
    for (const file of this.raw.keys()) if (!this.decoded.has(file)) this.decode(file);
  }

  // --- browser audio unlock ---------------------------------------------------------

  /** Browsers only allow audio after the page has been clicked or typed into. */
  private readonly onGesture = (): void => {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      // A fixed limiter after the volume control, so a big fight (many overlapping explosions and shots)
      // is squashed instead of clipping. One native node, run by the audio thread: no per-play cost.
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.knee.value = 10;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.2;
      this.master.connect(limiter);
      limiter.connect(this.ctx.destination);
      this.applyGain();
      this.decodeAll();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    if (this.layers.size) this.syncAmbient();
  };

  private applyGain(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.saved.volume;
  }
}

/** The one sound player: UI code anywhere can call playSound() without any wiring. */
export const sound = new SoundPlayer();

/** Plays an effect by event tag; does nothing if there is no sound for it. */
export function playSound(tag: string, options?: PlayOptions): SoundHandle | undefined {
  return sound.play(tag, options);
}
