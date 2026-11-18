import type { FlightEvent, Sample } from '../sim/simulate';

/**
 * Electrical power system: a battery pack feeding the avionics bus.
 *
 * Each cell is the standard first-order Thevenin equivalent circuit used in
 * battery-management firmware:
 *
 *   V_term = OCV(SOC) − I·R0 − V1          (R0: ohmic, V1: polarisation)
 *   dV1/dt = −V1 / (R1·C1) + I / C1
 *   dSOC/dt = −I / (3600 · Q)
 *
 * Loads are constant-power (DC/DC converters regulate their outputs), so the
 * pack current rises as the terminal voltage sags: I = P / V_term, solved by
 * fixed-point iteration each step. Joule heat I²R0 + V1²/R1 warms the pack's
 * thermal mass (adiabatic: a sealed avionics bay sheds almost nothing in ten
 * minutes).
 */

export interface CellSpec {
  id: string;
  name: string;
  chemistry: string;
  /** Rated capacity [Ah] */
  capacity: number;
  vMax: number;
  vNom: number;
  /** Discharge cut-off [V] */
  vMin: number;
  /** Ohmic resistance [Ω] */
  r0: number;
  /** Polarisation branch */
  r1: number;
  c1: number;
  /** Cell mass [kg] */
  mass: number;
  /** Max continuous discharge [A] */
  iMax: number;
  /** Open-circuit voltage at SOC = 0, 0.1 … 1.0 */
  ocv: number[];
}

/**
 * Typical datasheet-class values for common commercial formats. They are
 * representative of the format, not any one manufacturer's part.
 */
export const CELLS: CellSpec[] = [
  {
    id: 'nmc-18650',
    name: '18650 NMC, high-energy',
    chemistry: 'Li-ion (LiNiMnCoO₂)',
    capacity: 3.0,
    vMax: 4.2,
    vNom: 3.6,
    vMin: 2.5,
    r0: 0.025,
    r1: 0.015,
    c1: 2000,
    mass: 0.047,
    iMax: 15,
    ocv: [3.0, 3.45, 3.55, 3.62, 3.67, 3.72, 3.8, 3.88, 3.97, 4.07, 4.2],
  },
  {
    id: 'lfp-26650',
    name: '26650 LFP, power',
    chemistry: 'Li-ion (LiFePO₄)',
    capacity: 2.5,
    vMax: 3.6,
    vNom: 3.2,
    vMin: 2.0,
    r0: 0.008,
    r1: 0.006,
    c1: 4000,
    mass: 0.076,
    iMax: 50,
    ocv: [2.5, 3.15, 3.22, 3.26, 3.28, 3.29, 3.3, 3.31, 3.33, 3.36, 3.6],
  },
  {
    id: 'nmc-21700',
    name: '21700 NMC, high-power',
    chemistry: 'Li-ion (LiNiMnCoO₂)',
    capacity: 4.0,
    vMax: 4.2,
    vNom: 3.6,
    vMin: 2.5,
    r0: 0.016,
    r1: 0.01,
    c1: 3000,
    mass: 0.069,
    iMax: 35,
    ocv: [3.0, 3.45, 3.55, 3.62, 3.67, 3.72, 3.8, 3.88, 3.97, 4.07, 4.2],
  },
];

export function ocv(cell: CellSpec, soc: number): number {
  const s = Math.max(0, Math.min(1, soc)) * 10;
  const i = Math.min(9, Math.floor(s));
  return cell.ocv[i] + (cell.ocv[i + 1] - cell.ocv[i]) * (s - i);
}

export interface PackSpec {
  cell: CellSpec;
  series: number;
  parallel: number;
  /** Initial state of charge 0–1 */
  soc0: number;
  /** Harness + connector resistance to the bus [Ω] */
  harness: number;
}

export type LoadMode = 'always' | 'burning' | 'pulse';

export interface Load {
  name: string;
  /** Bus power [W] (pulse: power during the pulse) */
  watts: number;
  mode: LoadMode;
  /** Pulse loads fire on these events */
  on?: FlightEvent['kind'][];
  /** Pulse length [s] */
  pulse?: number;
  enabled: boolean;
}

