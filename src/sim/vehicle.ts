import type { CdTable } from '../physics/aero';
import { G0, P0 } from '../physics/constants';
import { idealDeltaV, ispAt, massFlow, seaLevelThrust, tankVolumes, type EngineSpec, type PropellantKind } from '../physics/propulsion';

export interface StageSpec {
  name: string;
  /** Structure, engines, avionics, residuals [kg] */
  dryMass: number;
  /** Usable propellant [kg] */
  propMass: number;
  diameter: number;
  length: number;
  propellant: PropellantKind;
  /** Oxidiser-to-fuel mass ratio */
  mixtureRatio: number;
  engine: EngineSpec;
}

export interface BoosterSpec {
  /** 0 disables side boosters */
  count: number;
  stage: StageSpec;
  /** Core-stage throttle while boosters are attached (lets the core keep propellant for later) */
  coreThrottleWhileAttached: number;
}

export interface FairingSpec {
  mass: number;
  diameter: number;
  length: number;
  /** Jettison altitude [m] — once free-molecular heating is negligible */
  jettisonAltitude: number;
}

export interface GuidanceSpec {
  /** Seconds of purely vertical flight to clear the tower */
  verticalRiseTime: number;
  /** Pitch-over angle from vertical at the end of the kick [deg] */
  pitchKickAngle: number;
  /** Duration of the pitch-over manoeuvre [s] */
  pitchKickDuration: number;
  /** Target circular orbit altitude [m] */
  targetAltitude: number;
  /** Target inclination [deg] */
  targetInclination: number;
  /** Dynamic pressure that triggers the throttle bucket [Pa] */
  qBucketStart: number;
  /** Throttle used inside the bucket, 0–1 */
  qBucketThrottle: number;
  /** Axial acceleration limit [g] — throttles back late in each burn */
  maxAxialG: number;
  /** Coast between cutoff and stage separation [s] */
  separationCoast: number;
  /** Delay from separation to upper-stage ignition [s] (ullage / clearance) */
  ignitionDelay: number;
}

export interface LaunchSite {
  name: string;
  lat: number;
  lon: number;
  elevation: number;
}

export interface Vehicle {
  id: string;
  name: string;
  summary: string;
  stages: StageSpec[];
  boosters: BoosterSpec;
  fairing: FairingSpec;
  payloadMass: number;
  /** Nose radius for heating estimate [m] */
  noseRadius: number;
  cd: CdTable;
  guidance: GuidanceSpec;
  site: LaunchSite;
}

export const stageWetMass = (s: StageSpec) => s.dryMass + s.propMass;

export const boosterSetMass = (v: Vehicle) =>
  v.boosters.count > 0 ? v.boosters.count * stageWetMass(v.boosters.stage) : 0;

export const liftoffMass = (v: Vehicle) =>
  v.stages.reduce((a, s) => a + stageWetMass(s), 0) + boosterSetMass(v) + v.fairing.mass + v.payloadMass;

export const liftoffThrust = (v: Vehicle) => {
  const core = seaLevelThrust(v.stages[0].engine) * (v.boosters.count > 0 ? v.boosters.coreThrottleWhileAttached : 1);
  const boost = v.boosters.count > 0 ? seaLevelThrust(v.boosters.stage.engine) * v.boosters.count : 0;
  return core + boost;
};

/** Everything a student would compute by hand before a flight, per stage. */
export interface StageAnalysis {
  name: string;
  m0: number;
  mf: number;
  massRatio: number;
  structuralRatio: number;
  ispVac: number;
  ispSL: number;
  burnTime: number;
  twIgnition: number;
  dvVacuum: number;
  tanks: ReturnType<typeof tankVolumes>;
}

/**
 * Hand-calc stage table: assumes stages burn sequentially and boosters are
 * treated as a parallel "stage 0" — the standard first-order sizing method.
 */
export function analyse(v: Vehicle): StageAnalysis[] {
  const out: StageAnalysis[] = [];
  const upperMass = (k: number) =>
    v.stages.slice(k + 1).reduce((a, s) => a + stageWetMass(s), 0) + v.payloadMass + (k === 0 ? v.fairing.mass : 0);
  v.stages.forEach((s, k) => {
    const m0 = stageWetMass(s) + upperMass(k);
    const mf = m0 - s.propMass;
    const thr = k === 0 ? seaLevelThrust(s.engine) : s.engine.thrustVac * s.engine.count;
    out.push({
      name: s.name,
      m0,
      mf,
      massRatio: m0 / mf,
      structuralRatio: s.dryMass / stageWetMass(s),
      ispVac: s.engine.ispVac,
      ispSL: ispAt(s.engine, P0),
      burnTime: s.propMass / massFlow(s.engine),
      twIgnition: thr / (m0 * G0),
      dvVacuum: idealDeltaV(s.engine.ispVac, m0, mf),
      tanks: tankVolumes(s.propellant, s.propMass, s.mixtureRatio),
    });
  });
  return out;
}

export const cloneVehicle = (v: Vehicle): Vehicle => JSON.parse(JSON.stringify(v));
