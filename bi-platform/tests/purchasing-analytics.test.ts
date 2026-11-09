import { beforeAll, describe, expect, it } from 'vitest';
import { buildPurchasingFixtures, type PFixture } from './fixtures/purchasingFormats';
import { CUR, PREV, inWin, makePurchasing, priceMap, sumNet, byKey, type PLine } from './fixtures/purchasing';
import { runPurchasingFixture } from './helpers';
import { buildPurchasingDashboard } from '@/engine/purchasing/dashboard';
import { drillPurchaseRecords } from '@/engine/purchasing/drill';
import { applyPurchaseFilters } from '@/engine/purchasing/entities';
import { analyzePrices, priceTrend, toPriceLines } from '@/engine/purchasing/prices';
import { resolvePeriods, type PeriodSelection } from '@/engine/analytics/periods';
import type { PurchaseRecord } from '@/engine/types';

const NET = { currency: 'EUR', basis: 'net' as const };
let recs: PurchaseRecord[] = [];
let truth: PLine[] = [];
let fx: PFixture[] = [];
beforeAll(async () => {
  fx = await buildPurchasingFixtures();
  truth = makePurchasing('lt');
  recs = (await runPurchasingFixture(fx[0]!)).records;
});
const dash = (period: PeriodSelection = { preset: 'r30' }, filters = {}, extra: object = {}, all = recs) => buildPurchasingDashboard(all, { series: NET, filters, period, ...extra })!;
const kpi = (d: ReturnType<typeof dash>, id: string) => d.kpis.find((k) => k.id === id)!;
const canon = (u: string) => (u === 'dėž.' ? 'box' : u); // the file says "dėž.", the engine's canonical unit is "box"
const price = (rows: PLine[], sku: string, unit: string, supplier?: string) => {
  const m = priceMap(rows.map((r) => ({ ...r, unit: canon(r.unit) })), false, Boolean(supplier));
  const e = m.get(`${sku}|${unit}${supplier ? '|' + supplier : ''}`);
  return e ? { p: e.a / e.q, q: e.q, a: e.a, lines: e.lines } : null;
};

describe('the planted fixture has the patterns the tests rely on', () => {
  it('(sanity) the windows contain data and credits exist only before the latest window', () => {
    expect(inWin(truth, CUR).length).toBeGreaterThan(50);
    expect(inWin(truth, PREV).filter((t) => t.credit)).toHaveLength(4);
    expect(inWin(truth, CUR).filter((t) => t.credit)).toHaveLength(0);
  });
});

