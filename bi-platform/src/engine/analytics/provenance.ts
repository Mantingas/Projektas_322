import type { SalesRecord } from '../types';
import { applyFilters, type FilterSpec } from './filters';
import { inRange } from './compare';
import type { Range } from './periods';
import type { Aggregate } from './aggregate';
import type { MetricId } from './metrics';

/** What a drill-down shows: filters + optional date range. The SAME filter engine the dashboard uses. */
export interface DrillSpec {
  filter: FilterSpec;
  range?: Range;
  /** Only negative lines (returns / credit notes) or only positive ones. */
  sign?: 'negative' | 'positive';
}

export function drillRecords(records: SalesRecord[], spec: DrillSpec): SalesRecord[] {
  const f = applyFilters(records, spec.filter);
  const g = spec.range ? inRange(f, spec.range) : f;
  return spec.sign ? g.filter((r) => (spec.sign === 'negative' ? r.amount < 0 : r.amount > 0)) : g;
}

export interface SourceSummary {
  importId: string;
  lines: number;
  revenue: number;
}

/** Which imports the underlying lines came from. */
export function sourcesOf(records: { importId?: string; amount: number }[]): SourceSummary[] {
  const m = new Map<string, SourceSummary>();
  for (const r of records) {
    const id = r.importId ?? '?';
    const s = m.get(id) ?? { importId: id, lines: 0, revenue: 0 };
    s.lines++;
    s.revenue += r.amount;
    m.set(id, s);
  }
  return [...m.values()].sort((a, b) => b.lines - a.lines);
}

/** Inputs behind a metric value, for the "how is this calculated" explanation. */
export function explainMetricInputs(id: MetricId, a: Aggregate): Record<string, number> {
  const orders = [...a.docTotals.values()].filter((v) => v > 0).length;
  switch (id) {
    case 'sales': return { lines: a.lines, positive: a.positiveLines, negative: a.negativeLines, returns: a.returns };
    case 'returns': return { lines: a.negativeLines };
    case 'quantity': return { lines: a.qtyLines, all: a.lines };
    case 'orders': return { docs: a.docTotals.size, orders, credit: a.docTotals.size - orders };
    case 'aov': return { orders };
    case 'customers': return { customers: [...a.customerTotals.values()].filter((v) => v > 0).length, all: a.customerTotals.size };
    case 'asp': return { lines: a.qtyLines, quantity: a.quantity };
    case 'margin': return { lines: a.costLines, positive: a.positiveLines };
  }
}
