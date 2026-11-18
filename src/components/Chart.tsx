import { useEffect, useMemo, useRef, useState } from 'react';
import './chart.css';

/** Validated categorical order (light surface): blue, Kapton, green. Never cycled. */
export const SERIES_COLORS = ['#1F5FA8', '#B9821A', '#2E8A5C'] as const;

export interface Series {
  label: string;
  x: number[];
  y: number[];
  /** Index into SERIES_COLORS; defaults to series order */
  color?: number;
  dashed?: boolean;
}

export interface Marker {
  x: number;
  label: string;
}

interface Props {
  series: Series[];
  xLabel: string;
  yLabel: string;
  height?: number;
  markers?: Marker[];
  /** Format for tooltip and tick values */
  fx?: (v: number) => string;
  fy?: (v: number) => string;
  yMin?: number;
  yMax?: number;
  logY?: boolean;
  /** Optional vertical cursor driven from outside (e.g. a slider) */
  cursorX?: number;
  ariaLabel?: string;
}

/** "Nice" tick step: 1, 2 or 5 × 10ⁿ. */
function ticks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(+v.toPrecision(12));
  return out;
}

const defaultFmt = (v: number) => {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e5 || a < 1e-3) return v.toExponential(1);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
};

export default function Chart({ series, xLabel, yLabel, height = 340, markers = [], fx = defaultFmt, fy = defaultFmt, yMin, yMax, logY, cursorX, ariaLabel }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hoverX, setHoverX] = useState<number | null>(null);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const m = { l: 64, r: series.length > 1 ? 96 : 20, t: markers.length ? 30 : 12, b: 44 };
  const W = width;
  const H = height;
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  const tf = (v: number) => (logY ? Math.log10(Math.max(v, 1e-30)) : v);

  const dom = useMemo(() => {
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const s of series)
      for (let i = 0; i < s.x.length; i++) {
        const yv = tf(s.y[i]);
        if (!Number.isFinite(yv) || !Number.isFinite(s.x[i])) continue;
        x0 = Math.min(x0, s.x[i]);
        x1 = Math.max(x1, s.x[i]);
        y0 = Math.min(y0, yv);
        y1 = Math.max(y1, yv);
      }
    if (yMin !== undefined) y0 = tf(yMin);
    if (yMax !== undefined) y1 = tf(yMax);
    if (!Number.isFinite(x0)) return { x0: 0, x1: 1, y0: 0, y1: 1 };
    if (y1 === y0) {
      y1 += 1;
      y0 -= 1;
    }
    const pad = (y1 - y0) * 0.06;
    return { x0, x1, y0: yMin !== undefined || logY ? y0 : y0 - (y0 > 0 && y0 - pad < 0 ? 0 : pad), y1: y1 + pad };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, yMin, yMax, logY]);

  const sx = (x: number) => m.l + ((x - dom.x0) / (dom.x1 - dom.x0 || 1)) * iw;
  const sy = (y: number) => m.t + ih - ((tf(y) - dom.y0) / (dom.y1 - dom.y0 || 1)) * ih;
  const xt = ticks(dom.x0, dom.x1, Math.max(3, Math.floor(iw / 110)));
  const yt = logY
    ? Array.from({ length: Math.floor(dom.y1) - Math.ceil(dom.y0) + 1 }, (_, i) => Math.pow(10, Math.ceil(dom.y0) + i))
    : ticks(dom.y0, dom.y1, 5);

  const paths = series.map((s) => {
    let d = '';
    let pen = false;
    // Decimate to ~2 points per pixel for long telemetry series
    const step = Math.max(1, Math.floor(s.x.length / (iw * 2)));
    for (let i = 0; i < s.x.length; i += step) {
      const yv = s.y[i];
      if (!Number.isFinite(yv) || (logY && yv <= 0)) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${sx(s.x[i]).toFixed(1)} ${sy(yv).toFixed(1)}`;
      pen = true;
    }
    return d;
  });

  const valueAt = (s: Series, x: number) => {
    let lo = 0,
      hi = s.x.length - 1;
    if (hi < 0) return NaN;
    if (x <= s.x[0]) return s.y[0];
    if (x >= s.x[hi]) return s.y[hi];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s.x[mid] <= x) lo = mid;
      else hi = mid;
    }
    const f = (x - s.x[lo]) / (s.x[hi] - s.x[lo] || 1);
    return s.y[lo] + (s.y[hi] - s.y[lo]) * f;
  };

  const cur = hoverX ?? cursorX ?? null;
  // Marker labels: skip any that would collide with the previous one
  let lastLabelX = -Infinity;
  const shownMarkers = markers
    .filter((mk) => mk.x >= dom.x0 && mk.x <= dom.x1)
    .map((mk) => {
      const px = sx(mk.x);
      const show = px - lastLabelX > 74;
      if (show) lastLabelX = px;
      return { ...mk, px, show };
    });

  return (
    <div className="chart" ref={wrap}>
      <svg
        width={W}
        height={H}
        role="img"
        aria-label={ariaLabel ?? `${yLabel} against ${xLabel}`}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = e.clientX - r.left;
          if (px < m.l || px > m.l + iw) return setHoverX(null);
          setHoverX(dom.x0 + ((px - m.l) / iw) * (dom.x1 - dom.x0));
        }}
        onPointerLeave={() => setHoverX(null)}
      >
        {/* grid + axes: recessive */}
        {yt.map((v) => (
          <g key={'y' + v}>
            <line x1={m.l} x2={m.l + iw} y1={sy(v)} y2={sy(v)} className="chart-grid" />
            <text x={m.l - 8} y={sy(v)} className="chart-tick" textAnchor="end" dominantBaseline="middle">
              {fy(v)}
            </text>
          </g>
        ))}
        {xt.map((v) => (
          <text key={'x' + v} x={sx(v)} y={m.t + ih + 18} className="chart-tick" textAnchor="middle">
            {fx(v)}
          </text>
        ))}
        <line x1={m.l} x2={m.l + iw} y1={m.t + ih} y2={m.t + ih} className="chart-axis" />
        <text x={m.l + iw / 2} y={H - 6} className="chart-axis-label" textAnchor="middle">
          {xLabel}
        </text>
        <text x={14} y={m.t + ih / 2} className="chart-axis-label" textAnchor="middle" transform={`rotate(-90 14 ${m.t + ih / 2})`}>
          {yLabel}
        </text>

        {shownMarkers.map((mk) => (
          <g key={mk.label + mk.x}>
            <line x1={mk.px} x2={mk.px} y1={m.t - 4} y2={m.t + ih} className="chart-marker" />
            {mk.show && (
              <text x={mk.px + 3} y={m.t - 10} className="chart-marker-label">
                {mk.label}
              </text>
            )}
          </g>
        ))}

        {paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={SERIES_COLORS[series[i].color ?? i] ?? SERIES_COLORS[0]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={series[i].dashed ? '6 5' : undefined}
          />
        ))}

        {/* direct labels at line ends when there are several series */}
        {series.length > 1 &&
          series.map((s, i) => {
            const n = s.x.length - 1;
            if (n < 0) return null;
            return (
              <text key={'dl' + i} x={m.l + iw + 8} y={sy(s.y[n])} className="chart-direct" dominantBaseline="middle">
                {s.label}
              </text>
            );
          })}

        {cur !== null && (
          <g pointerEvents="none">
            <line x1={sx(cur)} x2={sx(cur)} y1={m.t} y2={m.t + ih} className="chart-cross" />
            {series.map((s, i) => {
              const v = valueAt(s, cur);
              return Number.isFinite(v) && (!logY || v > 0) ? (
                <circle key={i} cx={sx(cur)} cy={sy(v)} r={4.5} fill={SERIES_COLORS[s.color ?? i]} stroke="var(--paper)" strokeWidth={2} />
              ) : null;
            })}
          </g>
        )}
      </svg>
      {hoverX !== null && (
        <div className="chart-tip" style={{ left: Math.min(sx(hoverX) + 12, W - 190) }}>
          <div className="chart-tip-x">
            {xLabel}: <span className="num">{fx(hoverX)}</span>
          </div>
          {series.map((s, i) => (
            <div key={i} className="chart-tip-row">
              <span className="sw" style={{ background: SERIES_COLORS[s.color ?? i] }} />
              {s.label}
              <span className="num">{fy(valueAt(s, hoverX))}</span>
            </div>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="chart-legend">
          {series.map((s, i) => (
            <span key={i}>
              <span className="sw" style={{ background: SERIES_COLORS[s.color ?? i] }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