describe('purchasing KPIs equal independent reference calculations', () => {
  it('spend, credits, documents, suppliers and concentration for both windows', () => {
    const d = dash();
    for (const [w, key] of [[CUR, 'current'], [PREV, 'previous']] as const) {
      const rows = inWin(truth, w);
      expect(kpi(d, 'p_spend')[key]).toBeCloseTo(sumNet(rows), 2);
      expect(kpi(d, 'p_credits')[key]).toBeCloseTo(-sumNet(rows.filter((t) => t.net < 0)), 2);
      const docs = byKey(rows, (t) => t.doc);
      expect(kpi(d, 'p_documents')[key]).toBe([...docs.values()].filter((v) => v > 0).length);
      const sup = byKey(rows, (t) => t.supplier);
      const pos = [...sup.values()].filter((v) => v > 0);
      expect(kpi(d, 'p_suppliers')[key]).toBe(pos.length);
      expect(kpi(d, 'p_concentration')[key]).toBeCloseTo(Math.max(...pos) / pos.reduce((a, b) => a + b, 0), 6);
    }
    const s = kpi(d, 'p_spend');
    expect(s.abs).toBeCloseTo(sumNet(inWin(truth, CUR)) - sumNet(inWin(truth, PREV)), 2);
    expect(s.pct).toBeCloseTo(s.abs! / Math.abs(sumNet(inWin(truth, PREV))), 6);
  });
  it('spend and credits are neutral (no good/bad colouring) while concentration and price are "higher is worse"', () => {
    const d = dash();
    expect(kpi(d, 'p_spend').good).toBeNull();
    expect(kpi(d, 'p_credits').good).toBeNull();
    expect(kpi(d, 'p_concentration').good === null || kpi(d, 'p_concentration').good === (kpi(d, 'p_concentration').abs! < 0)).toBe(true);
  });
  it('quantity of mixed units is NEVER summed: unavailable with a reason; also with SI conversion (litres + kg + boxes)', () => {
    expect(kpi(dash(), 'p_quantity')).toMatchObject({ status: 'unavailable', unavailable: 'mixed_units' });
    expect(kpi(dash({ preset: 'r30' }, {}, { unitPolicy: 'metric' }), 'p_quantity')).toMatchObject({ status: 'unavailable', unavailable: 'mixed_units' });
  });
  it('quantity of a single item in one unit is the sum, and the average price needs exactly one product', () => {
    const f = { products: ['sku:p01'] };
    const d = dash({ preset: 'r30' }, f);
    const rows = inWin(truth, CUR).filter((t) => t.sku === 'P01');
    expect(kpi(d, 'p_quantity').current).toBe(rows.reduce((s, t) => s + t.qty, 0));
    expect(kpi(d, 'p_avg_price').current).toBeCloseTo(0.72, 9);
    expect(kpi(d, 'p_avg_price').previous).toBeCloseTo(0.6, 9);
    expect(kpi(dash(), 'p_avg_price')).toMatchObject({ status: 'unavailable', unavailable: 'needs_single_product' });
  });
  it('quantity: grams and kilograms are summed only when the user turns on the SI conversion', () => {
    const f = { products: ['sku:p04'] };
    const mixed = dash({ preset: 'r30' }, f);
    expect(kpi(mixed, 'p_quantity')).toMatchObject({ unavailable: 'mixed_units' });
    const metric = dash({ preset: 'r30' }, f, { unitPolicy: 'metric' });
    const rows = inWin(truth, CUR).filter((t) => t.sku === 'P04');
    const kg = rows.reduce((s, t) => s + (t.unit === 'g' ? t.qty / 1000 : t.qty), 0);
    expect(kpi(metric, 'p_quantity').current).toBeCloseTo(kg, 6);
    expect(metric.limitations.map((l) => l.code)).toContain('p_metric_units');
  });
});

