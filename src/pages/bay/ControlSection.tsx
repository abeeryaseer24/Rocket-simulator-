import { Derived, NumField, SelectField } from '../../components/Field';
import { DEG } from '../../physics/constants';
import { DEFAULT_CONTROL, massProps } from '../../sim/attitude';
import { useSim } from '../../sim/store';
import { liftoffThrust } from '../../sim/vehicle';

export function ControlSection() {
  const { vehicle, update } = useSim();
  const c = { ...DEFAULT_CONTROL, ...(vehicle.control ?? {}) };
  const set = (mut: (x: typeof c) => void) =>
    update((v) => {
      const next = { ...DEFAULT_CONTROL, ...(v.control ?? {}) };
      mut(next);
      v.control = next;
    });
  const mp = massProps(vehicle, 0, vehicle.stages.map((s) => s.propMass), vehicle.boosters.count > 0, vehicle.boosters.stage.propMass, true);
  // Static margin, calibers: positive when the CP sits behind the CG (measured from the nose), i.e. stable
  const margin = (mp.xcp - mp.xcg) / Math.max(vehicle.stages[0].diameter, vehicle.fairing.diameter);
  const T0 = liftoffThrust(vehicle);
  const tauMax = T0 * (mp.xGimbal - mp.xcg) * Math.sin(c.gimbalMax * DEG);
  const alphaMax = (Math.min(1, tauMax / (30000 * mp.sRef * mp.cna * Math.max(mp.xcg - mp.xcp, 0.1))) * 180) / Math.PI;

  return (
    <>
      <div className="bay-form">
        <h2>Attitude control</h2>
        <p className="bay-intro">
          With this off, thrust points exactly where guidance asks: the classic 3-DOF assumption. Turn it on and the vehicle
          becomes a rigid body with a moment of inertia, a centre of mass that moves as the tanks drain, and air pushing on its
          nose. The engines must gimbal to keep it pointed, through a jet stream.
        </p>
        <SelectField
          label="Simulate attitude and thrust-vector control"
          value={c.enabled ? 'yes' : 'no'}
          options={[
            { value: 'yes', label: 'Yes, rigid body with gimballed engines' },
            { value: 'no', label: 'No, ideal pointing' },
          ]}
          onChange={(x) => set((k) => void (k.enabled = x === 'yes'))}
        />
        {c.enabled && (
          <>
            <NumField
              label="Controller bandwidth"
              hint="How fast the autopilot corrects an attitude error. Too low and it can't keep up with an unstable airframe. Real values are around 1 to 3 rad/s."
              value={c.bandwidth}
              unit="rad/s"
              min={0.1}
              max={10}
              onChange={(x) => set((k) => void (k.bandwidth = x))}
            />
            <NumField label="Damping ratio" hint="0.7 is the textbook choice: fast, with little overshoot." value={c.damping} min={0.05} max={3} onChange={(x) => set((k) => void (k.damping = x))} />
            <NumField label="Gimbal limit" hint="How far the engines can swivel. This caps the steering torque." value={c.gimbalMax} unit="°" min={0.01} max={15} onChange={(x) => set((k) => void (k.gimbalMax = x))} />
            <NumField label="Jet-stream peak wind" value={c.windPeak} unit="m/s" min={0} max={120} onChange={(x) => set((k) => void (k.windPeak = x))} />
            <NumField label="Jet-stream altitude" value={c.windAlt} scale={0.001} unit="km" min={3} max={20} onChange={(x) => set((k) => void (k.windAlt = x))} />
            <NumField
              label="Wind blowing toward"
              hint="Degrees from north. 90 is a tailwind for an eastward launch; 0 or 180 is a crosswind."
              value={c.windToward}
              unit="°"
              min={0}
              max={360}
              onChange={(x) => set((k) => void (k.windToward = x))}
            />
          </>
        )}
      </div>
      <aside className="bay-derived">
        <h3>What this means</h3>
        <dl>
          <Derived label="Centre of mass from the nose" value={mp.xcg.toFixed(1)} unit="m" note="With full tanks. It moves forward as propellant drains from the bottom of each tank." />
          <Derived label="Centre of pressure from the nose" value={mp.xcp.toFixed(1)} unit="m" note="Barrowman estimate: at small angles the nose cone carries nearly all the lift." />
          <Derived
            label="Static margin"
            value={margin.toFixed(1)}
            unit="calibers"
            warn={margin < 0}
            note={
              margin < 0
                ? 'Negative: the centre of pressure is ahead of the centre of mass, so the airframe wants to turn sideways. Only active control keeps it flying.'
                : 'Positive: aerodynamically stable, like an arrow.'
            }
          />
          <Derived label="Moment of inertia, pitch" value={(mp.I / 1e6).toFixed(1)} unit="million kg·m²" />
          <Derived label="Largest angle of attack it can hold at 30 kPa" value={alphaMax.toFixed(1)} unit="°" note="Gimbal torque against the destabilising aero moment. Gusts beyond this are unrecoverable." />
        </dl>
      </aside>
    </>
  );
}
