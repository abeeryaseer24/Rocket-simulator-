import { circleArea } from '../physics/aero';
import { DEG } from '../physics/constants';
import { add, cross, dot, norm, scale, sub, unit, type Vec3 } from '../physics/vec';
import type { Vehicle } from './vehicle';

/**
 * Rigid-body attitude layer on top of the point-mass trajectory.
 *
 * The body axis b and angular rate w evolve under:
 *   I·ẇ = τ_gimbal + τ_aero
 * τ_aero comes from the normal force q·S·C_Nα·α acting at the centre of
 * pressure. On a finless rocket the CP sits near the nose, ahead of the CG,
 * so the moment *increases* α: the airframe is statically unstable and only
 * the thrust-vector controller keeps it pointed. Roll is not modelled.
 */
export interface ControlSpec {
  enabled: boolean;
  /** Closed-loop natural frequency of the attitude controller [rad/s] */
  bandwidth: number;
  /** Damping ratio */
  damping: number;
  /** Maximum engine gimbal deflection [deg] */
  gimbalMax: number;
  /** Peak jet-stream wind speed [m/s] */
  windPeak: number;
  /** Altitude of the jet-stream peak [m] */
  windAlt: number;
  /** Direction the wind blows toward, degrees from north */
  windToward: number;
}

export const DEFAULT_CONTROL: ControlSpec = {
  enabled: false,
  bandwidth: 1.6,
  damping: 0.7,
  gimbalMax: 5,
  windPeak: 45,
  windAlt: 11500,
  windToward: 90,
};

/** Horizontal wind speed at altitude: light surface wind plus a Gaussian jet stream. */
export const windSpeed = (c: ControlSpec, alt: number): number =>
  alt > 40000 ? 0 : 4 + c.windPeak * Math.exp(-(((alt - c.windAlt) / 4500) ** 2));

export interface MassProps {
  /** CG distance from the nose tip [m] */
  xcg: number;
  /** Pitch/yaw moment of inertia about the CG [kg·m²] */
  I: number;
  /** Gimbal point (bottom of the active stage) from the nose [m] */
  xGimbal: number;
  /** Centre of pressure from the nose [m] */
  xcp: number;
  /** Total normal-force slope [1/rad], referenced to sRef */
  cna: number;
  sRef: number;
}

/**
 * Mass properties of what is still attached. Stack measured from the nose
 * tip downward; propellant sits at the bottom of each stage's tank column,
 * so the CG climbs as the tanks drain.
 */