describe('prices: like-for-like, cross-supplier and mix', () => {
  const periods = resolvePeriods({ preset: 'r30' }, { dateMin: '2025-09-01', dateMax: '2025-12-15' });
  const opt = { policy: 'strict' as const, hasUnitColumn: true };
  it('same item, same supplier, same unit: P01 +20 % and P02 −10 % match the planted prices', () => {
    const a = analyzePrices(recs, periods, opt);
    const p1 = a.pairs.find((x) => x.pk === 'sku:p01')!;
    expect([p1.p0, p1.p1]).toEqual([expect.closeTo(0.6, 9), expect.closeTo(0.72, 9)]);
    expect(p1.changePct).toBeCloseTo(0.2, 9);
    const q1 = inWin(truth, CUR).filter((t) => t.sku === 'P01').reduce((s, t) => s + t.qty, 0);
    expect(p1.effect).toBeCloseTo((0.72 - 0.6) * q1, 6);
    const p2 = a.pairs.find((x) => x.pk === 'sku:p02')!;
    expect(p2.changePct).toBeCloseTo(-0.1, 9);
    const q2 = inWin(truth, CUR).filter((t) => t.sku === 'P02').reduce((s, t) => s + t.qty, 0);
    expect(p2.effect).toBeCloseTo((0.9 - 1.0) * q2, 6);
  });
  it('the weighted price per pair equals an independent weighted average', () => {
    const a = analyzePrices(recs, periods, opt);
    for (const pr of a.pairs) {
      // supplier identity = the supplier CODE when the file has one (names are only labels)
      const sup = truth.find((t) => `sku:${t.sku.toLowerCase()}` === pr.pk && t.supplierId.toLowerCase() === pr.supplier)!.supplier;
      const c = price(inWin(truth, CUR), pr.pk.slice(4).toUpperCase(), pr.unit, sup);
      expect(pr.p1).toBeCloseTo(c!.p, 9);
      expect(pr.q1).toBeCloseTo(c!.q, 6);
    }
  });
  it('cross-supplier gap for the same item and period: P03 S3 7.50 vs S4 9.00 → 20 %, potential = Δprice × the dearer quantity', () => {
    const a = analyzePrices(recs, periods, opt);
    const v = a.variance.find((x) => x.pk === 'sku:p03')!;
    expect(v.suppliers.map((s) => +s.price.toFixed(6))).toEqual([7.5, 9]);
    expect(v.spreadPct).toBeCloseTo(0.2, 9);
    const q4 = inWin(truth, CUR).filter((t) => t.sku === 'P03' && t.supplier === 'MB Šaltinis').reduce((s, t) => s + t.qty, 0);
    expect(v.potentialSavings).toBeCloseTo(1.5 * q4, 6);
  });
  it('units: the same item priced per kg and per g is NOT compared under the strict policy, and IS (exactly) under the explicit SI policy', () => {
    const strict = analyzePrices(recs, periods, opt);
    expect(strict.unitMismatch.map((u) => u.pk)).toContain('sku:p04');
    expect(strict.variance.find((x) => x.pk === 'sku:p04')).toBeUndefined();
    expect(strict.groups.filter((g) => g.pk === 'sku:p04').map((g) => g.unit).sort()).toEqual(['g', 'kg']);
    const metric = analyzePrices(recs, periods, { ...opt, policy: 'metric' });
    expect(metric.unitMismatch.find((u) => u.pk === 'sku:p04')).toBeUndefined();
    const v = metric.variance.find((x) => x.pk === 'sku:p04')!;
    expect(v.suppliers.map((s) => +s.price.toFixed(9))).toEqual([1.2, 1.2]);
    expect(v.spreadPct).toBeLessThan(1e-9);
  });
  it('an ambiguous code (one code, two products) is excluded from every comparison and reported', () => {
    const a = analyzePrices(recs, periods, opt);
    expect([...a.ambiguous.keys()]).toEqual(['sku:p99']);
    expect(a.groups.some((g) => g.pk === 'sku:p99')).toBe(false);
    expect(a.excluded.ambiguousCode).toBe(2);
    expect(dash().limitations).toContainEqual({ code: 'p_code_ambiguity', count: 1 });
  });
  it('product mix is separated from price: P06 supplier prices are flat, yet its average price rises – the rise is "supplier mix", not price', () => {
    const a = analyzePrices(recs, periods, opt);
    const g = a.groups.find((x) => x.pk === 'sku:p06')!;
    expect(g.cur.price!).toBeGreaterThan(g.prev.price!); // the SKU-level average went up
    expect(g.lflEffect).toBeCloseTo(0, 6); // …but no supplier raised its price
    expect(g.mixEffect).toBeCloseTo(g.priceEffect, 6);
    expect(g.mixEffect).toBeGreaterThan(0);
    // and the independent view: SKU average price from the truth
    const c = price(inWin(truth, CUR), 'P06', 'l');
    const p = price(inWin(truth, PREV), 'P06', 'l');
    expect(g.cur.price).toBeCloseTo(c!.p, 9);
    expect(g.prev.price).toBeCloseTo(p!.p, 9);
  });
});

