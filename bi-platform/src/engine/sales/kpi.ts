import type { AmountBasis, SalesRecord } from '../types';
import { aggregate } from '../analytics/aggregate';
import { dimensionOf } from '../analytics/filters';
import { evaluateMargin } from '../analytics/metrics';

export interface Series {
  currency: string;
  basis: AmountBasis;
  lines: number;
  revenue: number;
}

/** Records in different currencies / VAT bases must never be added together. */
export function listSeries(records: SalesRecord[]): Series[] {
  const m = new Map<string, Series>();
  for (const r of records) {
    const k = `${r.currency}|${r.basis}`;
    const s = m.get(k) ?? { currency: r.currency, basis: r.basis, lines: 0, revenue: 0 };
    s.lines++;
    s.revenue += r.amount;
    m.set(k, s);
  }
  return [...m.values()].sort((a, b) => b.lines - a.lines);
}

export const inSeries = (records: SalesRecord[], s: Pick<Series, 'currency' | 'basis'>) =>
  records.filter((r) => r.currency === s.currency && r.basis === s.basis);

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
/** Same identity rule as every dashboard table and filter (code before name): see analytics/filters.ts. */
export const customerOf = (r: SalesRecord) => dimensionOf.customer(r);
export const productOf = (r: SalesRecord) => dimensionOf.product(r);
export const salespersonOf = (r: SalesRecord) => (r.salesperson ? { key: norm(r.salesperson), label: r.salesperson } : null);

export interface Group {
  key: string;
  label: string;
  revenue: number;
  lines: number;
  quantity: number;
  cost: number;
  /** revenue of lines that have a cost, used for margin */
  revenueWithCost: number;
}

export function groupBy(records: SalesRecord[], by: (r: SalesRecord) => { key: string; label: string } | null): Map<string, Group> {
  const m = new Map<string, Group>();
  for (const r of records) {
    const k = by(r);
    if (!k) continue;
    const g = m.get(k.key) ?? { key: k.key, label: k.label, revenue: 0, lines: 0, quantity: 0, cost: 0, revenueWithCost: 0 };
    g.revenue += r.amount;
    g.lines++;
    g.quantity += r.quantity ?? 0;
    if (r.cost !== undefined && r.amount > 0) {
      g.cost += r.cost;
      g.revenueWithCost += r.amount;
    }
    m.set(k.key, g);
  }
  return m;
}

export interface Periods {
  days: number;
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
  current: SalesRecord[];
  previous: SalesRecord[];
  /** Both windows have the same number of days (always true for the legacy rolling split). */
  equivalent?: boolean;
  previousDays?: number;
}

/** Two equal-length windows ending at the latest date. Null when the history is too short to compare honestly. */
export function splitPeriods(records: SalesRecord[], dateMin: string, dateMax: string): Periods | null {
  const span = daysBetween(dateMin, dateMax) + 1;
  if (span < 14) return null;
  const days = span >= 60 ? 30 : Math.floor(span / 2);
  const currentTo = dateMax;
  const currentFrom = addDays(dateMax, -(days - 1));
  const previousTo = addDays(currentFrom, -1);
  const previousFrom = addDays(previousTo, -(days - 1));
  return {
    days,
    currentFrom,
    currentTo,
    previousFrom,
    previousTo,
    current: records.filter((r) => r.date >= currentFrom && r.date <= currentTo),
    previous: records.filter((r) => r.date >= previousFrom && r.date <= previousTo),
  };
}

export interface SalesKpis {
  currency: string;
  basis: AmountBasis;
  revenue: number;
  lines: number;
  documents?: number;
  customers?: number;
  products?: number;
  quantity?: number;
  /** Documents whose total is positive (credit notes are not orders). */
  orders?: number;
  /** Sales of positive documents / orders. */
  averageDocumentValue?: number;
  dateMin: string;
  dateMax: string;
  monthly: { month: string; revenue: number }[];
  /** Present only when cost data covers enough lines. Never estimated. */
  margin?: { costCoverage: number; revenueCoverage: number; profit: number; marginPct: number; wholeTurnover: boolean };
}

export const MIN_COST_COVERAGE = 0.8;

export function computeKpis(records: SalesRecord[], series: Pick<Series, 'currency' | 'basis'>): SalesKpis | null {
  if (records.length === 0) return null;
  let revenue = 0;
  let dateMin = records[0]!.date;
  let dateMax = records[0]!.date;
  const docs = new Set<string>();
  const customers = new Set<string>();
  const products = new Set<string>();
  const monthly = new Map<string, number>();
  let qty = 0;
  let hasQty = false;
  for (const r of records) {
    revenue += r.amount;
    if (r.date < dateMin) dateMin = r.date;
    if (r.date > dateMax) dateMax = r.date;
    if (r.documentId) {
      const dk = r.documentId.trim().toLowerCase();
      docs.add(dk);
    }
    const c = customerOf(r);
    if (c) customers.add(c.key);
    const p = productOf(r);
    if (p) products.add(p.key);
    if (r.quantity !== undefined) {
      qty += r.quantity;
      hasQty = true;
    }
    const mk = r.date.slice(0, 7);
    monthly.set(mk, (monthly.get(mk) ?? 0) + r.amount);
  }
  const kpis: SalesKpis = {
    currency: series.currency,
    basis: series.basis,
    revenue,
    lines: records.length,
    documents: docs.size || undefined,
    customers: customers.size || undefined,
    products: products.size || undefined,
    quantity: hasQty ? qty : undefined,
    orders: undefined,
    averageDocumentValue: undefined,
    dateMin,
    dateMax,
    monthly: [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, rev]) => ({ month, revenue: rev })),
  };
  const agg = aggregate(records);
  const positiveDocs = [...agg.docTotals.values()].filter((v) => v > 0);
  if (positiveDocs.length) {
    kpis.orders = positiveDocs.length;
    kpis.averageDocumentValue = positiveDocs.reduce((a, b) => a + b, 0) / positiveDocs.length;
  }
  // One margin rule for KPI, tables and findings (see evaluateMargin): net basis, cost on ≥ 80 % of lines AND of revenue, returns netted.
  const m = evaluateMargin(agg, series.basis);
  if (m.ok) kpis.margin = { costCoverage: m.r.lineCoverage, revenueCoverage: m.r.revenueCoverage, profit: m.r.profit, marginPct: m.r.value, wholeTurnover: m.r.wholeTurnover };
  return kpis;
}
