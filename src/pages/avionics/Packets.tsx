import { useMemo, useState } from 'react';
import { decodeHeader, encodePacket, hex, TM_FIELDS } from '../../avionics/ccsds';
import { fmtClock, sampleAt } from '../../sim/playback';
import { Block, Intro, Sources, fmt, useFlight } from './common';

const HEADER_FIELDS: Array<{ name: string; bits: number; key: keyof ReturnType<typeof decodeHeader>; note: string }> = [
  { name: 'Version', bits: 3, key: 'version', note: '000 for CCSDS packets' },
  { name: 'Type', bits: 1, key: 'type', note: '0 telemetry, 1 telecommand' },
  { name: 'Sec. header', bits: 1, key: 'secHdr', note: 'no secondary header here' },
  { name: 'APID', bits: 11, key: 'apid', note: 'which on-board process sent it' },
  { name: 'Seq. flags', bits: 2, key: 'seqFlags', note: '11 = unsegmented' },
  { name: 'Seq. count', bits: 14, key: 'seq', note: 'gaps reveal dropped packets' },
  { name: 'Data length', bits: 16, key: 'dataLength', note: 'octets in data field − 1' },
];

export default function Packets() {
  const flight = useFlight();
  const tEnd = flight.samples[flight.samples.length - 1].t;
  const [t, setT] = useState(Math.min(60, tEnd));
  const [apid, setApid] = useState(0x0a1);
  const [rate, setRate] = useState(10);
  const [flip, setFlip] = useState<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const seq = Math.round(t * rate);
  const s = sampleAt(flight.samples, t);
  const pkt = useMemo(() => encodePacket(s, apid, seq), [s, apid, seq]);
  const bytes = useMemo(() => {
    const b = new Uint8Array(pkt.bytes);
    if (flip !== null && flip < b.length * 8) b[flip >> 3] ^= 0x80 >> (flip & 7);
    return b;
  }, [pkt, flip]);
  const h = decodeHeader(bytes);
  const headerBits = Array.from(bytes.subarray(0, 6)).flatMap((b) => Array.from({ length: 8 }, (_, i) => (b >> (7 - i)) & 1));
  let bitPos = 0;
  const fieldOf = (i: number) => pkt.raw.find((r) => i >= r.offset && i < r.offset + r.field.bytes)?.field.key ?? null;
  // Console: last few packets before t
  const recent = Array.from({ length: 8 }, (_, k) => Math.max(0, t - (7 - k) / rate)).map((tt) => ({ tt, p: encodePacket(sampleAt(flight.samples, tt), apid, Math.round(tt * rate)) }));

  return (
    <section>
      <Intro title="Telemetry packets" kicker="05 · Telemetry">
        <p>
          Before any number reaches a ground screen it is cut into fixed-point integers, packed big-endian into a packet, and
          protected by a cyclic redundancy check. This page builds a real CCSDS Space Packet from your flight at any moment:
          6-octet primary header, a data field of scaled telemetry words, and a CRC-16-CCITT trailer.
        </p>
        <p>
          Flip any bit in the header and watch the receiver's CRC check catch it. A single bit error in an unprotected altitude
          word could move the vehicle by kilometres on the ground display.
        </p>
      </Intro>

      <div className="an-controls">
        <label style={{ flex: 1, minWidth: 260 }}>
          Mission time · <span className="num">{fmtClock(t)}</span>
          <input type="range" min={0} max={tEnd} step={0.1} value={t} onChange={(e) => setT(+e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>
          APID (hex)
          <input value={apid.toString(16).toUpperCase()} onChange={(e) => setApid(Math.min(0x7ff, parseInt(e.target.value || '0', 16) || 0))} />
        </label>
        <label>
          Packet rate (Hz)
          <input type="number" min={1} max={1000} value={rate} onChange={(e) => setRate(Math.max(1, +e.target.value || 1))} />
        </label>
      </div>

      <Block title="Primary header, bit by bit" note="Click a bit to flip it in transmission. Click again to clear it.">
        <div className="av-bits" role="group" aria-label="Header bits">
          {HEADER_FIELDS.map((f) => {
            const start = bitPos;
            bitPos += f.bits;
            return (
              <div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', gap: 2 }}>
                  {headerBits.slice(start, start + f.bits).map((b, i) => (
                    <button
                      key={i}
                      className={flip === start + i ? 'flipped' : ''}
                      onClick={() => setFlip(flip === start + i ? null : start + i)}
                      aria-label={`${f.name} bit ${i}, value ${b}`}
                      style={{ width: 22, height: 32 }}
                    >
                      {b}
                    </button>
                  ))}
                </div>
                <small style={{ fontSize: '0.72rem', color: 'var(--graphite)' }}>
                  <strong style={{ color: 'var(--ink)' }}>{f.name}</strong> = {String(h[f.key])}
                </small>
              </div>
            );
          })}
        </div>
        <p className="av-check" style={{ marginTop: 14 }}>
          <span className={'av-pill ' + (h.crcOk ? 'go' : 'nogo')}>{h.crcOk ? 'CRC OK' : 'CRC FAIL'}</span>
          <span className="num">
            Transmitted CRC 0x{pkt.crc.toString(16).toUpperCase().padStart(4, '0')}
            {!h.crcOk && ' · receiver discards the packet and counts a frame error'}
          </span>
        </p>
      </Block>

      <Block title="Whole packet" note={`${bytes.length} octets. Gold = header, blue = CRC. Hover a data word to see what it encodes.`}>
        <div className="av-hexdump num">
          {Array.from(bytes).map((b, i) => {
            const key = fieldOf(i);
            const cls = i < 6 ? 'hdr' : i >= bytes.length - 2 ? 'crc' : key && key === hover ? 'hl' : '';
            return (
              <span key={i} className={cls} onPointerEnter={() => setHover(key)} onPointerLeave={() => setHover(null)}>
                {hex(b)}
              </span>
            );
          })}
        </div>
        <table className="av-table" style={{ marginTop: 18 }}>
          <thead>
            <tr>
              <th>Word</th>
              <th className="num">Value</th>
              <th className="num">LSB</th>
              <th className="num">Raw count</th>
              <th>Octets</th>
            </tr>
          </thead>
          <tbody>
            {pkt.raw.map((r) => (
              <tr key={r.field.key} onPointerEnter={() => setHover(r.field.key)} onPointerLeave={() => setHover(null)} style={{ background: hover === r.field.key ? 'var(--kapton-wash)' : undefined }}>
                <td>{r.field.label}</td>
                <td className="num">
                  {fmt(r.value, r.field.lsb >= 1 ? 0 : 2)} {r.field.unit}
                </td>
                <td className="num">{r.field.lsb}</td>
                <td className="num">{r.count}</td>
                <td className="num">
                  {Array.from(bytes.subarray(r.offset, r.offset + r.field.bytes))
                    .map(hex)
                    .join(' ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>

      <Block title="Ground console" note="What the decommutation software logs: every packet in sequence, checked and decoded.">
        <table className="av-table num">
          <thead>
            <tr>
              <th>MET</th>
              <th>APID</th>
              <th className="num">Seq</th>
              <th className="num">Alt (km)</th>
              <th className="num">V (m/s)</th>
              <th className="num">Accel (g)</th>
              <th>Check</th>
            </tr>
          </thead>
          <tbody>
            {recent.map(({ tt, p }) => {
              const dh = decodeHeader(p.bytes);
              return (
                <tr key={tt}>
                  <td>{fmtClock(tt)}</td>
                  <td>0x{dh.apid.toString(16).toUpperCase().padStart(3, '0')}</td>
                  <td className="num">{dh.seq}</td>
                  <td className="num">{fmt(p.raw[1].count * TM_FIELDS[1].lsb / 1000, 2)}</td>
                  <td className="num">{fmt(p.raw[2].count * TM_FIELDS[2].lsb, 1)}</td>
                  <td className="num">{fmt(p.raw[3].count * TM_FIELDS[3].lsb, 2)}</td>
                  <td>{dh.crcOk ? 'ok' : 'FAIL'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Block>
      <Sources>
        <ul>
          <li>CCSDS 133.0-B-2, Space Packet Protocol (primary header layout, APID, sequence count, packet data length).</li>
          <li>CRC-16-CCITT, polynomial x¹⁶ + x¹² + x⁵ + 1 (0x1021), preset 0xFFFF, as used for the frame error control field in CCSDS TM/TC transfer frames (CCSDS 132.0-B). Check value for "123456789" is 0x29B1.</li>
          <li>The data-field word list and scalings are this simulator's own, as each mission defines its own.</li>
        </ul>
      </Sources>
    </section>
  );
}
