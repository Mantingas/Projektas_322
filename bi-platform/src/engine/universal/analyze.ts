import { addDays, daysBetween, monthStart, weekStart } from '../analytics/dates';
import { corrP, describe, histogram, pearson, quantile, spearman, type Desc } from './stats';
import { DATE_TYPES, NUMERIC_TYPES, type UCell, type UConfig, type UDataset } from './types';

export const OUTLIER_MIN_N = 20;
export const CORR_MIN_N = 30;
export const CORR_MIN_R = 0.5;
export const CORR_ALPHA = 0.01;
export const MISSING_FLAG = 0.2;
export const CONCENTRATION_FLAG = 0.5;
export const CHANGE_FLAG = 0.2;
export const MIN_BUCKET_ROWS = 3;

export type Granularity = 'day' | 'week' | 'month';
export type Agg = 'sum' | 'mean';

export interface Overview { rows: number; columns: number; missingCells: number; cells: number; missingShare: number; duplicateRows: number; types: Record<string, number> }
export interface ColStat { col: number; header: string; type: string; n: number; missing: number; desc?: Desc; zeros?: number; negatives?: number; top?: { value: string; count: number }[]; min?: string; max?: string; trueShare?: number }
export interface OutlierResult { col: number; header: string; n: number; lowFence: number; highFence: number; low: number; high: number; share: number; examples: { row: number; value: number }[] }
export interface MissingResult { col: number; header: string; missing: number; share: number; invalid: number; firstHalf?: number; secondHalf?: number; shifts: boolean }
export interface DuplicateResult { exactRows: number; groups: { rows: number[] }[]; idColumns: { col: number; header: string; duplicated: number; conflicting: number }[] }
export interface TrendPoint { bucket: string; value: number | null; rows: number; partial: boolean }
export interface TrendResult { col: number; header: string; agg: Agg; granularity: Granularity; points: TrendPoint[]; latest?: { from: string; to: string; change: number; pct: number | null; flagged: boolean } }
export interface Compare { col: number; header: string; agg: Agg; current: { from: string; to: string; value: number | null; rows: number }; previous: { from: string; to: string; value: number | null; rows: number }; change: number | null; pct: number | null }
export interface RankRow { key: string; value: number; rows: number; share: number | null }
export interface RankResult { dim: number; dimHeader: string; measure: number; measureHeader: string; agg: Agg; groups: number; top: RankRow[]; bottom: RankRow[]; topShare: number | null; total: number; negative: boolean }
export interface Distribution { dim: number; header: string; groups: number; rows: { key: string; count: number; share: number }[]; other: number }
export interface Hist { col: number; header: string; bins: { from: number; to: number; count: number }[]; desc: Desc }
/** `outlierSensitive`: the rank correlation is strong but Pearson is not – a few extreme values hide (or fake) the linear relationship. */
export interface Correlation { a: number; b: number; aHeader: string; bHeader: string; n: number; pearson: number; spearman: number; p: number; meaningful: boolean; redundant: boolean; outlierSensitive: boolean }
export interface CrossTab { a: number; b: number; aHeader: string; bHeader: string; aKeys: string[]; bKeys: string[]; cells: number[][]; total: number }

export interface UniversalAnalysis {
  scope: { rows: number; totalRows: number; from?: string; to?: string; filters: number };
  overview: Overview;
  stats: ColStat[];
  outliers: OutlierResult[];
  missing: MissingResult[];
  duplicates: DuplicateResult;
  trends: TrendResult[];
  compare: Compare[];
  compareBlocked?: 'no_date' | 'short_span' | 'no_measure' | 'few_rows';
  ranks: RankResult[];
  distributions: Distribution[];
  hists: Hist[];
  correlations: Correlation[];
  crosstabs: CrossTab[];
  config: Required<Pick<UConfig, 'measures' | 'dims'>> & { dateCol?: number; agg: Record<number, Agg> };
}

