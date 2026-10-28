import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMON_ACTIONS } from '@wst/engine';
import { ACTIONS, Controls, orderControl, WheelClassifier, bindingToString, checkBinding, formatBinding, parseBinding, type Env } from '../src/controls';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

const none = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
const chrome: Env = { firefox: false, mac: false, linux: false };
const firefox: Env = { ...chrome, firefox: true };
const bind = (s: string) => parseBinding(s)!;

describe('bindings', () => {
  it('round-trips and normalises the order of modifiers', () => {
    expect(bindingToString(bind('shift+ctrl+key:KeyA'))).toBe('ctrl+shift+key:KeyA');
    expect(formatBinding(bind('ctrl+key:KeyA'))).toBe('Ctrl + A');
    expect(formatBinding(bind('shift+mouse:2'))).toBe('Shift + Right button');
  });

  it('rejects anything that is not a binding', () => {
    for (const bad of ['', 'key:', 'mouse:5', 'ctrl+ctrl+wheel', 'hyper+wheel', 'ctrl+mod:shift', 'key:Key A', 42, null, {}]) {
      expect(parseBinding(bad)).toBeNull();
    }
  });

  it('every action has valid defaults of an allowed kind', () => {
    for (const a of ACTIONS) {
      for (const d of a.defaults) {
        const b = parseBinding(d);
        expect(b, `${a.id} ${d}`).not.toBeNull();
        expect(a.inputs).toContain(b!.input.split(':')[0]);
      }
    }
  });
});

describe('order and build keys', () => {
  it('every common order and Demolish has a control with its letter as the default (Attack and Stop with Ctrl, Unload with Shift)', () => {
    const c = new Controls();
    for (const a of COMMON_ACTIONS) {
      const prefix = a.id === 'attack' || a.id === 'stop' ? 'Ctrl + ' : a.id === 'dock' ? 'Shift + ' : '';
      expect(c.keyLabel(orderControl(a.id)), a.id).toBe(prefix + a.key);
    }
    expect(c.keyLabel('orderDemolish')).toBe('X');
  });

  it('knows which controls differ from the defaults, resets them, and saves only the differences', () => {
    const c = new Controls();
    expect(ACTIONS.every((a) => c.isDefault(a.id))).toBe(true);
    c.set('panLeft', 0, bind('key:KeyJ'));
    expect(c.isDefault('panLeft')).toBe(false);
    expect(c.isDefault('panRight')).toBe(true);
    expect(Object.keys(JSON.parse(store.get('wst-controls')!).bindings)).toEqual(['panLeft']);
    c.resetAction('panLeft');
    expect(c.isDefault('panLeft')).toBe(true);
    c.set('panLeft', 1, null);
    expect(c.isDefault('panLeft')).toBe(false);
  });

  it('shows rebound keys with their modifiers', () => {
    const c = new Controls();
    c.set('orderMove', 0, bind('key:KeyQ'));
    expect(c.keyLabel('orderMove')).toBe('Q');
    c.set('orderMove', 0, bind('alt+key:KeyQ'));
    expect(c.keyLabel('orderMove')).toBe('Alt + Q');
    c.set('orderMove', 0, null);
    expect(c.keyLabel('orderMove')).toBe('');
  });

  it('order keys clash with each other and with building keys, but only warn against the camera', () => {
    const c = new Controls();
    expect(checkBinding(c, 'orderMove', 0, bind('key:KeyH'), chrome).find((i) => i.level === 'conflict')?.other).toBe('orderHarvest');
    expect(checkBinding(c, 'buildMenu', 0, bind('key:KeyM'), chrome).find((i) => i.level === 'conflict')?.other).toBe('orderMove');
    // A letter shared by a camera key and an order is intended: the order wins when it applies. Shown on the camera side only.
    expect(checkBinding(c, 'panRight', 1, bind('key:KeyH'), chrome).map((i) => i.level)).toEqual(['warn']);
    expect(checkBinding(c, 'orderHarvest', 0, bind('key:KeyH'), chrome)).toEqual([]);
  });
});

