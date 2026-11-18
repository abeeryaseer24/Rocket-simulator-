import type { Sample } from '../sim/simulate';

/**
 * CCSDS Space Packet (CCSDS 133.0-B) primary header, 6 octets, big-endian:
 *
 *   bits  0–2   packet version number (000)
 *   bit   3     packet type (0 = telemetry, 1 = telecommand)
 *   bit   4     secondary header flag
 *   bits  5–15  APID (application process identifier, 11 bits)
 *   bits 16–17  sequence flags (11 = unsegmented)
 *   bits 18–31  packet sequence count (14 bits, wraps at 16384)
 *   bits 32–47  packet data length = (octets in data field) − 1
 *
 * The data field here is a fixed telemetry frame of scaled integers, followed
 * by a CRC-16-CCITT error-detecting code (poly 0x1021, init 0xFFFF), the same
 * CRC CCSDS uses for its transfer-frame error control field.
 */

export interface TmField {
  key: string;
  label: string;
  unit: string;
  /** Raw count = round(value / lsb) */
  lsb: number;
  bytes: 2 | 4;
  signed: boolean;
  get: (s: Sample) => number;
}

export const TM_FIELDS: TmField[] = [
  { key: 'met', label: 'Mission elapsed time', unit: 's', lsb: 0.001, bytes: 4, signed: true, get: (s) => s.t },
  { key: 'alt', label: 'Altitude', unit: 'm', lsb: 0.1, bytes: 4, signed: true, get: (s) => s.alt },
  { key: 'vin', label: 'Inertial velocity', unit: 'm/s', lsb: 0.01, bytes: 4, signed: false, get: (s) => s.vInertial },
  { key: 'acc', label: 'Axial acceleration', unit: 'g', lsb: 0.001, bytes: 2, signed: true, get: (s) => s.axialG },
  { key: 'q', label: 'Dynamic pressure', unit: 'Pa', lsb: 1, bytes: 2, signed: false, get: (s) => s.q },
  { key: 'pitch', label: 'Pitch', unit: '°', lsb: 0.01, bytes: 2, signed: true, get: (s) => s.pitch },
  { key: 'thr', label: 'Throttle', unit: '%', lsb: 0.01, bytes: 2, signed: false, get: (s) => s.throttle * 100 },
  { key: 'prop', label: 'Propellant remaining', unit: '%', lsb: 0.01, bytes: 2, signed: false, get: (s) => s.propFraction * 100 },
  { key: 'stage', label: 'Stage / flags', unit: '', lsb: 1, bytes: 2, signed: false, get: (s) => (s.stage << 8) | (s.burning ? 1 : 0) | (s.boosters ? 2 : 0) | (s.fairing ? 4 : 0) },
];

export function crc16ccitt(bytes: Uint8Array | number[], init = 0xffff): number {
  let crc = init;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

export interface Packet {
  bytes: Uint8Array;
  apid: number;
  seq: number;
  dataLength: number;
  crc: number;
  raw: Array<{ field: TmField; value: number; count: number; offset: number }>;
}

function writeInt(buf: Uint8Array, off: number, n: number, bytes: number) {
  for (let i = bytes - 1; i >= 0; i--) {
    buf[off + i] = n & 0xff;
    n = Math.floor(n / 256);
  }
}

export function encodePacket(s: Sample, apid: number, seq: number): Packet {
  const dataLen = TM_FIELDS.reduce((a, f) => a + f.bytes, 0) + 2;
  const buf = new Uint8Array(6 + dataLen);
  const a = apid & 0x7ff;
  const sc = seq & 0x3fff;
  buf[0] = (0 << 5) | (0 << 4) | (0 << 3) | (a >> 8); // version 0, TM, no sec header
  buf[1] = a & 0xff;
  buf[2] = (0b11 << 6) | (sc >> 8);
  buf[3] = sc & 0xff;
  buf[4] = ((dataLen - 1) >> 8) & 0xff;
  buf[5] = (dataLen - 1) & 0xff;
  let off = 6;
  const raw: Packet['raw'] = [];
  for (const f of TM_FIELDS) {
    const max = 2 ** (8 * f.bytes);
    let count = Math.round(f.get(s) / f.lsb);
    count = f.signed ? Math.max(-max / 2, Math.min(max / 2 - 1, count)) : Math.max(0, Math.min(max - 1, count));
    const enc = count < 0 ? max + count : count;
    writeInt(buf, off, enc, f.bytes);
    raw.push({ field: f, value: f.get(s), count, offset: off });
    off += f.bytes;
  }
  const crc = crc16ccitt(buf.subarray(0, off));
  buf[off] = crc >> 8;
  buf[off + 1] = crc & 0xff;
  return { bytes: buf, apid: a, seq: sc, dataLength: dataLen - 1, crc, raw };
}

export interface DecodedHeader {
  version: number;
  type: number;
  secHdr: number;
  apid: number;
  seqFlags: number;
  seq: number;
  dataLength: number;
  crcOk: boolean;
}

export function decodeHeader(b: Uint8Array): DecodedHeader {
  const crc = (b[b.length - 2] << 8) | b[b.length - 1];
  return {
    version: b[0] >> 5,
    type: (b[0] >> 4) & 1,
    secHdr: (b[0] >> 3) & 1,
    apid: ((b[0] & 7) << 8) | b[1],
    seqFlags: b[2] >> 6,
    seq: ((b[2] & 0x3f) << 8) | b[3],
    dataLength: (b[4] << 8) | b[5],
    crcOk: crc16ccitt(b.subarray(0, b.length - 2)) === crc,
  };
}

export const hex = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');
