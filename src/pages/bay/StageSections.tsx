import Chart from '../../components/Chart';
import { Derived, NumField, SelectField, TextField } from '../../components/Field';
import { atmosphere } from '../../physics/atmosphere';
import { G0, P0 } from '../../physics/constants';
import { ispAt, massFlow, PROPELLANTS, thrustAt, type PropellantKind } from '../../physics/propulsion';
import { analyse, cloneVehicle } from '../../sim/vehicle';
import { useSim } from '../../sim/store';

const PROP_KINDS = Object.keys(PROPELLANTS) as PropellantKind[];

function StagePicker({ idx, setIdx, allowEdit }: { idx: number; setIdx: (i: number) => void; allowEdit?: boolean }) {
  const { vehicle, update } = useSim();
  return (
    <div className="picker" role="tablist" aria-label="Stage">
      {vehicle.stages.map((s, i) => (
        <button key={i} role="tab" aria-selected={i === idx} className={i === idx ? 'on' : ''} onClick={() => setIdx(i)}>
          {s.name}
        </button>
      ))}
      {allowEdit && vehicle.stages.length < 4 && (
        <button
          className="add"
          onClick={() => {
            update((v) => {
              const top = cloneVehicle(v).stages[v.stages.length - 1];
              top.name = `Stage ${v.stages.length + 1}`;
              top.dryMass *= 0.3;
              top.propMass *= 0.3;
              top.length *= 0.6;
              top.engine.count = 1;
              top.engine.thrustVac *= 0.3;
              v.stages.push(top);
            });
            setIdx(vehicle.stages.length);
          }}
        >
          Add a stage on top
        </button>
      )}
      {allowEdit && vehicle.stages.length > 1 && (
        <button
          className="add"
          onClick={() => {
            update((v) => void v.stages.pop());
            setIdx(Math.max(0, idx - 1));
          }}
        >
          Remove top stage
        </button>
      )}
    </div>
  );
}

