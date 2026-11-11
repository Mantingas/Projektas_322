import { beforeAll, describe, expect, it } from 'vitest';
import { buildDashboardWithInsights, buildDashboard } from '@/engine/analytics/dashboard';
import { analyzeSales } from '@/engine/insights/engine';
import { availablePresets, resolvePeriods, type PeriodSelection } from '@/engine/analytics/periods';
import { drillRecords } from '@/engine/analytics/provenance';
import { applyFilters, dimensionOf } from '@/engine/analytics/filters';
import { aggregate } from '@/engine/analytics/aggregate';
import { buildFixtures, type Fixture } from './fixtures/formats';
import { makeTruth, type TruthLine } from './fixtures/truth';
import { runFixture } from './helpers';
import type { Insight, SalesRecord } from '@/engine/types';

const NET = { currency: 'EUR', basis: 'net' as const };
let recs: SalesRecord[] = [];
// Phase 10B (I1): filter keys come from the engine (`id:<code>` or `name:<name>`)
const ckey = (name: string) => dimensionOf.customer(recs.find((r) => r.customerName === name)!)!.key;
const pkey = (name: string) => dimensionOf.product(recs.find((r) => r.productName === name)!)!.key;
let truth: TruthLine[] = [];
let fx: Fixture[] = [];
beforeAll(async () => {
  fx = await buildFixtures();
  const f = fx.find((x) => x.id === 'lt-xlsx-title')!;
  truth = f.truth;
  recs = (await runFixture(f)).records;
});

const run = (period: PeriodSelection, filters = {}, all = recs, series = NET) => buildDashboardWithInsights(all, { series, filters, period })!;
const find = (ins: Insight[] | undefined, id: string) => ins?.find((i) => i.id === id);
const money = (i: Insight, k: string) => (i.params[k] as { money: number }).money;

// plain-loop reference over the raw truth
function byEntity(rows: TruthLine[], pick: (t: TruthLine) => string) {
  const m = new Map<string, number>();
  for (const t of rows) m.set(pick(t), (m.get(pick(t)) ?? 0) + t.net / 100);
  return m;
}
const within = (from: string, to: string) => truth.filter((t) => t.date >= from && t.date <= to);

