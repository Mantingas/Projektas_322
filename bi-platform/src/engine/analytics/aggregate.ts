import type { AmountBasis, SalesRecord } from '../types';
import { dimensionOf, type SalesDimension } from './filters';

/** Everything any metric needs, computed in ONE pass. All KPIs, charts, tables and reports derive from this. */
export interface Aggregate {
  lines: number;
  revenue: number;
  /** Sum of positive lines. */
  gross: number;
  /** Absolute sum of negative lines (returns / credit notes). */
  returns: number;
  negativeLines: number;
  /** Lines carrying a quantity, and the sums over exactly those lines. */
  qtyLines: number;
  quantity: number;
  revenueWithQty: number;
  linesWithDoc: number;
  docTotals: Map<string, number>;
  customerLines: number;
  customerTotals: Map<string, number>;
  positiveLines: number;
  /** Positive lines whose cost is plausible (positive and not absurdly large). Cost of lines with a suspect cost is never used. */
  costLines: number;
  revenueWithCost: number;
  cost: number;
  /** Positive lines with a cost of exactly 0: a real zero cost or a placeholder for "unknown" – decided where the margin is evaluated. */
  zeroCostLines: number;
  zeroCostRevenue: number;
  /** Positive lines with a negative or absurd cost: not used. */
  suspectCostLines: number;
  /** Returns (negative lines): revenue and cost of those whose cost has the sign of the amount (reliable), and revenue of the rest. */
  returnsKnownRevenue: number;
  returnsKnownCost: number;
  returnsUnknownRevenue: number;
  /** Quantity by unit code ('' = the line has a quantity but no unit); lines without a quantity are not here. */
  qtyByUnit: Map<string, number>;
  dates: Set<string>;
}

/** A cost above this multiple of the price is treated as a data error, not as a loss-making sale. */
export const EXTREME_COST_FACTOR = 5;

export const emptyAggregate = (): Aggregate => ({
  lines: 0, revenue: 0, gross: 0, returns: 0, negativeLines: 0, qtyLines: 0, quantity: 0, revenueWithQty: 0, linesWithDoc: 0, docTotals: new Map(),
  customerLines: 0, customerTotals: new Map(), positiveLines: 0, costLines: 0, revenueWithCost: 0, cost: 0, zeroCostLines: 0, zeroCostRevenue: 0, suspectCostLines: 0,
  returnsKnownRevenue: 0, returnsKnownCost: 0, returnsUnknownRevenue: 0, qtyByUnit: new Map(), dates: new Set(),
});

export function addToAggregate(a: Aggregate, r: SalesRecord): void {
  a.lines++;
  a.revenue += r.amount;
  a.dates.add(r.date);
  if (r.amount > 0) {
    a.gross += r.amount;
    a.positiveLines++;
    if (r.cost !== undefined) {
      if (r.cost < 0 || r.cost > EXTREME_COST_FACTOR * r.amount) a.suspectCostLines++;
      else if (r.cost === 0) { a.zeroCostLines++; a.zeroCostRevenue += r.amount; }
      else {
        a.costLines++;
        a.revenueWithCost += r.amount;
        a.cost += r.cost;
      }
    }
  } else if (r.amount < 0) {
    a.returns += -r.amount;
    a.negativeLines++;
    // the cost of a return reverses cost: it must carry the sign of the amount (≤ 0). A positive cost on a return has an unknown meaning.
    if (r.cost !== undefined && r.cost <= 0) { a.returnsKnownRevenue += -r.amount; a.returnsKnownCost += r.cost; }
    else a.returnsUnknownRevenue += -r.amount;
  }
  if (r.quantity !== undefined) {
    a.qtyLines++;
    a.quantity += r.quantity;
    a.revenueWithQty += r.amount;
    a.qtyByUnit.set(r.unit ?? '', (a.qtyByUnit.get(r.unit ?? '') ?? 0) + r.quantity);
  }
  const c = dimensionOf.customer(r);
  if (r.documentId) {
    a.linesWithDoc++;
    // a document is identified by number AND year AND customer: numbering that restarts every year, or the same number for two customers, must not merge documents
    const dk = `${r.currency}|${r.date.slice(0, 4)}|${r.documentId.trim().toLowerCase()}|${c?.key ?? ''}`;
    a.docTotals.set(dk, (a.docTotals.get(dk) ?? 0) + r.amount);
  }
  if (c) {
    a.customerLines++;
    a.customerTotals.set(c.key, (a.customerTotals.get(c.key) ?? 0) + r.amount);
  }
}

export function aggregate(records: Iterable<SalesRecord>): Aggregate {
  const a = emptyAggregate();
  for (const r of records) addToAggregate(a, r);
  return a;
}

export interface Series {
  currency: string;
  basis: AmountBasis;
}

/** Records of a single currency + VAT basis. Mixing them in one metric would be meaningless. */
export const inSeries = (records: SalesRecord[], s: Series) => records.filter((r) => r.currency === s.currency && r.basis === s.basis);

export interface EntityAgg {
  key: string;
  label: string;
  agg: Aggregate;
}

/** Aggregates per entity of a dimension. Lines without the dimension go to `unassigned` so totals always reconcile. */
export function groupAggregates(records: SalesRecord[], dim: SalesDimension): { groups: Map<string, EntityAgg>; unassigned: Aggregate } {
  const groups = new Map<string, EntityAgg>();
  const unassigned = emptyAggregate();
  for (const r of records) {
    const k = dimensionOf[dim](r);
    if (!k) {
      addToAggregate(unassigned, r);
      continue;
    }
    let g = groups.get(k.key);
    if (!g) groups.set(k.key, (g = { key: k.key, label: k.label, agg: emptyAggregate() }));
    addToAggregate(g.agg, r);
  }
  return { groups, unassigned };
}
