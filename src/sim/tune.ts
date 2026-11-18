import { simulate, type FlightResult } from './simulate';
import { cloneVehicle, type Vehicle } from './vehicle';

/**
 * Trajectory shaping by search. The pitch-kick angle is the single biggest
 * open-loop decision in a gravity-turn ascent:
 *   too small → the vehicle climbs nearly vertically, pays gravity loss, and
 *               the upper stage must burn hard downward-ish to fix it;
 *   too large → it turns over early, flies flat through thick air (drag,
 *               heating, high q·α) or never leaves the atmosphere.
 * We score each candidate by orbit quality first, then by propellant left
 * at cutoff (the performance margin), and refine around the best.
 */
export interface TuneResult {
  kick: number;
  result: FlightResult;
  sweep: Array<{ kick: number; score: number; outcome: FlightResult['outcome']; margin: number; peri: number }>;
}

const score = (r: FlightResult) => {
  const peri = r.final?.peri ?? -6.4e6;
  if (r.outcome === 'orbit') return 1e7 + r.margin;
  if (r.outcome === 'low-orbit') return 5e6 + peri;
  return Math.max(peri, -6.4e6);
};

export function tunePitchKick(v: Vehicle, lo = 0.3, hi = 22, coarseStep = 0.6): TuneResult {
  const run = (kick: number) => {
    const c = cloneVehicle(v);
    c.guidance.pitchKickAngle = kick;
    return simulate(c, { dt: 0.05, coastAfterCutoff: 1 });
  };
  const sweep: TuneResult['sweep'] = [];
  let best = { kick: v.guidance.pitchKickAngle, s: -Infinity };
  const consider = (kick: number) => {
    const r = run(kick);
    const s = score(r);
    sweep.push({ kick, score: s, outcome: r.outcome, margin: r.margin, peri: r.final?.peri ?? NaN });
    if (s > best.s) best = { kick, s };
  };
  for (let kk = lo; kk <= hi + 1e-9; kk += coarseStep) consider(+kk.toFixed(2));
  const c = best.kick;
  for (let kk = c - coarseStep; kk <= c + coarseStep + 1e-9; kk += coarseStep / 5) if (kk > 0) consider(+kk.toFixed(2));
  sweep.sort((a, b) => a.kick - b.kick);
  const final = cloneVehicle(v);
  final.guidance.pitchKickAngle = best.kick;
  return { kick: best.kick, result: simulate(final), sweep };
}
