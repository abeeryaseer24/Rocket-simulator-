import katex from 'katex';
import { useId, useMemo, useState, type ReactNode } from 'react';
import Chart from '../components/Chart';
import { cdAt, circleArea, suttonGraves } from '../physics/aero';
import { atmosphere } from '../physics/atmosphere';
import { DEG, G0, MU_EARTH, OMEGA_EARTH, P0, R_EQ, RAD } from '../physics/constants';
import { exitMach, exitPressure } from '../physics/nozzle';
import { ispAt, PROPELLANTS, tankVolumes, thrustAt, type PropellantKind } from '../physics/propulsion';
import { launchAzimuth, simulate } from '../sim/simulate';
import { useSim } from '../sim/store';
import { cloneVehicle } from '../sim/vehicle';

export function TeX({ children, block }: { children: string; block?: boolean }) {
  const html = useMemo(() => katex.renderToString(children, { displayMode: !!block, throwOnError: false }), [children, block]);
  return block ? <div className="tex-block" dangerouslySetInnerHTML={{ __html: html }} /> : <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function Slider({ label, value, min, max, step, onChange, unit, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit?: string; fmt?: (v: number) => string }) {
  const id = useId();
  return (
    <div className="w-slider">
      <label htmlFor={id}>
        {label}
        <span className="num">
          {fmt ? fmt(value) : value}
          {unit && <small> {unit}</small>}
        </span>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function Out({ label, children, warn }: { label: string; children: ReactNode; warn?: boolean }) {
  return (
    <div className={'w-out' + (warn ? ' warn' : '')}>
      <dt>{label}</dt>
      <dd className="num">{children}</dd>
    </div>
  );
}

export function Widget({ title, children }: { title: string; children: ReactNode }) {
  return (
    <figure className="widget">
      <figcaption>{title}</figcaption>
      {children}
    </figure>
  );
}

/* ---------------- rocket equation ---------------- */
export function RocketEquationWidget() {
  const [isp, setIsp] = useState(330);
  const [mr, setMr] = useState(8);
  const dv = isp * G0 * Math.log(mr);
  const isps = Array.from({ length: 61 }, (_, i) => 200 + i * 5);
  return (
    <Widget title="How much mass ratio does orbit cost?">
      <div className="w-controls">
        <Slider label="Specific impulse" value={isp} min={200} max={460} step={1} unit="s" onChange={setIsp} />
        <Slider label="Mass ratio m₀/m_f" value={mr} min={1.1} max={30} step={0.1} onChange={setMr} fmt={(v) => v.toFixed(1)} />
      </div>
      <dl className="w-outs">
        <Out label="Δv">{dv.toFixed(0)} m/s</Out>
        <Out label="Propellant share of liftoff mass">{((1 - 1 / mr) * 100).toFixed(1)} %</Out>
        <Out label="Enough for orbit (≈ 9,400 m/s with losses)?" warn={dv < 9400}>
          {dv >= 9400 ? 'Yes' : 'No'}
        </Out>
      </dl>
      <Chart
        series={[{ label: 'Mass ratio for 9.4 km/s', x: isps, y: isps.map((i) => Math.exp(9400 / (i * G0))) }]}
        xLabel="Specific impulse (s)"
        yLabel="Mass ratio needed"
        height={240}
        logY
        cursorX={isp}
      />
      <p className="w-note">Single stage to orbit with kerosene (Isp ≈ 330 s) needs a mass ratio near 18: a vehicle that is 94 % propellant. Tanks, engines and structure can't fit in the remaining 6 %, which is why rockets stage.</p>
    </Widget>
  );
}

/* ---------------- staging ---------------- */
export function StagingWidget() {
  const [eps, setEps] = useState(0.08);
  const [isp, setIsp] = useState(330);
  const [pl, setPl] = useState(0.03);
  const ve = isp * G0;
  // Single stage: payload fraction pl, structure eps of the propulsive mass
  const m0 = 1;
  const mPay = pl * m0;
  const prop1 = (m0 - mPay) * (1 - eps);
  const single = ve * Math.log(m0 / (m0 - prop1));
  // Two equal-ratio stages (optimal split for identical stages): solve stage mass fraction per stage
  const lam = Math.sqrt(pl); // payload ratio per stage
  const stageR = 1 / (eps + (1 - eps) * lam);
  const two = 2 * ve * Math.log(stageR);
  return (
    <Widget title="One stage or two, same propellant and same technology">
      <div className="w-controls">
        <Slider label="Structural ratio ε" value={eps} min={0.03} max={0.2} step={0.005} onChange={setEps} fmt={(v) => (v * 100).toFixed(1) + ' %'} />
        <Slider label="Specific impulse" value={isp} min={250} max={460} step={1} unit="s" onChange={setIsp} />
        <Slider label="Payload fraction" value={pl} min={0.005} max={0.1} step={0.001} onChange={setPl} fmt={(v) => (v * 100).toFixed(1) + ' %'} />
      </div>
      <dl className="w-outs">
        <Out label="Single stage Δv" warn={single < 9400}>
          {single.toFixed(0)} m/s
        </Out>
        <Out label="Two stages Δv" warn={two < 9400}>
          {two.toFixed(0)} m/s
        </Out>
        <Out label="Gain from staging">+{(two - single).toFixed(0)} m/s</Out>
      </dl>
      <p className="w-note">The two-stage case uses the optimal split for identical stages: each stage carries the same payload ratio √(payload fraction).</p>
    </Widget>
  );
}

/* ---------------- engines / nozzle ---------------- */
export function NozzleWidget() {
  const { vehicle } = useSim();
  const [stage, setStage] = useState(0);
  const [alt, setAlt] = useState(0);
  const e = vehicle.stages[Math.min(stage, vehicle.stages.length - 1)].engine;
  const pa = atmosphere(alt * 1000).p;
  const pe = exitPressure(e.chamberPressure * 1e5, e.expansionRatio);
  const Me = exitMach(e.expansionRatio);
  const state = pe < pa * 0.4 ? 'heavily over-expanded: risk of flow separation' : pe < pa * 0.9 ? 'over-expanded: air squeezes the plume inward' : pe < pa * 1.1 ? 'ideally expanded' : 'under-expanded: the plume balloons outward';
  const one = { ...e, count: 1 };
  return (
    <Widget title="One engine, climbing through the atmosphere">
      <div className="picker" style={{ marginBottom: 14 }}>
        {vehicle.stages.map((s, i) => (
          <button key={i} className={i === stage ? 'on' : ''} onClick={() => setStage(i)}>
            {s.engine.name}
          </button>
        ))}
      </div>
      <div className="w-controls">
        <Slider label="Altitude" value={alt} min={0} max={100} step={0.5} unit="km" onChange={setAlt} />
      </div>
      <dl className="w-outs">
        <Out label="Ambient pressure">{(pa / 1000).toFixed(2)} kPa</Out>
        <Out label="Nozzle exit pressure">{(pe / 1000).toFixed(2)} kPa</Out>
        <Out label="Exit Mach number">{Me.toFixed(2)}</Out>
        <Out label="Thrust">{(thrustAt(one, pa) / 1000).toFixed(0)} kN</Out>
        <Out label="Specific impulse">{ispAt(e, pa).toFixed(1)} s</Out>
        <Out label="Plume" warn={pe < pa * 0.4}>
          {state}
        </Out>
      </dl>
      <p className="w-note">
        Exit pressure comes from the isentropic area–Mach relation with γ = 1.2, from this engine’s {e.chamberPressure} bar chamber and ε = {e.expansionRatio}. Edit those in the Vehicle Bay and come back.
      </p>
    </Widget>
  );
}

/* ---------------- propellants ---------------- */
export function PropellantWidget() {
  const [mass, setMass] = useState(100);
  const kinds = Object.keys(PROPELLANTS) as PropellantKind[];
  const vols = kinds.map((k) => ({ k, v: tankVolumes(k, mass * 1000) }));
  const max = Math.max(...vols.map((x) => x.v.total));
  return (
    <Widget title="Tank volume for the same propellant mass">
      <div className="w-controls">
        <Slider label="Propellant mass" value={mass} min={10} max={500} step={5} unit="t" onChange={setMass} />
      </div>
      <div className="w-bars">
        {vols.map(({ k, v }) => (
          <div key={k} className="w-bar-row">
            <span>{k}</span>
            <div className="w-bar">
              <div style={{ width: `${(v.total / max) * 100}%` }} />
            </div>
            <span className="num">{v.total.toFixed(0)} m³</span>
          </div>
        ))}
      </div>
      <p className="w-note">Hydrogen gives the best Isp but needs about three times the tank volume of kerosene. Bigger tanks mean more structure and more drag, so the Isp advantage is partly spent before it is used.</p>
    </Widget>
  );
}

/* ---------------- atmosphere ---------------- */
export function AtmosphereWidget() {
  const [alt, setAlt] = useState(11);
  const hs = Array.from({ length: 201 }, (_, i) => i * 0.5);
  const a = atmosphere(alt * 1000);
  return (
    <Widget title="Probe the standard atmosphere">
      <Chart series={[{ label: 'Temperature', x: hs, y: hs.map((h) => atmosphere(h * 1000).T) }]} xLabel="Altitude (km)" yLabel="Temperature (K)" height={240} cursorX={alt} />
      <div className="w-controls">
        <Slider label="Altitude" value={alt} min={0} max={100} step={0.5} unit="km" onChange={setAlt} />
      </div>
      <dl className="w-outs">
        <Out label="Temperature">{a.T.toFixed(1)} K</Out>
        <Out label="Pressure">{a.p < 10 ? a.p.toExponential(2) : a.p.toFixed(0)} Pa</Out>
        <Out label="Density">{a.rho.toExponential(3)} kg/m³</Out>
        <Out label="Speed of sound">{a.a.toFixed(1)} m/s</Out>
        <Out label="Share of the atmosphere’s mass below you">{((1 - a.p / P0) * 100).toFixed(2)} %</Out>
      </dl>
    </Widget>
  );
}

/* ---------------- drag ---------------- */
export function DragWidget() {
  const { vehicle } = useSim();
  const [alt, setAlt] = useState(12);
  const [v, setV] = useState(450);
  const a = atmosphere(alt * 1000);
  const M = v / a.a;
  const q = 0.5 * a.rho * v * v;
  const cd = cdAt(vehicle.cd, M);
  const A = circleArea(Math.max(vehicle.stages[0].diameter, vehicle.fairing.diameter));
  return (
    <Widget title="Dynamic pressure and drag on your vehicle">
      <div className="w-controls">
        <Slider label="Altitude" value={alt} min={0} max={60} step={0.5} unit="km" onChange={setAlt} />
        <Slider label="Air-relative speed" value={v} min={0} max={2500} step={10} unit="m/s" onChange={setV} />
      </div>
      <dl className="w-outs">
        <Out label="Mach">{M.toFixed(2)}</Out>
        <Out label="Dynamic pressure q">{(q / 1000).toFixed(1)} kPa</Out>
        <Out label="Drag coefficient">{cd.toFixed(3)}</Out>
        <Out label="Drag">{((q * cd * A) / 1000).toFixed(0)} kN</Out>
      </dl>
      <p className="w-note">Max-Q for most launchers is 25–35 kPa, around Mach 1–1.5 and 10–14 km up. Try finding that point.</p>
    </Widget>
  );
}

/* ---------------- gravity turn ---------------- */
export function GravityTurnWidget() {
  const { vehicle } = useSim();
  const [kick, setKick] = useState(vehicle.guidance.pitchKickAngle);
  const r = useMemo(() => {
    const c = cloneVehicle(vehicle);
    c.guidance.pitchKickAngle = kick;
    return simulate(c, { dt: 0.1, coastAfterCutoff: 1 });
  }, [vehicle, kick]);
  const t = r.totals;
  return (
    <Widget title={`Pitch kick on the ${vehicle.name}`}>
      <div className="w-controls">
        <Slider label="Pitch kick" value={kick} min={0.2} max={25} step={0.1} unit="°" onChange={setKick} fmt={(v) => v.toFixed(1)} />
      </div>
      <dl className="w-outs">
        <Out label="Outcome" warn={r.outcome !== 'orbit'}>
          {r.outcome === 'orbit' ? 'Orbit' : r.outcome === 'low-orbit' ? 'Low orbit' : r.outcome === 'impact' ? 'Falls back' : 'Suborbital'}
        </Out>
        <Out label="Gravity loss">{t.lossGravity.toFixed(0)} m/s</Out>
        <Out label="Steering loss">{t.lossSteering.toFixed(0)} m/s</Out>
        <Out label="Drag loss">{t.lossDrag.toFixed(0)} m/s</Out>
        <Out label="Max-Q">{(r.maxQ.q / 1000).toFixed(1)} kPa</Out>
        <Out label="Propellant margin">{r.outcome === 'orbit' || r.outcome === 'low-orbit' ? `${(r.margin / 1000).toFixed(2)} t` : '—'}</Out>
      </dl>
      <p className="w-note">Each change re-flies the whole ascent. Small kicks lower drag but raise gravity and steering losses; large kicks do the reverse until the vehicle can't climb out of the air.</p>
    </Widget>
  );
}

/* ---------------- orbits ---------------- */
export function OrbitWidget() {
  const [peri, setPeri] = useState(300);
  const [apo, setApo] = useState(1200);
  const rp = R_EQ + peri * 1000;
  const ra = R_EQ + Math.max(apo, peri) * 1000;
  const a = (rp + ra) / 2;
  const e = (ra - rp) / (ra + rp);
  const vp = Math.sqrt(MU_EARTH * (2 / rp - 1 / a));
  const va = Math.sqrt(MU_EARTH * (2 / ra - 1 / a));
  const T = 2 * Math.PI * Math.sqrt(a ** 3 / MU_EARTH);
  const S = 110 / ra;
  const b = a * Math.sqrt(1 - e * e);
  const c = a * e;
  return (
    <Widget title="Shape an orbit">
      <div className="w-controls">
        <Slider label="Periapsis altitude" value={peri} min={150} max={2000} step={10} unit="km" onChange={setPeri} />
        <Slider label="Apoapsis altitude" value={apo} min={150} max={40000} step={50} unit="km" onChange={setApo} />
      </div>
      <div className="w-orbit">
        <svg viewBox="-130 -125 260 250" width="260" height="250" role="img" aria-label="Orbit drawing">
          <ellipse cx={-c * S} cy={0} rx={a * S} ry={b * S} fill="none" stroke="var(--kapton)" strokeWidth="1.6" />
          <circle cx={0} cy={0} r={R_EQ * S} fill="#1F5FA8" opacity="0.85" />
          <circle cx={rp * S} cy={0} r={3.5} fill="var(--ink)" />
          <circle cx={-ra * S} cy={0} r={3.5} fill="var(--ink)" />
        </svg>
        <dl className="w-outs">
          <Out label="Speed at periapsis">{vp.toFixed(0)} m/s</Out>
          <Out label="Speed at apoapsis">{va.toFixed(0)} m/s</Out>
          <Out label="Eccentricity">{e.toFixed(4)}</Out>
          <Out label="Period">{(T / 60).toFixed(1)} min</Out>
        </dl>
      </div>
    </Widget>
  );
}

/* ---------------- launch site ---------------- */
export function LaunchSiteWidget() {
  const [lat, setLat] = useState(28.5);
  const [inc, setInc] = useState(51.6);
  const az = launchAzimuth(lat, inc, 300e3) * RAD;
  const boost = OMEGA_EARTH * R_EQ * Math.cos(lat * DEG);
  const ok = inc >= Math.abs(lat);
  const along = boost * Math.sin(az * DEG);
  return (
    <Widget title="Latitude, inclination and the free ride from Earth’s spin">
      <div className="w-controls">
        <Slider label="Site latitude" value={lat} min={0} max={65} step={0.5} unit="°" onChange={setLat} />
        <Slider label="Target inclination" value={inc} min={0} max={110} step={0.5} unit="°" onChange={setInc} />
      </div>
      <div className="w-orbit">
        <svg viewBox="-60 -60 120 120" width="160" height="160" role="img" aria-label={`Compass showing launch azimuth ${az.toFixed(0)} degrees`}>
          <circle r="48" fill="none" stroke="var(--line)" />
          <text y="-52" textAnchor="middle" fontSize="9" fill="var(--graphite)">
            N
          </text>
          <text x="54" y="3" textAnchor="middle" fontSize="9" fill="var(--graphite)">
            E
          </text>
          <line x1="0" y1="0" x2={44 * Math.sin(az * DEG)} y2={-44 * Math.cos(az * DEG)} stroke="var(--kapton)" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <dl className="w-outs">
          <Out label="Launch azimuth" warn={!ok}>
            {ok ? `${((az + 360) % 360).toFixed(1)}° from north` : 'Not reachable directly'}
          </Out>
          <Out label="Earth-rotation speed at the pad">{boost.toFixed(0)} m/s</Out>
          <Out label="Of which helps along the launch direction">{along.toFixed(0)} m/s</Out>
        </dl>
      </div>
    </Widget>
  );
}

/* ---------------- loads / heating ---------------- */
export function HeatingWidget() {
  const [rn, setRn] = useState(1);
  const [alt, setAlt] = useState(40);
  const [v, setV] = useState(1800);
  const a = atmosphere(alt * 1000);
  const qdot = suttonGraves(a.rho, v, rn);
  return (
    <Widget title="Stagnation-point heating">
      <div className="w-controls">
        <Slider label="Nose radius" value={rn} min={0.1} max={4} step={0.05} unit="m" onChange={setRn} fmt={(x) => x.toFixed(2)} />
        <Slider label="Altitude" value={alt} min={10} max={120} step={1} unit="km" onChange={setAlt} />
        <Slider label="Speed" value={v} min={200} max={8000} step={50} unit="m/s" onChange={setV} />
      </div>
      <dl className="w-outs">
        <Out label="Heat flux">{(qdot / 1000).toFixed(1)} kW/m²</Out>
        <Out label="Dynamic pressure">{((0.5 * a.rho * v * v) / 1000).toFixed(2)} kPa</Out>
      </dl>
      <p className="w-note">Doubling the nose radius cuts heating by about 30 % (√2). Doubling speed multiplies it by 8.</p>
    </Widget>
  );
}
