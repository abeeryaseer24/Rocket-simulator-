import { circleArea } from '../physics/aero';
import { atmosphere } from '../physics/atmosphere';
import { DEG, G0, MU_EARTH, OMEGA_EARTH } from '../physics/constants';
import { airRelativeVelocity, ecefToGeodetic, eciToEcef, geodeticToECEF, gravityJ2, greatCircle, localFrame } from '../physics/earth';
import { massFlow, thrustAt } from '../physics/propulsion';
import { add, addScaled, dot, norm, rotZ, scale, sub, unit, type Vec3 } from '../physics/vec';
import { DEFAULT_RECOVERY, type RecoverySpec, type Vehicle } from './vehicle';

/** Boostback aims 1 % past the pad: drag shortens the arc slightly, fins and terminal guidance take up the rest. */
const BOOSTBACK_AIM = 1.01;
export type RecoveryPhase = 'flip' | 'boostback' | 'coast' | 'entry' | 'descent' | 'landing' | 'landed' | 'lost';

export interface RecoverySample {
  t: number;
  pos: Vec3;
  dir: Vec3;
  alt: number;
  speed: number;
  vVertical: number;
  q: number;
  prop: number;
  throttle: number;
  burning: boolean;
  phase: RecoveryPhase;
  rho: number;
  pressure: number;
  distToTarget: number;
}

export interface RecoveryEvent {
  t: number;
  label: string;
  detail: string;
  alt: number;
}

export interface RecoveryResult {
  mode: RecoverySpec['mode'];
  samples: RecoverySample[];
  events: RecoveryEvent[];
  success: boolean;
  verdict: string;
  /** Landing target, Earth-fixed [m] */
  target: Vec3;
  touchdown: { vVert: number; vHoriz: number; miss: number; t: number } | null;
  propLeft: number;
  maxQ: number;
}

export interface RecoveryStart {
  r: Vec3;
  v: Vec3;
  t: number;
  prop: number;
}

/**
 * Spent first stage, flown back by itself. Same gravity, atmosphere and
 * drag models as the ascent. Phases:
 *  flip       — 10 s coast while it turns engines-first
 *  boostback  — (RTLS) thrust toward the pad until the vacuum ballistic
 *               impact prediction is back at the pad
 *  entry burn — retro-burn at entryStartAlt to cut speed before peak heating
 *  descent    — aerodynamic fall; grid fins steer horizontally toward target
 *  landing    — "hoverslam": ignite when the stopping distance at full
 *               landing thrust equals altitude, then throttle so v→0 at h→0
 */
