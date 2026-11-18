import { cdAt, circleArea, suttonGraves } from '../physics/aero';
import { atmosphere } from '../physics/atmosphere';
import { DEG, G0, MU_EARTH, OMEGA_EARTH, RAD } from '../physics/constants';
import {
  airRelativeVelocity,
  ecefToGeodetic,
  eciToEcef,
  geodeticToECEF,
  gravityJ2,
  greatCircle,
  localFrame,
} from '../physics/earth';
import { elementsFromState, flightPathAngle, type OrbitalElements } from '../physics/orbit';
import { massFlow, thrustAt } from '../physics/propulsion';
import { add, addScaled, angleBetween, cross, dot, norm, scale, sub, unit, type Vec3 } from '../physics/vec';
import { liftoffMass, liftoffThrust, type Vehicle } from './vehicle';

/** One telemetry frame. Units are SI unless the name says otherwise. */
export interface Sample {
  t: number;
  alt: number;
  downrange: number;
  lat: number;
  lon: number;
  vInertial: number;
  vRel: number;
  vVertical: number;
  mach: number;
  q: number;
  axialG: number;
  thrust: number;
  drag: number;
  mass: number;
  throttle: number;
  /** Thrust elevation above local horizontal [deg] */
  pitch: number;
  /** Inertial flight-path angle [deg] */
  gamma: number;
  /** Angle between thrust axis and air-relative velocity [deg] */
  aoa: number;
  qAlpha: number;
  rho: number;
  pressure: number;
  temperature: number;
  heatFlux: number;
  apo: number;
  peri: number;
  stage: number;
  boosters: boolean;
  fairing: boolean;
  propFraction: number;
  dvIdeal: number;
  lossGravity: number;
  lossDrag: number;
  lossSteering: number;
  pos: Vec3;
  dir: Vec3;
  burning: boolean;
}

export type EventKind =
  | 'liftoff'
  | 'pitch-kick'
  | 'mach-1'
  | 'max-q'
  | 'throttle-down'
  | 'throttle-up'
  | 'booster-sep'
  | 'meco'
  | 'stage-sep'
  | 'ignition'
  | 'fairing-sep'
  | 'karman'
  | 'seco'
  | 'depletion'
  | 'impact';

export interface FlightEvent {
  t: number;
  kind: EventKind;
  label: string;
  detail: string;
  alt: number;
  v: number;
}

export type Outcome = 'orbit' | 'low-orbit' | 'suborbital' | 'no-liftoff' | 'impact';

export interface FlightResult {
  vehicle: Vehicle;
  samples: Sample[];
  events: FlightEvent[];
  outcome: Outcome;
  verdict: string;
  final: OrbitalElements | null;
  /** State at engine cutoff (for orbit drawing) */
  cutoffState: { r: Vec3; v: Vec3; t: number } | null;
  launchAzimuth: number;
  maxQ: { q: number; t: number; alt: number };
  maxG: { g: number; t: number };
  maxHeat: { q: number; t: number };
  totals: { dvIdeal: number; lossGravity: number; lossDrag: number; lossSteering: number; vEarthAssist: number };
  computeMs: number;
  /** Propellant left in the active stage at cutoff [kg] — the performance margin */
  margin: number;
}

export interface SimOptions {
  dt?: number;
  coastAfterCutoff?: number;
  maxTime?: number;
}

/**
 * Launch azimuth for a target inclination, corrected for Earth rotation.
 * Inertial azimuth: sin β_i = cos i / cos φ (no solution if i < |φ|).
 * The pad already moves east at ω·R·cos φ, so the vehicle must aim its
 * *relative* velocity at β_r = atan2(V sin β_i − ωR cos φ, V cos β_i).
 */
export function launchAzimuth(latDeg: number, incDeg: number, targetAlt: number): number {
  const lat = latDeg * DEG;
  const ratio = Math.cos(incDeg * DEG) / Math.cos(lat);
  const bi = Math.asin(Math.max(-1, Math.min(1, ratio)));
  const V = Math.sqrt(MU_EARTH / (6378137 + targetAlt));
  const vEq = OMEGA_EARTH * 6378137 * Math.cos(lat);
  return Math.atan2(V * Math.sin(bi) - vEq, V * Math.cos(bi));
}

