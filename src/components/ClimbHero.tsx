import { useEffect, useRef, useState } from 'react';
import { atmosphere } from '../physics/atmosphere';
import { MU_EARTH, R_EQ } from '../physics/constants';
import { rgbCss, skyBrightness, skyRGB } from '../lib/sky';
import type { Vehicle } from '../sim/vehicle';
import RocketElevation, { stackHeight } from './RocketElevation';
import Starfield from './Starfield';
import './climb.css';

const TOP_KM = 420;
const SEP_KM = 70;
const FAIRING_KM = 110;

const MARKERS: Array<[number, string]> = [
  [0, 'Sea level'],
  [11, 'Tropopause'],
  [50, 'Stratopause'],
  [70, 'First stage separates'],
  [100, 'Kármán line, edge of space'],
  [200, 'Lowest practical orbit'],
  [408, 'Space station orbit'],
];

const phaseAt = (h: number) =>
  h < 0.05 ? 'On the pad' : h < 8 ? 'Climbing through the troposphere' : h < 16 ? 'Max-Q region: peak aerodynamic load' : h < SEP_KM ? 'Thin air, engines near full vacuum thrust' : h < 100 ? 'Upper stage burning' : h < 300 ? 'Space. Building horizontal speed' : 'Orbit';

/**
 * Scroll-driven climb from the pad to low orbit. Scroll position maps to
 * altitude (eased so the dense lower atmosphere gets screen time); every
 * colour and number on screen is computed from US76 at that altitude.
 */
