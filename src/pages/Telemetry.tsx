import { useEffect, useMemo, type ReactNode } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import Chart, { type Marker, type Series } from '../components/Chart';
import { fmtClock } from '../sim/playback';
import type { FlightResult, Sample } from '../sim/simulate';
import { useSim } from '../sim/store';
import './telemetry.css';

interface Channel {
  id: string;
  group: string;
  label: string;
  yLabel: string;
  series: Array<{ label: string; y: (s: Sample) => number; color?: number }>;
  x?: { label: string; f: (s: Sample) => number };
  explain: ReactNode;
  logY?: boolean;
  yMin?: number;
  yMax?: number;
  /** Only plot while this holds (e.g. in the atmosphere) */
  when?: (s: Sample) => boolean;
  lesson?: string;
}

const CHANNELS: Channel[] = [
  {
    id: 'altitude',
    group: 'Trajectory',
    label: 'Altitude',
    yLabel: 'Altitude (km)',
    series: [{ label: 'Altitude', y: (s) => s.alt / 1000 }],
    explain: 'Height above the WGS-84 ellipsoid. The curve flattens as the upper stage stops climbing and pours everything into horizontal speed.',
  },
  {
    id: 'profile',
    group: 'Trajectory',
    label: 'Ascent profile',
    yLabel: 'Altitude (km)',
    x: { label: 'Downrange distance (km)', f: (s) => s.downrange / 1000 },
    series: [{ label: 'Altitude', y: (s) => s.alt / 1000 }],
    explain: 'Altitude against ground distance: the shape of the climb. Notice how far downrange the vehicle travels compared with how high it goes. Orbit is mostly about going sideways.',
    lesson: 'gravity-turn',
  },
  {
    id: 'velocity',
    group: 'Trajectory',
    label: 'Speed',
    yLabel: 'Speed (m/s)',
    series: [
      { label: 'Inertial', y: (s) => s.vInertial },
      { label: 'Air-relative', y: (s) => s.vRel },
    ],
    explain: 'Inertial speed starts at the pad’s free eastward speed from Earth’s rotation. Air-relative speed starts at zero. The gap between them is that rotation boost.',
    lesson: 'launch-site',
  },
  {
    id: 'angles',
    group: 'Trajectory',
    label: 'Pitch and flight-path angle',
    yLabel: 'Angle above horizon (°)',
    series: [
      { label: 'Thrust pitch', y: (s) => (s.burning ? s.pitch : NaN) },
      { label: 'Flight path', y: (s) => s.gamma },
    ],
    explain: 'During the gravity turn the two lines lie on top of each other: the nose follows the velocity. Once the upper stage steers closed loop they separate, and the gap is steering loss.',
    lesson: 'guidance',
  },
  {
    id: 'orbit',
    group: 'Trajectory',
    label: 'Apoapsis and periapsis',
    yLabel: 'Altitude (km)',
    series: [
      { label: 'Apoapsis', y: (s) => (s.apo > 0 && s.apo < 3000e3 ? s.apo / 1000 : NaN) },
      { label: 'Periapsis', y: (s) => Math.max(s.peri / 1000, -400) },
    ],
    explain: 'The orbit the vehicle would follow if the engines stopped this instant. Orbit is achieved the moment periapsis climbs out of the atmosphere, which happens in the last minute of the burn.',
    yMin: -400,
    lesson: 'orbits',
  },
  {
    id: 'groundtrack',
    group: 'Trajectory',
    label: 'Ground track',
    yLabel: 'Latitude (°)',
    x: { label: 'Longitude (°)', f: (s) => s.lon },
    series: [{ label: 'Ground track', y: (s) => s.lat }],
    explain: 'The point on Earth directly below the vehicle. Its heading off the pad is the launch azimuth needed for the target inclination.',
    lesson: 'launch-site',
  },
  {
    id: 'mach',
    group: 'Aerodynamics',
    label: 'Mach number',
    yLabel: 'Mach',
    series: [{ label: 'Mach', y: (s) => s.mach }],
    when: (s) => s.alt < 90e3,
    explain: 'Air-relative speed divided by the local speed of sound. Sound is slower in the cold upper troposphere, so Mach rises faster than speed does.',
    lesson: 'drag',
  },
  {
    id: 'q',
    group: 'Aerodynamics',
    label: 'Dynamic pressure',
    yLabel: 'q (kPa)',
    series: [{ label: 'Dynamic pressure', y: (s) => s.q / 1000 }],
    when: (s) => s.alt < 100e3,
    explain: 'q = ½ρv². Speed rises while air density falls, so q climbs to a peak (max-Q) and then fades. Max-Q is the moment of greatest aerodynamic load on the structure.',
    lesson: 'drag',
  },
  {
    id: 'qalpha',
    group: 'Aerodynamics',
    label: 'q·α bending load',
    yLabel: 'q·α (kPa·°)',
    series: [{ label: 'q·α', y: (s) => s.qAlpha / 1000 }],
    when: (s) => s.alt < 100e3,
    explain: 'Dynamic pressure times angle of attack is the standard measure of side load on a slender vehicle. A gravity turn keeps α near zero precisely to keep this small.',
    lesson: 'loads',
  },
  {
    id: 'heating',
    group: 'Aerodynamics',
    label: 'Stagnation heating',
    yLabel: 'Heat flux (kW/m²)',
    series: [{ label: 'Heat flux', y: (s) => s.heatFlux / 1000 }],
    explain: 'Sutton–Graves estimate at the nose: q̇ = k·√(ρ/r_n)·v³. It peaks later and higher than max-Q because it grows with the cube of speed.',
    lesson: 'loads',
  },
  {
    id: 'atmosphere',
    group: 'Aerodynamics',
    label: 'Air density',
    yLabel: 'Density (kg/m³)',
    series: [{ label: 'Density', y: (s) => s.rho }],
    logY: true,
    explain: 'Density on a logarithmic axis. It falls by about a factor of ten every 16 km. The vehicle is out of 99 % of the atmosphere’s mass before it is moving fast.',
    lesson: 'atmosphere',
  },
  {
    id: 'thrust',
    group: 'Propulsion',
    label: 'Thrust',
    yLabel: 'Thrust (MN)',
    series: [{ label: 'Thrust', y: (s) => s.thrust / 1e6 }],
    explain: 'Watch it rise in the first minute even at constant throttle: less air pressure on the nozzle exit means more net thrust. The steps are throttling and staging.',
    lesson: 'engines',
  },
  {
    id: 'throttle',
    group: 'Propulsion',
    label: 'Throttle',
    yLabel: 'Throttle (%)',
    series: [{ label: 'Throttle', y: (s) => s.throttle * 100 }],
    yMin: 0,
    yMax: 105,
    explain: 'The bucket around max-Q, the core held back while boosters burn, and the late-burn taper that keeps acceleration under the limit.',
  },
  {
    id: 'mass',
    group: 'Propulsion',
    label: 'Vehicle mass',
    yLabel: 'Mass (t)',
    series: [{ label: 'Mass', y: (s) => s.mass / 1000 }],
    explain: 'Most of the vehicle is propellant. Each vertical drop is hardware thrown away at staging.',
    lesson: 'staging',
  },
  {
    id: 'accel',
    group: 'Loads',
    label: 'Axial acceleration',
    yLabel: 'Acceleration (g)',
    series: [{ label: 'Axial g', y: (s) => s.axialG }],
    explain: 'Thrust minus drag, per unit mass. It climbs through each burn because thrust stays nearly constant while mass falls, until the acceleration limit throttles the engines back.',
    lesson: 'loads',
  },
  {
    id: 'drag',
    group: 'Loads',
    label: 'Drag force',
    yLabel: 'Drag (kN)',
    series: [{ label: 'Drag', y: (s) => s.drag / 1000 }],
    when: (s) => s.alt < 100e3,
    explain: 'D = q·C_D·A. Compare its peak with thrust: drag is a small fraction, which is why drag loss is the smallest item in the Δv budget.',
    lesson: 'drag',
  },
];

