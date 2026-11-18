import { useState } from 'react';
import Chart from '../../components/Chart';
import { Derived, NumField, SelectField } from '../../components/Field';
import { cdAt, circleArea, DEFAULT_CD } from '../../physics/aero';
import { atmosphere } from '../../physics/atmosphere';
import { DEG, G0, MU_EARTH, OMEGA_EARTH, P0, R_EQ, RAD } from '../../physics/constants';
import { massFlow, PROPELLANTS, seaLevelThrust, type PropellantKind } from '../../physics/propulsion';
import { SITES } from '../../sim/presets';
import { launchAzimuth } from '../../sim/simulate';
import { useSim } from '../../sim/store';
import { tunePitchKick, type TuneResult } from '../../sim/tune';
import { liftoffMass, liftoffThrust } from '../../sim/vehicle';

const PROP_KINDS = Object.keys(PROPELLANTS) as PropellantKind[];

export function BoostersSection() {
  const { vehicle, update } = useSim();
  const b = vehicle.boosters;
  const s = b.stage;
  const m0 = liftoffMass(vehicle);
  const T0 = liftoffThrust(vehicle);
  const boostT = b.count > 0 ? seaLevelThrust(s.engine) * b.count : 0;
  const burn = s.propMass / massFlow(s.engine);
  const coreBurn = vehicle.stages[0].propMass / massFlow(vehicle.stages[0].engine, b.coreThrottleWhileAttached);
  const setS = (mut: (st: typeof s) => void) => update((v) => mut(v.boosters.stage));

  return (
    <>
      <div className="bay-form">
        <h2>Side boosters</h2>
        <p className="bay-intro">
          Strap-on boosters add thrust at liftoff, when the vehicle is heaviest and gravity loss is worst, then drop away.
          Set the count to zero to fly without them.
        </p>
        <SelectField
          label="Number of boosters"
          value={String(b.count) as '0'}
          options={['0', '2', '3', '4', '6'] as const}
          onChange={(v) => update((veh) => void (veh.boosters.count = Number(v)))}
        />
        {b.count > 0 && (
          <>
            <NumField
              label="Core throttle while boosters burn"
              hint="Throttling the core down saves its propellant for after booster separation, the trick heavy tri-core vehicles use."
              value={b.coreThrottleWhileAttached}
              scale={100}
              unit="%"
              min={vehicle.stages[0].engine.throttleMin * 100}
              max={100}
              onChange={(v) => update((veh) => void (veh.boosters.coreThrottleWhileAttached = v))}
            />
            <SelectField label="Booster propellant" hint={PROPELLANTS[s.propellant].note} value={s.propellant} options={PROP_KINDS} onChange={(v) => setS((st) => void (st.propellant = v))} />
            <NumField label="Dry mass, each" value={s.dryMass} scale={0.001} unit="t" min={0.01} onChange={(v) => setS((st) => void (st.dryMass = v))} />
            <NumField label="Propellant mass, each" value={s.propMass} scale={0.001} unit="t" min={0.01} onChange={(v) => setS((st) => void (st.propMass = v))} />
            <NumField label="Engines per booster" value={s.engine.count} step={1} min={1} max={30} onChange={(v) => setS((st) => void (st.engine.count = Math.round(v)))} />
            <NumField label="Vacuum thrust per engine" value={s.engine.thrustVac} scale={0.001} unit="kN" min={1} onChange={(v) => setS((st) => void (st.engine.thrustVac = v))} />
            <NumField label="Vacuum specific impulse" value={s.engine.ispVac} unit="s" min={100} max={500} onChange={(v) => setS((st) => void (st.engine.ispVac = v))} />
            <NumField label="Nozzle exit area per engine" value={s.engine.exitArea} unit="m²" min={0.0001} onChange={(v) => setS((st) => void (st.engine.exitArea = v))} />
            <NumField label="Diameter" value={s.diameter} unit="m" min={0.3} max={10} onChange={(v) => setS((st) => void (st.diameter = v))} />
            <NumField label="Length" value={s.length} unit="m" min={1} max={80} onChange={(v) => setS((st) => void (st.length = v))} />
          </>
        )}
      </div>
      <aside className="bay-derived">
        <h3>What this means</h3>
        <dl>
          <Derived label="Liftoff thrust-to-weight" value={(T0 / (m0 * G0)).toFixed(2)} warn={T0 / (m0 * G0) < 1.1} />
          {b.count > 0 && (
            <>
              <Derived label="Share of liftoff thrust from boosters" value={((boostT / T0) * 100).toFixed(0)} unit="%" />
              <Derived label="Booster burn time" value={burn.toFixed(0)} unit="s" />
              <Derived
                label="Core burn time at that throttle"
                value={coreBurn.toFixed(0)}
                unit="s"
                warn={coreBurn < burn}
                note={coreBurn < burn ? 'The core runs dry before the boosters do. Throttle the core down or give it more propellant.' : 'The core keeps burning after the boosters separate.'}
              />
            </>
          )}
          <Derived label="Liftoff mass" value={(m0 / 1000).toFixed(1)} unit="t" />
        </dl>
      </aside>
    </>
  );
}

