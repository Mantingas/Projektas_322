import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { commitImport, loadAllSales } from '@/db/store';
import { buildDashboard, trendTotal } from '@/engine/analytics/dashboard';
import { aggregate, groupAggregates } from '@/engine/analytics/aggregate';
import { alignedSeries, comparePeriods, entityTable, inRange, pareto, salesTrend, topBottom, waterfall } from '@/engine/analytics/compare';
import { applyFilters, dimensionOf } from '@/engine/analytics/filters';
import { drillRecords, sourcesOf } from '@/engine/analytics/provenance';
import { planCharts } from '@/engine/analytics/charts';
import { resolvePeriods } from '@/engine/analytics/periods';
import { KPI_ORDER, type MetricContext } from '@/engine/analytics/metrics';
import { assignKeys } from '@/engine/import/keys';
import { sha256Hex } from '@/engine/import/hash';
import { buildFixtures, type Fixture } from './fixtures/formats';
import { runFixture } from './helpers';
import { makeTruth, type TruthLine } from './fixtures/truth';
import type { SalesRecord } from '@/engine/types';

const mk = (o: Partial<SalesRecord> = {}): SalesRecord => ({
  key: Math.random().toString(36), date: '2025-03-10', documentId: 'D' + Math.random().toString(36).slice(2, 6), customerName: 'A', productName: 'P', quantity: 1,
  amount: 100, basis: 'net', currency: 'EUR', sourceRow: 1, ...o,
});
const NET = { currency: 'EUR', basis: 'net' as const };
const CTX: MetricContext = { basis: 'net', singleProduct: false };
const bounds = (dateMin: string, dateMax: string) => ({ dateMin, dateMax });

// ───────────── independent reference calculations (plain loops over the raw truth, no engine code) ─────────────
function ref(truth: TruthLine[], from: string, to: string) {
  const rows = truth.filter((t) => t.date >= from && t.date <= to);
  const docs = new Map<string, number>();
  const cust = new Map<string, number>();
  let net = 0, qty = 0, cost = 0, revCost = 0, returns = 0;
  for (const t of rows) {
    net += t.net;
    qty += t.qty;
    docs.set(t.doc, (docs.get(t.doc) ?? 0) + t.net);
    cust.set(t.customer, (cust.get(t.customer) ?? 0) + t.net);
    if (t.net < 0) returns += -t.net;
    // Phase 10B (M2): margin is NET of returns. Here every line (incl. credit notes, whose cost has the sign of their amount) has a cost, so the whole turnover is used.
    if (t.net !== 0) { cost += t.cost; revCost += t.net; }
  }
  const orders = [...docs.values()].filter((v) => v > 0);
  return {
    net: net / 100, qty, returns: returns / 100,
    orders: orders.length, aov: orders.length ? orders.reduce((a, b) => a + b, 0) / 100 / orders.length : null,
    customers: [...cust.values()].filter((v) => v > 0).length, margin: revCost ? (revCost - cost) / revCost : null, lines: rows.length,
  };
}

let fx: Fixture[] = [];
let recs: SalesRecord[] = [];
// Phase 10B (I1): entity filter keys are `id:<code>` when the file has a code, else `name:<name>`: take them from the engine instead of hard-coding the old lower-cased names
const ckey = (name: string) => dimensionOf.customer(recs.find((r) => r.customerName === name)!)!.key;
const pkey = (name: string) => dimensionOf.product(recs.find((r) => r.productName === name)!)!.key;
let truth: TruthLine[] = [];
beforeAll(async () => {
  fx = await buildFixtures();
  const f = fx.find((x) => x.id === 'lt-xlsx-title')!; // has cost, category, doc ids
  truth = f.truth;
  recs = (await runFixture(f)).records;
});
const get = (m: ReturnType<typeof comparePeriods>, id: string) => m.metrics.find((x) => x.id === id)!;

