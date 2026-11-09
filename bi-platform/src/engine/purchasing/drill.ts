import type { PurchaseRecord } from '../types';
import type { DrillSpec } from '../analytics/provenance';
import { inRange } from '../analytics/compare';
import { applyPurchaseFilters } from './entities';

/** Drill-down on the same filter engine the purchasing dashboard uses. */
export function drillPurchaseRecords(records: PurchaseRecord[], spec: DrillSpec): PurchaseRecord[] {
  const f = applyPurchaseFilters(records, spec.filter);
  const g = spec.range ? inRange(f, spec.range) : f;
  return spec.sign ? g.filter((r) => (spec.sign === 'negative' ? r.amount < 0 : r.amount > 0)) : g;
}
