import { E2, J2, MU_EARTH, OMEGA_EARTH, R_EQ } from './constants';
import { cross, dot, norm, scale, sub, unit, type Vec3 } from './vec';

/**
 * Gravitational acceleration with the J2 zonal harmonic, in an Earth-centred
 * frame whose Z axis is the rotation axis. J2 captures the equatorial bulge:
 * it is why orbits precess and why "g" is ~0.5 % stronger at the poles.
 */
export function gravityJ2(r: Vec3): Vec3 {
  const [x, y, z] = r;
  const r2 = x * x + y * y + z * z;
  const rm = Math.sqrt(r2);
  const k = -MU_EARTH / (r2 * rm);
  const f = 1.5 * J2 * (R_EQ * R_EQ) / r2;
  const zr2 = (z * z) / r2;
  const cxy = 1 + f * (1 - 5 * zr2);
  const cz = 1 + f * (3 - 5 * zr2);
  return [k * x * cxy, k * y * cxy, k * z * cz];
}

/** Geodetic (lat, lon in rad, h in m) → Earth-fixed Cartesian [m]. */
export function geodeticToECEF(lat: number, lon: number, h: number): Vec3 {
  const s = Math.sin(lat);
  const N = R_EQ / Math.sqrt(1 - E2 * s * s);
  return [
    (N + h) * Math.cos(lat) * Math.cos(lon),
    (N + h) * Math.cos(lat) * Math.sin(lon),
    (N * (1 - E2) + h) * s,
  ];
}

/** Earth-fixed Cartesian → geodetic. Fixed-point iteration, converges to mm in ~5 passes. */
export function ecefToGeodetic(r: Vec3): { lat: number; lon: number; h: number } {
  const [x, y, z] = r;
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x);
  let lat = Math.atan2(z, p * (1 - E2));
  let h = 0;
  for (let i = 0; i < 6; i++) {
    const s = Math.sin(lat);
    const N = R_EQ / Math.sqrt(1 - E2 * s * s);
    const c = Math.cos(lat);
    h = Math.abs(c) > 1e-9 ? p / c - N : Math.abs(z) - N * (1 - E2);
    lat = Math.atan2(z, p * (1 - (E2 * N) / (N + h)));
  }
  return { lat, lon, h };
}

/** Inertial position → Earth-fixed, given Earth rotation angle θ = ω·t. */
export const eciToEcef = (r: Vec3, theta: number): Vec3 => {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [c * r[0] + s * r[1], -s * r[0] + c * r[1], r[2]];
};

export const OMEGA_VEC: Vec3 = [0, 0, OMEGA_EARTH];

/** Velocity relative to the co-rotating atmosphere: v_rel = v − ω × r. */
export const airRelativeVelocity = (r: Vec3, v: Vec3): Vec3 => sub(v, cross(OMEGA_VEC, r));

/** Local geocentric up / east / north unit vectors at position r. */
export function localFrame(r: Vec3): { up: Vec3; east: Vec3; north: Vec3 } {
  const up = unit(r);
  let east = cross([0, 0, 1], up);
  if (norm(east) < 1e-9) east = [0, 1, 0];
  east = unit(east);
  const north = cross(up, east);
  return { up, east, north };
}

/** Great-circle distance between two Earth-fixed points on the mean sphere [m]. */
export function greatCircle(a: Vec3, b: Vec3): number {
  const c = dot(unit(a), unit(b));
  return Math.acos(Math.max(-1, Math.min(1, c))) * 6371008.8;
}

/** Local gravity magnitude at radius r (spherical part) [m/s²]. */
export const gravityMagnitude = (r: Vec3): number => norm(gravityJ2(r));

export const scaleToKm = (r: Vec3): Vec3 => scale(r, 1e-3);
