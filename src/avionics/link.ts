import { geodeticToECEF, localFrame } from '../physics/earth';
import { dot, norm, sub } from '../physics/vec';
import type { Sample } from '../sim/simulate';
import type { LaunchSite } from '../sim/vehicle';

/**
 * Downlink budget from the vehicle to a ground station:
 *
 *   C/N0 = EIRP − L_fs − L_misc + G/T − k            [dB-Hz]
 *   Eb/N0 = C/N0 − 10·log10(R_b)                     [dB]
 *   L_fs  = 20·log10(4π d f / c)                     free-space path loss
 *   k     = −228.6 dBW/(K·Hz)                        Boltzmann's constant
 *
 * Margin = Eb/N0 − (Eb/N0 required by the modulation/coding + implementation loss).
 */

export const C_LIGHT = 299792458;
export const K_BOLTZ_DB = -228.6;

export const db = (x: number) => 10 * Math.log10(x);
export const fspl = (d: number, f: number) => 20 * Math.log10((4 * Math.PI * d * f) / C_LIGHT);
/** Parabolic dish gain [dBi]: G = η (π D f / c)² */
export const dishGain = (D: number, f: number, eff = 0.55) => db(eff * ((Math.PI * D * f) / C_LIGHT) ** 2);
/** Half-power beamwidth of a dish [deg] ≈ 70 λ / D */
export const beamwidth = (D: number, f: number) => (70 * C_LIGHT) / (f * D);

/** Complementary error function (Abramowitz & Stegun 7.1.26, |ε| < 1.5e-7). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z);
  return x >= 0 ? y : 2 - y;
}

/** Uncoded BPSK/QPSK bit error rate at Eb/N0 [dB]: ½·erfc(√(Eb/N0)). */
export const berBpsk = (ebn0Db: number) => 0.5 * erfc(Math.sqrt(10 ** (ebn0Db / 10)));

export interface Coding {
  id: string;
  name: string;
  /** Eb/N0 for BER 1e-5 [dB] */
  required: number;
}

/** Textbook Eb/N0 thresholds at BER 10⁻⁵ (BPSK). */
export const CODINGS: Coding[] = [
  { id: 'uncoded', name: 'Uncoded BPSK', required: 9.6 },
  { id: 'conv', name: 'Convolutional r=½, K=7 (Viterbi)', required: 4.4 },
  { id: 'rs-conv', name: 'Reed–Solomon (255,223) + convolutional', required: 2.5 },
  { id: 'ldpc', name: 'LDPC r=½ (CCSDS AR4JA class)', required: 1.5 },
];

export interface LinkSpec {
  freq: number;
  txPowerW: number;
  txGainDbi: number;
  txLossDb: number;
  dishD: number;
  dishEff: number;
  tSys: number;
  rxLossDb: number;
  atmLossDb: number;
  /** Extra attenuation through the exhaust plume while an engine burns [dB] */
  plumeLossDb: number;
  rate: number;
  coding: Coding;
  implLossDb: number;
  /** Station mask: below this elevation the antenna can't track [deg] */
  minElevation: number;
}

export interface LinkPoint {
  t: number;
  range: number;
  elevation: number;
  ebn0: number;
  margin: number;
  doppler: number;
  rangeRate: number;
  visible: boolean;
}

export function stationGT(L: LinkSpec) {
  return dishGain(L.dishD, L.freq, L.dishEff) - L.rxLossDb - db(L.tSys);
}

export function ebn0At(L: LinkSpec, range: number, burning: boolean) {
  const eirp = db(L.txPowerW) + L.txGainDbi - L.txLossDb;
  const cn0 = eirp - fspl(range, L.freq) - L.atmLossDb - (burning ? L.plumeLossDb : 0) + stationGT(L) - K_BOLTZ_DB;
  return cn0 - db(L.rate);
}

/** Ground station at the launch site (or offset downrange) tracking the flight. */
export function linkTimeline(samples: Sample[], site: LaunchSite, L: LinkSpec, station?: { lat: number; lon: number; h: number }): LinkPoint[] {
  const st = station ?? { lat: site.lat, lon: site.lon, h: site.elevation };
  const gs = geodeticToECEF((st.lat * Math.PI) / 180, (st.lon * Math.PI) / 180, st.h + 10);
  const { up } = localFrame(gs);
  const pts: LinkPoint[] = [];
  let prev: { t: number; range: number } | null = null;
  for (const s of samples) {
    if (prev && s.t - prev.t < 0.99) continue;
    const p = geodeticToECEF((s.lat * Math.PI) / 180, (s.lon * Math.PI) / 180, s.alt);
    const los = sub(p, gs);
    const range = Math.max(norm(los), 50);
    const elevation = (Math.asin(Math.max(-1, Math.min(1, dot(los, up) / range))) * 180) / Math.PI;
    const rangeRate = prev ? (range - prev.range) / (s.t - prev.t) : 0;
    const ebn0 = ebn0At(L, range, s.burning);
    const visible = elevation >= L.minElevation || s.t < 10;
    pts.push({
      t: s.t,
      range,
      elevation,
      ebn0,
      margin: ebn0 - L.coding.required - L.implLossDb,
      doppler: (-rangeRate * L.freq) / C_LIGHT,
      rangeRate,
      visible,
    });
    prev = { t: s.t, range };
  }
  return pts;
}
