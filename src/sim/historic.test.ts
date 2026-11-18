import { describe, expect, it } from 'vitest';
import { HISTORIC } from './historic';
import { simulate } from './simulate';

describe('historic replicas', () => {
  it.each(HISTORIC.filter((h) => h.build).map((h) => [h.id, h] as const))('%s reaches orbit at the real inclination', (_id, h) => {
    const r = simulate(h.build!());
    expect(r.outcome).toBe('orbit');
    expect(Math.abs((r.final!.i * 180) / Math.PI - h.realOrbit!.inc)).toBeLessThan(0.5);
  }, 30000);
  it('Falcon 9 replica brings its booster home', () => {
    const h = HISTORIC.find((x) => x.id === 'f9-flight-20')!;
    const r = simulate(h.build!());
    expect(r.recovery?.success).toBe(true);
  }, 30000);
});
