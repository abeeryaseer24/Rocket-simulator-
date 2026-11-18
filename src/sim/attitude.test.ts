import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTROL, massProps } from './attitude';
import { PRESETS } from './presets';
import { simulate } from './simulate';
import { cloneVehicle } from './vehicle';

const v0 = PRESETS[0];
const withControl = (patch: Partial<typeof DEFAULT_CONTROL> = {}) => {
  const v = cloneVehicle(v0);
  v.control = { ...DEFAULT_CONTROL, enabled: true, ...patch };
  return v;
};

describe('mass properties', () => {
  it('CG moves toward the nose as the first stage drains', () => {
    const full = massProps(v0, 0, v0.stages.map((s) => s.propMass), false, 0, true);
    const low = massProps(v0, 0, [v0.stages[0].propMass * 0.1, v0.stages[1].propMass], false, 0, true);
    expect(low.xcg).toBeLessThan(full.xcg);
    expect(low.I).toBeLessThan(full.I * 1.5);
  });
  it('a finless rocket has its centre of pressure ahead of its CG (statically unstable)', () => {
    const mp = massProps(v0, 0, v0.stages.map((s) => s.propMass), false, 0, true);
    expect(mp.xcp).toBeLessThan(mp.xcg);
  });
});

describe('thrust-vector control', () => {
  it('controlled vehicle flying through a jet stream still reaches orbit, within its gimbal limit', () => {
    const r = simulate(withControl(), { dt: 0.02, coastAfterCutoff: 1 });
    expect(r.outcome).toBe('orbit');
    const maxGimbal = Math.max(...r.samples.map((s) => s.gimbal));
    expect(maxGimbal).toBeLessThanOrEqual(DEFAULT_CONTROL.gimbalMax + 1e-6);
    expect(maxGimbal).toBeGreaterThan(0);
  }, 60000);
  it('wind raises the peak bending load (q·α) compared with still air', () => {
    const calm = simulate(withControl({ windPeak: 0 }), { dt: 0.02, coastAfterCutoff: 1 });
    const windy = simulate(withControl({ windPeak: 60 }), { dt: 0.02, coastAfterCutoff: 1 });
    const peak = (r: typeof calm) => Math.max(...r.samples.filter((s) => s.alt < 40000).map((s) => s.qAlpha));
    expect(peak(windy)).toBeGreaterThan(peak(calm));
  }, 60000);
  it('with almost no gimbal authority the unstable airframe diverges', () => {
    const r = simulate(withControl({ gimbalMax: 0.05, windPeak: 60 }), { dt: 0.02, coastAfterCutoff: 1 });
    const maxErr = Math.max(...r.samples.filter((s) => s.t < 150).map((s) => s.attErr));
    expect(maxErr).toBeGreaterThan(10);
  }, 60000);
});
