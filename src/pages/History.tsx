import { useMemo, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import PlayTabs from '../components/PlayTabs';
import { HISTORIC } from '../sim/historic';
import { simulate, type FlightResult } from '../sim/simulate';
import { useSim } from '../sim/store';
import { cloneVehicle, type Vehicle } from '../sim/vehicle';
import './missions.css';
import './worlds.css';

// The student's own design, kept while replicas occupy the Vehicle Bay
const SAVED_KEY = 'ascent.vehicle.beforeReplica';
const loadSaved = (): Vehicle | null => {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as Vehicle) : null;
  } catch {
    return null;
  }
};

export default function History() {
  const { mission } = useParams();
  const m = HISTORIC.find((x) => x.id === mission) ?? HISTORIC[0];
  const { vehicle, setVehicle, record } = useSim();
  const nav = useNavigate();
  const [flown, setFlown] = useState<{ id: string; r: FlightResult } | null>(null);
  const [saved, setSavedState] = useState<Vehicle | null>(loadSaved);
  const setSaved = (v: Vehicle | null) => {
    setSavedState(v);
    try {
      if (v) localStorage.setItem(SAVED_KEY, JSON.stringify(v));
      else localStorage.removeItem(SAVED_KEY);
    } catch {
      /* storage unavailable: the in-memory copy still works on this page */
    }
  };
  const [busy, setBusy] = useState(false);
  const run = flown && flown.id === m.id ? flown.r : null;

  const fly = () => {
    if (!m.build) return;
    setBusy(true);
    setTimeout(() => {
      const v = m.build!();
      const r = simulate(v);
      // Keep the student's own design so it can be restored in one click
      if (!saved && !vehicle.id.startsWith('hist-')) setSaved(cloneVehicle(vehicle));
      setVehicle(v);
      record(r);
      setFlown({ id: m.id, r });
      setBusy(false);
    }, 20);
  };

  const rows = useMemo(() => {
    if (!run || !m.realOrbit) return [];
    const f = run.final;
    return [
      ['Perigee', `${m.realOrbit.peri} km`, f ? `${(f.peri / 1000).toFixed(0)} km` : '—'],
      ['Apogee', `${m.realOrbit.apo} km`, f ? `${(f.apo / 1000).toFixed(0)} km` : '—'],
      ['Inclination', `${m.realOrbit.inc}°`, f ? `${((f.i * 180) / Math.PI).toFixed(2)}°` : '—'],
    ];
  }, [run, m]);

  return (
    <div className="ms">
      <nav className="ms-nav" aria-label="Historic flights">
        <h1>Historic flights</h1>
        <p className="ms-progress">Famous launches, rebuilt as replicas and flown by the simulator.</p>
        <ol>
          {HISTORIC.map((x) => (
            <li key={x.id}>
              <NavLink to={`/history/${x.id}`} className={({ isActive }) => 'hs-link' + (isActive || (!mission && x === HISTORIC[0]) ? ' active' : '')}>
                <span className="hs-year num">{x.date.match(/\d{4}/)?.[0]}</span>
                <span>{x.title}</span>
              </NavLink>
            </li>
          ))}
        </ol>
      </nav>

      <section className="ms-body">
        <PlayTabs />
        <p className="ms-kicker">{m.date}</p>
        <h2>{m.title}</h2>
        <dl className="hs-meta">
          <div>
            <dt>Where</dt>
            <dd>{m.where}</dd>
          </div>
          <div>
            <dt>Vehicle</dt>
            <dd>{m.vehicle}</dd>
          </div>
          <div>
            <dt>Aboard</dt>
            <dd>{m.aboard}</dd>
          </div>
        </dl>
        <div className="hs-story">
          {m.story.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
        </div>
        <table className="wl-stages hs-facts">
          <tbody>
            {m.facts.map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="wl-h3">Fly the replica</h3>
        {saved && (
          <p className="ms-note hs-restore">
            Your own design ({saved.name}) is saved while replicas are in the Vehicle Bay.{' '}
            <button
              className="btn small ghost"
              onClick={() => {
                setVehicle(saved);
                setSaved(null);
                setFlown(null);
              }}
            >
              Restore my design
            </button>
          </p>
        )}
        {m.world === 'moon' ? (
          <>
            <p className="ms-note">This launch happened on the Moon, so it flies in Other worlds with the lunar module ascent stage.</p>
            <div className="ms-actions">
              <Link className="btn" to={`/worlds/moon?rocket=${m.worldRocket}`}>
                Fly it from the Moon
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="ms-note">
              The replica is built from rounded public figures and steered by this simulator's own guidance, which aims for a circular
              orbit. Expect the same inclination and a similar route, not the exact orbit. Flying it replaces the design in your Vehicle
              Bay; your own design is kept so you can restore it.
            </p>
            <div className="ms-actions">
              <button className="btn" onClick={fly} disabled={busy}>
                {busy ? 'Flying…' : `Fly the ${m.vehicle} replica`}
              </button>
            </div>
            {run && (
              <div className={'ms-result ' + (run.outcome === 'orbit' ? 'pass' : 'fail')} role="status">
                <h3>{run.outcome === 'orbit' ? 'Replica in orbit' : 'Replica did not reach orbit'}</h3>
                <table className="wl-stages">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Real flight</th>
                      <th>Replica</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(([k, a, b]) => (
                      <tr key={k}>
                        <th scope="row">{k}</th>
                        <td className="num">{a}</td>
                        <td className="num">{b}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {run.cutoffState && <p className="ms-note num">The replica reached orbit at T+{run.cutoffState.t.toFixed(0)} s.</p>}
                {run.recovery && <p className="ms-note">Booster: {run.recovery.verdict}</p>}
                <div className="ms-actions">
                  <button className="btn small" onClick={() => nav('/flight')}>
                    Watch it in 3D
                  </button>
                  <Link className="btn small ghost" to="/telemetry/altitude">
                    Open the telemetry
                  </Link>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
