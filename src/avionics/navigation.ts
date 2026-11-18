import { G0 } from '../physics/constants';
import { rng } from '../sim/analysis';
import { sampleAt } from '../sim/playback';
import type { Sample } from '../sim/simulate';
import { add, eye, inv, mul, sub, transpose, zeros, type Mat } from './linalg';

/**
 * Strapdown inertial navigation error growth and GNSS aiding, in the vertical
 * plane of the trajectory (x downrange-horizontal, z up).
 *
 * Error-state model (small tilt θ about the cross-range axis):
 *   δṗ = δv
 *   δv̇ = θ·(−f_z, f_x) + C_bn·b_a + w_a          tilt projects specific force
 *   θ̇  = b_g + w_g                               gyro bias integrates to tilt
 *   ḃ_a = 0,  ḃ_g = 0                            (turn-on bias, constant per run)
 * f is the true specific force from the flight (thrust − drag)/m along the
 * thrust axis; C_bn rotates body axes by the pitch angle.
 *
 * "Truth" errors are propagated with random biases and white noise drawn from
 * the sensor grade. The Kalman filter only sees GNSS position fixes (with
 * their own noise) and estimates the 8-state error vector; the navigation
 * error that remains is truth − estimate.
 */

export interface ImuGrade {
  id: string;
  name: string;
  example: string;
  /** Gyro turn-on bias [deg/h] */
  gyroBias: number;
  /** Angle random walk [deg/√h] */
  arw: number;
  /** Accelerometer bias [µg] */
  accelBias: number;
  /** Velocity random walk [m/s/√h] */
  vrw: number;
}

/** Order-of-magnitude grade values as tabulated in the inertial navigation literature (e.g. Groves, 2013). */
export const IMU_GRADES: ImuGrade[] = [
  { id: 'consumer', name: 'Consumer MEMS', example: 'phone / drone IMU', gyroBias: 30, arw: 0.5, accelBias: 3000, vrw: 0.2 },
  { id: 'tactical', name: 'Tactical (FOG / high-end MEMS)', example: 'fibre-optic gyro IMU class', gyroBias: 1, arw: 0.07, accelBias: 300, vrw: 0.05 },
  { id: 'navigation', name: 'Navigation (ring-laser gyro)', example: 'RLG IMU class, launch vehicles', gyroBias: 0.01, arw: 0.003, accelBias: 30, vrw: 0.01 },
];

export interface GnssSpec {
  enabled: boolean;
  /** Fix rate [Hz] */
  rate: number;
  /** 1-σ position noise [m] */
  sigmaH: number;
  sigmaV: number;
  /**
   * Export-control ("CoCom") limit built into commercial receivers: no fix
   * above 18 km altitude and 515 m/s. Space-qualified receivers are exempt.
   */
  cocom: boolean;
}

export interface NavPoint {
  t: number;
  /** INS-only position error magnitude [m] */
  insErr: number;
  /** Aided position error magnitude [m] */
  aidedErr: number;
  /** Filter's own 3-σ position bound [m] */
  bound3: number;
  /** INS-only velocity error [m/s] */
  insVel: number;
  aidedVel: number;
  tiltDeg: number;
  gnss: boolean;
}

export interface NavResult {
  points: NavPoint[];
  insFinal: number;
  aidedFinal: number;
  gnssLostAt: number | null;
}

const DEG = Math.PI / 180;