describe('matching', () => {
  it('keys need exactly the bound modifiers; Ctrl+A attacks, A pans', () => {
    const c = new Controls();
    const keys = ['panLeft', 'orderAttack'] as const;
    expect(c.find('key:KeyA', none, keys)).toBe('panLeft');
    expect(c.find('key:KeyA', { ...none, ctrlKey: true }, keys)).toBe('orderAttack');
    expect(c.find('key:KeyA', { ...none, altKey: true }, keys)).toBeNull();
  });

  it('mouse buttons ignore extra modifiers (Ctrl + right click still orders)', () => {
    const c = new Controls();
    expect(c.find('mouse:2', { ...none, ctrlKey: true }, ['select', 'order', 'panDrag'])).toBe('order');
    expect(c.find('mouse:0', none, ['select', 'order', 'panDrag'])).toBe('select');
    expect(c.find('mouse:1', none, ['select', 'order', 'panDrag'])).toBe('panDrag');
  });

  it('the more specific binding wins: Shift + wheel pans while the wheel zooms', () => {
    const c = new Controls();
    c.set('panScroll', 1, bind('shift+wheel'));
    expect(c.find('wheel', none, ['zoom', 'panScroll'])).toBe('zoom');
    expect(c.find('wheel', { ...none, shiftKey: true }, ['zoom', 'panScroll'])).toBe('panScroll');
  });

  it('modifier actions follow the chosen keys', () => {
    const c = new Controls();
    expect(c.modifierHeld('queue', { ...none, ctrlKey: true })).toBe(true);
    expect(c.modifierHeld('queue', { ...none, altKey: true })).toBe(false);
    c.set('queue', 0, bind('mod:alt'));
    c.set('queue', 1, null);
    expect(c.modifierHeld('queue', { ...none, altKey: true })).toBe(true);
    expect(c.modifierHeld('queue', { ...none, ctrlKey: true })).toBe(false);
  });

  it('filling the production queue defaults to Ctrl and can be changed', () => {
    const c = new Controls();
    expect(c.modifierHeld('fillQueue', { ...none, ctrlKey: true })).toBe(true);
    expect(c.modifierHeld('fillQueue', { ...none, shiftKey: true })).toBe(false);
    c.set('fillQueue', 0, bind('mod:alt'));
    expect(c.modifierHeld('fillQueue', { ...none, altKey: true })).toBe(true);
    expect(c.modifierHeld('fillQueue', { ...none, ctrlKey: true })).toBe(false);
  });

  it('control groups save with Ctrl or Meta, add with Shift, and select with the bare number until a modifier is set', () => {
    const c = new Controls();
    expect(c.modifierHeld('groupAssign', { ...none, ctrlKey: true })).toBe(true);
    expect(c.modifierHeld('groupAssign', { ...none, metaKey: true })).toBe(true);
    expect(c.modifierHeld('groupAdd', { ...none, shiftKey: true })).toBe(true);
    expect(c.hasModifier('groupSelect')).toBe(false);
    c.set('groupSelect', 0, bind('mod:alt'));
    expect(c.hasModifier('groupSelect')).toBe(true);
    expect(c.modifierHeld('groupSelect', { ...none, altKey: true })).toBe(true);
    expect(c.modifierHeld('groupSelect', none)).toBe(false);
  });
});

describe('saving', () => {
  it('remembers changes, including cleared slots, and resets', () => {
    const a = new Controls();
    a.set('panLeft', 0, bind('key:KeyJ'));
    a.set('panLeft', 1, null);
    const b = new Controls();
    expect(b.slotsOf('panLeft').map((s) => s && bindingToString(s))).toEqual(['key:KeyJ', null]);
    b.resetAll();
    expect(new Controls().slotsOf('panLeft').map((s) => s && bindingToString(s))).toEqual(['key:ArrowLeft', 'key:KeyA']);
  });

  it('ignores corrupt or hostile storage, and bindings of the wrong kind for their action', () => {
    for (const junk of ['not json', 'null', '[]', '{"bindings":5}', '{"bindings":{"panLeft":"x","nope":["key:KeyA"]}}']) {
      store.set('wst-controls', junk);
      expect(new Controls().slotsOf('panLeft').map((s) => s && bindingToString(s))).toEqual(['key:ArrowLeft', 'key:KeyA']);
    }
    store.set('wst-controls', JSON.stringify({ v: 1, bindings: { panLeft: ['wheel', 'key:KeyJ'], zoom: ['mouse:0', 'ctrl+pinch'] } }));
    const c = new Controls();
    expect(c.slotsOf('panLeft').map((s) => s && bindingToString(s))).toEqual([null, 'key:KeyJ']);
    expect(c.slotsOf('zoom').map((s) => s && bindingToString(s))).toEqual([null, 'ctrl+pinch']);
  });
});

