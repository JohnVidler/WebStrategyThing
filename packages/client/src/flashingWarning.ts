import { holdFlashingEffects } from './settings';

/** How the warning was answered: carry on, or go to the Options menu. */
export type WarningChoice = 'continue' | 'options';

/** Page address of the main menu opened straight on Options (the lobby reads `?options`). */
export const optionsMenuUrl = (): string => `${location.origin}${location.pathname}?options`;

const ACCEPTED_KEY = 'wst-flashing-warning-accepted';
const accepted = (): boolean => {
  try {
    return localStorage.getItem(ACCEPTED_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * The photosensitivity warning: a modal over everything, shown the first time a player loads any part of the game (the
 * menu or a join link); once they accept it, it is not shown again on this browser. While it is open every flash and
 * flicker is held off (`holdFlashingEffects`), whatever the options say. It always offers "Go to Options Menu" instead,
 * which stops anything connecting; the promise resolves with what the player chose.
 */
export function showFlashingWarning(): Promise<WarningChoice> {
  if (accepted() || document.querySelector('.flashing-warning')) return Promise.resolve('continue');
  return new Promise((resolve) => {
    const release = holdFlashingEffects();
    const back = document.createElement('div');
    back.className = 'modal-back flashing-warning';
    back.innerHTML = `<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="flashing-warning-title" aria-describedby="flashing-warning-text"><h2 id="flashing-warning-title">Photosensitivity warning</h2>
    <div class="modal-body" id="flashing-warning-text">
      <p>This game has flashing lights and flickering effects, including full-screen flashes during thunderstorms and lamps that flicker as they switch on and off. They may trigger seizures in people with photosensitive epilepsy. If you or anyone in your family has a history of seizures or epilepsy, consult a doctor before playing.</p>
      <p>Stop playing straight away if you feel dizzy, lightheaded or confused, or notice twitching or loss of awareness.</p>
      <p>Nothing flashes or flickers while this message is open. Under <b>Options</b> you can turn off full-screen flashes and light flicker, simplify the weather, or switch on Reduce motion. To change them before you play, go to the Options menu now.</p>
    </div>
    <div class="modal-actions"><button class="flashing-leave" data-sound="menu.back">Go to Options Menu</button><button class="primary flashing-ok" data-sound="menu.click">I understand</button></div></div>`;
    const finish = (choice: WarningChoice) => {
      window.removeEventListener('keydown', onKey, true);
      back.remove();
      // Leaving keeps the hold: the page is about to be replaced, and nothing may flash on the way out.
      if (choice === 'continue') {
        try {
          localStorage.setItem(ACCEPTED_KEY, '1');
        } catch {
          // Asked again next time; fine.
        }
        release();
      }
      resolve(choice);
    };
    // Registered first, so it also keeps the same key press from closing the other menu warnings underneath.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' && ev.key !== 'Enter') return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      finish(ev.key === 'Escape' ? 'options' : 'continue');
    };
    window.addEventListener('keydown', onKey, true);
    const ok = back.querySelector<HTMLButtonElement>('.flashing-ok')!;
    ok.onclick = () => finish('continue');
    back.querySelector<HTMLButtonElement>('.flashing-leave')!.onclick = () => finish('options');
    document.body.append(back);
    ok.focus();
  });
}
