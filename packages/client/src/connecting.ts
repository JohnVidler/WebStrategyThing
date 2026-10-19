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
  private timer: number | undefined;
  private shownAt = 0;
  private babble = [...TECHNOBABBLE].sort(() => Math.random() - 0.5);
  private finished = false;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = '<div class="connecting-box"><h2>Connecting…</h2><ul aria-live="polite"></ul><div class="connecting-bar"><span></span></div></div>';
    this.title = root.querySelector('h2')!;
    this.list = root.querySelector('ul')!;
  }

  show(): void {
    this.shownAt = performance.now();
    setShown(this.root, true);
    this.timer = window.setInterval(() => this.addLine(this.babble.pop() ?? this.refill(), false), BABBLE_MS);
  }

  /** A real milestone: marked with a tick, so it stands out from the flavour text. */
  step(text: string): void {
    if (!this.finished) this.addLine(text, true);
  }

  /** The connection is up: fade away (after a short minimum so it never flashes). */
  done(): void {
    if (this.finished) return;
    this.finished = true;
    this.stopTimer();
    this.addLine('Link established', true);
    window.setTimeout(() => setShown(this.root, false), Math.max(250, MIN_SHOWN_MS - (performance.now() - this.shownAt)));
  }

  /** The server said no: stay up with the reason, and stop the made-up chatter. */
  fail(text: string): void {
    this.stopTimer();
    this.title.textContent = 'Connection failed';
    this.root.classList.add('failed');
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