/** A representative launcher avionics load list (upper-stage + first-stage avionics bay). */
export const DEFAULT_LOADS: Load[] = [
  { name: 'Flight computers (×3, voting)', watts: 45, mode: 'always', enabled: true },
  { name: 'Inertial measurement unit', watts: 22, mode: 'always', enabled: true },
  { name: 'GNSS receiver', watts: 6, mode: 'always', enabled: true },
  { name: 'S-band transmitter (10 W RF)', watts: 42, mode: 'always', enabled: true },
  { name: 'Telemetry encoder + data bus', watts: 12, mode: 'always', enabled: true },
  { name: 'Sensor signal conditioning', watts: 18, mode: 'always', enabled: true },
  { name: 'Heaters (lines, valves)', watts: 60, mode: 'always', enabled: true },
  { name: 'Engine valve drivers + igniters', watts: 90, mode: 'burning', enabled: true },
  { name: 'Pressurisation solenoids', watts: 35, mode: 'burning', enabled: true },
  { name: 'Pyro firing (initiator pairs)', watts: 400, mode: 'pulse', on: ['booster-sep', 'stage-sep', 'fairing-sep'], pulse: 0.05, enabled: true },
  { name: 'Cold-gas RCS valves', watts: 120, mode: 'pulse', on: ['stage-sep', 'seco'], pulse: 3, enabled: true },
];

export interface PowerPoint {
  t: number;
  v: number;
  i: number;
  p: number;
  soc: number;
  temp: number;
}

export interface PowerResult {
  points: PowerPoint[];
  minV: number;
  minVt: number;
  peakI: number;
  energyWh: number;
  finalSoc: number;
  maxTemp: number;
  /** Time the bus fell below the brown-out limit, if it did */
  brownout: number | null;
  packMass: number;
  busNominal: number;
}

/** Burning flag from the flight, sampled at t. */
function burningAt(samples: Sample[], t: number): boolean {
  if (t < 0 || !samples.length) return false;
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (samples[m].t <= t) lo = m;
    else hi = m;
  }
  return samples[lo].burning;
}

export function busLoad(loads: Load[], events: FlightEvent[], samples: Sample[], t: number): number {
  const burning = burningAt(samples, t);
  let p = 0;
  for (const l of loads) {
    if (!l.enabled) continue;
    if (l.mode === 'always') p += l.watts;
    else if (l.mode === 'burning') p += burning ? l.watts : 0;
    else if (events.some((e) => l.on?.includes(e.kind) && t >= e.t && t < e.t + (l.pulse ?? 0.05))) p += l.watts;
  }
  return p;
}

/**
 * Simulate the pack from internal-power transfer (tStart, negative = before
 * liftoff) to tEnd. Steps finely near pulses so a 50 ms pyro load is resolved.
 */
export function simulatePower(
  pack: PackSpec,
  loads: Load[],
  events: FlightEvent[],
  samples: Sample[],
  opts: { tStart?: number; tEnd: number; brownout: number; heatCapacity?: number },
): PowerResult {
  const { cell, series: S, parallel: P } = pack;
  const Q = cell.capacity * P;
  const R0 = (cell.r0 * S) / P + pack.harness;
  const R1 = (cell.r1 * S) / P;
  const C1 = (cell.c1 * P) / S;
  const mass = cell.mass * S * P;
  const cp = opts.heatCapacity ?? 900; // J/(kg·K), typical for cylindrical Li-ion
  let soc = pack.soc0;
  let v1 = 0;
  let temp = 20;
  let energy = 0;
  let t = opts.tStart ?? -180;
  const out: PowerPoint[] = [];
  let minV = Infinity;
  let minVt = t;
  let peakI = 0;
  let maxTemp = temp;
  let brownout: number | null = null;
  const pulseTimes = events.map((e) => e.t);
  let lastLog = -Infinity;
  while (t <= opts.tEnd) {
    const nearPulse = pulseTimes.some((pt) => t >= pt - 0.01 && t < pt + 3.2);
    const dt = nearPulse ? 0.005 : 0.1;
    const pw = busLoad(loads, events, samples, t);
    const e0 = ocv(cell, soc) * S;
    // Constant-power load: I = P / (E − I·R0 − V1). Fixed-point converges in a few iterations.
    let i = pw / Math.max(e0 - v1, 1e-3);
    for (let k = 0; k < 8; k++) i = pw / Math.max(e0 - v1 - i * R0, 0.2 * e0);
    const v = e0 - v1 - i * R0;
    if (v < minV) {
      minV = v;
      minVt = t;
    }
    if (brownout === null && v < opts.brownout) brownout = t;
    peakI = Math.max(peakI, i);
    energy += pw * dt;
    temp += ((i * i * R0 + (v1 * v1) / R1) * dt) / (mass * cp);
    maxTemp = Math.max(maxTemp, temp);
    v1 += (-v1 / (R1 * C1) + i / C1) * dt;
    soc -= (i * dt) / (3600 * Q);
    if (t - lastLog >= 0.5 || (nearPulse && t - lastLog >= 0.01)) {
      out.push({ t, v, i, p: pw, soc, temp });
      lastLog = t;
    }
    t += dt;
  }
  return {
    points: out,
    minV,
    minVt,
    peakI,
    energyWh: energy / 3600,
    finalSoc: soc,
    maxTemp,
    brownout,
    packMass: mass,
    busNominal: cell.vNom * S,
  };
}
