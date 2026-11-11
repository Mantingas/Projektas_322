import type { AmountBasis, PurchaseRecord } from '../types';
import type { Series } from '../analytics/aggregate';
import type { ChartPlan } from '../analytics/charts';
import {
  alignedSeries, compareWith, composition, inRange, pareto, salesTrend, waterfall,
  type AlignedPoint, type EntityRow, type EntityTable, type MetricComparison, type ParetoPoint, type TrendPoint, type Waterfall,
} from '../analytics/compare';
import type { FilterSpec, PurchaseDimension } from '../analytics/filters';
import { isComparisonBlocked, resolvePeriods, type PeriodSelection, type PeriodWarning, type ResolvedPeriods } from '../analytics/periods';
import { aggregatePurchases, groupPurchaseAggregates, inPurchaseSeries } from './aggregate';
import { applyPurchaseFilters, hasPurchaseDimension, productRef } from './entities';
import { explainPurchaseInputs, PURCHASE_KPI_ORDER, PURCHASE_METRICS, type PurchaseMetricContext } from './metrics';
import { analyzePrices, quantityComparison, toPriceLines, type Bridge, type PairRow, type HistoricalPriceRow, type PriceAnalysis, type QuantityRow, type VarianceRow } from './prices';
import type { UnitPolicy } from './units';

export type PurchaseLimitation =
  | { code: 'p_basis_unknown' }
  | { code: 'p_basis_gross' }
  | { code: 'identity_content' }
  | { code: 'identity_mixed' }
  | { code: 'other_series_hidden'; count: number }
  | { code: 'filtered' }
  | { code: 'no_comparison' }
  | { code: 'p_credit_lines'; lines: number }
  | { code: 'held_pending'; lines: number }
  | { code: 'p_units_not_provided' }
  | { code: 'p_mixed_units'; count: number }
  | { code: 'p_unit_mismatch'; count: number }
  | { code: 'p_name_identity'; count: number }
  | { code: 'p_code_ambiguity'; count: number }
  | { code: 'p_price_coverage'; pct: number }
  | { code: 'p_discount_unverified' }
  | { code: 'p_metric_units' };

export interface PurchasingOptions {
  series: Series | { currency: string; basis: AmountBasis };
  filters: FilterSpec;
  period: PeriodSelection;
  /** Exact SI conversions (g→kg, ml→l …) only when the user turns them on. */
  unitPolicy?: UnitPolicy;
  identity?: 'document' | 'mixed' | 'content';
  heldPending?: number;
  /** A discount column exists but the arithmetic did not settle whether amounts are net of it. */
  discountUnverified?: boolean;
  /** The export period the user declared at import (earliest start, latest end). */
  coverage?: { from?: string; to?: string };
}

export interface PurchasingView {
  series: Series;
  ctx: PurchaseMetricContext;
  bounds: { dateMin: string; dateMax: string };
  periods: ResolvedPeriods;
  comparable: boolean;
  kpis: MetricComparison[];
  /** Like-for-like price change across comparable item/supplier pairs (not a per-period KPI). */
  priceChange: PriceAnalysis['lfl'];
  trend: TrendPoint[];
  aligned: { bucketDays: number; points: AlignedPoint[] };
  tables: Partial<Record<PurchaseDimension, EntityTable | null>>;
  pareto: { dimension: PurchaseDimension; points: ParetoPoint[]; countFor80: number; total: number } | null;
  waterfall: { dimension: PurchaseDimension; data: Waterfall } | null;
  composition: { label: string; value: number; share: number; other?: boolean }[];
  bridge: Bridge | null;
  /** Largest like-for-like price moves of item–supplier pairs (by effect on current quantity). */
  pairs: PairRow[];
  variance: VarianceRow[];
  historical: HistoricalPriceRow[];
  quantities: QuantityRow[];
  /** Comparable items offered for the price-trend chart, most spend first. */
  priceItems: { gk: string; label: string; unit: string; identity: 'sku' | 'name'; spend: number; suppliers: number }[];
  charts: ChartPlan[];
  warnings: PeriodWarning[];
  limitations: PurchaseLimitation[];
  explain: Partial<Record<string, Record<string, number>>>;
  excluded: PriceAnalysis['excluded'];
  unitPolicy: UnitPolicy;
}

export interface PurchasingModel extends PurchasingView {
  records: PurchaseRecord[];
  analysis: PriceAnalysis;
}

const DIMS: PurchaseDimension[] = ['supplier', 'product', 'warehouse'];

