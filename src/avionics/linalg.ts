/** Minimal dense linear algebra for small filters (n ≤ ~12). Row-major number[][]. */
export type Mat = number[][];

export const zeros = (r: number, c = r): Mat => Array.from({ length: r }, () => new Array(c).fill(0));
export const eye = (n: number): Mat => zeros(n).map((row, i) => ((row[i] = 1), row));

export function mul(a: Mat, b: Mat): Mat {
  const n = a.length;
  const m = b[0].length;
  const k = b.length;
  const o = zeros(n, m);
  for (let i = 0; i < n; i++)
    for (let p = 0; p < k; p++) {
      const aip = a[i][p];
      if (aip === 0) continue;
      for (let j = 0; j < m; j++) o[i][j] += aip * b[p][j];
    }
  return o;
}

export const transpose = (a: Mat): Mat => a[0].map((_, j) => a.map((r) => r[j]));
export const add = (a: Mat, b: Mat): Mat => a.map((r, i) => r.map((x, j) => x + b[i][j]));
export const sub = (a: Mat, b: Mat): Mat => a.map((r, i) => r.map((x, j) => x - b[i][j]));

/** Gauss–Jordan inverse with partial pivoting. */
export function inv(a: Mat): Mat {
  const n = a.length;
  const m = a.map((r, i) => [...r, ...eye(n)[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c];
    if (Math.abs(d) < 1e-300) throw new Error('singular matrix');
    for (let j = 0; j < 2 * n; j++) m[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c];
      if (f !== 0) for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((r) => r.slice(n));
}

export const matVec = (a: Mat, x: number[]): number[] => a.map((r) => r.reduce((s, v, j) => s + v * x[j], 0));