describe('period resolution', () => {
  const b = bounds('2025-01-01', '2025-12-15');
  it('month over month is like-for-like and flags the partial current month', () => {
    const p = resolvePeriods({ preset: 'mom' }, b);
    expect(p.current).toEqual({ from: '2025-12-01', to: '2025-12-15' });
    expect(p.previous).toEqual({ from: '2025-11-01', to: '2025-11-15' });
    expect(p.equivalent).toBe(true);
    expect(p.warnings).toContainEqual({ code: 'partial_current', elapsed: 15, total: 31 });
  });
  it('comparing a partial month with the whole previous month needs an explicit choice and always warns', () => {
    const p = resolvePeriods({ preset: 'mom', fullPrevious: true }, b);
    expect(p.previous).toEqual({ from: '2025-11-01', to: '2025-11-30' });
    expect(p.warnings.map((w) => w.code)).toContain('previous_full_vs_partial');
    expect(p.equivalent).toBe(false);
  });
  it('a complete current month has no partial warning', () => {
    const p = resolvePeriods({ preset: 'mom' }, bounds('2025-01-01', '2025-11-30'));
    expect(p.warnings.map((w) => w.code)).not.toContain('partial_current');
    expect(p.current).toEqual({ from: '2025-11-01', to: '2025-11-30' });
    expect(p.previous).toEqual({ from: '2025-10-01', to: '2025-10-30' }); // equal length (30 days) by default
  });
  it('previous month shorter than elapsed days is capped, not silently stretched', () => {
    const p = resolvePeriods({ preset: 'mom' }, bounds('2025-01-01', '2025-03-31'));
    expect(p.previous).toEqual({ from: '2025-02-01', to: '2025-02-28' });
    expect(p.warnings.map((w) => w.code)).toContain('previous_capped');
  });
  it('week over week uses ISO weeks and flags a partial week', () => {
    const p = resolvePeriods({ preset: 'wow' }, bounds('2025-01-01', '2025-12-17')); // Wednesday
    expect(p.current).toEqual({ from: '2025-12-15', to: '2025-12-17' });
    expect(p.previous).toEqual({ from: '2025-12-08', to: '2025-12-10' });
  });
  it('day over day, rolling windows and year over year', () => {
    expect(resolvePeriods({ preset: 'dod' }, b).previous).toEqual({ from: '2025-12-14', to: '2025-12-14' });
    const r30 = resolvePeriods({ preset: 'r30' }, b);
    expect(r30.current).toEqual({ from: '2025-11-16', to: '2025-12-15' });
    expect(r30.previous).toEqual({ from: '2025-10-17', to: '2025-11-15' });
    expect(resolvePeriods({ preset: 'r7' }, b).currentDays).toBe(7);
    expect(resolvePeriods({ preset: 'r90' }, b).previousDays).toBe(90);
    const y = resolvePeriods({ preset: 'yoy' }, bounds('2024-01-01', '2025-12-15'));
    expect(y.previous).toEqual({ from: '2024-12-01', to: '2024-12-15' });
  });
  it('custom ranges of different length are flagged', () => {
    const p = resolvePeriods({ preset: 'custom', custom: { current: { from: '2025-03-01', to: '2025-03-31' }, previous: { from: '2025-02-01', to: '2025-02-28' } } }, b);
    expect(p.warnings).toContainEqual({ code: 'length_mismatch', current: 31, previous: 28 });
  });
  it('missing history is reported: previous period before the data, or starting late', () => {
    const none = resolvePeriods({ preset: 'r30' }, bounds('2025-12-01', '2025-12-15'));
    expect(none.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['no_previous_data', 'history_starts_late']));
    const late = resolvePeriods({ preset: 'r30' }, bounds('2025-11-01', '2025-12-15'));
    expect(late.warnings.map((w) => w.code)).toContain('history_starts_late');
    expect(late.warnings.map((w) => w.code)).not.toContain('no_previous_data');
  });
  it('sparse data inside a period is reported', () => {
    const dates = new Set(['2025-11-20', '2025-11-21', '2025-12-10']);
    const p = resolvePeriods({ preset: 'r30' }, { dateMin: '2025-10-17', dateMax: '2025-12-15', dates });
    expect(p.warnings.map((w) => w.code)).toContain('sparse_data');
  });
});

