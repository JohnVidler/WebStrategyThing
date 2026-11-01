/**
 * Player controls bound to program variables. `slider(power, { label: 'Light power', min: 0, max: 10 })` and
 * `toggle(lamp, { label: 'Lamp' })` put a slider or an on/off switch in the side panel while a unit of the class
 * is selected; moving it writes the variable, and the program reads it like any other. The variable's `let`
 * value is where the control starts. (Push buttons are `on(Button, ...)` blocks, which already fill the action grid.)
 */
import type { ConfigField } from './events';
import type { ControlDecl } from './ir';

export const MAX_CONTROLS = 8;
export const MAX_CONTROL_LABEL = 24;
/** The widest range a slider may span (the panel shows it as one bar). */
export const MAX_CONTROL_RANGE = 100000;

export const CONTROL_KINDS = ['slider', 'toggle'] as const;

const field = (name: string, type: 'int' | 'string', def: number | string, doc: string): ConfigField => ({ name, type, default: def, doc });

/** The settings each kind accepts in text, in the order they are written. */
export const CONTROL_SETTINGS: Readonly<Record<ControlDecl['kind'], readonly ConfigField[]>> = {
  slider: [
    field('label', 'string', '', 'Text beside the slider (default: the variable name)'),
    field('min', 'int', 0, 'Lowest value'),
    field('max', 'int', 100, 'Highest value'),
    field('step', 'int', 1, 'Size of one notch'),
  ],
  toggle: [field('label', 'string', '', 'Text beside the switch (default: the variable name)')],
};

/** Builds a declaration from the settings written in text, filling in defaults. */
export function controlFrom(kind: ControlDecl['kind'], name: string, settings: Readonly<Record<string, number | string | readonly number[]>>, note?: string): ControlDecl {
  const num = (k: string, d: number): number => (typeof settings[k] === 'number' ? (settings[k] as number) : d);
  const label = typeof settings.label === 'string' && settings.label ? settings.label : name;
  return kind === 'toggle'
    ? { name, kind, label, min: 0, max: 1, step: 1, ...(note ? { note } : {}) }
    : { name, kind, label, min: num('min', 0), max: num('max', 100), step: num('step', 1), ...(note ? { note } : {}) };
}

/** What a value becomes when the player sets the control: inside the range and on a notch (a toggle is 0 or 1). */
export function clampControl(c: ControlDecl, value: number): number {
  if (c.kind === 'toggle') return value ? 1 : 0;
  const v = Math.min(c.max, Math.max(c.min, Math.round(Number.isFinite(value) ? value : c.min)));
  const snapped = c.min + Math.round((v - c.min) / c.step) * c.step;
  return snapped > c.max ? snapped - c.step : snapped;
}

/** Problems with one declaration, given the variables of the program and the value `init` the variable starts with. */
export function controlProblems(c: ControlDecl, init: number | undefined): string[] {
  const out: string[] = [];
  if (init === undefined) return [`${c.kind}(${c.name}) needs a variable: declare it with let ${c.name} = ...;`];
  if (!c.label.trim() || c.label.length > MAX_CONTROL_LABEL) out.push(`The label of ${c.name} must be 1-${MAX_CONTROL_LABEL} characters`);
  if (c.kind === 'toggle') {
    if (init !== 0 && init !== 1) out.push(`${c.name} is a toggle, so it must start as 0 or 1 (it starts as ${init})`);
    return out;
  }
  if (![c.min, c.max, c.step].every(Number.isInteger)) return [...out, `The min, max and step of ${c.name} must be whole numbers`];
  if (c.min >= c.max) out.push(`The min of ${c.name} must be lower than its max`);
  else if (c.max - c.min > MAX_CONTROL_RANGE) out.push(`The range of ${c.name} can span at most ${MAX_CONTROL_RANGE}`);
  else if (c.step < 1 || c.step > c.max - c.min) out.push(`The step of ${c.name} must be between 1 and ${c.max - c.min}`);
  else if (init < c.min || init > c.max) out.push(`${c.name} starts as ${init}, outside its slider range ${c.min} to ${c.max}`);
  return out;
}
