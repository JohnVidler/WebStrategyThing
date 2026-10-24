const STORAGE_KEY = 'wst-reduce-motion';
const CHANGED = 'wst-reduce-motion-changed';

const stored = (): boolean | undefined => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? undefined : v === '1';
  } catch {
    return undefined;
  }
};

/** Reduce motion: the player's choice, else the system preference. */
export function reduceMotion(): boolean {
  return stored() ?? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

const apply = (): void => {
  document.documentElement.toggleAttribute('data-reduce-motion', reduceMotion());
  window.dispatchEvent(new Event(CHANGED));
};

export function setReduceMotion(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // Not persisted; fine.
  }
  apply();
}

/** Calls `fn` whenever the setting changes. */
export function onReduceMotionChange(fn: () => void): void {
  window.addEventListener(CHANGED, fn);
}

const ALPHA_KEY = 'wst-show-alpha-maps';

/** Whether unfinished (campaign) maps are listed in Multiplayer; off unless the player turns it on. */
export function showAlphaMaps(): boolean {
  try {
    return localStorage.getItem(ALPHA_KEY) === '1';
  } catch {
    return false;
  }
}

export function setShowAlphaMaps(on: boolean): void {
  try {
    localStorage.setItem(ALPHA_KEY, on ? '1' : '0');
  } catch {
    // Not persisted; fine.
  }
}

/** Sets the `data-reduce-motion` attribute on <html> that style.css keys off. Call once at start-up. */
export function initSettings(): void {
  apply();
}
