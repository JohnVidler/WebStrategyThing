import type { ConfigField } from './events';
import { BLOCK_BY_NAME } from './blocks';
import { EVENT_BY_NAME } from './events';
import type { FlowHost } from './host';
import { FlowError, type ConfigValue } from './ir';

/** Named constants shown (and accepted) for an event setting, by `Event.field`. */
export const CONFIG_NAMES: Readonly<Record<string, readonly string[]>> = {
  'Detected.watch': ['ENEMY', 'RESOURCE', 'DAMAGED_ALLY'],
  'Detected.sort': ['NEAREST', 'WEAKEST', 'STRONGEST', 'MOST_DAMAGED'],
  'Order.types': ['MOVE', 'ATTACK', 'HARVEST', 'DOCK', 'STOP', 'CHARGE', 'BUILD', 'SUPPLY', 'REPAIR'],
  'Order.from': ['FROM_PLAYER', 'FROM_BUILDING'],
  'Order.urgent': ['QUEUE', 'REPLACE'],
  'TakeOrders.types': ['MOVE', 'STOP', 'CHARGE'],
  'TakeOrders.urgent': ['QUEUE', 'REPLACE'],
  'EngageEnemies.watch': ['ENEMY', 'RESOURCE', 'DAMAGED_ALLY', 'MISSILE'],
  'Message.link': ['RADIO', 'LASER'],
  'Visitor.reasons': ['PRODUCED', 'DOCKED'],
};

/** One number of a setting, by its constant's name where it has one. */
export function configNumberText(event: string, field: string, n: number, host: FlowHost): string {
  const names = CONFIG_NAMES[`${event}.${field}`];
  if (!names) return String(n);
  const hit = names.find((nm) => host.constants.get(nm) === n);
  if (hit) return hit;
  if (field === 'from' && n === 3) return 'FROM_PLAYER | FROM_BUILDING';
  return String(n);
}

/** A setting as the editors show it: `6`, `ENEMY, RESOURCE` (a list, without brackets) or the text itself. */
export function configToText(event: string, field: ConfigField, value: ConfigValue | undefined, host: FlowHost): string {
  const v = value ?? field.default;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return configNumberText(event, field.name, v, host);
  return (v as readonly number[]).map((n) => configNumberText(event, field.name, n, host)).join(', ');
}

const evalToken = (token: string, host: FlowHost): number | undefined => {
  const t = token.trim();
  if (/^-?\d+$/.test(t)) return Number(t);
  if (host.constants.has(t)) return host.constants.get(t);
  return undefined;
};

/** A number or constants joined by `|` (as `from: FROM_PLAYER | FROM_BUILDING`). */
const evalNumber = (text: string, host: FlowHost): number | undefined => {
  let total = 0;
  for (const part of text.split('|')) {
    const v = evalToken(part, host);
    if (v === undefined) return undefined;
    total |= v;
  }
  return total;
};

/** Reads what a player typed into a setting. Throws FlowError saying what is wrong. */
export function configFromText(event: string, field: ConfigField, text: string, host: FlowHost): ConfigValue {
  if (!EVENT_BY_NAME.has(event) && !BLOCK_BY_NAME.has(event)) throw new FlowError(`Unknown event ${event}`);
  if (field.type === 'string') return text;
  if (field.type === 'ints') {
    const items = text.split(',').map((s) => s.trim()).filter(Boolean);
    const out: number[] = [];
    for (const item of items) {
      const v = evalNumber(item, host);
      if (v === undefined) throw new FlowError(`'${item}' is not a number or a constant such as MOVE`);
      out.push(v);
    }
    return out;
  }
  const v = evalNumber(text, host);
  if (v === undefined) throw new FlowError(`'${text.trim()}' is not a number or a constant`);
  if (field.min !== undefined && v < field.min) throw new FlowError(`${field.name} must be at least ${field.min}`);
  if (field.max !== undefined && v > field.max) throw new FlowError(`${field.name} must be at most ${field.max}`);
  return v;
}
