import { describe, expect, it } from 'vitest';
import { BODIES, bodyFacts, elements2d, flyWorld, marsAtmosphere, stars, WORLD_ROCKETS } from './worlds';

const body = (id: string) => BODIES.find((b) => b.id === id)!;
const rocket = (id: string) => WORLD_ROCKETS.find((r) => r.id === id)!;

describe('other worlds', () => {
  it('derives textbook surface gravity and orbital speeds', () => {
    expect(bodyFacts(body('moon')).g).toBeCloseTo(1.62, 2);
    expect(bodyFacts(body('mars')).g).toBeCloseTo(3.73, 1);
    expect(bodyFacts(body('moon')).vEscape).toBeCloseTo(2376, -1);
    expect(bodyFacts(body('mars')).vEscape).toBeCloseTo(5027, -1);
  });
  it('Mars atmosphere follows the NASA Glenn fit', () => {
    const s = marsAtmosphere(0);
    expect(s.p).toBeCloseTo(699, 0);
    expect(s.rho).toBeCloseTo(0.699 / (0.1921 * 242.1), 4);
    expect(marsAtmosphere(20000).p).toBeLessThan(s.p * 0.2);
  });
  it('two-body elements: circular state has equal apsides', () => {
    const b = body('moon');
    const r = b.radius + 100e3;
    const el = elements2d(b.mu, b.radius, r, 0, 0, Math.sqrt(b.mu / r));
    expect(el.e).toBeLessThan(1e-6);
    expect(el.apo).toBeCloseTo(100e3, 0);
  });
  it.each(WORLD_ROCKETS.map((r) => [r.id]))('%s reaches a 3-star orbit from its home world with the default plan', (id) => {
    const r = rocket(id);
    const res = flyWorld(body(r.home), r, r.plan);
    expect(res.outcome).toBe('orbit');
    expect(stars(res)).toBe(3);
    expect(res.peri).toBeGreaterThanOrEqual(body(r.home).minPeri);
  });
  it('the lunar module cannot lift off on Mars or Earth', () => {
    expect(flyWorld(body('mars'), rocket('lm-ascent'), rocket('lm-ascent').plan).outcome).toBe('grounded');
    expect(flyWorld(body('earth'), rocket('lm-ascent'), rocket('lm-ascent').plan).outcome).toBe('grounded');
  });
  it('a Mars ascent vehicle cannot reach Earth orbit', () => {
    expect(flyWorld(body('earth'), rocket('mav'), rocket('mav').plan).outcome).not.toBe('orbit');
  });
  it('samples are time-ordered and never below the surface before impact', () => {
    const r = rocket('mav');
    const res = flyWorld(body('mars'), r, r.plan);
    for (let i = 1; i < res.samples.length; i++) expect(res.samples[i].t).toBeGreaterThanOrEqual(res.samples[i - 1].t);
    expect(Math.min(...res.samples.map((s) => s.alt))).toBeGreaterThan(-1);
  });
});
