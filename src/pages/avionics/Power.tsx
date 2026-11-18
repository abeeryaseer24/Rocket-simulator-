import { useMemo, useState } from 'react';
import Chart from '../../components/Chart';
import { Derived, NumField, SelectField } from '../../components/Field';
import { CELLS, DEFAULT_LOADS, simulatePower, type Load } from '../../avionics/power';
import { Block, Intro, Readouts, Sources, Workbench, fmt, useFlight } from './common';

export default function Power() {
  const flight = useFlight();
  const [cellId, setCellId] = useState(CELLS[0].id);
  const [series, setSeries] = useState(8);
  const [parallel, setParallel] = useState(2);
  const [soc0, setSoc0] = useState(1);
  const [harness, setHarness] = useState(0.02);
  const [brown, setBrown] = useState(22);
  const [transfer, setTransfer] = useState(180);
  const [loads, setLoads] = useState<Load[]>(DEFAULT_LOADS);
  const cell = CELLS.find((c) => c.id === cellId)!;
  const tEnd = flight.samples[flight.samples.length - 1].t;

  const r = useMemo(
    () => simulatePower({ cell, series, parallel, soc0, harness }, loads, flight.events, flight.samples, { tStart: -transfer, tEnd, brownout: brown }),
    [cell, series, parallel, soc0, harness, loads, flight, transfer, tEnd, brown],
  );
  const t = r.points.map((p) => p.t);
  const markers = flight.events
    .filter((e) => ['liftoff', 'meco', 'stage-sep', 'fairing-sep', 'seco'].includes(e.kind))
    .map((e) => ({ x: e.t, label: e.label }));
  const capWh = cell.capacity * parallel * cell.vNom * series;
  const avgW = (r.energyWh * 3600) / (tEnd + transfer);
  const cRate = r.peakI / (cell.capacity * parallel);

  const setLoad = (i: number, patch: Partial<Load>) => setLoads((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  return (
    <section>
      <Intro title="Electrical power system" kicker="02 · Power">
        <p>
          Every box on the vehicle runs from one battery. Its voltage is not constant: it sags with each current pulse through the
          cell's internal resistance, recovers slowly as the electrochemical polarisation relaxes, and falls as the charge runs down.
          Each cell here is the first-order Thevenin circuit that battery-management chips use: an open-circuit voltage source, an
          ohmic resistance R₀ and one RC pair.
        </p>
        <p>
          Loads draw constant power through DC/DC converters, so when voltage drops, current rises. That feedback is why a weak
          pack fails abruptly. The timeline starts at internal power transfer, before liftoff, and follows your flight's real events:
          valve drivers while engines burn, pyro pulses at each separation.
        </p>
      </Intro>
      <Workbench
        controls={
          <>
            <h4>Pack</h4>
            <SelectField label="Cell" value={cellId} options={CELLS.map((c) => ({ value: c.id, label: c.name }))} onChange={setCellId} />
            <NumField label="Cells in series" value={series} min={1} max={100} step={1} onChange={(v) => setSeries(Math.round(v))} />
            <NumField label="Strings in parallel" value={parallel} min={1} max={20} step={1} onChange={(v) => setParallel(Math.round(v))} />
            <NumField label="Initial charge" value={soc0} scale={100} unit="%" min={5} max={100} onChange={setSoc0} />
            <NumField label="Harness resistance" value={harness} scale={1000} unit="mΩ" min={0} max={2000} onChange={setHarness} />
            <h4>Bus</h4>
            <NumField label="Brown-out limit" value={brown} unit="V" min={1} max={400} onChange={setBrown} hint="Converters drop out below this input voltage." />
            <NumField label="Internal power before T-0" value={transfer} unit="s" min={0} max={3600} onChange={setTransfer} />
          </>
        }
      >
        <Readouts>
          <Derived label="Nominal bus" value={fmt(r.busNominal, 1)} unit="V" note={`${series}S${parallel}P ${cell.chemistry}`} />
          <Derived label="Lowest bus voltage" value={fmt(r.minV, 2)} unit="V" warn={r.brownout !== null} note={r.brownout !== null ? `Brown-out at T${r.brownout >= 0 ? '+' : ''}${r.brownout.toFixed(1)} s` : `at T${r.minVt >= 0 ? '+' : ''}${r.minVt.toFixed(2)} s`} />
          <Derived label="Peak current" value={fmt(r.peakI, 1)} unit="A" warn={r.peakI / parallel > cell.iMax} note={`${fmt(cRate, 1)} C · cell limit ${cell.iMax} A`} />
          <Derived label="Energy used" value={fmt(r.energyWh, 1)} unit="Wh" note={`of ${fmt(capWh, 0)} Wh, ${fmt(avgW, 0)} W average`} />
          <Derived label="Charge left" value={fmt(r.finalSoc * 100, 1)} unit="%" warn={r.finalSoc < 0.2} />
          <Derived label="Pack mass" value={fmt(r.packMass, 2)} unit="kg" note={`${fmt(capWh / r.packMass, 0)} Wh/kg at cell level`} />
          <Derived label="Pack temperature" value={fmt(r.maxTemp, 1)} unit="°C" note="from 20 °C, no cooling" warn={r.maxTemp > 60} />
        </Readouts>
        <Block title="Bus voltage" note="Sharp notches are pyro firings and RCS pulses; the slow decline is the open-circuit voltage following the state of charge.">
          <Chart series={[{ label: 'Bus voltage', x: t, y: r.points.map((p) => p.v) }]} xLabel="Mission time (s)" yLabel="Volts" markers={markers} height={280} />
        </Block>
        <Block title="Current drawn">
          <Chart series={[{ label: 'Pack current', x: t, y: r.points.map((p) => p.i), color: 1 }]} xLabel="Mission time (s)" yLabel="Amps" markers={markers} height={240} yMin={0} />
        </Block>
        <Block title="State of charge">
          <Chart series={[{ label: 'SOC', x: t, y: r.points.map((p) => p.soc * 100), color: 2 }]} xLabel="Mission time (s)" yLabel="%" height={220} />
        </Block>
      </Workbench>

      <Block title="Load list" note="Untick a load or change its power and every chart above re-runs.">
        <table className="av-table">
          <thead>
            <tr>
              <th>On</th>
              <th>Load</th>
              <th>When</th>
              <th className="num">Power (W)</th>
              <th className="num">Current at nominal (A)</th>
            </tr>
          </thead>
          <tbody>
            {loads.map((l, i) => (
              <tr key={l.name}>
                <td>
                  <input type="checkbox" checked={l.enabled} onChange={(e) => setLoad(i, { enabled: e.target.checked })} aria-label={`Enable ${l.name}`} />
                </td>
                <td>{l.name}</td>
                <td>{l.mode === 'always' ? 'Continuous' : l.mode === 'burning' ? 'While an engine burns' : `${(l.pulse ?? 0) * 1000} ms at ${l.on?.join(', ')}`}</td>
                <td className="num">
                  <input type="number" value={l.watts} min={0} onChange={(e) => setLoad(i, { watts: Math.max(0, +e.target.value || 0) })} aria-label={`${l.name} power`} />
                </td>
                <td className="num">{fmt(l.watts / r.busNominal, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>
      <Sources>
        <ul>
          <li>Cell parameters are typical datasheet values for each commercial format, not one manufacturer's part. Real packs are characterised by pulse testing.</li>
          <li>Thevenin first-order equivalent circuit: the standard model in battery-management literature (e.g. Plett, Battery Management Systems, Vol. 1).</li>
          <li>Thermal model is adiabatic with c ≈ 900 J/(kg·K). Temperature does not feed back into resistance here; in reality cold cells have higher R₀.</li>
          <li>Load powers are representative of a small-to-medium launcher's avionics, not a specific vehicle.</li>
        </ul>
      </Sources>
    </section>
  );
}
