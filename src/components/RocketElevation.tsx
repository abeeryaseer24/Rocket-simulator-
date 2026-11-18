import type { ReactElement } from 'react';
import { tankVolumes } from '../physics/propulsion';
import type { StageSpec, Vehicle } from '../sim/vehicle';

export type Highlight =
  | { kind: 'stage'; index: number }
  | { kind: 'engine'; index: number }
  | { kind: 'boosters' }
  | { kind: 'fairing' }
  | { kind: 'all' }
  | null;

interface Props {
  vehicle: Vehicle;
  /** Pixels per metre. Omit to fit `height`. */
  scale?: number;
  height?: number;
  highlight?: Highlight;
  /** Draw drafting dimension lines and tank split lines */
  detail?: boolean;
  /** Hide pieces already jettisoned */
  hidden?: { stagesBelow?: number; boosters?: boolean; fairing?: boolean };
  className?: string;
  title?: string;
}

const NOSE_FRACTION = 0.42;
const BELL = (d: number) => Math.min(d * 0.32, 2.2);

/** Overall stack height including fairing and engine bells [m]. */
export function stackHeight(v: Vehicle): number {
  return v.stages.reduce((a, s) => a + s.length, 0) + v.fairing.length + BELL(v.stages[0].diameter);
}

export function stackWidth(v: Vehicle): number {
  const core = Math.max(...v.stages.map((s) => s.diameter), v.fairing.diameter);
  return v.boosters.count > 0 ? core + 2 * (v.boosters.stage.diameter + 0.25) : core;
}

/**
 * Side elevation drawn to scale, in the manner of a vehicle general-arrangement
 * drawing. Tank split lines show where the oxidiser and fuel tanks meet, from
 * the actual propellant densities and mixture ratio.
 */
