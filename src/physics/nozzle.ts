/**
 * Quasi-1D isentropic nozzle flow.
 *
 * Area–Mach relation (A/A* as a function of exit Mach M and γ):
 *   A/A* = (1/M) · [ (2/(γ+1)) · (1 + (γ−1)/2 · M²) ]^((γ+1)/(2(γ−1)))
 * Inverted numerically on the supersonic branch, then
 *   p_e / p_c = (1 + (γ−1)/2 · M_e²)^(−γ/(γ−1))
 */
export function areaRatio(M: number, g: number): number {
  return (1 / M) * Math.pow((2 / (g + 1)) * (1 + ((g - 1) / 2) * M * M), (g + 1) / (2 * (g - 1)));
}

/** Supersonic exit Mach number for a given expansion ratio. */
export function exitMach(eps: number, g = 1.2): number {
  let lo = 1.0001;
  let hi = 50;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (areaRatio(mid, g) < eps) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export const pressureRatio = (M: number, g = 1.2): number => Math.pow(1 + ((g - 1) / 2) * M * M, -g / (g - 1));

/** Exit pressure [Pa] from chamber pressure [Pa] and expansion ratio. */
export const exitPressure = (pc: number, eps: number, g = 1.2): number => pc * pressureRatio(exitMach(eps, g), g);