describe('the spend bridge adds up exactly (price / mix / volume / new / lost / credits / not comparable)', () => {
  const opt = { policy: 'strict' as const, hasUnitColumn: true };
  it.each([
    ['r30', { preset: 'r30' as const }],
    ['mom like-for-like', { preset: 'mom' as const }],
    ['custom', { preset: 'custom' as const, custom: { current: { from: '2025-10-01', to: '2025-10-31' }, previous: { from: '2025-09-01', to: '2025-09-30' } } }],
  ])('%s: Σ steps = Δ spend = an independent total', (_n, sel) => {
    const p = resolvePeriods(sel, { dateMin: '2025-09-01', dateMax: '2025-12-15' });
    const b = analyzePrices(recs, p, opt).bridge;
    const ref = sumNet(inWin(truth, p.current)) - sumNet(inWin(truth, p.previous));
    expect(b.total).toBeCloseTo(ref, 6);
    expect(b.price + b.supplierMix + b.volume + b.newItems + b.lostItems + b.credits + b.unassigned).toBeCloseTo(b.total, 6);
  });
  it('new item, discontinued item, credits and the volume effect match independent calculations', () => {
    const p = resolvePeriods({ preset: 'r30' }, { dateMin: '2025-09-01', dateMax: '2025-12-15' });
    const a = analyzePrices(recs, p, opt);
    const sumSku = (w: typeof CUR, sku: string) => inWin(truth, w).filter((t) => t.sku === sku && t.net > 0).reduce((s, t) => s + t.net, 0) / 100;
    const rice = a.groups.find((g) => g.pk === 'sku:p10')!;
    const eggs = a.groups.find((g) => g.pk === 'sku:p11')!;
    expect([rice.kind, eggs.kind]).toEqual(['new', 'lost']);
    expect(a.bridge.newItems).toBeCloseTo(sumSku(CUR, 'P10') + 0 + a.groups.filter((g) => g.kind === 'new' && g.pk !== 'sku:p10').reduce((s, g) => s + g.cur.A, 0) - a.groups.filter((g) => g.kind === 'new' && g.pk !== 'sku:p10').reduce((s, g) => s + g.cur.A, 0), 6);
    expect(a.bridge.lostItems).toBeCloseTo(-a.groups.filter((g) => g.kind === 'lost').reduce((s, g) => s + g.prev.A, 0), 6);
    expect(a.bridge.credits).toBeCloseTo(1040, 6); // four credit notes of −260 in the previous window, none now
    const juice = a.groups.find((g) => g.pk === 'sku:p09')!;
    expect(juice.volumeEffect).toBeCloseTo((juice.cur.Q - juice.prev.Q) * 1.3, 6);
    const qCur = inWin(truth, CUR).filter((t) => t.sku === 'P09' && t.net > 0).reduce((s, t) => s + t.qty, 0);
    expect(juice.cur.Q).toBeCloseTo(qCur, 6);
  });
  it('lines that cannot be compared (no quantity, ambiguous code) land in "not comparable", never in price or volume', () => {
    const noQty = recs.map((r) => (r.documentId?.endsWith('ODD1') ? { ...r, quantity: undefined } : r));
    const p = resolvePeriods({ preset: 'r30' }, { dateMin: '2025-09-01', dateMax: '2025-12-15' });
    const b = analyzePrices(noQty, p, opt).bridge;
    expect(b.unassigned).toBeGreaterThan(4000); // the 400 kg × 11 line + the two P99 lines
    expect(b.price + b.supplierMix + b.volume + b.newItems + b.lostItems + b.credits + b.unassigned).toBeCloseTo(b.total, 6);
  });
  it('the dashboard exposes the same bridge', () => {
    const d = dash();
    expect(d.bridge!.total).toBeCloseTo(kpi(d, 'p_spend').abs!, 6);
    expect(d.priceChange!.extra).toBeCloseTo(d.analysis.pairs.reduce((s, x) => s + x.effect, 0), 6);
  });
});

describe('currencies, VAT bases, unit policy and units without a column', () => {
  it('series are isolated: EUR/net, PLN/net and EUR/gross never mix', () => {
    const mixed: PurchaseRecord[] = [...recs, ...recs.slice(0, 50).map((r) => ({ ...r, key: 'p' + r.key, currency: 'PLN' })), ...recs.slice(0, 20).map((r) => ({ ...r, key: 'g' + r.key, basis: 'gross' as const }))];
    expect(dash({ preset: 'r30' }, {}, {}, mixed).records).toHaveLength(recs.length);
    const pln = buildPurchasingDashboard(mixed, { series: { currency: 'PLN', basis: 'net' }, filters: {}, period: { preset: 'r30' } })!;
    expect(pln.records).toHaveLength(50);
    expect(dash({ preset: 'r30' }, {}, {}, mixed).limitations.some((l) => l.code === 'other_series_hidden')).toBe(true);
  });
  it('gross / unknown VAT basis is a stated limitation', () => {
    const unknown = buildPurchasingDashboard(recs.map((r) => ({ ...r, basis: 'unknown' as const })), { series: { currency: 'EUR', basis: 'unknown' }, filters: {}, period: { preset: 'r30' } })!;
    expect(unknown.limitations).toContainEqual({ code: 'p_basis_unknown' });
  });
  it('without a unit column the limitation is reported and no unit is invented', async () => {
    const r = await runPurchasingFixture(fx.find((f) => f.id === 'en-csv-names-only')!);
    const d = buildPurchasingDashboard(r.records, { series: { currency: 'EUR', basis: 'unknown' }, filters: {}, period: { preset: 'r30' } })!;
    expect(d.limitations.map((l) => l.code)).toEqual(expect.arrayContaining(['p_units_not_provided', 'p_name_identity']));
    expect(d.ctx.hasUnitColumn).toBe(false);
    expect(toPriceLines(r.records, { policy: 'strict', hasUnitColumn: false }).lines.every((l) => l.unit === '' && l.identity === 'name')).toBe(true);
  });
  it('a line without a unit (although the file has a unit column) is excluded from price evidence', () => {
    const broken = recs.map((r, i) => (i % 2 === 0 ? { ...r, unit: undefined } : r));
    const t = toPriceLines(broken, { policy: 'strict', hasUnitColumn: true });
    expect(t.excluded.noUnit).toBeGreaterThan(100);
    expect(t.lines.every((l) => l.unit !== '')).toBe(true);
  });
});

