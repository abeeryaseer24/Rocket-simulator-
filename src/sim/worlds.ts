import { cdAt, DEFAULT_CD } from '../physics/aero';
import { atmosphere } from '../physics/atmosphere';
import { G0 } from '../physics/constants';

/**
 * Ascent from other worlds. A planar (2-D) point-mass simulator in a
 * body-centred inertial frame, generic over the central body: its
 * gravitational parameter, radius, rotation and atmosphere.
 *
 * Guidance is the classic recipe, simple enough to fly by hand:
 *   vertical rise → pitch-over to a kick angle → gravity turn
 *   → cutoff once apoapsis reaches the target → coast
 *   → circularisation burn centred on apoapsis.
 */

export interface AtmoState {
  rho: number;
  p: number;
  a: number;
}

export interface Body {
  id: 'moon' | 'mars' | 'earth';
  name: string;
  /** Gravitational parameter [m³/s²] */
  mu: number;
  /** Mean radius [m] */
  radius: number;
  /** Sidereal rotation period [s] */
  rotation: number;
  /** Lowest periapsis counted as a stable orbit [m above mean radius] */
  minPeri: number;
  minPeriWhy: string;
  atmosphere: ((h: number) => AtmoState) | null;
  atmoNote: string;
  surface: string;
  sky: string;
  /** Default launch site description */
  site: string;
  facts: string[];
}

/**
 * NASA Glenn Research Center "Mars Atmosphere Model, Metric Units", a curve
 * fit to Mars Global Surveyor data:
 *   h > 7000 m: T = −23.4 − 0.00222 h  [°C]
 *   h ≤ 7000 m: T = −31 − 0.000998 h   [°C]
 *   p = 0.699 · exp(−0.00009 h)        [kPa]
 *   ρ = p / (0.1921 · (T + 273.1))     [kg/m³]
 * The fit is meant for the lower atmosphere; temperature is floored at
 * 130 K so it stays physical higher up, where density is negligible anyway.
 */
export function marsAtmosphere(h: number): AtmoState {
  const z = Math.max(0, h);
  const Tc = z > 7000 ? -23.4 - 0.00222 * z : -31 - 0.000998 * z;
  const T = Math.max(Tc + 273.1, 130);
  const pK = 0.699 * Math.exp(-0.00009 * z);
  const rho = pK / (0.1921 * T);
  return { rho, p: pK * 1000, a: Math.sqrt(1.29 * 191.8 * T) };
}

export const BODIES: Body[] = [
  {
    id: 'moon',
    name: 'Moon',
    mu: 4.9048695e12,
    radius: 1737.4e3,
    rotation: 27.321661 * 86400,
    minPeri: 12e3,
    minPeriWhy: 'clears the highest lunar terrain, about 10.8 km above the mean radius',
    atmosphere: null,
    atmoNote: 'None. No drag, no heating, so you can pitch over almost immediately.',
    surface: '#8F8B84',
    sky: '#05070B',
    site: 'Mare Tranquillitatis (Apollo 11 landing site)',
    facts: ['Surface gravity 1.62 m/s², a sixth of Earth’s', 'Low orbit needs only about 1.68 km/s', 'A lunar day lasts 29.5 Earth days'],
  },
  {
    id: 'mars',
    name: 'Mars',
    mu: 4.282837e13,
    radius: 3389.5e3,
    rotation: 88642.66,
    minPeri: 120e3,
    minPeriWhy: 'above the bulk of the thin atmosphere, so drag no longer decays the orbit quickly',
    atmosphere: marsAtmosphere,
    atmoNote: 'Thin CO₂, about 0.6 % of Earth’s surface pressure. It still matters at the speeds an ascent reaches.',
    surface: '#A4532F',
    sky: '#C99A6B',
    site: 'Jezero Crater (Perseverance landing site)',
    facts: ['Surface gravity 3.71 m/s², 38 % of Earth’s', 'Low orbit needs about 3.4 km/s', 'A day (sol) lasts 24 h 39 min'],
  },
  {
    id: 'earth',
    name: 'Earth',
    mu: 3.986004418e14,
    radius: 6371.0e3,
    rotation: 86164.0905,
    minPeri: 150e3,
    minPeriWhy: 'below about 150 km drag brings a satellite down within days',
    atmosphere: (h) => {
      const s = atmosphere(Math.max(0, h));
      return { rho: s.rho, p: s.p, a: s.a };
    },
    atmoNote: 'US Standard Atmosphere 1976. Thick air, so the turn must be gentle and the first stage big.',
    surface: '#2F5B7A',
    sky: '#7FA7C9',
    site: 'An equatorial pad, for comparison',
    facts: ['Surface gravity 9.81 m/s²', 'Low orbit needs about 7.8 km/s', 'The reference point for everything else in Ascent'],
  },
];

