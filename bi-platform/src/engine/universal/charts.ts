import { analyzeUniversal, type Agg, type UniversalAnalysis } from './analyze';
import type { UDataset } from './types';

export type UChartKind = 'line' | 'bar' | 'pareto' | 'histogram' | 'scatter' | 'heatmap';
export type UQuestion = 'trend' | 'ranking' | 'concentration' | 'distribution' | 'relationship' | 'composition' | 'matrix';

export interface UScope { rows: number; totalRows: number; from?: string; to?: string; filters: number }
export interface UChart {
  id: string;
  kind: UChartKind;
  question: UQuestion;
  /** names shown in titles (column headers – never invented business terms) */
  title: { measure?: string; dim?: string; x?: string; y?: string };
  /** '%' | currency code | '' when the file states no unit */
  unit: string;
  agg?: Agg;
  scope: UScope;
  data: unknown;
  /** every chart ships with its table alternative */
  table: { headers: string[]; rows: (string | number)[][] };
  /** i18n key suffix: why this chart was chosen */
  reason: string;
}

export interface Skipped { question: UQuestion; reason: 'no_date' | 'few_points' | 'no_measure' | 'no_dimension' | 'no_meaningful_correlation' | 'few_values' | 'flat' }

const PARETO_MIN_GROUPS = 6;
const TREND_MIN_POINTS = 6;

const unitOf = (ds: UDataset, col: number) => { const c = ds.columns[col]!; return c.type === 'percent' ? '%' : c.type === 'currency' ? c.currency ?? '' : ''; };

/**
 * Picks the charts the data can answer, one chart per question, and says why. A chart that would repeat another (a bar chart of the same
 * ranking a Pareto already shows) or would not mean anything (a scatter of unrelated columns) is never produced.
 */
