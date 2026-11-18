import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useLayoutEffect, useRef, useState } from 'react';
import { atmosphere } from '../physics/atmosphere';
import { MU_EARTH, R_EQ } from '../physics/constants';
import type { Vehicle } from '../sim/vehicle';
import RocketElevation, { stackHeight } from './RocketElevation';
import Starfield from './Starfield';
import './climb.css';

gsap.registerPlugin(ScrollTrigger);

const TOP_KM = 420;
const SEP_KM = 70;
const FAIRING_KM = 110;

const MARKERS: Array<[number, string]> = [
  [0, 'Launch pad'],
  [11, 'Tropopause'],
  [50, 'Stratopause'],
  [70, 'Stage separation'],
  [100, 'Kármán line'],
  [200, 'Low Earth orbit'],
  [408, 'Space station'],
];

/** Cloud deck: [altitude km, horizontal %, width vw, opacity] */
const CLOUDS: Array<[number, number, number, number]> = [
  [1.2, 8, 46, 0.5],
  [1.8, 62, 52, 0.45],
  [2.6, 30, 60, 0.55],
  [3.4, 78, 40, 0.4],
  [4.5, 15, 55, 0.35],
  [6.0, 55, 70, 0.3],
  [8.0, 5, 50, 0.22],
  [10.5, 60, 60, 0.18],
];

const phaseAt = (h: number) =>
  h < 0.05 ? 'Go for launch' : h < 8 ? 'Climbing through the clouds' : h < 16 ? 'Max-Q: peak aerodynamic load' : h < SEP_KM ? 'Engines near full vacuum thrust' : h < 100 ? 'Second stage burning' : h < 300 ? 'Space. Building orbital speed' : 'Orbit';

