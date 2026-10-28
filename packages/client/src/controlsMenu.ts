import {
  ACTIONS,
  MODS,
  MOD_LABEL,
  SLOTS,
  bindingToString,
  checkBinding,
  controls,
  detectEnv,
  formatBinding,
  inputName,
  kindOf,
  modsOf,
  parseBinding,
  type ActionDef,
  type ActionId,
  type Binding,
  type Mod,
} from './controls';
import { playSound } from './sound';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight']);

/** What the drop-down of a non-key action offers (a "sensible set": buttons, wheel, scroll, pinch). */
function inputChoices(def: ActionDef): string[] {
  const out: string[] = [];
  for (const kind of def.inputs) {
    if (kind === 'mouse') out.push('mouse:0', 'mouse:1', 'mouse:2');
    else if (kind === 'mod') out.push(...MODS.map((m) => `mod:${m}`));
    else out.push(kind);
  }
  return out;
}

const describe = (input: string): string =>
  input === 'mouse:2' ? 'Right button (two-finger click on most trackpads)' : input === 'mouse:0' ? 'Left button (one-finger click)' : input === 'mouse:1' ? 'Middle button (wheel press)' : inputName(input);

const CONTROL_TABS: readonly { id: ActionDef['section']; title: string; blurb: string }[] = [
  { id: 'camera', title: 'Camera', blurb: 'Moving and zooming the view.' },
  { id: 'selection', title: 'Selection', blurb: '' },
  { id: 'orders', title: 'Orders', blurb: 'Order keys only act when your selection can use them, and then they win over a camera key on the same key.' },
  { id: 'building', title: 'Building and production', blurb: 'Building keys act while a builder is selected, and win over a camera key on the same key.' },
];

/**
 * The Controls section of Options: a row per action with two slots. Keys are set by pressing them;
 * mouse, wheel and trackpad gestures are picked from a list with Ctrl / Shift / Alt / Meta toggles.
 * Each choice is checked (`checkBinding`): unusable ones are refused with the reason, clashes ask
 * before replacing, and combinations that only work in some browsers are kept with a warning.
 */
