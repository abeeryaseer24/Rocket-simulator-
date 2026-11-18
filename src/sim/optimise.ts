import { simulate, type FlightResult } from './simulate';
import { cloneVehicle, type Vehicle } from './vehicle';

/**
 * Ascent trajectory optimisation by Nelder–Mead simplex search.
 *
 * Decision variables are the open-loop part of the ascent that closed-loop
 * guidance cannot fix later: vertical-rise time, pitch-kick angle and
 * pitch-kick duration. The objective is lexicographic, reaching orbit first,
 * then propellant left at cutoff, so the search climbs toward feasibility
 * and then maximises margin. Nelder–Mead needs no gradients, which suits an
 * objective that comes out of a full simulation with discrete staging events.
 */

export interface OptVar {
  key: 'verticalRiseTime' | 'pitchKickAngle' | 'pitchKickDuration';
  label: string;
  unit: string;
  lo: number;
  hi: number;
  /** Initial simplex step */
  step: number;
}

export const OPT_VARS: OptVar[] = [
  { key: 'verticalRiseTime', label: 'Vertical rise', unit: 's', lo: 4, hi: 40, step: 3 },
  { key: 'pitchKickAngle', label: 'Pitch kick', unit: '°', lo: 0.2, hi: 20, step: 0.8 },
  { key: 'pitchKickDuration', label: 'Kick duration', unit: 's', lo: 2, hi: 30, step: 3 },
];

export interface OptStep {
  iter: number;
  evals: number;
  x: number[];
  score: number;
  margin: number;
  outcome: FlightResult['outcome'];
  peri: number;
}

export function objective(r: FlightResult): number {
  const peri = r.final?.peri ?? -6.4e6;
  if (r.outcome === 'orbit') return 1e7 + r.margin;
  if (r.outcome === 'low-orbit') return 5e6 + peri;
  return Math.max(peri, -6.4e6);
}

export function applyVars(v: Vehicle, x: number[]): Vehicle {
  const c = cloneVehicle(v);
  OPT_VARS.forEach((ov, i) => (c.guidance[ov.key] = Math.min(ov.hi, Math.max(ov.lo, x[i]))));
  return c;
}

export function optimiseAscent(v: Vehicle, onStep: (s: OptStep) => void, maxIter = 60, shouldStop: () => boolean = () => false) {
  let evals = 0;
  const cache = new Map<string, { s: number; r: FlightResult }>();
  const f = (x: number[]) => {
    const k = x.map((n) => n.toFixed(3)).join(',');
    const hit = cache.get(k);
    if (hit) return hit;
    evals++;
    const r = simulate(applyVars(v, x), { dt: 0.05, coastAfterCutoff: 1 });
    const out = { s: objective(r), r };
    cache.set(k, out);
    return out;
  };
  const n = OPT_VARS.length;
  const clamp = (x: number[]) => x.map((xi, i) => Math.min(OPT_VARS[i].hi, Math.max(OPT_VARS[i].lo, xi)));
  const x0 = OPT_VARS.map((ov) => v.guidance[ov.key]);
  let simplex = [x0, ...OPT_VARS.map((ov, i) => clamp(x0.map((xi, j) => (j === i ? xi + ov.step : xi))))];
  let vals = simplex.map((x) => f(x).s);
  // Maximise: sort descending
  const order = () => {
    const idx = vals.map((_, i) => i).sort((a, b) => vals[b] - vals[a]);
    simplex = idx.map((i) => simplex[i]);
    vals = idx.map((i) => vals[i]);
  };
  for (let iter = 0; iter < maxIter && !shouldStop(); iter++) {
    order();
    const best = f(simplex[0]).r;
    onStep({ iter, evals, x: simplex[0], score: vals[0], margin: best.margin, outcome: best.outcome, peri: best.final?.peri ?? NaN });
    const spread = Math.max(...simplex.slice(1).map((x) => Math.max(...x.map((xi, i) => Math.abs(xi - simplex[0][i]) / OPT_VARS[i].step))));
    if (spread < 0.005) break;
    const c = simplex.slice(0, n).reduce((a, x) => a.map((ai, i) => ai + x[i] / n), new Array(n).fill(0));
    const worst = simplex[n];
    const xr = clamp(c.map((ci, i) => ci + (ci - worst[i])));
    const fr = f(xr).s;
    if (fr > vals[0]) {
      const xe = clamp(c.map((ci, i) => ci + 2 * (ci - worst[i])));
      const fe = f(xe).s;
      [simplex[n], vals[n]] = fe > fr ? [xe, fe] : [xr, fr];
    } else if (fr > vals[n - 1]) {
      [simplex[n], vals[n]] = [xr, fr];
    } else {
      const xc = clamp(c.map((ci, i) => ci + 0.5 * (worst[i] - ci)));
      const fc = f(xc).s;
      if (fc > vals[n]) [simplex[n], vals[n]] = [xc, fc];
      else {
        simplex = simplex.map((x, k) => (k === 0 ? x : clamp(x.map((xi, i) => simplex[0][i] + 0.5 * (xi - simplex[0][i])))));
        vals = simplex.map((x) => f(x).s);
      }
    }
  }
  order();
  return { x: simplex[0], result: f(simplex[0]).r, evals };
}
