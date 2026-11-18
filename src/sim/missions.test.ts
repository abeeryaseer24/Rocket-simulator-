import { describe, expect, it } from 'vitest';
import { MISSIONS, runMission } from './missions';
import { PRESETS } from './presets';

const byId = (id: string) => MISSIONS.find((m) => m.id === id)!;
const preset = (id: string) => PRESETS.find((p) => p.id === id)!;

describe('missions', () => {
  it('first orbit passes with the reference medium-lift vehicle', () => {
    expect(runMission(preset('medium-kerolox'), byId('first-orbit')).passed).toBe(true);
  });
  it('engine-out mission actually injects the failure', () => {
    const r = runMission(preset('medium-kerolox'), byId('engine-out'));
    expect(r.result.events.some((e) => e.kind === 'engine-out')).toBe(true);
  });
  it('heavy lifter fails with a 30 t payload (requirement is 50 t)', () => {
    const r = runMission(preset('heavy-tri-core'), byId('heavy'));
    expect(r.passed).toBe(false);
    expect(r.checks.find((c) => c.label.startsWith('Payload'))!.ok).toBe(false);
  });
  it('every mission evaluates without throwing for every preset', () => {
    for (const m of MISSIONS) for (const p of PRESETS) expect(() => runMission(p, m)).not.toThrow();
  }, 120000);
});