export default function ClimbHero({ vehicle, onDone }: { vehicle: Vehicle; onDone: () => void }) {
  const wrap = useRef<HTMLElement>(null);
  const [p, setP] = useState(0);
  const [vh, setVh] = useState(800);

  useEffect(() => {
    const read = () => {
      const el = wrap.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      setP(Math.max(0, Math.min(1, -r.top / Math.max(span, 1))));
      setVh(window.innerHeight);
    };
    // React batches the state update; reading layout once per scroll event is cheap here
    const onScroll = () => read();
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const h = TOP_KM * Math.pow(p, 2.3);
  const atm = atmosphere(h * 1000);
  const top = skyRGB(atmosphere((h + 22) * 1000).rho);
  const bottom = skyRGB(atm.rho);
  const bright = skyBrightness(atm.rho);
  const onLight = bright > 0.62;
  const sep = h >= SEP_KM;
  const fairingOff = h >= FAIRING_KM;

  // Rocket scale: whole stack ≈ 44 % of the viewport
  const H = stackHeight(vehicle);
  const k = (vh * 0.44) / H;
  const bell = Math.min(vehicle.stages[0].diameter * 0.32, 2.2);
  const flameBottom = sep ? (vehicle.stages[0].length + bell) * k : 0;
  const pa = atm.p / 101325;
  const plumeW = vehicle.stages[sep ? 1 : 0].diameter * k * (0.9 + 3.2 * (1 - pa) * (1 - pa));
  const plumeH = vehicle.stages[0].diameter * k * (4 + 7 * (1 - pa));
  const lift = Math.min(1, h / 2.5);
  const vOrbit = Math.sqrt(MU_EARTH / (R_EQ + h * 1000));

  // Earth: ground falls away, then the limb curves
  const horizonY = 0.8 + 0.13 * Math.min(1, h / 8);
  const curve = Math.min(1, h / TOP_KM);

  const titleOpacity = Math.max(0, 1 - p * 9);
  const endOpacity = Math.max(0, Math.min(1, (p - 0.9) * 12));

  const stage0Only: Vehicle = {
    ...vehicle,
    stages: [vehicle.stages[0]],
    boosters: { ...vehicle.boosters, count: 0 },
    fairing: { ...vehicle.fairing, length: 0.01 },
  };
  const fallT = Math.max(0, h - SEP_KM);

  return (
    <section ref={wrap} className={'climb' + (onLight ? ' light' : '')} aria-label="Scroll to climb from the launch pad to orbit">
      <div className="climb-stage" style={{ background: `linear-gradient(${rgbCss(top)}, ${rgbCss(bottom)})` }}>
        <div className="climb-stars">
          <Starfield visibility={Math.max(0, 1 - bright * 1.6)} drift={h * 9} />
        </div>

        <svg className="climb-earth" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="earthG" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#3f6b8f" />
              <stop offset="0.12" stopColor="#2c5537" />
              <stop offset="1" stopColor="#14261a" />
            </linearGradient>
            <linearGradient id="limbG" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#8fc4ff" stopOpacity="0" />
              <stop offset="1" stopColor="#8fc4ff" stopOpacity={0.9 * (1 - bright)} />
            </linearGradient>
          </defs>
          {(() => {
            const y = horizonY * 1000;
            const sag = curve * 220;
            const d = `M-50 ${y + sag} Q500 ${y - sag} 1050 ${y + sag} L1050 1100 L-50 1100 Z`;
            return (
              <>
                <path d={`M-50 ${y + sag - 26} Q500 ${y - sag - 26} 1050 ${y + sag - 26} L1050 ${y + sag} Q500 ${y - sag} -50 ${y + sag} Z`} fill="url(#limbG)" />
                <path d={d} fill="url(#earthG)" />
              </>
            );
          })()}
        </svg>

        {/* Rocket */}
        <div className="climb-rocket" style={{ bottom: `${(1 - horizonY) * 100 + lift * 16}%`, transform: `translateX(-50%) translateY(${h > 0.05 ? Math.sin(p * 900) * 0.6 : 0}px)` }}>
          <div className="climb-rocket-body">
            <RocketElevation
              vehicle={vehicle}
              scale={k}
              hidden={{ stagesBelow: sep ? 1 : 0, boosters: h > 45, fairing: fairingOff }}
              title={`${vehicle.name} climbing`}
            />
            {h > 0.01 && (
              <div
                className="climb-flame"
                style={{ bottom: flameBottom - plumeH, width: plumeW, height: plumeH, opacity: Math.min(1, h * 4) * (fairingOff ? 0.75 : 1) }}
              />
            )}
            {sep && fallT < 60 && (
              <div className="climb-falling" style={{ transform: `translate(-50%, ${fallT * fallT * 0.9}px) rotate(${fallT * 1.6}deg)`, opacity: Math.max(0, 1 - fallT / 50) }}>
                <RocketElevation vehicle={stage0Only} scale={k} title="Spent first stage" />
              </div>
            )}
          </div>
        </div>

        {/* Altitude tape: log scale so the dense layers and orbit both fit */}
        <ol className="climb-tape" aria-hidden>
          {MARKERS.map(([alt, label]) => {
            const y = 50 - (Math.log1p(alt) - Math.log1p(h)) * 16;
            if (y < -8 || y > 108) return null;
            const passed = h >= alt;
            return (
              <li key={label} style={{ top: `${y}%` }} className={passed ? 'passed' : ''}>
                <span className="num">{alt} km</span>
                {label}
              </li>
            );
          })}
          <li className="climb-tape-now" style={{ top: '50%' }} />
        </ol>

        <dl className="climb-readout" style={{ opacity: 1 - titleOpacity }}>
          <div>
            <dt>Altitude</dt>
            <dd className="num big">
              {h < 10 ? h.toFixed(2) : h.toFixed(1)}
              <small>km</small>
            </dd>
          </div>
          <div>
            <dt>Air pressure</dt>
            <dd className="num">{atm.p < 1 ? atm.p.toExponential(1) : atm.p.toFixed(0)} Pa</dd>
          </div>
          <div>
            <dt>Air density</dt>
            <dd className="num">{atm.rho.toExponential(2)} kg/m³</dd>
          </div>
          <div>
            <dt>Temperature</dt>
            <dd className="num">{(atm.T - 273.15).toFixed(0)} °C</dd>
          </div>
          <div>
            <dt>Speed needed to stay up here</dt>
            <dd className="num">{(vOrbit / 1000).toFixed(2)} km/s</dd>
          </div>
          <p className="climb-phase">{phaseAt(h)}</p>
        </dl>

        <div className="climb-title" style={{ opacity: titleOpacity, pointerEvents: titleOpacity > 0.1 ? 'auto' : 'none' }}>
          <h1>Ascent</h1>
          <p>A launch vehicle simulator built on real physics. Scroll to climb from the pad to orbit.</p>
          <span className="climb-cue" aria-hidden />
        </div>

        <div className="climb-end" style={{ opacity: endOpacity, pointerEvents: endOpacity > 0.5 ? 'auto' : 'none' }}>
          <h2>{TOP_KM} km up, moving at {(vOrbit / 1000).toFixed(2)} km/s</h2>
          <p>That last number is the hard part. Pick a vehicle and find out what it takes.</p>
          <button className="btn climb-cta" onClick={onDone}>
            Choose a vehicle
          </button>
        </div>
      </div>
    </section>
  );
}
