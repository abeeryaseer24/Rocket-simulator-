import { RAD } from '../physics/constants';
import { SITES } from './presets';
import { simulate, type EngineFailure, type FlightResult } from './simulate';
import { cloneVehicle, liftoffMass, type LaunchSite, type Vehicle } from './vehicle';

export interface Check {
  label: string;
  ok: boolean;
  value: string;
}

export interface Mission {
  id: string;
  title: string;
  brief: string;
  /** What the mission imposes on the vehicle before flying */
  site?: LaunchSite;
  targetAltitude: number;
  targetInclination: number;
  failures?: EngineFailure[];
  /** Score: higher is better unless lowerIsBetter */
  scoreLabel: string;
  lowerIsBetter?: boolean;
  evaluate: (v: Vehicle, r: FlightResult) => { checks: Check[]; score: number };
  /** Preset that's a sensible starting point */
  suggested: string;
}

const t = (kg: number) => `${(kg / 1000).toFixed(2)} t`;
const km = (m: number) => `${(m / 1000).toFixed(0)} km`;
const stable = (r: FlightResult): Check => ({
  label: 'Stable orbit (periapsis above 150 km)',
  ok: r.outcome === 'orbit',
  value: r.final ? `${km(r.final.peri)} × ${r.final.apo === Infinity ? '∞' : km(r.final.apo)}` : 'no orbit',
});
const nearAlt = (r: FlightResult, target: number, tol = 0.15): Check => {
  const mean = r.final ? (r.final.peri + Math.min(r.final.apo, 1e8)) / 2 : NaN;
  return {
    label: `Mean altitude within ${tol * 100} % of ${km(target)}`,
    ok: Number.isFinite(mean) && Math.abs(mean - target) / target <= tol,
    value: Number.isFinite(mean) ? km(mean) : 'n/a',
  };
};
const incl = (r: FlightResult, target: number, tol = 0.5): Check => {
  const i = r.final ? r.final.i * RAD : NaN;
  return { label: `Inclination within ${tol}° of ${target}°`, ok: Math.abs(i - target) <= tol, value: Number.isFinite(i) ? `${i.toFixed(2)}°` : 'n/a' };
};
const minPayload = (v: Vehicle, kg: number): Check => ({ label: `Payload at least ${t(kg)}`, ok: v.payloadMass >= kg, value: t(v.payloadMass) });

