/**
 * MIL-STD-1553B command/response data bus.
 *
 * 1 Mbit/s, Manchester II bi-phase on a transformer-coupled twisted pair.
 * Every word is 20 bit-times (20 µs): a 3 µs sync, 16 data bits, odd parity.
 *   command/status sync: 1.5 µs high then 1.5 µs low
 *   data sync:           1.5 µs low  then 1.5 µs high
 *   Manchester II: logic 1 = high→low at mid-bit, logic 0 = low→high
 * Command word: RT address (5) | T/R (1) | subaddress (5) | word count (5, 0 = 32)
 * A remote terminal answers within 4–12 µs (response time, measured as dead
 * bus time); the bus controller leaves ≥ 4 µs between messages.
 */

export const WORD_US = 20;

export interface CommandWord {
  rt: number;
  tr: 0 | 1;
  sa: number;
  wc: number;
}

export function commandBits(c: CommandWord): number[] {
  const v = ((c.rt & 31) << 11) | ((c.tr & 1) << 10) | ((c.sa & 31) << 5) | (c.wc & 31);
  return bits16(v);
}

export function bits16(v: number): number[] {
  return Array.from({ length: 16 }, (_, i) => (v >> (15 - i)) & 1);
}

/** Odd parity bit over the 16 data bits. */
export const oddParity = (b: number[]) => (b.reduce((a, x) => a + x, 0) % 2 === 0 ? 1 : 0);

/**
 * Line levels for a full word in half-bit (0.5 µs) steps: 6 for sync, 2 per
 * bit for 17 bits = 40 half-bits = 20 µs.
 */
export function manchesterWord(data: number[], kind: 'command' | 'data'): number[] {
  const sync = kind === 'command' ? [1, 1, 1, 0, 0, 0] : [0, 0, 0, 1, 1, 1];
  const all = [...data, oddParity(data)];
  return [...sync, ...all.flatMap((b) => (b ? [1, 0] : [0, 1]))];
}

export interface BusMessage {
  name: string;
  /** BC→RT (receive) or RT→BC (transmit) */
  dir: 'BC→RT' | 'RT→BC';
  rt: number;
  sa: number;
  words: number;
  rateHz: number;
}

/** A representative launcher avionics schedule. */
export const DEFAULT_SCHEDULE: BusMessage[] = [
  { name: 'IMU Δv/Δθ increments', dir: 'RT→BC', rt: 1, sa: 1, words: 14, rateHz: 100 },
  { name: 'IMU status', dir: 'RT→BC', rt: 1, sa: 2, words: 4, rateHz: 10 },
  { name: 'GNSS position/velocity', dir: 'RT→BC', rt: 2, sa: 1, words: 24, rateHz: 10 },
  { name: 'TVC pitch/yaw commands', dir: 'BC→RT', rt: 3, sa: 1, words: 4, rateHz: 100 },
  { name: 'TVC actuator feedback', dir: 'RT→BC', rt: 3, sa: 2, words: 8, rateHz: 100 },
  { name: 'Engine controller commands', dir: 'BC→RT', rt: 4, sa: 1, words: 6, rateHz: 50 },
  { name: 'Engine health data', dir: 'RT→BC', rt: 4, sa: 2, words: 32, rateHz: 50 },
  { name: 'Power distribution status', dir: 'RT→BC', rt: 5, sa: 1, words: 12, rateHz: 10 },
  { name: 'Pyro controller arm/fire', dir: 'BC→RT', rt: 6, sa: 1, words: 2, rateHz: 10 },
  { name: 'Telemetry encoder frame', dir: 'BC→RT', rt: 7, sa: 1, words: 32, rateHz: 50 },
];

/** Time on the bus for one message [µs], including RT response and inter-message gap. */
export function messageTime(m: BusMessage, responseUs: number, gapUs: number): number {
  // Command word, data words, response gap, status word (order differs by direction, total does not)
  return WORD_US * (1 + m.words) + responseUs + WORD_US + gapUs;
}

export interface FrameLoad {
  /** Microseconds used in each minor frame */
  used: number[];
  frameUs: number;
  utilisation: number;
  worst: number;
  overrun: boolean;
}

/**
 * Rate-monotonic table: a message at rate r appears in every (F/r)-th minor
 * frame of a frame rate F, offset to spread load.
 */
export function scheduleFrames(msgs: BusMessage[], minorHz: number, responseUs: number, gapUs: number): FrameLoad {
  const frames = minorHz; // one major frame = 1 s
  const frameUs = 1e6 / minorHz;
  const used = new Array(frames).fill(0);
  msgs.forEach((m, k) => {
    const every = Math.max(1, Math.round(minorHz / Math.min(m.rateHz, minorHz)));
    const offset = k % every;
    for (let f = offset; f < frames; f += every) used[f] += messageTime(m, responseUs, gapUs);
  });
  const worst = Math.max(...used);
  const total = used.reduce((a, b) => a + b, 0);
  return { used, frameUs, utilisation: total / 1e6, worst, overrun: worst > frameUs };
}
