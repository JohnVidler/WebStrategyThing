declare const __GIT_HASH__: string;
declare const __GIT_BRANCH__: string;

/** Git hash of this build of the game (set by Vite at build time); stored in saved design files. */
export const GAME_VERSION: string = typeof __GIT_HASH__ === 'string' ? __GIT_HASH__ : 'dev';

/** Git branch this build was made from (shown on the main menu). */
export const GAME_BRANCH: string = typeof __GIT_BRANCH__ === 'string' ? __GIT_BRANCH__ : 'dev';