export function mountControlsEditor(host: HTMLElement): void {
  const env = detectEnv();
  /** A message shown on one row: a refusal, or a clash waiting for Replace / Keep. */
  let msg: { id: ActionId; text: string; pending?: { slot: number; b: Binding; other: ActionId } } | null = null;
  let listening: { id: ActionId; slot: number } | null = null;
  let stopListening: (() => void) | null = null;

  const slotHtml = (def: ActionDef, slot: number): string => {
    const b = controls.slotsOf(def.id)[slot];
    const at = `data-action="${def.id}" data-slot="${slot}"`;
    const kind = def.inputs.length === 1 ? def.inputs[0] : null;
    if (kind === 'key') {
      const on = listening?.id === def.id && listening.slot === slot;
      return `<span class="ctl-slot"><button class="ctl-key${on ? ' listening' : ''}" ${at}>${on ? 'Press a key… (Esc cancels)' : b ? esc(formatBinding(b)) : 'Not set'}</button>${
        b ? `<button class="ctl-clear" ${at} aria-label="Clear" title="Clear">×</button>` : ''
      }</span>`;
    }
    const options = inputChoices(def)
      .map((i) => `<option value="${i}"${b?.input === i ? ' selected' : ''}>${esc(describe(i))}</option>`)
      .join('');
    const mods =
      kind === 'mod'
        ? ''
        : `<span class="ctl-mods" role="group" aria-label="Modifier keys">${MODS.map(
            (m) => `<button class="ctl-mod" ${at} data-mod="${m}" aria-pressed="${b?.mods.includes(m) ?? false}"${b ? '' : ' disabled'}>${MOD_LABEL[m]}</button>`,
          ).join('')}</span>`;
    return `<span class="ctl-slot"><select class="ctl-input" ${at} aria-label="${esc(def.label)} ${slot + 1}"><option value="">Not set</option>${options}</select>${mods}</span>`;
  };

  const rowHtml = (def: ActionDef): string => {
    const issues: string[] = [];
    controls.slotsOf(def.id).forEach((b, slot) => {
      if (!b) return;
      for (const i of checkBinding(controls, def.id, slot, b, env)) {
        issues.push(`<div class="ctl-issue ${i.level === 'warn' ? 'warn' : 'bad'}">${i.level === 'warn' ? '⚠' : '✖'} ${esc(formatBinding(b))}: ${esc(i.text)}</div>`);
      }
    });
    if (msg?.id === def.id) {
      issues.push(
        msg.pending
          ? `<div class="ctl-issue bad">✖ ${esc(msg.text)} <button class="ctl-replace">Replace</button> <button class="ctl-keep">Keep as it was</button></div>`
          : `<div class="ctl-issue bad">✖ ${esc(msg.text)}</div>`,
      );
    }
    return `<div class="control-row" data-row="${def.id}">
      <div class="control-label"><b>${esc(def.label)}</b>${def.hint ? `<small>${esc(def.hint)}</small>` : ''}</div>
      <div class="control-slots">${Array.from({ length: SLOTS }, (_, s) => slotHtml(def, s)).join('')}${
        controls.isDefault(def.id) ? '' : `<button class="ctl-default" data-action="${def.id}" title="Put this control back to its default">Reset to default</button>`
      }</div>
      ${issues.length ? `<div class="control-issues" role="status">${issues.join('')}</div>` : ''}
    </div>`;
  };

  /** The tab being shown; kept across redraws. */
  let tab: ActionDef['section'] = 'camera';
  let tallest = 0;

  const render = (focus?: string) => {
    tallest = Math.max(tallest, host.querySelector<HTMLElement>('.glass-tab-panel:not([hidden])')?.offsetHeight ?? 0); // the tab being left counts too
    // Within a tab the rows keep the order of ACTIONS; a small heading marks where keys give way to mouse and trackpad (or back).
    const rows = (name: ActionDef['section']) => {
      let kind = '';
      return ACTIONS.filter((a) => a.section === name)
        .map((a) => {
          const k = a.inputs.length === 1 && a.inputs[0] === 'key' ? 'Keys' : 'Mouse and trackpad';
          const head = k === kind ? '' : `<h4>${k}</h4>`;
          kind = k;
          return head + rowHtml(a);
        })
        .join('');
    };
    host.innerHTML = `<h3>Controls</h3>
      <p class="muted">Each control has two slots. Click a key slot and press the key (hold Ctrl, Shift, Alt or Meta to include it); pick mouse and trackpad gestures from the lists. Settings are saved in this browser. The number keys themselves (control groups) and F1 / F2 are fixed, though what Ctrl, Shift and the like do with them is set under Selection, and so are the keys of buttons that a unit's own program adds in the Designer.</p>
      <div class="glass-tabs"><div class="glass-tab-list" role="tablist" aria-label="Kinds of controls">${CONTROL_TABS.map(
        (t) => `<button type="button" role="tab" id="ctl-tab-${t.id}" data-tab="${t.id}" aria-selected="${t.id === tab}" aria-controls="ctl-panel-${t.id}"${t.id === tab ? '' : ' tabindex="-1"'} data-sound="menu.click">${t.title}</button>`,
      ).join('')}</div>
      ${CONTROL_TABS.map(
        (t) => `<div id="ctl-panel-${t.id}" class="glass-tab-panel" role="tabpanel" aria-labelledby="ctl-tab-${t.id}"${t.id === tab ? '' : ' hidden'}>${t.blurb ? `<p class="muted">${t.blurb}</p>` : ''}${t.id === tab ? rows(t.id) : ''}</div>`,
      ).join('')}</div>
      <div><button class="ctl-reset">Reset controls to defaults</button></div>`;
    // Tabs differ in height; keep the tallest seen as a minimum so a shorter tab does not shrink the page and jump the scroll position.
    const panel = host.querySelector<HTMLElement>('.glass-tab-panel:not([hidden])');
    if (panel) {
      tallest = Math.max(tallest, panel.offsetHeight);
      panel.style.minHeight = `${tallest}px`;
    }
    if (focus) host.querySelector<HTMLElement>(focus)?.focus();
  };

  const focusOf = (id: ActionId, slot: number, cls: string) => `.${cls}[data-action="${id}"][data-slot="${slot}"]`;

  /** Applies a choice if it is allowed; otherwise explains why not (or asks about a clash). */
  const apply = (id: ActionId, slot: number, b: Binding | null, focusClass: string) => {
    msg = null;
    if (b) {
      const clean = parseBinding(bindingToString(b));
      if (!clean) {
        msg = { id, text: 'That key cannot be used.' };
        return render(focusOf(id, slot, focusClass));
      }
      b = clean;
      const issues = checkBinding(controls, id, slot, b, env);
      const blocked = issues.find((i) => i.level === 'blocked');
      const clash = issues.find((i) => i.level === 'conflict');
      if (blocked) {
        msg = { id, text: `${formatBinding(b)} cannot be used here. ${blocked.text}` };
        return render(focusOf(id, slot, focusClass));
      }
      if (clash?.other) {
        msg = { id, text: `${formatBinding(b)} ${clash.text.toLowerCase()}`, pending: { slot, b, other: clash.other } };
        return render('.ctl-replace');
      }
    }
    controls.set(id, slot, b);
    playSound('ui.confirm');
    render(focusOf(id, slot, focusClass));
  };

  const listen = (id: ActionId, slot: number) => {
    stopListening?.();
    listening = { id, slot };
    const done = () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('blur', cancel);
      stopListening = null;
      listening = null;
    };
    const cancel = () => {
      done();
      if (host.isConnected) render(focusOf(id, slot, 'ctl-key'));
    };
    const onKey = (ev: KeyboardEvent) => {
      if (!host.isConnected) return done();
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (MODIFIER_CODES.has(ev.code)) return; // wait for the key itself
      if (ev.code === 'Escape' && modsOf(ev).length === 0) return cancel();
      done();
      apply(id, slot, { input: `key:${ev.code}`, mods: modsOf(ev) }, 'ctl-key');
    };
    const onOutside = (ev: Event) => {
      if (!(ev.target as HTMLElement).closest?.('.ctl-key.listening')) cancel();
    };
    stopListening = done;
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('blur', cancel);
    render(focusOf(id, slot, 'ctl-key'));
  };

  const slotOf = (el: HTMLElement) => ({ id: el.dataset.action as ActionId, slot: Number(el.dataset.slot) });

  host.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!el) return;
    if (el.getAttribute('role') === 'tab') {
      stopListening?.();
      msg = null;
      tab = el.dataset.tab as ActionDef['section'];
      render();
    } else if (el.classList.contains('ctl-key')) {
      const { id, slot } = slotOf(el);
      if (!(listening?.id === id && listening.slot === slot)) listen(id, slot);
    } else if (el.classList.contains('ctl-clear')) {
      const { id, slot } = slotOf(el);
      apply(id, slot, null, 'ctl-key');
    } else if (el.classList.contains('ctl-mod')) {
      const { id, slot } = slotOf(el);
      const b = controls.slotsOf(id)[slot];
      if (!b) return;
      const m = el.dataset.mod as Mod;
      const mods = b.mods.includes(m) ? b.mods.filter((x) => x !== m) : [...b.mods, m];
      apply(id, slot, { input: b.input, mods }, `ctl-mod[data-mod="${m}"]`);
    } else if (el.classList.contains('ctl-replace') && msg?.pending) {
      const { id } = msg;
      const { slot, b } = msg.pending;
      const same = (o: Binding | null) => !!o && bindingToString(o) === bindingToString(b);
      for (const def of ACTIONS) {
        controls.slotsOf(def.id).forEach((o, i) => {
          if (same(o) && !(def.id === id && i === slot)) controls.set(def.id, i, null);
        });
      }
      msg = null;
      controls.set(id, slot, b);
      playSound('ui.confirm');
      render(focusOf(id, slot, 'ctl-key') + ',' + focusOf(id, slot, 'ctl-input'));
    } else if (el.classList.contains('ctl-default')) {
      const id = el.dataset.action as ActionId;
      stopListening?.();
      msg = null;
      controls.resetAction(id);
      playSound('ui.confirm');
      render(`.control-row[data-row="${id}"] .ctl-key, .control-row[data-row="${id}"] .ctl-input`);
    } else if (el.classList.contains('ctl-keep')) {
      msg = null;
      render();
    } else if (el.classList.contains('ctl-reset')) {
      msg = null;
      controls.resetAll();
      playSound('ui.confirm');
      render();
    }
  });

  host.addEventListener('keydown', (ev) => {
    const el = ev.target as HTMLElement;
    if (el.getAttribute?.('role') !== 'tab' || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
    ev.preventDefault();
    const at = CONTROL_TABS.findIndex((t) => t.id === tab);
    tab = CONTROL_TABS[(at + (ev.key === 'ArrowRight' ? 1 : CONTROL_TABS.length - 1)) % CONTROL_TABS.length].id;
    render(`#ctl-tab-${tab}`);
  });

  host.addEventListener('change', (ev) => {
    const el = ev.target as HTMLSelectElement;
    if (!el.classList.contains('ctl-input')) return;
    const { id, slot } = slotOf(el);
    if (!el.value) return apply(id, slot, null, 'ctl-input');
    const old = controls.slotsOf(id)[slot];
    // Switching gesture keeps the modifiers already chosen (but a modifier action has none).
    apply(id, slot, { input: el.value, mods: kindOf(el.value) === 'mod' ? [] : old?.mods ?? [] }, 'ctl-input');
  });

  render();
}
