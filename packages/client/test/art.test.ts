import { describe, expect, it } from 'vitest';
import { hullOutline, lookOf } from '../src/art';

describe('class art', () => {
  it('reads a design as roles and features', () => {
    const tank = lookOf(['chassis.medium', 'cpu.basic', 'motor.large', 'gun.cannon', 'armor.plate', 'armor.plate']);
    expect(tank).toMatchObject({ structure: false, size: 1, role: 'combat', weapon: 'cannon', motor: 'large', armour: 2 });
    const hauler = lookOf(['chassis.medium', 'cpu.basic', 'motor.small', 'cargo.bay']);
    expect(hauler).toMatchObject({ role: 'worker', cargo: 1, weapon: 'none' });
    const drone = lookOf(['chassis.light', 'cpu.basic', 'rotor', 'sensor.long']);
    expect(drone).toMatchObject({ role: 'scout', flying: true, sensor: 'long' });
  });

  it('changes when modules are added or removed, but keeps the size class', () => {
    const base = ['chassis.heavy', 'cpu.basic', 'motor.small'];
    const armed = lookOf([...base, 'gun.light']);
    expect(lookOf(base)).not.toEqual(armed);
    expect(lookOf(base).size).toBe(armed.size);
  });

  it('describes buildings by footprint and contents', () => {
    const farm = lookOf(['frame.medium', 'solar.panel', 'solar.panel', 'antenna.medium']);
    expect(farm).toMatchObject({ structure: true, size: 2, role: 'power', solar: 2, antenna: 'medium' });
    expect(lookOf(['frame.large', 'factory.basic', 'cpu.basic']).role).toBe('industry');
  });

  it('gives different jobs different hull silhouettes', () => {
    const hulls = [
      ['chassis.medium', 'cpu.basic', 'motor.small', 'gun.light'],
      ['chassis.medium', 'cpu.basic', 'motor.small', 'gun.cannon'],
      ['chassis.medium', 'cpu.basic', 'motor.small', 'laser.beam'],
      ['chassis.medium', 'cpu.basic', 'motor.small', 'tesla.coil'],
      ['chassis.medium', 'cpu.basic', 'motor.small', 'cargo.bay'],
      ['chassis.medium', 'cpu.basic', 'motor.small', 'build.arm'],
      ['chassis.medium', 'cpu.basic', 'rotor', 'battery.cell'],
      ['chassis.medium', 'cpu.basic', 'motor.small', 'sensor.long'],
      ['chassis.medium', 'cpu.basic', 'motor.small', 'sensor.short'],
      ['chassis.medium', 'cpu.basic', 'motor.small'],
      ['chassis.medium', 'cpu.basic'],
    ].map((p) => JSON.stringify(hullOutline(lookOf(p))));
    expect(new Set(hulls).size).toBe(hulls.length);
  });
});