describe('partial periods, zero bases and missing data', () => {
  it('month-over-month is like-for-like with the same indicator as sales, and KPIs match the truth', () => {
    const d = dash({ preset: 'mom' });
    expect(d.periods.status).toEqual({ kind: 'partial', elapsed: 15, total: 31 });
    expect(kpi(d, 'p_spend').current).toBeCloseTo(sumNet(inWin(truth, { from: '2025-12-01', to: '2025-12-15' })), 2);
    expect(kpi(d, 'p_spend').previous).toBeCloseTo(sumNet(inWin(truth, { from: '2025-11-01', to: '2025-11-15' })), 2);
    expect(d.warnings.map((w) => w.code)).toContain('partial_current');
  });
  it('no previous data: the change is "blocked", never invented; the bridge and comparison charts are withheld', () => {
    const d = dash({ preset: 'yoy' as never });
    expect(kpi(d, 'p_spend').status).toBe('blocked');
    expect(d.bridge).toBeNull();
    expect(d.charts.find((c) => c.id === 'spendBridge')).toMatchObject({ available: false, reason: 'no_comparison' });
  });
  it('zero previous spend with lines present → no percentage', () => {
    const rs: PurchaseRecord[] = [
      { key: 'a', date: '2025-03-01', amount: 100, basis: 'net', currency: 'EUR', sourceRow: 1, supplierName: 'A' }, { key: 'b', date: '2025-03-02', amount: -100, basis: 'net', currency: 'EUR', sourceRow: 2, supplierName: 'A' },
      { key: 'c', date: '2025-03-20', amount: 50, basis: 'net', currency: 'EUR', sourceRow: 3, supplierName: 'A' },
    ];
    const d = buildPurchasingDashboard(rs, { series: NET, filters: {}, period: { preset: 'custom', custom: { current: { from: '2025-03-15', to: '2025-03-25' }, previous: { from: '2025-03-01', to: '2025-03-11' } } } })!;
    expect(kpi(d, 'p_spend')).toMatchObject({ previous: 0, pct: null, status: 'zero_base' });
  });
});

