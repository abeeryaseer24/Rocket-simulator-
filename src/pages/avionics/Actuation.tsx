import { useMemo, useState } from 'react';
import Chart from '../../components/Chart';
import { Derived, NumField } from '../../components/Field';
import { bode, DEFAULT_SERVO, jEq, ratio, stepResponse, type ServoSpec } from '../../avionics/servo';
import { Block, Intro, Readouts, Sources, Workbench, fmt, useFlight } from './common';

const logFmt = (v: number) => {
  const f = 10 ** v;
  return f >= 1000 ? `${+(f / 1000).toPrecision(2)}k` : `${+f.toPrecision(2)}`;
};

export default function Actuation() {
  const flight = useFlight();
  const [s, setS] = useState<ServoSpec>(DEFAULT_SERVO);
  const [step, setStep] = useState(2);
  const set = (p: Partial<ServoSpec>) => setS((o) => ({ ...o, ...p }));
  const r = useMemo(() => stepResponse(s, step), [s, step]);
  const b = useMemo(() => bode(s), [s]);
  const t = r.points.map((p) => p.t * 1000);
  const lf = b.pts.map((p) => Math.log10(p.f));
  const maxGimbal = Math.max(0, ...flight.samples.map((x) => Math.abs(x.gimbal || 0)));
  const slew = (s.busV / s.Kt) * ratio(s) * (180 / Math.PI);

  return (
    <section>
      <Intro title="Thrust-vector-control actuator" kicker="07 · Actuation">
        <p>
          Steering a rocket means swinging a nozzle that weighs hundreds of kilograms while it pushes several hundred kilonewtons.
          An electromechanical actuator does it with a brushless motor, a gearbox and a ball screw. The drive electronics close
          three loops, one inside the other: current (that is, torque) at about a kilohertz, motor speed at around a hundred hertz,
          and nozzle position at about ten. Each loop is tuned slower than the one inside it, so the inner loops look ideal from
          outside.
        </p>
        <p>
          The step response shows the large-signal limits: bus voltage caps speed, the drive caps current. The Bode plot shows
          the small-signal behaviour the flight control engineers need: crossover frequency and phase margin.
        </p>
      </Intro>
      <Workbench
        controls={
          <>
            <h4>Command</h4>
            <NumField label="Step size" value={step} unit="°" min={-15} max={15} onChange={setStep} />
            <h4>Motor and drive</h4>
            <NumField label="Bus voltage" value={s.busV} unit="V" min={12} max={600} onChange={(v) => set({ busV: v })} />
            <NumField label="Winding resistance" value={s.R} unit="Ω" min={0.01} max={10} onChange={(v) => set({ R: v })} />
            <NumField label="Winding inductance" value={s.L} scale={1000} unit="mH" min={0.01} max={50} onChange={(v) => set({ L: v })} />
            <NumField label="Torque constant" value={s.Kt} unit="N·m/A" min={0.01} max={2} onChange={(v) => set({ Kt: v })} />
            <NumField label="Current limit" value={s.iMax} unit="A" min={1} max={300} onChange={(v) => set({ iMax: v })} />
            <h4>Mechanism and load</h4>
            <NumField label="Gear ratio" value={s.gear} min={1} max={100} onChange={(v) => set({ gear: v })} />
            <NumField label="Screw lead" value={s.lead} scale={1000} unit="mm/rev" min={1} max={50} onChange={(v) => set({ lead: v })} />
            <NumField label="Nozzle inertia" value={s.Jn} unit="kg·m²" min={1} max={5000} onChange={(v) => set({ Jn: v })} />
            <NumField label="Hinge moment" value={s.hinge} unit="N·m" min={0} max={50000} onChange={(v) => set({ hinge: v })} />
            <h4>Loop bandwidths</h4>
            <NumField label="Current loop" value={s.fi} unit="Hz" min={50} max={5000} onChange={(v) => set({ fi: v })} />
            <NumField label="Velocity loop" value={s.fv} unit="Hz" min={5} max={1000} onChange={(v) => set({ fv: v })} />
            <NumField label="Position loop" value={s.fp} unit="Hz" min={0.5} max={200} onChange={(v) => set({ fp: v })} />
          </>
        }
      >
        <Readouts>
          <Derived label="Rise time (10–90 %)" value={fmt(r.riseTime * 1000, 1)} unit="ms" />
          <Derived label="Settling (2 %)" value={fmt(r.settle * 1000, 0)} unit="ms" />
          <Derived label="Overshoot" value={fmt(r.overshoot, 1)} unit="%" warn={r.overshoot > 20} />
          <Derived label="Peak slew" value={fmt(r.peakRate, 1)} unit="°/s" note={`no-load limit ${fmt(slew, 0)} °/s`} />
          <Derived label="Peak electrical power" value={fmt(r.peakPower / 1000, 2)} unit="kW" note={r.saturated ? 'Hit a voltage, current or speed limit' : 'Linear throughout'} />
          <Derived label="Phase margin" value={fmt(b.phaseMargin, 0)} unit="°" warn={b.phaseMargin < 45} note={`crossover ${fmt(b.crossover, 1)} Hz`} />
          <Derived label="Closed-loop bandwidth" value={fmt(b.bandwidth, 1)} unit="Hz" warn={b.bandwidth < 5} note="−3 dB" />
          <Derived label="Reflected load" value={fmt(s.Jn * ratio(s) ** 2 * 1e7, 1)} unit="g·cm²" note={`motor rotor ${fmt(s.Jm * 1e7, 0)} g·cm², total ${fmt(jEq(s) * 1e7, 0)}`} />
        </Readouts>
        <Block title="Nozzle angle" note="A 10 ms delay, then the step command. Large steps ride the speed limit (straight ramp) before the position loop takes over.">
          <Chart
            series={[
              { label: 'Command', x: t, y: r.points.map((p) => p.cmd), color: 1, dashed: true },
              { label: 'Nozzle', x: t, y: r.points.map((p) => p.delta) },
            ]}
            xLabel="Time (ms)"
            yLabel="Deflection (°)"
            height={280}
          />
        </Block>
        <Block title="Motor current">
          <Chart series={[{ label: 'Current', x: t, y: r.points.map((p) => p.i), color: 1 }]} xLabel="Time (ms)" yLabel="Amps" height={220} />
        </Block>
        <Block title="Open-loop Bode plot (position loop)" note="Gain crosses 0 dB at the crossover frequency. Phase margin is how far the phase is from −180° there. Below about 30° the response rings.">
          <Chart series={[{ label: 'Gain', x: lf, y: b.pts.map((p) => p.mag) }]} xLabel="Frequency (Hz)" yLabel="Gain (dB)" fx={logFmt} markers={[{ x: Math.log10(b.crossover), label: 'Crossover' }]} height={240} />
          <Chart series={[{ label: 'Phase', x: lf, y: b.pts.map((p) => p.phase), color: 1 }]} xLabel="Frequency (Hz)" yLabel="Phase (°)" fx={logFmt} markers={[{ x: Math.log10(b.crossover), label: 'Crossover' }]} height={220} />
        </Block>
        {maxGimbal > 0 && (
          <p className="an-note">
            Your last flight with attitude control on demanded up to {fmt(maxGimbal, 2)}° of gimbal; this actuator's stroke is ±{s.stroke}°.
          </p>
        )}
      </Workbench>
      <Sources>
        <ul>
          <li>DC motor model and cascaded PI tuning by bandwidth separation: standard servo-drive practice (e.g. G. Ellis, Control System Design Guide, 4th ed.).</li>
          <li>Gains are set from the requested bandwidths: K_pi = L·ω_i, K_ii = R·ω_i; K_pv = J·ω_v/K_t, K_iv = K_pv·ω_v/5; K_pp = ω_p. Anti-windup by conditional integration.</li>
          <li>Hinge moment is modelled as a constant torque opposing motion. Nozzle and structural compliance, and backlash, are not modelled; real TVC designs must keep crossover well below those resonances.</li>
          <li>Default values are representative of an upper-stage-class EMA, not a specific product.</li>
        </ul>
      </Sources>
    </section>
  );
}
