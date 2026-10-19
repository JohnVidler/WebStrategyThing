import { playSound } from './sound';

/** Elements that make a click sound. Selects and ranges sound on change instead. */
const CLICKABLE = 'button, summary, a.button, [role="button"], input[type="checkbox"], input[type="radio"]';
const HOVERABLE = 'button, summary, a.button, [role="button"]';

let installed = false;

/**
 * Menu and interface sounds for the whole page, with no wiring in the individual screens: any button
 * plays `ui.click` unless it carries `data-sound="ui.confirm" (or any tag; "none" for silence)`, hovering one plays `ui.hover`, a changed
 * select or option plays `ui.select`, a checkbox `ui.toggle_on`/`ui.toggle_off`, a slider `ui.slider`
 * and typing in a text box `ui.type`. Covers elements created later, too.
 */
export function installUiSounds(): void {
  if (installed) return;
  installed = true;

  document.addEventListener(
    'click',
    (ev) => {
      const el = (ev.target as Element | null)?.closest<HTMLElement>(CLICKABLE);
      if (!el || (el as HTMLButtonElement).disabled) return;
      if (el instanceof HTMLInputElement) {
        // Radio buttons are picks (the change handler below); a checkbox is a switch, and a module switch has its own tags.
        if (el.type === 'checkbox') {
          const module = el.dataset.sound === 'module';
          playSound(el.checked ? (module ? 'module.on' : 'ui.toggle_on') : module ? 'module.off' : 'ui.toggle_off');
        }
        return;
      }
      // "none": the handler plays its own sound.
      if (el.dataset.sound !== 'none') playSound(el.dataset.sound || 'ui.click');
    },
    true,
  );

  document.addEventListener(
    'mouseover',
    (ev) => {
      const el = (ev.target as Element | null)?.closest<HTMLElement>(HOVERABLE);
      if (!el || (el as HTMLButtonElement).disabled) return;
      // Moving between the children of one button is not a new hover.
      if (el.contains((ev as MouseEvent).relatedTarget as Node | null)) return;
      playSound('ui.hover');
    },
    true,
  );

  document.addEventListener(
    'change',
    (ev) => {
      const el = ev.target;
      if (el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type === 'radio')) playSound('ui.select');
    },
    true,
  );

  document.addEventListener(
    'input',
    (ev) => {
      const el = ev.target;
      if (el instanceof HTMLInputElement && el.type === 'range') playSound('ui.slider');
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (ev) => {
      const el = ev.target;
      if (ev.key.length !== 1 && ev.key !== 'Backspace') return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if ((el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'search' || el.type === '')) || el instanceof HTMLTextAreaElement) playSound('ui.type');
    },
    true,
  );
}
