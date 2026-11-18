import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RAD } from '../physics/constants';
import { AltitudeTape, ArcGauge, BarMeter, Countdown } from '../components/flight/Instruments';
import { EngineAudio } from '../lib/engineAudio';
import { boosterSampleAt, fmtClock, sampleAt } from '../sim/playback';
import type { RecoverySample } from '../sim/recovery';
import { simulate, type EngineFailure, type FlightEvent, type FlightResult, type Sample } from '../sim/simulate';
import { liftoffThrust } from '../sim/vehicle';
import { useSim } from '../sim/store';
import { FlightScene, skyColor, type CameraMode } from '../three/FlightScene';
import './flight.css';

type Phase = 'ready' | 'countdown' | 'flying' | 'paused' | 'done';
const WARPS = [1, 5, 10, 25, 50];
const COUNT = 10;

const PHASE_LABEL: Record<RecoverySample['phase'], string> = {
  flip: 'Flip manoeuvre',
  boostback: 'Boostback burn',
  coast: 'Coasting',
  entry: 'Entry burn',
  descent: 'Aerodynamic descent, grid fins steering',
  landing: 'Landing burn',
  landed: 'Landed',
  lost: 'Lost',
};

const OUTCOME_TITLE: Record<FlightResult['outcome'], string> = {
  orbit: 'Orbit achieved',
  'low-orbit': 'Low orbit, decaying',
  suborbital: 'Suborbital',
  'no-liftoff': 'No liftoff',
  impact: 'Vehicle lost',
};