export function PayloadSection() {
  const { vehicle, update } = useSim();
  const f = vehicle.fairing;
  const m0 = liftoffMass(vehicle);
  const atm = atmosphere(f.jettisonAltitude);
  return (
    <>
      <div className="bay-form">
        <h2>Payload and fairing</h2>
        <p className="bay-intro">
          The payload is the only mass that matters to the customer. The fairing protects it from aerodynamic heating and
          is jettisoned as soon as the air is thin enough, because every kilogram carried to orbit costs propellant.
        </p>
        <NumField label="Payload mass" value={vehicle.payloadMass} scale={0.001} unit="t" min={0} onChange={(v) => update((veh) => void (veh.payloadMass = v))} />
        <NumField label="Fairing mass" value={f.mass} scale={0.001} unit="t" min={0} onChange={(v) => update((veh) => void (veh.fairing.mass = v))} />
        <NumField label="Fairing diameter" value={f.diameter} unit="m" min={0.3} max={20} onChange={(v) => update((veh) => void (veh.fairing.diameter = v))} />
        <NumField label="Fairing length" value={f.length} unit="m" min={0.5} max={40} onChange={(v) => update((veh) => void (veh.fairing.length = v))} />
        <NumField
          label="Jettison altitude"
          hint="Common practice: when free-molecular heating on the payload drops below about 1,135 W/m², usually 100–120 km."
          value={f.jettisonAltitude}
          scale={0.001}
          unit="km"
          min={20}
          max={400}
          onChange={(v) => update((veh) => void (veh.fairing.jettisonAltitude = v))}
        />
        <NumField
          label="Nose radius"
          hint="Used for stagnation-point heating. A blunter nose heats less: shock stands further off and carries the heat around."
          value={vehicle.noseRadius}
          unit="m"
          min={0.05}
          max={5}
          onChange={(v) => update((veh) => void (veh.noseRadius = v))}
        />
      </div>
      <aside className="bay-derived">
        <h3>What this means</h3>
        <dl>
          <Derived label="Payload fraction" value={((vehicle.payloadMass / m0) * 100).toFixed(2)} unit="%" note="Payload ÷ liftoff mass. Real orbital rockets deliver 2–4 %. That's why launch is expensive." />
          <Derived label="Air density at jettison" value={atm.rho.toExponential(2)} unit="kg/m³" note={`About ${(atm.rho / 1.225).toExponential(0)} of sea level.`} />
          <Derived label="Liftoff mass" value={(m0 / 1000).toFixed(1)} unit="t" />
        </dl>
      </aside>
    </>
  );
}

