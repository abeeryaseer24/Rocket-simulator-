import { useMemo, useState } from 'react';
import Chart from '../../components/Chart';
import { Derived, NumField } from '../../components/Field';
import { decodeSecded, encodeSecded, mttfTmr, rawUpsets, rDual, rSimplex, rTmr, uncorrectable } from '../../avionics/reliability';
import { Block, Intro, Readouts, Sources, Workbench, fmt, useFlight } from './common';

const POS = ['P₀', 'p₁', 'p₂', 'd₁', 'p₄', 'd₂', 'd₃', 'd₄'];

export default function Reliability() {
  const flight = useFlight();
  const mission = flight.samples[flight.samples.length - 1].t;
  const [mtbf, setMtbf] = useState(50000);
  const [rv, setRv] = useState(0.99999999);
  const [data, setData] = useState<[number, number, number, number]>([1, 0, 1, 1]);
  const [flips, setFlips] = useState<number[]>([]);
  const [memMB, setMemMB] = useState(256);
  const [seu, setSeu] = useState(1e-7);
  const [scrub, setScrub] = useState(10);
  const lambda = 1 / (mtbf * 3600);
  const tHours = Array.from({ length: 121 }, (_, i) => (i / 120) * mtbf * 1.5);
  const cross = Math.LN2 / lambda / 3600;
  const missionR = { s: rSimplex(lambda, mission), d: rDual(lambda, mission), t: rTmr(lambda, mission, rv) };

  const code = encodeSecded(data);
  const recv = code.map((b, i) => (flips.includes(i) ? b ^ 1 : b));
  const dec = decodeSecded(recv);
  const words = (memMB * 8 * 2 ** 20) / 64;
  const ue = useMemo(() => uncorrectable(words, 72, seu, scrub, mission), [words, seu, scrub, mission]);
  const raw = rawUpsets(memMB * 8 * 2 ** 20, seu, mission);
  const scrubs = Array.from({ length: 50 }, (_, i) => 10 ** (i / 49 * 5 - 1));

  return (
    <section>
      <Intro title="Fault tolerance" kicker="09 · Reliability">
        <p>
          A launch vehicle cannot be repaired in flight, so its electronics must ride through failures. There are two kinds. Hard
          failures (a dead chip, a broken solder joint) are handled by redundancy and voting. Soft errors (a cosmic-ray particle
          flipping a memory bit, a single-event upset) are handled by error-correcting codes and scrubbing. Both are quantified
          here for the duration of your flight.
        </p>
      </Intro>
      <Workbench
        controls={
          <>
            <h4>Hardware failures</h4>
            <NumField label="Unit MTBF" value={mtbf} unit="h" min={10} max={1e8} onChange={setMtbf} hint="Mean time between failures of one flight computer" />
            <NumField label="Voter reliability" value={rv} min={0.9} max={1} digits={9} onChange={setRv} hint="The voter is a single point of failure: its unreliability is the floor TMR can never beat." />
            <h4>Memory upsets</h4>
            <NumField label="Memory size" value={memMB} unit="MiB" min={1} max={65536} onChange={setMemMB} />
            <NumField label="Upset rate" value={seu} unit="/bit/day" min={1e-12} max={1e-3} onChange={setSeu} hint="Order 1e-7 for commercial SRAM in low Earth orbit; far lower on the ground" />
            <NumField label="Scrub interval" value={scrub} unit="s" min={0.01} max={86400} onChange={setScrub} />
          </>
        }
      >
        <Readouts>
          <Derived label="Simplex, this flight" value={fmt(missionR.s * 100, 6)} unit="%" note={`1 in ${fmt(1 / (1 - missionR.s), 0)} fails`} />
          <Derived label="Triple-voted, this flight" value={fmt(missionR.t * 100, 6)} unit="%" note={`1 in ${fmt(1 / Math.max(1 - missionR.t, 1e-15), 0)} fails`} />
          <Derived label="TMR stops helping after" value={fmt(cross, 0)} unit="h" note="R = ½, i.e. ln 2 / λ" />
          <Derived label="MTTF simplex vs TMR" value={`${fmt(mtbf, 0)} / ${fmt(mttfTmr(lambda) / 3600, 0)}`} unit="h" note="TMR's mean life is shorter: it wins early, loses late" />
        </Readouts>
        <Block title="Survival probability" note="Over long times, voting three units is worse than one: two of three must still work. For a ten-minute ascent it is far better.">
          <Chart
            series={[
              { label: 'Simplex', x: tHours, y: tHours.map((h) => rSimplex(lambda, h * 3600)), color: 1 },
              { label: 'Dual (1 of 2)', x: tHours, y: tHours.map((h) => rDual(lambda, h * 3600)), color: 2 },
              { label: 'TMR (2 of 3)', x: tHours, y: tHours.map((h) => rTmr(lambda, h * 3600, rv)), color: 0 },
            ]}
            xLabel="Operating time (h)"
            yLabel="Reliability"
            yMin={0}
            yMax={1}
            markers={[{ x: cross, label: 'R = ½' }]}
            height={300}
          />
        </Block>
      </Workbench>

      <Block title="Single-error correction, double-error detection" note="A Hamming(7,4) code plus an overall parity bit. Choose 4 data bits, then flip any received bits. The decoder's syndrome points at a single flipped bit; overall parity tells one error from two.">
        <div className="av-bench" style={{ marginTop: 10 }}>
          <div>
            <h4 style={{ fontSize: 'var(--t-xs)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--graphite)' }}>Data</h4>
            <div className="av-bits">
              {data.map((b, i) => (
                <button key={i} onClick={() => (setData(data.map((x, k) => (k === i ? x ^ 1 : x)) as typeof data), setFlips([]))} aria-label={`Data bit ${i + 1}, value ${b}`}>
                  {b}
                  <small>d{i + 1}</small>
                </button>
              ))}
            </div>
          </div>
          <div>
            <h4 style={{ fontSize: 'var(--t-xs)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--graphite)' }}>Received codeword (click to flip)</h4>
            <div className="av-bits">
              {recv.map((b, i) => (
                <button
                  key={i}
                  className={(flips.includes(i) ? 'flipped ' : '') + (POS[i].startsWith('p') || i === 0 ? 'parity' : '')}
                  onClick={() => setFlips(flips.includes(i) ? flips.filter((x) => x !== i) : [...flips, i])}
                  aria-label={`Codeword position ${i}, ${POS[i]}, value ${b}`}
                >
                  {b}
                  <small>{POS[i]}</small>
                </button>
              ))}
            </div>
            <p className="av-check" style={{ marginTop: 12 }}>
              <span className={'av-pill ' + (dec.status === 'double-error' ? 'nogo' : 'go')}>
                {dec.status === 'clean' ? 'Clean' : dec.status === 'corrected' ? `Corrected bit ${dec.syndrome}` : 'Double error detected'}
              </span>
              <span className="num">
                syndrome {dec.syndrome.toString(2).padStart(3, '0')} · overall parity {dec.overallOk ? 'even' : 'odd'} · data out {dec.status === 'double-error' ? 'untrusted' : dec.data.join('')}
                {flips.length > 2 && ' · 3+ errors can be silently mis-corrected'}
              </span>
            </p>
          </div>
        </div>
      </Block>

      <Block title="Memory scrubbing" note="SECDED only fails when a second bit flips in the same word before the first is fixed. A background scrubber reads and rewrites memory to clear single errors before a second one arrives.">
        <Readouts>
          <Derived label="Raw upsets this flight" value={raw < 0.01 ? raw.toExponential(2) : fmt(raw, 2)} note="what plain memory would suffer" />
          <Derived label="Uncorrectable with SECDED" value={ue.toExponential(2)} note={`(72,64) words, scrub every ${scrub} s`} />
        </Readouts>
        <Chart
          series={[{ label: 'Uncorrectable words', x: scrubs.map(Math.log10), y: scrubs.map((s) => uncorrectable(words, 72, seu, s, mission)) }]}
          xLabel="Scrub interval (s)"
          yLabel="Expected per flight"
          logY
          fx={(v) => `${+(10 ** v).toPrecision(2)}`}
          height={240}
        />
      </Block>
      <Sources>
        <ul>
          <li>Reliability of k-out-of-n systems with exponential failure times: standard results (e.g. D. P. Siewiorek and R. S. Swarz, Reliable Computer Systems).</li>
          <li>SECDED (Hsiao/Hamming) codes as used in rad-tolerant memory controllers; the (72,64) organisation is the common one for 64-bit words.</li>
          <li>Upset rates vary by orders of magnitude with process node, orbit and solar activity. The default is an illustrative low-Earth-orbit figure, not a measured value for a specific part.</li>
        </ul>
      </Sources>
    </section>
  );
}