const mix = (a: number[], b: number[], f: number) => a.map((x, i) => Math.round(x + (b[i] - x) * Math.max(0, Math.min(1, f))));
const rgb = (c: number[]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/**
 * Night launch, scroll-driven. Scroll progress (GSAP ScrollTrigger, scrubbed)
 * maps to altitude; the cloud deck, horizon glow, Earth's curvature and all
 * readouts follow, with the numbers evaluated from US76 at that altitude.
 */
export default function ClimbHero({ vehicle, onDone }: { vehicle: Vehicle; onDone: () => void }) {
  const wrap = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [p, setP] = useState(0);
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800));

  // Scroll → progress, smoothed by ScrollTrigger's scrub
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const proxy = { p: 0 };
    const st = gsap.to(proxy, {
      p: 1,
      ease: 'none',
      onUpdate: () => setP(proxy.p),
      scrollTrigger: { trigger: el, start: 'top top', end: 'bottom bottom', scrub: 0.6 },
    });
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => {
      st.scrollTrigger?.kill();
      st.kill();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const h = TOP_KM * Math.pow(p, 2.3);
  const atm = atmosphere(h * 1000);
  const thin = Math.min(1, h / 60); // 0 at the pad, 1 above most of the air
  // Night sky: deep navy near the ground fading to pure black; horizon keeps a faint airglow
  const top = mix([6, 10, 28], [0, 0, 0], thin * 1.4);
  const mid = mix([14, 26, 58], [2, 3, 10], thin);
  const bottom = mix([38, 58, 102], [8, 16, 40], thin);
  const sep = h >= SEP_KM;
  const fairingOff = h >= FAIRING_KM;

  const H = stackHeight(vehicle);
  const k = (vh * 0.42) / H;
  const bell = Math.min(vehicle.stages[0].diameter * 0.32, 2.2);
  const flameBottom = sep ? (vehicle.stages[0].length + bell) * k : 0;
  const pa = atm.p / 101325;
  const plumeW = vehicle.stages[sep ? 1 : 0].diameter * k * (1.1 + 3.4 * (1 - pa) * (1 - pa));
  const plumeH = vehicle.stages[0].diameter * k * (5 + 8 * (1 - pa));
  const lift = Math.min(1, h / 2.5);
  const vOrbit = Math.sqrt(MU_EARTH / (R_EQ + h * 1000));
  const horizonY = 0.82 + 0.12 * Math.min(1, h / 8);
  const curve = Math.min(1, h / TOP_KM);
  const titleOut = Math.min(1, p * 9);
  const endIn = Math.max(0, Math.min(1, (p - 0.9) * 12));
  const kmPx = vh * 0.16; // cloud parallax: px per km of altitude change

  const stage0Only: Vehicle = {
    ...vehicle,
    stages: [vehicle.stages[0]],
    boosters: { ...vehicle.boosters, count: 0 },
    fairing: { ...vehicle.fairing, length: 0.01 },
  };
  const fallT = Math.max(0, h - SEP_KM);
  const title = 'Ascent';

  return (
    <section ref={wrap} className="climb" aria-label="Scroll to climb from the launch pad to orbit">
      <div className="climb-stage" style={{ background: `linear-gradient(${rgb(top)} 0%, ${rgb(mid)} 55%, ${rgb(bottom)} 100%)` }}>
        <div className="climb-stars">
          <Starfield visibility={0.75 + 0.25 * thin} drift={h * 9} />
        </div>
        <div className="climb-nebula" style={{ opacity: 0.35 + 0.5 * thin, transform: `translateY(${h * 2.2}px)` }} aria-hidden />

        {/* Airglow along the horizon, then the thin blue limb from space */}
        <div className="climb-glow" style={{ top: `${horizonY * 100 - 18}%`, opacity: 0.9 - 0.5 * thin }} aria-hidden />

        <svg className="climb-earth" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="earthN" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#0d1830" />
              <stop offset="0.25" stopColor="#081020" />
              <stop offset="1" stopColor="#03060c" />
            </linearGradient>
            <linearGradient id="limbN" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#5fa8ff" stopOpacity="0" />
              <stop offset="1" stopColor="#7cc0ff" stopOpacity={0.25 + 0.6 * thin} />
            </linearGradient>
          </defs>
          {(() => {
            const y = horizonY * 1000;
            const sag = curve * 230;
            return (
              <>
                <path d={`M-50 ${y + sag - 30} Q500 ${y - sag - 30} 1050 ${y + sag - 30} L1050 ${y + sag} Q500 ${y - sag} -50 ${y + sag} Z`} fill="url(#limbN)" />
                <path d={`M-50 ${y + sag} Q500 ${y - sag} 1050 ${y + sag} L1050 1100 L-50 1100 Z`} fill="url(#earthN)" />
              </>
            );
          })()}
        </svg>

        {/* City lights scattered on the ground, sinking away as we climb */}
        <div className="climb-city" style={{ top: `${horizonY * 100 + 1}%`, opacity: 1 - Math.min(1, h / 30), transform: `translateY(${h * 12}px)` }} aria-hidden />

        {/* Pad lights */}
        <div className="climb-pad-lights" style={{ top: `${horizonY * 100}%`, transform: `translate(-50%, ${h * kmPx}px)` }} aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} style={{ left: `${(i - 4) * 26}px`, animationDelay: `${i * 0.17}s` }} />
          ))}
        </div>

        {/* Cloud deck: slides down past the rocket as altitude rises */}
        <div className="climb-clouds" aria-hidden>
          {CLOUDS.map(([alt, x, w, o], i) => {
            const y = vh * 0.55 + (h - alt) * kmPx;
            if (y < -200 || y > vh + 200) return null;
            return <span key={i} style={{ left: `${x}%`, top: y, width: `${w}vw`, opacity: o * (1 - thin), transform: `translateX(-50%) translateX(${Math.sin(i + h) * 20}px)` }} />;
          })}
        </div>

        {/* Smoke column left behind near the ground */}
        <div className="climb-smoke" style={{ opacity: h > 0.02 ? Math.max(0, 0.85 - h / 6) : 0, height: `${Math.min(55, h * 40)}vh`, bottom: `${(1 - horizonY) * 100}%` }} aria-hidden />

        <div
          className="climb-rocket"
          style={{ bottom: `${(1 - horizonY) * 100 + lift * 14}%`, transform: `translateX(-50%) translate(${h > 0.05 && h < 20 ? Math.sin(p * 1300) * 1.2 : 0}px, ${h > 0.05 && h < 20 ? Math.cos(p * 1700) * 1.2 : 0}px)` }}
        >
          <div className="climb-rocket-body">
            <RocketElevation vehicle={vehicle} scale={k} hidden={{ stagesBelow: sep ? 1 : 0, boosters: h > 45, fairing: fairingOff }} title={`${vehicle.name} climbing`} />
            {h > 0.005 && (
              <>
                <div className="climb-lightshaft" style={{ bottom: flameBottom - plumeH * 2.2, height: plumeH * 2.2, opacity: Math.min(1, h * 6) * (1 - thin * 0.7) }} />
                <div className="climb-flame" style={{ bottom: flameBottom - plumeH, width: plumeW, height: plumeH, opacity: Math.min(1, h * 8) }} />
              </>
            )}
            {sep && fallT < 60 && (
              <div className="climb-falling" style={{ transform: `translate(-50%, ${fallT * fallT * 0.9}px) rotate(${fallT * 1.6}deg)`, opacity: Math.max(0, 1 - fallT / 50) }}>
                <RocketElevation vehicle={stage0Only} scale={k} title="Spent first stage" />
              </div>
            )}
          </div>
        </div>

        <ol className="climb-tape" aria-hidden>
          {MARKERS.map(([alt, label]) => {
            const y = 50 - (Math.log1p(alt) - Math.log1p(h)) * 16;
            if (y < -8 || y > 108) return null;
            return (
              <li key={label} style={{ top: `${y}%` }} className={h >= alt ? 'passed' : ''}>
                <span className="num">{alt} km</span>
                {label}
              </li>
            );
          })}
          <li className="climb-tape-now" style={{ top: '50%' }} />
        </ol>

        <dl className="climb-readout" style={{ opacity: titleOut, transform: `translateY(calc(-50% + ${(1 - titleOut) * 30}px))` }}>
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

        <div
          className="climb-title"
          style={{ opacity: 1 - titleOut, transform: `translateY(${-titleOut * 80}px) scale(${1 + titleOut * 0.08})`, filter: `blur(${titleOut * 8}px)`, pointerEvents: titleOut < 0.9 ? 'auto' : 'none' }}
        >
          <h1 ref={titleRef} aria-label={title}>
            {title.split('').map((c, i) => (
              <span key={i} className="ch" aria-hidden style={{ ['--i' as string]: i }}>
                {c}
              </span>
            ))}
          </h1>
          <p>A launch vehicle simulator built on real physics. Scroll to fly from the pad to orbit.</p>
          <span className="climb-cue" aria-hidden>
            <span />
          </span>
        </div>

        <div className="climb-end" style={{ opacity: endIn, transform: `translate(-50%, ${(1 - endIn) * 40}px)`, pointerEvents: endIn > 0.5 ? 'auto' : 'none' }}>
          <h2>
            {TOP_KM} km up, moving at <span className="num">{(vOrbit / 1000).toFixed(2)}</span> km/s
          </h2>
          <p>That last number is the hard part. Pick a vehicle and find out what it takes.</p>
          <button className="btn climb-cta" onClick={onDone}>
            Choose a vehicle
          </button>
        </div>
      </div>
    </section>
  );
}