export function simulateNavigation(samples: Sample[], grade: ImuGrade, gnss: GnssSpec, seed = 1, tEnd?: number): NavResult {
  const r = rng(seed);
  const dt = 0.1;
  const end = Math.min(tEnd ?? samples[samples.length - 1].t, samples[samples.length - 1].t);
  // Convert grade to SI
  const bg = grade.gyroBias * (DEG / 3600) * r.normal();
  const ba = [grade.accelBias * 1e-6 * G0 * r.normal(), grade.accelBias * 1e-6 * G0 * r.normal()];
  const sArw = grade.arw * (DEG / 60); // rad/√s
  const sVrw = grade.vrw / 60; // m/s/√s
  // Truth error state [px pz vx vz θ bax baz bg]
  const xt = [0, 0, 0, 0, 0, ba[0], ba[1], bg];
  // Filter
  let xh = new Array(8).fill(0);
  const sb = grade.accelBias * 1e-6 * G0;
  const sg = grade.gyroBias * (DEG / 3600);
  let P: Mat = zeros(8);
  // Pre-launch alignment leaves sub-metre position and a tilt set by accelerometer bias / g
  const init = [1, 1, 0.05, 0.05, Math.max(sb / G0, 1e-5), sb, sb, sg];
  init.forEach((s, i) => (P[i][i] = s * s));
  const Qc = [0, 0, sVrw * sVrw, sVrw * sVrw, sArw * sArw, 0, 0, 0];
  const H: Mat = [
    [1, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 0, 0, 0, 0, 0, 0],
  ];
  const Rm: Mat = [
    [gnss.sigmaH ** 2, 0],
    [0, gnss.sigmaV ** 2],
  ];
  const points: NavPoint[] = [];
  let gnssLostAt: number | null = null;
  const fixEvery = Math.max(1, Math.round(1 / (gnss.rate * dt)));
  let step = 0;
  for (let t = 0; t <= end; t += dt, step++) {
    const s = sampleAt(samples, t);
    const pitch = s.pitch * DEG;
    const fmag = s.burning ? s.axialG * G0 : 0;
    const fx = fmag * Math.cos(pitch);
    const fz = fmag * Math.sin(pitch);
    const c = Math.cos(pitch);
    const sn = Math.sin(pitch);
    // Continuous F
    const F: Mat = zeros(8);
    F[0][2] = 1;
    F[1][3] = 1;
    F[2][4] = -fz;
    F[3][4] = fx;
    F[2][5] = c;
    F[2][6] = -sn;
    F[3][5] = sn;
    F[3][6] = c;
    F[4][7] = 1;
    const Phi = add(eye(8), F.map((row) => row.map((v) => v * dt)));
    // Truth propagation with white noise
    const wv = [sVrw * Math.sqrt(dt) * r.normal(), sVrw * Math.sqrt(dt) * r.normal()];
    const wt = sArw * Math.sqrt(dt) * r.normal();
    const xn = Phi.map((row) => row.reduce((a, v, j) => a + v * xt[j], 0));
    xn[2] += wv[0];
    xn[3] += wv[1];
    xn[4] += wt;
    for (let i = 0; i < 8; i++) xt[i] = xn[i];
    // Filter time update
    xh = Phi.map((row) => row.reduce((a, v, j) => a + v * xh[j], 0));
    P = add(mul(mul(Phi, P), transpose(Phi)), Qc.map((q, i) => Qc.map((_, j) => (i === j ? q * dt : 0))));
    // GNSS measurement update
    const cocomBlocked = gnss.cocom && s.alt > 18000 && s.vRel > 515;
    const fix = gnss.enabled && !cocomBlocked && step % fixEvery === 0 && t > 0;
    if (gnss.enabled && cocomBlocked && gnssLostAt === null) gnssLostAt = t;
    if (fix) {
      const z = [xt[0] + gnss.sigmaH * r.normal(), xt[1] + gnss.sigmaV * r.normal()];
      const S = add(mul(mul(H, P), transpose(H)), Rm);
      const K = mul(mul(P, transpose(H)), inv(S));
      const innov = [z[0] - xh[0], z[1] - xh[1]];
      xh = xh.map((v, i) => v + K[i][0] * innov[0] + K[i][1] * innov[1]);
      // Joseph form keeps P symmetric positive-definite
      const IKH = sub(eye(8), mul(K, H));
      P = add(mul(mul(IKH, P), transpose(IKH)), mul(mul(K, Rm), transpose(K)));
    }
    if (step % 10 === 0) {
      const ex = xt[0] - xh[0];
      const ez = xt[1] - xh[1];
      points.push({
        t,
        insErr: Math.hypot(xt[0], xt[1]),
        aidedErr: gnss.enabled ? Math.hypot(ex, ez) : Math.hypot(xt[0], xt[1]),
        bound3: 3 * Math.sqrt(P[0][0] + P[1][1]),
        insVel: Math.hypot(xt[2], xt[3]),
        aidedVel: gnss.enabled ? Math.hypot(xt[2] - xh[2], xt[3] - xh[3]) : Math.hypot(xt[2], xt[3]),
        tiltDeg: xt[4] / DEG,
        gnss: fix || (gnss.enabled && !cocomBlocked),
      });
    }
  }
  const last = points[points.length - 1];
  return { points, insFinal: last?.insErr ?? 0, aidedFinal: last?.aidedErr ?? 0, gnssLostAt };
}
