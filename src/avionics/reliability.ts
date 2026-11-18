/**
 * Fault tolerance for flight computers.
 *
 * With a constant failure rate λ, one unit survives time t with R = e^(−λt).
 *   simplex:            R
 *   dual (1-of-2):      1 − (1 − R)²            (needs a way to tell which one failed)
 *   TMR (2-of-3 vote):  R_v · (3R² − 2R³)
 * TMR beats simplex only while R > ½, i.e. for t < ln 2 / λ: voting buys
 * reliability for short missions (a launch) at the cost of three times the
 * hardware. Long missions need repair or reconfiguration instead.
 */

export const rSimplex = (lambda: number, t: number) => Math.exp(-lambda * t);
export const rDual = (lambda: number, t: number) => 1 - (1 - rSimplex(lambda, t)) ** 2;
export const rTmr = (lambda: number, t: number, rVoter = 1) => {
  const r = rSimplex(lambda, t);
  return rVoter * (3 * r * r - 2 * r * r * r);
};
/** Mean time to failure of TMR without repair: 5 / (6 λ) — shorter than simplex's 1/λ. */
export const mttfTmr = (lambda: number) => 5 / (6 * lambda);

/* --- SECDED: Hamming(7,4) plus an overall parity bit = (8,4) --- */

/** Codeword positions 1..7 (p1 p2 d1 p4 d2 d3 d4), position 0 holds overall parity. */
export function encodeSecded(d: [number, number, number, number]): number[] {
  const [d1, d2, d3, d4] = d;
  const p1 = d1 ^ d2 ^ d4;
  const p2 = d1 ^ d3 ^ d4;
  const p4 = d2 ^ d3 ^ d4;
  const w = [0, p1, p2, d1, p4, d2, d3, d4];
  w[0] = w.slice(1).reduce((a, b) => a ^ b, 0);
  return w;
}

export interface SecdedResult {
  syndrome: number;
  overallOk: boolean;
  status: 'clean' | 'corrected' | 'double-error';
  corrected: number[];
  data: number[];
}

export function decodeSecded(w: number[]): SecdedResult {
  const s1 = w[1] ^ w[3] ^ w[5] ^ w[7];
  const s2 = w[2] ^ w[3] ^ w[6] ^ w[7];
  const s4 = w[4] ^ w[5] ^ w[6] ^ w[7];
  const syndrome = s1 | (s2 << 1) | (s4 << 2);
  const overall = w.reduce((a, b) => a ^ b, 0);
  const c = [...w];
  let status: SecdedResult['status'] = 'clean';
  if (syndrome === 0 && overall === 0) status = 'clean';
  else if (overall === 1) {
    // Odd number of flips → single error at `syndrome` (0 = the parity bit itself)
    c[syndrome] ^= 1;
    status = 'corrected';
  } else status = 'double-error';
  return { syndrome, overallOk: overall === 0, status, corrected: c, data: [c[3], c[5], c[6], c[7]] };
}

/**
 * Memory scrubbing: with per-bit upset rate λ_b [upsets/bit/day] and a scrub
 * every T, a SECDED word of n bits fails only if ≥ 2 of its bits flip before
 * the scrubber rewrites it. For small λT:
 *   P_word ≈ C(n,2) · (λ_b T)²
 * Expected uncorrectable words over a mission of M words and duration D:
 *   E ≈ M · (D / T) · P_word
 */
export function uncorrectable(words: number, bitsPerWord: number, lambdaBitDay: number, scrubSec: number, missionSec: number) {
  const x = lambdaBitDay * (scrubSec / 86400);
  const pWord = ((bitsPerWord * (bitsPerWord - 1)) / 2) * x * x;
  return words * (missionSec / scrubSec) * pWord;
}

/** Without any EDAC, every single upset corrupts data. */
export const rawUpsets = (bits: number, lambdaBitDay: number, missionSec: number) => bits * lambdaBitDay * (missionSec / 86400);
