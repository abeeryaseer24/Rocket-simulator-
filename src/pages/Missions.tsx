import { useMemo, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { formatScore, isBetter, loadBests, MISSIONS, runMission, saveBests, type Bests, type Check } from '../sim/missions';
import { PRESETS } from '../sim/presets';
import { useSim } from '../sim/store';
import { cloneVehicle } from '../sim/vehicle';
import './missions.css';

export default function Missions() {
  const { mission: id } = useParams();
  const m = MISSIONS.find((x) => x.id === id) ?? MISSIONS[0];
  const { vehicle, setVehicle, record } = useSim();
  const nav = useNavigate();
  const [bests, setBests] = useState<Bests>(loadBests);
  const [run, setRun] = useState<{ id: string; checks: Check[]; passed: boolean; score: number; newBest: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const done = useMemo(() => MISSIONS.filter((x) => bests[x.id]).length, [bests]);
  const current = run && run.id === m.id ? run : null;

  const go = () => {
    setBusy(true);
    setTimeout(() => {
      const r = runMission(vehicle, m);
      setVehicle(r.vehicle);
      record(r.result);
      const prev = bests[m.id]?.score;
      const newBest = r.passed && isBetter(m, r.score, prev);
      if (newBest) {
        const b = { ...bests, [m.id]: { score: r.score, at: new Date().toISOString(), vehicle: r.vehicle.name } };
        setBests(b);
        saveBests(b);
      }
      setRun({ id: m.id, checks: r.checks, passed: r.passed, score: r.score, newBest });
      setBusy(false);
    }, 20);
  };

  return (
    <div className="ms">
      <nav className="ms-nav" aria-label="Missions">
        <h1>Missions</h1>
        <p className="ms-progress num">
          {done} of {MISSIONS.length} complete
        </p>
        <ol>
          {MISSIONS.map((x) => (
            <li key={x.id}>
              <NavLink to={`/missions/${x.id}`} className={({ isActive }) => (isActive || (!id && x === MISSIONS[0]) ? 'active' : '')}>
                <span className={'ms-badge' + (bests[x.id] ? ' won' : '')} aria-label={bests[x.id] ? 'Complete' : 'Not complete'} />
                {x.title}
              </NavLink>
            </li>
          ))}
        </ol>
      </nav>

      <section className="ms-body">
        <p className="ms-kicker">
          Mission {MISSIONS.indexOf(m) + 1}
          {m.site ? `, ${m.site.name}` : ''}
        </p>
        <h2>{m.title}</h2>
        <p className="ms-brief">{m.brief}</p>

        <dl className="ms-target">
          <div>
            <dt>Target orbit</dt>
            <dd className="num">
              {(m.targetAltitude / 1000).toFixed(0)} km, {m.targetInclination}°
            </dd>
          </div>
          <div>
            <dt>Scored on</dt>
            <dd>
              {m.scoreLabel}
              {m.lowerIsBetter ? ' (lower is better)' : ''}
            </dd>
          </div>
          <div>
            <dt>Your best</dt>
            <dd className="num">{bests[m.id] ? formatScore(m, bests[m.id].score) : 'Not flown yet'}</dd>
          </div>
        </dl>

        <div className="ms-actions">
          <button className="btn" onClick={go} disabled={busy}>
            {busy ? 'Flying…' : `Fly the mission with ${vehicle.name}`}
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              const p = PRESETS.find((x) => x.id === m.suggested);
              if (p && window.confirm(`Replace your current design with the ${p.name} as a starting point?`)) setVehicle(cloneVehicle(p));
            }}
          >
            Start from a suggested vehicle
          </button>
          <Link className="btn ghost" to="/vehicle/stages">
            Edit the vehicle
          </Link>
        </div>
        <p className="ms-note">Flying a mission sets your vehicle’s launch site and target orbit to the mission’s.</p>

        {current && (
          <div className={'ms-result ' + (current.passed ? 'pass' : 'fail')} role="status">
            <h3>{current.passed ? (current.newBest ? 'Mission complete, new best' : 'Mission complete') : 'Mission not complete'}</h3>
            <ul>
              {current.checks.map((c) => (
                <li key={c.label} className={c.ok ? 'ok' : 'no'}>
                  <span className="ms-mark" aria-hidden>
                    {c.ok ? '✓' : '✕'}
                  </span>
                  <span>{c.label}</span>
                  <span className="num">{c.value}</span>
                </li>
              ))}
            </ul>
            {current.passed && (
              <p className="num">
                Score: <strong>{formatScore(m, current.score)}</strong>
              </p>
            )}
            <div className="ms-actions">
              <button className="btn small" onClick={() => nav(`/flight`)}>
                Watch the flight
              </button>
              <Link className="btn small ghost" to="/telemetry/budget">
                See where the Δv went
              </Link>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