export function StagesSection({ idx, setIdx }: { idx: number; setIdx: (i: number) => void }) {
  const { vehicle, update } = useSim();
  const s = vehicle.stages[idx];
  const a = analyse(vehicle)[idx];
  const set = (mut: (st: typeof s) => void) => update((v) => mut(v.stages[idx]));
  const capacity = Math.PI * (s.diameter / 2) ** 2 * s.length * 0.82;
  const fits = a.tanks.total <= capacity;
  const totalDv = analyse(vehicle).reduce((acc, x) => acc + x.dvVacuum, 0);

  return (
    <>
      <div className="bay-form">
        <h2>Stages</h2>
        <p className="bay-intro">
          A stage is a tank, an engine and the structure that holds them. When its propellant runs out the whole thing is
          thrown away, so the stages above never pay to accelerate empty tanks.
        </p>
        <StagePicker idx={idx} setIdx={setIdx} allowEdit />
        <TextField label="Name" value={s.name} onChange={(v) => set((st) => void (st.name = v))} />
        <NumField
          label="Dry mass"
          hint="Everything except usable propellant: tanks, engines, avionics, interstage, residual propellant."
          value={s.dryMass}
          scale={0.001}
          unit="t"
          min={0.01}
          onChange={(v) => set((st) => void (st.dryMass = v))}
        />
        <NumField
          label="Propellant mass"
          hint="Usable fuel plus oxidiser loaded at liftoff."
          value={s.propMass}
          scale={0.001}
          unit="t"
          min={0.01}
          onChange={(v) => set((st) => void (st.propMass = v))}
        />
        <SelectField
          label="Propellant"
          hint={PROPELLANTS[s.propellant].note}
          value={s.propellant}
          options={PROP_KINDS}
          onChange={(v) => set((st) => {
            st.propellant = v;
            st.mixtureRatio = PROPELLANTS[v].of;
          })}
        />
        {s.propellant !== 'Solid (HTPB/AP)' && (
          <NumField
            label="Mixture ratio (O/F)"
            hint="Oxidiser mass per unit fuel mass. Engines run fuel-rich of stoichiometric: lighter exhaust molecules give higher exhaust velocity."
            value={s.mixtureRatio}
            min={0.5}
            max={10}
            onChange={(v) => set((st) => void (st.mixtureRatio = v))}
          />
        )}
        <NumField label="Diameter" value={s.diameter} unit="m" min={0.3} max={20} onChange={(v) => set((st) => void (st.diameter = v))} />
        <NumField label="Length" value={s.length} unit="m" min={0.5} max={150} onChange={(v) => set((st) => void (st.length = v))} />
      </div>
      <aside className="bay-derived">
        <h3>What this means</h3>
        <dl>
          <Derived
            label="Ideal Δv, this stage (vacuum)"
            value={a.dvVacuum.toFixed(0)}
            unit="m/s"
            note={
              <>
                Δv = Isp·g₀·ln(m₀/m<sub>f</sub>) = {a.ispVac.toFixed(0)} × 9.81 × ln({a.massRatio.toFixed(2)})
              </>
            }
          />
          <Derived label="Whole vehicle, all stages" value={totalDv.toFixed(0)} unit="m/s" note="Low Earth orbit needs about 7,800 m/s plus 1,500–2,000 m/s of losses." />
          <Derived label="Mass ratio (ignition ÷ burnout mass)" value={a.massRatio.toFixed(2)} note="Mass at ignition (this stage and everything above) over mass at burnout." />
          <Derived label="Structural ratio" value={(a.structuralRatio * 100).toFixed(1)} unit="%" note="Dry ÷ wet mass. Good kerosene stages are about 5 %; hydrogen stages run higher because the tanks are huge." />
          <Derived label="Burn time at full throttle" value={a.burnTime.toFixed(0)} unit="s" />
          <Derived label="Thrust-to-weight at ignition" value={a.twIgnition.toFixed(2)} warn={idx === 0 && a.twIgnition < 1.15} note={idx === 0 ? 'First stage must exceed 1.0 to leave the pad; 1.2–1.5 is typical.' : 'Upper stages can be below 1: they are already moving sideways fast.'} />
          <Derived
            label="Tank volume needed"
            value={a.tanks.total.toFixed(1)}
            unit="m³"
            warn={!fits}
            note={
              fits
                ? `Fits: ${a.tanks.ox.toFixed(1)} m³ oxidiser + ${a.tanks.fuel.toFixed(1)} m³ fuel inside a ${capacity.toFixed(0)} m³ envelope.`
                : `Does not fit: the stage envelope holds about ${capacity.toFixed(0)} m³. Make it longer or wider.`
            }
          />
          <Derived label="Bulk propellant density" value={a.tanks.bulkDensity.toFixed(0)} unit="kg/m³" />
        </dl>
      </aside>
    </>
  );
}

