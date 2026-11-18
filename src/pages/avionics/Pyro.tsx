import { useMemo, useState } from 'react';
import Chart from '../../components/Chart';
import { Derived, NumField, SelectField } from '../../components/Field';
import { DEFAULT_CIRCUIT, fire, NSI, steadyRise, timeToFire, type CircuitSpec } from '../../avionics/pyro';
import { fmtClock } from '../../sim/playback';
import { Block, Intro, Readouts, Sources, Workbench, fmt, useFlight } from './common';

const PYRO_EVENTS = ['booster-sep', 'stage-sep', 'fairing-sep'];

export default function Pyro() {
  const flight = useFlight();
  const [c, setC] = useState<CircuitSpec>(DEFAULT_CIRCUIT);
  const [armed, setArmed] = useState({ sa: true, arm: true, fire: true });
  const set = (p: Partial<CircuitSpec>) => setC((o) => ({ ...o, ...p }));
  const r = useMemo(() => fire(NSI, c), [c]);
  const allOk = armed.sa && armed.arm && armed.fire;
  const t = r.points.map((p) => p.t * 1000);
  const currents = Array.from({ length: 50 }, (_, i) => 0.5 + i * 0.1);
  const pyroEvents = flight.events.filter((e) => PYRO_EVENTS.includes(e.kind));

  return (
    <section>
      <Intro title="Pyrotechnics and flight termination" kicker="08 · Pyrotechnics">
        <p>
          Staging, fairing jettison and flight termination all run on small explosive devices. Each is set off by an initiator: a
          thin bridgewire buried in a heat-sensitive primer. Push enough current through the wire and it heats the primer past
          ignition in about a millisecond. The hard part is the reverse requirement. Stray currents from radio transmitters,
          static or a shorted harness must never fire it.
        </p>
        <p>
          That is why initiators are specified by two currents. The NASA Standard Initiator must survive 1 A (1 W) for five minutes
          without firing and must always fire at 3.5 A. The model below is calibrated to those two points. The firing circuit is a
          capacitor-discharge unit (CDU) or a current-limited battery feed.
        </p>
      </Intro>
      <Workbench
        controls={
          <>
            <h4>Firing circuit</h4>
            <SelectField
              label="Topology"
              value={c.mode}
              options={[
                { value: 'cdu', label: 'Capacitor discharge (CDU)' },
                { value: 'battery', label: 'Battery, current-limited' },
              ]}
              onChange={(v) => set({ mode: v })}
            />
            {c.mode === 'cdu' && <NumField label="Capacitance" value={c.capacitance} scale={1e6} unit="µF" min={1} max={100000} onChange={(v) => set({ capacitance: v })} />}
            <NumField label={c.mode === 'cdu' ? 'Charge voltage' : 'Battery voltage'} value={c.voltage} unit="V" min={1} max={300} onChange={(v) => set({ voltage: v })} />
            {c.mode === 'battery' && <NumField label="Current limit" value={c.currentLimit} unit="A" min={0.1} max={50} onChange={(v) => set({ currentLimit: v })} />}
            <NumField label="Harness resistance" value={c.harness} unit="Ω" min={0} max={50} onChange={(v) => set({ harness: v })} hint="Long runs through connectors add up" />
            <NumField label="Switch on-resistance" value={c.switchR} scale={1000} unit="mΩ" min={0} max={5000} onChange={(v) => set({ switchR: v })} />
            <NumField label="Fire pulse" value={c.pulse} scale={1000} unit="ms" min={0.1} max={1000} onChange={(v) => set({ pulse: v })} />
            <h4>Inhibits</h4>
            {(
              [
                ['sa', 'Safe & arm device rotated to ARM'],
                ['arm', 'ARM command from flight computer'],
                ['fire', 'FIRE command at event time'],
              ] as const
            ).map(([k, label]) => (
              <label className="av-check" key={k}>
                <input type="checkbox" checked={armed[k]} onChange={(e) => setArmed({ ...armed, [k]: e.target.checked })} /> {label}
              </label>
            ))}
          </>
        }
      >
        <Readouts>
          <Derived label="Initiator" value={allOk ? (r.fired ? 'FIRED' : 'NO FIRE') : 'SAFE'} warn={allOk && !r.fired} note={allOk ? (r.fired ? `at ${fmt(r.fireTime * 1000, 3)} ms` : 'Insufficient energy: a dud separation') : 'An inhibit is open: the circuit cannot reach the bridgewire'} />
          <Derived label="Peak current" value={fmt(r.peakI, 2)} unit="A" note="all-fire is 3.5 A" warn={r.peakI < 3.5} />
          <Derived label="Energy into bridge" value={fmt(r.energyToBridge * 1000, 1)} unit="mJ" />
          <Derived label="Loop resistance" value={fmt(NSI.rBridge + c.harness + c.switchR, 2)} unit="Ω" />
          <Derived label="No-fire check (1 A)" value={`${fmt(steadyRise(NSI, 1), 0)} K`} note={`steady rise, ignition at ${NSI.dtIgnite} K: safe`} />
        </Readouts>
        <Block title="Bridgewire current and temperature" note="The wire must reach the ignition temperature (dashed) before the pulse ends or the capacitor drains.">
          <Chart
            series={[
              { label: 'Temperature rise (K/100)', x: t, y: r.points.map((p) => (allOk ? p.dT / 100 : 0)) },
              { label: 'Current (A)', x: t, y: r.points.map((p) => (allOk ? p.i : 0)), color: 1 },
              { label: 'Ignition (K/100)', x: [0, t[t.length - 1]], y: [NSI.dtIgnite / 100, NSI.dtIgnite / 100], color: 2, dashed: true },
            ]}
            xLabel="Time (ms)"
            yLabel="A · K/100"
            yMin={0}
            height={280}
          />
        </Block>
        <Block title="Time to fire against constant current" note="Below about 1.2 A the wire reaches a steady temperature short of ignition and never fires, so the curve starts there. Above it, time to fire falls steeply.">
          <Chart
            series={[{ label: 'Time to fire', x: currents, y: currents.map((i) => timeToFire(NSI, i) * 1000) }]}
            xLabel="Current (A)"
            yLabel="ms (log)"
            logY
            markers={[{ x: 3.5, label: 'All-fire 3.5 A' }]}
            height={240}
          />
        </Block>
        <Block title="Pyro events in your flight">
          <table className="av-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Mission time</th>
                <th>Devices (typical)</th>
                <th>Redundancy</th>
              </tr>
            </thead>
            <tbody>
              {pyroEvents.map((e) => (
                <tr key={e.kind + e.t}>
                  <td>{e.label}</td>
                  <td className="num">{fmtClock(e.t)}</td>
                  <td>{e.kind === 'fairing-sep' ? 'Separation joint charge, pushers' : 'Separation nuts / linear shaped charge'}</td>
                  <td>Dual initiators, two independent firing lanes</td>
                </tr>
              ))}
              {!pyroEvents.length && (
                <tr>
                  <td colSpan={4}>No separation events in this flight.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Block>
        <Block title="Flight termination system" note="Kept separate from everything above.">
          <div className="av-prose">
            <p>
              The FTS has its own batteries, its own command receivers (or autonomous on-board logic) and its own initiators and
              charges. It must work after any single failure in the vehicle, including the flight computers losing control. Range
              rules require it to be armed before liftoff and safed only once the vehicle reaches orbit or can no longer endanger
              people.
            </p>
            <p>
              Traditional systems listen for a secure command tone sequence from range safety officers. Autonomous FTS units carry
              the corridor boundaries on board and make the destruct decision themselves from independent GNSS and inertial
              sensors. They remove the dependence on ground radar and command transmitters and allow launches on trajectories the
              ground could not cover.
            </p>
          </div>
        </Block>
      </Workbench>
      <Sources>
        <ul>
          <li>NASA Standard Initiator (NSI-1) acceptance criteria: 1.0 Ω ± 0.1 bridgewire, no-fire 1 A / 1 W for 5 min, all-fire 3.5 A. See NASA Reference Publication 1326, A Review of Pyrotechnic Devices and Systems (L. Bement).</li>
          <li>Lumped bridgewire parameters (R_th = 200 K/W, C_th = 50 µJ/K, ignition at +300 K) are chosen to satisfy those two points. They are not measured values.</li>
          <li>Range safety: RCC 319 Flight Termination Systems Commonality Standard; FAA 14 CFR Part 450.</li>
        </ul>
      </Sources>
    </section>
  );
}
