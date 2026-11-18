import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RAD } from '../physics/constants';
import { fmtClock, sampleAt } from '../sim/playback';
import type { FlightEvent, FlightResult, Sample } from '../sim/simulate';
import { useSim } from '../sim/store';
import { FlightScene, skyColor, type CameraMode } from '../three/FlightScene';
import './flight.css';

type Phase = 'ready' | 'countdown' | 'flying' | 'paused' | 'done';
const WARPS = [1, 5, 10, 25, 50];
const COUNT = 10;

const OUTCOME_TITLE: Record<FlightResult['outcome'], string> = {
  orbit: 'Orbit achieved',
  'low-orbit': 'Low orbit, decaying',
  suborbital: 'Suborbital',
  'no-liftoff': 'No liftoff',
  impact: 'Vehicle lost',
};

export default function Flight() {
  const { vehicle, fly, result: stored, stale } = useSim();
  const [params] = useSearchParams();
  const atParam = params.get('at');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<FlightScene | null>(null);
  const [result, setResult] = useState<FlightResult | null>(stale ? null : stored);
  const [phase, setPhase] = useState<Phase>('ready');
  const [warp, setWarp] = useState(10);
  const [cam, setCam] = useState<CameraMode>('chase');
  const [hud, setHud] = useState<{ t: number; s: Sample | null }>({ t: -COUNT, s: null });
  const [more, setMore] = useState(false);
  const [toast, setToast] = useState<FlightEvent | null>(null);

  const tRef = useRef(-COUNT);
  const phaseRef = useRef<Phase>('ready');
  const warpRef = useRef(warp);
  const resultRef = useRef<FlightResult | null>(result);
  const lastEventRef = useRef(-1);
  warpRef.current = warp;
  phaseRef.current = phase;
  resultRef.current = result;

  const endT = result && result.samples.length ? result.samples[result.samples.length - 1].t : 0;

  // Compute the flight up front: it takes ~100 ms and gives the scene a pad state to draw.
  useEffect(() => {
    const r = stale || !stored ? fly() : stored;
    setResult(r);
    lastEventRef.current = -1;
    // ?at=<seconds> opens the flight paused at that mission time (shareable moments)
    const at = atParam !== null ? Number(atParam) : NaN;
    if (Number.isFinite(at) && at >= 0) {
      tRef.current = at;
      lastEventRef.current = r.events.filter((e) => e.t <= at).length - 1;
      setPhase('paused');
    } else {
      tRef.current = -COUNT;
      setPhase('ready');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle]);

  // ---- scene lifecycle ----
  useEffect(() => {
    if (!canvasRef.current) return;
    const sc = new FlightScene(canvasRef.current, vehicle);
    sceneRef.current = sc;
    const onResize = () => sc.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      sc.dispose();
      sceneRef.current = null;
    };
  }, [vehicle]);

  useEffect(() => {
    sceneRef.current?.setResult(result);
  }, [result]);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.mode = cam;
  }, [cam]);

  // ---- animation loop ----
  useEffect(() => {
    let raf = 0;
    let prev = performance.now();
    let hudClock = 0;
    const loop = (now: number) => {
      const dtWall = Math.min((now - prev) / 1000, 0.1);
      prev = now;
      const r = resultRef.current;
      const sc = sceneRef.current;
      const ph = phaseRef.current;
      if (ph === 'countdown') {
        tRef.current += dtWall;
        if (tRef.current >= 0) setPhase('flying');
      } else if (ph === 'flying' && r && r.samples.length) {
        tRef.current += dtWall * warpRef.current;
        const end = r.samples[r.samples.length - 1].t;
        if (tRef.current >= end) {
          tRef.current = end;
          setPhase('done');
        }
      }
      const t = tRef.current;
      if (sc && r && r.samples.length) {
        const s = sampleAt(r.samples, Math.max(t, 0));
        sc.update(s, t, now / 1000);
        // event toasts
        let idx = lastEventRef.current;
        while (idx + 1 < r.events.length && r.events[idx + 1].t <= t) idx++;
        if (idx !== lastEventRef.current) {
          if (idx > lastEventRef.current && t > 0) setToast(r.events[idx]);
          lastEventRef.current = idx;
        }
        if (now - hudClock > 80) {
          hudClock = now;
          setHud({ t, s });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(id);
  }, [toast]);

  // ---- controls ----
  const primary = useCallback(() => {
    if (phase === 'ready') setPhase('countdown');
    else if (phase === 'countdown' || phase === 'flying') setPhase('paused');
    else if (phase === 'paused') setPhase(tRef.current < 0 ? 'countdown' : 'flying');
    else if (phase === 'done') {
      tRef.current = -COUNT;
      lastEventRef.current = -1;
      sceneRef.current?.setResult(resultRef.current);
      setPhase('ready');
    }
  }, [phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault();
        primary();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [primary]);

  const seek = (t: number) => {
    tRef.current = t;
    lastEventRef.current = (resultRef.current?.events ?? []).filter((e) => e.t <= t).length - 1;
    if (phase === 'done' && t < endT) setPhase('paused');
  };

  // ---- camera drag / zoom ----
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const sc = sceneRef.current;
    if (!drag.current || !sc) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    sc.orbitCam.yaw -= dx * 0.006;
    sc.orbitCam.pitch = Math.max(-1.45, Math.min(1.45, sc.orbitCam.pitch + dy * 0.005));
  };
  const onWheel = (e: React.WheelEvent) => {
    const sc = sceneRef.current;
    if (!sc) return;
    const h = sc.stackHeightKm();
    sc.orbitCam.dist = Math.max(h * 0.8, Math.min(h * 400, sc.orbitCam.dist * Math.exp(e.deltaY * 0.0012)));
  };

  const s = hud.s;
  const passed = useMemo(() => (result?.events ?? []).filter((e) => e.t <= hud.t), [result, hud.t]);
  const showVerdict = result && (phase === 'done' || (result.cutoffState && hud.t > result.cutoffState.t + 4));
  const skyCss = s && cam !== 'orbital' ? `#${skyColor(s.rho).getHexString()}` : '#000000';
  const dark = cam === 'orbital' || (s ? skyColor(s.rho).getHSL({ h: 0, s: 0, l: 0 }).l < 0.42 : false);

  if (result && result.outcome === 'no-liftoff') {
    return (
      <div className="flight-blocked page">
        <h1>This vehicle can't leave the pad</h1>
        <p className="lede">{result.verdict}</p>
        <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
          <Link className="btn" to="/vehicle/engines">
            Add thrust in the Vehicle Bay
          </Link>
          <Link className="btn ghost" to="/academy/rocket-equation">
            Why thrust-to-weight matters
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={'flight' + (dark ? ' on-dark' : '')} style={{ background: skyCss }}>
      <canvas
        ref={canvasRef}
        className="flight-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onWheel={onWheel}
        aria-label="3D view of the launch. Drag to orbit the camera, scroll to zoom."
      />

      <header className="flight-clock">
        <div className="flight-vehicle">{vehicle.name}</div>
        <div className="flight-t num">{fmtClock(hud.t)}</div>
        <div className="flight-phase">{passed.length ? passed[passed.length - 1].label : phase === 'countdown' ? 'Terminal count' : 'On the pad'}</div>
        {toast && (
          <div className="flight-toast" key={toast.t + toast.kind} role="status">
            <strong>{toast.label}</strong>
            <span>{toast.detail}</span>
          </div>
        )}
      </header>

      <div className="flight-cams" role="radiogroup" aria-label="Camera">
        {(
          [
            ['chase', 'Chase'],
            ['tracking', 'Ground tracker'],
            ['orbital', 'Orbital'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="radio" aria-checked={cam === k} className={cam === k ? 'on' : ''} onClick={() => setCam(k)}>
            {label}
          </button>
        ))}
      </div>

      {s && (
        <section className="flight-hud" aria-label="Flight data">
          <Readout label="Altitude" value={(s.alt / 1000).toFixed(s.alt < 10000 ? 2 : 1)} unit="km" />
          <Readout label="Inertial speed" value={s.vInertial.toFixed(0)} unit="m/s" />
          <Readout label="Mach" value={s.alt < 90000 ? s.mach.toFixed(2) : '—'} unit="" />
          <Readout label="Dynamic pressure" value={(s.q / 1000).toFixed(1)} unit="kPa" />
          <Readout label="Acceleration" value={Math.abs(s.axialG) < 0.005 ? "0.00" : s.axialG.toFixed(2)} unit="g" />
          <button className="flight-more" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            {more ? 'Fewer readings' : 'More readings'}
          </button>
          {more && (
            <div className="flight-hud-more">
              <Readout small label="Downrange" value={(s.downrange / 1000).toFixed(1)} unit="km" />
              <Readout small label="Air-relative speed" value={s.vRel.toFixed(0)} unit="m/s" />
              <Readout small label="Vertical speed" value={s.vVertical.toFixed(0)} unit="m/s" />
              <Readout small label="Flight-path angle" value={s.gamma.toFixed(1)} unit="°" />
              <Readout small label="Pitch" value={s.pitch.toFixed(1)} unit="°" />
              <Readout small label="Throttle" value={(s.throttle * 100).toFixed(0)} unit="%" />
              <Readout small label="Thrust" value={(s.thrust / 1e6).toFixed(2)} unit="MN" />
              <Readout small label="Mass" value={(s.mass / 1000).toFixed(1)} unit="t" />
              <Readout small label="Apoapsis" value={s.apo > 0 ? (s.apo / 1000).toFixed(0) : '—'} unit="km" />
              <Readout small label="Periapsis" value={(s.peri / 1000).toFixed(0)} unit="km" />
              <Readout small label="Ambient pressure" value={s.pressure < 1 ? s.pressure.toExponential(1) : s.pressure.toFixed(0)} unit="Pa" />
              <Readout small label="Stagnation heating" value={(s.heatFlux / 1000).toFixed(1)} unit="kW/m²" />
            </div>
          )}
        </section>
      )}

      {s && (
        <div className="flight-prop" aria-label="Active stage propellant">
          <div className="flight-prop-bar">
            <div style={{ height: `${Math.max(0, Math.min(1, s.propFraction)) * 100}%` }} />
          </div>
          <div className="flight-prop-label">
            {vehicle.stages[s.stage]?.name}
            <span className="num">{(s.propFraction * 100).toFixed(0)} %</span>
          </div>
        </div>
      )}

      {showVerdict && result && (
        <aside className={'flight-verdict ' + result.outcome}>
          <h2>{OUTCOME_TITLE[result.outcome]}</h2>
          <p>{result.verdict}</p>
          {result.final && (
            <dl className="readout">
              <div>
                <dt>Periapsis × apoapsis</dt>
                <dd className="num">
                  {(result.final.peri / 1000).toFixed(0)} × {result.final.apo === Infinity ? '∞' : (result.final.apo / 1000).toFixed(0)}
                  <small>km</small>
                </dd>
              </div>
              <div>
                <dt>Inclination</dt>
                <dd className="num">
                  {(result.final.i * RAD).toFixed(2)}
                  <small>°</small>
                </dd>
              </div>
              <div>
                <dt>Propellant margin</dt>
                <dd className="num">
                  {(result.margin / 1000).toFixed(2)}
                  <small>t</small>
                </dd>
              </div>
            </dl>
          )}
          <div className="flight-verdict-actions">
            <Link className="btn small" to="/telemetry/altitude">
              Read the telemetry
            </Link>
            <Link className="btn small ghost" to="/vehicle/stages">
              Change the vehicle
            </Link>
          </div>
        </aside>
      )}

      <footer className="flight-bar">
        <button className="btn flight-go" onClick={primary} disabled={!result}>
          {phase === 'ready' ? 'Start countdown' : phase === 'done' ? 'Fly again' : phase === 'paused' ? 'Resume' : 'Pause'}
        </button>
        <label className="flight-warp">
          <span>Time warp</span>
          <select value={warp} onChange={(e) => setWarp(+e.target.value)}>
            {WARPS.map((w) => (
              <option key={w} value={w}>
                {w}×
              </option>
            ))}
          </select>
        </label>
        <Timeline result={result} t={hud.t} end={endT} onSeek={seek} enabled={phase !== 'ready' && phase !== 'countdown'} />
      </footer>
    </div>
  );
}

function Readout({ label, value, unit, small }: { label: string; value: string; unit: string; small?: boolean }) {
  return (
    <div className={'ro' + (small ? ' sm' : '')}>
      <span className="ro-l">{label}</span>
      <span className="ro-v num">
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

function Timeline({ result, t, end, onSeek, enabled }: { result: FlightResult | null; t: number; end: number; onSeek: (t: number) => void; enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<FlightEvent | null>(null);
  if (!result || end <= 0) return <div className="tl" />;
  const frac = Math.max(0, Math.min(1, t / end));
  const toT = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * end;
  };
  const major = new Set(['max-q', 'booster-sep', 'meco', 'stage-sep', 'fairing-sep', 'seco', 'depletion', 'impact']);
  return (
    <div
      ref={ref}
      className={'tl' + (enabled ? '' : ' locked')}
      role="slider"
      aria-label="Mission time"
      aria-valuemin={0}
      aria-valuemax={Math.round(end)}
      aria-valuenow={Math.round(Math.max(t, 0))}
      tabIndex={enabled ? 0 : -1}
      onPointerDown={(e) => {
        if (!enabled) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        onSeek(toT(e.clientX));
      }}
      onPointerMove={(e) => {
        if (enabled && e.buttons === 1) onSeek(toT(e.clientX));
      }}
      onKeyDown={(e) => {
        if (!enabled) return;
        if (e.key === 'ArrowRight') onSeek(Math.min(end, t + 10));
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, t - 10));
      }}
    >
      <div className="tl-track">
        <div className="tl-fill" style={{ width: `${frac * 100}%` }} />
      </div>
      {result.events
        .filter((e) => major.has(e.kind) && e.t <= Math.max(t, 0))
        .map((e) => (
          <button
            key={e.kind + e.t}
            className="tl-tick"
            style={{ left: `${(e.t / end) * 100}%` }}
            onPointerEnter={() => setHover(e)}
            onPointerLeave={() => setHover(null)}
            onPointerDown={(ev) => {
              ev.stopPropagation();
              if (enabled) onSeek(e.t);
            }}
            aria-label={`${e.label} at ${fmtClock(e.t)}`}
          />
        ))}
      {hover && (
        <div className="tl-tip" style={{ left: `${(hover.t / end) * 100}%` }}>
          <strong>{hover.label}</strong> <span className="num">{fmtClock(hover.t)}</span>
        </div>
      )}
      <div className="tl-thumb" style={{ left: `${frac * 100}%` }} />
    </div>
  );
}
