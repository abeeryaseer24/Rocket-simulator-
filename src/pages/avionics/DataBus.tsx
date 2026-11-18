import { useMemo, useState } from 'react';
import Chart from '../../components/Chart';
import { Derived, NumField } from '../../components/Field';
import { bits16, commandBits, DEFAULT_SCHEDULE, manchesterWord, messageTime, oddParity, scheduleFrames, type BusMessage } from '../../avionics/bus1553';
import { Block, Intro, Readouts, Sources, Workbench, fmt } from './common';

function Waveform({ levels, label }: { levels: number[]; label: string }) {
  const W = 800;
  const H = 120;
  const x0 = 30;
  const step = (W - x0 - 10) / levels.length;
  const y = (l: number) => (l ? 28 : 78);
  let d = `M${x0} ${y(levels[0])}`;
  levels.forEach((l, i) => {
    const x = x0 + i * step;
    d += ` V${y(l)} H${x + step}`;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="av-svg" role="img" aria-label={label}>
      <line x1={x0} x2={W - 10} y1={53} y2={53} stroke="var(--line)" />
      {[0, 6, ...Array.from({ length: 17 }, (_, k) => 6 + 2 * (k + 1))].map((h) => (
        <line key={h} x1={x0 + h * step} x2={x0 + h * step} y1={18} y2={88} stroke="var(--line-soft)" />
      ))}
      <path d={d} stroke="#1F5FA8" strokeWidth={2.2} fill="none" />
      <text x={x0 + 3 * step} y={104} className="chart-tick" textAnchor="middle">
        sync
      </text>
      {Array.from({ length: 17 }, (_, k) => (
        <text key={k} x={x0 + (7 + 2 * k) * step} y={104} className="chart-tick" textAnchor="middle">
          {k < 16 ? 15 - k : 'P'}
        </text>
      ))}
      <text x={4} y={32} className="chart-tick">+</text>
      <text x={4} y={82} className="chart-tick">−</text>
    </svg>
  );
}

export default function DataBus() {
  const [rt, setRt] = useState(3);
  const [tr, setTr] = useState<0 | 1>(0);
  const [sa, setSa] = useState(1);
  const [wc, setWc] = useState(4);
  const [dataWord, setDataWord] = useState(0x1a2b);
  const [resp, setResp] = useState(8);
  const [gap, setGap] = useState(4);
  const [minor, setMinor] = useState(100);
  const [msgs, setMsgs] = useState<BusMessage[]>(DEFAULT_SCHEDULE);
  const cmd = commandBits({ rt, tr, sa, wc });
  const load = useMemo(() => scheduleFrames(msgs, minor, resp, gap), [msgs, minor, resp, gap]);
  const setMsg = (i: number, p: Partial<BusMessage>) => setMsgs((ms) => ms.map((m, k) => (k === i ? { ...m, ...p } : m)));
  const frames = load.used.map((_, i) => i);
  return (
    <section>
      <Intro title="MIL-STD-1553B data bus" kicker="06 · Data bus">
        <p>
          Most launch vehicles and military aircraft of the last fifty years tie their boxes together with 1553: a dual-redundant,
          transformer-coupled twisted pair at 1 Mbit/s. One bus controller (the flight computer) owns the bus. Up to 31 remote
          terminals speak only when spoken to, so there are no collisions and timing is fully deterministic. That is why it is
          still flown despite its modest speed.
        </p>
        <p>
          Bits are Manchester II coded: every bit has a transition in the middle, so the clock rides inside the data and the
          signal has no DC component to block the coupling transformers. Each 20 µs word begins with a 3 µs sync pattern that is
          deliberately illegal Manchester, so a receiver can never mistake data for the start of a word.
        </p>
      </Intro>
      <Workbench
        controls={
          <>
            <h4>Command word</h4>
            <NumField label="RT address" value={rt} min={0} max={31} step={1} onChange={(v) => setRt(Math.round(v))} hint="31 is reserved for broadcast" />
            <label className="av-check">
              <input type="checkbox" checked={tr === 1} onChange={(e) => setTr(e.target.checked ? 1 : 0)} /> RT transmits (T/R = 1)
            </label>
            <NumField label="Subaddress" value={sa} min={0} max={31} step={1} onChange={(v) => setSa(Math.round(v))} hint="0 and 31 select mode codes" />
            <NumField label="Word count" value={wc} min={0} max={31} step={1} onChange={(v) => setWc(Math.round(v))} hint="0 means 32 words" />
            <h4>Data word</h4>
            <label className="av-check" style={{ justifyContent: 'space-between' }}>
              Value (hex)
              <input
                value={dataWord.toString(16).toUpperCase()}
                onChange={(e) => setDataWord(Math.min(0xffff, parseInt(e.target.value || '0', 16) || 0))}
                style={{ width: 90, font: 'inherit', padding: '4px 8px', border: '1.5px solid var(--line)', borderRadius: 3 }}
              />
            </label>
            <h4>Timing</h4>
            <NumField label="RT response time" value={resp} unit="µs" min={4} max={12} onChange={setResp} hint="1553B allows 4–12 µs" />
            <NumField label="Inter-message gap" value={gap} unit="µs" min={4} max={100} onChange={setGap} />
            <NumField label="Minor frame rate" value={minor} unit="Hz" min={10} max={1000} step={1} onChange={(v) => setMinor(Math.round(v))} />
          </>
        }
      >
        <Readouts>
          <Derived label="Command word" value={`0x${parseInt(cmd.join(''), 2).toString(16).toUpperCase().padStart(4, '0')}`} note={`parity bit ${oddParity(cmd)} (odd)`} />
          <Derived label="This message" value={fmt(messageTime({ name: '', dir: tr ? 'RT→BC' : 'BC→RT', rt, sa, words: wc || 32, rateHz: 1 }, resp, gap), 0)} unit="µs" />
          <Derived label="Bus utilisation" value={fmt(load.utilisation * 100, 1)} unit="%" warn={load.utilisation > 0.6} note="Programs typically reserve ≥ 40 % for growth" />
          <Derived label="Busiest minor frame" value={fmt((load.worst / load.frameUs) * 100, 1)} unit="%" warn={load.overrun} note={load.overrun ? 'Overrun: messages slip to the next frame' : `${fmt(load.worst, 0)} of ${fmt(load.frameUs, 0)} µs`} />
        </Readouts>
        <Block title="Command word on the wire" note="Sync: 1.5 µs high then 1.5 µs low. Then 16 bits MSB first and odd parity, each a mid-bit transition (1 = high→low).">
          <Waveform levels={manchesterWord(cmd, 'command')} label="Manchester waveform of the command word" />
          <p className="an-note num">
            RT {rt} · {tr ? 'transmit' : 'receive'} · SA {sa} · WC {wc || 32} → bits {cmd.join('')}
          </p>
        </Block>
        <Block title="Data word on the wire" note="Data words use the inverted sync, so a receiver can tell a command from data without counting.">
          <Waveform levels={manchesterWord(bits16(dataWord), 'data')} label="Manchester waveform of the data word" />
        </Block>
        <Block title="Load per minor frame" note={`One major frame = 1 s = ${minor} minor frames. Faster messages appear in every frame, slower ones are spread across frames.`}>
          <Chart
            series={[{ label: 'Frame load', x: frames, y: load.used.map((u) => (u / load.frameUs) * 100) }]}
            xLabel="Minor frame #"
            yLabel="% of frame used"
            yMin={0}
            yMax={Math.max(100, (load.worst / load.frameUs) * 105)}
            height={240}
          />
        </Block>
      </Workbench>
      <Block title="Message schedule" note="Edit the rates or word counts to find where the bus saturates.">
        <table className="av-table">
          <thead>
            <tr>
              <th>Message</th>
              <th>Direction</th>
              <th className="num">RT / SA</th>
              <th className="num">Words</th>
              <th className="num">Rate (Hz)</th>
              <th className="num">µs each</th>
              <th className="num">Share of bus</th>
            </tr>
          </thead>
          <tbody>
            {msgs.map((m, i) => {
              const us = messageTime(m, resp, gap);
              return (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td>{m.dir}</td>
                  <td className="num">
                    {m.rt} / {m.sa}
                  </td>
                  <td className="num">
                    <input type="number" min={1} max={32} value={m.words} onChange={(e) => setMsg(i, { words: Math.max(1, Math.min(32, +e.target.value || 1)) })} aria-label={`${m.name} words`} />
                  </td>
                  <td className="num">
                    <input type="number" min={1} max={1000} value={m.rateHz} onChange={(e) => setMsg(i, { rateHz: Math.max(1, +e.target.value || 1) })} aria-label={`${m.name} rate`} />
                  </td>
                  <td className="num">{us}</td>
                  <td className="num">{fmt((us * Math.min(m.rateHz, minor)) / 1e4, 2)} %</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Block>
      <Sources>
        <ul>
          <li>MIL-STD-1553B (1978, with Notice 2): word format, Manchester II coding, sync patterns, 4–12 µs response time, 4 µs minimum inter-message gap.</li>
          <li>Message list is representative of a launcher GNC bus, not a specific vehicle. Newer vehicles also use Ethernet variants (e.g. time-triggered Ethernet), CAN, RS-422 and SpaceWire.</li>
          <li>Timing counts command, data and status words plus response and gap. Mode codes and RT-to-RT transfers are not modelled.</li>
        </ul>
      </Sources>
    </section>
  );
}
