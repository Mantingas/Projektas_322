import type { GenericMetric } from '../analytics/compare';
import type { AmountBasis, PurchaseRecord } from '../types';
import { aggregatePurchases } from './aggregate';
import type { PurchaseAggregate } from './aggregate';
import { comparableUnit, type UnitPolicy } from './units';

export type PurchaseMetricId = 'p_spend' | 'p_quantity' | 'p_documents' | 'p_suppliers' | 'p_concentration' | 'p_credits' | 'p_avg_price';

export interface PurchaseMetricContext {
  basis: AmountBasis;
  unitPolicy: UnitPolicy;
  /** The file has a unit column (without one, units are "not provided" and quantities of different products can still not be summed safely). */
  hasUnitColumn: boolean;
  /** Exactly one product is selected by the filters (makes an average price meaningful). */
  singleProduct: boolean;
}

export type PurchaseUnavailable = 'no_quantity' | 'mixed_units' | 'no_documents' | 'no_suppliers' | 'needs_single_product' | 'no_data' | 'few_suppliers' | 'unit_missing';

const MIN_COVERAGE = 0.8;
const ok = (value: number) => ({ value });
const no = (unavailable: PurchaseUnavailable) => ({ value: null as number | null, unavailable });

/** Units after the comparison policy. >1 entry = mixed units. */
function mergedUnits(a: PurchaseAggregate, policy: UnitPolicy): Map<string, number> {
  const m = new Map<string, number>();
  for (const [u, e] of a.qtyByUnit) {
    const c = comparableUnit(u || undefined, policy);
    m.set(c.unit ?? '', (m.get(c.unit ?? '') ?? 0) + e.qty * c.factor);
  }
  return m;
}

/**
 * The purchasing metric registry. Pure functions of a PurchaseAggregate, evaluated with the same comparison engine as sales
 * (compareWith). Quantities are only summed when every line shares ONE unit (after the explicit unit policy).
 */
export const PURCHASE_METRICS: Record<PurchaseMetricId, GenericMetric<PurchaseAggregate, PurchaseMetricContext>> = {
  p_spend: { id: 'p_spend', unit: 'money', higherIsBetter: false, neutral: true, evaluate: (a) => (a.lines ? ok(a.spend) : no('no_data')) },
  p_credits: { id: 'p_credits', unit: 'money', higherIsBetter: true, neutral: true, evaluate: (a) => (a.lines ? ok(a.credits) : no('no_data')) },
  p_quantity: {
    id: 'p_quantity', unit: 'qty', higherIsBetter: true, neutral: true,
    evaluate: (a, ctx) => {
      if (!a.lines || a.qtyLines / a.lines < MIN_COVERAGE) return no('no_quantity');
      const units = mergedUnits(a, ctx.unitPolicy);
      if (ctx.hasUnitColumn && units.has('')) return no('unit_missing');
      if (units.size !== 1) return no('mixed_units'); // kg + pcs + boxes is not a quantity
      return ok([...units.values()][0]!);
    },
  },
  p_documents: {
    id: 'p_documents', unit: 'count', higherIsBetter: true, neutral: true,
    evaluate: (a) => (!a.lines || a.linesWithDoc / a.lines < 0.95 ? no('no_documents') : ok([...a.docTotals.values()].filter((v) => v > 0).length)),
  },
  p_suppliers: {
    id: 'p_suppliers', unit: 'count', higherIsBetter: true, neutral: true,
    evaluate: (a) => (!a.lines || a.supplierLines / a.lines < MIN_COVERAGE ? no('no_suppliers') : ok([...a.supplierTotals.values()].filter((v) => v > 0).length)),
  },
  p_concentration: {
    id: 'p_concentration', unit: 'pct', higherIsBetter: false,
    evaluate: (a) => {
      if (!a.lines || a.supplierLines / a.lines < MIN_COVERAGE) return no('no_suppliers');
      const pos = [...a.supplierTotals.values()].filter((v) => v > 0);
      if (pos.length < 2) return no('few_suppliers');
      const total = pos.reduce((x, y) => x + y, 0);
      return ok(Math.max(...pos) / total);
    },
  },
  p_avg_price: {
    id: 'p_avg_price', unit: 'money', higherIsBetter: false,
    evaluate: (a, ctx) => {
      if (!ctx.singleProduct) return no('needs_single_product'); // averaging the prices of different products is meaningless
      let qty = 0;
      let amt = 0;
      const units = new Set<string>();
      for (const [u, b] of a.buyByUnit) {
        const c = comparableUnit(u || undefined, ctx.unitPolicy);
        units.add(c.unit ?? '');
        qty += b.qty * c.factor;
        amt += b.amount;
      }
      if (units.size > 1) return no('mixed_units');
      return qty > 0 ? ok(amt / qty) : no('no_quantity');
    },
  },
};

export const PURCHASE_KPI_ORDER: PurchaseMetricId[] = ['p_spend', 'p_quantity', 'p_documents', 'p_suppliers', 'p_concentration', 'p_credits', 'p_avg_price'];

/** Inputs behind a metric value, for the "how is this calculated" text. */
export function explainPurchaseInputs(id: PurchaseMetricId, a: PurchaseAggregate, ctx: PurchaseMetricContext): Record<string, number> {
  const docs = [...a.docTotals.values()];
  switch (id) {
    case 'p_spend': return { lines: a.lines, negative: a.negativeLines, credits: a.credits };
    case 'p_credits': return { lines: a.negativeLines };
    case 'p_quantity': return { lines: a.qtyLines, all: a.lines, units: mergedUnits(a, ctx.unitPolicy).size };
    case 'p_documents': return { docs: docs.length, count: docs.filter((v) => v > 0).length, credit: docs.filter((v) => v <= 0).length };
    case 'p_suppliers': return { count: [...a.supplierTotals.values()].filter((v) => v > 0).length, all: a.supplierTotals.size };
    case 'p_concentration': return { count: [...a.supplierTotals.values()].filter((v) => v > 0).length };
    case 'p_avg_price': return { lines: [...a.buyByUnit.values()].reduce((s, b) => s + b.lines, 0) };
  }
}

/** Which purchasing metrics the normalised file can support, and why not (import diagnostics). */
export function predictPurchaseMetrics(records: PurchaseRecord[], basis: AmountBasis): { id: string; available: boolean; reason?: string }[] {
  if (records.length === 0) return PURCHASE_KPI_ORDER.map((id) => ({ id, available: false, reason: 'no_data' }));
  const a = aggregatePurchases(records);
  const ctx: PurchaseMetricContext = { basis, unitPolicy: 'strict', hasUnitColumn: records.some((r) => r.unit !== undefined), singleProduct: false };
  return PURCHASE_KPI_ORDER.map((id) => {
    const v = PURCHASE_METRICS[id].evaluate(a, ctx);
    return v.value === null ? { id, available: false, reason: v.unavailable } : { id, available: true };
  });
}
