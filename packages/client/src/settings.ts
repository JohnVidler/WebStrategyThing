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

const readFlag = (key: string, fallback: boolean): boolean => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};
const writeValue = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisted; fine.
  }
};

const FLASH_KEY = 'wst-full-screen-flashes';
const FLICKER_KEY = 'wst-light-flicker';
const DETAIL_KEY = 'wst-weather-detail';

/** Full-screen flashes (lightning): the player's choice, on by default. Use `flashesAllowed` to decide whether to draw one. */
export const fullScreenFlashes = (): boolean => readFlag(FLASH_KEY, true);
export const setFullScreenFlashes = (on: boolean): void => writeValue(FLASH_KEY, on ? '1' : '0');
/** Lamp flicker as lights switch on and off: the player's choice, on by default. Use `flickerAllowed` to decide whether to draw it. */
export const lightFlicker = (): boolean => readFlag(FLICKER_KEY, true);
export const setLightFlicker = (on: boolean): void => writeValue(FLICKER_KEY, on ? '1' : '0');

export type WeatherDetail = 'simple' | 'fancy';
/** Weather effects: `simple` is the base effect of each kind of weather, `fancy` adds the finer touches. */
export const weatherDetail = (): WeatherDetail => {
  try {
    return localStorage.getItem(DETAIL_KEY) === 'simple' ? 'simple' : 'fancy';
  } catch {
    return 'fancy';
  }
};
export const setWeatherDetail = (detail: WeatherDetail): void => writeValue(DETAIL_KEY, detail);

/** Open warnings that keep every flashing or flickering effect off, whatever the options say. */
let holds = 0;
/** Keeps flashes and flicker off until the returned function is called (the flashing-lights warning is on screen). */
export function holdFlashingEffects(): () => void {
  holds++;
  let released = false;
  return () => {
    if (!released) holds--;
    released = true;
  };
}
/** Whether a full-screen flash may be drawn now. */
export const flashesAllowed = (): boolean => holds === 0 && !reduceMotion() && fullScreenFlashes();
/** Whether lamps may flicker as they switch now. */
export const flickerAllowed = (): boolean => holds === 0 && !reduceMotion() && lightFlicker();

/** Sets the `data-reduce-motion` attribute on <html> that style.css keys off. Call once at start-up. */
export function initSettings(): void {
  apply();
}
