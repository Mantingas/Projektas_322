import type { SalesRecord } from '../types';

export type Dimension = 'customer' | 'product' | 'salesperson' | 'category';

export interface FilterSpec {
  dateFrom?: string;
  dateTo?: string;
  /** Entity keys (see keyOf). Empty / undefined = no restriction. */
  customers?: string[];
  products?: string[];
  salespeople?: string[];
  categories?: string[];
  /** Case-insensitive substring over customer, product, document, salesperson, category. */
  text?: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export const dimensionOf = {
  customer: (r: SalesRecord) => (r.customerName ?? r.customerId) ? { key: norm((r.customerName ?? r.customerId)!), label: (r.customerName ?? r.customerId)! } : null,
  product: (r: SalesRecord) => (r.productName ?? r.productId) ? { key: norm((r.productName ?? r.productId)!), label: (r.productName ?? r.productId)! } : null,
  salesperson: (r: SalesRecord) => (r.salesperson ? { key: norm(r.salesperson), label: r.salesperson } : null),
  category: (r: SalesRecord) => (r.category ? { key: norm(r.category), label: r.category } : null),
} satisfies Record<Dimension, (r: SalesRecord) => { key: string; label: string } | null>;

export const hasDimension = (records: SalesRecord[], d: Dimension) => records.some((r) => dimensionOf[d](r));

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
  Boolean(f.customers?.length || f.products?.length || f.salespeople?.length || f.categories?.length || f.text?.trim());
