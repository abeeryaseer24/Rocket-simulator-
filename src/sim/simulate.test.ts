import { describe, expect, it } from 'vitest';
import { PRESETS } from './presets';
import { launchAzimuth, simulate } from './simulate';
import { cloneVehicle } from './vehicle';
import { RAD } from '../physics/constants';

describe('ascent simulation', () => {
  it.each(PRESETS.map((p) => [p.name, p] as const))('%s reaches a stable orbit', (_n, preset) => {
    const res = simulate(preset);
    const f = res.final!;
    console.log(
      preset.name,
      res.outcome,
      `peri ${(f?.peri / 1e3).toFixed(0)} apo ${(f?.apo / 1e3).toFixed(0)} i ${(f?.i * RAD).toFixed(2)}`,
      `maxQ ${(res.maxQ.q / 1e3).toFixed(1)}kPa@${res.maxQ.t.toFixed(0)}s maxG ${res.maxG.g.toFixed(2)}`,
      `dv ${res.totals.dvIdeal.toFixed(0)} grav ${res.totals.lossGravity.toFixed(0)} drag ${res.totals.lossDrag.toFixed(0)} steer ${res.totals.lossSteering.toFixed(0)}`,
      `${res.computeMs.toFixed(0)}ms`,
      res.events.map((e) => `${e.kind}@${e.t.toFixed(0)}`).join(' '),
    );
    expect(res.outcome).toBe('orbit');
    expect(f.peri).toBeGreaterThan(preset.guidance.targetAltitude * 0.75);
    expect(Math.abs(f.i * RAD - preset.guidance.targetInclination)).toBeLessThan(2.5);
  });

  it('refuses to lift off with T/W below 1', () => {
    const v = cloneVehicle(PRESETS[0]);
    v.payloadMass = 600000;
    expect(simulate(v).outcome).toBe('no-liftoff');
  });

  it('rotating-Earth azimuth correction points due east for i = latitude', () => {
    expect(launchAzimuth(28.5, 28.5, 200e3) * RAD).toBeCloseTo(90, 0);
  });

  it('removing most of the upper-stage propellant leaves the vehicle suborbital', () => {
    const v = cloneVehicle(PRESETS[0]);
    v.stages[1].propMass *= 0.3;
    expect(['suborbital', 'impact']).toContain(simulate(v).outcome);
  });
});
