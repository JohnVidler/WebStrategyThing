const KEY = 'wst-name';
const SET_KEY = 'wst-name-set';
export const NAME_MAX = 16;

const randomName = () => `anon${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`;

/** A name explicitly chosen by the player, or null while only the generated default exists. */
export function getSavedPlayerName(): string | null {
  try {
    const saved = localStorage.getItem(KEY)?.trim();
    if (!saved) return null;
    if (localStorage.getItem(SET_KEY) !== '1' && /^anon\d{5}$/i.test(saved)) return null;
    return saved.slice(0, NAME_MAX) || null;
  } catch {
    return null;
  }
}

/** The player's chosen name, or a new "anon12345" default that is remembered from then on. */
export function getPlayerName(): string {
  try {
    const saved = localStorage.getItem(KEY)?.trim();
    if (saved) return saved.slice(0, NAME_MAX);
    const name = randomName();
    localStorage.setItem(KEY, name);
    return name;
  } catch {
    return randomName();
  }
}

export function setPlayerName(name: string): void {
  const clean = name.trim().slice(0, NAME_MAX);
  try {
    if (clean) {
      localStorage.setItem(KEY, clean);
      localStorage.setItem(SET_KEY, '1');
    }
  } catch {
    // storage unavailable: the name just isn't remembered
  }
}