export function massProps(v: Vehicle, k: number, propLeft: number[], boostersOn: boolean, boosterProp: number, fairingOn: boolean): MassProps {
  const parts: Array<{ m: number; x: number; L: number }> = [];
  let x = 0;
  const fl = v.fairing.length;
  parts.push({ m: v.payloadMass, x: fl * 0.55, L: fl * 0.4 });
  if (fairingOn) parts.push({ m: v.fairing.mass, x: fl * 0.5, L: fl });
  x = fl;
  let xGimbal = x;
  let stage0Top = 0;
  for (let j = v.stages.length - 1; j >= k; j--) {
    const s = v.stages[j];
    const top = x;
    const bottom = x + s.length;
    parts.push({ m: s.dryMass, x: (top + bottom) / 2, L: s.length });
    const frac = Math.max(0, Math.min(1, propLeft[j] / s.propMass));
    const col = s.length * 0.85 * frac;
    if (col > 0) parts.push({ m: propLeft[j], x: bottom - col / 2, L: col });
    if (j === 0) stage0Top = top;
    xGimbal = bottom;
    x = bottom;
  }
  if (boostersOn && k === 0 && v.boosters.count > 0) {
    const b = v.boosters.stage;
    const bTop = x - b.length;
    parts.push({ m: v.boosters.count * b.dryMass, x: bTop + b.length / 2, L: b.length });
    const col = b.length * 0.85 * Math.max(0, Math.min(1, boosterProp / b.propMass));
    if (col > 0) parts.push({ m: v.boosters.count * boosterProp, x: x - col / 2, L: col });
  }
  void stage0Top;
  const m = parts.reduce((a, p) => a + p.m, 0);
  const xcg = parts.reduce((a, p) => a + p.m * p.x, 0) / m;
  const I = parts.reduce((a, p) => a + p.m * ((p.x - xcg) ** 2 + (p.L * p.L) / 12), 0);

  // Barrowman: an ogive/cone nose gives C_Nα = 2 at ~0.466 of its length. Booster noses add their own.
  const dRef = Math.max(v.fairing.diameter, v.stages[0].diameter);
  const sRef = circleArea(dRef);
  const noses: Array<{ cna: number; x: number }> = [{ cna: fairingOn ? 2 : 2, x: (fairingOn ? fl * 0.42 : v.stages[v.stages.length - 1].diameter) * 0.466 }];
  if (boostersOn && k === 0 && v.boosters.count > 0) {
    const b = v.boosters.stage;
    noses.push({ cna: 2 * v.boosters.count * (b.diameter / dRef) ** 2, x: x - b.length + b.diameter * 1.6 * 0.466 });
  }
  const cna = noses.reduce((a, n) => a + n.cna, 0);
  const xcp = noses.reduce((a, n) => a + n.cna * n.x, 0) / cna;
  return { xcg, I, xGimbal, xcp, cna, sRef };
}

export interface AttitudeState {
  b: Vec3;
  w: Vec3;
  gimbal: number;
  err: number;
}

/**
 * One attitude step. Returns the new state and the actual thrust direction
 * (the body axis deflected by the gimbal). With no thrust there is no
 * control torque; cold-gas thrusters then hold the commanded attitude.
 */
export function stepAttitude(st: AttitudeState, desired: Vec3, vrel: Vec3, q: number, thrust: number, mp: MassProps, c: ControlSpec, dt: number): { state: AttitudeState; thrustDir: Vec3 } {
  let { b, w } = st;
  if (thrust <= 0) {
    return { state: { b: desired, w: [0, 0, 0], gimbal: 0, err: 0 }, thrustDir: desired };
  }
  const arm = Math.max(mp.xGimbal - mp.xcg, 0.5);
  // Aero moment toward v_rel if CP is behind CG (stable), away from it if ahead (unstable)
  const vm = norm(vrel);
  const tauAero: Vec3 = vm > 1 ? scale(cross(b, scale(vrel, 1 / vm)), q * mp.sRef * mp.cna * (mp.xcp - mp.xcg)) : [0, 0, 0];
  // PD on attitude error (axis-angle), as an angular-acceleration command
  const e = cross(b, desired);
  const wn = c.bandwidth;
  const aCmd = sub(scale(e, wn * wn), scale(w, 2 * c.damping * wn));
  let tauG = sub(scale(aCmd, mp.I), tauAero); // cancel the known aero moment
  const tauMax = thrust * arm * Math.sin(c.gimbalMax * DEG);
  const tm = norm(tauG);
  if (tm > tauMax) tauG = scale(tauG, tauMax / tm);
  const gimbal = Math.asin(Math.min(1, norm(tauG) / (thrust * arm))) / DEG;
  // Thrust direction that produces tauG: t = b + (b × τ)/(l·T)
  const thrustDir = unit(add(b, scale(cross(b, tauG), 1 / (arm * thrust))));
  const wdot = scale(add(tauG, tauAero), 1 / mp.I);
  w = add(w, scale(wdot, dt));
  w = sub(w, scale(b, dot(w, b))); // no roll
  b = unit(add(b, scale(cross(w, b), dt)));
  const err = Math.acos(Math.max(-1, Math.min(1, dot(b, desired)))) / DEG;
  return { state: { b, w, gimbal, err }, thrustDir };
}
