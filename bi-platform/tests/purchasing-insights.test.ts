import { beforeAll, describe, expect, it } from 'vitest';
import { buildPurchasingFixtures, type PFixture } from './fixtures/purchasingFormats';
import { CUR, PREV, inWin, makePurchasing, sumNet, type PLine } from './fixtures/purchasing';
import { runPurchasingFixture } from './helpers';
import { buildPurchasingDashboard } from '@/engine/purchasing/dashboard';
import { analyzePurchasingPeriod } from '@/engine/purchasing/insights';
import { drillPurchaseRecords } from '@/engine/purchasing/drill';
import type { Insight, PurchaseRecord } from '@/engine/types';

const NET = { currency: 'EUR', basis: 'net' as const };
let recs: PurchaseRecord[] = [];
let truth: PLine[] = [];
let fx: PFixture[] = [];
beforeAll(async () => {
  fx = await buildPurchasingFixtures();
  truth = makePurchasing('lt');
  recs = (await runPurchasingFixture(fx[0]!)).records;
});
const run = (period: object = { preset: 'r30' }, filters = {}, all = recs, extra: object = {}) => {
  const model = buildPurchasingDashboard(all, { series: NET, filters, period: period as never, ...extra })!;
  return { model, ...analyzePurchasingPeriod(model) };
};
const find = (ins: Insight[], id: string) => ins.find((i) => i.id === id);
const money = (i: Insight, k: string) => (i.params[k] as { money: number }).money;
const canon = (u: string) => (u === 'dėž.' ? 'box' : u);

// independent helpers (no engine code)
const qty = (rows: PLine[], sku: string, supplier?: string) => rows.filter((t) => t.sku === sku && t.net > 0 && (!supplier || t.supplier === supplier)).reduce((s, t) => s + t.qty, 0);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2; };

