import { atmosphere } from '../physics/atmosphere';
import { FLATTENING, MU_EARTH, OMEGA_EARTH, R_EQ } from '../physics/constants';
import { gravityJ2 } from '../physics/earth';
import { areaRatio, pressureRatio } from '../physics/nozzle';
import { elementsFromState } from '../physics/orbit';
import { norm } from '../physics/vec';
import type { FlightResult } from './simulate';

/**
 * Validation against published reference data. Two levels:
 *  1. Kernel checks: each physics model against a standard table.
 *  2. Flight benchmark: the Saturn V-class preset against the Apollo 11
 *     (AS-506) ascent, using event times and orbit from NASA's mission records.
 * Every reference value carries its source. Nothing here is tuned to match.
 */

export interface Check {
  group: string;
  quantity: string;
  reference: number;
  computed: number;
  unit: string;
  /** Relative tolerance for a pass */
  tol: number;
  source: string;
}

const US76 = 'U.S. Standard Atmosphere, 1976 (NOAA-S/T 76-1562), Table I';
const WGS = 'NIMA TR8350.2, WGS-84 (3rd ed.), normal gravity';
const NACA = 'NACA Report 1135 (1953), isentropic flow tables, γ = 1.4';

export function kernelChecks(): Check[] {
  const out: Check[] = [];
  const atm: Array<[number, number, number, number]> = [
    [0, 288.15, 101325, 1.225],
    [5000, 255.68, 54048, 0.73643],
    [11000, 216.77, 22700, 0.3648],
    [20000, 216.65, 5529.3, 0.08891],
    [32000, 228.49, 889.06, 0.013555],
    [50000, 270.65, 79.779, 1.0269e-3],
    [80000, 198.64, 1.0525, 1.8458e-5],
  ];
  for (const [z, T, p, rho] of atm) {
    const s = atmosphere(z);
    const km = `${z / 1000} km`;
    out.push({ group: 'Atmosphere', quantity: `Temperature at ${km}`, reference: T, computed: s.T, unit: 'K', tol: 0.002, source: US76 });
    out.push({ group: 'Atmosphere', quantity: `Pressure at ${km}`, reference: p, computed: s.p, unit: 'Pa', tol: 0.005, source: US76 });
    out.push({ group: 'Atmosphere', quantity: `Density at ${km}`, reference: rho, computed: s.rho, unit: 'kg/m³', tol: 0.005, source: US76 });
  }
  out.push({ group: 'Atmosphere', quantity: 'Speed of sound at sea level', reference: 340.294, computed: atmosphere(0).a, unit: 'm/s', tol: 0.001, source: US76 });

  // Effective gravity = J2 gravitation minus centripetal term of Earth's rotation
  const gEq = norm(gravityJ2([R_EQ, 0, 0])) - OMEGA_EARTH ** 2 * R_EQ;
  const gPole = norm(gravityJ2([0, 0, R_EQ * (1 - FLATTENING)]));
  out.push({ group: 'Gravity', quantity: 'Surface gravity, equator', reference: 9.7803253359, computed: gEq, unit: 'm/s²', tol: 0.001, source: WGS });
  out.push({ group: 'Gravity', quantity: 'Surface gravity, pole', reference: 9.8321849378, computed: gPole, unit: 'm/s²', tol: 0.001, source: WGS });

  // Geostationary radius must give one sidereal day
  const rGeo = 42164.17e3;
  const el = elementsFromState([rGeo, 0, 0], [0, Math.sqrt(MU_EARTH / rGeo), 0]);
  out.push({ group: 'Orbits', quantity: 'Period at geostationary radius', reference: 86164.0905, computed: el.period, unit: 's', tol: 0.0005, source: 'IERS sidereal day; GEO radius 42 164 km' });

  out.push({ group: 'Nozzle', quantity: 'Area ratio A/A* at M = 2', reference: 1.6875, computed: areaRatio(2, 1.4), unit: '', tol: 0.001, source: NACA });
  out.push({ group: 'Nozzle', quantity: 'Pressure ratio p/p₀ at M = 2', reference: 0.1278, computed: pressureRatio(2, 1.4), unit: '', tol: 0.002, source: NACA });
  out.push({ group: 'Nozzle', quantity: 'Area ratio A/A* at M = 3', reference: 4.2346, computed: areaRatio(3, 1.4), unit: '', tol: 0.001, source: NACA });
  return out;
}

export const passes = (c: Check) => Math.abs(c.computed - c.reference) <= c.tol * Math.abs(c.reference);

/* --- Flight benchmark: Apollo 11 --- */

export interface BenchRow {
  quantity: string;
  reference: number;
  simulated: number | null;
  unit: string;
  note: string;
}

export const APOLLO11_SOURCE =
  'Apollo 11 Mission Report (NASA MSC-00171, 1969) and Saturn V Launch Vehicle Flight Evaluation Report AS-506 (NASA MSFC, 1969), as reproduced in the Apollo Flight Journal.';

export function apollo11Benchmark(r: FlightResult): BenchRow[] {
  const ev = (kind: string, n = 0) => r.events.filter((e) => e.kind === kind)[n]?.t ?? null;
  const fin = r.final;
  return [
    { quantity: 'Mach 1', reference: 66.3, simulated: ev('mach-1'), unit: 's', note: 'Depends on thrust-to-weight and the drag table near Mach 1.' },
    { quantity: 'Maximum dynamic pressure', reference: 83.0, simulated: ev('max-q'), unit: 's', note: '' },
    { quantity: 'Max-Q value', reference: 35.2, simulated: r.maxQ.q / 1000, unit: 'kPa', note: 'Reported as 735 lb/ft². Saturn V did not throttle; neither does the preset.' },
    { quantity: 'S-IC centre-engine cutoff', reference: 135.2, simulated: null, unit: 's', note: 'Not modelled: the real vehicle shut its centre F-1 early to cap acceleration near 4 g.' },
    { quantity: 'S-IC outboard cutoff', reference: 161.6, simulated: ev('meco', 0), unit: 's', note: 'Without centre-engine cutoff the preset burns all five engines to depletion.' },
    { quantity: 'S-II cutoff', reference: 548.2, simulated: ev('meco', 1), unit: 's', note: 'The real S-II stepped its mixture ratio mid-burn; the preset uses one thrust level.' },
    { quantity: 'S-IVB first cutoff', reference: 699.3, simulated: ev('seco'), unit: 's', note: 'Earlier here because the simulated S-II delivers more of the Δv and the preset aims for a 190 km circular orbit.' },
    { quantity: 'Parking orbit apogee', reference: 186.0, simulated: fin ? fin.apo / 1000 : null, unit: 'km', note: 'Reported as 100.4 nmi. The simulator measures altitude above the equatorial radius; the reference may use a different Earth radius, worth about a kilometre.' },
    { quantity: 'Parking orbit perigee', reference: 183.2, simulated: fin ? fin.peri / 1000 : null, unit: 'km', note: 'Reported as 98.9 nmi.' },
    { quantity: 'Orbit inclination', reference: 32.52, simulated: fin ? (fin.i * 180) / Math.PI : null, unit: '°', note: 'Set by the launch azimuth from the Cape.' },
  ];
}
