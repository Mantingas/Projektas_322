import type { SalesRecord } from '../types';
import { aggregate, inSeries, type Series } from './aggregate';
import { planCharts, type ChartPlan } from './charts';
import {
  alignedSeries, comparePeriods, composition, entityTable, pareto, salesTrend, waterfall,
  type AlignedPoint, type EntityTable, type MetricComparison, type ParetoPoint, type TrendPoint, type Waterfall,
} from './compare';
import { lengthDays } from './dates';
import { applyFilters, hasDimension, type Dimension, type FilterSpec } from './filters';
import { KPI_ORDER, type MetricContext } from './metrics';
import { isComparisonBlocked, resolvePeriods, type PeriodSelection, type PeriodWarning, type ResolvedPeriods } from './periods';

export type Limitation =
  | { code: 'basis_unknown' }
  | { code: 'basis_gross' }
  | { code: 'identity_content' }
  | { code: 'identity_mixed' }
  | { code: 'other_series_hidden'; count: number }
  | { code: 'filtered' }
  | { code: 'no_comparison' }
  | { code: 'negative_lines'; lines: number };

export interface DashboardOptions {
  series: Series;
  filters: FilterSpec;
  period: PeriodSelection;
  /** Transaction identity reliability of the stored data (from the imports). */
  identity?: 'document' | 'mixed' | 'content';
  waterfallDimension?: Dimension;
  paretoDimension?: Dimension;
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
  tables: Record<Dimension, EntityTable | null>;
  pareto: { dimension: Dimension; points: ParetoPoint[]; countFor80: number; total: number } | null;
  waterfall: { dimension: Dimension; data: Waterfall } | null;
  composition: { label: string; value: number; share: number; other?: boolean }[];
  charts: ChartPlan[];
  warnings: PeriodWarning[];
  limitations: Limitation[];
}

const DIMS: Dimension[] = ['customer', 'product', 'salesperson', 'category'];

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
  const periods = resolvePeriods(o.period, { dateMin: sMin, dateMax: sMax, dates: new Set(seriesRecords.map((r) => r.date)) });
  const ctx: MetricContext = { basis: o.series.basis, singleProduct: (o.filters.products?.length ?? 0) === 1 };
  const cmp = comparePeriods(records, periods, KPI_ORDER, ctx);
  const comparable = !isComparisonBlocked(periods) && cmp.previous.lines > 0 && cmp.current.lines > 0;

  const tables = Object.fromEntries(DIMS.map((d) => [d, hasDimension(records, d) ? entityTable(records, d, periods, ctx) : null])) as Record<Dimension, EntityTable | null>;
  const trend = salesTrend(records, { from: dateMin, to: dateMax });
  const entities = Object.fromEntries(DIMS.map((d) => [d, tables[d]?.rows.filter((r) => r.current > 0).length ?? 0])) as Record<Dimension, number>;
  const movers = Object.fromEntries(DIMS.map((d) => [d, tables[d]?.rows.filter((r) => Math.abs(r.change) > 1e-9).length ?? 0])) as Record<Dimension, number>;
  const charts = planCharts({ trendPoints: trend.filter((p) => p.lines > 0).length, comparisonUsable: comparable, entities, movers });
  const wPlan = charts.find((c) => c.id === 'waterfall')!;
  const pPlan = charts.find((c) => c.id === 'pareto')!;
  const wDim = wPlan.available ? (o.waterfallDimension && tables[o.waterfallDimension] && movers[o.waterfallDimension] >= 2 ? o.waterfallDimension : wPlan.dimension!) : null;
  const pDim = pPlan.available ? (o.paretoDimension && entities[o.paretoDimension] >= 5 ? o.paretoDimension : pPlan.dimension!) : null;
  const par = pDim ? { dimension: pDim, ...pareto(tables[pDim]!.rows) } : null;

  const limitations: Limitation[] = [];
  if (o.series.basis === 'unknown') limitations.push({ code: 'basis_unknown' });
  if (o.series.basis === 'gross') limitations.push({ code: 'basis_gross' });
  if (o.identity === 'content') limitations.push({ code: 'identity_content' });
  if (o.identity === 'mixed') limitations.push({ code: 'identity_mixed' });
  const otherSeries = new Set(all.map((r) => `${r.currency}|${r.basis}`)).size - 1;
  if (otherSeries > 0) limitations.push({ code: 'other_series_hidden', count: otherSeries });
  if (records.length !== seriesRecords.length) limitations.push({ code: 'filtered' });
  if (!comparable) limitations.push({ code: 'no_comparison' });
  const neg = records.filter((r) => r.amount < 0).length;
  if (neg) limitations.push({ code: 'negative_lines', lines: neg });

  return {
    series: o.series, ctx, bounds: { dateMin, dateMax }, records, periods, comparable, kpis: cmp.metrics, trend, aligned: alignedSeries(records, periods), tables,
    pareto: par, waterfall: wDim ? { dimension: wDim, data: waterfall(tables[wDim]!) } : null,
    composition: tables.category ? composition(tables.category) : [], charts, warnings: periods.warnings, limitations,
  };
}

/** Total of the trend equals the sum over the same records: exposed for consistency checks. */
export const trendTotal = (m: DashboardModel) => m.trend.reduce((s, p) => s + p.revenue, 0);
export const spanDays = (m: DashboardModel) => lengthDays(m.bounds.dateMin, m.bounds.dateMax);
export { aggregate };