export default function Flight() {
  const { vehicle, fly, record, result: stored, stale } = useSim();
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
  const [boosterHud, setBoosterHud] = useState<RecoverySample | null>(null);
  const camRef = useRef<CameraMode>('chase');
  camRef.current = cam;
  const [sound, setSound] = useState(true);
  const lastCdRef = useRef<number | null>(null);
  const [failures, setFailures] = useState<EngineFailure[]>([]);
  const audioRef = useRef<EngineAudio | null>(null);
  const soundRef = useRef(false);
  soundRef.current = sound;
  const T0 = useMemo(() => liftoffThrust(vehicle), [vehicle]);
  const t0Ref = useRef(T0);
  t0Ref.current = T0;

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
    setFailures([]);
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
      // Schedule first: a throw further down must never stop the clock
      raf = requestAnimationFrame(loop);
      const dtWall = Math.min((now - prev) / 1000, 0.1);
      prev = now;
      const r = resultRef.current;
      const sc = sceneRef.current;
      const ph = phaseRef.current;
      if (ph === 'countdown') {
        tRef.current += dtWall;
        const cd = Math.ceil(-tRef.current);
        if (cd !== lastCdRef.current) {
          lastCdRef.current = cd;
          const au = audioRef.current;
          if (soundRef.current && au) {
            if (cd >= 1 && cd <= 10) {
              au.beep(cd <= 3 ? 1180 : 880, cd <= 3 ? 0.22 : 0.14);
              EngineAudio.speak(cd === 10 ? 'T minus ten' : cd === 3 ? 'Three. Ignition sequence start' : String(cd));
            }
          }
        }
        if (tRef.current >= 0) {
          if (soundRef.current && audioRef.current) {
            audioRef.current.beep(660, 0.7, 0.25);
            EngineAudio.speak('Liftoff. We have liftoff.');
          }
          setPhase('flying');
        }
      } else if (ph === 'flying' && r && r.samples.length) {
        // Cinematic liftoff: real time off the pad, then ease into the chosen warp
        const ramp = Math.min(warpRef.current, 1 + Math.max(0, tRef.current - 8) * 0.6);
        tRef.current += dtWall * ramp;
        const end = r.samples[r.samples.length - 1].t;
        if (tRef.current >= end) {
          tRef.current = end;
          setPhase('done');
        }
      }
      const t = tRef.current;
      if (sc && r && r.samples.length) {
        const s = sampleAt(r.samples, Math.max(t, 0));
        const bs = camRef.current === 'booster' && r.recovery ? boosterSampleAt(r.recovery.samples, t) : null;
        try {
          if (bs) sc.updateBooster(bs.sample, t, now / 1000);
          else sc.update(s, t, now / 1000);
        } catch (err) {
          console.error('Flight scene update failed at T+' + t.toFixed(1), err);
        }
        // event toasts
        let idx = lastEventRef.current;
        while (idx + 1 < r.events.length && r.events[idx + 1].t <= t) idx++;
        if (idx !== lastEventRef.current) {
          if (idx > lastEventRef.current && t > 0) setToast(r.events[idx]);
          lastEventRef.current = idx;
        }
        const a = audioRef.current;
        if (a && soundRef.current) {
          const running = ph === 'flying' || ph === 'countdown';
          const share = t < 0 ? (t > -2.5 ? (t + 2.5) / 2.5 * 0.5 : 0) : s.thrust / t0Ref.current;
          a.set(running ? share : 0, s.rho);
        }
        if (now - hudClock > 80) {
          hudClock = now;
          setHud({ t, s });
          setBoosterHud(bs ? bs.rec : null);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => () => audioRef.current?.dispose(), []);
  const toggleSound = () => {
    if (!audioRef.current) audioRef.current = new EngineAudio();
    if (sound) {
      audioRef.current.stop();
      window.speechSynthesis?.cancel();
    } else audioRef.current.start();
    setSound(!sound);
  };

  const failEngine = () => {
    const f = [...failures, { t: tRef.current }];
    const r2 = simulate(vehicle, { failures: f });
    setFailures(f);
    setResult(r2);
    record(r2);
    lastEventRef.current = r2.events.filter((e) => e.t < tRef.current).length - 1;
  };

  useEffect(() => {
    if (!toast || !soundRef.current) return;
    const say: Partial<Record<FlightEvent['kind'], string>> = {
      'max-q': 'Max Q',
      'booster-sep': 'Booster separation',
      meco: 'Main engine cutoff',
      'stage-sep': 'Stage separation confirmed',
      ignition: 'Second stage ignition',
      'fairing-sep': 'Fairing separation',
      karman: 'Vehicle is in space',
      seco: 'Engine cutoff. Orbit insertion confirmed',
      depletion: 'Propellant depleted',
      impact: 'Vehicle lost',
      'engine-out': 'Engine out',
    };
    const line = say[toast.kind];
    if (line) EngineAudio.speak(line);
  }, [toast]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(id);
  }, [toast]);

  // ---- controls ----
  const primary = useCallback(() => {
    if (phase === 'ready') {
      if (soundRef.current) {
        if (!audioRef.current) audioRef.current = new EngineAudio();
        audioRef.current.start();
      }
      lastCdRef.current = null;
      setPhase('countdown');
    }
    else if (phase === 'countdown' || phase === 'flying') setPhase('paused');
    else if (phase === 'paused') setPhase(tRef.current < 0 ? 'countdown' : 'flying');
    else if (phase === 'done') {
      tRef.current = -COUNT;
      lastEventRef.current = -1;
      if (failures.length) {
        const r = simulate(vehicle);
        setFailures([]);
        setResult(r);
        record(r);
      } else sceneRef.current?.setResult(resultRef.current);
      setPhase('ready');
    }
  }, [phase, failures, vehicle, record]);

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
  const viewRho = cam === 'booster' && boosterHud ? boosterHud.rho : s?.rho;
  const skyCss = viewRho !== undefined && cam !== 'orbital' ? `#${skyColor(viewRho).getHexString()}` : '#000000';
  const dark = cam === 'orbital' || (viewRho !== undefined ? skyColor(viewRho).getHSL({ h: 0, s: 0, l: 0 }).l < 0.42 : false);

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
            ...(result?.recovery ? ([['booster', 'Booster']] as const) : []),
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="radio" aria-checked={cam === k} className={cam === k ? 'on' : ''} onClick={() => setCam(k)}>
            {label}
          </button>
        ))}
      </div>

      <div className="flight-vignette" aria-hidden />

      {(phase === 'countdown' || (hud.t >= 0 && hud.t < 0.8 && phase === 'flying')) && <Countdown t={hud.t} />}

      {phase === 'ready' && result && (
        <aside className="prelaunch" aria-label="Launch readiness">
          <h2>{vehicle.name}</h2>
          <p className="num">
            {vehicle.site.name} to {(vehicle.guidance.targetAltitude / 1000).toFixed(0)} km at {vehicle.guidance.targetInclination}°
          </p>
          <ol>
            {['Propellant load complete', 'Range is green', 'Weather is go', 'Flight computer in startup', 'Flight termination system armed'].map((x, i) => (
              <li key={x} style={{ animationDelay: `${i * 180}ms` }}>
                <span>{x}</span>
                <b>Go</b>
              </li>
            ))}
          </ol>
          <p className="prelaunch-hint">Press Start countdown or the space bar. Drag the view to look around.</p>
        </aside>
      )}

      {s && phase !== 'ready' && cam !== 'booster' && (
        <section className="flight-hud" aria-label="Flight data">
          <div className="gauges">
            <ArcGauge
              label="Inertial speed"
              value={s.vInertial}
              max={8000}
              display={(s.vInertial / 1000).toFixed(2)}
              unit="km/s"
              ticks={8}
            />
            <ArcGauge
              label="Altitude"
              value={s.alt}
              max={vehicle.guidance.targetAltitude * 1.15}
              display={s.alt < 10000 ? (s.alt / 1000).toFixed(2) : (s.alt / 1000).toFixed(0)}
              unit="km"
            />
          </div>
          <div className="meters">
            <BarMeter label="Dynamic pressure" value={s.q} max={45000} display={`${(s.q / 1000).toFixed(1)} kPa`} warnAt={vehicle.guidance.qBucketStart} />
            <BarMeter label="Acceleration" value={s.axialG} max={6} display={`${Math.max(0, s.axialG).toFixed(2)} g`} warnAt={vehicle.guidance.maxAxialG * 0.98} />
            <BarMeter label="Throttle" value={s.throttle} max={1} display={`${(s.throttle * 100).toFixed(0)} %`} />
            <BarMeter label={`Propellant, ${vehicle.stages[s.stage]?.name.toLowerCase()}`} value={s.propFraction} max={1} display={`${(s.propFraction * 100).toFixed(0)} %`} />
            <BarMeter label="Mach" value={s.alt < 90000 ? s.mach : 0} max={25} display={s.alt < 90000 ? s.mach.toFixed(2) : 'n/a'} />
            {vehicle.control?.enabled && (
              <BarMeter label="Engine gimbal" value={s.gimbal} max={vehicle.control.gimbalMax} display={`${s.gimbal.toFixed(2)}°`} warnAt={vehicle.control.gimbalMax * 0.95} />
            )}
          </div>
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

      {s && phase !== 'ready' && cam !== 'orbital' && cam !== 'booster' && <AltitudeTape altKm={s.alt / 1000} events={passed} />}

      {cam === 'booster' && result?.recovery && (
        <aside className="booster-hud" aria-label="Booster recovery">
          <h3>First stage, {result.recovery.mode === 'rtls' ? 'returning to the launch site' : 'heading for the droneship'}</h3>
          {boosterHud ? (
            <dl>
              <div>
                <dt>Phase</dt>
                <dd>{PHASE_LABEL[boosterHud.phase]}</dd>
              </div>
              <div>
                <dt>Altitude</dt>
                <dd className="num">{(boosterHud.alt / 1000).toFixed(boosterHud.alt < 10000 ? 2 : 1)} km</dd>
              </div>
              <div>
                <dt>Speed</dt>
                <dd className="num">{boosterHud.speed.toFixed(0)} m/s</dd>
              </div>
              <div>
                <dt>Vertical speed</dt>
                <dd className="num">{boosterHud.vVertical.toFixed(0)} m/s</dd>
              </div>
              <div>
                <dt>Propellant left</dt>
                <dd className="num">{(boosterHud.prop / 1000).toFixed(1)} t</dd>
              </div>
              <div>
                <dt>To {result.recovery.mode === 'rtls' ? 'pad' : 'ship'}</dt>
                <dd className="num">{boosterHud.distToTarget < 2000 ? `${boosterHud.distToTarget.toFixed(0)} m` : `${(boosterHud.distToTarget / 1000).toFixed(1)} km`}</dd>
              </div>
            </dl>
          ) : (
            <p>Still attached. This camera picks it up at stage separation.</p>
          )}
          {boosterHud && (boosterHud.phase === 'landed' || boosterHud.phase === 'lost') && <p className={'booster-result ' + boosterHud.phase}>{result.recovery.verdict}</p>}
        </aside>
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
          {result.recovery && <p className={'flight-verdict-booster ' + (result.recovery.success ? 'ok' : 'no')}>{result.recovery.verdict}</p>}
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
        <button className="btn small ghost flight-sound" onClick={toggleSound} aria-pressed={sound}>
          {sound ? 'Sound on' : 'Sound off'}
        </button>
        {s && s.burning && (phase === 'flying' || phase === 'paused') && hud.t < (result?.cutoffState?.t ?? Infinity) && (
          <button className="btn small flight-fail" onClick={failEngine} title="Shut down one engine on the active stage and re-fly from here">
            Fail an engine
          </button>
        )}
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