const GROUPS = ['Trajectory', 'Aerodynamics', 'Propulsion', 'Loads'];

export default function Telemetry() {
  const { channel = 'altitude' } = useParams();
  const { result, fly, stale } = useSim();
  useEffect(() => {
    if (!result || stale) fly();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="tm">
      <nav className="tm-nav" aria-label="Telemetry channels">
        <h1>Telemetry</h1>
        {GROUPS.map((g) => (
          <div key={g} className="tm-group">
            <h2>{g}</h2>
            {CHANNELS.filter((c) => c.group === g).map((c) => (
              <NavLink key={c.id} to={`/telemetry/${c.id}`} className={({ isActive }) => (isActive ? 'active' : '')}>
                {c.label}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="tm-group">
          <h2>Mission</h2>
          <NavLink to="/telemetry/budget" className={({ isActive }) => (isActive ? 'active' : '')}>
            Δv budget
          </NavLink>
          <NavLink to="/telemetry/events" className={({ isActive }) => (isActive ? 'active' : '')}>
            Event log
          </NavLink>
        </div>
      </nav>
      <section className="tm-body">
        {!result || !result.samples.length ? (
          <div className="tm-empty">
            <h2>No flight yet</h2>
            <p>Telemetry appears after a flight. If the vehicle can't lift off there is nothing to record.</p>
            <Link className="btn" to="/flight">
              Go to Flight
            </Link>
          </div>
        ) : channel === 'budget' ? (
          <Budget r={result} />
        ) : channel === 'events' ? (
          <Events r={result} />
        ) : (
          <ChannelView r={result} c={CHANNELS.find((c) => c.id === channel) ?? CHANNELS[0]} />
        )}
      </section>
    </div>
  );
}

function ChannelView({ r, c }: { r: FlightResult; c: Channel }) {
  const data = useMemo(() => {
    const ss = c.when ? r.samples.filter(c.when) : r.samples;
    const xs = ss.map((s) => (c.x ? c.x.f(s) : s.t));
    const series: Series[] = c.series.map((d, i) => ({ label: d.label, x: xs, y: ss.map(d.y), color: d.color ?? i }));
    return { series, ss };
  }, [r, c]);
  const markers: Marker[] = c.x
    ? []
    : r.events
        .filter((e) => ['max-q', 'booster-sep', 'meco', 'stage-sep', 'fairing-sep', 'seco', 'depletion'].includes(e.kind))
        .filter((e) => !c.when || e.t <= (data.ss.at(-1)?.t ?? 0))
        .map((e) => ({ x: e.t, label: e.label.replace('Main engine cutoff', 'MECO').replace('Orbit insertion cutoff', 'SECO') }));
  const main = data.series[0];
  let peakI = 0;
  main.y.forEach((v, i) => {
    if (Number.isFinite(v) && v > main.y[peakI]) peakI = i;
  });
  return (
    <article>
      <h2 className="tm-title">{c.label}</h2>
      <p className="tm-explain">{c.explain}</p>
      <div className="tm-chart">
        <Chart
          series={data.series}
          xLabel={c.x?.label ?? 'Mission time (s)'}
          yLabel={c.yLabel}
          markers={markers}
          height={420}
          logY={c.logY}
          yMin={c.yMin}
          yMax={c.yMax}
        />
      </div>
      <dl className="tm-stats">
        <div>
          <dt>Peak {main.label.toLowerCase()}</dt>
          <dd className="num">{Number.isFinite(main.y[peakI]) ? (Math.abs(main.y[peakI]) < 1e-3 ? main.y[peakI].toExponential(2) : main.y[peakI].toFixed(2)) : '—'}</dd>
        </div>
        {!c.x && (
          <div>
            <dt>At</dt>
            <dd className="num">{fmtClock(data.ss[peakI]?.t ?? 0)}</dd>
          </div>
        )}
        <div>
          <dt>Altitude there</dt>
          <dd className="num">{((data.ss[peakI]?.alt ?? 0) / 1000).toFixed(1)} km</dd>
        </div>
      </dl>
      {c.lesson && (
        <p className="tm-lesson">
          The theory behind this: <Link to={`/academy/${c.lesson}`}>read the lesson</Link>.
        </p>
      )}
    </article>
  );
}

function Budget({ r }: { r: FlightResult }) {
  const t = r.totals;
  const cut = r.cutoffState ? r.samples.filter((s) => s.t <= r.cutoffState!.t).at(-1) : r.samples.at(-1);
  const vFinal = cut?.vInertial ?? 0;
  const predicted = t.vEarthAssist + t.dvIdeal - t.lossGravity - t.lossDrag - t.lossSteering;
  const rows: Array<{ label: string; v: number; sign: 1 | -1 | 0; note: string }> = [
    { label: 'Earth rotation at the pad', v: t.vEarthAssist, sign: 1, note: 'Free eastward speed, ω·R·cos(latitude).' },
    { label: 'Ideal Δv delivered', v: t.dvIdeal, sign: 1, note: '∫ T/m dt: what the engines produced, as if there were nothing in the way.' },
    { label: 'Gravity loss', v: t.lossGravity, sign: -1, note: '∫ g·sin γ dt: thrust spent holding the vehicle up instead of speeding it up.' },
    { label: 'Steering loss', v: t.lossSteering, sign: -1, note: '∫ (T/m)(1 − cos α) dt: thrust not pointed along the velocity.' },
    { label: 'Drag loss', v: t.lossDrag, sign: -1, note: '∫ D/m dt: energy given to the air.' },
  ];
  const max = Math.max(...rows.map((x) => x.v), vFinal, 1);
  return (
    <article>
      <h2 className="tm-title">Δv budget</h2>
      <p className="tm-explain">
        Where every metre per second went. The engines produce the ideal Δv; gravity, steering and drag take their share; what
        is left, plus Earth’s rotation, is the speed at cutoff. Losses are integrated along the real trajectory, not estimated.
      </p>
      <div className="budget">
        {rows.map((x) => (
          <div key={x.label} className="budget-row">
            <div className="budget-label">
              <strong>{x.label}</strong>
              <span>{x.note}</span>
            </div>
            <div className="budget-bar-wrap">
              <div className={'budget-bar' + (x.sign < 0 ? ' loss' : '')} style={{ width: `${(x.v / max) * 100}%` }} />
            </div>
            <div className="budget-v num">
              {x.sign < 0 ? '−' : '+'}
              {x.v.toFixed(0)} m/s
            </div>
          </div>
        ))}
        <div className="budget-row total">
          <div className="budget-label">
            <strong>Speed at cutoff</strong>
            <span>
              Measured {vFinal.toFixed(0)} m/s. The ledger predicts {predicted.toFixed(0)} m/s; the {Math.abs(predicted - vFinal).toFixed(0)} m/s difference is
              because these are scalar sums of quantities that act along a turning vector.
            </span>
          </div>
          <div className="budget-bar-wrap">
            <div className="budget-bar final" style={{ width: `${(vFinal / max) * 100}%` }} />
          </div>
          <div className="budget-v num">{vFinal.toFixed(0)} m/s</div>
        </div>
      </div>
      <p className="tm-lesson">
        The theory behind this: <Link to="/academy/gravity-turn">gravity turn and losses</Link>.
      </p>
    </article>
  );
}

function Events({ r }: { r: FlightResult }) {
  return (
    <article>
      <h2 className="tm-title">Event log</h2>
      <p className="tm-explain">Every discrete event the sequencer raised, in order. Select a time to watch that moment on the Flight page.</p>
      <ol className="events">
        {r.events.map((e, i) => (
          <li key={i}>
            <Link className="events-t num" to={`/flight?at=${Math.max(0, e.t - 3).toFixed(0)}`}>
              {fmtClock(e.t)}
            </Link>
            <div>
              <strong>{e.label}</strong>
              <span>{e.detail}</span>
            </div>
            <span className="events-alt num">{(e.alt / 1000).toFixed(1)} km</span>
          </li>
        ))}
      </ol>
    </article>
  );
}
