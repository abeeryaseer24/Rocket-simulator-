/**
 * Hot-bridgewire initiator and its firing circuit.
 *
 * The bridgewire is a lumped thermal mass heated by I²R and losing heat to
 * the surrounding charge through a thermal resistance:
 *
 *   C_th dT/dt = I² R_b − (T − T₀) / R_th
 *
 * It fires when T reaches the ignition temperature of the primer. Parameters
 * are calibrated so the model honours the published NASA Standard Initiator
 * (NSI) acceptance points: 1.0 Ω ± 0.1 bridgewire, NO-FIRE at 1 A / 1 W for
 * 5 minutes, ALL-FIRE at 3.5 A. This is a teaching model, not a qualification
 * thermal model.
 */

export interface InitiatorSpec {
  rBridge: number;
  /** Thermal resistance to surroundings [K/W] */
  rth: number;
  /** Thermal capacitance [J/K] */
  cth: number;
  /** Temperature rise needed to ignite [K] */
  dtIgnite: number;
}

export const NSI: InitiatorSpec = { rBridge: 1.05, rth: 200, cth: 5e-5, dtIgnite: 300 };

export interface CircuitSpec {
  mode: 'cdu' | 'battery';
  /** CDU capacitor [F] and charge voltage [V], or battery voltage */
  capacitance: number;
  voltage: number;
  /** Harness round-trip resistance [Ω] */
  harness: number;
  /** Firing switch on-resistance (MOSFET) [Ω] */
  switchR: number;
  /** Battery-mode current limit [A] */
  currentLimit: number;
  /** Fire-pulse duration [s] */
  pulse: number;
}

export const DEFAULT_CIRCUIT: CircuitSpec = {
  mode: 'cdu',
  capacitance: 2200e-6,
  voltage: 28,
  harness: 0.6,
  switchR: 0.05,
  currentLimit: 5,
  pulse: 0.02,
};

export interface FirePoint {
  t: number;
  i: number;
  dT: number;
}

export interface FireResult {
  points: FirePoint[];
  fired: boolean;
  fireTime: number;
  peakI: number;
  energyToBridge: number;
}

/** Steady temperature rise at a constant current — what the no-fire test checks. */
export const steadyRise = (n: InitiatorSpec, i: number) => i * i * n.rBridge * n.rth;

export function fire(n: InitiatorSpec, c: CircuitSpec, tEnd = 0.03): FireResult {
  const dt = 2e-6;
  const rTot = n.rBridge + c.harness + c.switchR;
  let vc = c.voltage;
  let dT = 0;
  let fired = false;
  let fireTime = NaN;
  let peakI = 0;
  let energy = 0;
  const pts: FirePoint[] = [];
  for (let k = 0, t = 0; t <= tEnd; k++, t = k * dt) {
    let i = 0;
    if (t < c.pulse && !fired) {
      if (c.mode === 'cdu') {
        i = vc / rTot;
        vc -= (i / c.capacitance) * dt;
      } else i = Math.min(c.voltage / rTot, c.currentLimit);
    }
    peakI = Math.max(peakI, i);
    const pw = i * i * n.rBridge;
    energy += pw * dt;
    dT += ((pw - dT / n.rth) / n.cth) * dt;
    if (!fired && dT >= n.dtIgnite) {
      fired = true;
      fireTime = t;
    }
    if (k % 25 === 0) pts.push({ t, i, dT });
  }
  return { points: pts, fired, fireTime, peakI, energyToBridge: energy };
}

/** Time to fire at a constant current (∞ if the steady rise never reaches ignition). */
export function timeToFire(n: InitiatorSpec, i: number): number {
  const ss = steadyRise(n, i);
  if (ss <= n.dtIgnite) return Infinity;
  return -n.rth * n.cth * Math.log(1 - n.dtIgnite / ss);
}
