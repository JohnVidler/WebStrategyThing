/** News and Updates: the changelog as a list of articles (one per update day), each opening to its full list of changes. */
import { CHANGELOG, type ChangelogEntry } from './changelog';
import { revealScreen, swapContent } from './transition';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface NewsHost {
  /** The element the screens are drawn into. */
  readonly view: HTMLElement;
  /** Back to the main menu. */
  back(): void;
}

const headline = (e: ChangelogEntry) => e.title || e.date;

/** Draws the article list. The caller has already swapped the page in, so the list appears in place and its cards stagger in. */
export function showNews(host: NewsHost): void {
  const { view } = host;
  const head = (back: string, title: string) => `<div class="section-head"><button id="news-back" data-sound="menu.back">${esc(back)}</button><h2>${esc(title)}</h2></div>`;

  const list = (first: boolean) => {
    const cards = CHANGELOG.map(
      (e, i) => `<button data-i="${i}" data-sound="menu.click"><small>${esc(e.date)}</small><b>${esc(headline(e))}</b>${e.summary ? `<small class="news-summary">${esc(e.summary)}</small>` : ''}</button>`,
    ).join('');
    const draw = () => {
      view.innerHTML = `${head('← Main menu', 'News and Updates')}<section class="news-panel"><nav class="menu-buttons news-list" aria-label="Articles">${cards || '<p class="muted">Nothing to report yet.</p>'}</nav></section>`;
      view.querySelector<HTMLButtonElement>('#news-back')!.onclick = host.back;
      view.querySelectorAll<HTMLButtonElement>('.news-list button').forEach((b) => (b.onclick = () => article(CHANGELOG[Number(b.dataset.i)])));
      if (first) revealScreen(view);
    };
    if (first) draw();
    else void swapContent(view, draw, -1);
  };

  const article = (e: ChangelogEntry) =>
    void swapContent(
      view,
      () => {
        view.innerHTML = `${head('← News', headline(e))}<section class="news-panel"><article class="news-article">
          <p class="muted">${esc(e.date)}</p>
          ${e.summary ? `<p class="news-lead">${esc(e.summary)}</p>` : ''}
          <h3>What changed</h3><ul>${e.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></article></section>`;
        view.querySelector<HTMLButtonElement>('#news-back')!.onclick = () => list(false);
      },
      1,
    );

  list(true);
}