export function simulate(vehicle: Vehicle, opts: SimOptions = {}): FlightResult {
  const t0 = performance.now();
  const dt = opts.dt ?? 0.02;
  const coastAfter = opts.coastAfterCutoff ?? 300;
  const maxTime = opts.maxTime ?? 3600;
  const v = vehicle;
  const g = v.guidance;
  const nStages = v.stages.length;
  const hasBoosters = v.boosters.count > 0;

  // ---- initial state: on the pad, co-rotating with Earth ----
  const siteEcef = geodeticToECEF(v.site.lat * DEG, v.site.lon * DEG, v.site.elevation);
  let r: Vec3 = [...siteEcef];
  let vel: Vec3 = cross([0, 0, OMEGA_EARTH], r);
  const vEarthAssist = norm(vel);
  let t = 0;

  const az = launchAzimuth(v.site.lat, g.targetInclination, g.targetAltitude);
  const corePropLeft = v.stages.map((s) => s.propMass);
  let boosterProp = hasBoosters ? v.boosters.stage.propMass : 0;
  let boostersAttached = hasBoosters;
  let fairingAttached = v.fairing.mass > 0;
  let k = 0; // active core stage
  let coreLit = true;
  let pendingSepAt = -1;
  let pendingIgnAt = -1;
  let cutoff = false;
  let cutoffAt = Infinity;
  let cutoffState: FlightResult['cutoffState'] = null;
  let ended = false;
  let impact = false;
  let inBucket = false;
  let bucketLatch = false;
  let qPrev = 0;
  let passedMach1 = false;
  let passedKarman = false;
  let kickLogged = false;

  const lossT = { dvIdeal: 0, grav: 0, drag: 0, steer: 0 };
  const samples: Sample[] = [];
  const events: FlightEvent[] = [];
  let maxQ = { q: 0, t: 0, alt: 0 };
  let maxG = { g: 0, t: 0 };
  let maxHeat = { q: 0, t: 0 };

  const totalMass = () => {
    let m = v.payloadMass + (fairingAttached ? v.fairing.mass : 0);
    for (let j = k; j < nStages; j++) m += v.stages[j].dryMass + corePropLeft[j];
    if (boostersAttached) m += v.boosters.count * (v.boosters.stage.dryMass + boosterProp);
    return m;
  };
  const refArea = () => {
    const dCore = Math.max(v.stages[k].diameter, fairingAttached ? v.fairing.diameter : 0);
    let A = circleArea(dCore);
    if (boostersAttached) A += v.boosters.count * circleArea(v.boosters.stage.diameter);
    return A;
  };
  const altOf = (rr: Vec3, tt: number) => ecefToGeodetic(eciToEcef(rr, OMEGA_EARTH * tt)).h;

  const log = (kind: EventKind, label: string, detail: string) => {
    events.push({ t, kind, label, detail, alt: altOf(r, t), v: norm(vel) });
  };

  // Liftoff check: thrust must exceed weight at the pad
  const m0 = liftoffMass(v);
  const tw0 = liftoffThrust(v) / (m0 * G0);
  if (tw0 <= 1) {
    return {
      vehicle: v,
      samples: [],
      events: [],
      outcome: 'no-liftoff',
      verdict: `Thrust-to-weight at liftoff is ${tw0.toFixed(2)}. It must exceed 1.0 or the vehicle sits on the pad burning propellant. Add thrust or remove mass.`,
      final: null,
      cutoffState: null,
      launchAzimuth: az,
      maxQ,
      maxG,
      maxHeat,
      totals: { dvIdeal: 0, lossGravity: 0, lossDrag: 0, lossSteering: 0, vEarthAssist },
      computeMs: performance.now() - t0,
      margin: 0,
    };
  }
  events.push({ t: 0, kind: 'liftoff', label: 'Liftoff', detail: `T/W ${tw0.toFixed(2)}, mass ${(m0 / 1000).toFixed(0)} t`, alt: v.site.elevation, v: vEarthAssist });

  let sampleClock = 0;

  while (!ended && t < maxTime) {
    const alt = altOf(r, t);
    const atm = atmosphere(alt);
    const vrel = airRelativeVelocity(r, vel);
    const vrelM = norm(vrel);
    const mach = vrelM / atm.a;
    const q = 0.5 * atm.rho * vrelM * vrelM;
    const { up, east, north } = localFrame(r);
    const m = totalMass();
    const stage = v.stages[k];
    const eng = stage.engine;
    const coreBurning = coreLit && !cutoff && corePropLeft[k] > 0 && pendingIgnAt < 0 && pendingSepAt < 0;
    const boostBurning = boostersAttached && boosterProp > 0;

    // ---------- throttle law ----------
    let thr = 1;
    // Bucket with hysteresis: enter above qBucketStart, leave only once q has peaked and fallen 10 % below it
    if (k === 0 && g.qBucketThrottle < 1) {
      if (!inBucket && q > g.qBucketStart && q > qPrev) bucketLatch = true;
      if (bucketLatch && q < 0.9 * g.qBucketStart && q < qPrev) bucketLatch = false;
    } else bucketLatch = false;
    qPrev = q;
    if (bucketLatch) thr = Math.min(thr, g.qBucketThrottle);
    if (k === 0 && boostersAttached) thr = Math.min(thr, v.boosters.coreThrottleWhileAttached);
    const boostThrust = boostBurning ? thrustAt(v.boosters.stage.engine, atm.p) * v.boosters.count : 0;
    if (coreBurning) {
      // Axial-g limit: solve (F_vac·thr − p·Ae)·n + T_boost = gmax·g0·m for thr
      const need = (g.maxAxialG * G0 * m - boostThrust) / eng.count + atm.p * eng.exitArea;
      thr = Math.min(thr, need / eng.thrustVac);
      thr = Math.max(eng.throttleMin, Math.min(1, thr));
    } else thr = 0;
    const bucketNow = bucketLatch && coreBurning;
    if (bucketNow !== inBucket) {
      inBucket = bucketNow;
      if (bucketNow) log('throttle-down', 'Throttle bucket', `q above ${(g.qBucketStart / 1000).toFixed(0)} kPa, engines to ${(g.qBucketThrottle * 100).toFixed(0)} %`);
      else log('throttle-up', 'Throttle up', 'Through max-Q, engines back up');
    }

    // ---------- guidance ----------
    const azDir = add(scale(north, Math.cos(az)), scale(east, Math.sin(az)));
    const kickDir = (ang: number) => unit(add(scale(up, Math.cos(ang)), scale(azDir, Math.sin(ang))));
    let dir: Vec3;
    const coreThrust = coreBurning ? thrustAt(eng, atm.p, thr) : 0;
    const thrust = coreThrust + boostThrust;
    if (k === 0) {
      const tk = g.verticalRiseTime;
      const kick = g.pitchKickAngle * DEG;
      if (t < tk) dir = up;
      else if (t < tk + g.pitchKickDuration) {
        dir = kickDir((kick * (t - tk)) / g.pitchKickDuration);
        if (!kickLogged) {
          kickLogged = true;
          log('pitch-kick', 'Pitch kick', `Rolling onto azimuth ${(((az * RAD) % 360) + 360) % 360 | 0}° and pitching ${g.pitchKickAngle}° downrange`);
        }
      } else {
        // Gravity turn: once the velocity vector has fallen past the kick angle, ride it at α = 0
        const fromVertical = angleBetween(vrel, up);
        dir = fromVertical < kick ? kickDir(kick) : unit(vrel);
      }
    } else {
      dir = upperStageSteering(r, vel, up, east, north, alt, g.targetAltitude, g.targetInclination * DEG, thrust, m, eng.ispVac);
    }

    // ---------- step size: land exactly on propellant depletion ----------
    const mdotCore = coreBurning ? massFlow(eng, thr) : 0;
    const mdotBoost = boostBurning ? massFlow(v.boosters.stage.engine) * v.boosters.count : 0;
    let h = cutoff || (!coreBurning && !boostBurning) ? (t > cutoffAt + 5 || !cutoff ? 0.5 : dt) : dt;
    if (!cutoff && !coreBurning && !boostBurning && (pendingIgnAt >= 0 || pendingSepAt >= 0)) h = dt;
    if (mdotCore > 0) h = Math.min(h, corePropLeft[k] / mdotCore);
    if (mdotBoost > 0) h = Math.min(h, (boosterProp * v.boosters.count) / mdotBoost);
    if (pendingSepAt >= 0) h = Math.min(h, Math.max(pendingSepAt - t, 1e-4));
    if (pendingIgnAt >= 0) h = Math.min(h, Math.max(pendingIgnAt - t, 1e-4));
    h = Math.max(h, 1e-5);
    const mdot = mdotCore + mdotBoost;
    const Aref = refArea();

    // ---------- sample before stepping ----------
    const gvec = gravityJ2(r);
    const drag = q * cdAt(v.cd, mach) * Aref;
    const aoa = vrelM > 1 && thrust > 0 ? angleBetween(dir, vrel) : 0;
    const axial = (thrust - drag * Math.cos(aoa)) / m / G0;
    const heat = suttonGraves(atm.rho, vrelM, v.noseRadius);
    if (q > maxQ.q) maxQ = { q, t, alt };
    if (axial > maxG.g) maxG = { g: axial, t };
    if (heat > maxHeat.q) maxHeat = { q: heat, t };

    if (t >= sampleClock || samples.length === 0) {
      const el = elementsFromState(r, vel);
      const geo = ecefToGeodetic(eciToEcef(r, OMEGA_EARTH * t));
      samples.push({
        t,
        alt,
        downrange: greatCircle(siteEcef, eciToEcef(r, OMEGA_EARTH * t)),
        lat: geo.lat * RAD,
        lon: geo.lon * RAD,
        vInertial: norm(vel),
        vRel: vrelM,
        vVertical: dot(vel, up),
        mach,
        q,
        axialG: thrust > 0 || drag > 0 ? axial : 0,
        thrust,
        drag,
        mass: m,
        throttle: coreBurning ? thr : 0,
        pitch: 90 - angleBetween(dir, up) * RAD,
        gamma: flightPathAngle(r, vel) * RAD,
        aoa: aoa * RAD,
        qAlpha: q * aoa * RAD,
        rho: atm.rho,
        pressure: atm.p,
        temperature: atm.T,
        heatFlux: heat,
        apo: el.apo,
        peri: el.peri,
        stage: k,
        boosters: boostersAttached,
        fairing: fairingAttached,
        propFraction: corePropLeft[k] / v.stages[k].propMass,
        dvIdeal: lossT.dvIdeal,
        lossGravity: lossT.grav,
        lossDrag: lossT.drag,
        lossSteering: lossT.steer,
        pos: r,
        dir,
        burning: thrust > 0,
      });
      sampleClock = t + (thrust > 0 ? 0.2 : 1.0);
    }

    // ---------- RK4 ----------
    const deriv = (rr: Vec3, vv: Vec3, tau: number): [Vec3, Vec3] => {
      const mm = m - mdot * tau;
      const tt = t + tau;
      const z = altOf(rr, tt);
      const a2 = atmosphere(z);
      const vr2 = airRelativeVelocity(rr, vv);
      const vr2m = norm(vr2);
      const q2 = 0.5 * a2.rho * vr2m * vr2m;
      const D = q2 * cdAt(v.cd, vr2m / a2.a) * Aref;
      const T2 =
        (coreBurning ? thrustAt(eng, a2.p, thr) : 0) +
        (boostBurning ? thrustAt(v.boosters.stage.engine, a2.p) * v.boosters.count : 0);
      let acc = gravityJ2(rr);
      acc = addScaled(acc, dir, T2 / mm);
      if (vr2m > 1e-6) acc = addScaled(acc, vr2, -D / (mm * vr2m));
      return [vv, acc];
    };
    const [k1r, k1v] = deriv(r, vel, 0);
    const [k2r, k2v] = deriv(addScaled(r, k1r, h / 2), addScaled(vel, k1v, h / 2), h / 2);
    const [k3r, k3v] = deriv(addScaled(r, k2r, h / 2), addScaled(vel, k2v, h / 2), h / 2);
    const [k4r, k4v] = deriv(addScaled(r, k3r, h), addScaled(vel, k3v, h), h);
    const rNew = addScaled(r, add(add(k1r, scale(k2r, 2)), add(scale(k3r, 2), k4r)), h / 6);
    const vNew = addScaled(vel, add(add(k1v, scale(k2v, 2)), add(scale(k3v, 2), k4v)), h / 6);

    // ---------- loss accounting (Δv budget) ----------
    if (thrust > 0) {
      lossT.dvIdeal += (thrust / m) * h;
      lossT.steer += (thrust / m) * (1 - Math.cos(angleBetween(dir, vel))) * h;
    }
    if (thrust > 0 || !cutoff) {
      lossT.grav += norm(gvec) * Math.sin(flightPathAngle(r, vel)) * h;
      lossT.drag += (drag / m) * h;
    }

    r = rNew;
    vel = vNew;
    t += h;
    if (coreBurning) corePropLeft[k] = Math.max(0, corePropLeft[k] - mdotCore * h);
    if (boostBurning) boosterProp = Math.max(0, boosterProp - (mdotBoost * h) / v.boosters.count);
    if (corePropLeft[k] < 1e-6) corePropLeft[k] = 0;
    if (boosterProp < 1e-6) boosterProp = 0;

    // ---------- events ----------
    const altNow = altOf(r, t);
    if (altNow < -1 && t > 5) {
      impact = true;
      log('impact', 'Ground impact', 'Vehicle returned to the surface');
      break;
    }
    const machNow = norm(airRelativeVelocity(r, vel)) / atmosphere(altNow).a;
    if (!passedMach1 && machNow >= 1 && altNow < 80e3) {
      passedMach1 = true;
      log('mach-1', 'Supersonic', 'Mach 1: shock waves form, drag coefficient peaks');
    }
    if (!passedKarman && altNow >= 100e3) {
      passedKarman = true;
      log('karman', 'Kármán line', '100 km: the conventional edge of space');
    }
    if (fairingAttached && altNow >= v.fairing.jettisonAltitude) {
      fairingAttached = false;
      log('fairing-sep', 'Fairing separation', `${(v.fairing.mass / 1000).toFixed(1)} t of fairing no longer has to be accelerated`);
    }
    if (boostersAttached && boosterProp <= 0) {
      boostersAttached = false;
      log('booster-sep', 'Booster separation', `${v.boosters.count} × ${v.boosters.stage.name.toLowerCase()} jettisoned`);
    }
    if (!cutoff && coreLit && corePropLeft[k] <= 0 && pendingSepAt < 0) {
      coreLit = false;
      if (boostersAttached) {
        boostersAttached = false;
        log('booster-sep', 'Booster separation', 'Boosters jettisoned with the core');
      }
      if (k < nStages - 1) {
        log('meco', k === 0 ? 'Main engine cutoff' : `Stage ${k + 1} cutoff`, `${stage.name} propellant depleted`);
        pendingSepAt = t + g.separationCoast;
      } else {
        log('depletion', 'Propellant depleted', 'Final stage empty before reaching target orbit');
        cutoff = true;
        cutoffAt = t;
        cutoffState = { r: [...r], v: [...vel], t };
      }
    }
    if (pendingSepAt >= 0 && t >= pendingSepAt - 1e-9) {
      pendingSepAt = -1;
      k += 1;
      log('stage-sep', 'Stage separation', `${v.stages[k - 1].name} falls away`);
      pendingIgnAt = t + g.ignitionDelay;
    }
    if (pendingIgnAt >= 0 && t >= pendingIgnAt - 1e-9) {
      pendingIgnAt = -1;
      coreLit = true;
      log('ignition', `${v.stages[k].name} ignition`, `${v.stages[k].engine.count} × ${v.stages[k].engine.name}`);
    }
    // Cutoff on energy: semi-major axis has reached the target circular radius
    if (!cutoff && k > 0 && coreLit) {
      const el = elementsFromState(r, vel);
      const rTarget = norm(r) - altNow + g.targetAltitude;
      if (el.a >= rTarget) {
        cutoff = true;
        coreLit = false;
        cutoffAt = t;
        cutoffState = { r: [...r], v: [...vel], t };
        log('seco', k === nStages - 1 ? 'Orbit insertion cutoff' : `Cutoff on ${v.stages[k].name}`, `Orbital energy reached target; ${(corePropLeft[k] / 1000).toFixed(1)} t propellant left`);
      }
    }
    if (cutoff && t > cutoffAt + coastAfter) ended = true;
  }

  // Max-Q event placed at the true peak
  if (maxQ.q > 0) {
    events.push({ t: maxQ.t, kind: 'max-q', label: 'Max-Q', detail: `Peak dynamic pressure ${(maxQ.q / 1000).toFixed(1)} kPa`, alt: maxQ.alt, v: 0 });
    events.sort((a, b) => a.t - b.t);
  }

  const final = cutoffState ? elementsFromState(cutoffState.r, cutoffState.v) : null;
  let outcome: Outcome;
  let verdict: string;
  if (impact && (!final || final.peri < 0)) {
    outcome = 'impact';
    verdict = 'The vehicle did not build enough horizontal speed and fell back. Check the Δv budget and the pitch program.';
  } else if (final && final.peri > 150e3) {
    outcome = 'orbit';
    verdict = `Stable orbit: ${(final.peri / 1000).toFixed(0)} × ${(final.apo / 1000).toFixed(0)} km at ${(final.i * RAD).toFixed(2)}°.`;
  } else if (final && final.peri > 100e3) {
    outcome = 'low-orbit';
    verdict = `Orbit reached, but the ${(final.peri / 1000).toFixed(0)} km periapsis dips into the thermosphere; drag will bring it down within days.`;
  } else {
    outcome = 'suborbital';
    verdict = final
      ? `Suborbital: periapsis ${(final.peri / 1000).toFixed(0)} km is below the surface or the atmosphere. More Δv or a flatter trajectory is needed.`
      : 'Flight ended before cutoff.';
  }

  return {
    vehicle: v,
    samples,
    events,
    outcome,
    verdict,
    final,
    cutoffState,
    launchAzimuth: az,
    maxQ,
    maxG,
    maxHeat,
    totals: { dvIdeal: lossT.dvIdeal, lossGravity: lossT.grav, lossDrag: lossT.drag, lossSteering: lossT.steer, vEarthAssist },
    computeMs: performance.now() - t0,
    margin: cutoffState ? corePropLeft[k] : 0,
  };
}