describe('primary insights follow the selected period', () => {
  const cases: [string, PeriodSelection, [string, string], [string, string]][] = [
    ['rolling 30 days', { preset: 'r30' }, ['2025-11-16', '2025-12-15'], ['2025-10-17', '2025-11-15']],
    ['month over month (like-for-like)', { preset: 'mom' }, ['2025-12-01', '2025-12-15'], ['2025-11-01', '2025-11-15']],
    ['custom Oct vs Sep', { preset: 'custom', custom: { current: { from: '2025-10-01', to: '2025-10-31' }, previous: { from: '2025-09-01', to: '2025-09-30' } } }, ['2025-10-01', '2025-10-31'], ['2025-09-01', '2025-09-30']],
    ['year to date', { preset: 'ytd' }, ['2025-01-01', '2025-12-15'], ['2024-01-01', '2024-12-15']],
  ];

  it.each(cases)('%s: revenue-change insight equals the KPI and an independent sum', (_n, sel, cur, prev) => {
    const { model, analysis } = run(sel);
    const sales = model.kpis.find((k) => k.id === 'sales')!;
    const c = within(...cur).reduce((s, t) => s + t.net, 0) / 100;
    const p = within(...prev).reduce((s, t) => s + t.net, 0) / 100;
    expect(sales.current).toBeCloseTo(c, 2);
    const ins = find(analysis?.insights, 'sales.revenue_change');
    if (p <= 0 || Math.abs((c - p) / p) < 0.05) return; // no insight is correct then
    expect(money(ins!, 'current')).toBeCloseTo(c, 2);
    expect(money(ins!, 'previous')).toBeCloseTo(p, 2);
    expect(ins!.impact.value).toBeCloseTo(Math.abs(c - p), 2);
    expect(analysis!.periods).toMatchObject({ currentFrom: cur[0], currentTo: cur[1], previousFrom: prev[0], previousTo: prev[1] });
  });

  it.each(cases.slice(0, 3))('%s: customers_declined equals an independent calculation', (_n, sel, cur, prev) => {
    const { analysis } = run(sel);
    const c = byEntity(within(...cur), (t) => t.customer);
    const p = byEntity(within(...prev), (t) => t.customer);
    const prevTotal = [...p.values()].reduce((a, b) => a + b, 0);
    let count = 0, loss = 0, lost = 0;
    for (const [k, pv] of p) {
      const cv = c.get(k) ?? 0;
      if (pv >= Math.max(prevTotal * 0.005, 1) && cv <= pv * 0.7) { count++; loss += pv - cv; if (cv === 0) lost++; }
    }
    const ins = find(analysis?.insights, 'sales.customers_declined');
    if (count === 0) return expect(ins).toBeUndefined();
    expect(ins!.params.count).toBe(count);
    expect(ins!.params.lost).toBe(lost);
    expect(money(ins!, 'loss')).toBeCloseTo(loss, 2);
  });

  it('changing the period changes the insights (they are not fixed windows any more)', () => {
    const a = run({ preset: 'r30' }).analysis!.insights.map((i) => `${i.id}:${i.impact.value.toFixed(2)}`);
    const b = run({ preset: 'r7' }).analysis!.insights.map((i) => `${i.id}:${i.impact.value.toFixed(2)}`);
    expect(a).not.toEqual(b);
  });

  it('concentration / credit-note insights are scoped to the selected period, not all history', () => {
    const { analysis } = run({ preset: 'r30' });
    const cur = within('2025-11-16', '2025-12-15');
    const neg = cur.filter((t) => t.net < 0);
    const pos = cur.filter((t) => t.net > 0).reduce((s, t) => s + t.net, 0);
    const ins = find(analysis?.insights, 'sales.credit_notes');
    const negSum = Math.abs(neg.reduce((s, t) => s + t.net, 0)) / 100;
    if (neg.length && negSum / (pos / 100) >= 0.02) {
      expect(ins!.params.lines).toBe(neg.length);
      expect(money(ins!, 'amount')).toBeCloseTo(negSum, 2);
    } else expect(ins).toBeUndefined();
  });
});

describe('insights use the same filters as the dashboard', () => {
  it('a product filter restricts insight amounts to that product', () => {
    const prod = truth[0]!.product;
    const f = { products: [pkey(prod)] };
    const { model, analysis } = run({ preset: 'r30' }, f);
    expect(model.records.every((r) => r.productName === prod)).toBe(true);
    const sales = model.kpis.find((k) => k.id === 'sales')!;
    const ins = find(analysis?.insights, 'sales.revenue_change');
    if (ins) {
      expect(money(ins, 'current')).toBeCloseTo(sales.current!, 6);
      expect(money(ins, 'previous')).toBeCloseTo(sales.previous!, 6);
    }
    const c = within('2025-11-16', '2025-12-15').filter((t) => t.product === prod).reduce((s, t) => s + t.net, 0) / 100;
    expect(sales.current).toBeCloseTo(c, 2);
  });
});

