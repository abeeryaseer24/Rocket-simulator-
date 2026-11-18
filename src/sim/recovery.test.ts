import { describe, expect, it } from 'vitest';
import { PRESETS } from './presets';
import { simulate } from './simulate';
import { cloneVehicle, DEFAULT_RECOVERY } from './vehicle';

describe('first-stage recovery', () => {
  it('reference vehicle reaches orbit and lands its booster on the droneship', () => {
    const r = simulate(PRESETS[0], { dt: 0.05, coastAfterCutoff: 1 });
    expect(r.outcome).toBe('orbit');
    expect(r.recovery?.success).toBe(true);
    expect(r.recovery!.touchdown!.vVert).toBeLessThan(6);
    expect(r.recovery!.events.map((e) => e.label)).toEqual(expect.arrayContaining(['Entry burn', 'Landing burn', 'Touchdown']));
  }, 60000);
  it('return to launch site needs a bigger reserve, lands near the pad, and costs payload', () => {
    const v = cloneVehicle(PRESETS[0]);
    v.payloadMass = 9000;
    v.recovery = { ...DEFAULT_RECOVERY, enabled: true, mode: 'rtls', reserveFraction: 0.16 };
    const r = simulate(v, { dt: 0.05, coastAfterCutoff: 1 });
    expect(r.outcome).toBe('orbit');
    expect(r.recovery?.success).toBe(true);
    expect(r.recovery!.touchdown!.miss).toBeLessThan(60);
    expect(r.recovery!.events.some((e) => e.label === 'Boostback burn')).toBe(true);
  }, 60000);
  it('holding back propellant reduces ascent margin', () => {
    const off = cloneVehicle(PRESETS[0]);
    off.recovery = { ...DEFAULT_RECOVERY, enabled: false };
    const a = simulate(off, { dt: 0.05, coastAfterCutoff: 1 });
    const b = simulate(PRESETS[0], { dt: 0.05, coastAfterCutoff: 1 });
    expect(b.margin).toBeLessThan(a.margin);
    expect(a.recovery).toBeNull();
  }, 60000);
});
