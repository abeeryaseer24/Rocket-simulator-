/**
 * Electromechanical thrust-vector-control actuator (EMA).
 *
 * A brushless DC motor drives a ball screw through a gearbox; the screw
 * pushes the nozzle about its gimbal on a moment arm.
 *
 *   L di/dt = V − R i − Ke ω           motor electrical
 *   J_eq dω/dt = Kt i − b ω − τ_load/G  motor mechanical (load reflected)
 *   δ = G θ_m,   G = lead / (2π N · arm)    nozzle angle per motor radian
 *
 * Control is the classic cascade found in servo drives: an inner current
 * (torque) PI loop, a velocity PI loop, and an outer position P loop, each
 * roughly 5–10× slower than the one inside it. Voltage is clamped to the
 * bus, current to the drive limit, speed to the motor's rating.
 */

export interface ServoSpec {
  busV: number;
  R: number;
  L: number;
  /** Torque constant [N·m/A] = back-EMF constant [V·s/rad] */
  Kt: number;
  Jm: number;
  b: number;
  gear: number;
  /** Ball-screw lead [m/rev] */
  lead: number;
  /** Actuator moment arm about the gimbal [m] */
  arm: number;
  /** Nozzle moment of inertia about the gimbal [kg·m²] */
  Jn: number;
  /** Hinge moment opposing the actuator (thrust offset, friction) [N·m] */
  hinge: number;
  iMax: number;
  /** Current, velocity and position loop bandwidths [Hz] */
  fi: number;
  fv: number;
  fp: number;
  /** Max nozzle deflection [deg] */
  stroke: number;
}

export const DEFAULT_SERVO: ServoSpec = {
  busV: 270,
  R: 0.2,
  L: 0.3e-3,
  Kt: 0.25,
  Jm: 1.0e-4,
  b: 2e-5,
  gear: 5,
  lead: 0.005,
  arm: 0.3,
  Jn: 50,
  hinge: 400,
  iMax: 30,
  fi: 1000,
  fv: 120,
  fp: 12,
  stroke: 6,
};

export const ratio = (s: ServoSpec) => s.lead / (2 * Math.PI * s.gear * s.arm);
export const jEq = (s: ServoSpec) => s.Jm + s.Jn * ratio(s) ** 2;

export function gains(s: ServoSpec) {
  const wi = 2 * Math.PI * s.fi;
  const wv = 2 * Math.PI * s.fv;
  const wp = 2 * Math.PI * s.fp;
  return {
    kpi: s.L * wi,
    kii: s.R * wi,
    kpv: (jEq(s) * wv) / s.Kt,
    kiv: (jEq(s) * wv * wv) / (5 * s.Kt),
    kpp: wp,
  };
}

export interface ServoPoint {
  t: number;
  cmd: number;
  delta: number;
  rate: number;
  i: number;
  v: number;
  p: number;
}

export interface StepResult {
  points: ServoPoint[];
  riseTime: number;
  settle: number;
  overshoot: number;
  peakPower: number;
  peakRate: number;
  saturated: boolean;
}

const DEG = Math.PI / 180;

