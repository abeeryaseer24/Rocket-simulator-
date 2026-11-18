/**
 * Physical constants. Sources: WGS-84 (NIMA TR8350.2), US Standard
 * Atmosphere 1976 (NOAA-S/T 76-1562), CODATA.
 */

/** Standard gravity [m/s²]. Defines the Isp ↔ exhaust-velocity conversion. */
export const G0 = 9.80665;

/** Earth gravitational parameter μ = GM [m³/s²] (WGS-84). */
export const MU_EARTH = 3.986004418e14;

/** WGS-84 equatorial radius [m]. */
export const R_EQ = 6378137.0;

/** WGS-84 flattening. */
export const FLATTENING = 1 / 298.257223563;

/** First eccentricity squared of the reference ellipsoid. */
export const E2 = FLATTENING * (2 - FLATTENING);

/** Earth rotation rate [rad/s] (sidereal). */
export const OMEGA_EARTH = 7.2921159e-5;

/** Second zonal harmonic — the dominant oblateness term. */
export const J2 = 1.08262668e-3;

/** Sea-level standard pressure [Pa]. */
export const P0 = 101325;

/** Specific gas constant for dry air [J/(kg·K)]. */
export const R_AIR = 287.053;

/** Ratio of specific heats for air (diatomic, ~ constant below 86 km). */
export const GAMMA_AIR = 1.4;

/** Effective radius used for geopotential altitude in US76 [m]. */
export const R_GEOPOTENTIAL = 6356766;

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