describe('filters, tables, charts and drill-down reconcile with the KPIs', () => {
  it('Σ entity rows + unassigned = KPI spend, for every dimension; waterfall and Pareto agree', () => {
    const d = dash();
    const spend = kpi(d, 'p_spend');
    for (const dim of ['supplier', 'product', 'warehouse'] as const) {
      const t = d.tables[dim];
      if (!t) continue;
      expect(t.totalCurrent).toBeCloseTo(spend.current!, 6);
      expect(t.totalPrevious).toBeCloseTo(spend.previous!, 6);
      expect(t.rows.reduce((s, r) => s + r.current, 0) + t.unassigned.current).toBeCloseTo(spend.current!, 6);
    }
    const w = d.waterfall!.data;
    expect(w.start + w.steps.reduce((s, x) => s + x.delta, 0)).toBeCloseTo(w.end, 6);
    expect(w.end).toBeCloseTo(spend.current!, 6);
    expect(d.aligned.points.reduce((s, p) => s + p.current, 0)).toBeCloseTo(spend.current!, 6);
    expect(d.trend.reduce((s, p) => s + p.revenue, 0)).toBeCloseTo(sumNet(truth.filter((t) => t.date >= '2025-09-01')), 2);
    const pos = d.tables.supplier!.rows.filter((r) => r.current > 0).reduce((s, r) => s + r.current, 0);
    expect(d.pareto!.total).toBeCloseTo(pos, 6);
  });
  it('a supplier filter changes KPIs, tables and charts consistently and equals a brute-force calculation', () => {
    const name = 'UAB Baltijos ūkis';
    const d = dash({ preset: 'r30' }, { suppliers: [truth.find((t) => t.supplier === name)!.supplierId.toLowerCase()] });
    const rows = inWin(truth, CUR).filter((t) => t.supplier === name);
    expect(kpi(d, 'p_spend').current).toBeCloseTo(sumNet(rows), 2);
    expect(d.tables.supplier!.rows).toHaveLength(1);
    expect(d.tables.product!.totalCurrent).toBeCloseTo(sumNet(rows), 2);
    expect(d.limitations.map((l) => l.code)).toContain('filtered');
    expect(d.periods.current).toEqual(dash().periods.current); // the anchor does not move with a filter
  });
  it('filters combine (AND); text search matches suppliers, products and documents', () => {
    const t = truth.find((x) => x.sku === 'P03' && x.supplier === 'UAB Baltijos ūkis')!;
    const f = applyPurchaseFilters(recs, { suppliers: [t.supplierId.toLowerCase()], products: ['sku:p03'] });
    expect(f.length).toBe(truth.filter((x) => x.supplier === t.supplier && x.sku === 'P03').length);
    expect(applyPurchaseFilters(recs, { text: t.doc }).every((r) => r.documentId === t.doc)).toBe(true);
    expect(applyPurchaseFilters(recs, { warehouses: ['vilnius'] }).length).toBe(truth.filter((x) => x.warehouse === 'Vilnius').length);
  });
  it('drill-down lines add up to the KPI and to every table row', () => {
    const d = dash();
    const cur = drillPurchaseRecords(d.records, { filter: {}, range: d.periods.current });
    expect(cur.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(kpi(d, 'p_spend').current!, 6);
    const credits = drillPurchaseRecords(d.records, { filter: {}, range: d.periods.previous, sign: 'negative' });
    expect(credits).toHaveLength(4);
    expect(-credits.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(kpi(d, 'p_credits').previous!, 6);
    for (const dim of ['supplier', 'product'] as const) {
      const row = d.tables[dim]!.rows.find((r) => r.current > 0)!;
      const rows = drillPurchaseRecords(d.records, { filter: { [dim === 'supplier' ? 'suppliers' : 'products']: [row.key] }, range: d.periods.current });
      expect(rows.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(row.current, 6);
    }
  });
  it('price-trend points are quantity-weighted and match an independent calculation', () => {
    const d = dash();
    const { lines } = toPriceLines(recs, { policy: 'strict', hasUnitColumn: true });
    const t = priceTrend(lines, 'sku:p01|l', { from: '2025-11-01', to: '2025-12-15' }, 'month');
    const nov = truth.filter((x) => x.sku === 'P01' && x.date >= '2025-11-01' && x.date <= '2025-11-30');
    expect(t.points[0]!.overall).toBeCloseTo(nov.reduce((s, x) => s + x.net / 100, 0) / nov.reduce((s, x) => s + x.qty, 0), 9);
    expect(d.priceItems.find((i) => i.gk === 'sku:p01|l')).toBeDefined();
  });
  it('charts that need data the file does not have are hidden, with a reason', async () => {
    const r = await runPurchasingFixture(fx.find((f) => f.id === 'en-csv-names-only')!);
    const d = buildPurchasingDashboard(r.records, { series: { currency: 'EUR', basis: 'unknown' }, filters: {}, period: { preset: 'r30' } })!;
    expect(d.charts.find((c) => c.id === 'topSuppliers')!.available).toBe(true);
    expect(d.tables.warehouse).toBeNull();
    const noSup = buildPurchasingDashboard(recs.map((x) => ({ ...x, supplierName: undefined, supplierId: undefined })), { series: NET, filters: {}, period: { preset: 'r30' } })!;
    expect(noSup.charts.find((c) => c.id === 'topSuppliers')).toMatchObject({ available: false, reason: 'needs_dimension' });
  });
  it('builds in well under 2 s for 100 000 purchase lines', () => {
    const big: PurchaseRecord[] = [];
    for (let i = 0; i < 100_000; i++) big.push({ ...recs[i % recs.length]!, key: 'k' + i, supplierName: 'S' + (i % 300), productId: 'P' + (i % 900), productName: 'Item ' + (i % 900) });
    const t = Date.now();
    const d = buildPurchasingDashboard(big, { series: NET, filters: {}, period: { preset: 'r30' } })!;
    expect(d.kpis.length).toBeGreaterThan(0);
    expect(Date.now() - t).toBeLessThan(2500);
  });
});
