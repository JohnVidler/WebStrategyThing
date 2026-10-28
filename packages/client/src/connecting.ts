import { setShown } from './transition';

/** Flavour text that scrolls past while the real steps are still running. */
const TECHNOBABBLE = [
  'Calibrating flux capacitors',
  'Aligning antenna arrays',
  'Reticulating power conduits',
  'Warming up the matter fabricators',
  'Negotiating handshake with the relay',
  'Defragmenting the fog of war',
  'Seeding the terrain generator',
  'Polishing laser focusing lenses',
  'Syncing unit firmware',
  'Charging the capacitor banks',
  'Bribing the packet goblins',
  'Compiling idle chatter for the drones',
];

/** The real stages between opening the page and the first map; the progress bar counts these off. */
export const STAGE = {
  music: 'Music library indexed',
  sound: 'Sound bank loaded',
  graphics: 'Graphics engine ready',
  link: 'Server link open',
  map: 'Map received',
} as const;
const STAGE_TEXTS: readonly string[] = Object.values(STAGE);

const MIN_SHOWN_MS = 600;
const BABBLE_MS = 650;
const MAX_LINES = 6;

/**
 * Full-screen "Connecting…" cover shown while the game's assets load and the server
 * connection comes up. Real steps (`step`) are mixed with made-up ones until `done`.
 */
export class ConnectingScreen {
  private readonly list: HTMLElement;
  private readonly title: HTMLElement;
  private readonly value: HTMLElement;
  private readonly label: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly stagesDone = new Set<string>();
  private timer: number | undefined;
  private shownAt = 0;
  private babble = [...TECHNOBABBLE].sort(() => Math.random() - 0.5);
  private finished = false;

  constructor(private readonly root: HTMLElement) {
    // The progress tile is the same tile as the meters in the game's top bar: the whole box is the bar.
    root.innerHTML =
      '<div class="connecting-box"><h2>Connecting…</h2><ul aria-live="polite"></ul>' +
      '<div class="env-tile connecting-tile" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span class="env-icon" aria-hidden="true">ϟ</span>' +
      '<span class="env-value"></span><span class="env-label"></span><span class="env-bar"><i></i></span></div></div>';
    this.title = root.querySelector('h2')!;
    this.list = root.querySelector('ul')!;
    this.value = root.querySelector('.env-value')!;
    this.label = root.querySelector('.env-label')!;
    this.fill = root.querySelector('.env-bar > i')!;
    this.showProgress();
  }

  /** The bar follows the stages that have really finished. */
  private showProgress(complete = false): void {
    const total = STAGE_TEXTS.length;
    const n = complete ? total : this.stagesDone.size;
    const pct = Math.round((n / total) * 100);
    this.value.textContent = `${pct}%`;
    this.label.textContent = complete ? 'Ready' : n === 0 ? 'Starting' : `Step ${n} of ${total}`;
    this.fill.style.width = `${pct}%`;
    this.root.querySelector('.connecting-tile')!.setAttribute('aria-valuenow', String(pct));
  }

  show(): void {
    this.shownAt = performance.now();
    setShown(this.root, true);
    this.timer = window.setInterval(() => this.addLine(this.babble.pop() ?? this.refill(), false), BABBLE_MS);
  }

  /** A real milestone: marked with a tick, so it stands out from the flavour text. */
  step(text: string): void {
    if (this.finished) return;
    this.addLine(text, true);
    if (STAGE_TEXTS.includes(text) && !this.stagesDone.has(text)) {
      this.stagesDone.add(text);
      this.showProgress();
    }
  }

  /** The connection is up: fade away (after a short minimum so it never flashes). */
  done(): void {
    if (this.finished) return;
    this.finished = true;
    this.stopTimer();
    this.addLine('Link established', true);
    this.showProgress(true);
    window.setTimeout(() => setShown(this.root, false), Math.max(250, MIN_SHOWN_MS - (performance.now() - this.shownAt)));
  }

  /** The server said no: stay up with the reason, and stop the made-up chatter. */
  fail(text: string): void {
    this.stopTimer();
    this.title.textContent = 'Connection failed';
    this.root.classList.add('failed');
    this.label.textContent = 'Failed';
    this.addLine(text, false);
  }

  /** Back to waiting after a failure or dropped link. */
  retrying(text: string): void {
    if (this.finished) return;
    this.addLine(text, false);
  }

  private refill(): string {
    this.babble = [...TECHNOBABBLE].sort(() => Math.random() - 0.5);
    return this.babble.pop()!;
  }

  private stopTimer(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
  }

  private addLine(text: string, real: boolean): void {
    const li = document.createElement('li');
    li.className = real ? 'real' : 'babble';
    li.textContent = real ? `✓ ${text}` : `${text}…`;
    this.list.append(li);
    while (this.list.children.length > MAX_LINES) this.list.firstElementChild!.remove();
  }
}
