import type { RecoverySample } from './recovery';
import type { Sample } from './simulate';
import type { Vec3 } from '../physics/vec';

/** Binary search for the last sample with time ≤ t. */
export function indexAt(samples: Sample[], t: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  if (t <= samples[0].t) return 0;
  if (t >= samples[hi].t) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const lerpV = (a: Vec3, b: Vec3, f: number): Vec3 => [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];

/** Fields that index or flag something: never blend them between frames (stage 0.4 doesn't exist). */
const DISCRETE = new Set<keyof Sample>(['stage', 'boosters', 'fairing', 'burning']);

/** Linearly interpolated telemetry frame at time t. Discrete fields come from the earlier frame. */
export function sampleAt(samples: Sample[], t: number): Sample {
  const i = indexAt(samples, t);
  const a = samples[i];
  const b = samples[Math.min(i + 1, samples.length - 1)];
  if (a === b || b.t === a.t) return a;
  const f = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
  const out = { ...a } as Sample;
  for (const k of Object.keys(a) as Array<keyof Sample>) {
    if (DISCRETE.has(k)) continue;
    const va = a[k];
    const vb = b[k];
    if (typeof va === 'number' && typeof vb === 'number') (out as unknown as Record<string, number>)[k] = lerp(va, vb, f);
  }
  out.pos = lerpV(a.pos, b.pos, f);
  // Hold direction across a discontinuity (e.g. staging) rather than sweeping through it
  out.dir = a.burning === b.burning ? lerpV(a.dir, b.dir, f) : a.dir;
  out.t = t;
  return out;
}

export const fmtClock = (t: number) => {
  const sign = t < 0 ? '−' : '+';
  const s = Math.abs(t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `T${sign} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

/** Interpolated booster state, shaped as a telemetry Sample so the 3D scene can draw it. */
export function boosterSampleAt(rs: RecoverySample[], t: number): { sample: Sample; rec: RecoverySample } | null {
  if (!rs.length || t < rs[0].t) return null;
  let i = 0;
  while (i < rs.length - 2 && rs[i + 1].t <= t) i++;
  const a = rs[i];
  const b = rs[Math.min(i + 1, rs.length - 1)];
  const f = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
  const L = (x: number, y: number) => x + (y - x) * f;
  const rec: RecoverySample = {
    ...a,
    t,
    pos: lerpV(a.pos, b.pos, f),
    dir: a.burning === b.burning ? lerpV(a.dir, b.dir, f) : a.dir,
    alt: L(a.alt, b.alt),
    speed: L(a.speed, b.speed),
    vVertical: L(a.vVertical, b.vVertical),
    q: L(a.q, b.q),
    prop: L(a.prop, b.prop),
    rho: L(a.rho, b.rho),
    pressure: L(a.pressure, b.pressure),
    distToTarget: L(a.distToTarget, b.distToTarget),
  };
  const sample = {
    t,
    pos: rec.pos,
    dir: rec.dir,
    alt: rec.alt,
    rho: rec.rho,
    pressure: rec.pressure,
    q: rec.q,
    stage: 0,
    boosters: false,
    fairing: false,
    burning: rec.burning,
    throttle: rec.throttle,
    thrust: rec.burning ? 1 : 0,
    mass: 1,
  } as Sample;
  return { sample, rec };
}
