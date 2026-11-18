import { describe, expect, it } from 'vitest';
import { PRESETS } from '../sim/presets';
import { simulate } from '../sim/simulate';
import { commandBits, manchesterWord, messageTime, oddParity, scheduleFrames, DEFAULT_SCHEDULE } from './bus1553';
import { crc16ccitt, decodeHeader, encodePacket } from './ccsds';
import { inv, mul, eye } from './linalg';
import { berBpsk, dishGain, fspl, linkTimeline, CODINGS } from './link';
import { simulateNavigation, IMU_GRADES } from './navigation';
import { CELLS, DEFAULT_LOADS, ocv, simulatePower } from './power';
import { fire, NSI, steadyRise, timeToFire, DEFAULT_CIRCUIT } from './pyro';
import { decodeSecded, encodeSecded, rSimplex, rTmr, uncorrectable } from './reliability';
import { bode, stepResponse, DEFAULT_SERVO } from './servo';

const flight = simulate(PRESETS[0], { dt: 0.05 });

describe('linear algebra', () => {
  it('inverts a well-conditioned matrix', () => {
    const a = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2],
    ];
    const p = mul(a, inv(a));
    p.forEach((r, i) => r.forEach((v, j) => expect(v).toBeCloseTo(eye(3)[i][j], 12)));
  });
});

describe('power system', () => {
  it('interpolates the OCV curve', () => {
    expect(ocv(CELLS[0], 1)).toBeCloseTo(4.2);
    expect(ocv(CELLS[0], 0.55)).toBeCloseTo(3.76, 2);
  });
  it('8S2P NMC pack carries the default loads through ascent', () => {
    const r = simulatePower({ cell: CELLS[0], series: 8, parallel: 2, soc0: 1, harness: 0.02 }, DEFAULT_LOADS, flight.events, flight.samples, {
      tEnd: flight.samples[flight.samples.length - 1].t,
      brownout: 22,
    });
    expect(r.brownout).toBeNull();
    expect(r.minV).toBeGreaterThan(24);
    expect(r.finalSoc).toBeLessThan(1);
    expect(r.finalSoc).toBeGreaterThan(0.5);
    // Energy balance: Wh drawn ≈ ΔSOC × capacity × nominal voltage (within OCV-curve slack)
    const whFromSoc = (1 - r.finalSoc) * 6 * 8 * 3.7;
    expect(Math.abs(r.energyWh - whFromSoc) / whFromSoc).toBeLessThan(0.15);
  });
});

describe('navigation', () => {
  it('GNSS aiding bounds error that grows unaided', () => {
    const g = IMU_GRADES[0];
    const ins = simulateNavigation(flight.samples, g, { enabled: false, rate: 1, sigmaH: 3, sigmaV: 5, cocom: false }, 3, 400);
    const aided = simulateNavigation(flight.samples, g, { enabled: true, rate: 1, sigmaH: 3, sigmaV: 5, cocom: false }, 3, 400);
    expect(ins.insFinal).toBeGreaterThan(200);
    expect(aided.aidedFinal).toBeLessThan(30);
  });
  it('navigation-grade INS drifts far less than consumer MEMS', () => {
    const off = { enabled: false, rate: 1, sigmaH: 3, sigmaV: 5, cocom: false };
    const a = simulateNavigation(flight.samples, IMU_GRADES[0], off, 5, 300).insFinal;
    const b = simulateNavigation(flight.samples, IMU_GRADES[2], off, 5, 300).insFinal;
    expect(b).toBeLessThan(a / 10);
  });
  it('CoCom limits cut a commercial receiver off in flight', () => {
    const r = simulateNavigation(flight.samples, IMU_GRADES[1], { enabled: true, rate: 1, sigmaH: 3, sigmaV: 5, cocom: true }, 1, 300);
    expect(r.gnssLostAt).not.toBeNull();
  });
});

describe('RF link', () => {
  it('free-space loss at 1000 km, 2.25 GHz ≈ 159.5 dB', () => {
    expect(fspl(1e6, 2.25e9)).toBeCloseTo(159.5, 1);
  });
  it('BPSK needs 9.6 dB for BER 1e-5', () => {
    expect(berBpsk(9.6)).toBeGreaterThan(0.8e-5);
    expect(berBpsk(9.6)).toBeLessThan(1.2e-5);
  });
  it('a 5 m dish at S-band has ~39 dBi', () => {
    expect(dishGain(5, 2.25e9)).toBeCloseTo(38.8, 0);
  });
  it('link margin falls as range grows', () => {
    const pts = linkTimeline(flight.samples, PRESETS[0].site, {
      freq: 2.25e9, txPowerW: 10, txGainDbi: -3, txLossDb: 1.5, dishD: 5, dishEff: 0.55, tSys: 150, rxLossDb: 1,
      atmLossDb: 0.5, plumeLossDb: 0, rate: 2e6, coding: CODINGS[1], implLossDb: 2, minElevation: 3,
    });
    expect(pts[20].margin).toBeGreaterThan(pts[pts.length - 1].margin);
  });
});

