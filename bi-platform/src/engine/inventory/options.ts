import type { InventoryRecord } from '../types';
import { inventoryDimensionOf, type InventoryDimension } from './entities';

/** Every entity of a dimension seen in the series (all dates), for the filter pickers. `value` = number of lines, used for ordering only. */
export function groupInventoryOptions(records: InventoryRecord[], dim: InventoryDimension): { key: string; label: string; value: number }[] {
  const m = new Map<string, { key: string; label: string; value: number }>();
  for (const r of records) {
    const e = inventoryDimensionOf[dim](r);
    if (!e) continue;
    const x = m.get(e.key) ?? { key: e.key, label: e.label, value: 0 };
    x.value++;
    m.set(e.key, x);
  }
  return [...m.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)).slice(0, 2000);
}
