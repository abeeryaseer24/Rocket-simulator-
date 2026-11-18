import { useId, useMemo, useState } from 'react';
import Chart from '../components/Chart';
import { atmosphere } from '../physics/atmosphere';
import { machFromArea, pressureRatio, temperatureRatio } from '../physics/nozzle';
import { Widget } from './widgets';

/**
 * A de Laval nozzle drawn to scale with the quasi-1D isentropic solution
 * painted inside it. The contour is a cylindrical chamber, a circular-arc
 * converging section, and a parabolic bell (initial angle 30°, exit 8°,
 * 80 % of the length of a 15° cone), the usual first approximation to a
 * Rao thrust-optimised contour.
 */

function contour(eps: number, n = 140) {
  const Rt = 1;
  const Re = Math.sqrt(eps) * Rt;
  const Rc = 1.8 * Rt;
  const Lc = 2.2;
  const Lconv = 1.6;
  const Lbell = (0.8 * (Re - Rt)) / Math.tan((15 * Math.PI) / 180);
  const t0 = Math.tan((30 * Math.PI) / 180);
  const t1 = Math.tan((8 * Math.PI) / 180);
  // Quadratic Bézier from throat (slope t0) to exit (slope t1): control at the tangents' intersection
  const xc = (Re - Rt - t1 * Lbell) / (t0 - t1);
  const ctrl = [Math.min(Math.max(xc, 0.05 * Lbell), 0.95 * Lbell), Rt + t0 * Math.min(Math.max(xc, 0.05 * Lbell), 0.95 * Lbell)];
  const pts: Array<{ x: number; r: number; sup: boolean }> = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const x = -Lc - Lconv + s * (Lc + Lconv);
    let r = Rc;
    if (x > -Lconv) {
      const u = (x + Lconv) / Lconv;
      r = Rt + (Rc - Rt) * 0.5 * (1 + Math.cos(Math.PI * u));
    }
    pts.push({ x, r, sup: false });
  }
  for (let i = 1; i <= n; i++) {
    const s = i / n;
    const x = 2 * (1 - s) * s * ctrl[0] + s * s * Lbell;
    const r = (1 - s) * (1 - s) * Rt + 2 * (1 - s) * s * ctrl[1] + s * s * Re;
    pts.push({ x, r, sup: true });
  }
  return { pts, Re, Lbell, Lc, Lconv, Rc };
}

/** Kapton-to-ink ramp: hot gas is bright, expanded cold gas is dark. */
function ramp(f: number) {
  const a = [241, 228, 198];
  const b = [185, 130, 26];
  const c = [20, 35, 58];
  const mix = (p: number[], q: number[], t: number) => p.map((v, i) => Math.round(v + (q[i] - v) * t));
  const rgb = f < 0.5 ? mix(a, b, f * 2) : mix(b, c, (f - 0.5) * 2);
  return `rgb(${rgb.join(',')})`;
}

