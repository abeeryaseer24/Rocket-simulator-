/**
 * Axial aerodynamics. At zero angle of attack (gravity turn) the only force
 * that matters is drag along the velocity vector:
 *   D = ½ ρ v² · C_D(M) · A_ref = q · C_D · A_ref
 * C_D is strongly Mach-dependent: it climbs steeply through the transonic
 * regime (shock formation) and decays slowly in hypersonic flow.
 */

export type CdTable = Array<[mach: number, cd: number]>;

export const DEFAULT_CD: CdTable = [
  [0.0, 0.3],
  [0.6, 0.28],
  [0.8, 0.32],
  [0.95, 0.42],
  [1.05, 0.52],
  [1.2, 0.5],
  [1.5, 0.44],
  [2.0, 0.37],
  [3.0, 0.3],
  [5.0, 0.25],
  [10.0, 0.22],
];

export function cdAt(table: CdTable, mach: number): number {
  if (table.length === 0) return 0;
  if (mach <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (mach <= table[i][0]) {
      const [m0, c0] = table[i - 1];
      const [m1, c1] = table[i];
      return c0 + ((c1 - c0) * (mach - m0)) / (m1 - m0);
    }
  }
  return table[table.length - 1][1];
}

/**
 * Sutton–Graves stagnation-point convective heat flux [W/m²]:
 *   q̇ = k · √(ρ / r_n) · v³,  k = 1.7415e-4 for Earth air (SI units)
 * r_n is the nose radius. Blunter noses (larger r_n) heat *less*.
 */
export const suttonGraves = (rho: number, v: number, noseRadius: number): number =>
  1.7415e-4 * Math.sqrt(Math.max(rho, 0) / Math.max(noseRadius, 0.05)) * v * v * v;

export const circleArea = (d: number): number => (Math.PI * d * d) / 4;