describe('wheel classification', () => {
  const ev = (deltaX: number, deltaY: number, extra = {}) => ({ deltaX, deltaY, deltaMode: 0, ctrlKey: false, ...extra });

  it('tells a mouse notch, a two-finger scroll and a pinch apart', () => {
    const w = new WheelClassifier();
    expect(w.classify(ev(0, 100), 0)).toBe('wheel');
    expect(w.classify(ev(0, -3.5), 1000)).toBe('scroll');
    expect(w.classify(ev(0, -2.5, { ctrlKey: true }), 2000)).toBe('pinch');
    expect(w.classify(ev(0, 3, { deltaMode: 1 }), 3000)).toBe('wheel');
  });

  it('a big flick straight after trackpad events is not read as notches', () => {
    const w = new WheelClassifier();
    expect(w.classify(ev(0, 4.5), 0)).toBe('scroll');
    expect(w.classify(ev(0, 120), 50)).toBe('scroll');
    expect(w.classify(ev(0, 120), 600)).toBe('wheel');
  });
});

describe('warnings', () => {
  it('refuses Shift + right click in Firefox and warns about it elsewhere', () => {
    const c = new Controls();
    expect(checkBinding(c, 'order', 0, bind('shift+mouse:2'), firefox).map((i) => i.level)).toContain('blocked');
    const elsewhere = checkBinding(c, 'order', 0, bind('shift+mouse:2'), chrome).map((i) => i.level);
    expect(elsewhere).toContain('warn');
    expect(elsewhere).not.toContain('blocked');
  });

  it('refuses browser shortcuts, fixed keys and impossible trackpad combinations', () => {
    const c = new Controls();
    const level = (id: Parameters<typeof checkBinding>[1], b: string) => checkBinding(c, id, 0, bind(b), chrome).map((i) => i.level);
    expect(level('panLeft', 'ctrl+key:KeyW')).toContain('blocked');
    expect(level('panLeft', 'key:Digit3')).toContain('blocked');
    expect(level('panLeft', 'key:F1')).toContain('blocked');
    expect(level('panScroll', 'ctrl+scroll')).toContain('blocked');
    expect(level('zoom', 'ctrl+pinch')).toContain('blocked');
    expect(level('panLeft', 'meta+key:KeyJ')).toEqual(['warn']);
    expect(level('panLeft', 'key:KeyJ')).toEqual([]);
  });

  it('warns that a letter order key wins over a camera key', () => {
    expect(checkBinding(new Controls(), 'panLeft', 0, bind('key:KeyH'), chrome).map((i) => i.level)).toEqual(['warn']);
  });

  it('reports a clash with another control, but not with itself', () => {
    const c = new Controls();
    const clash = checkBinding(c, 'panUp', 0, bind('key:KeyA'), chrome).find((i) => i.level === 'conflict');
    expect(clash?.other).toBe('panLeft');
    expect(checkBinding(c, 'panLeft', 1, bind('key:KeyA'), chrome).some((i) => i.level === 'conflict')).toBe(false);
    expect(checkBinding(c, 'panDrag', 1, bind('mouse:0'), chrome).find((i) => i.level === 'conflict')?.other).toBe('select');
  });

  it('warns when a gesture takes Shift or Ctrl away from selecting or ordering', () => {
    const c = new Controls();
    const warn = checkBinding(c, 'panDrag', 1, bind('shift+mouse:0'), chrome).find((i) => i.level === 'warn');
    expect(warn?.text).toMatch(/adds to the selection/);
    expect(checkBinding(c, 'panDrag', 1, bind('alt+mouse:0'), chrome)).toEqual([]);
  });

  it('suggests a second queue key when only Shift is left', () => {
    const c = new Controls();
    c.set('queue', 0, null);
    expect(checkBinding(c, 'queue', 1, bind('mod:shift'), chrome).some((i) => i.level === 'warn')).toBe(true);
    c.set('queue', 0, bind('mod:ctrl'));
    expect(checkBinding(c, 'queue', 1, bind('mod:shift'), chrome)).toEqual([]);
  });
});