export default function RocketElevation({ vehicle: v, scale, height = 420, highlight = null, detail = false, hidden, className, title }: Props) {
  const H = stackHeight(v);
  const W = stackWidth(v);
  const padX = detail ? 14 : 1.5;
  const padTop = 2;
  const k = scale ?? height / (H + padTop + 1);
  const vbW = W + padX * 2 + (detail ? 10 : 0);
  const vbH = H + padTop + 1;
  const cx = padX + W / 2;
  const ground = vbH - 0.5;

  const isHi = (h: Highlight) =>
    highlight !== null && (highlight.kind === 'all' || JSON.stringify(h) === JSON.stringify(highlight));
  const fillFor = (h: Highlight) => (isHi(h) ? 'var(--kapton-wash)' : 'var(--paper)');
  const strokeFor = (h: Highlight) => (isHi(h) ? 'var(--kapton)' : 'var(--ink)');

  const parts: ReactElement[] = [];
  let y = ground - BELL(v.stages[0].diameter);

  const drawBells = (s: StageSpec, x: number, yb: number, idx: number, key: string) => {
    const n = Math.min(s.engine.count, 5);
    const bw = Math.min(s.diameter / Math.max(n, 1), Math.sqrt(s.engine.exitArea / Math.PI) * 2 || 0.5);
    const bh = Math.min(BELL(s.diameter), bw * 1.4);
    const span = s.diameter * 0.8;
    for (let i = 0; i < n; i++) {
      const bx = n === 1 ? x : x - span / 2 + (span * (i + 0.5)) / n;
      parts.push(
        <path
          key={`${key}-bell-${i}`}
          d={`M${bx - bw * 0.18} ${yb} L${bx + bw * 0.18} ${yb} L${bx + bw / 2} ${yb + bh} L${bx - bw / 2} ${yb + bh} Z`}
          fill={isHi({ kind: 'engine', index: idx }) ? 'var(--kapton)' : 'var(--graphite)'}
          stroke="none"
        />,
      );
    }
  };

  // Boosters first so the core overlaps their inner edge
  if (v.boosters.count > 0 && !hidden?.boosters) {
    const b = v.boosters.stage;
    const by = ground - BELL(v.stages[0].diameter);
    const nose = b.diameter * 1.6;
    const coreR = v.stages[0].diameter / 2;
    const side = [-1, 1].slice(0, Math.min(v.boosters.count, 2));
    side.forEach((sgn) => {
      const bx = cx + sgn * (coreR + 0.12 + b.diameter / 2);
      const top = by - b.length;
      parts.push(
        <path
          key={`booster-${sgn}`}
          d={`M${bx - b.diameter / 2} ${by} L${bx - b.diameter / 2} ${top + nose} Q${bx - b.diameter / 2} ${top} ${bx} ${top} Q${bx + b.diameter / 2} ${top} ${bx + b.diameter / 2} ${top + nose} L${bx + b.diameter / 2} ${by} Z`}
          fill={fillFor({ kind: 'boosters' })}
          stroke={strokeFor({ kind: 'boosters' })}
          strokeWidth={1.1}
          vectorEffect="non-scaling-stroke"
        />,
      );
      drawBells(b, bx, by, -1, `bb${sgn}`);
    });
    if (v.boosters.count > 2) {
      parts.push(
        <text key="bcount" x={cx} y={by - b.length - 0.8} fontSize={Math.max(W * 0.06, 1)} textAnchor="middle" fill="var(--graphite)">
          ×{v.boosters.count}
        </text>,
      );
    }
  }

  v.stages.forEach((s, i) => {
    const top = y - s.length;
    const x0 = cx - s.diameter / 2;
    const gone = hidden?.stagesBelow !== undefined && i < hidden.stagesBelow;
    if (!gone) {
      const hl: Highlight = { kind: 'stage', index: i };
      parts.push(
        <rect
          key={`stage-${i}`}
          x={x0}
          y={top}
          width={s.diameter}
          height={s.length}
          fill={fillFor(hl)}
          stroke={strokeFor(hl)}
          strokeWidth={1.1}
          vectorEffect="non-scaling-stroke"
        />,
      );
      // Interstage band at the top of every stage except the last
      if (i < v.stages.length - 1) {
        const band = Math.min(s.diameter * 0.55, s.length * 0.1);
        parts.push(<rect key={`is-${i}`} x={x0} y={top} width={s.diameter} height={band} fill="var(--ink)" />);
      }
      if (detail) {
        const tv = tankVolumes(s.propellant, s.propMass, s.mixtureRatio);
        if (tv.ox > 0) {
          const usable = s.length * 0.82;
          const oxLen = usable * (tv.ox / tv.total);
          const ySplit = top + s.length * 0.12 + oxLen;
          parts.push(
            <line
              key={`split-${i}`}
              x1={x0}
              x2={x0 + s.diameter}
              y1={ySplit}
              y2={ySplit}
              stroke="var(--graphite)"
              strokeDasharray="3 3"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />,
          );
        }
      }
      drawBells(s, cx, y, i, `s${i}`);
    }
    y = top;
  });

  if (!hidden?.fairing) {
    const f = v.fairing;
    const fd = Math.max(f.diameter, v.stages[v.stages.length - 1].diameter);
    const nose = f.length * NOSE_FRACTION;
    const top = y - f.length;
    const l = cx - fd / 2;
    const r = cx + fd / 2;
    const upper = v.stages[v.stages.length - 1].diameter;
    const hl: Highlight = { kind: 'fairing' };
    parts.push(
      <path
        key="fairing"
        d={`M${cx - upper / 2} ${y} L${l} ${y - Math.min(1.2, f.length * 0.08)} L${l} ${top + nose} C${l} ${top + nose * 0.35} ${cx - fd * 0.18} ${top} ${cx} ${top} C${cx + fd * 0.18} ${top} ${r} ${top + nose * 0.35} ${r} ${top + nose} L${r} ${y - Math.min(1.2, f.length * 0.08)} L${cx + upper / 2} ${y} Z`}
        fill={fillFor(hl)}
        stroke={strokeFor(hl)}
        strokeWidth={1.1}
        vectorEffect="non-scaling-stroke"
      />,
    );
  }

  // Drafting dimension: overall height
  if (detail) {
    const dx = padX + W + 4;
    const yTop = ground - H;
    parts.push(
      <g key="dim" stroke="var(--graphite)" strokeWidth={1} vectorEffect="non-scaling-stroke">
        <line x1={dx} x2={dx} y1={yTop} y2={ground} vectorEffect="non-scaling-stroke" />
        <line x1={dx - 1} x2={dx + 1} y1={yTop} y2={yTop} vectorEffect="non-scaling-stroke" />
        <line x1={dx - 1} x2={dx + 1} y1={ground} y2={ground} vectorEffect="non-scaling-stroke" />
      </g>,
      <text
        key="dimt"
        x={dx + 1.6}
        y={(yTop + ground) / 2}
        fontSize={Math.max(H * 0.028, 0.9)}
        fill="var(--graphite)"
        style={{ fontFeatureSettings: "'tnum'" }}
        transform={`rotate(-90 ${dx + 1.6} ${(yTop + ground) / 2})`}
        textAnchor="middle"
      >
        {H.toFixed(1)} m
      </text>,
    );
  }

  return (
    <svg
      className={className}
      viewBox={`0 0 ${vbW} ${vbH}`}
      width={vbW * k}
      height={vbH * k}
      role="img"
      aria-label={title ?? `${v.name}, ${H.toFixed(0)} metres tall`}
    >
      {parts}
    </svg>
  );
}
