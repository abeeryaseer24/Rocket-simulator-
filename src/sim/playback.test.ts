import { describe, expect, it } from 'vitest';
import { PRESETS } from './presets';
import { sampleAt } from './playback';
import { simulate } from './simulate';

describe('playback interpolation', () => {
  const r = simulate(PRESETS[0]);
  const sep = r.events.find((e) => e.kind === 'stage-sep')!;

  it('never produces a fractional stage index across separation', () => {
    for (let t = sep.t - 3; t <= sep.t + 3; t += 0.05) {
      const s = sampleAt(r.samples, t);
      expect(Number.isInteger(s.stage)).toBe(true);
    }
  });

  it('keeps discrete flags discrete', () => {
    for (let t = 0; t < r.samples.at(-1)!.t; t += 0.5) {
      const s = sampleAt(r.samples, t);
      expect(typeof s.boosters).toBe('boolean');
      expect(typeof s.fairing).toBe('boolean');
      expect(typeof s.burning).toBe('boolean');
    }
  });
});