describe('CCSDS packets', () => {
  it('CRC-16/CCITT-FALSE check value', () => {
    expect(crc16ccitt([...'123456789'].map((c) => c.charCodeAt(0)))).toBe(0x29b1);
  });
  it('header round-trips and CRC verifies', () => {
    const p = encodePacket(flight.samples[100], 0x123, 16383 + 5);
    const h = decodeHeader(p.bytes);
    expect(h.apid).toBe(0x123);
    expect(h.seq).toBe(4);
    expect(h.seqFlags).toBe(3);
    expect(h.dataLength).toBe(p.bytes.length - 7);
    expect(h.crcOk).toBe(true);
    p.bytes[10] ^= 0x10;
    expect(decodeHeader(p.bytes).crcOk).toBe(false);
  });
});

describe('MIL-STD-1553B', () => {
  it('word is 40 half-bits with odd parity', () => {
    const b = commandBits({ rt: 5, tr: 1, sa: 3, wc: 4 });
    const w = manchesterWord(b, 'command');
    expect(w.length).toBe(40);
    expect((b.reduce((a, x) => a + x, 0) + oddParity(b)) % 2).toBe(1);
  });
  it('message timing and default schedule fit a 100 Hz frame', () => {
    expect(messageTime({ name: '', dir: 'BC→RT', rt: 1, sa: 1, words: 32, rateHz: 1 }, 8, 4)).toBe(20 * 33 + 8 + 20 + 4);
    const f = scheduleFrames(DEFAULT_SCHEDULE, 100, 8, 4);
    expect(f.overrun).toBe(false);
    expect(f.utilisation).toBeGreaterThan(0.1);
    expect(f.utilisation).toBeLessThan(0.9);
  });
});

describe('TVC servo', () => {
  it('step settles with modest overshoot', () => {
    const r = stepResponse(DEFAULT_SERVO, 2);
    expect(r.overshoot).toBeLessThan(15);
    expect(r.settle).toBeLessThan(0.2);
    expect(r.points[r.points.length - 1].delta).toBeCloseTo(2, 1);
  });
  it('position loop has healthy phase margin', () => {
    const b = bode(DEFAULT_SERVO);
    expect(b.phaseMargin).toBeGreaterThan(45);
    expect(b.crossover).toBeGreaterThan(5);
  });
});

describe('pyrotechnics', () => {
  it('honours NSI no-fire and all-fire points', () => {
    expect(steadyRise(NSI, 1)).toBeLessThan(NSI.dtIgnite);
    expect(timeToFire(NSI, 1)).toBe(Infinity);
    expect(timeToFire(NSI, 3.5)).toBeLessThan(0.01);
  });
  it('default CDU fires the initiator', () => {
    expect(fire(NSI, DEFAULT_CIRCUIT).fired).toBe(true);
    expect(fire(NSI, { ...DEFAULT_CIRCUIT, harness: 20 }).fired).toBe(false);
  });
});

describe('fault tolerance', () => {
  it('TMR beats simplex only before t = ln2/λ', () => {
    const l = 1e-4;
    expect(rTmr(l, 1000)).toBeGreaterThan(rSimplex(l, 1000));
    expect(rTmr(l, 20000)).toBeLessThan(rSimplex(l, 20000));
  });
  it('SECDED corrects one flip and detects two', () => {
    const w = encodeSecded([1, 0, 1, 1]);
    for (let k = 0; k < 8; k++) {
      const x = [...w];
      x[k] ^= 1;
      const d = decodeSecded(x);
      expect(d.status).toBe('corrected');
      expect(d.data).toEqual([1, 0, 1, 1]);
    }
    const y = [...w];
    y[2] ^= 1;
    y[6] ^= 1;
    expect(decodeSecded(y).status).toBe('double-error');
  });
  it('scrubbing more often cuts uncorrectable errors quadratically per scrub', () => {
    const a = uncorrectable(1e6, 72, 1e-6, 10, 3600);
    const b = uncorrectable(1e6, 72, 1e-6, 1, 3600);
    expect(a / b).toBeCloseTo(10, 5);
  });
});