export const MISSIONS: Mission[] = [
  {
    id: 'first-orbit',
    title: 'First orbit',
    brief: 'Get anything into a stable orbit around 300 km. Score is the propellant you have left: proof the design has margin.',
    targetAltitude: 300e3,
    targetInclination: 51.6,
    site: SITES.cape,
    scoreLabel: 'Propellant margin',
    suggested: 'medium-kerolox',
    evaluate: (_v, r) => ({ checks: [stable(r), nearAlt(r, 300e3)], score: r.margin }),
  },
  {
    id: 'station-resupply',
    title: 'Station resupply',
    brief: 'Deliver at least 12 t of cargo to the space station’s orbit: about 410 km at 51.6°. Score is cargo mass.',
    targetAltitude: 410e3,
    targetInclination: 51.6,
    site: SITES.cape,
    scoreLabel: 'Cargo delivered',
    suggested: 'medium-kerolox',
    evaluate: (v, r) => ({ checks: [stable(r), nearAlt(r, 410e3, 0.1), incl(r, 51.6), minPayload(v, 12000)], score: r.outcome === 'orbit' ? v.payloadMass : 0 }),
  },
  {
    id: 'smallest',
    title: 'Smallest rocket to orbit',
    brief: 'Put a 100 kg cubesat stack into a 250 km orbit with the lightest vehicle you can design. Score is liftoff mass; lower wins.',
    targetAltitude: 250e3,
    targetInclination: 45,
    site: SITES.mahia,
    scoreLabel: 'Liftoff mass',
    lowerIsBetter: true,
    suggested: 'small-electric',
    evaluate: (v, r) => ({ checks: [stable(r), minPayload(v, 100)], score: r.outcome === 'orbit' && v.payloadMass >= 100 ? liftoffMass(v) : Infinity }),
  },
  {
    id: 'gentle',
    title: 'Gentle ride',
    brief: 'A crew is aboard. Reach 300 km without exceeding 3.5 g or 25 kPa of dynamic pressure. Tune the throttle bucket and acceleration limit.',
    targetAltitude: 300e3,
    targetInclination: 51.6,
    site: SITES.cape,
    scoreLabel: 'Peak acceleration',
    lowerIsBetter: true,
    suggested: 'medium-kerolox',
    evaluate: (_v, r) => ({
      checks: [
        stable(r),
        { label: 'Peak acceleration at most 3.5 g', ok: r.maxG.g <= 3.5, value: `${r.maxG.g.toFixed(2)} g` },
        { label: 'Max-Q at most 25 kPa', ok: r.maxQ.q <= 25000, value: `${(r.maxQ.q / 1000).toFixed(1)} kPa` },
      ],
      score: r.outcome === 'orbit' ? r.maxG.g : Infinity,
    }),
  },
  {
    id: 'equatorial',
    title: 'Equatorial express',
    brief: 'From Kourou, deliver at least 15 t into an orbit inclined no more than 6°, the start of a trip to geostationary orbit.',
    targetAltitude: 260e3,
    targetInclination: 5.3,
    site: SITES.kourou,
    scoreLabel: 'Payload',
    suggested: 'hydrolox-solid',
    evaluate: (v, r) => ({
      checks: [stable(r), { label: 'Inclination at most 6°', ok: !!r.final && r.final.i * RAD <= 6, value: r.final ? `${(r.final.i * RAD).toFixed(2)}°` : 'n/a' }, minPayload(v, 15000)],
      score: r.outcome === 'orbit' ? v.payloadMass : 0,
    }),
  },
  {
    id: 'engine-out',
    title: 'Engine out',
    brief: 'One first-stage engine shuts down 30 seconds after liftoff. Your vehicle must still reach a stable orbit at 300 km. Real vehicles are designed for exactly this.',
    targetAltitude: 300e3,
    targetInclination: 51.6,
    site: SITES.cape,
    failures: [{ t: 30 }],
    scoreLabel: 'Propellant margin',
    suggested: 'medium-kerolox',
    evaluate: (_v, r) => ({
      checks: [stable(r), { label: 'Engine failure occurred', ok: r.events.some((e) => e.kind === 'engine-out'), value: r.events.some((e) => e.kind === 'engine-out') ? 'T+30 s' : 'single-engine stage cannot lose one' }],
      score: r.outcome === 'orbit' ? r.margin : 0,
    }),
  },
  {
    id: 'polar',
    title: 'Polar observer',
    brief: 'Launch an Earth-observation satellite of at least 5 t from Vandenberg into a 600 km orbit at 97.8°, the sun-synchronous inclination for that altitude.',
    targetAltitude: 600e3,
    targetInclination: 97.8,
    site: SITES.vandenberg,
    scoreLabel: 'Payload',
    suggested: 'medium-kerolox',
    evaluate: (v, r) => ({ checks: [stable(r), nearAlt(r, 600e3, 0.1), incl(r, 97.8, 0.6), minPayload(v, 5000)], score: r.outcome === 'orbit' ? v.payloadMass : 0 }),
  },
  {
    id: 'heavy',
    title: 'Heavy lifter',
    brief: 'Put at least 50 t into a 200 km parking orbit. You’ll probably need boosters, a bigger core, or both.',
    targetAltitude: 200e3,
    targetInclination: 28.6,
    site: SITES.cape,
    scoreLabel: 'Payload',
    suggested: 'heavy-tri-core',
    evaluate: (v, r) => ({ checks: [stable(r), minPayload(v, 50000)], score: r.outcome === 'orbit' ? v.payloadMass : 0 }),
  },
];

/** Write the mission's site and target into the vehicle (so Flight shows the same trajectory). */
export function applyMission(v: Vehicle, m: Mission): Vehicle {
  const c = cloneVehicle(v);
  if (m.site) c.site = { ...m.site };
  c.guidance.targetAltitude = m.targetAltitude;
  c.guidance.targetInclination = m.targetInclination;
  return c;
}

export function runMission(v: Vehicle, m: Mission) {
  const flown = applyMission(v, m);
  const r = simulate(flown, { failures: m.failures });
  const { checks, score } = m.evaluate(flown, r);
  return { vehicle: flown, result: r, checks, passed: checks.every((c) => c.ok), score };
}

export const formatScore = (m: Mission, s: number) =>
  !Number.isFinite(s) ? 'n/a' : m.scoreLabel === 'Peak acceleration' ? `${s.toFixed(2)} g` : `${(s / 1000).toFixed(2)} t`;

const KEY = 'ascent.missions.v1';
export type Bests = Record<string, { score: number; at: string; vehicle: string }>;
export const loadBests = (): Bests => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Bests;
  } catch {
    return {};
  }
};
export const saveBests = (b: Bests) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* storage unavailable */
  }
};
export const isBetter = (m: Mission, a: number, b: number | undefined) =>
  b === undefined || !Number.isFinite(b) ? Number.isFinite(a) : m.lowerIsBetter ? a < b : a > b;
