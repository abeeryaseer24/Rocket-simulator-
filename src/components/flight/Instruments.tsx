import type { FlightEvent } from '../../sim/simulate';

/**
 * Flight instruments. Arc gauges for the two numbers that define the ascent
 * (speed against orbital speed, altitude against target), bar meters for
 * loads, and a scrolling altitude tape with atmosphere landmarks.
 */

export function ArcGauge({ value, max, label, unit, display, ticks = 5, redline }: { value: number; max: number; label: string; unit: string; display: string; ticks?: number; redline?: number }) {
  const R = 54;
  const START = -220;
  const SWEEP = 260;
  const frac = Math.max(0, Math.min(1, value / max));
  const pt = (f: number, r = R) => {
    const a = ((START + SWEEP * f) * Math.PI) / 180;
    return [70 + r * Math.cos(a), 70 + r * Math.sin(a)];
  };
  const arc = (f0: number, f1: number, r = R) => {
    const [x0, y0] = pt(f0, r);
    const [x1, y1] = pt(f1, r);
    const large = (f1 - f0) * SWEEP > 180 ? 1 : 0;
    return `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  };
  return (
    <figure className="gauge" aria-label={`${label}: ${display} ${unit}`}>
      <svg viewBox="0 0 140 128" width="140" height="128">
        <path d={arc(0, 1)} className="gauge-track" />
        {redline !== undefined && <path d={arc(Math.min(redline / max, 1), 1)} className="gauge-red" />}
        {frac > 0.002 && <path d={arc(0, frac)} className="gauge-fill" />}
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const [x0, y0] = pt(i / ticks, R + 7);
          const [x1, y1] = pt(i / ticks, R + 12);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} className="gauge-tick" />;
        })}
        {(() => {
          const [x, y] = pt(frac, R);
          return <circle cx={x} cy={y} r={4.5} className="gauge-dot" />;
        })()}
        <text x="70" y="70" className="gauge-value" textAnchor="middle">
          {display}
        </text>
        <text x="70" y="88" className="gauge-unit" textAnchor="middle">
          {unit}
        </text>
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function BarMeter({ value, max, label, display, warnAt }: { value: number; max: number; label: string; display: string; warnAt?: number }) {
  const f = Math.max(0, Math.min(1, value / max));
  const warn = warnAt !== undefined && value >= warnAt;
  return (
    <div className={'meter' + (warn ? ' warn' : '')}>
      <div className="meter-head">
        <span>{label}</span>
        <span className="num">{display}</span>
      </div>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${f * 100}%` }} />
      </div>
    </div>
  );
}

const LANDMARKS: Array<[number, string]> = [
  [0, 'Pad'],
  [11, 'Tropopause'],
  [50, 'Stratopause'],
  [100, 'Kármán line'],
  [200, ''],
  [300, ''],
  [400, ''],
];

/** Log-scaled tape that scrolls past a fixed caret; event markers appear where they happened. */
export function AltitudeTape({ altKm, events }: { altKm: number; events: FlightEvent[] }) {
  const y = (a: number) => 50 - (Math.log1p(Math.max(a, 0)) - Math.log1p(Math.max(altKm, 0))) * 15;
  const marks = [...LANDMARKS.map(([a, l]) => ({ a, l, ev: false })), ...events.filter((e) => ['max-q', 'meco', 'stage-sep', 'fairing-sep', 'seco', 'booster-sep', 'engine-out'].includes(e.kind)).map((e) => ({ a: e.alt / 1000, l: e.label, ev: true }))];
  // Place marks top-down; a label that would sit within 4.5 % of the previous one keeps its tick but drops its text.
  // Flown events win over static landmarks when they collide.
  const placed = marks
    .map((m) => ({ ...m, yy: y(m.a) }))
    .filter((m) => m.yy >= -5 && m.yy <= 105)
    .sort((a, b) => a.yy - b.yy || Number(b.ev) - Number(a.ev));
  let lastLabelY = -Infinity;
  const shown = placed.map((m) => {
    const room = m.yy - lastLabelY >= 4.5 && Math.abs(m.yy - 50) > 3.5;
    if (room && m.l) lastLabelY = m.yy;
    return { ...m, label: room ? m.l : '' };
  });
  return (
    <div className="tape" aria-hidden>
      {shown.map((m, i) => (
        <div key={i} className={'tape-mark' + (m.ev ? ' ev' : '') + (m.label ? '' : ' bare')} style={{ top: `${m.yy}%` }}>
          {m.label && <span className="num">{m.a < 10 ? m.a.toFixed(1) : m.a.toFixed(0)}</span>}
          {m.label && <em>{m.label}</em>}
        </div>
      ))}
      <div className="tape-caret" style={{ top: '50%' }}>
        <span className="num">{altKm < 10 ? altKm.toFixed(2) : altKm.toFixed(1)} km</span>
      </div>
    </div>
  );
}

export function Countdown({ t }: { t: number }) {
  if (t >= 0.8) return null;
  const n = Math.ceil(-t);
  const label = t >= 0 ? 'Liftoff' : n <= 3 ? `${n}` : `${n}`;
  const sub = t >= 0 ? '' : n <= 3 ? 'Ignition sequence' : n <= 6 ? 'Flight computer in startup' : 'Terminal count';
  const frac = t >= 0 ? 1 : 1 - (-t % 1);
  return (
    <div className={'countdown' + (t >= 0 ? ' go' : '')} key={label} role="timer" aria-live="assertive">
      <svg viewBox="0 0 200 200" className="countdown-ring" aria-hidden>
        <circle cx="100" cy="100" r="90" className="cd-track" />
        <circle cx="100" cy="100" r="90" className="cd-fill" style={{ strokeDashoffset: 565.5 * (1 - frac) }} />
      </svg>
      <div className="countdown-n num">{label}</div>
      {sub && <div className="countdown-sub">{sub}</div>}
    </div>
  );
}
