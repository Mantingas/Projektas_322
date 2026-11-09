import type { InventoryRecord } from '../types';
import type { DrillSpec } from '../analytics/provenance';
import { applyInventoryFilters } from './entities';
import { lineValue, positionAt, SnapIndex } from './position';

/**
 * The lines behind an inventory number – built with the SAME filter, the same snapshot selection (`positionAt`) and the same date range
 * as the dashboard, so a drill-down total equals the KPI it explains.
 */
export function drillInventoryRecords(records: InventoryRecord[], spec: DrillSpec): InventoryRecord[] {
  const f = applyInventoryFilters(records, { ...spec.filter, dateFrom: undefined, dateTo: undefined });
  if (spec.asOf) {
    const pos = positionAt(new SnapIndex(f.filter((r) => r.kind === 'snapshot')), spec.asOf, { policy: 'strict', unitInKey: false });
    return pos ? pos.lines.map((l) => l.rec) : [];
  }
  let rows = f.filter((r) => r.kind === 'movement');
  if (spec.range) rows = rows.filter((r) => r.date >= spec.range!.from && r.date <= spec.range!.to);
  if (spec.moveTypes?.length) rows = rows.filter((r) => spec.moveTypes!.includes(r.movementType ?? 'unknown'));
  if (spec.sign) rows = rows.filter((r) => (spec.sign === 'negative' ? (r.quantity ?? 0) < 0 : (r.quantity ?? 0) > 0));
  return rows;
}

export const inventoryLineAmount = (r: InventoryRecord): number => lineValue(r) ?? 0;
