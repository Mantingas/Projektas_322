import type { SalesRecord } from '../types';

export type SalesDimension = 'customer' | 'product' | 'salesperson' | 'category';
export type PurchaseDimension = 'supplier' | 'product' | 'warehouse';
export type InventoryDimension = 'product' | 'warehouse' | 'category';
/** Any breakdown dimension of any module. */
export type Dimension = SalesDimension | PurchaseDimension;

export interface FilterSpec {
  dateFrom?: string;
  dateTo?: string;
  /** Entity keys (see keyOf). Empty / undefined = no restriction. */
  customers?: string[];
  products?: string[];
  salespeople?: string[];
  categories?: string[];
  /** Purchasing */
  suppliers?: string[];
  warehouses?: string[];
  /** Case-insensitive substring over customer, product, document, salesperson, category. */
  text?: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Identity of a customer / product. A stable CODE wins over the display name: two different customers that share a name stay two customers,
 * and one customer written in two ways ("UAB Beta" / "Beta, UAB") stays one as long as the code is the same. Without a code the normalised name is used
 * (that is all the file offers). Keys: `id:<code>` or `name:<name>`.
 */
const entity = (id: string | undefined, name: string | undefined): { key: string; label: string } | null => {
  if (id && id.trim()) return { key: `id:${norm(id)}`, label: (name && name.trim()) || id };
  if (name && name.trim()) return { key: `name:${norm(name)}`, label: name };
  return null;
};

export const dimensionOf = {
  customer: (r: SalesRecord) => entity(r.customerId, r.customerName),
  product: (r: SalesRecord) => entity(r.productId, r.productName),
  salesperson: (r: SalesRecord) => (r.salesperson ? { key: norm(r.salesperson), label: r.salesperson } : null),
  category: (r: SalesRecord) => (r.category ? { key: norm(r.category), label: r.category } : null),
} satisfies Record<SalesDimension, (r: SalesRecord) => { key: string; label: string } | null>;

/** Two different entities with the same label (e.g. two customers named "UAB Alfa") must be told apart on screen: the code is appended. */
export function disambiguateLabels<T extends { key: string; label: string }>(rows: T[]): T[] {
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.label, (count.get(r.label) ?? 0) + 1);
  return rows.map((r) => ((count.get(r.label) ?? 0) > 1 && r.key.startsWith('id:') ? { ...r, label: `${r.label} · ${r.key.slice(3)}` } : r));
}

export const hasDimension = (records: SalesRecord[], d: SalesDimension) => records.some((r) => dimensionOf[d](r));

const has = (list: string[] | undefined) => (list && list.length ? new Set(list) : null);

/** The single filter implementation used by KPIs, charts, tables, drill-down and reports. */
export function applyFilters(records: SalesRecord[], f: FilterSpec): SalesRecord[] {
  const cs = has(f.customers);
  const ps = has(f.products);
  const ss = has(f.salespeople);
  const cats = has(f.categories);
  const text = f.text?.trim().toLowerCase();
  if (!f.dateFrom && !f.dateTo && !cs && !ps && !ss && !cats && !text) return records;
  return records.filter((r) => {
    if (f.dateFrom && r.date < f.dateFrom) return false;
    if (f.dateTo && r.date > f.dateTo) return false;
    if (cs && !(dimensionOf.customer(r) && cs.has(dimensionOf.customer(r)!.key))) return false;
    if (ps && !(dimensionOf.product(r) && ps.has(dimensionOf.product(r)!.key))) return false;
    if (ss && !(dimensionOf.salesperson(r) && ss.has(dimensionOf.salesperson(r)!.key))) return false;
    if (cats && !(dimensionOf.category(r) && cats.has(dimensionOf.category(r)!.key))) return false;
    if (text) {
      const hay = [r.customerName, r.customerId, r.productName, r.productId, r.documentId, r.salesperson, r.category].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}

export const isFilterActive = (f: FilterSpec) =>
  Boolean(f.customers?.length || f.products?.length || f.salespeople?.length || f.categories?.length || f.suppliers?.length || f.warehouses?.length || f.text?.trim());
