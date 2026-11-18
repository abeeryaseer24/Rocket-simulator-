import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { decodeVehicle } from './lib/share';
import Hangar from './pages/Hangar';
import { useSim } from './sim/store';

const Flight = lazy(() => import('./pages/Flight'));
const VehicleBay = lazy(() => import('./pages/VehicleBay'));
const Telemetry = lazy(() => import('./pages/Telemetry'));
const Academy = lazy(() => import('./pages/Academy'));
const Analysis = lazy(() => import('./pages/Analysis'));
const Missions = lazy(() => import('./pages/Missions'));
const Avionics = lazy(() => import('./pages/Avionics'));
const About = lazy(() => import('./pages/About'));
const Worlds = lazy(() => import('./pages/Worlds'));
const History = lazy(() => import('./pages/History'));

/* Line icons drawn for this app: each is the object the page is about. */
const icons = {
  hangar: (
    <svg viewBox="0 0 28 28" aria-hidden>
      <path d="M3 25V11l11-7 11 7v14" />
      <path d="M14 9c1.6 1.6 2.2 3.8 2.2 6.5V22h-4.4v-6.5C11.8 12.8 12.4 10.6 14 9z" />
    </svg>
  ),
  flight: (
    <svg viewBox="0 0 28 28" aria-hidden>
      <path d="M4 24c6-1 12-6 16-16" />
      <path d="M20 8l2.5-4.5M20 8l-4.6-1.8" />
      <circle cx="20" cy="8" r="1.6" />
    </svg>
  ),
  vehicle: (
    <svg viewBox="0 0 28 28" aria-hidden>
      <path d="M14 2.5c2.4 2.4 3.4 5.6 3.4 9.5v10h-6.8V12c0-3.9 1-7.1 3.4-9.5z" />
      <path d="M10.6 13h6.8M10.6 18h6.8M10.6 22l-2.6 3.5M17.4 22l2.6 3.5" />
    </svg>
  ),
  telemetry: (
    <svg viewBox="0 0 28 28" aria-hidden>
      <path d="M3 24h22M3 24V4" />
      <path d="M5 21c4-1 6-4 8-8s5-7 11-8" />
    </svg>
  ),
  missions: (
    <svg viewBox="0 0 28 28" aria-hidden>
      <circle cx="14" cy="14" r="10" />
      <circle cx="14" cy="14" r="5.5" />
      <circle cx="14" cy="14" r="1.4" />
    </svg>
  ),
  analysis: (
    <svg viewBox="0 0 28 28" aria-hidden>
      <path d="M3 24h22M3 24V4" />
      <circle cx="9" cy="17" r="1.6" />
      <circle cx="13" cy="12" r="1.6" />
      <circle cx="17" cy="14" r="1.6" />
      <circle cx="15" cy="9" r="1.6" />
      <circle cx="21" cy="7" r="1.6" />
    </svg>
  ),
  avionics: (
    <svg viewBox="0 0 28 28" aria-hidden>
      <rect x="8" y="8" width="12" height="12" rx="1" />
      <path d="M11 8V4M14 8V4M17 8V4M11 24v-4M14 24v-4M17 24v-4M8 11H4M8 14H4M8 17H4M24 11h-4M24 14h-4M24 17h-4" />
    </svg>
  ),
  academy: (
    <svg viewBox="0 0 28 28" aria-hidden>
      <path d="M4 6.5c3.5-1.2 7-1 10 1v16c-3-2-6.5-2.2-10-1z" />
      <path d="M24 6.5c-3.5-1.2-7-1-10 1v16c3-2 6.5-2.2 10-1z" />
    </svg>
  ),
  about: (
    <svg viewBox="0 0 28 28" aria-hidden>
      <circle cx="14" cy="14" r="10.5" />
      <path d="M14 12.5V20" />
      <circle cx="14" cy="8.6" r="0.6" />
    </svg>
  ),
};

function Rail() {
  const { pathname } = useLocation();
  const playActive = /^\/(missions|worlds|history)(\/|$)/.test(pathname);
  const items: Array<[string, string, keyof typeof icons]> = [
    ['/', 'Hangar', 'hangar'],
    ['/flight', 'Flight', 'flight'],
    ['/vehicle', 'Vehicle', 'vehicle'],
    ['/telemetry', 'Telemetry', 'telemetry'],
    ['/missions', 'Play', 'missions'],
    ['/analysis', 'Analysis', 'analysis'],
    ['/avionics', 'Avionics', 'avionics'],
    ['/academy', 'Academy', 'academy'],
    ['/about', 'About', 'about'],
  ];
  return (
    <aside className="rail">
      <NavLink to="/" className="rail-mark" aria-label="Ascent home">
        ASCENT
      </NavLink>
      <nav aria-label="Main">
        {items.map(([to, label, icon]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => 'nav' + ((to === '/missions' ? playActive : isActive) ? ' active' : '')}>
            {icons[icon]}
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="rail-foot">v0.1</div>
    </aside>
  );
}

/** Opens a design shared as /#v=<code>, then clears the fragment. */
function SharedDesignLoader() {
  const { setVehicle } = useSim();
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const h = window.location.hash;
    if (!h.startsWith('#v=')) return;
    decodeVehicle(h.slice(3))
      .then((v) => {
        setVehicle(v);
        setMsg(`Loaded a shared design: ${v.name}`);
      })
      .catch(() => setMsg('That share link is damaged or incomplete, so your own design was kept.'))
      .finally(() => window.history.replaceState(null, '', window.location.pathname));
  }, [setVehicle]);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(id);
  }, [msg]);
  return msg ? (
    <div className="shared-banner" role="status">
      {msg}
    </div>
  ) : null;
}

export default function App() {
  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <SharedDesignLoader />
      <Rail />
      <main className="main" id="main" tabIndex={-1}>
        <Suspense fallback={<div className="page">Loading…</div>}>
          <Routes>
            <Route path="/" element={<Hangar />} />
            <Route path="/flight" element={<Flight />} />
            <Route path="/vehicle" element={<Navigate to="/vehicle/stages" replace />} />
            <Route path="/vehicle/:section" element={<VehicleBay />} />
            <Route path="/telemetry" element={<Navigate to="/telemetry/altitude" replace />} />
            <Route path="/telemetry/:channel" element={<Telemetry />} />
            <Route path="/missions" element={<Missions />} />
            <Route path="/missions/:mission" element={<Missions />} />
            <Route path="/worlds" element={<Navigate to="/worlds/moon" replace />} />
            <Route path="/worlds/:world" element={<Worlds />} />
            <Route path="/history" element={<History />} />
            <Route path="/history/:mission" element={<History />} />
            <Route path="/analysis" element={<Navigate to="/analysis/dispersion" replace />} />
            <Route path="/analysis/:tool" element={<Analysis />} />
            <Route path="/avionics" element={<Navigate to="/avionics/architecture" replace />} />
            <Route path="/avionics/:sub" element={<Avionics />} />
            <Route path="/academy" element={<Academy />} />
            <Route path="/academy/:lesson" element={<Academy />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
