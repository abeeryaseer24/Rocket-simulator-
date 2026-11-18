import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { decodeVehicle } from './lib/share';
import Hangar from './pages/Hangar';
import { useSim } from './sim/store';

const Flight = lazy(() => import('./pages/Flight'));
const VehicleBay = lazy(() => import('./pages/VehicleBay'));
const Telemetry = lazy(() => import('./pages/Telemetry'));
const Academy = lazy(() => import('./pages/Academy'));

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
  academy: (
    <svg viewBox="0 0 28 28" aria-hidden>
      <path d="M4 6.5c3.5-1.2 7-1 10 1v16c-3-2-6.5-2.2-10-1z" />
      <path d="M24 6.5c-3.5-1.2-7-1-10 1v16c3-2 6.5-2.2 10-1z" />
    </svg>
  ),
};

function Rail() {
  const items: Array<[string, string, keyof typeof icons]> = [
    ['/', 'Hangar', 'hangar'],
    ['/flight', 'Flight', 'flight'],
    ['/vehicle', 'Vehicle', 'vehicle'],
    ['/telemetry', 'Telemetry', 'telemetry'],
    ['/academy', 'Academy', 'academy'],
  ];
  return (
    <aside className="rail">
      <NavLink to="/" className="rail-mark" aria-label="Ascent home">
        ASCENT
      </NavLink>
      <nav aria-label="Main">
        {items.map(([to, label, icon]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => 'nav' + (isActive ? ' active' : '')}>
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
      <SharedDesignLoader />
      <Rail />
      <main className="main">
        <Suspense fallback={<div className="page">Loading…</div>}>
          <Routes>
            <Route path="/" element={<Hangar />} />
            <Route path="/flight" element={<Flight />} />
            <Route path="/vehicle" element={<Navigate to="/vehicle/stages" replace />} />
            <Route path="/vehicle/:section" element={<VehicleBay />} />
            <Route path="/telemetry" element={<Navigate to="/telemetry/altitude" replace />} />
            <Route path="/telemetry/:channel" element={<Telemetry />} />
            <Route path="/academy" element={<Academy />} />
            <Route path="/academy/:lesson" element={<Academy />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