export interface WorldStage {
  name: string;
  dry: number;
  prop: number;
  /** Vacuum thrust [N] */
  thrust: number;
  /** Vacuum specific impulse [s] */
  isp: number;
  /** Nozzle exit area [m²] (thrust loss in an atmosphere) */
  exitArea: number;
}

export interface WorldRocket {
  id: string;
  name: string;
  home: Body['id'];
  summary: string;
  stages: WorldStage[];
  payload: number;
  diameter: number;
  /** Default flight plan for its home world */
  plan: FlightPlan;
  basis: string;
}

export interface FlightPlan {
  verticalRise: number;
  /** Pitch-over from vertical [deg] */
  kick: number;
  kickDuration: number;
  /** Target orbit altitude [m] */
  target: number;
  /**
   * After apoapsis reaches the target: keep burning while holding altitude
   * (direct insertion), or cut off and circularise at apoapsis (coast).
   */
  insertion: 'direct' | 'coast';
}

export const WORLD_ROCKETS: WorldRocket[] = [
  {
    id: 'lm-ascent',
    name: 'Lunar module ascent stage',
    home: 'moon',
    summary: 'The Apollo LM’s upper half: one fixed, hypergolic engine and two astronauts, lifting off from the descent stage.',
    stages: [{ name: 'Ascent stage', dry: 2150, prop: 2353, thrust: 15.57e3, isp: 311, exitArea: 0.6 }],
    payload: 0,
    diameter: 4.3,
    plan: { verticalRise: 10, kick: 20, kickDuration: 10, target: 18e3, insertion: 'direct' },
    basis: 'Rounded from public Apollo LM figures: 15.6 kN (3,500 lbf) ascent engine, Isp 311 s, ≈2,350 kg of Aerozine 50 / N₂O₄. Dry mass includes crew and samples.',
  },
  {
    id: 'mav',
    name: 'Mars ascent vehicle',
    home: 'mars',
    summary: 'A small two-stage solid rocket of the kind proposed to lift sample tubes off Mars, in the class of NASA’s sample-return concepts.',
    stages: [
      { name: 'First stage', dry: 45, prop: 215, thrust: 8.5e3, isp: 285, exitArea: 0.05 },
      { name: 'Second stage', dry: 22, prop: 60, thrust: 2.2e3, isp: 292, exitArea: 0.03 },
    ],
    payload: 16,
    diameter: 0.57,
    plan: { verticalRise: 6, kick: 30, kickDuration: 8, target: 300e3, insertion: 'coast' },
    basis: 'Representative of published sample-return concept studies (≈400 kg, two solid stages). Not the figures of any flown or approved vehicle.',
  },
  {
    id: 'small-launcher',
    name: 'Small launcher',
    home: 'earth',
    summary: 'A two-stage, small-satellite kerosene rocket, here to show how much harder Earth is than anywhere else.',
    stages: [
      { name: 'First stage', dry: 950, prop: 9250, thrust: 232e3, isp: 311, exitArea: 0.08 },
      { name: 'Second stage', dry: 250, prop: 2050, thrust: 25.8e3, isp: 343, exitArea: 0.2 },
    ],
    payload: 150,
    diameter: 1.2,
    plan: { verticalRise: 4, kick: 15, kickDuration: 10, target: 300e3, insertion: 'coast' },
    basis: 'Same figures as the Small electric-pump preset in the Vehicle Bay.',
  },
];

export type Phase = 'pad' | 'vertical' | 'kick' | 'turn' | 'insert' | 'coast' | 'circularise' | 'orbit' | 'falling' | 'crashed' | 'escape';

export interface WorldSample {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  alt: number;
  /** Surface-relative speed [m/s] */
  vRel: number;
  vInertial: number;
  /** Ground distance from the pad [m] */
  downrange: number;
  mass: number;
  stage: number;
  phase: Phase;
  burning: boolean;
  /** Thrust direction angle above local horizontal [deg] */
  pitch: number;
  apo: number;
  peri: number;
  q: number;
  propLeft: number;
}

export interface WorldEvent {
  t: number;
  label: string;
}