function purchaseEntityTable(records: PurchaseRecord[], dim: PurchaseDimension, periods: ResolvedPeriods, ctx: PurchaseMetricContext): EntityTable {
  const cur = groupPurchaseAggregates(inRange(records, periods.current), dim);
  const prev = groupPurchaseAggregates(inRange(records, periods.previous), dim);
  const keys = new Set([...cur.groups.keys(), ...prev.groups.keys()]);
  const totalCurrent = [...cur.groups.values()].reduce((s, g) => s + g.agg.spend, 0) + cur.unassigned.spend;
  const totalPrevious = [...prev.groups.values()].reduce((s, g) => s + g.agg.spend, 0) + prev.unassigned.spend;
  const val = (id: 'p_quantity' | 'p_documents', a: ReturnType<typeof aggregatePurchases> | undefined) => (a ? PURCHASE_METRICS[id].evaluate(a, ctx).value : null);
  const rows: EntityRow[] = [...keys].map((k) => {
    const c = cur.groups.get(k);
    const p = prev.groups.get(k);
    const cv = c?.agg.spend ?? 0;
    const pv = p?.agg.spend ?? 0;
    return {
      key: k, label: (c ?? p)!.label, current: cv, previous: pv, change: cv - pv, changePct: pv !== 0 ? (cv - pv) / Math.abs(pv) : null,
      share: totalCurrent !== 0 ? cv / totalCurrent : 0, lines: c?.agg.lines ?? 0,
      quantity: val('p_quantity', c?.agg), orders: val('p_documents', c?.agg), margin: null,
    };
  });
  return { dimension: dim as never, rows, unassigned: { current: cur.unassigned.spend, previous: prev.unassigned.spend }, totalCurrent, totalPrevious };
}

/**
 * The purchasing dashboard model. Same period engine, same comparison rules, same entity-table / Pareto / waterfall helpers as sales;
 * the metrics and price analysis are purchasing-specific. Currencies, VAT bases and units are never mixed or converted silently.
 */