/**
 * Upper-stage closed-loop steering.
 *
 * Choose a vertical acceleration profile that is linear in time and brings
 * both altitude error Δh and vertical speed ṙ to zero at burnout t_go:
 *   a_r(0) = 6·Δh / t_go² − 4·ṙ / t_go
 * The thrust must supply that plus gravity, minus the "centrifugal" relief
 * of horizontal motion (v_h² / r). Everything left over goes horizontal.
 * t_go comes from the rocket equation for the remaining horizontal Δv.
 * This is the core idea behind linear-tangent / PEG-family guidance.
 */
function upperStageSteering(
  r: Vec3,
  vel: Vec3,
  up: Vec3,
  east: Vec3,
  north: Vec3,
  alt: number,
  targetAlt: number,
  inc: number,
  thrust: number,
  m: number,
  isp: number,
): Vec3 {
  const rm = norm(r);
  const vr = dot(vel, up);
  const vhVec = addScaled(vel, up, -vr);
  const vh = norm(vhVec);
  const rT = rm - alt + targetAlt;
  const vc = Math.sqrt(MU_EARTH / rT);
  // Desired inertial heading that lies in the target plane at this latitude (ascending pass)
  const cosLat = Math.sqrt(Math.max(0, 1 - up[2] * up[2]));
  const sinBeta = Math.max(-1, Math.min(1, Math.cos(inc) / Math.max(cosLat, 1e-6)));
  const goingNorth = dot(vel, north) >= 0;
  const cosBeta = Math.sqrt(1 - sinBeta * sinBeta) * (goingNorth ? 1 : -1);
  const headingT = add(scale(north, cosBeta), scale(east, sinBeta));
  // Velocity-to-be-gained, horizontal part: steers magnitude *and* plane at once
  const vgoH = sub(scale(headingT, vc), vhVec);
  const hHat = norm(vgoH) > 1 ? unit(vgoH) : headingT;
  if (thrust <= 0) return hHat;
  const ve = isp * G0;
  const dvGo = Math.max(Math.hypot(norm(vgoH), vr), 1);
  const mdot = thrust / ve;
  const tgo = Math.max((m / mdot) * (1 - Math.exp(-dvGo / ve)), 8);
  const dh = targetAlt - alt;
  const aCmd = (6 * dh) / (tgo * tgo) - (4 * vr) / tgo;
  const gLocal = MU_EARTH / (rm * rm);
  const aRadial = aCmd + gLocal - (vh * vh) / rm;
  const s = Math.max(-0.6, Math.min(0.85, aRadial / (thrust / m)));
  return unit(add(scale(up, s), scale(hHat, Math.sqrt(1 - s * s))));
}
