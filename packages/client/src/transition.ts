/** Fluid transitions between menu screens, built on the Web Animations API. All motion is eased. */

const EASE_IN = 'cubic-bezier(0.42, 0, 1, 1)';
const EASE_OUT = 'cubic-bezier(0, 0, 0.58, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.42, 0, 0.58, 1)';

const OUT_MS = 170;
const IN_MS = 260;
const OVERLAY_MS = 280;
const SLIDE_PX = 28;

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

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
  // Exit holds its last frame and entry its first, so the content never flashes between the two.
  const anim = play(el, [{ opacity: 0, transform: `translateX(${dir * SLIDE_PX}px)` }, { opacity: 1, transform: 'translateX(0)' }], IN_MS, EASE_OUT, 'backwards');
  await finished(anim);
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
