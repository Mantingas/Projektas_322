import type { InventoryRecord } from '../types';
import type { FilterSpec, InventoryDimension } from '../analytics/filters';
import { productRef } from '../purchasing/entities';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export { productRef };
export const warehouseRef = (r: Pick<InventoryRecord, 'warehouse'>) => (r.warehouse ? { key: norm(r.warehouse), label: r.warehouse } : null);
export const categoryRef = (r: Pick<InventoryRecord, 'category'>) => (r.category ? { key: norm(r.category), label: r.category } : null);

export type { InventoryDimension };
export const inventoryDimensionOf: Record<InventoryDimension, (r: InventoryRecord) => { key: string; label: string } | null> = {
  product: (r) => productRef(r),
  warehouse: warehouseRef,
  category: categoryRef,
};
export const hasInventoryDimension = (records: InventoryRecord[], d: InventoryDimension) => records.some((r) => inventoryDimensionOf[d](r));

/** Product codes that appear with more than one product name. Movement-based conclusions (demand, cover) are withheld for them. */
export function ambiguousInventoryCodes(records: InventoryRecord[]): Set<string> {
  const names = new Map<string, Set<string>>();
  for (const r of records) {
    if (!r.productId || !r.productName) continue;
    const k = `sku:${norm(r.productId)}`;
    (names.get(k) ?? names.set(k, new Set()).get(k)!).add(norm(r.productName));
  }
  const out = new Set<string>();
  for (const [k, set] of names) if (set.size > 1) out.add(k);
  return out;
}

/** The one filter implementation for inventory lines (KPIs, charts, tables, drill-down, reports). */
export function applyInventoryFilters(records: InventoryRecord[], f: FilterSpec): InventoryRecord[] {
  const set = (l?: string[]) => (l && l.length ? new Set(l) : null);
  const ps = set(f.products);
  const ws = set(f.warehouses);
  const cs = set(f.categories);
  const text = f.text?.trim().toLowerCase();
  if (!f.dateFrom && !f.dateTo && !ps && !ws && !cs && !text) return records;
  return records.filter((r) => {
    if (f.dateFrom && r.date < f.dateFrom) return false;
    if (f.dateTo && r.date > f.dateTo) return false;
    if (ps) { const x = productRef(r); if (!x || !ps.has(x.key)) return false; }
    if (ws) { const x = warehouseRef(r); if (!x || !ws.has(x.key)) return false; }
    if (cs) { const x = categoryRef(r); if (!x || !cs.has(x.key)) return false; }
    if (text) {
      const hay = [r.productName, r.productId, r.documentId, r.warehouse, r.warehouseTo, r.category].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}
