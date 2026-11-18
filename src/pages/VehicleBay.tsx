import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import RocketElevation, { type Highlight } from '../components/RocketElevation';
import { RAD } from '../physics/constants';
import { simulate, type FlightResult } from '../sim/simulate';
import { useSim } from '../sim/store';
import { EnginesSection, StagesSection } from './bay/StageSections';
import { AeroSection, BoostersSection, GuidanceSection, PayloadSection, SiteSection } from './bay/OtherSections';
import './bay.css';

const SECTIONS: Array<[string, string]> = [
  ['stages', 'Stages'],
  ['engines', 'Engines'],
  ['boosters', 'Side boosters'],
  ['payload', 'Payload and fairing'],
  ['aero', 'Aerodynamics'],
  ['guidance', 'Guidance'],
  ['site', 'Launch site'],
];

export default function VehicleBay() {
  const { section = 'stages' } = useParams();
  const { vehicle, update } = useSim();
  const [stageIdx, setStageIdx] = useState(0);
  const idx = Math.min(stageIdx, vehicle.stages.length - 1);

  const highlight: Highlight =
    section === 'stages'
      ? { kind: 'stage', index: idx }
      : section === 'engines'
        ? { kind: 'engine', index: idx }
        : section === 'boosters'
          ? { kind: 'boosters' }
          : section === 'payload'
            ? { kind: 'fairing' }
            : section === 'aero'
              ? { kind: 'all' }
              : null;

  return (
    <div className="bay">
      <header className="bay-head">
        <div>
          <h1>Vehicle Bay</h1>
          <input
            className="bay-name"
            value={vehicle.name}
            onChange={(e) => update((v) => void (v.name = e.target.value))}
            aria-label="Vehicle name"
          />
        </div>
      </header>
      <nav className="tabs" aria-label="Subsystems">
        {SECTIONS.map(([k, label]) => (
          <NavLink key={k} to={`/vehicle/${k}`} className={({ isActive }) => (isActive ? 'active' : '')}>
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="bay-grid">
        <figure className="bay-drawing">
          <RocketElevation vehicle={vehicle} height={480} highlight={highlight} detail />
          <figcaption>Side elevation to scale. Dashed lines mark the oxidiser and fuel tank split.</figcaption>
        </figure>
        {section === 'stages' && <StagesSection idx={idx} setIdx={setStageIdx} />}
        {section === 'engines' && <EnginesSection idx={idx} setIdx={setStageIdx} />}
        {section === 'boosters' && <BoostersSection />}
        {section === 'payload' && <PayloadSection />}
        {section === 'aero' && <AeroSection />}
        {section === 'guidance' && <GuidanceSection />}
        {section === 'site' && <SiteSection />}
      </div>
      <FlightCheck />
    </div>
  );
}

/** Re-flies the vehicle quietly after each edit so the consequence of a change is never more than a glance away. */
function FlightCheck() {
  const { vehicle } = useSim();
  const nav = useNavigate();
  const [res, setRes] = useState<FlightResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBusy(true);
    const id = setTimeout(() => {
      setRes(simulate(vehicle, { dt: 0.05, coastAfterCutoff: 1 }));
      setBusy(false);
    }, 350);
    return () => clearTimeout(id);
  }, [vehicle]);
  const f = res?.final;
  return (
    <div className={'bay-check ' + (res?.outcome ?? '')} aria-live="polite">
      <span className="bay-check-dot" />
      <div className="bay-check-text">
        {busy || !res ? (
          'Checking the flight…'
        ) : res.outcome === 'no-liftoff' ? (
          <>Can't lift off: thrust-to-weight is below 1.</>
        ) : f ? (
          <>
            <strong>{res.outcome === 'orbit' ? 'Makes orbit' : res.outcome === 'low-orbit' ? 'Low orbit' : 'Does not make orbit'}</strong>
            <span className="num">
              {(f.peri / 1000).toFixed(0)} × {f.apo === Infinity ? '∞' : (f.apo / 1000).toFixed(0)} km, {(f.i * RAD).toFixed(1)}°
            </span>
            {res.outcome !== 'suborbital' && <span className="num">margin {(res.margin / 1000).toFixed(2)} t</span>}
          </>
        ) : (
          <strong>Does not make orbit</strong>
        )}
      </div>
      <Link className="btn small ghost" to="/telemetry/budget">
        Δv budget
      </Link>
      <button className="btn small" onClick={() => nav('/flight')}>
        Fly it
      </button>
    </div>
  );
}