export function EnginesSection({ idx, setIdx }: { idx: number; setIdx: (i: number) => void }) {
  const { vehicle, update } = useSim();
  const s = vehicle.stages[idx];
  const e = s.engine;
  const set = (mut: (en: typeof e) => void) => update((v) => mut(v.stages[idx].engine));
  const mdot1 = massFlow({ ...e, count: 1 });
  const fSL = thrustAt({ ...e, count: 1 }, P0);
  const throat = e.exitArea / Math.max(e.expansionRatio, 1);
  const cf = e.thrustVac / (e.chamberPressure * 1e5 * throat);
  const exitD = 2 * Math.sqrt(e.exitArea / Math.PI);
  const fit = e.count * e.exitArea <= 0.95 * Math.PI * (s.diameter / 2) ** 2;
  const alts = Array.from({ length: 81 }, (_, i) => i * 1.25);
  const thrustCurve = alts.map((km) => thrustAt({ ...e, count: 1 }, atmosphere(km * 1000).p) / 1000);
  const ispCurve = alts.map((km) => ispAt(e, atmosphere(km * 1000).p));

  return (
    <>
      <div className="bay-form">
        <h2>Engines</h2>
        <p className="bay-intro">
          Thrust is F = ṁ·v<sub>e</sub> + (p<sub>e</sub> − p<sub>a</sub>)·A<sub>e</sub>. Air pressing on the nozzle exit pushes
          back, so every engine gains thrust as it climbs. Sea-level figures are worked out from the vacuum figures here; you
          don't enter them.
        </p>
        <StagePicker idx={idx} setIdx={setIdx} />
        <TextField label="Engine name" value={e.name} onChange={(v) => set((en) => void (en.name = v))} />
        <NumField label="Number of engines" value={e.count} step={1} min={1} max={40} onChange={(v) => set((en) => void (en.count = Math.round(v)))} />
        <NumField
          label="Vacuum thrust, each"
          hint="Thrust with zero outside pressure."
          value={e.thrustVac}
          scale={0.001}
          unit="kN"
          min={0.1}
          onChange={(v) => set((en) => void (en.thrustVac = v))}
        />
        <NumField
          label="Vacuum specific impulse"
          hint="Seconds of thrust per unit weight of propellant. Exhaust velocity is Isp × g₀."
          value={e.ispVac}
          unit="s"
          min={100}
          max={500}
          onChange={(v) => set((en) => void (en.ispVac = v))}
        />
        <NumField
          label="Nozzle exit area, each"
          hint="A bigger bell expands the gas further (more vacuum Isp) but loses more thrust to air pressure at sea level."
          value={e.exitArea}
          unit="m²"
          min={0.0001}
          onChange={(v) => set((en) => void (en.exitArea = v))}
        />
        <NumField label="Minimum throttle" value={e.throttleMin} scale={100} unit="%" min={10} max={100} onChange={(v) => set((en) => void (en.throttleMin = v))} />
        <NumField label="Chamber pressure" hint="Used to size the throat. Higher pressure means a smaller, lighter engine for the same thrust." value={e.chamberPressure} unit="bar" min={1} max={400} onChange={(v) => set((en) => void (en.chamberPressure = v))} />
        <NumField label="Expansion ratio Aₑ/Aₜ" value={e.expansionRatio} min={2} max={400} onChange={(v) => set((en) => void (en.expansionRatio = v))} />
        <TextField label="Power cycle" hint="How propellant is pumped: gas generator, staged combustion, expander, electric pump, pressure-fed or solid grain." value={e.cycle} onChange={(v) => set((en) => void (en.cycle = v))} />
      </div>
      <aside className="bay-derived">
        <h3>What this means</h3>
        <dl>
          <Derived label="Sea-level thrust, each" value={(fSL / 1000).toFixed(0)} unit="kN" note={`F_vac − p₀·Aₑ = ${(e.thrustVac / 1000).toFixed(0)} − ${((P0 * e.exitArea) / 1000).toFixed(0)}`} warn={fSL <= 0} />
          <Derived label="Sea-level specific impulse" value={ispAt(e, P0).toFixed(0)} unit="s" />
          <Derived label="Mass flow, each" value={mdot1.toFixed(1)} unit="kg/s" note={`Stage total ${(mdot1 * e.count).toFixed(0)} kg/s`} />
          <Derived label="Exhaust velocity" value={(e.ispVac * G0).toFixed(0)} unit="m/s" />
          <Derived label="Nozzle exit diameter" value={exitD.toFixed(2)} unit="m" warn={!fit} note={fit ? undefined : `${e.count} bells this size don't fit under a ${s.diameter} m stage.`} />
          <Derived label="Throat area" value={(throat * 1e4).toFixed(0)} unit="cm²" />
          <Derived label="Vacuum thrust coefficient" value={cf.toFixed(2)} note="F / (p_c·Aₜ). Real nozzles land between 1.6 and 2.0; outside that, an input is probably off." warn={cf < 1.3 || cf > 2.2} />
        </dl>
        <div className="bay-mini">
          <h3>Thrust per engine vs altitude</h3>
          <Chart series={[{ label: 'Thrust', x: alts, y: thrustCurve }]} xLabel="Altitude (km)" yLabel="kN" height={200} />
          <h3>Specific impulse vs altitude</h3>
          <Chart series={[{ label: 'Isp', x: alts, y: ispCurve, color: 1 }]} xLabel="Altitude (km)" yLabel="s" height={200} />
        </div>
      </aside>
    </>
  );
}