describe('KPIs equal independent reference values', () => {
  for (const preset of ['r30', 'mom', 'r90'] as const) {
    it(`${preset}: every KPI matches a plain-loop calculation`, () => {
      const p = resolvePeriods({ preset }, bounds('2025-09-01', '2025-12-15'));
      const m = comparePeriods(recs, p, KPI_ORDER, CTX);
      const c = ref(truth, p.current.from, p.current.to);
      const q = ref(truth, p.previous.from, p.previous.to);
      expect(get(m, 'sales').current).toBeCloseTo(c.net, 2);
      expect(get(m, 'sales').previous).toBeCloseTo(q.net, 2);
      expect(get(m, 'sales').abs).toBeCloseTo(c.net - q.net, 2);
      expect(get(m, 'sales').pct).toBeCloseTo((c.net - q.net) / Math.abs(q.net), 6);
      expect(get(m, 'quantity').current).toBe(c.qty);
      expect(get(m, 'orders').current).toBe(c.orders);
      expect(get(m, 'orders').previous).toBe(q.orders);
      expect(get(m, 'aov').current).toBeCloseTo(c.aov!, 4);
      expect(get(m, 'customers').current).toBe(c.customers);
      expect(get(m, 'margin').current).toBeCloseTo(c.margin!, 6);
      expect(get(m, 'returns').current).toBeCloseTo(c.returns, 2);
    });
  }
  it('average selling price exists only for a single product', () => {
    const p = resolvePeriods({ preset: 'r30' }, bounds('2025-09-01', '2025-12-15'));
    expect(get(comparePeriods(recs, p, ['asp'], CTX), 'asp').status).toBe('unavailable');
    const one = truth[0]!.product;
    const sub = applyFilters(recs, { products: [pkey(one)] });
    const m = comparePeriods(sub, p, ['asp'], { ...CTX, singleProduct: true });
    const rows = truth.filter((t) => t.product === one && t.date >= p.current.from && t.date <= p.current.to);
    const expected = rows.reduce((s, t) => s + t.net, 0) / 100 / rows.reduce((s, t) => s + t.qty, 0);
    expect(get(m, 'asp').current).toBeCloseTo(expected, 4);
  });
});

describe('edge cases', () => {
  it('zero denominator: previous revenue is 0 but lines exist → no percentage, never Infinity', () => {
    const rs = [mk({ date: '2025-03-01', amount: 100, documentId: 'x1' }), mk({ date: '2025-03-02', amount: -100, documentId: 'x2' }), mk({ date: '2025-03-20', amount: 50 })];
    const p = resolvePeriods({ preset: 'custom', custom: { current: { from: '2025-03-15', to: '2025-03-25' }, previous: { from: '2025-03-01', to: '2025-03-11' } } }, bounds('2025-03-01', '2025-03-25'));
    const s = get(comparePeriods(rs, p, ['sales'], CTX), 'sales');
    expect(s.previous).toBe(0);
    expect(s.pct).toBeNull();
    expect(s.status).toBe('zero_base');
    expect(s.abs).toBe(50);
  });
  it('empty previous period → no previous value; blocked when it lies outside the data', () => {
    const rs = [mk({ date: '2025-03-20' }), mk({ date: '2025-03-25' })];
    const p = resolvePeriods({ preset: 'r7' }, bounds('2025-03-20', '2025-03-25'));
    const m = comparePeriods(rs, p, ['sales'], CTX);
    expect(m.metrics[0]!.status).toBe('blocked');
    expect(m.metrics[0]!.pct).toBeNull();
    expect(planCharts({ trendPoints: 5, comparisonUsable: false, entities: { customer: 3, product: 3, salesperson: 0, category: 0 }, movers: { customer: 0, product: 0, salesperson: 0, category: 0 } }).find((c) => c.id === 'comparison')!.available).toBe(false);
  });
  it('days without records are zero-filled in trends; trend total equals KPI sales', () => {
    const rs = [mk({ date: '2025-03-01', amount: 10 }), mk({ date: '2025-03-05', amount: 20 })];
    const t = salesTrend(rs, { from: '2025-03-01', to: '2025-03-06' });
    expect(t.map((x) => x.revenue)).toEqual([10, 0, 0, 0, 20, 0]);
  });
  it('credit notes and returns reduce sales, are counted separately and are not orders', () => {
    const rs = [mk({ documentId: 'S1', amount: 300 }), mk({ documentId: 'S2', amount: 100 }), mk({ documentId: 'KR1', amount: -150 })];
    const a = aggregate(rs);
    const m = comparePeriods(rs, resolvePeriods({ preset: 'dod' }, bounds('2025-03-09', '2025-03-10')), ['sales', 'returns', 'orders', 'aov'], CTX);
    expect(get(m, 'sales').current).toBe(250);
    expect(get(m, 'returns').current).toBe(150);
    expect(get(m, 'orders').current).toBe(2);
    expect(get(m, 'aov').current).toBe(200);
    expect(a.negativeLines).toBe(1);
  });
  it('orders / AOV are withheld when transaction identity is missing', () => {
    const rs = [mk({ documentId: undefined }), mk({ documentId: undefined })];
    const m = comparePeriods(rs, resolvePeriods({ preset: 'dod' }, bounds('2025-03-09', '2025-03-10')), ['orders', 'aov'], CTX);
    expect(m.metrics.map((x) => x.status)).toEqual(['unavailable', 'unavailable']);
  });
  it('margin is withheld without cost, with partial cost, and for non-net amounts', () => {
    const noCost = [mk(), mk()];
    const partial = [mk({ cost: 50 }), mk(), mk(), mk(), mk()];
    const full = [mk({ cost: 60 }), mk({ cost: 60 })];
    const m = (rs: SalesRecord[], basis: 'net' | 'gross' = 'net') => comparePeriods(rs, resolvePeriods({ preset: 'dod' }, bounds('2025-03-09', '2025-03-10')), ['margin'], { ...CTX, basis }).metrics[0]!;
    expect(m(noCost).status).toBe('unavailable');
    expect(m(partial).status).toBe('unavailable');
    expect(m(full, 'gross').unavailable).toBe('cost_needs_net');
    expect(m(full).current).toBeCloseTo(0.4, 9);
  });
  it('customers metric is withheld when customers are mostly unidentified', () => {
    const rs = [mk({ customerName: undefined }), mk({ customerName: undefined }), mk({ customerName: undefined }), mk()];
    expect(comparePeriods(rs, resolvePeriods({ preset: 'dod' }, bounds('2025-03-09', '2025-03-10')), ['customers'], CTX).metrics[0]!.status).toBe('unavailable');
  });
});

