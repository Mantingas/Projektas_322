import type { PurchaseRecord } from '../types';
import type { FilterSpec, PurchaseDimension } from '../analytics/filters';
import { supplierScope } from './keys';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export type IdentityBasis = 'sku' | 'name';

export interface ProductRef {
  key: string;
  label: string;
  /** "sku": identified by a product code from the file (a verified identifier, unless the code is ambiguous). "name": by name only – NOT verified. */
  identity: IdentityBasis;
}

/**
 * A product is identified by its code when the file has one; otherwise by its name, which is flagged as unverified.
 * Two different codes are never merged, and two different names under one code are reported (see `ambiguousCodes`).
 */
export function productRef(r: Pick<PurchaseRecord, 'productId' | 'productName'>): ProductRef | null {
  if (r.productId) return { key: `sku:${norm(r.productId)}`, label: r.productName ?? r.productId, identity: 'sku' };
  if (r.productName) return { key: `name:${norm(r.productName)}`, label: r.productName, identity: 'name' };
  return null;
}

export const supplierRef = (r: Pick<PurchaseRecord, 'supplierId' | 'supplierName'>) => {
  const key = supplierScope(r);
  return key ? { key, label: r.supplierName ?? r.supplierId! } : null;
};

export const warehouseRef = (r: Pick<PurchaseRecord, 'warehouse'>) => (r.warehouse ? { key: norm(r.warehouse), label: r.warehouse } : null);

export const purchaseDimensionOf: Record<PurchaseDimension, (r: PurchaseRecord) => { key: string; label: string } | null> = {
  supplier: supplierRef,
  product: (r) => productRef(r),
  warehouse: warehouseRef,
};

export const hasPurchaseDimension = (records: PurchaseRecord[], d: PurchaseDimension) => records.some((r) => purchaseDimensionOf[d](r));

/**
 * Codes that appear with more than one distinct product name. Supplier-specific or reused codes make price comparison unsafe,
 * so these products are excluded from comparisons and reported.
 */
export function ambiguousCodes(records: PurchaseRecord[]): Map<string, string[]> {
  const names = new Map<string, Set<string>>();
  for (const r of records) {
    if (!r.productId || !r.productName) continue;
    const k = `sku:${norm(r.productId)}`;
    (names.get(k) ?? names.set(k, new Set()).get(k)!).add(norm(r.productName));
  }
  const out = new Map<string, string[]>();
  for (const [k, set] of names) if (set.size > 1) out.set(k, [...set]);
  return out;
}

/** The one filter implementation for purchase lines (KPIs, charts, tables, drill-down and reports all call it). */
export function applyPurchaseFilters(records: PurchaseRecord[], f: FilterSpec): PurchaseRecord[] {
  const set = (l?: string[]) => (l && l.length ? new Set(l) : null);
  const ss = set(f.suppliers);
  const ps = set(f.products);
  const ws = set(f.warehouses);
  const text = f.text?.trim().toLowerCase();
  if (!f.dateFrom && !f.dateTo && !ss && !ps && !ws && !text) return records;
  return records.filter((r) => {
    if (f.dateFrom && r.date < f.dateFrom) return false;
    if (f.dateTo && r.date > f.dateTo) return false;
    if (ss) { const x = supplierRef(r); if (!x || !ss.has(x.key)) return false; }
    if (ps) { const x = productRef(r); if (!x || !ps.has(x.key)) return false; }
    if (ws) { const x = warehouseRef(r); if (!x || !ws.has(x.key)) return false; }
    if (text) {
      const hay = [r.supplierName, r.supplierId, r.productName, r.productId, r.documentId, r.warehouse].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}
