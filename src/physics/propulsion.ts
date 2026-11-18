import { G0, P0 } from './constants';

/**
 * Rocket engine performance from first principles.
 *
 * Thrust equation:   F = ṁ·v_e + (p_e − p_a)·A_e
 * Rewritten around the vacuum point (p_a = 0):
 *                    F(p_a) = F_vac − p_a·A_e
 * Mass flow is set by the chamber (choked throat), independent of p_a:
 *                    ṁ = F_vac / (Isp_vac · g0)
 * So sea-level Isp is *derived*, not an independent input:
 *                    Isp(p_a) = F(p_a) / (ṁ · g0)
 */
export interface EngineSpec {
  name: string;
  /** Vacuum thrust per engine [N] */
  thrustVac: number;
  /** Vacuum specific impulse [s] */
  ispVac: number;
  /** Nozzle exit area per engine [m²] */
  exitArea: number;
  /** Number of engines on the stage */
  count: number;
  /** Minimum throttle setting, 0–1 (1 = no throttling, e.g. solid motor) */
  throttleMin: number;
  /** Chamber pressure [bar] — informational, shown in the cycle explainer */
  chamberPressure: number;
  /** Nozzle area ratio A_e/A_t — informational */
  expansionRatio: number;
  /** Power cycle, e.g. "gas generator" */
  cycle: string;
}

export const massFlow = (e: EngineSpec, throttle = 1): number =>
  ((e.thrustVac / (e.ispVac * G0)) * e.count) * throttle;

/** Total stage thrust at ambient pressure pa [N]. Never negative (flow separation floor). */
export const thrustAt = (e: EngineSpec, pa: number, throttle = 1): number =>
  Math.max(0, (e.thrustVac * throttle - pa * e.exitArea) * e.count);

export const ispAt = (e: EngineSpec, pa: number): number => {
  const mdot1 = e.thrustVac / (e.ispVac * G0);
  return Math.max(0, e.thrustVac - pa * e.exitArea) / (mdot1 * G0);
};

export const seaLevelThrust = (e: EngineSpec): number => thrustAt(e, P0);
export const exhaustVelocity = (ispSeconds: number): number => ispSeconds * G0;

export type PropellantKind = 'RP-1 / LOX' | 'LH2 / LOX' | 'CH4 / LOX' | 'Solid (HTPB/AP)' | 'Hypergolic (MMH/NTO)';

/** Bulk densities [kg/m³] at storage conditions, and typical O/F mass ratio. */
export const PROPELLANTS: Record<PropellantKind, { fuel: number; ox: number; of: number; note: string }> = {
  'RP-1 / LOX': {
    fuel: 820,
    ox: 1141,
    of: 2.56,
    note: 'Dense and cheap. Soot ("coking") limits reuse and chamber pressure in some cycles.',
  },
  'LH2 / LOX': {
    fuel: 70.85,
    ox: 1141,
    of: 5.5,
    note: 'Highest Isp of practical bipropellants, but hydrogen is 1/14 the density of water: huge tanks.',
  },
  'CH4 / LOX': {
    fuel: 422.6,
    ox: 1141,
    of: 3.6,
    note: 'Clean-burning, good for reuse; both liquids store at similar cryogenic temperatures.',
  },
  'Solid (HTPB/AP)': {
    fuel: 1800,
    ox: 1800,
    of: 0,
    note: 'Fuel and oxidiser premixed in a rubbery grain. Very high thrust; cannot be shut down or throttled in flight.',
  },
  'Hypergolic (MMH/NTO)': {
    fuel: 880,
    ox: 1440,
    of: 1.65,
    note: 'Ignites on contact and stores at room temperature. Toxic and carcinogenic.',
  },
};

/** Tank volumes [m³] for a given propellant load. Solids report grain volume as "fuel". */
export function tankVolumes(kind: PropellantKind, propMass: number, ofOverride?: number) {
  const p = PROPELLANTS[kind];
  const of = ofOverride ?? p.of;
  if (of === 0) return { fuel: propMass / p.fuel, ox: 0, total: propMass / p.fuel, bulkDensity: p.fuel };
  const fuelMass = propMass / (1 + of);
  const oxMass = propMass - fuelMass;
  const fuel = fuelMass / p.fuel;
  const ox = oxMass / p.ox;
  return { fuel, ox, total: fuel + ox, bulkDensity: propMass / (fuel + ox) };
}

/** Tsiolkovsky: Δv = Isp·g0·ln(m0/mf). */
export const idealDeltaV = (isp: number, m0: number, mf: number): number => isp * G0 * Math.log(m0 / mf);