export function stepResponse(s: ServoSpec, stepDeg: number, tEnd = 0.4): StepResult {
  const g = gains(s);
  const G = ratio(s);
  const J = jEq(s);
  const wMax = s.busV / s.Kt;
  const cmdDeg = Math.max(-s.stroke, Math.min(s.stroke, stepDeg));
  const thetaCmd = (cmdDeg * DEG) / G;
  let i = 0;
  let w = 0;
  let th = 0;
  let iv = 0;
  let ii = 0;
  const dt = 5e-6;
  const pts: ServoPoint[] = [];
  let peakPower = 0;
  let peakRate = 0;
  let saturated = false;
  let t10 = NaN;
  let t90 = NaN;
  let maxDelta = 0;
  let settle = 0;
  const tauLoad = s.hinge * G; // hinge moment reflected to the motor shaft
  for (let k = 0, t = 0; t <= tEnd; k++, t = k * dt) {
    const tc = t >= 0.01 ? thetaCmd : 0;
    let wCmd = g.kpp * (tc - th);
    if (Math.abs(wCmd) > wMax) (wCmd = Math.sign(wCmd) * wMax), (saturated = true);
    const ew = wCmd - w;
    let iCmd = g.kpv * ew + iv;
    if (Math.abs(iCmd) > s.iMax) {
      iCmd = Math.sign(iCmd) * s.iMax;
      saturated = true;
    } else iv += g.kiv * ew * dt; // conditional integration: anti-windup
    const ei = iCmd - i;
    let v = g.kpi * ei + ii + s.Kt * w; // back-EMF feed-forward
    if (Math.abs(v) > s.busV) {
      v = Math.sign(v) * s.busV;
      saturated = true;
    } else ii += g.kii * ei * dt;
    const di = (v - s.R * i - s.Kt * w) / s.L;
    const dw = (s.Kt * i - s.b * w - Math.sign(w || tc - th) * tauLoad) / J;
    i += di * dt;
    w += dw * dt;
    th += w * dt;
    const delta = (th * G) / DEG;
    const p = v * i;
    peakPower = Math.max(peakPower, p);
    peakRate = Math.max(peakRate, Math.abs((w * G) / DEG));
    if (t >= 0.01) {
      const f = cmdDeg !== 0 ? delta / cmdDeg : 0;
      if (Number.isNaN(t10) && f >= 0.1) t10 = t;
      if (Number.isNaN(t90) && f >= 0.9) t90 = t;
      maxDelta = Math.max(maxDelta, f);
      if (Math.abs(f - 1) > 0.02) settle = t - 0.01;
    }
    if (k % 40 === 0) pts.push({ t, cmd: tc * G / DEG, delta, rate: (w * G) / DEG, i, v, p });
  }
  return {
    points: pts,
    riseTime: t90 - t10,
    settle,
    overshoot: Math.max(0, maxDelta - 1) * 100,
    peakPower,
    peakRate,
    saturated,
  };
}

/* --- small-signal frequency response of the position loop --- */
type C = [number, number];
const cadd = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const closed = (l: C): C => cdiv(l, cadd([1, 0], l));

/** Open-loop L(jω) of the position loop, with the inner loops closed. */
export function openLoop(s: ServoSpec, f: number): C {
  const g = gains(s);
  const jw: C = [0, 2 * Math.PI * f];
  const Ge = cdiv([1, 0], cadd(cmul([s.L, 0], jw), [s.R, 0]));
  const Ci = cadd([g.kpi, 0], cdiv([g.kii, 0], jw));
  const Ti = closed(cmul(Ci, Ge));
  const Gw = cmul(Ti, cdiv([s.Kt, 0], cadd(cmul([jEq(s), 0], jw), [s.b, 0])));
  const Cv = cadd([g.kpv, 0], cdiv([g.kiv, 0], jw));
  const Tv = closed(cmul(Cv, Gw));
  return cmul([g.kpp, 0], cdiv(Tv, jw));
}

export interface BodePoint {
  f: number;
  mag: number;
  phase: number;
  clMag: number;
}

export function bode(s: ServoSpec, f0 = 0.5, f1 = 3000, n = 160) {
  const pts: BodePoint[] = [];
  let lastPhase = -90;
  for (let k = 0; k < n; k++) {
    const f = f0 * Math.pow(f1 / f0, k / (n - 1));
    const L = openLoop(s, f);
    let ph = (Math.atan2(L[1], L[0]) * 180) / Math.PI;
    while (ph - lastPhase > 180) ph -= 360;
    while (ph - lastPhase < -180) ph += 360;
    lastPhase = ph;
    const T = closed(L);
    pts.push({ f, mag: 20 * Math.log10(Math.hypot(L[0], L[1])), phase: ph, clMag: 20 * Math.log10(Math.hypot(T[0], T[1])) });
  }
  const xi = pts.findIndex((p) => p.mag < 0);
  const cross = xi > 0 ? pts[xi] : null;
  const bwi = pts.findIndex((p) => p.clMag < -3);
  return {
    pts,
    crossover: cross?.f ?? NaN,
    phaseMargin: cross ? 180 + cross.phase : NaN,
    bandwidth: bwi > 0 ? pts[bwi].f : NaN,
  };
}
