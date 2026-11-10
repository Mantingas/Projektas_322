export interface Desc {
  n: number;
  sum: number;
  mean: number;
  sd: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

/** Linear-interpolation quantile (R type 7) on a sorted array. */
export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (h - lo);
}

export function describe(values: number[]): Desc | null {
  const n = values.length;
  if (!n) return null;
  const s = [...values].sort((a, b) => a - b);
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let ss = 0;
  for (const v of values) ss += (v - mean) ** 2;
  return { n, sum, mean, sd: n > 1 ? Math.sqrt(ss / (n - 1)) : 0, min: s[0]!, q1: quantile(s, 0.25), median: quantile(s, 0.5), q3: quantile(s, 0.75), max: s[n - 1]! };
}

export function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]!; my += y[i]!; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = x[i]! - mx, b = y[i]! - my; sxy += a * b; sxx += a * a; syy += b * b; }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Average ranks (ties share the mean rank). */
export function ranks(v: number[]): number[] {
  const idx = v.map((_, i) => i).sort((a, b) => v[a]! - v[b]!);
  const r = new Array<number>(v.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && v[idx[j + 1]!] === v[idx[i]!]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]!] = avg;
    i = j + 1;
  }
  return r;
}
export const spearman = (x: number[], y: number[]) => pearson(ranks(x), ranks(y));

const erf = (x: number) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
/** Two-sided p-value of a correlation (Fisher z; adequate for n ≥ 30). */
export function corrP(r: number, n: number): number {
  if (n <= 3) return 1;
  const rr = Math.max(-0.999999, Math.min(0.999999, r));
  const z = Math.atanh(rr) * Math.sqrt(n - 3);
  return 2 * (1 - normCdf(Math.abs(z)));
}

/** Histogram with Freedman–Diaconis bins, clamped to 5–30 (integers with a small range use one bin per value). */
export function histogram(values: number[]): { from: number; to: number; count: number }[] {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n < 2) return [];
  const min = s[0]!, max = s[n - 1]!;
  if (min === max) return [{ from: min, to: max, count: n }];
  const distinct = new Set(s).size;
  if (distinct <= 12 && s.every(Number.isInteger)) {
    const m = new Map<number, number>();
    for (const v of s) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].map(([v, c]) => ({ from: v, to: v, count: c }));
  }
  const iqr = quantile(s, 0.75) - quantile(s, 0.25);
  let bins = iqr > 0 ? Math.ceil((max - min) / ((2 * iqr) / Math.cbrt(n))) : Math.ceil(Math.log2(n) + 1);
  bins = Math.max(5, Math.min(30, bins));
  const w = (max - min) / bins;
  const out = Array.from({ length: bins }, (_, i) => ({ from: min + i * w, to: min + (i + 1) * w, count: 0 }));
  for (const v of s) out[Math.min(bins - 1, Math.floor((v - min) / w))]!.count++;
  return out;
}
