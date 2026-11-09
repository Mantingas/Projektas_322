import type { PurchaseRecord } from '../types';
import { docKey } from '../import/merge';
import type { PurchaseDimension } from '../analytics/filters';
import { purchaseDimensionOf, supplierRef } from './entities';

/** One pass over purchase lines → everything the purchasing metrics need. */
export interface PurchaseAggregate {
  lines: number;
  /** Signed sum: purchases minus credit notes / returns. */
  spend: number;
  /** Sum of positive lines. */
  gross: number;
  /** Absolute sum of negative lines (credit notes, returns). */
  credits: number;
  negativeLines: number;
  linesWithDoc: number;
  docTotals: Map<string, number>;
  supplierLines: number;
  supplierTotals: Map<string, number>;
  /** Signed quantity per RAW unit code ('' = line without a unit) and the lines carrying a quantity. */
  qtyByUnit: Map<string, { qty: number; lines: number }>;
  qtyLines: number;
  /** Positive purchase lines only (price evidence): amount and quantity per raw unit. */
  buyByUnit: Map<string, { qty: number; amount: number; lines: number }>;
  /** Lines (with a quantity) that have no unit although the file has a unit column. */
  dates: Set<string>;
}

export const emptyPurchaseAggregate = (): PurchaseAggregate => ({
  lines: 0, spend: 0, gross: 0, credits: 0, negativeLines: 0, linesWithDoc: 0, docTotals: new Map(), supplierLines: 0, supplierTotals: new Map(),
  qtyByUnit: new Map(), qtyLines: 0, buyByUnit: new Map(), dates: new Set(),
});

export function addPurchase(a: PurchaseAggregate, r: PurchaseRecord): void {
  a.lines++;
  a.spend += r.amount;
  a.dates.add(r.date);
  if (r.amount > 0) a.gross += r.amount;
  else if (r.amount < 0) {
    a.credits += -r.amount;
    a.negativeLines++;
  }
  const dk = docKey(r);
  if (dk) {
    a.linesWithDoc++;
    a.docTotals.set(dk, (a.docTotals.get(dk) ?? 0) + r.amount);
  }
  const s = supplierRef(r);
  if (s) {
    a.supplierLines++;
    a.supplierTotals.set(s.key, (a.supplierTotals.get(s.key) ?? 0) + r.amount);
  }
  if (r.quantity !== undefined) {
    a.qtyLines++;
    const u = r.unit ?? '';
    const e = a.qtyByUnit.get(u) ?? { qty: 0, lines: 0 };
    e.qty += r.quantity;
    e.lines++;
    a.qtyByUnit.set(u, e);
    if (r.quantity > 0 && r.amount > 0) {
      const b = a.buyByUnit.get(u) ?? { qty: 0, amount: 0, lines: 0 };
      b.qty += r.quantity;
      b.amount += r.amount;
      b.lines++;
      a.buyByUnit.set(u, b);
    }
  }
}

export function aggregatePurchases(records: Iterable<PurchaseRecord>): PurchaseAggregate {
  const a = emptyPurchaseAggregate();
  for (const r of records) addPurchase(a, r);
  return a;
}

export interface PurchaseEntityAgg {
  key: string;
  label: string;
  agg: PurchaseAggregate;
}

/** Aggregates per entity; lines without the dimension go to `unassigned` so totals always reconcile. */
export function groupPurchaseAggregates(records: PurchaseRecord[], dim: PurchaseDimension): { groups: Map<string, PurchaseEntityAgg>; unassigned: PurchaseAggregate } {
  const groups = new Map<string, PurchaseEntityAgg>();
  const unassigned = emptyPurchaseAggregate();
  for (const r of records) {
    const k = purchaseDimensionOf[dim](r);
    if (!k) { addPurchase(unassigned, r); continue; }
    let g = groups.get(k.key);
    if (!g) groups.set(k.key, (g = { key: k.key, label: k.label, agg: emptyPurchaseAggregate() }));
    addPurchase(g.agg, r);
  }
  return { groups, unassigned };
}

export const inPurchaseSeries = (records: PurchaseRecord[], s: { currency: string; basis: string }) => records.filter((r) => r.currency === s.currency && r.basis === s.basis);