export type WorldOutcome = 'orbit' | 'suborbital' | 'crashed' | 'grounded';

export interface WorldResult {
  body: Body;
  rocket: WorldRocket;
  plan: FlightPlan;
  samples: WorldSample[];
  events: WorldEvent[];
  outcome: WorldOutcome;
  verdict: string;
  apo: number;
  peri: number;
  /** Propellant left in the active stage and all unused stages [kg] */
  propLeft: number;
  propTotal: number;
  maxQ: number;
  dvUsed: number;
  /** Final state (for drawing the orbit) */
  final: { x: number; y: number; vx: number; vy: number };
}

export function elements2d(mu: number, R: number, x: number, y: number, vx: number, vy: number) {
  const r = Math.hypot(x, y);
  const v2 = vx * vx + vy * vy;
  const eps = v2 / 2 - mu / r;
  const h = x * vy - y * vx;
  const e = Math.sqrt(Math.max(0, 1 + (2 * eps * h * h) / (mu * mu)));
  if (eps >= 0) return { a: Infinity, e, apo: Infinity, peri: (h * h) / (mu * (1 + e)) - R };
  const a = -mu / (2 * eps);
  return { a, e, apo: a * (1 + e) - R, peri: a * (1 - e) - R };
}

/** Body facts derived from μ and R. */
export function bodyFacts(b: Body) {
  return {
    g: b.mu / b.radius ** 2,
    vEscape: Math.sqrt((2 * b.mu) / b.radius),
    vLowOrbit: Math.sqrt(b.mu / (b.radius + b.minPeri)),
    surfaceSpeed: (2 * Math.PI * b.radius) / b.rotation,
    surfacePressure: b.atmosphere ? b.atmosphere(0).p : 0,
  };
}

