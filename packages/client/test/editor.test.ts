import { describe, expect, it } from 'vitest';
import { deriveStats, FLOW_HOST } from '@wst/engine';
import { placeAt, problemsOf } from '../src/editor';
import { FlowDocument } from '../src/flow/FlowDocument';

const docOf = (text: string) => {
  const d = new FlowDocument(FLOW_HOST);
  d.loadText(text);
  return d;
};

describe('text editor: where the cursor is', () => {
  it('knows event names, event settings and ordinary code apart', () => {
    expect(placeAt('let a = 0;\non(Id')).toEqual({ kind: 'event' });
    expect(placeAt('on(')).toEqual({ kind: 'event' });
    const cfg = placeAt('on(Detected, { watch: [ENEMY], ra');
    expect(cfg.kind).toBe('config');
    expect(cfg.kind === 'config' && cfg.event.name).toBe('Detected');
    expect(placeAt('on(Idle, () => {\n  fi')).toEqual({ kind: 'code' });
    expect(placeAt('on(Idle, { interval: 4 }, () => {\n  fi')).toEqual({ kind: 'code' });
    expect(placeAt('on(Nope, { ')).toEqual({ kind: 'code' });
  });
});

describe('text editor: what is wrong with the program', () => {
  const unit = deriveStats(['chassis.light', 'cpu.basic', 'sensor.short']);

  it('points at the line of a syntax or program error', () => {
    const text = 'on(Idle, () => {\n  act(1);\n});\n';
    const problems = problemsOf(docOf(text), unit);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toMatch(/Unknown function 'act'/);
    expect(text.slice(problems[0].from, problems[0].to)).toBe('act(1)');
    expect(problemsOf(docOf('on(Idle, () => { moveTo(1; });'), unit)[0].message).toBe('Syntax error');
  });

  it('reports a program that does not fit the memory, and a class with no CPU', () => {
    const many = `on(Idle, () => {\n${Array.from({ length: 20 }, (_, i) => `  fire(${i + 5});`).join('\n')}\n});`;
    const memory = problemsOf(docOf(many), unit).find((p) => /memory slots/.test(p.message));
    expect(memory?.severity).toBe('error');
    const noCpu = deriveStats(['chassis.light', 'motor.small']);
    expect(problemsOf(docOf('on(Idle, () => {\n  fire(0);\n});'), noCpu).some((p) => /no CPU/.test(p.message))).toBe(true);
  });

  it('says where a sensor block asks for more than the installed sensor can do', () => {
    const text = 'let a = 0;\non(Detected, { watch: [ENEMY, RESOURCE], sort: WEAKEST, limit: 3 }, (kind, h) => {\n  a = h;\n});\n';
    const warnings = problemsOf(docOf(text), unit).filter((p) => p.severity === 'warning');
    expect(warnings.length).toBeGreaterThanOrEqual(3);
    expect(text.slice(warnings[0].from, warnings[0].to)).toMatch(/^on\(Detected/);
    const long = deriveStats(['chassis.light', 'cpu.basic', 'sensor.long']);
    expect(problemsOf(docOf(text), long)).toEqual([]);
  });
});