function Slider({ label, value, min, max, step, onChange, unit }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit?: string }) {
  const id = useId();
  return (
    <div className="w-slider">
      <label htmlFor={id}>
        {label}
        <span className="num">
          {value}
          {unit && <small> {unit}</small>}
        </span>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export default function NozzleCutaway() {
  const [eps, setEps] = useState(16);
  const [pc, setPc] = useState(100);
  const [g, setG] = useState(1.2);
  const [tc, setTc] = useState(3500);
  const [alt, setAlt] = useState(0);
  const [field, setField] = useState<'mach' | 'temp'>('temp');
  const mw = 22;
  const geo = useMemo(() => contour(eps), [eps]);
  const stations = useMemo(
    () =>
      geo.pts.map((p) => {
        const M = machFromArea(p.r * p.r, g, p.sup);
        return { x: p.x, r: p.r, M, p: pressureRatio(M, g) * pc, T: temperatureRatio(M, g) * tc };
      }),
    [geo, g, pc, tc],
  );
  const exit = stations[stations.length - 1];
  const pa = atmosphere(alt * 1000).p / 1e5;
  const ve = exit.M * Math.sqrt(g * (8314.46 / mw) * exit.T);
  // Summerfield criterion: the boundary layer separates once p_e falls below roughly 0.4 p_a
  const separated = exit.p < 0.4 * pa;
  const regime = separated ? 'Flow separation: the jet detaches inside the bell' : exit.p < 0.95 * pa ? 'Over-expanded: the plume is pinched by the air' : exit.p > 1.05 * pa ? 'Under-expanded: the plume balloons after the exit' : 'Ideally expanded';

  const xMin = stations[0].x;
  const xMax = exit.x;
  const W = 760;
  const H = 300;
  const sc = Math.min((W - 40) / (xMax - xMin), (H - 30) / (2 * Math.max(geo.Re, geo.Rc)));
  const X = (x: number) => 20 + (x - xMin) * sc;
  const Y = (r: number) => H / 2 - r * sc;
  const upper = stations.map((s) => `${X(s.x).toFixed(1)},${Y(s.r).toFixed(1)}`).join(' ');
  const lower = [...stations].reverse().map((s) => `${X(s.x).toFixed(1)},${Y(-s.r).toFixed(1)}`).join(' ');
  const gid = useId().replace(/:/g, '');
  const vals = stations.map((s) => (field === 'mach' ? s.M : s.T));
  const vmin = Math.min(...vals);
  const vmax = Math.max(...vals);
  const norm = (v: number) => (field === 'mach' ? (v - vmin) / (vmax - vmin || 1) : 1 - (v - vmin) / (vmax - vmin || 1));
  const throatX = X(0);

  return (
    <Widget title="Inside a de Laval nozzle">
      <div className="picker" style={{ marginBottom: 12 }}>
        <button className={field === 'temp' ? 'on' : ''} onClick={() => setField('temp')}>
          Gas temperature
        </button>
        <button className={field === 'mach' ? 'on' : ''} onClick={() => setField('mach')}>
          Mach number
        </button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Cutaway of a rocket nozzle shaded by local flow state">
        <defs>
          <linearGradient id={gid} x1={X(xMin)} x2={X(xMax)} y1="0" y2="0" gradientUnits="userSpaceOnUse">
            {stations
              .filter((_, i) => i % 4 === 0 || i === stations.length - 1)
              .map((s, i) => (
                <stop key={i} offset={(X(s.x) - X(xMin)) / (X(xMax) - X(xMin))} stopColor={ramp(norm(field === 'mach' ? s.M : s.T))} />
              ))}
          </linearGradient>
        </defs>
        <polygon points={`${upper} ${lower}`} fill={`url(#${gid})`} stroke="var(--ink)" strokeWidth={2.5} strokeLinejoin="round" />
        <line x1={throatX} x2={throatX} y1={Y(1) - 8} y2={Y(-1) + 8} stroke="var(--paper)" strokeDasharray="3 3" />
        <text x={throatX} y={Y(Math.max(geo.Re, geo.Rc)) - 4 < 12 ? 14 : Y(1) - 14} textAnchor="middle" className="chart-tick">
          throat, M = 1
        </text>
        <text x={X(xMin) + 6} y={H - 8} className="chart-tick">
          chamber {pc} bar · {tc} K
        </text>
        <text x={X(xMax) - 6} y={H - 8} textAnchor="end" className="chart-tick">
          exit M {exit.M.toFixed(2)} · {exit.T.toFixed(0)} K
        </text>
      </svg>
      <div className="w-controls" style={{ marginTop: 12 }}>
        <Slider label="Expansion ratio ε = Aₑ/Aₜ" value={eps} min={2} max={120} step={1} onChange={setEps} />
        <Slider label="Chamber pressure" value={pc} min={10} max={300} step={5} unit="bar" onChange={setPc} />
        <Slider label="Chamber temperature" value={tc} min={1500} max={3800} step={50} unit="K" onChange={setTc} />
        <Slider label="Ratio of specific heats γ" value={g} min={1.1} max={1.4} step={0.01} onChange={setG} />
        <Slider label="Altitude" value={alt} min={0} max={80} step={1} unit="km" onChange={setAlt} />
      </div>
      <dl className="w-outs">
        <div className="w-out">
          <dt>Exit pressure</dt>
          <dd className="num">{(exit.p * 100).toFixed(1)} kPa</dd>
        </div>
        <div className="w-out">
          <dt>Ambient pressure</dt>
          <dd className="num">{(pa * 100).toFixed(1)} kPa</dd>
        </div>
        <div className="w-out">
          <dt>Exhaust velocity</dt>
          <dd className="num">{ve.toFixed(0)} m/s</dd>
        </div>
        <div className={'w-out' + (separated ? ' warn' : '')}>
          <dt>Plume</dt>
          <dd className="num">{regime}</dd>
        </div>
      </dl>
      <Chart
        series={[
          { label: 'Mach', x: stations.map((s) => s.x), y: stations.map((s) => s.M) },
          { label: 'p / p꜀ ×10', x: stations.map((s) => s.x), y: stations.map((s) => (s.p / pc) * 10), color: 1 },
          { label: 'T / T꜀ ×5', x: stations.map((s) => s.x), y: stations.map((s) => (s.T / tc) * 5), color: 2 },
        ]}
        xLabel="Axial position (throat radii, throat at 0)"
        yLabel="Flow state"
        markers={[{ x: 0, label: 'Throat' }]}
        height={240}
      />
      <p className="w-note">
        Quasi-1D isentropic flow in a frozen-composition gas of molar mass {mw} kg/kmol. Real nozzles lose a few per cent to
        divergence, boundary-layer friction and chemical non-equilibrium. The separation warning uses the Summerfield criterion
        (separation once pₑ falls below about 0.4 pₐ).
      </p>
    </Widget>
  );
}
