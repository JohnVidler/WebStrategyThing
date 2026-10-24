/** The Campaigns screens of the main menu: campaign list, a campaign's levels, and the briefing shown before each level. */
import type { CampaignInfo } from '@wst/engine';
import { completedLevels, unlockedLevels } from './campaignProgress';
import { randomHex } from './random';
import { revealScreen, swapContent } from './transition';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const paragraphs = (lines: readonly string[]) => lines.map((l) => `<p>${esc(l)}</p>`).join('');

export interface CampaignHost {
  /** The element the screens are drawn into. */
  readonly view: HTMLElement;
  readonly apiBase: string;
  /** Back to the main menu. */
  back(): void;
  /** Starts a level (leaves the menu for the match). */
  play(campaign: string, level: string, index: number): void;
}

/** Campaigns are unfinished, so their menu button only shows in a client built with WST_DEV_TOOLS=1 (`npm run dev`). */
export const devMode = (): boolean => __WST_DEV_TOOLS__;

/** The page address that starts a campaign level in a fresh private room. */
export const campaignUrl = (campaign: string, level: string, index: number): string =>
  `${location.pathname}?${new URLSearchParams({ room: `campaign-${randomHex(6)}`, mode: 'campaign', campaign, level, index: String(index) })}`;

/** The page address of a level's briefing in the menu. */
export const briefingUrl = (campaign: string, index: number): string => `${location.pathname}?${new URLSearchParams({ campaign, level: String(index) })}`;

export async function fetchCampaigns(apiBase: string): Promise<CampaignInfo[] | undefined> {
  try {
    const res = await fetch(`${apiBase}/campaigns`);
    if (res.ok) return (await res.json()) as CampaignInfo[];
  } catch {
    // Reported by the caller.
  }
  return undefined;
}

/**
 * Draws the campaign list, or goes straight to a level's briefing when `target` is given (the
 * "Continue" after a won mission). The caller has already swapped the page in; later steps animate themselves.
 */
export async function showCampaigns(host: CampaignHost, target?: { campaign: string; level: number }): Promise<void> {
  const { view } = host;
  view.innerHTML = `<div class="section-head"><button id="lobby-back" data-sound="menu.back">← Main menu</button><h2>Campaigns</h2></div><div class="muted">Loading…</div>`;
  view.querySelector<HTMLButtonElement>('#lobby-back')!.onclick = host.back;
  const campaigns = await fetchCampaigns(host.apiBase);

  // The first screen replaces the "Loading…" placeholder in place (a second slide would look like a glitch);
  // later screens slide as usual.
  let first = true;
  const screen = (html: string, dir: 1 | -1, wire: () => void) => {
    const draw = () => ((view.innerHTML = html), wire());
    if (first) draw();
    else void swapContent(view, draw, dir);
    first = false;
  };
  const head = (backLabel: string, title: string) => `<div class="section-head"><button id="camp-back" data-sound="menu.back">${esc(backLabel)}</button><h2>${esc(title)}</h2></div>`;

  const list = (dir: 1 | -1) => {
    if (!campaigns?.length) {
      screen(`${head('← Main menu', 'Campaigns')}<section class="campaign-panel"><p class="muted">${campaigns ? 'No campaigns are installed on this server.' : 'Can’t reach the server.'}</p></section>`, dir, () => {
        view.querySelector<HTMLButtonElement>('#camp-back')!.onclick = host.back;
      });
      return;
    }
    const wasFirst = first;
    const cards = campaigns
      .map((c, i) => {
        const done = Math.min(completedLevels(c.id), c.levels.length);
        const progress = done >= c.levels.length ? 'Completed' : done ? `${done} of ${c.levels.length} levels completed` : `${c.levels.length} levels`;
        return `<button data-i="${i}" data-sound="menu.click"><b>${esc(c.name)}</b><small>${esc(c.summary)}</small><small class="camp-progress">${progress}</small></button>`;
      })
      .join('');
    screen(`${head('← Main menu', 'Campaigns')}<section class="campaign-panel"><nav class="menu-buttons campaign-list" aria-label="Campaigns">${cards}</nav></section>`, dir, () => {
      view.querySelector<HTMLButtonElement>('#camp-back')!.onclick = host.back;
      view.querySelectorAll<HTMLButtonElement>('.campaign-list button').forEach((b) => (b.onclick = () => overview(campaigns[Number(b.dataset.i)], 1)));
      if (wasFirst) revealScreen(view);
    });
  };

  const overview = (c: CampaignInfo, dir: 1 | -1) => {
    const done = completedLevels(c.id);
    const open = unlockedLevels(c.id, c.levels.length);
    const next = Math.min(done, c.levels.length - 1);
    const finished = done >= c.levels.length;
    const rows = c.levels
      .map((l, i) => {
        const state = i < done ? 'Completed' : i < open ? 'Ready' : 'Locked';
        return `<li><button data-i="${i}" data-sound="menu.click"${i >= open ? ' disabled' : ''}><span class="camp-num">${i + 1}</span><b>${esc(l.name)}</b><small>${l.width} × ${l.height} · ${state}</small></button></li>`;
      })
      .join('');
    screen(
      `${head('← Campaigns', c.name)}
       <section class="campaign-panel">
       <div class="campaign-story">${paragraphs(c.story)}</div>
       <button id="camp-continue" class="primary" data-sound="ui.confirm">${finished ? 'Replay from the last level' : done ? `Continue: ${esc(c.levels[next].name)}` : 'Start campaign'}</button>
       <h3>Levels</h3><ol class="campaign-levels">${rows}</ol></section>`,
      dir,
      () => {
        view.querySelector<HTMLButtonElement>('#camp-back')!.onclick = () => list(-1);
        view.querySelector<HTMLButtonElement>('#camp-continue')!.onclick = () => briefing(c, next, 1);
        view.querySelectorAll<HTMLButtonElement>('.campaign-levels button').forEach((b) => (b.onclick = () => briefing(c, Number(b.dataset.i), 1)));
      },
    );
  };

  const briefing = (c: CampaignInfo, index: number, dir: 1 | -1) => {
    const level = c.levels[index];
    const b = level.briefing;
    const section = (title: string, items: readonly string[]) => (items.length ? `<h3>${title}</h3><ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '');
    screen(
      `${head(`← ${c.name}`, b.title)}
       <section class="campaign-panel"><div class="briefing">
         <p class="muted">${esc(c.name)} · Level ${index + 1} of ${c.levels.length} · ${esc(level.name)} · ${level.width} × ${level.height}</p>
         <div class="campaign-story">${paragraphs(b.story)}</div>
         ${section('Objectives', b.objectives)}${section('Tips', b.tips)}
         <button id="camp-begin" class="primary" data-sound="ui.confirm">Begin mission</button>
       </div></section>`,
      dir,
      () => {
        view.querySelector<HTMLButtonElement>('#camp-back')!.onclick = () => overview(c, -1);
        view.querySelector<HTMLButtonElement>('#camp-begin')!.onclick = () => host.play(c.id, level.id, index);
      },
    );
  };

  const wanted = target && campaigns?.find((c) => c.id === target.campaign);
  if (wanted && target.level >= 0 && target.level < wanted.levels.length && target.level < unlockedLevels(wanted.id, wanted.levels.length)) {
    briefing(wanted, target.level, 1);
  } else if (wanted) {
    overview(wanted, 1);
  } else {
    list(1);
  }
}
