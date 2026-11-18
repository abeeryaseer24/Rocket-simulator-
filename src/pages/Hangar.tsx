import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ClimbHero from '../components/ClimbHero';
import RocketElevation, { stackHeight } from '../components/RocketElevation';
import ShareButton from '../components/ShareButton';
import { G0 } from '../physics/constants';
import { PRESETS } from '../sim/presets';
import { useSim } from '../sim/store';
import { liftoffMass, liftoffThrust, type Vehicle } from '../sim/vehicle';
import './hangar.css';

const fmtT = (kg: number) => (kg >= 1e5 ? `${(kg / 1000).toFixed(0)}` : `${(kg / 1000).toFixed(1)}`);

export default function Hangar() {
  const { vehicle, loadPreset, setVehicle } = useSim();
  const nav = useNavigate();

  const edited = useMemo(() => {
    const base = PRESETS.find((p) => p.id === vehicle.id);
    return !base || JSON.stringify(base) !== JSON.stringify(vehicle);
  }, [vehicle]);

  const lineup: Array<{ key: string; v: Vehicle; label: string }> = useMemo(() => {
    const list = PRESETS.map((p) => ({ key: p.id, v: p, label: p.name }));
    if (edited) list.unshift({ key: 'mine', v: vehicle, label: 'Your design' });
    return list;
  }, [edited, vehicle]);

  const [sel, setSel] = useState<string>(edited ? 'mine' : vehicle.id);
  const chosen = lineup.find((l) => l.key === sel) ?? lineup[0];
  const tallest = Math.max(...lineup.map((l) => stackHeight(l.v)));
  const pxPerM = 340 / tallest;

  const adopt = () => {
    if (chosen.key === 'mine') return true;
    if (edited && !window.confirm('Loading this vehicle replaces your edited design. Continue?')) return false;
    loadPreset(chosen.key);
    return true;
  };

  const listRef = useRef<HTMLDivElement>(null);
  const m0 = liftoffMass(chosen.v);
  const T0 = liftoffThrust(chosen.v);

  return (
    <>
    <ClimbHero vehicle={vehicle} onDone={() => listRef.current?.scrollIntoView({ behavior: 'smooth' })} />
    <div className="hangar" ref={listRef}>
      <header className="hangar-head">
        <h2 className="hangar-h">Five launch vehicles, drawn to one scale</h2>
        <p className="lede">
          Pick one to fly as it is, or open it in the Vehicle Bay and change anything from engine count to the pitch
          program. The physics doesn't change between vehicles. Only the numbers do.
        </p>
      </header>

      <div className="lineup" role="radiogroup" aria-label="Vehicles">
        {lineup.map((l) => (
          <button
            key={l.key}
            role="radio"
            aria-checked={sel === l.key}
            className={'lineup-item' + (sel === l.key ? ' on' : '')}
            onClick={() => setSel(l.key)}
          >
            <RocketElevation vehicle={l.v} scale={pxPerM} highlight={sel === l.key ? { kind: 'all' } : null} />
            <span className="lineup-name">{l.label}</span>
            <span className="lineup-h num">{stackHeight(l.v).toFixed(0)} m</span>
          </button>
        ))}
      </div>

      <section className="hangar-detail">
        <div className="hangar-detail-text">
          <h2>{chosen.label === 'Your design' ? vehicle.name : chosen.v.name}</h2>
          <p>{chosen.v.summary}</p>
          <div className="hangar-actions">
            <button
              className="btn"
              onClick={() => {
                if (adopt()) nav('/flight');
              }}
            >
              Fly this vehicle
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                if (adopt()) nav('/vehicle/stages');
              }}
            >
              Open in Vehicle Bay
            </button>
            {chosen.key === 'mine' && <ShareButton />}
            {chosen.key === 'mine' && (
              <button
                className="btn ghost"
                onClick={() => {
                  const base = PRESETS.find((p) => p.id === vehicle.id) ?? PRESETS[0];
                  if (window.confirm(`Reset your design back to "${base.name}"?`)) {
                    setVehicle(JSON.parse(JSON.stringify(base)));
                    setSel(base.id);
                  }
                }}
              >
                Reset to reference
              </button>
            )}
          </div>
        </div>
        <dl className="readout hangar-numbers">
          <div>
            <dt>Liftoff mass</dt>
            <dd className="num">
              {fmtT(m0)}
              <small>t</small>
            </dd>
          </div>
          <div>
            <dt>Liftoff thrust</dt>
            <dd className="num">
              {(T0 / 1e6).toFixed(1)}
              <small>MN</small>
            </dd>
          </div>
          <div>
            <dt>Thrust-to-weight at liftoff</dt>
            <dd className="num">{(T0 / (m0 * G0)).toFixed(2)}</dd>
          </div>
          <div>
            <dt>Payload</dt>
            <dd className="num">
              {fmtT(chosen.v.payloadMass)}
              <small>t to {(chosen.v.guidance.targetAltitude / 1000).toFixed(0)} km</small>
            </dd>
          </div>
          <div>
            <dt>Launch site</dt>
            <dd className="site">{chosen.v.site.name}</dd>
          </div>
        </dl>
      </section>

      <p className="hangar-foot">
        New to this? Start with <Link to="/academy/rocket-equation">the rocket equation</Link>. It explains most of what
        you see above in one line of maths.
      </p>
    </div>
    </>
  );
}
