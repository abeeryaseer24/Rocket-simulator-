import { useEffect, useMemo, useRef, useState } from 'react';
import { elements2d, type WorldResult, type WorldSample } from '../../sim/worlds';
import { fmtClock } from '../../sim/playback';

const DISCRETE: Array<keyof WorldSample> = ['phase', 'stage', 'burning'];

function sampleAt(s: WorldSample[], t: number): WorldSample {
  if (t <= s[0].t) return s[0];
  if (t >= s[s.length - 1].t) return s[s.length - 1];
  let lo = 0;
  let hi = s.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (s[m].t <= t) lo = m;
    else hi = m;
  }
  const a = s[lo];
  const b = s[hi];
  const f = (t - a.t) / (b.t - a.t || 1);
  const out = { ...a } as WorldSample;
  for (const k of Object.keys(a) as Array<keyof WorldSample>) {
    if (DISCRETE.includes(k)) continue;
    const va = a[k];
    const vb = b[k];
    if (typeof va === 'number' && typeof vb === 'number') (out as unknown as Record<string, number>)[k] = Number.isFinite(va) && Number.isFinite(vb) ? va + (vb - va) * f : va;
  }
  out.t = t;
  return out;
}

const mix = (a: string, b: string, f: number) => {
  const pa = a.match(/\w\w/g)!.map((h) => parseInt(h, 16));
  const pb = b.match(/\w\w/g)!.map((h) => parseInt(h, 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * f)).join(',')})`;
};

const PHASE_LABEL: Record<string, string> = {
  pad: 'On the pad',
  vertical: 'Vertical rise',
  kick: 'Pitching over',
  turn: 'Gravity turn',
  insert: 'Holding altitude',
  coast: 'Coasting to apoapsis',
  circularise: 'Circularising',
  orbit: 'In orbit',
  falling: 'Unpowered',
  crashed: 'Impact',
  escape: 'Escaping',
};

const km = (m: number) => (Number.isFinite(m) ? (Math.abs(m) >= 1e5 ? (m / 1000).toFixed(0) : (m / 1000).toFixed(1)) : '∞');

export default function WorldPlayer({ result }: { result: WorldResult }) {
  const { samples, body } = result;
  const tEnd = samples[samples.length - 1].t;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(tEnd > 1500 ? 50 : 10);
  const [view, setView] = useState<'follow' | 'whole'>('follow');
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(760);

  // Restart whenever a new flight arrives
  useEffect(() => {
    setT(0);
    setPlaying(true);
    setView('follow');
    setSpeed(tEnd > 1500 ? 50 : 10);
  }, [result, tEnd]);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setT((x) => {
        const n = x + dt * speed;
        if (n >= tEnd) {
          setPlaying(false);
          setView('whole');
          return tEnd;
        }
        return n;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, tEnd]);

  const s = useMemo(() => sampleAt(samples, t), [samples, t]);
  const h = Math.round(Math.min(520, Math.max(260, w * 0.56)));

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R = body.radius;
    const omega = (2 * Math.PI) / body.rotation;
    const atmoH = body.id === 'earth' ? 100e3 : body.id === 'mars' ? 60e3 : 0;

    // Camera
    const maxR = Math.max(...samples.map((p) => Math.hypot(p.x, p.y)));
    const el = elements2d(body.mu, R, s.x, s.y, s.vx, s.vy);
    const showOrbit = (s.phase === 'coast' || s.phase === 'orbit' || s.phase === 'circularise' || s.phase === 'falling') && el.apo < 20 * R;
    const orbitR = showOrbit ? R + el.apo : 0;
    let cx: number, cy: number, span: number;
    if (view === 'whole') {
      cx = 0;
      cy = 0;
      span = 2.25 * Math.max(maxR, orbitR, R * 1.02);
    } else {
      cx = s.x;
      cy = s.y;
      span = Math.min(Math.max(30e3, 5 * Math.max(s.alt, 0) + 0.6 * s.downrange + 20e3), 2.25 * Math.max(maxR, R));
    }
    const sc = Math.min(w, h) / span;
    const X = (x: number) => w / 2 + (x - cx) * sc;
    const Y = (y: number) => h / 2 - (y - cy) * sc;

    // Sky darkens with altitude where there is air
    const skyF = atmoH ? Math.min(1, Math.max(0, s.alt) / (atmoH * 0.7)) : 1;
    g.fillStyle = view === 'whole' ? '#05070B' : mix(body.sky.slice(1), '05070B', skyF);
    g.fillRect(0, 0, w, h);

    // Stars (fixed pattern, fade in with darkness)
    const starA = view === 'whole' ? 0.8 : skyF * 0.8;
    if (starA > 0.05) {
      g.fillStyle = `rgba(230,235,236,${starA})`;
      for (let i = 0; i < 90; i++) {
        const sx = ((i * 7919) % 1000) / 1000;
        const sy = ((i * 104729) % 997) / 997;
        g.fillRect(sx * w, sy * h, i % 7 === 0 ? 1.6 : 1, i % 7 === 0 ? 1.6 : 1);
      }
    }

    // Predicted orbit (drawn before the planet so the planet hides any below-surface part)
    if (showOrbit && el.apo < Infinity) {
      const hh = s.x * s.vy - s.y * s.vx;
      const r = Math.hypot(s.x, s.y);
      const ex = (s.vy * hh) / body.mu - s.x / r;
      const ey = (-s.vx * hh) / body.mu - s.y / r;
      const e = Math.hypot(ex, ey);
      const w0 = Math.atan2(ey, ex);
      const p = (hh * hh) / body.mu;
      g.strokeStyle = 'rgba(159,183,214,0.9)';
      g.lineWidth = 1.5;
      g.setLineDash([6, 5]);
      g.beginPath();
      for (let k = 0; k <= 360; k++) {
        const th = (k / 360) * 2 * Math.PI;
        const rr = p / (1 + e * Math.cos(th - w0));
        const px = rr * Math.cos(th);
        const py = rr * Math.sin(th);
        if (k === 0) g.moveTo(X(px), Y(py));
        else g.lineTo(X(px), Y(py));
      }
      g.stroke();
      g.setLineDash([]);
    }

    // Atmosphere halo
    if (atmoH) {
      const grad = g.createRadialGradient(X(0), Y(0), R * sc, X(0), Y(0), (R + atmoH) * sc);
      grad.addColorStop(0, body.sky + 'aa');
      grad.addColorStop(1, body.sky + '00');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(X(0), Y(0), (R + atmoH) * sc, 0, 2 * Math.PI);
      g.fill();
    }
    // Planet
    g.fillStyle = body.surface;
    g.beginPath();
    g.arc(X(0), Y(0), R * sc, 0, 2 * Math.PI);
    g.fill();
    // Terrain ticks that turn with the planet, so ground motion is visible up close
    g.strokeStyle = 'rgba(20,35,58,0.35)';
    g.lineWidth = 1;
    const tickEvery = view === 'whole' ? (2 * Math.PI) / 72 : Math.max(2e3, span / 12) / R;
    const a0 = Math.atan2(cy, cx);
    for (let k = -14; k <= 14; k++) {
      const ang = Math.round(a0 / tickEvery) * tickEvery + k * tickEvery + ((omega * t) % tickEvery);
      const x1 = R * Math.cos(ang);
      const y1 = R * Math.sin(ang);
      const d = view === 'whole' ? 0.015 * R : Math.min(0.015 * R, span / 60);
      g.beginPath();
      g.moveTo(X(x1), Y(y1));
      g.lineTo(X(x1 * (1 - d / R)), Y(y1 * (1 - d / R)));
      g.stroke();
    }
    // Pad
    const padA = Math.PI / 2 + omega * t;
    const px = R * Math.cos(padA);
    const py = R * Math.sin(padA);
    g.fillStyle = '#B9821A';
    g.beginPath();
    g.arc(X(px), Y(py), 3.5, 0, 2 * Math.PI);
    g.fill();

    // Flown path
    g.strokeStyle = '#F1E4C6';
    g.lineWidth = 2;
    g.beginPath();
    let first = true;
    for (const q of samples) {
      if (q.t > t) break;
      if (first) g.moveTo(X(q.x), Y(q.y));
      else g.lineTo(X(q.x), Y(q.y));
      first = false;
    }
    g.lineTo(X(s.x), Y(s.y));
    g.stroke();

    // Vehicle: a small arrow along thrust (burning) or velocity (coasting)
    const r = Math.hypot(s.x, s.y);
    const up = [s.x / r, s.y / r];
    const east = [-up[1], up[0]];
    let dx: number, dy: number;
    if (s.burning) {
      const pr = (s.pitch * Math.PI) / 180;
      dx = Math.cos(pr) * east[0] + Math.sin(pr) * up[0];
      dy = Math.cos(pr) * east[1] + Math.sin(pr) * up[1];
    } else {
      const v = Math.hypot(s.vx, s.vy) || 1;
      dx = s.vx / v;
      dy = s.vy / v;
    }
    const vx0 = X(s.x);
    const vy0 = Y(s.y);
    const ang = Math.atan2(-dy, dx);
    g.save();
    g.translate(vx0, vy0);
    g.rotate(ang);
    if (s.burning) {
      g.fillStyle = '#F3B33D';
      g.beginPath();
      g.moveTo(-6, 0);
      g.lineTo(-17 - (Math.floor(t * 20) % 3), -3);
      g.lineTo(-17 - (Math.floor(t * 20) % 3), 3);
      g.closePath();
      g.fill();
    }
    g.fillStyle = s.phase === 'crashed' ? '#B3261E' : '#F3F6F6';
    g.beginPath();
    g.moveTo(9, 0);
    g.lineTo(-6, -4.5);
    g.lineTo(-6, 4.5);
    g.closePath();
    g.fill();
    g.restore();

    // Scale bar
    const target = span / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [1, 2, 5, 10].map((m) => m * mag).reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    const bar = nice * sc;
    g.strokeStyle = 'rgba(243,246,246,0.85)';
    g.fillStyle = 'rgba(243,246,246,0.85)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(14, h - 16);
    g.lineTo(14 + bar, h - 16);
    g.moveTo(14, h - 20);
    g.lineTo(14, h - 12);
    g.moveTo(14 + bar, h - 20);
    g.lineTo(14 + bar, h - 12);
    g.stroke();
    g.font = '600 11px Archivo, system-ui, sans-serif';
    g.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, 14, h - 24);
  }, [s, t, w, h, view, samples, body]);

  const el = elements2d(body.mu, body.radius, s.x, s.y, s.vx, s.vy);
  return (
    <div className="wp">
      <div className="wp-stage" ref={wrap}>
        <canvas ref={canvas} style={{ width: '100%', height: h }} role="img" aria-label={`Ascent from ${body.called}: ${PHASE_LABEL[s.phase]} at ${km(s.alt)} km`} />
      </div>
      <div className="wp-controls">
        <button className="btn small" onClick={() => (t >= tEnd ? (setT(0), setView('follow'), setPlaying(true)) : setPlaying(!playing))}>
          {playing ? 'Pause' : t >= tEnd ? 'Replay' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={tEnd}
          step="any"
          value={t}
          onChange={(e) => {
            setPlaying(false);
            setT(+e.target.value);
          }}
          aria-label="Mission time"
          className="wp-scrub"
        />
        <span className="num wp-clock">{fmtClock(t)}</span>
        <div className="wp-seg" role="group" aria-label="Playback speed">
          {[1, 10, 50, 200].map((x) => (
            <button key={x} className={speed === x ? 'on' : ''} onClick={() => setSpeed(x)}>
              {x}×
            </button>
          ))}
        </div>
        <div className="wp-seg" role="group" aria-label="Camera">
          <button className={view === 'follow' ? 'on' : ''} onClick={() => setView('follow')}>
            Follow
          </button>
          <button className={view === 'whole' ? 'on' : ''} onClick={() => setView('whole')}>
            Whole orbit
          </button>
        </div>
      </div>
      <dl className="wp-hud">
        <div>
          <dt>Phase</dt>
          <dd>{PHASE_LABEL[s.phase] ?? s.phase}</dd>
        </div>
        <div>
          <dt>Altitude</dt>
          <dd className="num">{km(s.alt)} km</dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd className="num">{s.vInertial.toFixed(0)} m/s</dd>
        </div>
        <div>
          <dt>Apoapsis × periapsis</dt>
          <dd className="num">
            {km(el.apo)} × {el.peri < -0.5 * body.radius ? '—' : km(el.peri)} km
          </dd>
        </div>
        <div>
          <dt>Stage</dt>
          <dd className="num">
            {s.stage + 1} of {result.rocket.stages.length}
          </dd>
        </div>
        <div>
          <dt>Propellant</dt>
          <dd className="num">{s.propLeft.toFixed(0)} kg</dd>
        </div>
      </dl>
    </div>
  );
}
