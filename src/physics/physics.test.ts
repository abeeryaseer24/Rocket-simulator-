import { describe, expect, it } from 'vitest';
import { atmosphere } from './atmosphere';
import { ecefToGeodetic, geodeticToECEF, gravityJ2 } from './earth';
import { circularSpeed, elementsFromState } from './orbit';
import { idealDeltaV, ispAt, thrustAt, type EngineSpec } from './propulsion';
import { DEG, MU_EARTH, R_EQ } from './constants';
import { norm } from './vec';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('US Standard Atmosphere 1976', () => {
  // Reference values: NOAA-S/T 76-1562, Table I (geometric altitude)
  const ref: Array<[number, number, number, number]> = [
    // z [m], T [K], p [Pa], rho [kg/m³]
    [0, 288.15, 101325, 1.225],
    [5000, 255.68, 54048, 0.73643],
    [11000, 216.77, 22700, 0.36480],
    [20000, 216.65, 5529.3, 0.088910],
    [32000, 228.49, 889.06, 0.013555],
    [50000, 270.65, 79.779, 1.0269e-3],
    [80000, 198.64, 1.0525, 1.8458e-5],
  ];
  it.each(ref)('matches tabulated state at %d m', (z, T, p, rho) => {
    const s = atmosphere(z);
    expect(rel(s.T, T)).toBeLessThan(0.002);
    expect(rel(s.p, p)).toBeLessThan(0.005);
    expect(rel(s.rho, rho)).toBeLessThan(0.005);
  });
  it('sea-level speed of sound is 340.29 m/s', () => {
    expect(atmosphere(0).a).toBeCloseTo(340.29, 1);
  });
  it('is continuous across the 86 km model boundary', () => {
    const lo = atmosphere(85990);
    const hi = atmosphere(86010);
    expect(rel(lo.rho, hi.rho)).toBeLessThan(0.05);
  });
});

describe('Earth model', () => {
  it('geodetic round-trips to millimetres', () => {
    const r = geodeticToECEF(28.5 * DEG, -80.6 * DEG, 120);
    const g = ecefToGeodetic(r);
    expect(g.lat / DEG).toBeCloseTo(28.5, 8);
    expect(g.h).toBeCloseTo(120, 3);
  });
  it('surface gravity ≈ 9.78 at equator, ≈ 9.83 at pole (spherical part + J2)', () => {
    const eq = norm(gravityJ2(geodeticToECEF(0, 0, 0)));
    const pole = norm(gravityJ2(geodeticToECEF(90 * DEG, 0, 0)));
    // Pure gravitation (no centrifugal term): 9.814 equator, 9.832 pole
    expect(eq).toBeCloseTo(9.814, 2);
    expect(pole).toBeCloseTo(9.832, 2);
  });
});

describe('Orbital mechanics', () => {
  it('circular state yields e ≈ 0 and correct period', () => {
    const r = R_EQ + 400e3;
    const v = circularSpeed(r);
    const el = elementsFromState([r, 0, 0], [0, v, 0]);
    expect(el.e).toBeLessThan(1e-12);
    expect(el.peri).toBeCloseTo(400e3, 0);
    expect(el.period).toBeCloseTo(2 * Math.PI * Math.sqrt(r ** 3 / MU_EARTH), 6);
  });
  it('inclination of polar orbit is 90°', () => {
    const r = R_EQ + 500e3;
    const el = elementsFromState([r, 0, 0], [0, 0, circularSpeed(r)]);
    expect(el.i / DEG).toBeCloseTo(90, 9);
  });
});

describe('Propulsion', () => {
  const merlinLike: EngineSpec = {
    name: 'test',
    thrustVac: 914e3,
    ispVac: 311,
    exitArea: 0.68,
    count: 1,
    throttleMin: 0.4,
    chamberPressure: 97,
    expansionRatio: 16,
    cycle: 'gas generator',
  };
  it('loses p·Ae of thrust at sea level', () => {
    expect(thrustAt(merlinLike, 101325)).toBeCloseTo(914e3 - 101325 * 0.68, 0);
  });
  it('derived sea-level Isp is lower than vacuum Isp', () => {
    const isl = ispAt(merlinLike, 101325);
    expect(isl).toBeGreaterThan(280);
    expect(isl).toBeLessThan(288);
  });
  it('Tsiolkovsky: mass ratio e gives Δv = ve', () => {
    expect(idealDeltaV(300, Math.E, 1)).toBeCloseTo(300 * 9.80665, 6);
  });
});