export function buildPurchasingDashboard(all: PurchaseRecord[], o: PurchasingOptions): PurchasingModel | null {
  const seriesRecords = inPurchaseSeries(all, o.series);
  if (seriesRecords.length === 0) return null;
  const policy: UnitPolicy = o.unitPolicy ?? 'strict';
  const records = applyPurchaseFilters(seriesRecords, { ...o.filters, dateFrom: undefined, dateTo: undefined });
  const base = records.length ? records : seriesRecords;
  let dateMin = base[0]!.date;
  let dateMax = dateMin;
  for (const r of base) { if (r.date < dateMin) dateMin = r.date; if (r.date > dateMax) dateMax = r.date; }
  let sMin = seriesRecords[0]!.date;
  let sMax = sMin;
  const dates = new Set<string>();
  for (const r of seriesRecords) { if (r.date < sMin) sMin = r.date; if (r.date > sMax) sMax = r.date; dates.add(r.date); }
  const periods = resolvePeriods(o.period, { dateMin: sMin, dateMax: sMax, dates, checkCoverage: true, declaredFrom: o.coverage?.from, declaredTo: o.coverage?.to });
  const hasUnitColumn = seriesRecords.some((r) => r.unit !== undefined);
  const ctx: PurchaseMetricContext = { basis: o.series.basis, unitPolicy: policy, hasUnitColumn, singleProduct: (o.filters.products?.length ?? 0) === 1 };

  const curAgg = aggregatePurchases(inRange(records, periods.current));
  const prevAgg = aggregatePurchases(inRange(records, periods.previous));
  const kpis = PURCHASE_KPI_ORDER.map((id) => compareWith(PURCHASE_METRICS[id], curAgg, prevAgg, ctx, periods));
  const comparable = !isComparisonBlocked(periods) && curAgg.lines > 0 && prevAgg.lines > 0;
  const analysis = analyzePrices(records, periods, { policy, hasUnitColumn });
  const tables: PurchasingView['tables'] = {};
  for (const d of DIMS) tables[d] = hasPurchaseDimension(records, d) ? purchaseEntityTable(records, d, periods, ctx) : null;
  const trend = salesTrend(records, { from: dateMin, to: dateMax });

  // chart planning (same philosophy as sales: never show a meaningless chart, say why)
  const nEnt = (d: PurchaseDimension) => tables[d]?.rows.filter((r) => r.current > 0).length ?? 0;
  const movers = (d: PurchaseDimension) => tables[d]?.rows.filter((r) => Math.abs(r.change) > 1e-9).length ?? 0;
  const { lines: priceLines } = toPriceLines(records, { policy, hasUnitColumn });
  const itemMap = new Map<string, PurchasingView['priceItems'][number] & { sup: Set<string> }>();
  for (const l of priceLines) {
    const e = itemMap.get(l.gk) ?? { gk: l.gk, label: l.productLabel, unit: l.unit, identity: l.identity, spend: 0, suppliers: 0, sup: new Set<string>() };
    e.spend += l.amount;
    if (l.supplier) e.sup.add(l.supplier);
    itemMap.set(l.gk, e);
  }
  const priceItems = [...itemMap.values()].map(({ sup, ...e }) => ({ ...e, suppliers: sup.size })).sort((a, b) => b.spend - a.spend).slice(0, 200);
  const quantities = quantityComparison(analysis.groups, 10);
  const comparableDims: PurchaseDimension[] = ['supplier', 'product'];
  const wDim = comparableDims.find((d) => movers(d) >= 2);
  const pDim = comparableDims.find((d) => nEnt(d) >= 5);
  const charts: ChartPlan[] = [
    { id: 'trend', ...(trend.filter((p) => p.lines > 0).length >= 3 ? { available: true } : { available: false, reason: 'too_few_points' as const }) },
    { id: 'comparison', ...(comparable ? { available: true } : { available: false, reason: 'no_comparison' as const }) },
    { id: 'topSuppliers', dimension: 'supplier' as never, ...(!tables.supplier ? { available: false, reason: 'needs_dimension' as const } : nEnt('supplier') < 2 ? { available: false, reason: 'too_few_entities' as const } : { available: true }) },
    { id: 'topProducts', dimension: 'product' as never, ...(!tables.product ? { available: false, reason: 'needs_dimension' as const } : nEnt('product') < 2 ? { available: false, reason: 'too_few_entities' as const } : { available: true }) },
    { id: 'pareto', dimension: (pDim ?? 'supplier') as never, ...(pDim ? { available: true } : { available: false, reason: 'too_few_entities' as const }) },
    { id: 'waterfall', dimension: (wDim ?? 'supplier') as never, ...(!comparable ? { available: false, reason: 'no_comparison' as const } : wDim ? { available: true } : { available: false, reason: 'too_few_entities' as const }) },
    { id: 'spendBridge', ...(!comparable ? { available: false, reason: 'no_comparison' as const } : { available: true }) },
    { id: 'priceTrend', ...(priceItems.length === 0 ? { available: false, reason: 'no_price_data' as const } : { available: true }) },
    { id: 'priceVariance', ...(analysis.variance.length === 0 ? { available: false, reason: 'no_price_data' as const } : { available: true }) },
    { id: 'quantityComparison', ...(!comparable || quantities.length < 2 ? { available: false, reason: comparable ? ('too_few_entities' as const) : ('no_comparison' as const) } : { available: true }) },
  ];

  const lim: PurchaseLimitation[] = [];
  if (o.series.basis === 'unknown') lim.push({ code: 'p_basis_unknown' });
  if (o.series.basis === 'gross') lim.push({ code: 'p_basis_gross' });
  if (o.identity === 'content') lim.push({ code: 'identity_content' });
  if (o.identity === 'mixed') lim.push({ code: 'identity_mixed' });
  const others = new Set(all.map((r) => `${r.currency}|${r.basis}`)).size - 1;
  if (others > 0) lim.push({ code: 'other_series_hidden', count: others });
  if (records.length !== seriesRecords.length) lim.push({ code: 'filtered' });
  if (!comparable) lim.push({ code: 'no_comparison' });
  const neg = records.filter((r) => r.amount < 0).length;
  if (neg) lim.push({ code: 'p_credit_lines', lines: neg });
  if (o.heldPending) lim.push({ code: 'held_pending', lines: o.heldPending });
  if (!hasUnitColumn) lim.push({ code: 'p_units_not_provided' });
  if (hasUnitColumn && PURCHASE_METRICS.p_quantity.evaluate(curAgg, ctx).unavailable === 'mixed_units') lim.push({ code: 'p_mixed_units', count: new Set([...curAgg.qtyByUnit.keys()]).size });
  if (analysis.unitMismatch.length) lim.push({ code: 'p_unit_mismatch', count: analysis.unitMismatch.length });
  const nameOnly = new Set(priceLines.filter((l) => l.identity === 'name').map((l) => l.pk)).size;
  if (nameOnly) lim.push({ code: 'p_name_identity', count: nameOnly });
  if (analysis.ambiguous.size) lim.push({ code: 'p_code_ambiguity', count: analysis.ambiguous.size });
  const posSpend = records.reduce((s, r) => s + (r.amount > 0 ? r.amount : 0), 0);
  const priced = priceLines.reduce((s, l) => s + l.amount, 0);
  if (posSpend > 0 && priced / posSpend < 0.8) lim.push({ code: 'p_price_coverage', pct: priced / posSpend });
  if (o.discountUnverified) lim.push({ code: 'p_discount_unverified' });
  if (policy === 'metric') lim.push({ code: 'p_metric_units' });

  const explain: PurchasingView['explain'] = {};
  for (const id of PURCHASE_KPI_ORDER) explain[id] = explainPurchaseInputs(id, curAgg, ctx);
  const sup = tables.supplier ?? null;
  const series: Series = { currency: o.series.currency, basis: o.series.basis };
  return {
    series, ctx, bounds: { dateMin, dateMax }, periods, comparable, kpis, priceChange: analysis.lfl, trend, aligned: alignedSeries(records, periods), tables,
    pareto: pDim ? { dimension: pDim, ...pareto(tables[pDim]!.rows) } : null,
    waterfall: wDim ? { dimension: wDim, data: waterfall(tables[wDim]!) } : null,
    composition: sup ? composition(sup) : [], bridge: comparable ? analysis.bridge : null, pairs: [...analysis.pairs].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)).slice(0, 50), variance: analysis.variance, historical: analysis.historical, quantities, priceItems,
    charts, warnings: periods.warnings, limitations: lim, explain, excluded: analysis.excluded, unitPolicy: policy, records, analysis,
  };
}

export type { PurchaseRecord };
export { productRef };