describe('financial amounts reconcile across KPIs, insights, tables, charts and drill-down', () => {
  it('evidence rows == entity table rows == drill-down sums', () => {
    const { model, analysis } = run({ preset: 'r30' });
    for (const id of ['sales.customers_declined', 'sales.product_decline', 'sales.product_growth']) {
      const ins = find(analysis?.insights, id);
      if (!ins) continue;
      const table = model.tables[ins.dimension as 'customer' | 'product']!;
      for (const e of ins.evidence) {
        const row = table.rows.find((r) => r.key === e.key)!;
        expect(row, `${id}:${e.label}`).toBeDefined();
        expect(e.current).toBeCloseTo(row.current, 6);
        expect(e.previous).toBeCloseTo(row.previous, 6);
        const cur = drillRecords(model.records, { filter: { [ins.dimension === 'customer' ? 'customers' : 'products']: [e.key!] }, range: model.periods.current });
        const prev = drillRecords(model.records, { filter: { [ins.dimension === 'customer' ? 'customers' : 'products']: [e.key!] }, range: model.periods.previous });
        expect(cur.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(e.current, 6);
        expect(prev.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(e.previous!, 6);
      }
    }
  });
  it('insight totals equal the sum of table rows that meet the rule', () => {
    const { model, analysis } = run({ preset: 'r30' });
    const ins = find(analysis?.insights, 'sales.customers_declined')!;
    const prevTotal = model.tables.customer!.totalPrevious;
    const rows = model.tables.customer!.rows.filter((r) => r.previous >= Math.max(prevTotal * 0.005, 1) && r.current <= r.previous * 0.7);
    expect(ins.params.count).toBe(rows.length);
    expect(money(ins, 'loss')).toBeCloseTo(rows.reduce((s, r) => s + (r.previous - r.current), 0), 6);
  });
  it('revenue-change insight reconciles with the KPI card and with the comparison chart totals', () => {
    const { model, analysis } = run({ preset: 'r30' });
    const sales = model.kpis.find((k) => k.id === 'sales')!;
    const ins = find(analysis?.insights, 'sales.revenue_change');
    if (ins) {
      expect(money(ins, 'current')).toBeCloseTo(sales.current!, 6);
      expect(ins.impact.value).toBeCloseTo(Math.abs(sales.abs!), 6);
    }
    expect(model.aligned.points.reduce((s, p) => s + p.current, 0)).toBeCloseTo(sales.current!, 6);
  });
  it('the legacy rolling analysis agrees with the period-aware one when the windows are the same', () => {
    const rolling = analyzeSales(recs, NET)!;
    const { analysis } = run({ preset: 'r30' });
    for (const id of ['sales.customers_declined', 'sales.product_decline', 'sales.product_growth']) {
      const a = find(rolling.insights, id), b = find(analysis?.insights, id);
      expect(Boolean(a), id).toBe(Boolean(b));
      if (a && b) expect(a.impact.value).toBeCloseTo(b.impact.value, 6);
    }
  });
});

describe('currency, VAT basis and window length', () => {
  it('insights only use the selected currency / VAT series', async () => {
    const pl = (await runFixture(fx.find((f) => f.id === 'pl-csv-1250')!)).records;
    const mixed = [...recs, ...pl];
    const eur = run({ preset: 'r30' }, {}, mixed, NET);
    const pln = run({ preset: 'r30' }, {}, mixed, { currency: 'PLN', basis: 'net' });
    expect(eur.model.records).toHaveLength(recs.length);
    expect(pln.model.records).toHaveLength(pl.length);
    const a = find(eur.analysis?.insights, 'sales.customers_declined')!;
    const b = find(pln.analysis?.insights, 'sales.customers_declined')!;
    expect(money(a, 'loss')).not.toBeCloseTo(money(b, 'loss'), 2);
    expect(aggregate(eur.model.records).revenue).toBeCloseTo(recs.reduce((s, r) => s + r.amount, 0), 6);
  });
  it('windows of different length lower the reliability of every change insight', () => {
    const { analysis } = run({ preset: 'custom', custom: { current: { from: '2025-11-01', to: '2025-11-30' }, previous: { from: '2025-10-01', to: '2025-10-15' } } });
    const changeInsights = analysis!.insights.filter((i) => i.params.days !== undefined);
    expect(changeInsights.length).toBeGreaterThan(0);
    for (const i of changeInsights) expect([i.reliability, i.reliabilityReasonKey]).toEqual(['low', 'rel.unequalPeriods']);
  });
  it('no previous data → no change insights are invented', () => {
    const { analysis } = run({ preset: 'yoy' });
    expect(analysis!.insights.filter((i) => i.params.days !== undefined)).toEqual([]);
  });
});

describe('year-to-date', () => {
  const b = { dateMin: '2024-01-01', dateMax: '2025-12-15' };
  it('compares 1 Jan → latest date with the same span a year earlier', () => {
    const p = resolvePeriods({ preset: 'ytd' }, b);
    expect(p.current).toEqual({ from: '2025-01-01', to: '2025-12-15' });
    expect(p.previous).toEqual({ from: '2024-01-01', to: '2024-12-14' }); // 349 elapsed days, same as 2025 (2024 is a leap year)
    expect(p.status).toEqual({ kind: 'to_date', elapsed: 349, total: 365 });
    expect(p.equivalent).toBe(true);
  });
  it('is only offered when the data reaches back to 1 January; otherwise warns', () => {
    expect(availablePresets({ dateMin: '2025-09-01', dateMax: '2025-12-15' })).not.toContain('ytd');
    expect(availablePresets(b)).toContain('ytd');
    const p = resolvePeriods({ preset: 'ytd' }, { dateMin: '2025-09-01', dateMax: '2025-12-15' });
    expect(p.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['ytd_coverage', 'no_previous_data']));
  });
  it('leap day: both sides still cover the same number of elapsed days', () => {
    const p = resolvePeriods({ preset: 'ytd' }, { dateMin: '2023-01-01', dateMax: '2024-02-29' });
    expect(p.currentDays).toBe(60);
    expect(p.previousDays).toBe(60);
    expect(p.equivalent).toBe(true);
  });
  it('year-to-date KPI equals an independent sum (data covers 2025 only → previous is blocked, not invented)', () => {
    const d = buildDashboard(recs, { series: NET, filters: {}, period: { preset: 'ytd' } })!;
    const sales = d.kpis.find((k) => k.id === 'sales')!;
    expect(sales.current).toBeCloseTo(truth.reduce((s, t) => s + t.net, 0) / 100, 2);
    expect(sales.status).toBe('blocked');
  });
});

describe('explicit incomplete-period indicators', () => {
  const b = { dateMin: '2025-01-01', dateMax: '2025-12-15' };
  it('calendar presets report partial vs complete', () => {
    expect(resolvePeriods({ preset: 'mom' }, b).status).toEqual({ kind: 'partial', elapsed: 15, total: 31 });
    expect(resolvePeriods({ preset: 'mom' }, { ...b, dateMax: '2025-11-30' }).status).toEqual({ kind: 'complete', days: 30 });
    expect(resolvePeriods({ preset: 'r30' }, b).status).toEqual({ kind: 'complete', days: 30 });
    expect(resolvePeriods({ preset: 'wow' }, { ...b, dateMax: '2025-12-17' }).status).toMatchObject({ kind: 'partial' });
  });
});

describe('filter behaviour is identical across every view', () => {
  it('model records, tables, aligned series and drill-down all see the same filtered lines', () => {
    const name = truth[2]!.customer;
    const d = buildDashboard(recs, { series: NET, filters: { customers: [ckey(name)], text: truth[2]!.product.slice(0, 5) }, period: { preset: 'r30' } })!;
    const expected = applyFilters(recs, { customers: [ckey(name)], text: truth[2]!.product.slice(0, 5) });
    expect(d.records).toHaveLength(expected.length);
    const total = expected.filter((r) => r.date >= '2025-11-16').reduce((s, r) => s + r.amount, 0);
    expect(d.kpis.find((k) => k.id === 'sales')!.current).toBeCloseTo(total, 6);
    expect(d.tables.product!.totalCurrent).toBeCloseTo(total, 6);
    expect(d.aligned.points.reduce((s, p) => s + p.current, 0)).toBeCloseTo(total, 6);
  });
});