export function recommendCharts(ds: UDataset, a: UniversalAnalysis = analyzeUniversal(ds)): { charts: UChart[]; skipped: Skipped[] } {
  const scope: UScope = a.scope;
  const charts: UChart[] = [];
  const skipped: Skipped[] = [];

  // trend: one line per measure (max 3) – needs a date column and enough periods
  if (a.config.dateCol === undefined) skipped.push({ question: 'trend', reason: 'no_date' });
  else if (!a.config.measures.length) skipped.push({ question: 'trend', reason: 'no_measure' });
  else {
    const ok = a.trends.filter((t) => t.points.length >= TREND_MIN_POINTS);
    if (!ok.length) skipped.push({ question: 'trend', reason: 'few_points' });
    for (const t of ok.slice(0, 3)) {
      charts.push({
        id: `trend:${t.col}`, kind: 'line', question: 'trend', title: { measure: t.header }, unit: unitOf(ds, t.col), agg: t.agg, scope, reason: `trend_${t.granularity}`,
        data: t.points.map((p) => ({ x: p.bucket, y: p.value, partial: p.partial })),
        table: { headers: [ds.columns[a.config.dateCol]!.header, t.header, '#'], rows: t.points.map((p) => [p.bucket, p.value ?? '', p.rows]) },
      });
    }
  }

  // ranking / concentration: one chart per (dimension, measure); a Pareto replaces the bar chart when the shares are skewed
  const used = new Set<string>();
  let rankCount = 0;
  for (const r of a.ranks) {
    if (rankCount >= 3) break;
    const key = `${r.dim}`;
    if (used.has(key)) continue; // one ranking per dimension – more would repeat the same grouping
    used.add(key);
    const nonNeg = !r.negative && r.agg === 'sum' && r.total > 0;
    const sortedAll = nonNeg ? [...r.top] : [];
    const skew = nonNeg && r.groups >= PARETO_MIN_GROUPS && r.top.slice(0, Math.max(1, Math.ceil(r.groups * 0.2))).reduce((s, x) => s + x.value, 0) / r.total >= 0.5;
    if (skew) {
      let cum = 0;
      const rows = sortedAll.map((x) => { cum += x.value; return { key: x.key, value: x.value, cum: cum / r.total }; });
      charts.push({ id: `pareto:${r.dim}:${r.measure}`, kind: 'pareto', question: 'concentration', title: { measure: r.measureHeader, dim: r.dimHeader }, unit: unitOf(ds, r.measure), agg: r.agg, scope, reason: 'pareto_skewed', data: rows, table: { headers: [r.dimHeader, r.measureHeader, '%'], rows: rows.map((x) => [x.key, x.value, Math.round(x.cum * 1000) / 10]) } });
    } else if (r.groups <= 100) {
      charts.push({ id: `bar:${r.dim}:${r.measure}`, kind: 'bar', question: 'ranking', title: { measure: r.measureHeader, dim: r.dimHeader }, unit: unitOf(ds, r.measure), agg: r.agg, scope, reason: 'ranking', data: r.top.slice(0, 10), table: { headers: [r.dimHeader, r.measureHeader, '#'], rows: r.top.slice(0, 10).map((x) => [x.key, x.value, x.rows]) } });
    } else continue;
    rankCount++;
  }
  if (!rankCount) skipped.push({ question: 'ranking', reason: a.config.dims.length ? 'no_measure' : 'no_dimension' });

  // composition: category counts, only where no ranking already groups by the same column
  for (const d of a.distributions.filter((x) => !used.has(String(x.dim))).slice(0, 2)) {
    if (d.groups > 30) continue;
    charts.push({ id: `bar-count:${d.dim}`, kind: 'bar', question: 'composition', title: { dim: d.header }, unit: '', scope, reason: 'composition', data: d.rows.map((x) => ({ key: x.key, value: x.count, rows: x.count, share: x.share })), table: { headers: [d.header, '#', '%'], rows: d.rows.map((x) => [x.key, x.count, Math.round(x.share * 1000) / 10]) } });
  }

  // distribution: only columns with real spread; capped
  const hists = a.hists.filter((h) => h.desc.sd > 0).slice(0, 2);
  for (const h of hists) {
    charts.push({ id: `hist:${h.col}`, kind: 'histogram', question: 'distribution', title: { measure: h.header }, unit: unitOf(ds, h.col), scope, reason: 'distribution', data: h.bins, table: { headers: [h.header, '#'], rows: h.bins.map((b) => [b.from === b.to ? `${b.from}` : `${+b.from.toFixed(4)} – ${+b.to.toFixed(4)}`, b.count]) } });
  }
  if (!hists.length) skipped.push({ question: 'distribution', reason: 'few_values' });

  // relationships: only statistically meaningful, non-duplicate pairs
  const good = a.correlations.filter((c) => c.meaningful && !c.redundant);
  if (!good.length) skipped.push({ question: 'relationship', reason: 'no_meaningful_correlation' });
  for (const c of good.slice(0, 2)) {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < ds.rowCount; i++) { const p = ds.cols[c.a]![i], q = ds.cols[c.b]![i]; if (typeof p === 'number' && typeof q === 'number') pts.push({ x: p, y: q }); }
    const step = Math.max(1, Math.ceil(pts.length / 500));
    const shown = pts.filter((_, i) => i % step === 0);
    charts.push({ id: `scatter:${c.a}:${c.b}`, kind: 'scatter', question: 'relationship', title: { x: c.aHeader, y: c.bHeader }, unit: '', scope, reason: 'relationship', data: { points: shown, r: c.pearson, rho: c.spearman, n: c.n, sampled: step > 1, outlierSensitive: c.outlierSensitive }, table: { headers: [c.aHeader, c.bHeader], rows: shown.slice(0, 200).map((p) => [p.x, p.y]) } });
  }

  // matrices: counts of two categoricals; correlation matrix only when several columns relate
  for (const x of a.crosstabs.slice(0, 1)) {
    charts.push({ id: `heat:${x.a}:${x.b}`, kind: 'heatmap', question: 'matrix', title: { x: x.aHeader, y: x.bHeader }, unit: '', scope, reason: 'crosstab', data: { rows: x.aKeys, cols: x.bKeys, cells: x.cells, kind: 'count' }, table: { headers: [x.aHeader, ...x.bKeys], rows: x.aKeys.map((k, i) => [k, ...x.cells[i]!]) } });
  }
  const numCount = new Set(a.correlations.flatMap((c) => [c.a, c.b])).size;
  if (numCount >= 4 && good.length >= 2) {
    const cols = [...new Set(a.correlations.flatMap((c) => [c.a, c.b]))].slice(0, 8);
    const get = (p: number, q: number) => p === q ? 1 : a.correlations.find((c) => (c.a === p && c.b === q) || (c.a === q && c.b === p))?.pearson ?? null;
    const heads = cols.map((c) => ds.columns[c]!.header);
    charts.push({ id: 'heat:corr', kind: 'heatmap', question: 'matrix', title: {}, unit: '', scope, reason: 'corrMatrix', data: { rows: heads, cols: heads, cells: cols.map((p) => cols.map((q) => get(p, q))), kind: 'corr' }, table: { headers: ['', ...heads], rows: cols.map((p, i) => [heads[i]!, ...cols.map((q) => { const v = get(p, q); return v === null ? '' : Math.round(v * 100) / 100; })]) } });
  }
  return { charts, skipped };
}
