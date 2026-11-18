import { G0, GAMMA_AIR, R_AIR, R_GEOPOTENTIAL } from './constants';

/**
 * U.S. Standard Atmosphere 1976.
 *
 * 0–86 km: the seven geopotential layers, each with a constant temperature
 * lapse rate L. Within a layer, hydrostatics + ideal gas give
 *   L ≠ 0 : p = p_b · (T_b / T)^(g0 / (R·L))
 *   L = 0 : p = p_b · exp(−g0 (h − h_b) / (R·T_b))
 * Above 86 km the gas is no longer well mixed (molecular weight drops), so
 * we log-interpolate the tabulated US76 values instead of pretending the
 * ideal-gas layer model still holds.
 */

export interface AtmosphereState {
  /** Kinetic temperature [K] */
  T: number;
  /** Static pressure [Pa] */
  p: number;
  /** Density [kg/m³] */
  rho: number;
  /** Speed of sound [m/s] */
  a: number;
}

// Layer bases: geopotential altitude [m], lapse rate [K/m], base T [K], base p [Pa]
const LAYERS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, -0.0065, 288.15, 101325.0],
  [11000, 0.0, 216.65, 22632.06],
  [20000, 0.001, 216.65, 5474.889],
  [32000, 0.0028, 228.65, 868.0187],
  [47000, 0.0, 270.65, 110.9063],
  [51000, -0.0028, 270.65, 66.93887],
  [71000, -0.002, 214.65, 3.956420],
];
const H_TOP = 84852; // geopotential top of layered model (= 86 km geometric)

// Geometric altitude [km], T [K], p [Pa], rho [kg/m³] — US76 tables, 86–1000 km
const UPPER: ReadonlyArray<readonly [number, number, number, number]> = [
  [86, 186.87, 3.7338e-1, 6.958e-6],
  [100, 195.08, 3.2011e-2, 5.604e-7],
  [120, 360.0, 2.5382e-3, 2.222e-8],
  [150, 634.39, 4.5422e-4, 2.076e-9],
  [200, 854.56, 8.4736e-5, 2.541e-10],
  [300, 976.01, 8.7704e-6, 1.916e-11],
  [400, 995.83, 1.4518e-6, 2.803e-12],
  [500, 999.24, 3.0236e-7, 5.215e-13],
  [600, 999.85, 8.213e-8, 1.137e-13],
  [700, 999.97, 3.1908e-8, 3.07e-14],
  [800, 999.99, 1.7036e-8, 1.136e-14],
  [1000, 1000.0, 7.5138e-9, 3.561e-15],
];

/** Geometric → geopotential altitude [m]. */
export const geopotential = (z: number): number => (R_GEOPOTENTIAL * z) / (R_GEOPOTENTIAL + z);

export function atmosphere(zGeometric: number): AtmosphereState {
  const z = Math.max(zGeometric, -500);
  const h = geopotential(z);

  if (h < H_TOP) {
    let i = LAYERS.length - 1;
    while (i > 0 && h < LAYERS[i][0]) i--;
    const [hb, L, Tb, pb] = LAYERS[i];
    const T = Tb + L * (h - hb);
    const p =
      L === 0 ? pb * Math.exp((-G0 * (h - hb)) / (R_AIR * Tb)) : pb * Math.pow(Tb / T, G0 / (R_AIR * L));
    const rho = p / (R_AIR * T);
    return { T, p, rho, a: Math.sqrt(GAMMA_AIR * R_AIR * T) };
  }

  const km = z / 1000;
  if (km >= 1000) {
    const last = UPPER[UPPER.length - 1];
    return { T: last[1], p: last[2], rho: last[3], a: Math.sqrt(GAMMA_AIR * R_AIR * last[1]) };
  }
  let j = 0;
  while (j < UPPER.length - 2 && km > UPPER[j + 1][0]) j++;
  const [k0, T0, p0, r0] = UPPER[j];
  const [k1, T1, p1, r1] = UPPER[j + 1];
  const f = Math.max(0, Math.min(1, (km - k0) / (k1 - k0)));
  const T = T0 + (T1 - T0) * f;
  const p = Math.exp(Math.log(p0) + (Math.log(p1) - Math.log(p0)) * f);
  const rho = Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * f);
  // Speed of sound is not physically meaningful in free-molecular flow; reported for continuity only.
  return { T, p, rho, a: Math.sqrt(GAMMA_AIR * R_AIR * T) };
}
