import { NavLink, useParams } from 'react-router-dom';
import Actuation from './avionics/Actuation';
import Architecture from './avionics/Architecture';
import DataBus from './avionics/DataBus';
import Link from './avionics/Link';
import Navigation from './avionics/Navigation';
import Packets from './avionics/Packets';
import Power from './avionics/Power';
import Pyro from './avionics/Pyro';
import Reliability from './avionics/Reliability';
import './analysis.css';
import './bay.css';
import './avionics.css';

const SECTIONS = [
  { id: 'architecture', label: 'Architecture', line: 'Boxes, buses and who talks to whom', el: Architecture },
  { id: 'power', label: 'Power', line: 'Battery, bus voltage, load budget', el: Power },
  { id: 'navigation', label: 'Navigation', line: 'IMU drift and GNSS Kalman aiding', el: Navigation },
  { id: 'link', label: 'RF link', line: 'Downlink budget, Doppler, coverage', el: Link },
  { id: 'packets', label: 'Telemetry packets', line: 'CCSDS framing and CRC', el: Packets },
  { id: 'databus', label: 'Data bus', line: 'MIL-STD-1553B timing and load', el: DataBus },
  { id: 'actuation', label: 'TVC actuator', line: 'Motor, cascade loops, Bode', el: Actuation },
  { id: 'pyro', label: 'Pyrotechnics', line: 'Initiators, firing circuits, FTS', el: Pyro },
  { id: 'reliability', label: 'Fault tolerance', line: 'Voting, EDAC, scrubbing', el: Reliability },
] as const;

export default function Avionics() {
  const { sub = 'architecture' } = useParams();
  const idx = Math.max(0, SECTIONS.findIndex((s) => s.id === sub));
  const S = SECTIONS[idx].el;
  return (
    <div className="av">
      <header className="av-head">
        <h1>Avionics</h1>
        <p className="lede">
          The electrical half of the rocket: the computers, sensors, radios, power and pyrotechnics that turn a tank of propellant
          into a guided vehicle. Every page runs its own circuit or signal model, fed by the flight you last flew.
        </p>
      </header>
      <div className="av-layout">
        <nav className="av-side" aria-label="Avionics sections">
          <ol>
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <NavLink to={`/avionics/${s.id}`} className={({ isActive }) => (isActive || (i === 0 && !sub) ? 'active' : '')}>
                  <span className="av-num num">{String(i + 1).padStart(2, '0')}</span>
                  <span>
                    <strong>{s.label}</strong>
                    <small>{s.line}</small>
                  </span>
                </NavLink>
              </li>
            ))}
          </ol>
        </nav>
        <div className="av-page">
          <S />
          <nav className="av-pager" aria-label="Previous and next section">
            {idx > 0 ? <NavLink to={`/avionics/${SECTIONS[idx - 1].id}`}>← {SECTIONS[idx - 1].label}</NavLink> : <span />}
            {idx < SECTIONS.length - 1 && <NavLink to={`/avionics/${SECTIONS[idx + 1].id}`}>{SECTIONS[idx + 1].label} →</NavLink>}
          </nav>
        </div>
      </div>
    </div>
  );
}