export function AeroSection() {
  const { vehicle, update } = useSim();
  const A =
    circleArea(Math.max(vehicle.stages[0].diameter, vehicle.fairing.diameter)) +
    (vehicle.boosters.count ? vehicle.boosters.count * circleArea(vehicle.boosters.stage.diameter) : 0);
  const machs = Array.from({ length: 121 }, (_, i) => i * 0.05);
  return (
    <>
      <div className="bay-form">
        <h2>Aerodynamics</h2>
        <p className="bay-intro">
          Drag is D = q · C<sub>D</sub> · A, with q = ½ρv². The drag coefficient C<sub>D</sub> jumps near Mach 1 as shock
          waves form, then slowly falls. Edit the table to see how much drag really costs; usually it's under 2 % of the
          Δv budget for a large rocket.
        </p>
        <table className="cd-table">
          <thead>
            <tr>
              <th scope="col">Mach</th>
              <th scope="col">Drag coefficient</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vehicle.cd.map(([mach, cd], i) => (
              <tr key={i}>
                <td>
                  <input
                    type="number"
                    step="0.05"
                    value={mach}
                    aria-label={`Mach for row ${i + 1}`}
                    onChange={(e) => update((v) => void (v.cd[i][0] = Number(e.target.value)))}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={cd}
                    aria-label={`Drag coefficient for row ${i + 1}`}
                    onChange={(e) => update((v) => void (v.cd[i][1] = Number(e.target.value)))}
                  />
                </td>
                <td>
                  <button className="link" onClick={() => update((v) => void v.cd.splice(i, 1))} disabled={vehicle.cd.length < 3}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row-actions">
          <button
            className="btn small ghost"
            onClick={() =>
              update((v) => {
                const last = v.cd[v.cd.length - 1];
                v.cd.push([last[0] + 2, last[1]]);
              })
            }
          >
            Add a row
          </button>
          <button className="btn small ghost" onClick={() => update((v) => void (v.cd = DEFAULT_CD.map((r) => [...r] as [number, number])))}>
            Restore default table
          </button>
        </div>
      </div>
      <aside className="bay-derived">
        <h3>What this means</h3>
        <dl>
          <Derived label="Reference area at liftoff" value={A.toFixed(1)} unit="m²" note="Frontal area of every body in the airflow." />
          <Derived label="Peak drag coefficient" value={Math.max(...vehicle.cd.map((r) => r[1])).toFixed(2)} />
        </dl>
        <div className="bay-mini">
          <h3>Drag coefficient vs Mach</h3>
          <Chart
            series={[{ label: 'Drag coefficient', x: machs, y: machs.map((mm) => cdAt([...vehicle.cd].sort((a, b) => a[0] - b[0]), mm)) }]}
            xLabel="Mach"
            yLabel="Drag coefficient"
            height={220}
            yMin={0}
          />
        </div>
      </aside>
    </>
  );
}

export function GuidanceSection() {
  const { vehicle, update } = useSim();
  const g = vehicle.guidance;
  const set = (mut: (gg: typeof g) => void) => update((v) => mut(v.guidance));
  const [tune, setTune] = useState<TuneResult | null>(null);
  const [tuning, setTuning] = useState(false);
  const az = launchAzimuth(vehicle.site.lat, g.targetInclination, g.targetAltitude) * RAD;
  const rT = R_EQ + g.targetAltitude;
  const vc = Math.sqrt(MU_EARTH / rT);
  const feasible = g.targetInclination >= Math.abs(vehicle.site.lat) - 1e-6;

  return (
    <>
      <div className="bay-form">
        <h2>Guidance</h2>
        <p className="bay-intro">
          The first stage flies open loop: straight up to clear the tower, a small pitch kick, then a gravity turn where the
          nose follows the velocity vector and gravity bends the path over. Upper stages steer closed loop to the target orbit.
        </p>
        <NumField label="Vertical rise" hint="Time flying straight up before pitching over." value={g.verticalRiseTime} unit="s" min={1} max={60} onChange={(v) => set((gg) => void (gg.verticalRiseTime = v))} />
        <NumField
          label="Pitch kick angle"
          hint="The single biggest trajectory decision. Too small: the rocket climbs too steeply. Too big: it flies flat through thick air."
          value={g.pitchKickAngle}
          unit="°"
          min={0.1}
          max={45}
          onChange={(v) => set((gg) => void (gg.pitchKickAngle = v))}
        />
        <div className="tune">
          <button
            className="btn small"
            disabled={tuning}
            onClick={() => {
              setTuning(true);
              setTimeout(() => {
                const r = tunePitchKick(vehicle);
                setTune(r);
                set((gg) => void (gg.pitchKickAngle = r.kick));
                setTuning(false);
              }, 30);
            }}
          >
            {tuning ? 'Searching 50 trajectories…' : 'Find the best pitch kick'}
          </button>
          <p className="hint">Flies the vehicle across a range of kick angles and keeps the one that reaches orbit with the most propellant left.</p>
          {tune && (
            <div className="tune-chart">
              <Chart
                series={[
                  {
                    label: 'Propellant left at cutoff',
                    x: tune.sweep.map((p) => p.kick),
                    y: tune.sweep.map((p) => (p.outcome === 'orbit' || p.outcome === 'low-orbit' ? p.margin / 1000 : NaN)),
                  },
                ]}
                markers={[{ x: tune.kick, label: `Best ${tune.kick.toFixed(2)}°` }]}
                xLabel="Pitch kick (°)"
                yLabel="Margin (t)"
                height={220}
              />
              <p className="hint">Gaps are kick angles that don't reach orbit at all.</p>
            </div>
          )}
        </div>
        <NumField label="Pitch kick duration" value={g.pitchKickDuration} unit="s" min={1} max={60} onChange={(v) => set((gg) => void (gg.pitchKickDuration = v))} />
        <NumField label="Target orbit altitude" value={g.targetAltitude} scale={0.001} unit="km" min={120} max={2000} onChange={(v) => set((gg) => void (gg.targetAltitude = v))} />
        <NumField
          label="Target inclination"
          hint="Angle between the orbit and the equator. You can't launch directly into an inclination lower than your latitude."
          value={g.targetInclination}
          unit="°"
          min={0}
          max={180}
          onChange={(v) => set((gg) => void (gg.targetInclination = v))}
        />
        <NumField
          label="Throttle bucket starts at"
          hint="When dynamic pressure passes this value the first stage throttles down to protect the structure through max-Q."
          value={g.qBucketStart}
          scale={0.001}
          unit="kPa"
          min={1}
          max={1e6}
          onChange={(v) => set((gg) => void (gg.qBucketStart = v))}
        />
        <NumField label="Throttle in the bucket" value={g.qBucketThrottle} scale={100} unit="%" min={30} max={100} onChange={(v) => set((gg) => void (gg.qBucketThrottle = v))} />
        <NumField label="Acceleration limit" hint="Throttles back late in each burn as the stage gets light. Protects payload and crew." value={g.maxAxialG} unit="g" min={1.5} max={15} onChange={(v) => set((gg) => void (gg.maxAxialG = v))} />
        <NumField label="Coast before separation" value={g.separationCoast} unit="s" min={0} max={30} onChange={(v) => set((gg) => void (gg.separationCoast = v))} />
        <NumField label="Upper-stage ignition delay" hint="Time after separation for clearance and propellant settling (ullage)." value={g.ignitionDelay} unit="s" min={0} max={60} onChange={(v) => set((gg) => void (gg.ignitionDelay = v))} />
      </div>
      <aside className="bay-derived">
        <h3>What this means</h3>
        <dl>
          <Derived
            label="Launch azimuth"
            value={((az + 360) % 360).toFixed(1)}
            unit="° from north"
            warn={!feasible}
            note={feasible ? 'Already corrected for the eastward speed the pad gets from Earth’s rotation.' : `Inclination below the site latitude (${Math.abs(vehicle.site.lat).toFixed(1)}°) needs a dogleg or a plane change. The vehicle will fly due east instead.`}
          />
          <Derived label="Circular speed at target" value={vc.toFixed(0)} unit="m/s" note="v = √(μ/r)" />
          <Derived label="Orbital period" value={((2 * Math.PI * Math.sqrt(rT ** 3 / MU_EARTH)) / 60).toFixed(1)} unit="min" />
        </dl>
      </aside>
    </>
  );
}

export function SiteSection() {
  const { vehicle, update } = useSim();
  const s = vehicle.site;
  const boost = OMEGA_EARTH * R_EQ * Math.cos(s.lat * DEG);
  const siteKey = Object.entries(SITES).find(([, v]) => v.name === s.name)?.[0] ?? 'custom';
  return (
    <>
      <div className="bay-form">
        <h2>Launch site</h2>
        <p className="bay-intro">
          Earth turns east at 465 m/s at the equator. A rocket launched eastward keeps that speed for free, which is why
          spaceports sit near the equator with ocean to the east.
        </p>
        <SelectField
          label="Spaceport"
          value={siteKey}
          options={[...Object.entries(SITES).map(([k, v]) => ({ value: k, label: v.name })), { value: 'custom', label: 'Custom coordinates' }]}
          onChange={(k) => {
            if (k !== 'custom') update((veh) => void (veh.site = { ...SITES[k] }));
          }}
        />
        <NumField label="Latitude" value={s.lat} unit="°" min={-89} max={89} onChange={(v) => update((veh) => void (veh.site = { ...veh.site, lat: v, name: 'Custom site' }))} />
        <NumField label="Longitude" value={s.lon} unit="°" min={-180} max={180} onChange={(v) => update((veh) => void (veh.site = { ...veh.site, lon: v, name: 'Custom site' }))} />
        <NumField label="Elevation" value={s.elevation} unit="m" min={-100} max={5000} onChange={(v) => update((veh) => void (veh.site = { ...veh.site, elevation: v }))} />
      </div>
      <aside className="bay-derived">
        <h3>What this means</h3>
        <dl>
          <Derived label="Free speed from Earth’s rotation" value={boost.toFixed(0)} unit="m/s" note="ω·R·cos(latitude), eastward." />
          <Derived label="Lowest inclination reachable directly" value={Math.abs(s.lat).toFixed(1)} unit="°" />
          <Derived label="Surface pressure" value={(atmosphere(s.elevation).p / 1000).toFixed(1)} unit="kPa" note={`${((atmosphere(s.elevation).p / P0) * 100).toFixed(1)} % of sea level`} />
        </dl>
      </aside>
    </>
  );
}
