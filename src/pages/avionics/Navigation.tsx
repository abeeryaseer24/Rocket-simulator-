import { useMemo, useState } from 'react';
import Chart from '../../components/Chart';
import { Derived, NumField, SelectField } from '../../components/Field';
import { IMU_GRADES, simulateNavigation } from '../../avionics/navigation';
import { Block, Intro, Readouts, Sources, Workbench, fmt, useFlight } from './common';

const dist = (m: number) => (m >= 1000 ? `${fmt(m / 1000, 2)} km` : `${fmt(m, 1)} m`);

export default function Navigation() {
  const flight = useFlight();
  const [gradeId, setGradeId] = useState('tactical');
  const [gnssOn, setGnssOn] = useState(true);
  const [cocom, setCocom] = useState(false);
  const [rate, setRate] = useState(1);
  const [sigma, setSigma] = useState(3);
  const [seed, setSeed] = useState(1);
  const grade = IMU_GRADES.find((g) => g.id === gradeId)!;
  const gnss = { enabled: gnssOn, rate, sigmaH: sigma, sigmaV: sigma * 1.7, cocom };
  const nav = useMemo(() => simulateNavigation(flight.samples, grade, gnss, seed), [flight, grade, gnssOn, rate, sigma, cocom, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const ins = useMemo(() => simulateNavigation(flight.samples, grade, { ...gnss, enabled: false }, seed), [flight, grade, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = nav.points.map((p) => p.t);
  const markers = flight.events.filter((e) => ['meco', 'seco'].includes(e.kind)).map((e) => ({ x: e.t, label: e.label }));
  if (nav.gnssLostAt !== null) markers.push({ x: nav.gnssLostAt, label: 'GNSS lost' });

  return (
    <section>
      <Intro title="Inertial navigation and GNSS aiding" kicker="03 · Navigation">
        <p>
          The flight computer knows where it is by integrating its IMU twice: acceleration to velocity, velocity to position. Every
          sensor error is integrated too. A constant accelerometer bias gives position error growing as t², and a gyro bias tilts
          the computed frame so the vehicle's own thrust leaks into the wrong axis. During a 4 g burn that error grows very fast.
        </p>
        <p>
          A Kalman filter fixes this by blending in GNSS position fixes. It keeps an 8-state error model (position, velocity, tilt,
          three sensor biases) with a covariance that says how far to trust each source. The "truth" errors below are drawn from the
          sensor grade you pick, along the trajectory you actually flew.
        </p>
      </Intro>
      <Workbench
        controls={
          <>
            <h4>Inertial sensors</h4>
            <SelectField label="IMU grade" value={gradeId} options={IMU_GRADES.map((g) => ({ value: g.id, label: g.name }))} onChange={setGradeId} />
            <table className="av-table">
              <tbody>
                <tr><th>Gyro bias</th><td className="num">{grade.gyroBias} °/h</td></tr>
                <tr><th>Angle random walk</th><td className="num">{grade.arw} °/√h</td></tr>
                <tr><th>Accel bias</th><td className="num">{grade.accelBias} µg</td></tr>
                <tr><th>Velocity random walk</th><td className="num">{grade.vrw} m/s/√h</td></tr>
              </tbody>
            </table>
            <h4>GNSS</h4>
            <label className="av-check">
              <input type="checkbox" checked={gnssOn} onChange={(e) => setGnssOn(e.target.checked)} /> Aid with GNSS fixes
            </label>
            <label className="av-check">
              <input type="checkbox" checked={cocom} onChange={(e) => setCocom(e.target.checked)} /> Commercial receiver (CoCom limits apply)
            </label>
            <NumField label="Fix rate" value={rate} unit="Hz" min={0.1} max={10} onChange={setRate} />
            <NumField label="Horizontal noise (1σ)" value={sigma} unit="m" min={0.1} max={100} onChange={setSigma} />
            <NumField label="Random seed" value={seed} min={1} max={9999} step={1} onChange={(v) => setSeed(Math.round(v))} hint="Each seed draws different sensor biases." />
          </>
        }
      >
        <Readouts>
          <Derived label="Unaided error at end" value={dist(ins.insFinal)} warn={ins.insFinal > 1000} note="Pure inertial, no fixes" />
          <Derived label={gnssOn ? 'Aided error at end' : 'Aiding off'} value={gnssOn ? dist(nav.aidedFinal) : '—'} note={gnssOn ? 'Kalman filter output' : undefined} />
          <Derived label="Tilt error at end" value={fmt(ins.points[ins.points.length - 1]?.tiltDeg ?? 0, 3)} unit="°" note="from gyro bias + random walk" />
          <Derived label="GNSS" value={nav.gnssLostAt !== null ? `Lost T+${fmt(nav.gnssLostAt, 0)} s` : gnssOn ? 'Tracking' : 'Off'} warn={nav.gnssLostAt !== null} note={nav.gnssLostAt !== null ? 'Above 18 km and 515 m/s' : undefined} />
        </Readouts>
        <Block title="Position error" note="Log scale. The dashed line is the filter's own 3σ estimate of its error: a well-tuned filter keeps the true error inside it.">
          <Chart
            series={[
              { label: 'INS only', x: t, y: ins.points.map((p) => Math.max(p.insErr, 0.01)), color: 1 },
              ...(gnssOn
                ? [
                    { label: 'GNSS-aided', x: t, y: nav.points.map((p) => Math.max(p.aidedErr, 0.01)), color: 0 },
                    { label: 'Filter 3σ', x: t, y: nav.points.map((p) => Math.max(p.bound3, 0.01)), color: 0, dashed: true },
                  ]
                : []),
            ]}
            xLabel="Mission time (s)"
            yLabel="Position error (m)"
            logY
            markers={markers}
            height={320}
          />
        </Block>
        <Block title="Velocity error">
          <Chart
            series={[
              { label: 'INS only', x: t, y: ins.points.map((p) => Math.max(p.insVel, 1e-3)), color: 1 },
              ...(gnssOn ? [{ label: 'GNSS-aided', x: t, y: nav.points.map((p) => Math.max(p.aidedVel, 1e-3)), color: 0 }] : []),
            ]}
            xLabel="Mission time (s)"
            yLabel="Velocity error (m/s)"
            logY
            height={260}
          />
        </Block>
      </Workbench>
      <Sources>
        <ul>
          <li>Grade values are typical orders of magnitude as tabulated in P. D. Groves, Principles of GNSS, Inertial, and Multisensor Integrated Navigation Systems (2nd ed., 2013). Real parts vary by an order of magnitude within a grade.</li>
          <li>Planar error model: tilt about the cross-range axis only, no gravity-model or scale-factor errors, no Schuler feedback (negligible over minutes).</li>
          <li>CoCom limits: the export-control thresholds of 18 km (60,000 ft) and 515 m/s (1,000 knots) built into commercial GNSS receivers. Modelled here as "both exceeded"; some firmware cuts off when either is exceeded.</li>
          <li>Loosely-coupled filter (position fixes, not raw pseudoranges), discretised as Φ ≈ I + FΔt with Joseph-form covariance update.</li>
        </ul>
      </Sources>
    </section>
  );
}