const isNum = (v: UCell | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Row indices that satisfy the filters and the date range; every table and chart is built from this ONE set. */
export function selectRows(ds: UDataset, cfg: UConfig): number[] {
  const out: number[] = [];
  const dc = cfg.dateCol;
  for (let i = 0; i < ds.rowCount; i++) {
    let ok = true;
    if (dc !== undefined && (cfg.range?.from || cfg.range?.to)) {
      const d = ds.cols[dc]![i];
      if (typeof d !== 'string') ok = false;
      else {
        const day = d.slice(0, 10);
        if ((cfg.range.from && day < cfg.range.from) || (cfg.range.to && day > cfg.range.to)) ok = false;
      }
    }
    if (ok && cfg.filters) {
      for (const f of cfg.filters) {
        const v = ds.cols[f.col]![i];
        if (f.values && !(v !== null && f.values.includes(String(v)))) { ok = false; break; }
        if (f.min !== undefined && !(isNum(v) && v >= f.min)) { ok = false; break; }
        if (f.max !== undefined && !(isNum(v) && v <= f.max)) { ok = false; break; }
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

export function defaultConfig(ds: UDataset): Required<Pick<UConfig, 'measures' | 'dims'>> & { dateCol?: number; agg: Record<number, Agg> } {
  const dates = ds.columns.filter((c) => DATE_TYPES.includes(c.type) && c.nonEmpty > 0);
  const measures = ds.columns.filter((c) => NUMERIC_TYPES.includes(c.type) && c.nonEmpty > 0).map((c) => c.index);
  const dims = ds.columns.filter((c) => (c.type === 'category' || c.type === 'boolean') && c.distinct >= 2 && c.distinct <= 200).map((c) => c.index);
  const agg: Record<number, Agg> = {};
  for (const m of measures) agg[m] = ds.columns[m]!.type === 'percent' ? 'mean' : 'sum';
  return { dateCol: dates[0]?.index, measures, dims, agg };
}

const bucketOf = (iso: string, g: Granularity) => (g === 'day' ? iso : g === 'week' ? weekStart(iso) : monthStart(iso));
const bucketEnd = (b: string, g: Granularity) => (g === 'day' ? b : g === 'week' ? addDays(b, 6) : addDays(addDays(b, 31).slice(0, 8) + '01', -1).slice(0, 10));

function aggregate(vals: number[], agg: Agg): number | null {
  if (!vals.length) return null;
  let s = 0;
  for (const v of vals) s += v;
  return agg === 'sum' ? s : s / vals.length;
}

export function analyzeUniversal(ds: UDataset, cfgIn: UConfig = {}): UniversalAnalysis {
  const def = defaultConfig(ds);
  const cfg = { ...def, ...cfgIn, measures: cfgIn.measures ?? def.measures, dims: cfgIn.dims ?? def.dims, agg: { ...def.agg, ...(cfgIn.agg ?? {}) } };
  const rows = selectRows(ds, { ...cfgIn, dateCol: cfg.dateCol });
  const n = rows.length;
  const colVals = (c: number) => rows.map((i) => ds.cols[c]![i]!);
  const numbers = (c: number) => { const o: number[] = []; for (const i of rows) { const v = ds.cols[c]![i]; if (isNum(v)) o.push(v); } return o; };

  // overview
  const types: Record<string, number> = {};
  for (const c of ds.columns) types[c.type] = (types[c.type] ?? 0) + 1;
  let missingCells = 0;
  const visible = ds.columns.filter((c) => c.type !== 'empty');
  for (const c of visible) for (const i of rows) if (ds.cols[c.index]![i] === null) missingCells++;
  const cells = n * visible.length;

  // duplicates: exact rows over all typed columns
  const seen = new Map<string, number[]>();
  for (const i of rows) {
    const key = JSON.stringify(visible.map((c) => ds.cols[c.index]![i]));
    const l = seen.get(key);
    if (l) l.push(ds.rowNumbers[i]!); else seen.set(key, [ds.rowNumbers[i]!]);
  }
  const dupGroups = [...seen.values()].filter((g) => g.length > 1);
  const exactRows = dupGroups.reduce((s, g) => s + g.length - 1, 0);
  const idColumns: DuplicateResult['idColumns'] = [];
  for (const c of ds.columns.filter((x) => x.type === 'identifier')) {
    const m = new Map<string, Set<string>>();
    const cnt = new Map<string, number>();
    for (const i of rows) {
      const v = ds.cols[c.index]![i];
      if (v === null) continue;
      const k = String(v);
      cnt.set(k, (cnt.get(k) ?? 0) + 1);
      const sig = JSON.stringify(visible.map((x) => ds.cols[x.index]![i]));
      (m.get(k) ?? m.set(k, new Set()).get(k)!).add(sig);
    }
    const dups = [...cnt.entries()].filter(([, x]) => x > 1);
    if (dups.length) idColumns.push({ col: c.index, header: c.header, duplicated: dups.reduce((s, [, x]) => s + x - 1, 0), conflicting: dups.filter(([k]) => m.get(k)!.size > 1).length });
  }

  // column statistics
  const stats: ColStat[] = visible.map((c) => {
    const vals = colVals(c.index);
    const present = vals.filter((v) => v !== null);
    const base: ColStat = { col: c.index, header: c.header, type: c.type, n: present.length, missing: n - present.length };
    if (NUMERIC_TYPES.includes(c.type)) {
      const nums = present.filter(isNum);
      base.desc = describe(nums) ?? undefined;
      base.zeros = nums.filter((v) => v === 0).length;
      base.negatives = nums.filter((v) => v < 0).length;
    } else if (DATE_TYPES.includes(c.type)) {
      const s = present.map(String).sort();
      base.min = s[0]?.slice(0, 10);
      base.max = s[s.length - 1]?.slice(0, 10);
    } else if (c.type === 'boolean') {
      base.trueShare = present.length ? present.filter((v) => v === 1).length / present.length : undefined;
    } else if (c.type === 'category') {
      const m = new Map<string, number>();
      for (const v of present) m.set(String(v), (m.get(String(v)) ?? 0) + 1);
      base.top = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([value, count]) => ({ value, count }));
    }
    return base;
  });

  // outliers (Tukey fences; only for continuous-looking columns)
  const outliers: OutlierResult[] = [];
  for (const c of ds.columns.filter((x) => NUMERIC_TYPES.includes(x.type))) {
    const pairs: { i: number; v: number }[] = [];
    for (const i of rows) { const v = ds.cols[c.index]![i]; if (isNum(v)) pairs.push({ i, v }); }
    if (pairs.length < OUTLIER_MIN_N || new Set(pairs.map((p) => p.v)).size <= 5) continue;
    const s = pairs.map((p) => p.v).sort((a, b) => a - b);
    const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), iqr = q3 - q1;
    if (iqr <= 0) continue;
    const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
    const out = pairs.filter((p) => p.v < lo || p.v > hi);
    if (!out.length) continue;
    outliers.push({
      col: c.index, header: c.header, n: pairs.length, lowFence: lo, highFence: hi, low: out.filter((p) => p.v < lo).length, high: out.filter((p) => p.v > hi).length, share: out.length / pairs.length,
      examples: out.sort((a, b) => Math.abs(b.v - (q1 + q3) / 2) - Math.abs(a.v - (q1 + q3) / 2)).slice(0, 5).map((p) => ({ row: ds.rowNumbers[p.i]!, value: p.v })),
    });
  }

  // missing-data diagnostics
  const half = (c: number, a: number, b: number) => {
    let m = 0, t = 0;
    for (let k = a; k < b; k++) { t++; if (ds.cols[c]![rows[k]!] === null) m++; }
    return t ? m / t : 0;
  };
  let ordered = rows;
  if (cfg.dateCol !== undefined) ordered = [...rows].sort((a, b) => String(ds.cols[cfg.dateCol!]![a] ?? '').localeCompare(String(ds.cols[cfg.dateCol!]![b] ?? '')));
  const missing: MissingResult[] = visible.map((c) => {
    const m = vals0(ds, c.index, rows).filter((v) => v === null).length;
    let first: number | undefined, second: number | undefined, shifts = false;
    if (cfg.dateCol !== undefined && n >= 40 && c.index !== cfg.dateCol) {
      const mid = Math.floor(n / 2);
      const o = (a: number, b: number) => { let mm = 0; for (let k = a; k < b; k++) if (ds.cols[c.index]![ordered[k]!] === null) mm++; return mm / Math.max(1, b - a); };
      first = o(0, mid); second = o(mid, n);
      shifts = Math.abs(first - second) >= 0.2;
    } else void half;
    return { col: c.index, header: c.header, missing: m, share: n ? m / n : 0, invalid: c.invalid, firstHalf: first, secondHalf: second, shifts };
  }).filter((m) => m.missing > 0 || m.invalid > 0).sort((a, b) => b.share - a.share);

  // trends and comparison
  const trends: TrendResult[] = [];
  const compare: Compare[] = [];
  let compareBlocked: UniversalAnalysis['compareBlocked'];
  const dc = cfg.dateCol;
  if (dc === undefined) compareBlocked = 'no_date';
  else if (!cfg.measures.length) compareBlocked = 'no_measure';
  else {
    const dated = rows.filter((i) => typeof ds.cols[dc]![i] === 'string');
    const days = dated.map((i) => String(ds.cols[dc]![i]).slice(0, 10)).sort();
    if (days.length < 6) compareBlocked = 'few_rows';
    else {
      const first = days[0]!, last = days[days.length - 1]!;
      const span = daysBetween(first, last) + 1;
      const g: Granularity = span <= 31 ? 'day' : span <= 120 ? 'week' : 'month';
      for (const m of cfg.measures) {
        const agg = cfg.agg[m]!;
        const by = new Map<string, number[]>();
        for (const i of dated) {
          const v = ds.cols[m]![i];
          const b = bucketOf(String(ds.cols[dc]![i]).slice(0, 10), g);
          const l = by.get(b) ?? by.set(b, []).get(b)!;
          if (isNum(v)) l.push(v);
        }
        const rowsPer = new Map<string, number>();
        for (const i of dated) { const b = bucketOf(String(ds.cols[dc]![i]).slice(0, 10), g); rowsPer.set(b, (rowsPer.get(b) ?? 0) + 1); }
        const keys = [...by.keys()].sort();
        const points: TrendPoint[] = keys.map((b) => ({ bucket: b, value: aggregate(by.get(b)!, agg), rows: rowsPer.get(b)!, partial: (b < bucketOf(first, g) || (b === bucketOf(first, g) && first > b)) || (bucketEnd(b, g) > last && last < bucketEnd(b, g)) }));
        if (points.length < 3 || points.filter((p) => p.value !== null).length < 3) continue;
        const t: TrendResult = { col: m, header: ds.columns[m]!.header, agg, granularity: g, points };
        const full = points.filter((p) => !(agg === 'sum' && p.partial) && p.value !== null && p.rows >= MIN_BUCKET_ROWS);
        if (full.length >= 2) {
          const cur = full[full.length - 1]!, prev = full[full.length - 2]!;
          if (cur.bucket > prev.bucket) {
            const change = cur.value! - prev.value!;
            const pct = prev.value !== 0 ? change / Math.abs(prev.value!) : null;
            const diffs = full.slice(1).map((p, i) => p.value! - full[i]!.value!);
            const sdc = describe(diffs.slice(0, -1))?.sd ?? 0;
            t.latest = { from: prev.bucket, to: cur.bucket, change, pct, flagged: pct !== null && Math.abs(pct) >= CHANGE_FLAG && (diffs.length < 6 || Math.abs(change) >= 2 * sdc) };
          }
        }
        trends.push(t);
      }
      if (span < 28) compareBlocked = 'short_span';
      else {
        const N = Math.min(30, Math.floor(span / 2));
        const cur = { from: addDays(last, -(N - 1)), to: last }, prev = { from: addDays(last, -(2 * N - 1)), to: addDays(last, -N) };
        for (const m of cfg.measures) {
          const agg = cfg.agg[m]!;
          const pick = (w: { from: string; to: string }) => {
            const v: number[] = []; let r = 0;
            for (const i of dated) { const d = String(ds.cols[dc]![i]).slice(0, 10); if (d >= w.from && d <= w.to) { r++; const x = ds.cols[m]![i]; if (isNum(x)) v.push(x); } }
            return { ...w, value: aggregate(v, agg), rows: r };
          };
          const c = pick(cur), p = pick(prev);
          const ok = p.rows >= MIN_BUCKET_ROWS && c.rows >= MIN_BUCKET_ROWS && c.value !== null && p.value !== null;
          compare.push({ col: m, header: ds.columns[m]!.header, agg, current: c, previous: p, change: ok ? c.value! - p.value! : null, pct: ok && p.value !== 0 ? (c.value! - p.value!) / Math.abs(p.value!) : null });
        }
        if (!compare.some((c) => c.change !== null)) compareBlocked = 'few_rows';
      }
    }
  }

  // rankings and distributions
  const ranksOut: RankResult[] = [];
  const distributions: Distribution[] = [];
  for (const d of cfg.dims) {
    const dh = ds.columns[d]!.header;
    const counts = new Map<string, number>();
    for (const i of rows) { const v = ds.cols[d]![i]; if (v !== null) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1); }
    if (counts.size < 2) continue;
    const sortedC = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const tot = sortedC.reduce((s, [, c]) => s + c, 0);
    distributions.push({ dim: d, header: dh, groups: counts.size, rows: sortedC.slice(0, 10).map(([key, count]) => ({ key, count, share: count / tot })), other: sortedC.slice(10).reduce((s, [, c]) => s + c, 0) });
    for (const m of cfg.measures) {
      const agg = cfg.agg[m]!;
      const g = new Map<string, number[]>();
      for (const i of rows) { const k = ds.cols[d]![i], v = ds.cols[m]![i]; if (k !== null && isNum(v)) (g.get(String(k)) ?? g.set(String(k), []).get(String(k))!).push(v); }
      if (g.size < 2) continue;
      const all = [...g.entries()].map(([key, v]) => ({ key, value: aggregate(v, agg)!, rows: v.length }));
      const negative = all.some((x) => x.value < 0);
      const total = agg === 'sum' ? all.reduce((s, x) => s + x.value, 0) : 0;
      const sorted = all.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
      const row = (x: { key: string; value: number; rows: number }): RankRow => ({ ...x, share: agg === 'sum' && !negative && total > 0 ? x.value / total : null });
      ranksOut.push({ dim: d, dimHeader: dh, measure: m, measureHeader: ds.columns[m]!.header, agg, groups: all.length, top: sorted.slice(0, 10).map(row), bottom: [...sorted].reverse().slice(0, 10).map(row), topShare: agg === 'sum' && !negative && total > 0 ? sorted[0]!.value / total : null, total, negative });
    }
  }

  // distributions of numeric columns
  const hists: Hist[] = [];
  for (const c of ds.columns.filter((x) => NUMERIC_TYPES.includes(x.type))) {
    const v = numbers(c.index);
    const d = describe(v);
    if (!d || d.n < 20 || new Set(v).size < 5) continue;
    hists.push({ col: c.index, header: c.header, bins: histogram(v), desc: d });
  }

  // correlations (pairwise complete, monotone agreement required)
  const correlations: Correlation[] = [];
  const numCols = ds.columns.filter((x) => NUMERIC_TYPES.includes(x.type) && x.nonEmpty > 0).slice(0, 12);
  for (let a = 0; a < numCols.length; a++) for (let b = a + 1; b < numCols.length; b++) {
    const xs: number[] = [], ys: number[] = [];
    for (const i of rows) { const p = ds.cols[numCols[a]!.index]![i], q = ds.cols[numCols[b]!.index]![i]; if (isNum(p) && isNum(q)) { xs.push(p); ys.push(q); } }
    if (xs.length < CORR_MIN_N) continue;
    const r = pearson(xs, ys), rho = spearman(xs, ys);
    if (r === null || rho === null) continue;
    // the rank correlation decides (robust to extreme values); Pearson must not contradict it
    const p = corrP(rho, xs.length);
    const agree = Math.abs(r) < 0.1 || Math.sign(r) === Math.sign(rho);
    correlations.push({ a: numCols[a]!.index, b: numCols[b]!.index, aHeader: numCols[a]!.header, bHeader: numCols[b]!.header, n: xs.length, pearson: r, spearman: rho, p, meaningful: Math.abs(rho) >= CORR_MIN_R && agree && p < CORR_ALPHA, redundant: Math.abs(r) >= 0.995 && Math.abs(rho) >= 0.995, outlierSensitive: Math.abs(rho) >= CORR_MIN_R && Math.abs(r) < CORR_MIN_R });
  }
  correlations.sort((x, y) => Math.abs(y.spearman) - Math.abs(x.spearman));

  // cross-tabs of two categoricals (small cardinality only)
  const crosstabs: CrossTab[] = [];
  const small = cfg.dims.filter((d) => { const k = ds.columns[d]!.distinct; return k >= 3 && k <= 12; });
  for (let a = 0; a < small.length && crosstabs.length < 2; a++) for (let b = a + 1; b < small.length && crosstabs.length < 2; b++) {
    const m = new Map<string, Map<string, number>>();
    const bk = new Set<string>();
    let tot = 0;
    for (const i of rows) { const p = ds.cols[small[a]!]![i], q = ds.cols[small[b]!]![i]; if (p === null || q === null) continue; const row = m.get(String(p)) ?? m.set(String(p), new Map()).get(String(p))!; row.set(String(q), (row.get(String(q)) ?? 0) + 1); bk.add(String(q)); tot++; }
    if (tot < 30 || m.size < 3 || bk.size < 3) continue;
    const aKeys = [...m.keys()].sort(), bKeys = [...bk].sort();
    crosstabs.push({ a: small[a]!, b: small[b]!, aHeader: ds.columns[small[a]!]!.header, bHeader: ds.columns[small[b]!]!.header, aKeys, bKeys, cells: aKeys.map((k) => bKeys.map((q) => m.get(k)!.get(q) ?? 0)), total: tot });
  }

  const dates = dc !== undefined ? rows.map((i) => ds.cols[dc]![i]).filter((v): v is string => typeof v === 'string').map((s) => s.slice(0, 10)).sort() : [];
  return {
    scope: { rows: n, totalRows: ds.rowCount, from: dates[0], to: dates[dates.length - 1], filters: (cfgIn.filters?.length ?? 0) + (cfgIn.range?.from || cfgIn.range?.to ? 1 : 0) },
    overview: { rows: n, columns: ds.columns.length, missingCells, cells, missingShare: cells ? missingCells / cells : 0, duplicateRows: exactRows, types },
    stats, outliers, missing, duplicates: { exactRows, groups: dupGroups.slice(0, 20).map((g) => ({ rows: g })), idColumns }, trends, compare, compareBlocked, ranks: ranksOut, distributions, hists, correlations, crosstabs,
    config: cfg,
  };
}

function vals0(ds: UDataset, c: number, rows: number[]): UCell[] {
  return rows.map((i) => ds.cols[c]![i] ?? null);
}
