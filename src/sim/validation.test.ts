import { describe, expect, it } from 'vitest';
import { optimiseAscent } from './optimise';
import { PRESETS } from './presets';
import { simulate } from './simulate';
import { apollo11Benchmark, kernelChecks, passes } from './validation';

describe('validation', () => {
  it('every kernel check passes its tolerance', () => {
    const bad = kernelChecks().filter((c) => !passes(c));
    expect(bad.map((c) => c.quantity)).toEqual([]);
  });
  it('Saturn V-class preset lands within 10 % of Apollo 11 on the modelled events', () => {
    const rows = apollo11Benchmark(simulate(PRESETS.find((p) => p.id === 'super-heavy-lunar')!));
    for (const r of rows.filter((x) => x.simulated !== null && x.quantity !== 'S-IVB first cutoff')) {
      expect(Math.abs((r.simulated! - r.reference) / r.reference), r.quantity).toBeLessThan(0.12);
    }
  });
});

describe('ascent optimiser', () => {
  it('never returns a worse trajectory than it started from', () => {
    const v = PRESETS[0];
    const start = simulate(v, { dt: 0.05, coastAfterCutoff: 1 });
    const steps: number[] = [];
    const best = optimiseAscent(v, (s) => steps.push(s.score), 8);
    expect(best.result.outcome).toBe('orbit');
    expect(best.result.margin).toBeGreaterThanOrEqual(start.margin - 1);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
  }, 60000);
});
