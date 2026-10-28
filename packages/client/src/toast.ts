import { reduceMotion } from './settings';

/** What a pop-in alert is about; the border colour shows it (see `.toast` in style.css). */
export type ToastKind = 'ok' | 'info' | 'warn' | 'error';

/** How long an alert stays before it slides away (problems stay longer). */
const SHOW_MS: Record<ToastKind, number> = { ok: 4000, info: 4000, warn: 7000, error: 8000 };
const LEAVE_MS = 260;
/** More than this at once: the oldest goes at once. */
const MAX_TOASTS = 5;

const live = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

const dismiss = (toast: HTMLElement): void => {
  clearTimeout(live.get(toast));
  live.delete(toast);
  if (reduceMotion()) {
    toast.remove();
    return;
  }
  toast.classList.add('leaving');
  setTimeout(() => toast.remove(), LEAVE_MS);
};

/** Shows an alert at the right of the playfield, below the scoreboard, and slides it away after a few seconds. */
export function showToast(text: string, kind: ToastKind = 'info'): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  // The same message again restarts its timer instead of stacking.
  for (const [toast] of live) {
    if (toast.textContent === text && toast.classList.contains(kind)) {
      clearTimeout(live.get(toast));
      live.set(toast, setTimeout(() => dismiss(toast), SHOW_MS[kind]));
      return;
    }
  }
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.textContent = text;
  host.append(toast);
  live.set(toast, setTimeout(() => dismiss(toast), SHOW_MS[kind]));
  while (live.size > MAX_TOASTS) {
    const oldest = live.keys().next().value as HTMLElement;
    clearTimeout(live.get(oldest));
    live.delete(oldest);
    oldest.remove();
  }
}
