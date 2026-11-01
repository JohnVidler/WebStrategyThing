import { describe, expect, it } from 'vitest';
import { deriveStats } from '../src';

const rate = (chassis: string, cargo = 'cargo.bay') => deriveStats([chassis, 'cpu.basic', 'motor.small', cargo]).harvestRate;

describe('harvest rate', () => {
  it('grows with the size of the hull', () => {
    const rates = ['chassis.micro', 'chassis.light', 'chassis.medium', 'chassis.heavy', 'chassis.superheavy'].map((c) => rate(c));
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThanOrEqual(rates[i - 1]);
    expect(rates[4]).toBeGreaterThan(rates[1]);
  });

  it('is slow enough for a light harvester to spend a couple of seconds filling up', () => {
    const s = deriveStats(['chassis.light', 'cpu.basic', 'motor.small', 'cargo.bay']);
    expect(s.cargo / s.harvestRate).toBeGreaterThanOrEqual(15);
  });

  it('never rounds a working cargo module down to nothing', () => {
    expect(rate('chassis.micro')).toBeGreaterThanOrEqual(1);
  });
});
