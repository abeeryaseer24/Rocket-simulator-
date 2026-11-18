/**
 * Sky colour from local air density. Rayleigh scattering scales with the
 * number of molecules along the line of sight, so log-density is a good
 * single knob: blue at sea level, indigo by 30 km, black above ~80 km.
 * Pure (no three.js) so the homepage can use it without the 3D bundle.
 */
const STOPS: Array<[number, [number, number, number]]> = [
  [0, [0, 0, 0]],
  [0.18, [5, 13, 36]],
  [0.5, [29, 74, 143]],
  [0.8, [93, 147, 209]],
  [1, [156, 196, 234]],
];

/** 0 (space) … 1 (sea-level daylight) */
export const skyBrightness = (rho: number): number =>
  Math.max(0, Math.min(1, 1 + Math.log10(Math.max(rho, 1e-12) / 1.225) / 5));

export function skyRGB(rho: number): [number, number, number] {
  const b = skyBrightness(rho);
  for (let i = 1; i < STOPS.length; i++) {
    if (b <= STOPS[i][0]) {
      const [b0, c0] = STOPS[i - 1];
      const [b1, c1] = STOPS[i];
      const f = (b - b0) / (b1 - b0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export const rgbCss = ([r, g, b]: [number, number, number], a = 1) =>
  `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
