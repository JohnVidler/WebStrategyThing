import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast } from '../src/toast';

/** Just enough of a DOM for the toast host: elements with a class list, text, and append/remove. */
class FakeEl {
  className = '';
  textContent = '';
  readonly children: FakeEl[] = [];
  parent?: FakeEl;
  readonly classList = {
    add: (c: string) => (this.className += ` ${c}`),
    contains: (c: string) => this.className.split(' ').includes(c),
  };
  append(child: FakeEl): void {
    child.parent = this;
    this.children.push(child);
  }
  remove(): void {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
  }
}

describe('toasts', () => {
  let host: FakeEl;
  beforeEach(() => {
    vi.useFakeTimers();
    host = new FakeEl();
    vi.stubGlobal('document', { getElementById: () => host, createElement: () => new FakeEl() });
    vi.stubGlobal('localStorage', { getItem: () => '0' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows a message with its kind, then slides it away and removes it', () => {
    showToast('Restored your saved designs (1 added)', 'ok');
    expect(host.children).toHaveLength(1);
    expect(host.children[0].classList.contains('ok')).toBe(true);
    vi.advanceTimersByTime(4100);
    expect(host.children[0].classList.contains('leaving')).toBe(true);
    vi.advanceTimersByTime(400);
    expect(host.children).toHaveLength(0);
  });

  it('keeps problems up longer than good news', () => {
    showToast('Nope', 'error');
    vi.advanceTimersByTime(5000);
    expect(host.children[0].classList.contains('leaving')).toBe(false);
  });

  it('does not stack the same message, and caps how many are shown', () => {
    showToast('Same', 'warn');
    showToast('Same', 'warn');
    expect(host.children).toHaveLength(1);
    for (let i = 0; i < 9; i++) showToast(`m${i}`, 'info');
    expect(host.children.length).toBeLessThanOrEqual(5);
  });
});
