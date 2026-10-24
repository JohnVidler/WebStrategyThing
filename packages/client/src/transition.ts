/** Fluid transitions between menu screens, built on the Web Animations API. All motion is eased. */
import { reduceMotion } from './settings';

const EASE_IN = 'cubic-bezier(0.42, 0, 1, 1)';
const EASE_OUT = 'cubic-bezier(0, 0, 0.58, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.42, 0, 0.58, 1)';

const OUT_MS = 170;
const IN_MS = 260;
const OVERLAY_MS = 280;
const SLIDE_PX = 28;

/** The Reduce motion option (which defaults to the system preference): screens change instantly, overlays just appear. */
const reducedMotion = reduceMotion;

const running = new WeakMap<HTMLElement, Animation>();
const swaps = new WeakMap<HTMLElement, number>();

function play(el: HTMLElement, frames: Keyframe[], duration: number, easing: string, fill: FillMode): Animation | undefined {
  running.get(el)?.cancel();
  if (reducedMotion() || typeof el.animate !== 'function') return undefined;
  const anim = el.animate(frames, { duration, easing, fill });
  running.set(el, anim);
  return anim;
}

const finished = (anim: Animation | undefined): Promise<void> =>
  anim ? anim.finished.then(() => undefined, () => undefined) : Promise.resolve();

/**
 * Replaces the contents of `el` with a slide-and-fade: the old content eases out, `mutate` swaps
 * it, the new content eases in. `dir` is 1 for going deeper (slides left) and -1 for coming back.
 * A newer swap on the same element supersedes one still waiting to mutate.
 */
export async function swapContent(el: HTMLElement, mutate: () => void, dir: 1 | -1 = 1): Promise<void> {
  const ticket = (swaps.get(el) ?? 0) + 1;
  swaps.set(el, ticket);
  if (el.childNodes.length > 0) {
    el.style.pointerEvents = 'none';
    await finished(
      play(el, [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-dir * SLIDE_PX}px)` }], OUT_MS, EASE_IN, 'forwards'),
    );
    if (swaps.get(el) !== ticket) return;
  }
  mutate();
  el.style.pointerEvents = '';
  // A screen with panels or a list is revealed piece by piece instead of sliding as a whole.
  if (revealScreen(el)) {
    running.get(el)?.cancel();
    return;
  }
  // Exit holds its last frame and entry its first, so the content never flashes between the two.
  const anim = play(el, [{ opacity: 0, transform: `translateX(${dir * SLIDE_PX}px)` }, { opacity: 1, transform: 'translateX(0)' }], IN_MS, EASE_OUT, 'backwards');
  await finished(anim);
}

/** What counts as a list row in a menu screen: the screen header, then every button or row in a list. */
const LIST_ROWS = '.section-head, .menu-buttons > button, .campaign-levels > li, .option-row, .lobby-room, .end-actions > button';
/** The translucent glass panels of a menu screen (see the `#lobby section` rule in style.css). */
const PANELS = 'section, aside, fieldset, .options, .lobby-name-screen, .glass-tab-list, .glass-tab-panel';
const PANEL_MS = 150;
const ROW_MS = 200;
const ROW_DELAY_MS = 70;
const MAX_STAGGERED = 12;
const SLIDE_IN = [{ opacity: 0, transform: 'translateX(48px)' }, { opacity: 1, transform: 'translateX(0)' }];

/**
 * Reveals a screen that has just been drawn: the header slides in, each glass panel expands down
 * (fast), and once it is open its contents appear: list rows slide in one after another, anything
 * else fades in. Returns false (and does nothing) when Reduce motion is on or the screen has no
 * panels or list, so the caller can fall back to sliding it as a whole.
 */
export function revealScreen(el: HTMLElement): boolean {
  if (reducedMotion() || typeof el.animate !== 'function') return false;
  const panels = [...el.querySelectorAll<HTMLElement>(PANELS)];
  const head = el.querySelector<HTMLElement>('.section-head');
  const rows = [...el.querySelectorAll<HTMLElement>(LIST_ROWS)].filter((r) => r !== head);
  if (!panels.length && rows.length < 2) return false;
  head?.animate(SLIDE_IN, { duration: ROW_MS, easing: EASE_OUT, fill: 'backwards' });
  // Negative insets keep the panel's soft halo from being clipped while it opens.
  for (const panel of panels) {
    panel.animate([{ clipPath: 'inset(-40px -40px 100% -40px)' }, { clipPath: 'inset(-40px)' }], { duration: PANEL_MS, easing: EASE_OUT, fill: 'backwards' });
    for (const child of panel.children) {
      if (child instanceof HTMLElement && !child.matches(LIST_ROWS) && !child.querySelector(LIST_ROWS)) {
        child.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ROW_MS, delay: PANEL_MS * 0.8, easing: EASE_OUT, fill: 'backwards' });
      }
    }
  }
  const open = panels.length ? PANEL_MS * 0.8 : 0;
  rows.forEach((row, i) => row.animate(SLIDE_IN, { duration: ROW_MS, delay: open + Math.min(i, MAX_STAGGERED) * ROW_DELAY_MS, easing: EASE_OUT, fill: 'backwards' }));
  return true;
}

const ROW_GROW_MS = 220;

/** A tab panel's contents appear with a quick fade and no movement, so the panel stays joined to its tab. */
export function fadeIn(el: HTMLElement): void {
  if (reducedMotion() || typeof el.animate !== 'function') return;
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: PANEL_MS, easing: EASE_OUT });
}

