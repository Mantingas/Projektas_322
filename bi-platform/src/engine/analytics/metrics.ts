import type { AmountBasis } from '../types';
import { comparableUnit } from '../purchasing/units';
import type { Aggregate } from './aggregate';

export type MetricId = 'sales' | 'returns' | 'quantity' | 'orders' | 'aov' | 'customers' | 'asp' | 'margin';
export type MetricUnit = 'money' | 'qty' | 'count' | 'pct';

export interface MetricContext {
  basis: AmountBasis;
  /** Exactly one product is selected by the filters (makes an average price meaningful). */
  singleProduct: boolean;
}

export type Unavailable =
  | 'no_quantity' | 'no_orders' | 'no_customers' | 'no_cost' | 'needs_single_product' | 'cost_needs_net' | 'no_data'
  | 'cost_revenue_coverage' | 'returns_cost_unknown' | 'mixed_units' | 'units_missing' | 'cost_suspect';

export interface MetricValue {
  id: MetricId;
  value: number | null;
  /** Why value is null. */
  unavailable?: Unavailable;
}

export interface MetricDef {
  id: MetricId;
  unit: MetricUnit;
  /** For "good" / "bad" colouring of changes. */
  higherIsBetter: boolean;
  evaluate(a: Aggregate, ctx: MetricContext): MetricValue;
}

export const MIN_COVERAGE = 0.8;
/** Returns whose cost is unknown may be at most this share of sales before the margin is withheld. */
export const MAX_UNKNOWN_RETURNS = 0.02;

export interface MarginResult {
  /** margin as a fraction of the revenue the margin is based on */
  value: number;
  /** gross profit of the covered lines, NET of returns whose cost is known */
  profit: number;
  /** the revenue the margin is based on (covered sales minus known returns) */
  base: number;
  /** share of positive lines / of positive REVENUE that has a usable cost */
  lineCoverage: number;
  revenueCoverage: number;
  /** true when the margin is based on all positive sales (the "whole turnover" margin); false = only the lines that have a cost */
  wholeTurnover: boolean;
  /** returns netted into the margin, and the (tiny) returns left out because their cost sign is unknown */
  returnsIncluded: number;
  returnsExcluded: number;
  zeroCostLines: number;
  suspectCostLines: number;
  /** lines whose cost was ignored as unreliable: negative / absurd costs and a column of zeros that stands for "unknown" */
  ignoredCostLines: number;
}

/** Cost values that are NOT used: negative or absurd costs, and zeros when the zeros are the column's placeholder for "unknown". */
export function ignoredCostLines(a: Aggregate): number {
  const costed = a.costLines + a.zeroCostLines;
  const placeholderZero = costed > 0 && a.zeroCostLines / costed >= 0.5;
  return a.suspectCostLines + (placeholderZero ? a.zeroCostLines : 0);
}

/**
 * THE margin rule (used by the KPI, the tables and the findings):
 *  - only for sales WITHOUT VAT;
 *  - cost must be usable on ≥ 80 % of positive lines AND on ≥ 80 % of positive REVENUE (90 % of lines can still be 30 % of the money);
 *  - zero cost is a real value unless it is the column's placeholder for "unknown" (≥ half of the cost lines are 0 → treated as unknown);
 *    negative or absurd costs are never used;
 *  - returns are netted: their cost must have the sign of the amount. If returns of unknown cost exceed 2 % of sales the margin is withheld.
 */
export function evaluateMargin(a: Aggregate, basis: AmountBasis): { ok: true; r: MarginResult } | { ok: false; reason: Unavailable } {
  if (basis !== 'net') return { ok: false, reason: 'cost_needs_net' };
  const costed = a.costLines + a.zeroCostLines;
  const ignored = ignoredCostLines(a);
  if (!a.positiveLines || a.gross <= 0 || (costed === 0 && a.suspectCostLines === 0)) return { ok: false, reason: 'no_cost' };
  if (costed === 0) return { ok: false, reason: 'cost_suspect' };
  const placeholderZero = a.zeroCostLines / costed >= 0.5;
  const lines = a.costLines + (placeholderZero ? 0 : a.zeroCostLines);
  const rev = a.revenueWithCost + (placeholderZero ? 0 : a.zeroCostRevenue);
  const lineCoverage = lines / a.positiveLines;
  const revenueCoverage = rev / a.gross;
  if (lineCoverage < MIN_COVERAGE || rev <= 0) return { ok: false, reason: ignored > 0 ? 'cost_suspect' : 'no_cost' };
  if (revenueCoverage < MIN_COVERAGE) return { ok: false, reason: ignored > 0 ? 'cost_suspect' : 'cost_revenue_coverage' };
  if (a.returnsUnknownRevenue > MAX_UNKNOWN_RETURNS * a.gross) return { ok: false, reason: 'returns_cost_unknown' };
  const base = rev - a.returnsKnownRevenue;
  const profit = rev - a.cost - (a.returnsKnownRevenue + a.returnsKnownCost);
  if (base <= 0) return { ok: false, reason: 'no_cost' };
  return {
    ok: true,
    r: {
      value: profit / base, profit, base, lineCoverage, revenueCoverage, wholeTurnover: revenueCoverage >= 0.999 && a.returnsUnknownRevenue === 0,
      returnsIncluded: a.returnsKnownRevenue, returnsExcluded: a.returnsUnknownRevenue, zeroCostLines: a.zeroCostLines, suspectCostLines: a.suspectCostLines, ignoredCostLines: ignored,
    },
  };
}

