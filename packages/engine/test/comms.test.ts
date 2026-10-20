import { describe, expect, it } from 'vitest';
import { Simulation, TILE } from '../src';
import { prog } from './helpers';

const at = (t: number) => t * TILE + TILE / 2;
const lines = (...l: string[]): string => l.join('\n');

const LISTEN = lines(
  'let heard = 0;',
  'let from = 0;',
  'on(Message, (channel, value, sender, link) => {',
  '  heard = heard + value;',
  '  from = link;',
  '});',
);

function setup(rock = false) {
  const sim = new Simulation({ width: 60, height: 20, seed: 1 });
  if (rock) for (let y = 0; y < 20; y++) sim.terrain.passable[y * 60 + 20] = 0;
  const radio = ['chassis.medium', 'cpu.basic', 'radio.basic', 'battery.cell'];
  const laser = ['chassis.medium', 'cpu.basic', 'radio.laser', 'battery.cell'];
  const talker = sim.blueprints.define(1, 'Talker', [...radio, 'radio.laser']);
  const listenRadio = sim.blueprints.define(1, 'ListenRadio', radio);
  const listenLaser = sim.blueprints.define(1, 'ListenLaser', laser);
  const stranger = sim.blueprints.define(2, 'Stranger', radio);
  sim.setProgram(listenRadio.id, prog(LISTEN));
  sim.setProgram(listenLaser.id, prog(LISTEN));
  sim.setProgram(stranger.id, prog(LISTEN));
  return { sim, talker, listenRadio, listenLaser, stranger };
}

const heard = (sim: Simulation, e: number): number => {
  const fs = sim.flows[e]!;
  return fs.mem[fs.program.varNames.indexOf('heard')];
};

const settle = (sim: Simulation) => {
  sim.spatial.rebuild(sim.pos.f.x, sim.pos.f.y, sim.pos.dense, sim.world.capacity);
  for (let i = 0; i < 3; i++) sim.step();
};

describe('radio and laser link', () => {
  it('a radio message reaches allied radios in range, through rock, and costs energy', () => {
    const { sim, talker, listenRadio } = setup(true);
    const a = sim.spawnUnit(talker, at(10), at(5));
    const near = sim.spawnUnit(listenRadio, at(21), at(5));
    const far = sim.spawnUnit(listenRadio, at(40), at(5));
    settle(sim);
    const before = sim.energy.f.amount[a];
    expect(sim.transmit(a, 1, 7, 5)).toBe(1);
    expect(sim.energy.f.amount[a]).toBe(before - 1);
    settle(sim);
    expect(heard(sim, near)).toBe(5);
    expect(heard(sim, far)).toBe(0);
    const fs = sim.flows[near]!;
    expect(fs.mem[fs.program.varNames.indexOf('from')]).toBe(1);
  });

  it('a laser reaches much further, but rock blocks the line', () => {
    const open = setup(false);
    const a = open.sim.spawnUnit(open.talker, at(5), at(5));
    const faraway = open.sim.spawnUnit(open.listenLaser, at(45), at(5));
    const radioOnly = open.sim.spawnUnit(open.listenRadio, at(10), at(5));
    settle(open.sim);
    expect(open.sim.transmit(a, 2, 1, 3)).toBe(1);
    settle(open.sim);
    expect(heard(open.sim, faraway)).toBe(3);
    expect(heard(open.sim, radioOnly)).toBe(0);

    const walled = setup(true);
    const b = walled.sim.spawnUnit(walled.talker, at(5), at(5));
    const hidden = walled.sim.spawnUnit(walled.listenLaser, at(30), at(5));
    settle(walled.sim);
    expect(walled.sim.transmit(b, 2, 1, 3)).toBe(0);
    settle(walled.sim);
    expect(heard(walled.sim, hidden)).toBe(0);
  });

  it('only allies hear it, a channel filter applies, and a unit without the module cannot send', () => {
    const { sim, talker, listenRadio, stranger } = setup();
    const a = sim.spawnUnit(talker, at(5), at(5));
    const ally = sim.spawnUnit(listenRadio, at(8), at(5));
    const foe = sim.spawnUnit(stranger, at(9), at(5));
    const mute = sim.spawnUnit(sim.blueprints.define(1, 'Mute', ['chassis.light', 'cpu.basic', 'battery.cell']), at(6), at(5));
    settle(sim);
    expect(sim.transmit(mute, 1, 1, 1)).toBe(-1);
    expect(sim.transmit(a, 1, 1, 4)).toBe(1);
    settle(sim);
    expect(heard(sim, ally)).toBe(4);
    expect(heard(sim, foe)).toBe(0);

    const filtered = sim.blueprints.define(1, 'Picky', ['chassis.medium', 'cpu.basic', 'radio.basic', 'battery.cell']);
    sim.setProgram(filtered.id, prog(lines('let heard = 0;', 'on(Message, { channels: [2] }, (channel, value) => {', '  heard = heard + value;', '});')));
    const picky = sim.spawnUnit(filtered, at(7), at(5));
    settle(sim);
    sim.transmit(a, 1, 1, 10);
    sim.transmit(a, 1, 2, 20);
    settle(sim);
    expect(heard(sim, picky)).toBe(20);
  });

  it('can be sent from a program with radioSend and laserSend', () => {
    const { sim, talker, listenRadio } = setup();
    sim.setProgram(talker.id, prog(lines('on(Every, { ticks: 3 }, () => {', '  const n = radioSend(1, 9);', '  alert(\'sent to \' + n, 1000);', '});')));
    const a = sim.spawnUnit(talker, at(5), at(5));
    const b = sim.spawnUnit(listenRadio, at(8), at(5));
    sim.spatial.rebuild(sim.pos.f.x, sim.pos.f.y, sim.pos.dense, sim.world.capacity);
    let text: string | undefined;
    for (let i = 0; i < 6 && !text; i++) {
      sim.step();
      text = sim.alerts.find((x) => x.e === a)?.text;
    }
    expect(text).toBe('sent to 1');
    settle(sim);
    expect(heard(sim, b) % 9).toBe(0);
    expect(heard(sim, b)).toBeGreaterThan(0);
  });
});
