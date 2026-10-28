import { describe, expect, it } from 'vitest';
import { aims, drawWall, gaitLength, hullOutline, isWall, legCount, lookOf, turretAnchor, turretAnchors, windAnchor } from '../src/art';

describe('class art', () => {
  it('reads a design as roles and features', () => {
    const tank = lookOf(['chassis.medium', 'cpu.basic', 'motor.large', 'gun.cannon', 'armor.plate', 'armor.plate']);
    expect(tank).toMatchObject({ structure: false, size: 2, radius: 0.38, role: 'combat', weapon: 'cannon', motor: 'large', armour: 2 });
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

  it('treats a building that is only armour as a wall', () => {
    expect(isWall(lookOf(['frame.small', 'armor.plate']))).toBe(true);
    expect(isWall(lookOf(['frame.medium', 'armor.plate', 'armor.plate']))).toBe(true);
    expect(isWall(lookOf(['frame.small']))).toBe(false); // bare frame: no armour
    expect(isWall(lookOf(['frame.small', 'armor.plate', 'cpu.basic']))).toBe(false); // armour does not outnumber the rest
    expect(isWall(lookOf(['frame.medium', 'armor.plate', 'armor.plate', 'cpu.basic']))).toBe(true); // more armour than other modules
    expect(isWall(lookOf(['frame.l', 'armor.plate']))).toBe(false); // shaped frames keep their own look
    expect(isWall(lookOf(['chassis.light', 'armor.plate']))).toBe(false); // units are never walls
  });

  it('draws a wall for every combination of joined sides and diagonals, inside its footprint plus the padding', () => {
    for (const parts of [['frame.small', 'armor.plate'], ['frame.medium', 'armor.plate']]) {
      const look = lookOf(parts);
      const half = (look.size * 64) / 2 + 16; // diagonal arms overhang the footprint by a few pixels
      const calls: number[][] = [];
      const g: Record<string, unknown> = {};
      for (const m of ['rect', 'circle', 'poly', 'fill', 'stroke']) g[m] = (...a: unknown[]) => (m === 'poly' ? calls.push(a[0] as number[]) : m === 'rect' ? calls.push([a[0] as number, a[1] as number]) : undefined, g);
      for (let mask = 0; mask < 256; mask++) {
        calls.length = 0;
        drawWall(g as never, look, 0x3366ff, 64, mask);
        for (const pts of calls) for (const v of pts) expect(Math.abs(v)).toBeLessThanOrEqual(half + 1e-6);
      }
    }
  });

  it('gives every motor and chassis tier its own silhouette', () => {
    const motors = ['none', 'small', 'large', 'huge', 'rotor', 'legs'] as const;
    const seen = new Map<string, string>();
    for (const motor of motors) {
      for (let size = 0; size <= 5; size++) {
        const pts = hullOutline({ motor, size });
        const name = `${motor}/${size}`;
        expect(pts.length, name).toBeGreaterThanOrEqual(8);
        expect(pts.length % 2, name).toBe(0);
        for (const v of pts) expect(Math.abs(v), name).toBeLessThanOrEqual(1.1);
        const key = JSON.stringify(pts);
        expect(seen.get(key), `${name} duplicates ${seen.get(key)}`).toBeUndefined();
        seen.set(key, name);
      }
    }
    expect(seen.size).toBe(36);
  });

  it('is not just a bigger copy: tiers differ in proportion, not only in size', () => {
    // Width of the hull at its widest, over its length, for each wheeled tier.
    const ratio = (size: number) => {
      const pts = hullOutline({ motor: 'large', size });
      const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
      return (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
    };
    // A scaled copy would keep the same outline; these differ in point count or proportion.
    const outlines = [0, 1, 2, 3, 4, 5].map((t) => hullOutline({ motor: 'large', size: t }).length);
    expect(new Set(outlines).size).toBeGreaterThan(2);
    expect(ratio(0)).not.toBeCloseTo(ratio(5), 2);
  });

  it('keeps the outline symmetric left to right', () => {
    for (const motor of ['small', 'large', 'huge', 'rotor', 'legs', 'none'] as const) {
      for (let size = 0; size <= 5; size++) {
        const pts = hullOutline({ motor, size });
        const key = (x: number, y: number) => `${x.toFixed(4)},${y.toFixed(4)}`;
        const have = new Set<string>();
        for (let i = 0; i < pts.length; i += 2) have.add(key(pts[i], pts[i + 1]));
        for (let i = 0; i < pts.length; i += 2) expect(have.has(key(-pts[i], pts[i + 1])), `${motor}/${size}`).toBe(true);
      }
    }
  });

  it('gives walkers six legs or more from medium up', () => {
    for (let size = 0; size <= 5; size++) {
      const n = legCount({ size });
      expect(n % 2).toBe(0);
      if (size >= 2) expect(n).toBeGreaterThanOrEqual(6);
    }
    expect(legCount({ size: 5 })).toBeGreaterThan(legCount({ size: 2 }));
  });

  it('takes longer strides on bigger legs', () => {
    expect(gaitLength({ radius: 1 })).toBeGreaterThan(gaitLength({ radius: 0.3 }));
  });
  it('knows which weapons turn to face a target, and where their turret sits', () => {
    const gun = lookOf(['chassis.medium', 'cpu.basic', 'motor.small', 'gun.light']);
    expect(aims(gun)).toBe(true);
    expect(turretAnchor(gun, 32)).toMatchObject({ x: 0, y: 0 });
    expect(turretAnchor(gun, 32)!.r).toBeCloseTo(gun.radius * 32);
    // On a long chassis the turret rides forward of the middle.
    expect(turretAnchor(lookOf(['chassis.long.medium', 'cpu.basic', 'motor.small', 'gun.cannon']), 32)!.y).toBeLessThan(0);
    // A tesla coil strikes everything round it: nothing to aim. A unit without a weapon has no turret.
    const tesla = lookOf(['chassis.medium', 'cpu.basic', 'motor.small', 'tesla.coil']);
    expect(aims(tesla)).toBe(false);
    expect(turretAnchor(tesla, 32)).toBeNull();
    expect(turretAnchor(lookOf(['chassis.medium', 'cpu.basic', 'motor.small']), 32)).toBeNull();
    // A weapon in a building sits in one of its cells.
    const tower = lookOf(['frame.medium', 'cpu.basic', 'laser.beam', 'battery.bank']);
    const a = turretAnchor(tower, 32)!;
    expect(a.r).toBeGreaterThan(0);
    expect(Math.abs(a.x)).toBeLessThanOrEqual(32);
    expect(turretAnchor(lookOf(['frame.medium', 'cpu.basic', 'battery.bank']), 32)).toBeNull();
  });
  it('gives a building one turret for each weapon it carries', () => {
    expect(turretAnchors(lookOf(['frame.medium', 'cpu.basic', 'gun.light']), 32)).toHaveLength(1);
    const twin = turretAnchors(lookOf(['frame.medium', 'cpu.basic', 'gun.light', 'gun.light']), 32);
    expect(twin).toHaveLength(2);
    expect(twin[0]).not.toEqual(twin[1]);
    // A one-tile laser tower with a sensor and a battery still gets a big turret in the middle (one-tile buildings are drawn at about half a tile).
    const laser = turretAnchors(lookOf(['frame.small', 'cpu.basic', 'sensor.long', 'laser.beam', 'battery.bank']), 32);
    expect(laser).toHaveLength(1);
    expect(laser[0]).toMatchObject({ x: 0, y: 0 });
    expect(laser[0].r).toBeGreaterThan(5);
    expect(laser[0].r).toBeLessThanOrEqual(8); // inside the half-tile plinth
    // Never wider than its cell, and none for a coil that does not aim or a building with no weapon.
    for (const t of twin) expect(t.r).toBeLessThanOrEqual(16);
    expect(turretAnchors(lookOf(['frame.medium', 'cpu.basic', 'tesla.coil']), 32)).toHaveLength(0);
    expect(turretAnchors(lookOf(['frame.medium', 'cpu.basic', 'battery.bank']), 32)).toHaveLength(0);
  });

  it('records the weapon mass, so heavy guns can get big housings', () => {
    const light = lookOf(['chassis.heavy', 'cpu.basic', 'gun.light']);
    const cannon = lookOf(['chassis.heavy', 'cpu.basic', 'gun.cannon']);
    const siege = lookOf(['chassis.colossus', 'cpu.basic', 'cannon.siege']);
    expect(light.weaponMass).toBeLessThan(cannon.weaponMass);
    expect(cannon.weaponMass).toBeLessThan(siege.weaponMass);
    expect(lookOf(['chassis.heavy', 'cpu.basic']).weaponMass).toBe(0);
  });

  it('finds the rotor of a wind turbine building, and only that', () => {
    const farm = lookOf(['frame.medium', 'wind.turbine', 'solar.panel', 'cpu.basic']);
    const a = windAnchor(farm, 32)!;
    expect(a.radius).toBeGreaterThan(0);
    expect(windAnchor(lookOf(['frame.medium', 'solar.panel']), 32)).toBeNull();
    expect(windAnchor(lookOf(['chassis.medium', 'cpu.basic', 'motor.small']), 32)).toBeNull();
    // Shaped buildings place it in a covered cell too.
    expect(windAnchor(lookOf(['frame.plus', 'wind.turbine']), 32)).not.toBeNull();
  });

  it('sizes wind blades so those of buildings side by side never touch', () => {
    const lone = windAnchor(lookOf(['frame.small', 'wind.turbine', 'wind.turbine']), 32)!;
    expect(lone.radius).toBeGreaterThan(11); // bigger than the old 10.3
    expect(lone.radius * 2).toBeLessThan(32); // two one-tile turbines a tile apart
    for (const frame of ['frame.medium', 'frame.large', 'frame.l', 'frame.u']) {
      const a = windAnchor(lookOf([frame, 'cpu.basic', 'wind.turbine', 'battery.bank', 'solar.panel']), 32)!;
      const half = frame === 'frame.medium' ? 32 : frame === 'frame.large' ? 48 : 16;
      expect(a.radius, frame).toBeLessThan(half - (frame === 'frame.medium' || frame === 'frame.large' ? Math.max(Math.abs(a.x), Math.abs(a.y)) : 0));
    }
  });
});