describe('currencies and VAT bases are never combined', () => {
  const mixed = [mk({ amount: 100 }), mk({ amount: 50, currency: 'PLN' }), mk({ amount: 30, basis: 'gross' }), mk({ amount: 7, basis: 'unknown' })];
  it('each series sees only its own lines', () => {
    for (const [s, v] of [[{ currency: 'EUR', basis: 'net' }, 100], [{ currency: 'PLN', basis: 'net' }, 50], [{ currency: 'EUR', basis: 'gross' }, 30], [{ currency: 'EUR', basis: 'unknown' }, 7]] as const) {
      const d = buildDashboard(mixed, { series: s, filters: {}, period: { preset: 'r7' } })!;
      expect(aggregate(d.records).revenue).toBe(v);
      expect(d.limitations.some((l) => l.code === 'other_series_hidden')).toBe(true);
    }
  });
  it('unknown / gross VAT basis is reported as a limitation', () => {
    expect(buildDashboard(mixed, { series: { currency: 'EUR', basis: 'unknown' }, filters: {}, period: { preset: 'r7' } })!.limitations.map((l) => l.code)).toContain('basis_unknown');
    expect(buildDashboard(mixed, { series: { currency: 'EUR', basis: 'gross' }, filters: {}, period: { preset: 'r7' } })!.limitations.map((l) => l.code)).toContain('basis_gross');
  });
});

describe('missing customer / product identifiers keep totals reconciled', () => {
  const rs = [
    mk({ date: '2025-03-01', customerName: 'A', productName: 'P', amount: 100 }), mk({ date: '2025-03-01', customerName: undefined, productName: undefined, amount: 40 }),
    mk({ date: '2025-03-12', customerName: 'A', productName: 'P', amount: 60 }), mk({ date: '2025-03-12', customerName: undefined, productName: 'Q', amount: 25 }),
  ];
  it('unassigned lines are tracked separately and the waterfall still adds up', () => {
    const p = resolvePeriods({ preset: 'custom', custom: { current: { from: '2025-03-10', to: '2025-03-14' }, previous: { from: '2025-03-01', to: '2025-03-05' } } }, bounds('2025-03-01', '2025-03-14'));
    const t = entityTable(rs, 'customer', p, CTX);
    expect(t.rows.map((r) => r.label)).toEqual(['A']);
    expect(t.unassigned).toEqual({ current: 25, previous: 40 });
    const w = waterfall(t);
    expect(w.start).toBe(140);
    expect(w.end).toBe(85);
    expect(w.start + w.steps.reduce((s, x) => s + x.delta, 0)).toBeCloseTo(w.end, 9);
  });
});

