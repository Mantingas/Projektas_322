import type { SalesRecord } from '../types';
import { aggregate, inSeries, type Series } from './aggregate';
import { planCharts, type ChartPlan } from './charts';
import {
  alignedSeries, comparePeriods, composition, entityTable, pareto, salesTrend, waterfall,
  type AlignedPoint, type EntityTable, type MetricComparison, type ParetoPoint, type TrendPoint, type Waterfall,
} from './compare';
import { lengthDays } from './dates';
import { applyFilters, hasDimension, type FilterSpec, type SalesDimension } from './filters';
import { KPI_ORDER, evaluateMargin, ignoredCostLines, type MetricContext, type MetricId } from './metrics';
import { explainMetricInputs } from './provenance';
import { inRange } from './compare';
import { isComparisonBlocked, resolvePeriods, type PeriodSelection, type PeriodWarning, type ResolvedPeriods } from './periods';

export type Limitation =
  | { code: 'basis_unknown' }
  | { code: 'basis_gross' }
  | { code: 'identity_content' }
  | { code: 'identity_mixed' }
  | { code: 'other_series_hidden'; count: number }
  | { code: 'filtered' }
  | { code: 'no_comparison' }
  | { code: 'negative_lines'; lines: number }
  | { code: 'held_pending'; lines: number }
  | { code: 'previous_unknown'; from: { date: string }; dataFrom: { date: string } }
  | { code: 'previous_incomplete'; from: { date: string }; declaredFrom: { date: string } }
  | { code: 'legacy_import'; n: number }
  | { code: 'credit_rows_excluded'; n: number; amount: { money: number } }
  | { code: 'cost_ignored'; n: number }
  | { code: 'units_unstated' }
  | { code: 'margin_partial'; pct: number };

export interface DashboardOptions {
  series: Series;
  filters: FilterSpec;
  period: PeriodSelection;
  /** Transaction identity reliability of the stored data (from the imports). */
  identity?: 'document' | 'mixed' | 'content';
  /** Imported lines held for review (not part of any number shown). */
  heldPending?: number;
  waterfallDimension?: SalesDimension;
  paretoDimension?: SalesDimension;
  /** The export period the user declared at import (earliest start, latest end). */
  coverage?: { from?: string; to?: string };
  /** Stored imports made before the current import rules (credit-note type, quantity signs, units): their files should be re-imported. */
  legacyImports?: number;
  /** Credit-note rows that were not imported because their sign was ambiguous (count and absolute amount, from the import records). */
  excludedCredits?: { rows: number; amount: number };
}

export interface DashboardModel {
  series: Series;
  ctx: MetricContext;
  /** Date span of the (series-restricted, entity-filtered) data. */
  bounds: { dateMin: string; dateMax: string };
  records: SalesRecord[];
  periods: ResolvedPeriods;
  comparable: boolean;
  kpis: MetricComparison[];
  trend: TrendPoint[];
  aligned: { bucketDays: number; points: AlignedPoint[] };
  tables: Record<SalesDimension, EntityTable | null>;
  pareto: { dimension: SalesDimension; points: ParetoPoint[]; countFor80: number; total: number } | null;
  waterfall: { dimension: SalesDimension; data: Waterfall } | null;
  composition: { label: string; value: number; share: number; other?: boolean }[];
  charts: ChartPlan[];
  warnings: PeriodWarning[];
  limitations: Limitation[];
  /** Inputs behind each metric of the current period, for the "how is this calculated" explanation. */
  explain: Partial<Record<MetricId, Record<string, number | string>>>;
}

const DIMS: SalesDimension[] = ['customer', 'product', 'salesperson', 'category'];

