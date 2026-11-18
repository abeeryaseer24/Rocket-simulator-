import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPERSIONS, maxPayload, monteCarloRun, rng, stats } from './analysis';
import { PRESETS } from './presets';

describe('dispersion analysis', () => {
  it('PRNG is reproducible and roughly standard normal', () => {
    const a = rng(42);
    const b = rng(42);
    const xs = Array.from({ length: 4000 }, () => a.normal());
    expect(b.normal()).toBe(xs[0]);
    const s = stats(xs);
    expect(Math.abs(s.mean)).toBeLessThan(0.06);
    expect(Math.abs(s.sd - 1)).toBeLessThan(0.05);
  });
  it('same seed and index reproduce the same run', () => {
    const r1 = monteCarloRun(PRESETS[0], DEFAULT_DISPERSIONS, 7, 3);
    const r2 = monteCarloRun(PRESETS[0], DEFAULT_DISPERSIONS, 7, 3);
    expect(r1).toEqual(r2);
  });
});

describe('payload capacity', () => {
  it('medium-lift vehicle carries more than its reference payload to 300 km, less to 800 km', () => {
    const p300 = maxPayload(PRESETS[0], 300e3, 8);
    const p800 = maxPayload(PRESETS[0], 800e3, 8);
    expect(p300).toBeGreaterThan(PRESETS[0].payloadMass);
    expect(p800).toBeLessThan(p300);
  }, 60000);
});
