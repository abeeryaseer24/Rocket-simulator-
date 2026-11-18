import { MU_EARTH, R_EQ } from './constants';
import { cross, dot, norm, type Vec3 } from './vec';

export interface OrbitalElements {
  /** Semi-major axis [m]; negative for hyperbolic */
  a: number;
  /** Eccentricity */
  e: number;
  /** Inclination [rad] */
  i: number;
  /** Apoapsis altitude above equatorial radius [m] (Infinity if unbound) */
  apo: number;
  /** Periapsis altitude above equatorial radius [m] */
  peri: number;
  /** Specific orbital energy [J/kg] */
  energy: number;
  /** Orbital period [s] (NaN if unbound) */
  period: number;
}

/**
 * Osculating two-body elements from an inertial state vector. "Osculating"
 * means: the Keplerian orbit the vehicle would follow if every force except
 * point-mass gravity vanished this instant.
 */
export function elementsFromState(r: Vec3, v: Vec3): OrbitalElements {
  const rm = norm(r);
  const vm = norm(v);
  const energy = (vm * vm) / 2 - MU_EARTH / rm;
  const h = cross(r, v);
  const hm = norm(h);
  // Eccentricity vector: e = (v × h)/μ − r̂
  const vxh = cross(v, h);
  const ev: Vec3 = [vxh[0] / MU_EARTH - r[0] / rm, vxh[1] / MU_EARTH - r[1] / rm, vxh[2] / MU_EARTH - r[2] / rm];
  const e = norm(ev);
  const a = -MU_EARTH / (2 * energy);
  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / (hm || 1))));
  const bound = energy < 0 && e < 1;
  const rp = bound ? a * (1 - e) : (hm * hm) / (MU_EARTH * (1 + e));
  const ra = bound ? a * (1 + e) : Infinity;
  return {
    a,
    e,
    i,
    apo: ra - R_EQ,
    peri: rp - R_EQ,
    energy,
    period: bound ? 2 * Math.PI * Math.sqrt((a * a * a) / MU_EARTH) : NaN,
  };
}

/** Circular orbital speed at radius r [m/s]. */
export const circularSpeed = (r: number): number => Math.sqrt(MU_EARTH / r);

/** Flight-path angle γ [rad]: angle of velocity above local horizontal. */
export const flightPathAngle = (r: Vec3, v: Vec3): number => {
  const s = dot(r, v) / (norm(r) * norm(v) || 1);
  return Math.asin(Math.max(-1, Math.min(1, s)));
};

/** Sample points (inertial, m) of a Keplerian orbit for drawing. */
export function orbitPolyline(r: Vec3, v: Vec3, n = 256): Vec3[] {
  const el = elementsFromState(r, v);
  if (!(el.e < 1) || el.a <= 0) return [];
  const rm = norm(r);
  const h = cross(r, v);
  const hm = norm(h);
  const vxh = cross(v, h);
  const ev: Vec3 = [vxh[0] / MU_EARTH - r[0] / rm, vxh[1] / MU_EARTH - r[1] / rm, vxh[2] / MU_EARTH - r[2] / rm];
  // Perifocal basis: P toward periapsis, Q completes the right-handed set with ĥ
  const hu: Vec3 = [h[0] / hm, h[1] / hm, h[2] / hm];
  let P: Vec3 = el.e > 1e-6 ? [ev[0] / el.e, ev[1] / el.e, ev[2] / el.e] : [r[0] / rm, r[1] / rm, r[2] / rm];
  const Q = cross(hu, P);
  P = cross(Q, hu);
  const p = el.a * (1 - el.e * el.e);
  const pts: Vec3[] = [];
  for (let k = 0; k <= n; k++) {
    const nu = (k / n) * 2 * Math.PI;
    const rr = p / (1 + el.e * Math.cos(nu));
    const c = Math.cos(nu) * rr;
    const s = Math.sin(nu) * rr;
    pts.push([P[0] * c + Q[0] * s, P[1] * c + Q[1] * s, P[2] * c + Q[2] * s]);
  }
  return pts;
}
