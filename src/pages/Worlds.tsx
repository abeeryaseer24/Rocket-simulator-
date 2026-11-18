import { useEffect, useMemo, useState } from 'react';
import { NavLink, useParams, useSearchParams } from 'react-router-dom';
import PlayTabs from '../components/PlayTabs';
import { BODIES, bodyFacts, flyWorld, stars, WORLD_ROCKETS, type FlightPlan, type WorldResult } from '../sim/worlds';
import WorldPlayer from './worlds/WorldPlayer';
import './missions.css';
import './worlds.css';

const KEY = 'ascent.worlds.v1';
type Bests = Record<string, { stars: number; prop: number }>;
const loadBests = (): Bests => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
};
const saveBests = (b: Bests) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* storage unavailable */
  }
};

const RANGE: Record<string, [number, number]> = { moon: [15, 200], mars: [120, 600], earth: [150, 600] };

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="wl-slider">
      <span>
        {label}
        <strong className="num">
          {value} {unit}
        </strong>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

function Stars({ n, label }: { n: number; label?: string }) {
  return (
    <span className="wl-stars" aria-label={label ?? `${n} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < n ? 'on' : ''} aria-hidden>
          ★
        </span>
      ))}
    </span>
  );
}

export default function Worlds() {
  const { world = 'moon' } = useParams();
  const [qs] = useSearchParams();
  const body = BODIES.find((b) => b.id === world) ?? BODIES[0];
  const home = WORLD_ROCKETS.find((r) => r.home === body.id) ?? WORLD_ROCKETS[0];
  const [rocketId, setRocketId] = useState(qs.get('rocket') ?? home.id);
  const rocket = WORLD_ROCKETS.find((r) => r.id === rocketId) ?? home;
  const [plan, setPlan] = useState<FlightPlan>(rocket.plan);
  const [result, setResult] = useState<WorldResult | null>(null);
  const [bests, setBests] = useState<Bests>(loadBests);
  const [newBest, setNewBest] = useState(false);
  const facts = bodyFacts(body);
  const [lo, hi] = RANGE[body.id];

  // Changing world resets to that world's home rocket; changing rocket resets its plan
  useEffect(() => {
    const fromQs = qs.get('rocket');
    setRocketId(fromQs && WORLD_ROCKETS.some((r) => r.id === fromQs) ? fromQs : home.id);
    setResult(null);
  }, [body.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const p = { ...rocket.plan };
    p.target = Math.min(hi * 1000, Math.max(lo * 1000, rocket.home === body.id ? p.target : (lo + (hi - lo) * 0.25) * 1000));
    setPlan(p);
    setResult(null);
  }, [rocket, body.id, lo, hi]);

  const launch = () => {
    const r = flyWorld(body, rocket, plan);
    setResult(r);
    const key = `${body.id}:${rocket.id}`;
    const st = stars(r);
    const prev = bests[key];
    const better = st > 0 && (!prev || st > prev.stars || (st === prev.stars && r.propLeft > prev.prop));
    setNewBest(better);
    if (better) {
      const b = { ...bests, [key]: { stars: st, prop: r.propLeft } };
      setBests(b);
      saveBests(b);
    }
  };

  const bodyStars = (id: string) => Math.max(0, ...WORLD_ROCKETS.map((r) => bests[`${id}:${r.id}`]?.stars ?? 0));
  const st = result ? stars(result) : 0;
  const best = bests[`${body.id}:${rocket.id}`];
  const twr = useMemo(() => {
    const m = rocket.stages.reduce((a, s) => a + s.dry + s.prop, 0) + rocket.payload;
    const pa = body.atmosphere ? body.atmosphere(0).p : 0;
    return (rocket.stages[0].thrust - pa * rocket.stages[0].exitArea) / (m * facts.g);
  }, [rocket, body, facts.g]);

  return (
    <div className="ms">
      <nav className="ms-nav" aria-label="Worlds">
        <h1>Other worlds</h1>
        <p className="ms-progress">Launch from the Moon and Mars, and see why Earth is the hard one.</p>
        <ol>
          {BODIES.map((b) => (
            <li key={b.id}>
              <NavLink to={`/worlds/${b.id}`} className={({ isActive }) => (isActive || (b.id === 'moon' && !world) ? 'active' : '')}>
                <span className="wl-dot" style={{ background: b.surface }} aria-hidden />
                <span className="wl-navname">{b.name}</span>
                <Stars n={bodyStars(b.id)} label={`Best ${bodyStars(b.id)} of 3 stars`} />
              </NavLink>
            </li>
          ))}
        </ol>
      </nav>

      <section className="ms-body wl-body">
        <PlayTabs />
        <p className="ms-kicker">Launch site: {body.site}</p>
        <h2>{body.called.charAt(0).toUpperCase() + body.called.slice(1)}</h2>
        <dl className="ms-target wl-facts">
          <div>
            <dt>Surface gravity</dt>
            <dd className="num">{facts.g.toFixed(2)} m/s²</dd>
          </div>
          <div>
            <dt>Low-orbit speed</dt>
            <dd className="num">{(facts.vLowOrbit / 1000).toFixed(2)} km/s</dd>
          </div>
          <div>
            <dt>Escape speed</dt>
            <dd className="num">{(facts.vEscape / 1000).toFixed(2)} km/s</dd>
          </div>
          <div>
            <dt>Surface pressure</dt>
            <dd className="num">{facts.surfacePressure ? `${(facts.surfacePressure / 1000).toFixed(facts.surfacePressure < 5000 ? 2 : 0)} kPa` : 'vacuum'}</dd>
          </div>
        </dl>
        <p className="ms-note">
          <strong>Atmosphere.</strong> {body.atmoNote} A stable orbit needs a periapsis above {(body.minPeri / 1000).toFixed(0)} km, which {body.minPeriWhy}.
        </p>

        <h3 className="wl-h3">Rocket</h3>
        <div className="wl-rockets" role="radiogroup" aria-label="Rocket">
          {WORLD_ROCKETS.map((r) => (
            <button key={r.id} role="radio" aria-checked={r.id === rocket.id} className={r.id === rocket.id ? 'on' : ''} onClick={() => setRocketId(r.id)}>
              <strong>{r.name}</strong>
              <small>{r.home === body.id ? 'Built for this world' : `Built for ${BODIES.find((b) => b.id === r.home)!.called}`}</small>
            </button>
          ))}
        </div>
        <p className="wl-summary">{rocket.summary}</p>
        <table className="wl-stages">
          <thead>
            <tr>
              <th>Stage</th>
              <th className="num">Dry</th>
              <th className="num">Propellant</th>
              <th className="num">Thrust</th>
              <th className="num">Isp</th>
            </tr>
          </thead>
          <tbody>
            {rocket.stages.map((s) => (
              <tr key={s.name}>
                <td>{s.name}</td>
                <td className="num">{s.dry.toLocaleString()} kg</td>
                <td className="num">{s.prop.toLocaleString()} kg</td>
                <td className="num">{(s.thrust / 1000).toFixed(1)} kN</td>
                <td className="num">{s.isp} s</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="ms-note">
          Thrust-to-weight on this pad: <strong className="num" style={{ color: twr < 1 ? 'var(--abort)' : undefined }}>{twr.toFixed(2)}</strong>
          {twr < 1 ? ', too heavy to leave the ground here.' : '.'} {rocket.basis}
        </p>

        <h3 className="wl-h3">Flight plan</h3>
        <div className="wl-plan">
          <Slider label="Vertical rise" value={plan.verticalRise} min={0} max={30} step={1} unit="s" onChange={(v) => setPlan({ ...plan, verticalRise: v })} />
          <Slider label="Pitch-over angle" value={plan.kick} min={1} max={80} step={1} unit="°" onChange={(v) => setPlan({ ...plan, kick: v })} />
          <Slider label="Pitch-over duration" value={plan.kickDuration} min={2} max={30} step={1} unit="s" onChange={(v) => setPlan({ ...plan, kickDuration: v })} />
          <Slider label="Target orbit" value={Math.round(plan.target / 1000)} min={lo} max={hi} step={1} unit="km" onChange={(v) => setPlan({ ...plan, target: v * 1000 })} />
          <div className="wl-insert">
            <span>Reaching orbit</span>
            <div className="wp-seg light" role="radiogroup" aria-label="Insertion">
              <button role="radio" aria-checked={plan.insertion === 'direct'} className={plan.insertion === 'direct' ? 'on' : ''} onClick={() => setPlan({ ...plan, insertion: 'direct' })}>
                Burn straight in
              </button>
              <button role="radio" aria-checked={plan.insertion === 'coast'} className={plan.insertion === 'coast' ? 'on' : ''} onClick={() => setPlan({ ...plan, insertion: 'coast' })}>
                Coast, then circularise
              </button>
            </div>
          </div>
        </div>
        <div className="ms-actions">
          <button className="btn" onClick={launch} disabled={twr < 1}>
            Launch from {body.called}
          </button>
          <button className="btn ghost" onClick={() => setPlan({ ...rocket.plan, target: Math.min(hi * 1000, Math.max(lo * 1000, rocket.plan.target)) })}>
            Reset plan
          </button>
          <span className="wl-best">Best here: {best ? <Stars n={best.stars} /> : 'not flown'}</span>
        </div>

        {result && (
          <>
            <div className={'ms-result ' + (result.outcome === 'orbit' ? 'pass' : 'fail')} role="status">
              <h3>
                {result.outcome === 'orbit' ? (newBest ? 'In orbit, new best' : 'In orbit') : result.outcome === 'grounded' ? 'No liftoff' : result.outcome === 'crashed' ? 'Lost the vehicle' : 'Did not reach orbit'}{' '}
                <Stars n={st} />
              </h3>
              <p className="wl-verdict">{result.verdict}</p>
              <p className="ms-note">One star for a stable orbit, two for a mean altitude within 15 % (or 5 km) of your target, three for also keeping 5 % of the last stage's propellant in reserve.</p>
            </div>
            {result.outcome !== 'grounded' && (
              <div className="wl-player">
                <WorldPlayer result={result} />
                <ol className="wl-events">
                  {result.events.map((e, i) => (
                    <li key={i}>
                      <span className="num">T+{e.t.toFixed(0)} s</span> {e.label}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