describe('aggregation, filters and views stay consistent', () => {
  const series = NET;
  const base = { series, period: { preset: 'r30' as const } };
  it('sum of entity rows + unassigned = KPI sales, for every dimension', () => {
    const d = buildDashboard(recs, { ...base, filters: {} })!;
    const sales = d.kpis.find((k) => k.id === 'sales')!;
    for (const dim of ['customer', 'product', 'salesperson', 'category'] as const) {
      const t = d.tables[dim];
      if (!t) continue;
      expect(t.totalCurrent).toBeCloseTo(sales.current!, 6);
      expect(t.totalPrevious).toBeCloseTo(sales.previous!, 6);
      expect(t.rows.reduce((s, r) => s + r.current, 0) + t.unassigned.current).toBeCloseTo(sales.current!, 6);
    }
  });
  it('trend, aligned series, pareto and composition agree with the KPI', () => {
    const d = buildDashboard(recs, { ...base, filters: {} })!;
    const sales = d.kpis.find((k) => k.id === 'sales')!;
    expect(trendTotal(d)).toBeCloseTo(aggregate(d.records).revenue, 6);
    const al = alignedSeries(d.records, d.periods);
    expect(al.points.reduce((s, p) => s + p.current, 0)).toBeCloseTo(sales.current!, 6);
    expect(al.points.reduce((s, p) => s + p.previous, 0)).toBeCloseTo(sales.previous!, 6);
    const posTotal = d.tables.customer!.rows.filter((r) => r.current > 0).reduce((s, r) => s + r.current, 0);
    expect(d.pareto!.total).toBeCloseTo(posTotal, 6);
    expect(d.pareto!.points.at(-1)!.cumulativeShare).toBeCloseTo(1, 9);
    expect(d.composition.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 9);
  });
  it('the waterfall explains exactly previous → current', () => {
    const d = buildDashboard(recs, { ...base, filters: {} })!;
    const w = d.waterfall!.data;
    const sales = d.kpis.find((k) => k.id === 'sales')!;
    expect(w.start).toBeCloseTo(sales.previous!, 6);
    expect(w.end).toBeCloseTo(sales.current!, 6);
    expect(w.start + w.steps.reduce((s, x) => s + x.delta, 0)).toBeCloseTo(w.end, 6);
  });
  it('a customer filter changes KPIs, tables and charts consistently and equals a brute-force calculation', () => {
    const name = truth[0]!.customer;
    const d = buildDashboard(recs, { ...base, filters: { customers: [ckey(name)] } })!;
    const p = d.periods;
    const expected = ref(truth.filter((t) => t.customer === name), p.current.from, p.current.to);
    expect(d.kpis.find((k) => k.id === 'sales')!.current).toBeCloseTo(expected.net, 2);
    expect(d.kpis.find((k) => k.id === 'orders')!.current).toBe(expected.orders);
    expect(d.tables.customer!.rows).toHaveLength(1);
    expect(d.tables.product!.totalCurrent).toBeCloseTo(expected.net, 2);
    expect(d.limitations.map((l) => l.code)).toContain('filtered');
    // anchor does not move with the filter
    expect(d.periods.current).toEqual(buildDashboard(recs, { ...base, filters: {} })!.periods.current);
  });
  it('filter dimensions combine (AND) and text search matches documents', () => {
    const t = truth[3]!;
    const f = applyFilters(recs, { customers: [ckey(t.customer)], products: [pkey(t.product)] });
    expect(f.length).toBe(truth.filter((x) => x.customer === t.customer && x.product === t.product).length);
    expect(applyFilters(recs, { text: t.doc }).every((r) => r.documentId === t.doc)).toBe(true);
    expect(applyFilters(recs, { categories: [t.category.toLowerCase()] }).length).toBe(truth.filter((x) => x.category === t.category).length);
  });
  it('top/bottom rankings are ordered and exclude inactive entities', () => {
    const t = buildDashboard(recs, { ...base, filters: {} })!.tables.customer!;
    const { top, bottom } = topBottom(t.rows, 5);
    expect(top.map((r) => r.current)).toEqual([...top.map((r) => r.current)].sort((a, b) => b - a));
    expect(bottom.every((r) => r.current > 0)).toBe(true);
    expect(bottom.every((r) => !top.includes(r))).toBe(true);
  });
  it('pareto marks the number of entities that make 80 %', () => {
    const rows = [100, 50, 20, 10, 5, 5, 5, 5].map((v, i) => ({ key: 'k' + i, label: 'k' + i, current: v, previous: 0, change: v, changePct: null, share: 0, lines: 1, quantity: null, orders: null, margin: null }));
    const p = pareto(rows);
    expect(p.countFor80).toBe(3); // 170 / 200 = 85 %
  });
});