export function flyWorld(body: Body, rocket: WorldRocket, plan: FlightPlan): WorldResult {
  const { mu, radius: R } = body;
  const omega = (2 * Math.PI) / body.rotation;
  const area = (Math.PI * rocket.diameter ** 2) / 4;
  // Launch at the "top" of the planet, moving east (−x) with the surface
  let x = 0;
  let y = R + 1;
  let vx = -omega * R;
  let vy = 0;
  const stages = rocket.stages.map((s) => ({ ...s, left: s.prop }));
  const propTotal = stages.reduce((a, s) => a + s.prop, 0);
  let k = 0;
  const massNow = () => stages.slice(k).reduce((a, s) => a + s.dry + s.left, 0) + rocket.payload;
  let phase: Phase = 'vertical';
  let t = 0;
  let staging = 0; // coast timer after a separation
  const samples: WorldSample[] = [];
  const events: WorldEvent[] = [{ t: 0, label: 'Liftoff' }];
  let maxQ = 0;
  let dvUsed = 0;
  let lastSample = -Infinity;
  let pitchNow = 90;
  let circStarted = false;
  let circAlt = 0;
  let bestE = Infinity;
  let startE: number | null = null;

  const accel = (px: number, py: number, pvx: number, pvy: number, m: number, thrustDir: [number, number] | null, F: number) => {
    const r = Math.hypot(px, py);
    const gk = -mu / (r * r * r);
    let ax = gk * px;
    let ay = gk * py;
    if (thrustDir) {
      ax += (F / m) * thrustDir[0];
      ay += (F / m) * thrustDir[1];
    }
    if (body.atmosphere) {
      const h = r - R;
      if (h < 200e3) {
        const at = body.atmosphere(h);
        // Air co-rotates: relative velocity = v − ω × r (planar: ω × r = ω(−y, x))
        const rvx = pvx + omega * py;
        const rvy = pvy - omega * px;
        const vr = Math.hypot(rvx, rvy);
        if (vr > 0.1) {
          const D = 0.5 * at.rho * vr * vr * cdAt(DEFAULT_CD, vr / at.a) * area;
          ax -= (D / m) * (rvx / vr);
          ay -= (D / m) * (rvy / vr);
        }
      }
    }
    return [ax, ay] as const;
  };

  // Thrust-to-weight on the pad: below 1 the engines just strain against the ground
  const pa0 = body.atmosphere ? body.atmosphere(0).p : 0;
  const F0 = Math.max(0, stages[0].thrust - pa0 * stages[0].exitArea);
  const w0 = massNow() * (mu / R ** 2);
  if (F0 <= w0) {
    const s0: WorldSample = {
      t: 0, x, y, vx, vy, alt: 0, vRel: 0, vInertial: Math.hypot(vx, vy), downrange: 0, mass: massNow(), stage: 0, phase: 'pad',
      burning: true, pitch: 90, apo: 0, peri: -R, q: 0, propLeft: propTotal,
    };
    return {
      body, rocket, plan, samples: [s0, { ...s0, t: 5 }], events: [{ t: 0, label: 'Ignition, no liftoff' }], outcome: 'grounded',
      verdict: `Thrust-to-weight is ${(F0 / w0).toFixed(2)} on the ${body.name}: the engines cannot lift the vehicle off the pad.`,
      apo: 0, peri: -R, propLeft: propTotal, propTotal, maxQ: 0, dvUsed: 0, final: { x, y, vx, vy },
    };
  }

  const maxT = 3 * 3600;
  while (t < maxT) {
    const r = Math.hypot(x, y);
    const up: [number, number] = [x / r, y / r];
    const east: [number, number] = [-up[1], up[0]]; // perpendicular, direction of surface motion
    const h = r - R;
    const el = elements2d(mu, R, x, y, vx, vy);
    const rvx = vx + omega * y;
    const rvy = vy - omega * x;
    const vRel = Math.hypot(rvx, rvy);
    const atm = body.atmosphere ? body.atmosphere(h) : null;
    const q = atm ? 0.5 * atm.rho * vRel * vRel : 0;
    maxQ = Math.max(maxQ, q);
    const vrad = vx * up[0] + vy * up[1];

    // --- crash / end checks
    if (t > 1 && h < 0) {
      phase = 'crashed';
      events.push({ t, label: 'Impact' });
      break;
    }

    // --- guidance phase logic
    const stage = stages[k];
    const hasProp = !!stage && stage.left > 1e-6;
    if (phase === 'vertical' && t >= plan.verticalRise) {
      phase = 'kick';
      events.push({ t, label: 'Pitch-over' });
    }
    if (phase === 'kick' && t >= plan.verticalRise + plan.kickDuration) {
      phase = 'turn';
      events.push({ t, label: 'Gravity turn' });
    }
    if ((phase === 'turn' || phase === 'kick') && el.apo >= plan.target) {
      phase = plan.insertion === 'direct' ? 'insert' : 'coast';
      events.push({ t, label: plan.insertion === 'direct' ? `Apoapsis ${(el.apo / 1000).toFixed(0)} km, holding altitude` : `Cutoff, apoapsis ${(el.apo / 1000).toFixed(0)} km` });
    }
    // Circular enough at the current height, and above the safe minimum
    const circular = el.peri >= h - 1500 && el.peri >= body.minPeri && el.apo < Infinity;
    // A powerful vehicle overshoots while holding altitude: stop and coast up to apoapsis instead
    if (phase === 'insert' && !circular && el.apo > plan.target * 1.08 + 3e3) {
      phase = 'coast';
      events.push({ t, label: `Cutoff, apoapsis ${(el.apo / 1000).toFixed(0)} km` });
    }
    if (phase === 'coast') {
      // Start the circularisation burn so that it straddles apoapsis
      const vt = Math.abs(vx * east[0] + vy * east[1]);
      const decel = mu / (r * r) - (vt * vt) / r;
      const tToApo = decel > 0 ? vrad / decel : Infinity;
      const vCirc = Math.sqrt(mu / (R + Math.max(el.apo, 0)));
      const dvNeed = Math.max(0, vCirc - vt);
      const st = stages[k];
      const burnT = st ? (massNow() * dvNeed) / st.thrust : 0;
      if (circular) phase = 'orbit';
      else if (tToApo <= burnT / 2 || vrad < 0) {
        phase = 'circularise';
        if (!circStarted) circAlt = Math.max(el.apo, body.minPeri + 2e3);
        if (!circStarted) events.push({ t, label: 'Circularisation burn' });
        circStarted = true;
      }
    }
    // Burning past the most circular point only stretches the orbit again: cut off at minimum eccentricity
    const burningToOrbit = phase === 'circularise' || phase === 'insert';
    if (burningToOrbit) {
      if (startE === null) startE = el.e;
      bestE = Math.min(bestE, el.e);
    } else {
      startE = null;
      bestE = Infinity;
    }
    const passedBest = burningToOrbit && startE !== null && bestE < startE - 0.005 && el.e > bestE + 0.001 && el.peri >= body.minPeri && el.apo < Infinity;
    if ((phase === 'circularise' || phase === 'insert') && (circular || passedBest)) {
      phase = 'orbit';
      events.push({ t, label: `Engine cutoff, orbit ${(el.peri / 1000).toFixed(0)} × ${(el.apo / 1000).toFixed(0)} km` });
    }
    if (phase === 'falling' && el.peri >= body.minPeri && el.apo < Infinity) phase = 'orbit';
    if ((phase === 'falling' || phase === 'coast') && el.apo === Infinity) {
      phase = 'escape';
      events.push({ t, label: 'Escape trajectory' });
    }

    const wantsThrust = phase === 'vertical' || phase === 'kick' || phase === 'turn' || phase === 'insert' || phase === 'circularise';
    // Out of propellant in every stage
    if (wantsThrust && !hasProp && k >= stages.length - 1) {
      events.push({ t, label: 'Propellant exhausted' });
      phase = 'falling';
    }
    // Staging
    if (wantsThrust && !hasProp && k < stages.length - 1 && staging <= 0) {
      k++;
      staging = 2;
      events.push({ t, label: `${stages[k - 1].name} separation` });
    }

    // --- thrust direction
    let dir: [number, number] | null = null;
    let F = 0;
    const burning = wantsThrust && phase !== 'falling' && staging <= 0 && !!stages[k] && stages[k].left > 1e-6;
    if (burning) {
      const st = stages[k];
      const pa = atm ? atm.p : 0;
      F = Math.max(0, st.thrust - pa * st.exitArea);
      if (phase === 'vertical') pitchNow = 90;
      else if (phase === 'kick') pitchNow = 90 - (plan.kick * (t - plan.verticalRise)) / Math.max(plan.kickDuration, 0.1);
      else if (phase === 'turn') {
        // Gravity turn: follow the surface-relative velocity, never steeper than the kick left it
        const vRelUp = rvx * up[0] + rvy * up[1];
        const vRelE = rvx * east[0] + rvy * east[1];
        const fpa = (Math.atan2(vRelUp, vRelE) * 180) / Math.PI;
        pitchNow = Math.min(fpa, 90 - plan.kick);
        // Never let the turn fly the vehicle into the ground: keep enough vertical thrust while descending
        const vt = vx * east[0] + vy * east[1];
        const gEff = mu / (r * r) - (vt * vt) / r;
        if (vrad < 20 && gEff > 0) pitchNow = Math.max(pitchNow, (Math.asin(Math.min(0.95, (1.1 * gEff) / (F / massNow()))) * 180) / Math.PI);
      } else if (phase === 'insert' || phase === 'circularise') {
        // Hold altitude near the goal while thrust builds horizontal speed.
        // Climb rate that coasts exactly up to the goal under the remaining net gravity: v² = 2·g·Δh
        const goal = phase === 'insert' ? plan.target : circAlt;
        const vt = vx * east[0] + vy * east[1];
        const gEff = mu / (r * r) - (vt * vt) / r;
        const dh = goal - h;
        const vradWant = gEff > 0 ? Math.sign(dh) * Math.min(150, Math.sqrt(2 * gEff * Math.abs(dh))) : Math.max(-40, Math.min(150, dh / 40));
        const sn = (gEff + (vradWant - vrad) / 10) / (F / massNow());
        pitchNow = (Math.asin(Math.max(-0.6, Math.min(0.95, sn))) * 180) / Math.PI;
      }
      const p = (pitchNow * Math.PI) / 180;
      dir = [Math.cos(p) * east[0] + Math.sin(p) * up[0], Math.cos(p) * east[1] + Math.sin(p) * up[1]];
    }
    if (phase === 'orbit' || phase === 'escape') {
      samples.push(sample());
      break;
    }

    const dt = burning ? 0.05 : staging > 0 ? 0.1 : 0.5;
    if (t - lastSample >= (burning ? 0.5 : 2)) {
      samples.push(sample());
      lastSample = t;
    }

    // --- RK4 on position/velocity; mass is held for the step (it changes by < 0.1 %)
    const m = massNow();
    const f = (px: number, py: number, pvx: number, pvy: number) => accel(px, py, pvx, pvy, m, dir, F);
    const k1 = f(x, y, vx, vy);
    const k2 = f(x + (vx * dt) / 2, y + (vy * dt) / 2, vx + (k1[0] * dt) / 2, vy + (k1[1] * dt) / 2);
    const k3 = f(x + ((vx + (k1[0] * dt) / 2) * dt) / 2, y + ((vy + (k1[1] * dt) / 2) * dt) / 2, vx + (k2[0] * dt) / 2, vy + (k2[1] * dt) / 2);
    const k4 = f(x + (vx + (k2[0] * dt) / 2) * dt, y + (vy + (k2[1] * dt) / 2) * dt, vx + k3[0] * dt, vy + k3[1] * dt);
    x += (dt / 6) * (vx + 2 * (vx + (k1[0] * dt) / 2) + 2 * (vx + (k2[0] * dt) / 2) + (vx + k3[0] * dt));
    y += (dt / 6) * (vy + 2 * (vy + (k1[1] * dt) / 2) + 2 * (vy + (k2[1] * dt) / 2) + (vy + k3[1] * dt));
    vx += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    vy += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    if (burning) {
      const st = stages[k];
      const mdot = st.thrust / (st.isp * G0);
      const used = Math.min(st.left, mdot * dt);
      st.left -= used;
      dvUsed += (F / m) * dt * (used / (mdot * dt));
    }
    if (staging > 0) staging -= dt;
    // Pad hold-down: nothing moves until thrust beats weight
    if (t < 1 && h < 1 && vy * up[1] + vx * up[0] < 0) {
      x = 0;
      y = R + 1;
      vx = -omega * R;
      vy = 0;
    }
    t += dt;

    function sample(): WorldSample {
      const e2 = elements2d(mu, R, x, y, vx, vy);
      const ang0 = Math.PI / 2;
      const ang = Math.atan2(y, x);
      // Ground under the pad has rotated by ω t
      const ground = (ang - ang0 - omega * t) * R;
      return {
        t,
        x,
        y,
        vx,
        vy,
        alt: Math.hypot(x, y) - R,
        vRel,
        vInertial: Math.hypot(vx, vy),
        downrange: Math.abs(ground),
        mass: massNow(),
        stage: k,
        phase,
        burning,
        pitch: pitchNow,
        apo: e2.apo,
        peri: e2.peri,
        q,
        propLeft: stages.slice(k).reduce((a, s) => a + s.left, 0),
      };
    }
  }

  const el = elements2d(mu, R, x, y, vx, vy);
  const propLeft = stages.slice(k).reduce((a, s) => a + s.left, 0);
  const outcome: WorldOutcome = phase === 'crashed' ? 'crashed' : phase === 'orbit' ? 'orbit' : 'suborbital';
  if (samples.length === 0 || samples[samples.length - 1].t < t) {
    samples.push({
      t,
      x,
      y,
      vx,
      vy,
      alt: Math.hypot(x, y) - R,
      vRel: Math.hypot(vx + omega * y, vy - omega * x),
      vInertial: Math.hypot(vx, vy),
      downrange: Math.abs((Math.atan2(y, x) - Math.PI / 2 - omega * t) * R),
      mass: massNow(),
      stage: k,
      phase,
      burning: false,
      pitch: pitchNow,
      apo: el.apo,
      peri: el.peri,
      q: 0,
      propLeft,
    });
  }
  const km = (m: number) => `${(m / 1000).toFixed(0)} km`;
  const verdict =
    outcome === 'orbit'
      ? `Orbit around the ${body.name}: ${km(el.peri)} × ${km(el.apo)}, with ${propLeft.toFixed(0)} kg of propellant to spare.`
      : outcome === 'crashed'
        ? `The vehicle came back down ${km(samples[samples.length - 1].downrange)} from the pad. Pitch over less, or carry more propellant.`
        : el.apo === Infinity
          ? `Too fast: the vehicle escaped the ${body.name}'s gravity. Aim lower or insert directly.`
          : `Out of propellant on a suborbital ${km(Math.max(el.peri, -body.radius))} × ${km(el.apo)} path.`;
  return { body, rocket, plan, samples, events, outcome, verdict, apo: el.apo, peri: el.peri, propLeft, propTotal, maxQ, dvUsed, final: { x, y, vx, vy } };
}

/** Stars: 1 = orbit, 2 = mean altitude within 15 % (or 5 km) of the target, 3 = that plus a reserve of ≥ 5 % of the last stage's propellant. */
export function stars(r: WorldResult): number {
  if (r.outcome !== 'orbit') return 0;
  const mean = (r.apo + r.peri) / 2;
  const near = Math.abs(mean - r.plan.target) <= Math.max(0.15 * r.plan.target, 5e3);
  if (!near) return 1;
  const last = r.rocket.stages[r.rocket.stages.length - 1].prop;
  return r.propLeft >= 0.05 * last ? 3 : 2;
}