/** A list row's settled size as keyframe values (padding and border are animated too, so it collapses to nothing). */
function openRow(el: HTMLElement): Keyframe {
  const s = getComputedStyle(el);
  return { height: s.height, paddingTop: s.paddingTop, paddingBottom: s.paddingBottom, borderTopWidth: s.borderTopWidth, borderBottomWidth: s.borderBottomWidth, marginBottom: '0px', opacity: 1 };
}

/** The collapsed row; the negative margin cancels the list's gap so neighbours do not jump when it is added or removed. */
function shutRow(el: HTMLElement): Keyframe {
  const gap = parseFloat(getComputedStyle(el.parentElement!).rowGap) || 0;
  return { height: '0px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px', marginBottom: `${-gap}px`, opacity: 0 };
}

/** A row that cannot be seen (a hidden tab, say) or motion that is switched off needs no animation. */
const staticRow = (el: HTMLElement): boolean => reducedMotion() || typeof el.animate !== 'function' || el.getClientRects().length === 0;

/** A row added to a list that is already on screen opens up and fades in. Call once it is in the DOM with its content. */
export function growRow(el: HTMLElement, delay = 0): void {
  if (staticRow(el)) return;
  const open = openRow(el);
  el.style.overflow = 'hidden';
  const anim = el.animate([shutRow(el), open], { duration: ROW_GROW_MS, delay, easing: EASE_OUT, fill: 'backwards' });
  const done = () => (el.style.overflow = '');
  anim.finished.then(done, done);
}

/** A row leaves by fading and collapsing, then is removed from the DOM. */
export function shrinkRow(el: HTMLElement): Promise<void> {
  if (staticRow(el)) {
    el.remove();
    return Promise.resolve();
  }
  el.style.overflow = 'hidden';
  el.style.pointerEvents = 'none';
  const anim = el.animate([openRow(el), shutRow(el)], { duration: ROW_GROW_MS, easing: EASE_IN, fill: 'forwards' });
  return finished(anim).then(() => el.remove());
}

/** Whether an overlay is open, counting one that is part-way through closing as closed. */
export const isShown = (el: HTMLElement): boolean => !el.hidden && el.dataset.closing !== '1';

/** Shows or hides an overlay with a fade and a slight rise. `hidden` is set once a close finishes. */
export function setShown(el: HTMLElement, show: boolean): void {
  if (show) {
    const needsEntry = el.hidden || el.dataset.closing === '1';
    delete el.dataset.closing;
    el.hidden = false;
    if (needsEntry) play(el, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'translateY(0)' }], OVERLAY_MS, EASE_IN_OUT, 'backwards');
    return;
  }
  if (!isShown(el)) return;
  const anim = play(el, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(16px)' }], OVERLAY_MS, EASE_IN_OUT, 'forwards');
  if (!anim) {
    el.hidden = true;
    return;
  }
  el.dataset.closing = '1';
  anim.finished.then(
    () => {
      if (el.dataset.closing !== '1') return;
      delete el.dataset.closing;
      el.hidden = true;
    },
    () => undefined, // Cancelled by a newer show/hide, which owns the state now.
  );
}
