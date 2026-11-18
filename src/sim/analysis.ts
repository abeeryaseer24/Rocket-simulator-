import { simulate, type Outcome } from './simulate';
import { cloneVehicle, type Vehicle } from './vehicle';

/** Deterministic PRNG (mulberry32) so a dispersion run can be reproduced from its seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** Standard normal via Box–Muller */
  const normal = () => {
    let u = 0;
    while (u === 0) u = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return { next, normal };
}

/** 1-σ dispersions, as fractions unless noted. Typical of pre-flight dispersion analyses. */
export interface Dispersions {
  thrust: number;
  isp: number;
  dryMass: number;
  propLoad: number;
  cd: number;
  /** degrees */
  pitchKick: number;
}

export const DEFAULT_DISPERSIONS: Dispersions = {
  thrust: 0.01,
  isp: 0.003,
  dryMass: 0.015,
  propLoad: 0.004,
  cd: 0.08,
  pitchKick: 0.15,
};

export interface McRun {
  outcome: Outcome;
  peri: number;
  apo: number;
  inc: number;
  margin: number;
  maxQ: number;
}

/** Apply one random draw. Each stage gets independent engine and structure errors. */
export function perturb(v: Vehicle, d: Dispersions, r: ReturnType<typeof rng>): Vehicle {
  const c = cloneVehicle(v);
  const bodies = [...c.stages, ...(c.boosters.count > 0 ? [c.boosters.stage] : [])];
  for (const s of bodies) {
    s.engine.thrustVac *= 1 + d.thrust * r.normal();
    s.engine.ispVac *= 1 + d.isp * r.normal();
    s.dryMass *= 1 + d.dryMass * r.normal();
    s.propMass *= 1 + d.propLoad * r.normal();
  }
  const cdScale = 1 + d.cd * r.normal();
  c.cd = c.cd.map(([m, cd]) => [m, cd * cdScale]);
  c.guidance.pitchKickAngle = Math.max(0.1, c.guidance.pitchKickAngle + d.pitchKick * r.normal());
  return c;
}

export function monteCarloRun(v: Vehicle, d: Dispersions, seed: number, i: number): McRun {
  const r = rng(seed * 1000003 + i);
  const res = simulate(perturb(v, d, r), { dt: 0.05, coastAfterCutoff: 1 });
  return {
    outcome: res.outcome,
    peri: res.final?.peri ?? NaN,
    apo: res.final?.apo ?? NaN,
    inc: res.final ? (res.final.i * 180) / Math.PI : NaN,
    margin: res.margin,
    maxQ: res.maxQ.q,
  };
}

/** Largest payload [kg] that still reaches a stable orbit at this altitude, by bisection. */
export function maxPayload(v: Vehicle, altitude: number, iters = 13): number {
  const reaches = (pl: number) => {
    const c = cloneVehicle(v);
    c.payloadMass = pl;
    c.guidance.targetAltitude = altitude;
    return simulate(c, { dt: 0.05, coastAfterCutoff: 1 }).outcome === 'orbit';
  };
  let lo = 0;
  let hi = Math.max(v.payloadMass * 2.5, 1000);
  if (!reaches(lo)) return 0;
  while (reaches(hi) && hi < 1e7) {
    lo = hi;
    hi *= 2;
  }
  for (let k = 0; k < iters; k++) {
    const mid = (lo + hi) / 2;
    if (reaches(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export const stats = (xs: number[]) => {
  const v = xs.filter(Number.isFinite);
  const n = v.length;
  if (!n) return { n, mean: NaN, sd: NaN, min: NaN, max: NaN };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(n - 1, 1));
  return { n, mean, sd, min: Math.min(...v), max: Math.max(...v) };
};