/** Quantity of one aggregate expressed in ONE unit, or why that is not possible. Units are never guessed: only exact metric conversions (g→kg, ml→l, …) are applied. */
export function quantityInOneUnit(a: Aggregate): { ok: true; value: number; unit?: string } | { ok: false; reason: 'mixed_units' | 'units_missing' } {
  const named = [...a.qtyByUnit.keys()].filter((u) => u !== '');
  if (named.length === 0) return { ok: true, value: a.quantity }; // the file states no units at all: nothing to check (disclosed as a limitation)
  if (a.qtyByUnit.has('')) return { ok: false, reason: 'units_missing' };
  const totals = new Map<string, number>();
  for (const [u, q] of a.qtyByUnit) {
    const c = comparableUnit(u, 'metric');
    totals.set(c.unit ?? u, (totals.get(c.unit ?? u) ?? 0) + q * c.factor);
  }
  if (totals.size > 1) return { ok: false, reason: 'mixed_units' };
  const [unit, value] = [...totals][0]!;
  return { ok: true, value, unit };
}
const ok = (id: MetricId, value: number): MetricValue => ({ id, value });
const no = (id: MetricId, unavailable: Unavailable): MetricValue => ({ id, value: null, unavailable });

/**
 * THE metric registry. A metric is a pure function of an Aggregate: the same formula feeds KPI cards, comparison tables,
 * rankings, drill-down headers and reports. Future modules register their own definitions here.
 */
export const METRICS: Record<MetricId, MetricDef> = {
  sales: { id: 'sales', unit: 'money', higherIsBetter: true, evaluate: (a) => (a.lines ? ok('sales', a.revenue) : no('sales', 'no_data')) },
  returns: { id: 'returns', unit: 'money', higherIsBetter: false, evaluate: (a) => (a.lines ? ok('returns', a.returns) : no('returns', 'no_data')) },
  quantity: {
    id: 'quantity', unit: 'qty', higherIsBetter: true,
    evaluate: (a) => {
      if (!a.lines || a.qtyLines / a.lines < MIN_COVERAGE) return no('quantity', 'no_quantity');
      const q = quantityInOneUnit(a);
      return q.ok ? ok('quantity', q.value) : no('quantity', q.reason);
    },
  },
  orders: {
    id: 'orders', unit: 'count', higherIsBetter: true,
    evaluate: (a) => {
      if (!a.lines || a.linesWithDoc / a.lines < 0.95) return no('orders', 'no_orders');
      return ok('orders', [...a.docTotals.values()].filter((v) => v > 0).length); // credit notes are not orders
    },
  },
  aov: {
    id: 'aov', unit: 'money', higherIsBetter: true,
    evaluate: (a) => {
      if (!a.lines || a.linesWithDoc / a.lines < 0.95) return no('aov', 'no_orders');
      const pos = [...a.docTotals.values()].filter((v) => v > 0);
      return pos.length ? ok('aov', pos.reduce((x, y) => x + y, 0) / pos.length) : no('aov', 'no_orders');
    },
  },
  customers: {
    id: 'customers', unit: 'count', higherIsBetter: true,
    evaluate: (a) => (a.lines && a.customerLines / a.lines >= MIN_COVERAGE ? ok('customers', [...a.customerTotals.values()].filter((v) => v > 0).length) : no('customers', 'no_customers')),
  },
  asp: {
    id: 'asp', unit: 'money', higherIsBetter: true,
    evaluate: (a, ctx) => {
      if (!ctx.singleProduct) return no('asp', 'needs_single_product'); // averaging prices of different products is meaningless
      if (!a.lines || a.qtyLines / a.lines < MIN_COVERAGE) return no('asp', 'no_quantity');
      const q = quantityInOneUnit(a);
      if (!q.ok) return no('asp', q.reason);
      return q.value > 0 ? ok('asp', a.revenueWithQty / q.value) : no('asp', 'no_quantity');
    },
  },
  margin: {
    id: 'margin', unit: 'pct', higherIsBetter: true,
    evaluate: (a, ctx) => {
      const m = evaluateMargin(a, ctx.basis);
      return m.ok ? ok('margin', m.r.value) : no('margin', m.reason);
    },
  },
};

export const KPI_ORDER: MetricId[] = ['sales', 'quantity', 'orders', 'aov', 'customers', 'asp', 'margin', 'returns'];

export const evaluate = (id: MetricId, a: Aggregate, ctx: MetricContext) => METRICS[id].evaluate(a, ctx);
