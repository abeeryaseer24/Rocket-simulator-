import { useMemo, useState } from 'react';
import Chart from '../../components/Chart';
import { Derived, NumField, SelectField } from '../../components/Field';
import { beamwidth, berBpsk, CODINGS, db, dishGain, linkTimeline, stationGT, type LinkSpec } from '../../avionics/link';
import { useSim } from '../../sim/store';
import { Block, Intro, Readouts, Sources, Workbench, fmt, useFlight } from './common';

export default function Link() {
  const flight = useFlight();
  const { vehicle } = useSim();
  const [freq, setFreq] = useState(2.25e9);
  const [ptx, setPtx] = useState(10);
  const [gtx, setGtx] = useState(-3);
  const [dish, setDish] = useState(5);
  const [tsys, setTsys] = useState(150);
  const [rate, setRate] = useState(2e6);
  const [codingId, setCodingId] = useState('conv');
  const [plume, setPlume] = useState(3);
  const [mask, setMask] = useState(3);
  const [downrange, setDownrange] = useState(0);
  const coding = CODINGS.find((c) => c.id === codingId)!;
  const L: LinkSpec = {
    freq,
    txPowerW: ptx,
    txGainDbi: gtx,
    txLossDb: 1.5,
    dishD: dish,
    dishEff: 0.55,
    tSys: tsys,
    rxLossDb: 1,
    atmLossDb: 0.5,
    plumeLossDb: plume,
    rate,
    coding,
    implLossDb: 2,
    minElevation: mask,
  };
  // Optional second station placed along the ground track
  const station = useMemo(() => {
    if (downrange <= 0) return undefined;
    const target = flight.samples.find((s) => s.downrange >= downrange * 1000) ?? flight.samples[flight.samples.length - 1];
    return { lat: target.lat, lon: target.lon, h: 10 };
  }, [downrange, flight]);
  const pts = useMemo(() => linkTimeline(flight.samples, vehicle.site, L, station), [flight, vehicle.site, freq, ptx, gtx, dish, tsys, rate, coding, plume, mask, station]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = pts.map((p) => p.t);
  const vis = pts.filter((p) => p.visible);
  const los = pts.find((p) => !p.visible && p.t > 10);
  const minMargin = vis.length ? Math.min(...vis.map((p) => p.margin)) : NaN;
  const maxDop = Math.max(...pts.map((p) => Math.abs(p.doppler)));
  const eirp = db(ptx) + gtx - 1.5;
  const markers = flight.events.filter((e) => ['meco', 'stage-sep', 'seco'].includes(e.kind)).map((e) => ({ x: e.t, label: e.label }));
  if (los) markers.push({ x: los.t, label: 'Loss of signal' });
  const ber = Array.from({ length: 61 }, (_, i) => i * 0.2);

  return (
    <section>
      <Intro title="Downlink budget" kicker="04 · RF link">
        <p>
          Telemetry has to cross thousands of kilometres of space on a few watts. A link budget adds up every gain and loss in
          decibels: transmitter power and antenna gain (the EIRP), free-space spreading loss (20·log₁₀(4πdf/c), which grows 6 dB
          every time range doubles), the ground antenna's gain over its noise temperature (G/T), and Boltzmann's constant
          (−228.6 dBW/K/Hz). What comes out is the energy per bit over noise density, Eb/N₀. Margin is how much of it is left over
          the demodulator's threshold.
        </p>
        <p>
          The geometry comes from your flight: a ground station at {vehicle.site.name} tracks the vehicle until it drops below the
          station mask. The exhaust plume attenuates the signal while engines burn.
        </p>
      </Intro>
      <Workbench
        controls={
          <>
            <h4>Vehicle transmitter</h4>
            <NumField label="Frequency" value={freq} scale={1e-6} unit="MHz" min={100} max={40000} onChange={setFreq} />
            <NumField label="RF output power" value={ptx} unit="W" min={0.01} max={500} onChange={setPtx} />
            <NumField label="Antenna gain" value={gtx} unit="dBi" min={-20} max={20} onChange={setGtx} hint="Wrap-around antennas are near-omni, with nulls." />
            <NumField label="Plume attenuation" value={plume} unit="dB" min={0} max={30} onChange={setPlume} />
            <h4>Ground station</h4>
            <NumField label="Dish diameter" value={dish} unit="m" min={0.3} max={70} onChange={setDish} />
            <NumField label="System noise temp." value={tsys} unit="K" min={20} max={2000} onChange={setTsys} />
            <NumField label="Elevation mask" value={mask} unit="°" min={0} max={30} onChange={setMask} />
            <NumField label="Station downrange" value={downrange} unit="km" min={0} max={5000} onChange={setDownrange} hint="0 = at the pad. Move it under the track to extend coverage." />
            <h4>Signal</h4>
            <NumField label="Data rate" value={rate} scale={1e-6} unit="Mbit/s" min={0.001} max={100} onChange={setRate} />
            <SelectField label="Coding" value={codingId} options={CODINGS.map((c) => ({ value: c.id, label: c.name }))} onChange={setCodingId} />
          </>
        }
      >
        <Readouts>
          <Derived label="EIRP" value={fmt(eirp, 1)} unit="dBW" />
          <Derived label="Station G/T" value={fmt(stationGT(L), 1)} unit="dB/K" note={`${fmt(dishGain(dish, freq), 1)} dBi, beam ${fmt(beamwidth(dish, freq), 2)}°`} />
          <Derived label="Required Eb/N₀" value={fmt(coding.required + 2, 1)} unit="dB" note="threshold + 2 dB implementation loss" />
          <Derived label="Worst margin in view" value={fmt(minMargin, 1)} unit="dB" warn={minMargin < 3} note={minMargin < 3 ? 'Under the usual 3 dB policy' : 'BER 10⁻⁵ or better'} />
          <Derived label="Loss of signal" value={los ? `T+${fmt(los.t, 0)} s` : 'None'} note={los ? `range ${fmt(los.range / 1000, 0)} km` : 'in view to end of data'} />
          <Derived label="Peak Doppler" value={fmt(maxDop / 1000, 1)} unit="kHz" note="receiver must track this" />
        </Readouts>
        <Block title="Link margin" note="Above 0 dB the receiver decodes at BER 10⁻⁵ or better. The line stops where the vehicle drops below the station mask.">
          <Chart
            series={[{ label: 'Margin', x: t, y: pts.map((p) => (p.visible ? p.margin : NaN)) }]}
            xLabel="Mission time (s)"
            yLabel="Margin (dB)"
            markers={markers}
            height={280}
          />
        </Block>
        <Block title="Slant range and elevation">
          <Chart
            series={[
              { label: 'Range (100 km)', x: t, y: pts.map((p) => p.range / 1e5) },
              { label: 'Elevation (°)', x: t, y: pts.map((p) => p.elevation), color: 1 },
            ]}
            xLabel="Mission time (s)"
            yLabel="km×100 · degrees"
            height={240}
          />
        </Block>
        <Block title="Doppler shift" note="Positive while approaching, negative while receding: f_d = −(dr/dt)·f/c.">
          <Chart series={[{ label: 'Doppler', x: t, y: pts.map((p) => p.doppler / 1000), color: 2 }]} xLabel="Mission time (s)" yLabel="kHz" height={220} />
        </Block>
        <Block title="Why coding matters" note="Uncoded BPSK bit error rate, ½·erfc(√(Eb/N₀)). Coding moves the threshold left by several dB, which is worth a bigger dish or more power.">
          <Chart series={[{ label: 'BER', x: ber, y: ber.map((e) => Math.max(berBpsk(e), 1e-12)) }]} xLabel="Eb/N₀ (dB)" yLabel="Bit error rate" logY height={240} />
        </Block>
      </Workbench>
      <Sources>
        <ul>
          <li>Friis free-space loss and the Eb/N₀ link equation: B. Sklar, Digital Communications (2nd ed.), ch. 5.</li>
          <li>Thresholds at BER 10⁻⁵: 9.6 dB uncoded BPSK, about 4.4 dB for the r=½ K=7 convolutional code with soft Viterbi decoding, about 2.5 dB concatenated with Reed–Solomon (255,223), as in the CCSDS 131.0-B recommendations. The LDPC value is approximate.</li>
          <li>Plume attenuation is a single assumed figure. Real values depend on frequency, look angle through the exhaust and propellant (solid-motor plumes with alumina particles are worst).</li>
          <li>Fixed losses assumed: 1.5 dB transmit line, 1 dB receive line, 0.5 dB atmosphere, dish efficiency 55 %.</li>
        </ul>
      </Sources>
    </section>
  );
}