describe('drill-down explains KPI values', () => {
  it('records behind a KPI sum to the KPI and carry their source', () => {
    const d = buildDashboard(recs, { series: NET, filters: {}, period: { preset: 'r30' } })!;
    const rows = drillRecords(d.records, { filter: {}, range: d.periods.current });
    const sales = d.kpis.find((k) => k.id === 'sales')!;
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(sales.current!, 6);
    expect(rows.length).toBe(aggregate(inRange(d.records, d.periods.current)).lines);
  });
  it('table row drill-down equals the row value', () => {
    const d = buildDashboard(recs, { series: NET, filters: {}, period: { preset: 'r30' } })!;
    const row = d.tables.product!.rows.find((r) => r.current > 0)!;
    const rows = drillRecords(d.records, { filter: { products: [row.key] }, range: d.periods.current });
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(row.current, 6);
    const g = groupAggregates(inRange(d.records, d.periods.current), 'product').groups.get(row.key)!;
    expect(g.agg.lines).toBe(rows.length);
    expect(dimensionOf.product(rows[0]!)!.key).toBe(row.key);
  });
});

describe('overlapping and corrected imports flow through to the metrics', () => {
  it('the dashboard reflects the corrected invoice exactly once', async () => {
    const db = new AppDB('an-' + Math.random());
    const st = { rowsRead: 1, rowsImported: 1, rowsSkipped: 0, errors: {}, warnings: {}, examples: [], currencies: ['EUR'] };
    const lines = (a: number) => assignKeys([{ ...mk({ documentId: 'INV1', amount: a }), key: undefined as never } as never]);
    const im = async (n: string, a: number) => commitImport(db, { checksum: await sha256Hex(new TextEncoder().encode(n)), fileName: n, sheetName: 's', exportMode: 'full', records: lines(a), stats: st, mapping: { columns: {} }, confirmed: true });
    await im('v1', 100);
    await im('v2', 130);
    await im('v2-again', 130); // overlapping re-export of the same period
    const all = await loadAllSales(db);
    const d = buildDashboard(all, { series: NET, filters: {}, period: { preset: 'dod' } })!;
    expect(aggregate(d.records).revenue).toBe(130);
    expect(sourcesOf(all)[0]!.lines).toBe(1);
  });
});

describe('chart planning never offers meaningless charts', () => {
  const none = { customer: 0, product: 0, salesperson: 0, category: 0 };
  it('hides dimension charts when the column is missing and says why', () => {
    const plan = planCharts({ trendPoints: 10, comparisonUsable: true, entities: none, movers: none });
    expect(plan.find((c) => c.id === 'salespeople')).toMatchObject({ available: false, reason: 'needs_dimension' });
    expect(plan.find((c) => c.id === 'waterfall')).toMatchObject({ available: false });
    expect(plan.find((c) => c.id === 'trend')!.available).toBe(true);
  });
  it('hides trend with fewer than 3 points and charts with a single entity', () => {
    const plan = planCharts({ trendPoints: 2, comparisonUsable: true, entities: { ...none, customer: 1 }, movers: none });
    expect(plan.find((c) => c.id === 'trend')!.available).toBe(false);
    expect(plan.find((c) => c.id === 'topCustomers')).toMatchObject({ available: false, reason: 'too_few_entities' });
  });
  it('the real dashboard offers category composition only because categories exist', () => {
    const d = buildDashboard(recs, { series: NET, filters: {}, period: { preset: 'r30' } })!;
    expect(d.charts.find((c) => c.id === 'category')!.available).toBe(true);
    const noCat = buildDashboard(recs.map((r) => ({ ...r, category: undefined })), { series: NET, filters: {}, period: { preset: 'r30' } })!;
    expect(noCat.charts.find((c) => c.id === 'category')!.available).toBe(false);
    expect(noCat.composition).toEqual([]);
  });
});

describe('performance', () => {
  it('builds the whole dashboard for 150 000 lines in under 2.5 s', () => {
    const base = recs;
    const big: SalesRecord[] = [];
    for (let i = 0; i < 150_000; i++) big.push({ ...base[i % base.length]!, key: 'k' + i, customerName: 'C' + (i % 900), productName: 'P' + (i % 1200) });
    const t = Date.now();
    const d = buildDashboard(big, { series: NET, filters: {}, period: { preset: 'r30' } })!;
    const ms = Date.now() - t;
    expect(d.kpis.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2500);
  });
});
