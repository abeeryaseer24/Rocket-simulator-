import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import Chart, { SERIES_COLORS } from '../components/Chart';
import { NumField } from '../components/Field';
import { DEFAULT_DISPERSIONS, stats, type Dispersions, type McRun } from '../sim/analysis';
import OptimiseTool from './analysis/OptimiseTool';
import ValidationTool from './analysis/ValidationTool';
import type { WorkerRequest } from '../sim/analysis.worker';
import { useSim } from '../sim/store';
import './analysis.css';

function useAnalysisWorker() {
  const ref = useRef<Worker | null>(null);
  useEffect(() => () => ref.current?.terminate(), []);
  return (onMsg: (m: MessageEvent) => void) => {
    ref.current?.terminate();
    const w = new Worker(new URL('../sim/analysis.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = onMsg;
    ref.current = w;
    return {
      post: (r: WorkerRequest) => w.postMessage(r),
      stop: () => {
        w.terminate();
        ref.current = null;
      },
    };
  };
}

export default function Analysis() {
  const { tool = 'dispersion' } = useParams();
  return (
    <div className="an">
      <header>
        <h1>Analysis</h1>
        <p className="lede">Questions one flight can't answer. Each tool flies your current vehicle many times in a background thread.</p>
      </header>
      <nav className="tabs" aria-label="Analysis tools">
        <NavLink to="/analysis/dispersion" className={({ isActive }) => (isActive ? 'active' : '')}>
          Monte Carlo dispersion
        </NavLink>
        <NavLink to="/analysis/payload" className={({ isActive }) => (isActive ? 'active' : '')}>
          Payload capacity
        </NavLink>
        <NavLink to="/analysis/optimise" className={({ isActive }) => (isActive ? 'active' : '')}>
          Trajectory optimiser
        </NavLink>
        <NavLink to="/analysis/validation" className={({ isActive }) => (isActive ? 'active' : '')}>
          Validation
        </NavLink>
      </nav>
      {tool === 'payload' ? <PayloadTool /> : tool === 'optimise' ? <OptimiseTool /> : tool === 'validation' ? <ValidationTool /> : <DispersionTool />}
    </div>
  );
}

function DispersionTool() {
  const { vehicle } = useSim();
  const start = useAnalysisWorker();
  const [n, setN] = useState(200);
  const [seed, setSeed] = useState(1);
  const [d, setD] = useState<Dispersions>(DEFAULT_DISPERSIONS);
  const [runs, setRuns] = useState<McRun[]>([]);
  const [busy, setBusy] = useState(false);
  const ctl = useRef<{ stop: () => void } | null>(null);

  const go = () => {
    setRuns([]);
    setBusy(true);
    const w = start((e) => {
      if (e.data.type === 'mc-progress') setRuns((r) => [...r, ...e.data.runs]);
      if (e.data.type === 'done') setBusy(false);
    });
    ctl.current = w;
    w.post({ type: 'mc', vehicle, n, seed, d });
  };

  const ok = runs.filter((r) => r.outcome === 'orbit');
  const pOrbit = runs.length ? ok.length / runs.length : NaN;
  // Wilson score interval: honest uncertainty on a success fraction from a finite sample
  const ci = useMemo(() => {
    const m = runs.length;
    if (!m) return [NaN, NaN];
    const z = 1.96;
    const p = ok.length / m;
    const den = 1 + (z * z) / m;
    const c = (p + (z * z) / (2 * m)) / den;
    const h = (z * Math.sqrt((p * (1 - p)) / m + (z * z) / (4 * m * m))) / den;
    return [c - h, c + h];
  }, [runs.length, ok.length]);
  const sPeri = stats(ok.map((r) => r.peri / 1000));
  const sApo = stats(ok.map((r) => r.apo / 1000));
  const sInc = stats(ok.map((r) => r.inc));
  const sMargin = stats(runs.map((r) => r.margin / 1000));
  const sQ = stats(runs.map((r) => r.maxQ / 1000));

  return (
    <section className="an-tool">
      <div className="an-intro">
        <h2>Monte Carlo dispersion</h2>
        <p>
          No two rockets are identical. Engines come off the test stand a little hot or cold, tanks load a few hundred kilograms
          heavy, and the air is never exactly the standard atmosphere. Here every flight draws its own errors from a normal
          distribution, the way launch providers estimate how likely a mission is to succeed.
        </p>
      </div>

      <div className="an-controls">
        <label>
          Flights
          <select value={n} onChange={(e) => setN(+e.target.value)} disabled={busy}>
            {[100, 200, 500, 1000].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Seed
          <input type="number" value={seed} onChange={(e) => setSeed(+e.target.value || 1)} disabled={busy} />
        </label>
        {busy ? (
          <button className="btn" onClick={() => (ctl.current?.stop(), setBusy(false))}>
            Stop
          </button>
        ) : (
          <button className="btn" onClick={go}>
            Run {n} flights
          </button>
        )}
        {busy && (
          <div className="an-progress" aria-label="Progress">
            <div style={{ width: `${(runs.length / n) * 100}%` }} />
          </div>
        )}
      </div>

      <details className="an-settings">
        <summary>Dispersion settings (1-σ)</summary>
        <NumField label="Engine thrust" value={d.thrust} scale={100} unit="%" min={0} max={20} onChange={(v) => setD({ ...d, thrust: v })} />
        <NumField label="Specific impulse" value={d.isp} scale={100} unit="%" min={0} max={10} onChange={(v) => setD({ ...d, isp: v })} />
        <NumField label="Dry mass" value={d.dryMass} scale={100} unit="%" min={0} max={20} onChange={(v) => setD({ ...d, dryMass: v })} />
        <NumField label="Propellant load" value={d.propLoad} scale={100} unit="%" min={0} max={10} onChange={(v) => setD({ ...d, propLoad: v })} />
        <NumField label="Drag coefficient" value={d.cd} scale={100} unit="%" min={0} max={50} onChange={(v) => setD({ ...d, cd: v })} />
        <NumField label="Pitch kick" value={d.pitchKick} unit="°" min={0} max={5} onChange={(v) => setD({ ...d, pitchKick: v })} />
      </details>

      {runs.length > 0 && (
        <>
          <div className="an-headline">
            <div className="an-big num">{(pOrbit * 100).toFixed(1)}%</div>
            <div>
              <strong>of flights reached a stable orbit</strong>
              <p className="num">
                95 % confidence: {(ci[0] * 100).toFixed(1)} – {(ci[1] * 100).toFixed(1)} % from {runs.length} flights
              </p>
            </div>
          </div>

          <div className="an-block">
            <h3>Where the orbits landed</h3>
            <p className="an-note">Each dot is one flight. A perfect vehicle would put every dot on the target.</p>
            <Scatter runs={runs} target={vehicle.guidance.targetAltitude / 1000} />
          </div>

          <div className="an-block">
            <h3>Propellant left at cutoff</h3>
            <p className="an-note">The margin is what absorbs the dispersions. Flights that ran out before orbit sit at zero.</p>
            <Histogram values={runs.map((r) => r.margin / 1000)} unit="t" />
          </div>

          <div className="an-block">
            <h3>Statistics</h3>
            <table className="an-stats">
              <thead>
                <tr>
                  <th scope="col">Quantity</th>
                  <th scope="col">Mean</th>
                  <th scope="col">1-σ</th>
                  <th scope="col">3-σ range</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Periapsis (km)', sPeri],
                    ['Apoapsis (km)', sApo],
                    ['Inclination (°)', sInc],
                    ['Propellant margin (t)', sMargin],
                    ['Max-Q (kPa)', sQ],
                  ] as const
                ).map(([label, st]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td className="num">{st.mean.toFixed(2)}</td>
                    <td className="num">{st.sd.toFixed(2)}</td>
                    <td className="num">
                      {(st.mean - 3 * st.sd).toFixed(2)} to {(st.mean + 3 * st.sd).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Scatter({ runs, target }: { runs: McRun[]; target: number }) {
  const W = 640;
  const H = 360;
  const m = { l: 60, r: 20, t: 16, b: 44 };
  const pts = runs.filter((r) => Number.isFinite(r.peri) && Number.isFinite(r.apo) && r.apo < 5e6);
  const xs = pts.map((r) => r.peri / 1000);
  const ys = pts.map((r) => r.apo / 1000);
  // Frame the cluster and the target, with breathing room proportional to the spread
  const span = (a: number[]) => {
    const lo = Math.min(target, ...a);
    const hi = Math.max(target, ...a);
    const pad = Math.max(4, (hi - lo) * 0.25);
    return [Math.max(lo - pad, 0), hi + pad];
  };
  const [x0, x1] = span(xs);
  const [y0, y1] = span(ys);
  const sx = (x: number) => m.l + ((Math.max(x, x0) - x0) / (x1 - x0)) * (W - m.l - m.r);
  const sy = (y: number) => H - m.b - ((y - y0) / (y1 - y0)) * (H - m.t - m.b);
  const [hover, setHover] = useState<McRun | null>(null);
  const color = (o: McRun['outcome']) => (o === 'orbit' ? SERIES_COLORS[0] : o === 'low-orbit' ? SERIES_COLORS[1] : 'var(--abort)');
  return (
    <div className="an-scatter">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Scatter of periapsis against apoapsis for each flight">
        <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} className="chart-axis" />
        <line x1={sx(target)} x2={sx(target)} y1={m.t} y2={H - m.b} className="chart-marker" />
        <line x1={m.l} x2={W - m.r} y1={sy(target)} y2={sy(target)} className="chart-marker" />
        <text x={sx(target) + 4} y={m.t + 10} className="chart-marker-label">
          Target {target.toFixed(0)} km
        </text>
        <text x={(W + m.l) / 2} y={H - 8} className="chart-axis-label" textAnchor="middle">
          Periapsis (km)
        </text>
        <text x={14} y={H / 2} className="chart-axis-label" textAnchor="middle" transform={`rotate(-90 14 ${H / 2})`}>
          Apoapsis (km)
        </text>
        {[x0, (x0 + x1) / 2, x1].map((v) => (
          <text key={'x' + v} x={sx(v)} y={H - m.b + 16} className="chart-tick" textAnchor="middle">
            {v.toFixed(0)}
          </text>
        ))}
        {[y0, (y0 + y1) / 2, y1].map((v) => (
          <text key={'y' + v} x={m.l - 6} y={sy(v)} className="chart-tick" textAnchor="end" dominantBaseline="middle">
            {v.toFixed(0)}
          </text>
        ))}
        {pts.map((r, i) => (
          <circle
            key={i}
            cx={sx(r.peri / 1000)}
            cy={sy(r.apo / 1000)}
            r={4}
            fill={color(r.outcome)}
            fillOpacity={0.75}
            stroke="var(--paper)"
            strokeWidth={1.5}
            onPointerEnter={() => setHover(r)}
            onPointerLeave={() => setHover(null)}
          />
        ))}
      </svg>
      <div className="chart-legend">
        <span>
          <span className="sw" style={{ background: SERIES_COLORS[0] }} />
          Stable orbit
        </span>
        <span>
          <span className="sw" style={{ background: SERIES_COLORS[1] }} />
          Low, decaying orbit
        </span>
        <span>
          <span className="sw" style={{ background: 'var(--abort)' }} />
          Suborbital (periapsis clipped to the left edge)
        </span>
      </div>
      {hover && (
        <p className="an-hover num">
          {(hover.peri / 1000).toFixed(1)} × {(hover.apo / 1000).toFixed(1)} km, {hover.inc.toFixed(2)}°, margin {(hover.margin / 1000).toFixed(2)} t
        </p>
      )}
    </div>
  );
}

function Histogram({ values, unit }: { values: number[]; unit: string }) {
  const v = values.filter(Number.isFinite);
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const bins = 24;
  const w = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  v.forEach((x) => counts[Math.min(bins - 1, Math.floor((x - lo) / w))]++);
  const xs = counts.map((_, i) => lo + (i + 0.5) * w);
  return <Chart series={[{ label: 'Flights', x: xs, y: counts }]} xLabel={`Margin (${unit})`} yLabel="Flights" height={240} yMin={0} />;
}

function PayloadTool() {
  const { vehicle } = useSim();
  const start = useAnalysisWorker();
  const [pts, setPts] = useState<Array<{ alt: number; kg: number }>>([]);
  const [busy, setBusy] = useState(false);
  const alts = [200, 300, 400, 500, 600, 800, 1000, 1200].map((k) => k * 1000);
  const go = () => {
    setPts([]);
    setBusy(true);
    const w = start((e) => {
      if (e.data.type === 'payload-point') setPts((p) => [...p, { alt: e.data.alt, kg: e.data.kg }]);
      if (e.data.type === 'done') setBusy(false);
    });
    w.post({ type: 'payload', vehicle, altitudes: alts });
  };
  const best = pts.length ? pts.reduce((a, b) => (b.kg > a.kg ? b : a)) : null;
  return (
    <section className="an-tool">
      <div className="an-intro">
        <h2>Payload capacity</h2>
        <p>
          The number on every launch vehicle's brochure. For each circular orbit altitude, the simulator searches for the
          heaviest payload that still reaches a stable orbit, by bisection on the full simulation. It keeps your current pitch
          program, so a retuned trajectory can do somewhat better.
        </p>
      </div>
      <div className="an-controls">
        <button className="btn" onClick={go} disabled={busy}>
          {busy ? `Searching… ${pts.length} of ${alts.length}` : 'Compute capacity curve'}
        </button>
        <span className="an-note">
          Inclination {vehicle.guidance.targetInclination}° from {vehicle.site.name}
        </span>
      </div>
      {pts.length > 0 && (
        <>
          {best && (
            <div className="an-headline">
              <div className="an-big num">{(best.kg / 1000).toFixed(1)} t</div>
              <div>
                <strong>to {(best.alt / 1000).toFixed(0)} km, the best point found</strong>
                <p>Higher orbits cost more: the vehicle has to lift the payload further against gravity and then circularise faster.</p>
              </div>
            </div>
          )}
          <div className="an-block">
            <Chart
              series={[{ label: 'Max payload', x: pts.map((p) => p.alt / 1000), y: pts.map((p) => p.kg / 1000) }]}
              xLabel="Circular orbit altitude (km)"
              yLabel="Payload (t)"
              height={340}
              yMin={0}
            />
          </div>
        </>
      )}
    </section>
  );
}