describe('price insights – actual, potential and hypothetical are kept apart', () => {
  it('price increase: the planted +20 % on P01 from one supplier, with the extra cost computed from the previous price', () => {
    const { insights } = run();
    const i = find(insights, 'purchasing.price_increase')!;
    expect(i).toBeDefined();
    expect(i.params.count).toBe(1);
    expect(money(i, 'extra')).toBeCloseTo((0.72 - 0.6) * qty(inWin(truth, CUR), 'P01'), 6);
    expect((i.params.pct as { pct: number }).pct).toBeCloseTo(0.2, 9);
    expect(i.severity).toBe('risk');
    expect(i.reliability).toBe('high'); // SKU identity, unit column, many lines
    expect(i.savings).toBeUndefined();
    expect(i.evidence[0]!.key).toBe('sku:p01');
    expect(i.evidence[0]).toMatchObject({ unit: 'price' });
  });
  it('price decrease is ACTUAL savings: (p0 − p1) × current quantity at the same supplier', () => {
    const i = find(run().insights, 'purchasing.price_decrease')!;
    expect(money(i, 'saved')).toBeCloseTo(0.1 * qty(inWin(truth, CUR), 'P02'), 6);
    expect(i.savings).toEqual({ kind: 'actual', amount: expect.closeTo(0.1 * qty(inWin(truth, CUR), 'P02'), 6) });
    expect(i.severity).toBe('opportunity');
  });
  it('supplier price gap is POTENTIAL savings, from prices actually paid in the SAME period (P03 and P06)', () => {
    const i = find(run().insights, 'purchasing.supplier_price_gap')!;
    const cur = inWin(truth, CUR);
    const wp = (sku: string, sup: string) => { const r = cur.filter((t) => t.sku === sku && t.supplier === sup && t.net > 0); return r.reduce((s, t) => s + t.net / 100, 0) / r.reduce((s, t) => s + t.qty, 0); };
    const p03 = (wp('P03', 'MB Šaltinis') - wp('P03', 'UAB Baltijos ūkis')) * qty(cur, 'P03', 'MB Šaltinis');
    const p06 = (wp('P06', 'MB Šaltinis') - wp('P06', 'UAB Baltijos ūkis')) * qty(cur, 'P06', 'MB Šaltinis');
    expect(i.params.count).toBe(2);
    expect(money(i, 'potential')).toBeCloseTo(p03 + p06, 6);
    expect(i.savings!.kind).toBe('potential');
    expect(i.evidence.map((e) => e.key).sort()).toEqual(['sku:p03', 'sku:p06']);
  });
  it('an item priced per kg at one supplier and per g at another is not flagged as a price gap (strict) and not either after SI conversion (equal prices)', () => {
    for (const unitPolicy of ['strict', 'metric'] as const) {
      const i = find(run({ preset: 'r30' }, {}, recs, { unitPolicy }).insights, 'purchasing.supplier_price_gap')!;
      expect(i.evidence.map((e) => e.key)).not.toContain('sku:p04');
    }
  });
  it('hypothetical scenario: back to the lowest earlier monthly price – labelled, low reliability, not actionable, never "actual"', () => {
    const i = find(run().insights, 'purchasing.historical_price_scenario')!;
    expect(i.savings!.kind).toBe('hypothetical');
    expect(i.reliability).toBe('low');
    expect(i.reliabilityReasonKey).toBe('rel.hypothetical');
    expect(i.actionable).toBe(false);
    expect(i.severity).toBe('info');
    const p01 = i.evidence.find((e) => e.key === 'sku:p01')!;
    expect(p01.previous).toBeCloseTo(0.6, 9); // lowest earlier monthly price
    expect(p01.current).toBeCloseTo(0.72, 9);
  });
  it('the three savings kinds are separate insights with separate amounts; none is the sum of another', () => {
    const { insights } = run();
    const kinds = insights.filter((i) => i.savings).map((i) => i.savings!.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(new Set(kinds)).toEqual(new Set(['actual', 'potential', 'hypothetical']));
  });
  it('a name-only file (no product codes) never gets high reliability for price findings, and says why', async () => {
    const r = await runPurchasingFixture(fx.find((f) => f.id === 'en-csv-names-only')!);
    const model = buildPurchasingDashboard(r.records, { series: { currency: 'EUR', basis: 'unknown' }, filters: {}, period: { preset: 'r30' } })!;
    const a = analyzePurchasingPeriod(model);
    for (const id of ['purchasing.price_increase', 'purchasing.supplier_price_gap', 'purchasing.price_decrease']) {
      const i = find(a.insights, id);
      if (i) expect([i.reliability, i.reliabilityReasonKey]).toEqual(['low', 'rel.nameIdentity']);
    }
    expect(find(a.insights, 'purchasing.historical_price_scenario')).toBeUndefined(); // hypothetical scenarios require verified identifiers
  });
  it('an ambiguous product code never produces a price insight', () => {
    const { insights } = run();
    const keys = insights.flatMap((i) => i.evidence.map((e) => e.key));
    expect(keys).not.toContain('sku:p99');
  });
});

describe('supplier and spend insights', () => {
  it('suppliers behind cost increases match an independent per-supplier calculation', () => {
    const { insights, model } = run();
    const i = find(insights, 'purchasing.supplier_cost_increase');
    const sup = (w: typeof CUR) => { const m = new Map<string, number>(); for (const t of inWin(truth, w)) m.set(t.supplier, (m.get(t.supplier) ?? 0) + t.net / 100); return m; };
    const c = sup(CUR), p = sup(PREV);
    const prevTotal = [...p.values()].reduce((a, b) => a + b, 0);
    const exp = [...c.keys()].filter((k) => (p.get(k) ?? 0) > 0 && c.get(k)! - p.get(k)! >= Math.max(prevTotal * 0.005, 1) && (c.get(k)! - p.get(k)!) / p.get(k)! >= 0.05);
    if (exp.length === 0) return expect(i).toBeUndefined();
    expect(i!.params.count).toBe(exp.length);
    expect(money(i!, 'increase')).toBeCloseTo(exp.reduce((s, k) => s + c.get(k)! - p.get(k)!, 0), 6);
    // evidence == table == drill-down
    for (const e of i!.evidence) {
      const row = model.tables.supplier!.rows.find((r) => r.key === e.key)!;
      expect([e.current, e.previous]).toEqual([row.current, row.previous]);
      const d = drillPurchaseRecords(model.records, { filter: { suppliers: [e.key!] }, range: model.periods.current });
      expect(d.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(e.current, 6);
    }
  });
  it('spend change equals the KPI and its split (price / volume / other) adds up to the change', () => {
    const { insights, model } = run();
    const i = find(insights, 'purchasing.spend_change')!;
    const s = model.kpis.find((k) => k.id === 'p_spend')!;
    if (!i) return expect(Math.abs(s.pct!)).toBeLessThan(0.05);
    expect(money(i, 'current')).toBeCloseTo(s.current!, 6);
    expect(money(i, 'previous')).toBeCloseTo(s.previous!, 6);
    const signed = (s.abs! >= 0 ? 1 : -1);
    expect(money(i, 'price') + money(i, 'volume') + money(i, 'other')).toBeCloseTo(s.abs!, 6);
    void signed;
  });
  it('concentration: a dominant supplier triggers it; evenly spread suppliers do not; fewer than three suppliers never do', () => {
    const base = (sup: string, amount: number, i: number): PurchaseRecord => ({ key: 'k' + i, date: '2025-12-01', amount, basis: 'net', currency: 'EUR', sourceRow: i, supplierName: sup, documentId: 'D' + i });
    const dominant = [base('A', 600, 1), base('B', 150, 2), base('C', 150, 3), base('D', 100, 4), base('A', 10, 5), base('B', 10, 6), base('A', 5, 7), base('C', 5, 8)];
    const a = analyzePurchasingPeriod(buildPurchasingDashboard(dominant, { series: NET, filters: {}, period: { preset: 'r30' } })!);
    const i = find(a.insights, 'purchasing.supplier_concentration')!;
    expect((i.params.top1 as { pct: number }).pct).toBeCloseTo(615 / 1030, 9);
    expect(i.impact.value).toBeCloseTo(615 + 160 + 155, 9);
    const even = ['A', 'B', 'C', 'D', 'E'].map((s, n) => base(s, 100, n));
    expect(find(analyzePurchasingPeriod(buildPurchasingDashboard(even, { series: NET, filters: {}, period: { preset: 'r30' } })!).insights, 'purchasing.supplier_concentration')).toBeUndefined();
    expect(analyzePurchasingPeriod(buildPurchasingDashboard(dominant.slice(0, 2), { series: NET, filters: {}, period: { preset: 'r30' } })!).unavailable.find((u) => u.rule === 'supplier_concentration')).toBeDefined();
  });
});

describe('anomalies', () => {
  it('unusual quantity: the 400 kg cheese line and the 700-box lines are flagged against their own item history – matching an independent median / MAD test', () => {
    const { insights } = run();
    const i = find(insights, 'purchasing.unusual_quantity')!;
    const hist = new Map<string, number[]>();
    for (const t of truth) if (t.net > 0 && t.qty > 0 && t.date < CUR.from) { const k = t.sku + canon(t.unit); (hist.get(k) ?? hist.set(k, []).get(k)!).push(t.qty); }
    const flagged = inWin(truth, CUR).filter((t) => {
      const h = hist.get(t.sku + canon(t.unit));
      if (t.net <= 0 || !h || h.length < 8) return false;
      const med = median(h), mad = median(h.map((x) => Math.abs(x - med)));
      return med > 0 && t.qty >= 3 * med && (mad === 0 || (0.6745 * (t.qty - med)) / mad > 3.5);
    });
    expect(i.params.count).toBe(flagged.length);
    expect(money(i, 'amount')).toBeCloseTo(flagged.reduce((s, t) => s + t.net / 100, 0), 6);
    expect(flagged.some((t) => t.doc.endsWith('ODD1'))).toBe(true); // the 400 kg line is among them (the evidence list shows the five largest)
    expect(i.evidence.length).toBeLessThanOrEqual(5);
  });
  it('spending anomaly: the planted heavy week is the one flagged', () => {
    const i = find(run().insights, 'purchasing.spend_anomaly')!;
    expect(i).toBeDefined();
    expect(i.evidence.map((e) => e.label)).toContain('2025-12-01');
  });
  it('anomaly rules stay silent without enough history instead of guessing', () => {
    const short = recs.filter((r) => r.date >= '2025-10-20');
    const a = run({ preset: 'r30' }, {}, short);
    expect(a.unavailable.filter((u) => ['spend_anomaly', 'unusual_quantity'].includes(u.rule)).every((u) => ['too_little_history', 'nothing_found'].includes(u.reason))).toBe(true);
    expect(find(a.insights, 'purchasing.spend_anomaly')).toBeUndefined();
  });
});

describe('credit notes: only what the data supports', () => {
  it('fewer credit notes than before is reported as a FACT with counts – never as "missing credits"', () => {
    const i = find(run().insights, 'purchasing.credit_notes_reduced')!;
    expect(i.params).toMatchObject({ prevDocs: 4, curDocs: 0 });
    expect(money(i, 'prev')).toBeCloseTo(1040, 6);
    expect(money(i, 'cur')).toBe(0);
    expect(i.reliability).toBe('medium'); // never "high": absence cannot be proven
    expect(i.severity).toBe('info');
    expect(i.titleKey).toBe('purchasing.credit_notes_reduced.title');
  });
  it('without credit history in the previous period the rule is unavailable (nothing to compare with)', () => {
    const noCredit = recs.filter((r) => r.amount > 0);
    const a = run({ preset: 'r30' }, {}, noCredit);
    expect(a.unavailable).toContainEqual({ rule: 'credit_notes_reduced', reason: 'no_credit_history' });
  });
  it('fewer than three credit documents before is not enough history', () => {
    const fewer = recs.filter((r) => !(r.documentId === 'KR-3' || r.documentId === 'KR-4'));
    expect(run({ preset: 'r30' }, {}, fewer).unavailable).toContainEqual({ rule: 'credit_notes_reduced', reason: 'no_credit_history' });
  });
  it('similar credit levels in both periods produce no finding', () => {
    const extra = recs.filter((r) => r.documentId?.startsWith('KR-')).map((r, i) => ({ ...r, key: 'c' + i, date: `2025-12-0${(i % 5) + 1}`, documentId: 'KRX-' + i }));
    expect(find(run({ preset: 'r30' }, {}, [...recs, ...extra]).insights, 'purchasing.credit_notes_reduced')).toBeUndefined();
  });
});

describe('ranking, periods, filters and missing data', () => {
  it('at most 10 insights, one per topic, story groups capped, sorted by score, all complete', () => {
    const { insights } = run();
    expect(insights.length).toBeGreaterThanOrEqual(6);
    expect(insights.length).toBeLessThanOrEqual(10);
    expect(new Set(insights.map((i) => i.topic)).size).toBe(insights.length);
    const g = new Map<string, number>();
    insights.forEach((i) => g.set(i.group, (g.get(i.group) ?? 0) + 1));
    expect(Math.max(...g.values())).toBeLessThanOrEqual(3);
    expect(insights.map((i) => i.score)).toEqual([...insights.map((i) => i.score)].sort((a, b) => b - a));
    for (const i of insights) {
      expect(i.module).toBe('purchasing');
      expect(i.titleKey && i.bodyKey && i.actionKey && i.whyKey && i.reliabilityReasonKey).toBeTruthy();
      expect(i.impact.value).toBeGreaterThan(0);
    }
  });
  it('insights follow the selected period: a different period gives different findings', () => {
    const a = run({ preset: 'r30' }).insights.map((i) => `${i.id}:${i.impact.value.toFixed(2)}`);
    const b = run({ preset: 'custom', custom: { current: { from: '2025-10-01', to: '2025-10-31' }, previous: { from: '2025-09-01', to: '2025-09-30' } } }).insights.map((i) => `${i.id}:${i.impact.value.toFixed(2)}`);
    expect(a).not.toEqual(b);
  });
  it('windows of different length lower reliability of every change insight', () => {
    const { insights } = run({ preset: 'custom', custom: { current: { from: '2025-11-01', to: '2025-11-30' }, previous: { from: '2025-10-01', to: '2025-10-15' } } });
    const ch = insights.filter((i) => i.params.days !== undefined);
    expect(ch.length).toBeGreaterThan(0);
    for (const i of ch) expect([i.reliability, i.reliabilityReasonKey]).toEqual(['low', 'rel.unequalPeriods']);
  });
  it('no previous data → no change insights are invented', () => {
    const { insights } = run({ preset: 'yoy' });
    expect(insights.filter((i) => i.params.days !== undefined)).toEqual([]);
  });
  it('a supplier filter restricts every insight to that supplier', () => {
    const { insights, model } = run({ preset: 'r30' }, { suppliers: ['s1'] });
    expect(model.records.every((r) => r.supplierId === 'S1')).toBe(true);
    for (const i of insights.filter((x) => x.dimension === 'supplier')) expect(i.evidence.every((e) => e.key === 's1')).toBe(true);
    const inc = find(insights, 'purchasing.price_increase')!;
    expect(inc.evidence.every((e) => e.label.includes('Žemaitijos'))).toBe(true);
  });
  it('without supplier data the supplier rules are unavailable with a reason', () => {
    const { unavailable, insights } = run({ preset: 'r30' }, {}, recs.map((r) => ({ ...r, supplierName: undefined, supplierId: undefined })));
    expect(unavailable).toEqual(expect.arrayContaining([{ rule: 'supplier_price_gap', reason: 'no_supplier' }, { rule: 'supplier_cost_increase', reason: 'no_supplier' }, { rule: 'supplier_concentration', reason: 'no_supplier' }]));
    expect(insights.some((i) => i.dimension === 'supplier')).toBe(false);
  });
  it('without product data the price rules are unavailable', () => {
    const { unavailable } = run({ preset: 'r30' }, {}, recs.map((r) => ({ ...r, productId: undefined, productName: undefined })));
    expect(unavailable).toEqual(expect.arrayContaining([{ rule: 'price_increase', reason: 'no_product' }, { rule: 'price_decrease', reason: 'no_product' }]));
  });
  it('drill-down from every price contributor reconciles with the evidence quantity-weighted prices', () => {
    const { insights, model } = run();
    const i = find(insights, 'purchasing.price_increase')!;
    const e = i.evidence[0]!;
    const rows = drillPurchaseRecords(model.records, { filter: { products: [e.key!] }, range: model.periods.current }).filter((r) => r.supplierId === 'S1' && (r.quantity ?? 0) > 0 && r.amount > 0);
    expect(rows.reduce((s, r) => s + r.amount, 0) / rows.reduce((s, r) => s + r.quantity!, 0)).toBeCloseTo(e.current, 9);
  });
  it('partial period (month-over-month) still compares like-for-like and carries the same warnings', () => {
    const { model, insights } = run({ preset: 'mom' });
    expect(model.warnings.map((w) => w.code)).toContain('partial_current');
    expect(insights.length).toBeGreaterThan(0);
    const s = model.kpis.find((k) => k.id === 'p_spend')!;
    expect(s.current).toBeCloseTo(sumNet(inWin(truth, { from: '2025-12-01', to: '2025-12-15' })), 2);
  });
});