export function simulateRecovery(v: Vehicle, start: RecoveryStart, targetOverride?: Vec3, steer = true): RecoveryResult {
  const rec = { ...DEFAULT_RECOVERY, ...(v.recovery ?? {}) };
  const st = v.stages[0];
  const site = geodeticToECEF(v.site.lat * DEG, v.site.lon * DEG, v.site.elevation);
  const target = targetOverride ?? site;
  const area = circleArea(st.diameter);
  const dt = 0.05;

  let r: Vec3 = [...start.r];
  let vel: Vec3 = [...start.v];
  let t = start.t;
  let prop = start.prop;
  let phase: RecoveryPhase = 'flip';
  let phaseT = t;
  let entryDvDone = 0;
  let nextIgnCheck = -Infinity;
  let maxQ = 0;
  const samples: RecoverySample[] = [];
  const events: RecoveryEvent[] = [];
  let sampleClock = t;
  let touchdown: RecoveryResult['touchdown'] = null;
  let lost = '';

  const geo = (rr: Vec3, tt: number) => ecefToGeodetic(eciToEcef(rr, OMEGA_EARTH * tt));
  const targetEci = (tt: number) => rotZ(target, OMEGA_EARTH * tt);
  const log = (label: string, detail: string) => events.push({ t, label, detail, alt: geo(r, t).h });
  const engine = (n: number) => ({ ...st.engine, count: Math.min(n, st.engine.count) });

  while (t < start.t + 900) {
    const alt = geo(r, t).h;
    const atm = atmosphere(alt);
    const vrel = airRelativeVelocity(r, vel);
    const vm = norm(vrel);
    const q = 0.5 * atm.rho * vm * vm;
    maxQ = Math.max(maxQ, q);
    const { up } = localFrame(r);
    const vz = dot(vrel, up);
    const vhVec = addScaled(vrel, up, -vz);
    const g = MU_EARTH / dot(r, r);
    const m = st.dryMass + prop;

    // Horizontal vector to the target and distance along the surface
    const tE = targetEci(t);
    const toT = sub(tE, r);
    const toTH = addScaled(toT, up, -dot(toT, up));
    const dist = greatCircle(eciToEcef(r, OMEGA_EARTH * t), target);
    const hatT = norm(toTH) > 1 ? unit(toTH) : [0, 0, 0] as Vec3;

    let thrustDir: Vec3 = vm > 1 ? scale(vrel, -1 / vm) : up;
    let n = 0;
    let thr = 0;
    let finAcc: Vec3 = [0, 0, 0];

    // ---------- phase logic ----------
    if (phase === 'flip' && t - phaseT >= 10) {
      phase = rec.mode === 'rtls' ? 'boostback' : 'coast';
      phaseT = t;
      if (phase === 'boostback') log('Boostback burn', `${rec.boostbackEngines} engines reverse the stage toward the launch site`);
    }
    if (phase === 'boostback') {
      // Vacuum ballistic flight time from here, and how far current horizontal speed carries us toward the pad
      const tf = (vz + Math.sqrt(Math.max(vz * vz + 2 * g * Math.max(alt, 0), 0))) / g;
      const towardPad = dot(vhVec, hatT) * tf;
      const reserveForLanding = 0.32 * prop;
      if (towardPad >= dist * BOOSTBACK_AIM || prop <= reserveForLanding) {
        phase = 'coast';
        phaseT = t;
        log('Boostback complete', `Predicted impact ${(Math.max(dist - towardPad, 0) / 1000).toFixed(1)} km from the pad`);
      } else {
        n = rec.boostbackEngines;
        thr = 1;
        thrustDir = unit(add(scale(hatT, 0.97), scale(up, 0.24)));
      }
    }
    if (phase === 'coast' && vz < 0 && alt < rec.entryStartAlt) {
      phase = 'entry';
      phaseT = t;
      log('Entry burn', `${rec.entryEngines} engines cut ${rec.entryDv} m/s before the thick air`);
    }
    if (phase === 'entry') {
      if (entryDvDone >= rec.entryDv || prop <= 0) {
        phase = 'descent';
        phaseT = t;
        log('Entry burn complete', `Falling at ${vm.toFixed(0)} m/s`);
      } else {
        n = rec.entryEngines;
        thr = 1;
      }
    }
    if (steer && (phase === 'descent' || phase === 'landing')) {
      // Grid fins: horizontal steering toward the target, limited by available aerodynamic force
      const tRem = Math.max(alt / Math.max(-vz, 20), 2);
      const want = scale(hatT, Math.min(dist / tRem, 400));
      const err = sub(want, vhVec);
      const aMax = Math.min((q * 4.0 * 1.0) / m, 0.4 * G0);
      const aCmd = scale(err, 1 / 5);
      const ac = norm(aCmd);
      finAcc = ac > aMax ? scale(aCmd, aMax / ac) : aCmd;
    }
    if (phase === 'descent' && t >= nextIgnCheck) {
      nextIgnCheck = t + (alt < 30000 ? 0.05 : 0.25);
      // Forward prediction: if the landing engines lit now at full throttle, with drag, where would we stop?
      const one = engine(rec.landingEngines);
      let ph = alt;
      let px = norm(vhVec); // horizontal speed
      let pz = -vz; // descent rate, down positive
      let pm = m;
      const mdot1 = massFlow(one);
      let stopAt = Infinity;
      for (let i = 0; i < 1500; i++) {
        const a2 = atmosphere(Math.max(ph, 0));
        const sp = Math.hypot(px, pz);
        if (sp < 2 || pz <= 0) {
          stopAt = ph;
          break;
        }
        const D = 0.5 * a2.rho * sp * sp * rec.cdDescent * area;
        // Plan at 85 % thrust so the engine keeps throttle authority to absorb errors
        const a = (0.85 * thrustAt(one, a2.p) + D) / pm; // both oppose the velocity
        px = Math.max(0, px - (a * px) / sp * 0.1);
        pz += (g - (a * pz) / sp) * 0.1;
        ph -= pz * 0.1;
        pm = Math.max(st.dryMass, pm - mdot1 * 0.1);
        if (ph <= 0) {
          stopAt = ph; // would hit the ground even at full thrust: light now
          break;
        }
      }
      if (stopAt <= 40) {
        phase = 'landing';
        phaseT = t;
        log('Landing burn', `${rec.landingEngines} engine${rec.landingEngines > 1 ? 's' : ''} light at ${(alt / 1000).toFixed(2)} km, ${vm.toFixed(0)} m/s`);
      }
    }
    if (phase === 'landing') {
      const one = engine(rec.landingEngines);
      const Tmax = thrustAt(one, atm.p);
      const aReq = (vm * vm) / (2 * Math.max(alt, 0.5)) + g;
      n = rec.landingEngines;
      thr = vz < 0 ? Math.max(one.throttleMin, Math.min(1, (aReq * m) / Math.max(Tmax, 1))) : 0;
      if (thr === 0) n = 0;
      else if (steer) {
        // Decoupled terminal guidance: vertical channel stops the fall, horizontal channel
        // nulls position and velocity error at touchdown; tilt limited to 25°
        const tGo = Math.max(alt / Math.max(-vz, 1), 1.5);
        const aV = (vz * vz) / (2 * Math.max(alt, 0.5)) + g;
        const aH = add(scale(toTH, 2 / (tGo * tGo)), scale(vhVec, -2 / tGo));
        const lim = Math.tan(25 * DEG) * aV;
        const mag = norm(aH);
        const aHc = mag > lim ? scale(aH, lim / mag) : aH;
        const aVec = add(scale(up, aV), aHc);
        thr = Math.max(one.throttleMin, Math.min(1, (norm(aVec) * m) / Math.max(Tmax, 1)));
        thrustDir = unit(aVec);
      }
    }
    if (prop <= 0 && n > 0) {
      n = 0;
      if (!lost && phase !== 'descent') {
        log('Propellant depleted', 'Not enough reserve for the remaining burns');
        lost = 'Ran out of propellant before touchdown';
      }
    }

    const eng = n > 0 ? engine(n) : null;
    const mdot = eng ? massFlow(eng, thr) : 0;
    let h = dt;
    if (mdot > 0) h = Math.min(h, prop / mdot);
    h = Math.max(h, 1e-4);

    if (t >= sampleClock) {
      samples.push({
        t,
        pos: r,
        dir: thrustDir,
        alt,
        speed: vm,
        vVertical: vz,
        q,
        prop,
        throttle: thr,
        burning: n > 0 && thr > 0,
        phase,
        rho: atm.rho,
        pressure: atm.p,
        distToTarget: dist,
      });
      sampleClock = t + (n > 0 ? 0.2 : 0.5);
    }

    const deriv = (rr: Vec3, vv: Vec3, tau: number): [Vec3, Vec3] => {
      const mm = m - mdot * tau;
      const z = geo(rr, t + tau).h;
      const a2 = atmosphere(z);
      const vr2 = airRelativeVelocity(rr, vv);
      const v2 = norm(vr2);
      const D = 0.5 * a2.rho * v2 * v2 * rec.cdDescent * area;
      let acc = gravityJ2(rr);
      if (eng) acc = addScaled(acc, thrustDir, thrustAt(eng, a2.p, thr) / mm);
      if (v2 > 1e-6) acc = addScaled(acc, vr2, -D / (mm * v2));
      acc = add(acc, finAcc);
      return [vv, acc];
    };
    const [k1r, k1v] = deriv(r, vel, 0);
    const [k2r, k2v] = deriv(addScaled(r, k1r, h / 2), addScaled(vel, k1v, h / 2), h / 2);
    const [k3r, k3v] = deriv(addScaled(r, k2r, h / 2), addScaled(vel, k2v, h / 2), h / 2);
    const [k4r, k4v] = deriv(addScaled(r, k3r, h), addScaled(vel, k3v, h), h);
    r = addScaled(r, add(add(k1r, scale(k2r, 2)), add(scale(k3r, 2), k4r)), h / 6);
    vel = addScaled(vel, add(add(k1v, scale(k2v, 2)), add(scale(k3v, 2), k4v)), h / 6);
    if (eng) {
      if (phase === 'entry') entryDvDone += (thrustAt(eng, atm.p, thr) / m) * h;
      prop = Math.max(0, prop - mdot * h);
    }
    t += h;

    const altNow = geo(r, t).h;
    if (altNow <= 0) {
      const vr = airRelativeVelocity(r, vel);
      const u = localFrame(r).up;
      const vVert = -dot(vr, u);
      const vHoriz = norm(addScaled(vr, u, -dot(vr, u)));
      const miss = greatCircle(eciToEcef(r, OMEGA_EARTH * t), target);
      touchdown = { vVert, vHoriz, miss, t };
      const soft = vVert < 6 && vHoriz < 4;
      phase = soft && miss < 60 ? 'landed' : 'lost';
      samples.push({ ...samples[samples.length - 1], t, pos: r, alt: 0, speed: norm(vr), vVertical: -vVert, phase, burning: false, throttle: 0, distToTarget: miss });
      log(phase === 'landed' ? 'Touchdown' : 'Impact', `${vVert.toFixed(1)} m/s vertical, ${vHoriz.toFixed(1)} m/s sideways, ${miss.toFixed(0)} m from the target`);
      if (!lost && !soft) lost = vVert >= 6 ? 'Touchdown too fast for the landing legs' : 'Came down sliding sideways';
      if (!lost && miss >= 60) lost = `Missed the ${rec.mode === 'rtls' ? 'landing zone' : 'droneship'} by ${miss.toFixed(0)} m`;
      break;
    }
  }

  const success = phase === 'landed';
  return {
    mode: rec.mode,
    samples,
    events,
    success,
    verdict: success
      ? `Booster landed ${touchdown!.miss.toFixed(0)} m from the ${rec.mode === 'rtls' ? 'pad' : 'droneship'} at ${touchdown!.vVert.toFixed(1)} m/s, with ${(prop / 1000).toFixed(1)} t of propellant left.`
      : `Booster lost: ${lost || 'did not reach the ground in time'}.`,
    target,
    touchdown,
    propLeft: prop,
    maxQ,
  };
}

/** Droneship placement: fly once to the natural landing point, then station the ship there (as real ops do from the nominal trajectory). */
export function recoverWithShip(v: Vehicle, start: RecoveryStart): RecoveryResult {
  const rec = { ...DEFAULT_RECOVERY, ...(v.recovery ?? {}) };
  if (rec.mode === 'rtls') return simulateRecovery(v, start);
  const probe = simulateRecovery(v, start, undefined, false);
  const last = probe.samples[probe.samples.length - 1];
  const ship = last ? (() => {
    const e = eciToEcef(last.pos, OMEGA_EARTH * last.t);
    const g = ecefToGeodetic(e);
    return geodeticToECEF(g.lat, g.lon, 0);
  })() : undefined;
  return simulateRecovery(v, start, ship);
}