export function buildDashboard(all: SalesRecord[], o: DashboardOptions): DashboardModel | null {
  const seriesRecords = inSeries(all, o.series);
  if (seriesRecords.length === 0) return null;
  // the dashboard's date range comes from the comparison periods, so date filters are intentionally ignored here
  const records = applyFilters(seriesRecords, { ...o.filters, dateFrom: undefined, dateTo: undefined });
  const base = records.length ? records : seriesRecords;
  let dateMin = base[0]!.date;
  let dateMax = base[0]!.date;
  const dates = new Set<string>();
  for (const r of base) {
    if (r.date < dateMin) dateMin = r.date;
    if (r.date > dateMax) dateMax = r.date;
    dates.add(r.date);
  }
  // anchor on the whole series so that a customer filter does not move "today"
  let sMin = seriesRecords[0]!.date;
  let sMax = seriesRecords[0]!.date;
  for (const r of seriesRecords) {
    if (r.date < sMin) sMin = r.date;
    if (r.date > sMax) sMax = r.date;
  }
  const periods = resolvePeriods(o.period, { dateMin: sMin, dateMax: sMax, dates: new Set(seriesRecords.map((r) => r.date)), checkCoverage: true, declaredFrom: o.coverage?.from, declaredTo: o.coverage?.to });
  const ctx: MetricContext = { basis: o.series.basis, singleProduct: (o.filters.products?.length ?? 0) === 1 };
  const cmp = comparePeriods(records, periods, KPI_ORDER, ctx);
  const comparable = !isComparisonBlocked(periods) && cmp.previous.lines > 0 && cmp.current.lines > 0;

  const tables = Object.fromEntries(DIMS.map((d) => [d, hasDimension(records, d) ? entityTable(records, d, periods, ctx) : null])) as Record<SalesDimension, EntityTable | null>;
  const trend = salesTrend(records, { from: dateMin, to: dateMax });
  const entities = Object.fromEntries(DIMS.map((d) => [d, tables[d]?.rows.filter((r) => r.current > 0).length ?? 0])) as Record<SalesDimension, number>;
  const movers = Object.fromEntries(DIMS.map((d) => [d, tables[d]?.rows.filter((r) => Math.abs(r.change) > 1e-9).length ?? 0])) as Record<SalesDimension, number>;
  const charts = planCharts({ trendPoints: trend.filter((p) => p.lines > 0).length, comparisonUsable: comparable, entities, movers });
  const wPlan = charts.find((c) => c.id === 'waterfall')!;
  const pPlan = charts.find((c) => c.id === 'pareto')!;
  const wDim = wPlan.available ? (o.waterfallDimension && tables[o.waterfallDimension] && movers[o.waterfallDimension] >= 2 ? o.waterfallDimension : (wPlan.dimension as SalesDimension)) : null;
  const pDim = pPlan.available ? (o.paretoDimension && entities[o.paretoDimension] >= 5 ? o.paretoDimension : (pPlan.dimension as SalesDimension)) : null;
  const par = pDim ? { dimension: pDim, ...pareto(tables[pDim]!.rows) } : null;

  const limitations: Limitation[] = [];
  if (o.series.basis === 'unknown') limitations.push({ code: 'basis_unknown' });
  if (o.series.basis === 'gross') limitations.push({ code: 'basis_gross' });
  if (o.identity === 'content') limitations.push({ code: 'identity_content' });
  if (o.identity === 'mixed') limitations.push({ code: 'identity_mixed' });
  const otherSeries = new Set(all.map((r) => `${r.currency}|${r.basis}`)).size - 1;
  if (otherSeries > 0) limitations.push({ code: 'other_series_hidden', count: otherSeries });
  if (records.length !== seriesRecords.length) limitations.push({ code: 'filtered' });
  const unverified = periods.warnings.find((w) => w.code === 'previous_unverified');
  const declaredPartial = periods.warnings.find((w) => w.code === 'previous_declared_incomplete');
  if (unverified && unverified.code === 'previous_unverified') limitations.push({ code: 'previous_unknown', from: { date: periods.previous.from }, dataFrom: { date: unverified.dataFrom } });
  else if (declaredPartial && declaredPartial.code === 'previous_declared_incomplete') limitations.push({ code: 'previous_incomplete', from: { date: periods.previous.from }, declaredFrom: { date: declaredPartial.declaredFrom } });
  else if (!comparable) limitations.push({ code: 'no_comparison' });
  const neg = records.filter((r) => r.amount < 0).length;
  if (neg) limitations.push({ code: 'negative_lines', lines: neg });
  if (o.heldPending) limitations.push({ code: 'held_pending', lines: o.heldPending });
  const curAgg = aggregate(inRange(records, periods.current));
  if (curAgg.qtyLines > 0 && [...curAgg.qtyByUnit.keys()].every((u) => u === '') && cmp.metrics.some((m) => m.id === 'quantity' && m.current !== null)) limitations.push({ code: 'units_unstated' });
  if (o.legacyImports) limitations.push({ code: 'legacy_import', n: o.legacyImports });
  if (o.excludedCredits && o.excludedCredits.rows > 0) limitations.push({ code: 'credit_rows_excluded', n: o.excludedCredits.rows, amount: { money: o.excludedCredits.amount } });
  { const ign = ignoredCostLines(curAgg); if (ign > 0) limitations.push({ code: 'cost_ignored', n: ign }); }
  { const mg = evaluateMargin(curAgg, o.series.basis); if (mg.ok && mg.r.revenueCoverage < 0.999) limitations.push({ code: 'margin_partial', pct: mg.r.revenueCoverage }); }
  const explain: DashboardModel['explain'] = {};
  for (const k of KPI_ORDER) explain[k] = explainMetricInputs(k, curAgg);

  return {
    series: o.series, ctx, bounds: { dateMin, dateMax }, records, periods, comparable, kpis: cmp.metrics, trend, aligned: alignedSeries(records, periods), tables,
    pareto: par, waterfall: wDim ? { dimension: wDim, data: waterfall(tables[wDim]!) } : null,
    composition: tables.category ? composition(tables.category) : [], charts, warnings: periods.warnings, limitations, explain,
  };
}

/** Total of the trend equals the sum over the same records: exposed for consistency checks. */
export const trendTotal = (m: DashboardModel) => m.trend.reduce((s, p) => s + p.revenue, 0);
export const spanDays = (m: DashboardModel) => lengthDays(m.bounds.dateMin, m.bounds.dateMax);
export { aggregate };

import { analyzeSalesPeriod, type SalesAnalysis } from '../insights/engine';

/**
 * Dashboard model + primary insights computed from the SAME series, filters and comparison periods.
 * (Rolling-window alerts are a separate, explicitly labelled analysis: see analyzeSales.)
 */
export function buildDashboardWithInsights(all: SalesRecord[], o: DashboardOptions): { model: DashboardModel; analysis: SalesAnalysis | null } | null {
  const model = buildDashboard(all, o);
  if (!model) return null;
  return { model, analysis: analyzeSalesPeriod(model.records, o.series, model.periods) };
}

/** What the UI receives: the model without the (potentially huge) record list, which stays in the worker. */
export type DashboardView = Omit<DashboardModel, 'records'>;
