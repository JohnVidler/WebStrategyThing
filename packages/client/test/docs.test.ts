import { describe, expect, it, vi } from 'vitest';
import { FLOW_HOST, parseText, UNIT_API } from '@wst/engine';

/** Minimal DOM stand-in: the docs module only needs innerHTML, a search box and hash routing. */
function stubDom() {
  const els = new Map<string, { innerHTML: string; scrollIntoView(): void }>();
  const get = (id: string) => {
    if (!els.has(id)) els.set(id, { innerHTML: '', scrollIntoView() {} });
    return els.get(id)!;
  };
  const search = { value: '', oninput: null, focus() {}, setSelectionRange() {} };
  const handlers: Record<string, () => void> = {};
  vi.stubGlobal('location', { hash: '' });
  vi.stubGlobal('window', { addEventListener: (n: string, f: () => void) => (handlers[n] = f), scrollTo() {} });
  vi.stubGlobal('document', {
    title: '',
    getElementById: (id: string) => {
      const el = get(id);
      return id === 'nav' ? { ...el, set innerHTML(v: string) { el.innerHTML = v; }, get innerHTML() { return el.innerHTML; }, querySelector: () => search } : el;
    },
    querySelector: () => search,
  });
  return {
    page: () => get('page').innerHTML,
    nav: () => get('nav').innerHTML,
    go(hash: string) {
      (globalThis.location as { hash: string }).hash = hash;
      handlers.hashchange();
    },
  };
}

describe('script docs', () => {
  it('renders every page and documents every builtin', async () => {
    const dom = stubDom();
    await import('../src/docs');
    const links = [...dom.nav().matchAll(/href="(#\/[^"]+)"/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(10);
    let all = '';
    for (const href of links) {
      dom.go(href);
      expect(dom.page()).toMatch(/<h1>/);
      all += dom.page();
    }
    for (const b of UNIT_API) expect(all).toContain(`id="${b.name}"`);
    // Every program shown in the guide is a real program: it parses and checks cleanly.
    const samples = [...all.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)]
      .map((m) => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
      .filter((c) => c.includes('on('));
    expect(samples.length).toBeGreaterThan(10);
    for (const sample of samples) {
      const { errors } = parseText(sample, FLOW_HOST);
      expect(errors.map((e) => e.message), sample).toEqual([]);
    }
    dom.go('#/constants');
    expect(dom.page()).toContain('URGENT');
  });
});
