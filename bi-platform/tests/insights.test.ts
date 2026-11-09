import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtures, type Fixture } from './fixtures/formats';
import { makeTruth } from './fixtures/truth';
import { runFixture } from './helpers';
import { analyzeSales, rankInsights, MAX_INSIGHTS } from '@/engine/insights/engine';
import { assignKeys } from '@/engine/import/keys';
import type { Insight, SalesRecord } from '@/engine/types';

let fx: Fixture[] = [];
beforeAll(async () => {
  fx = await buildFixtures();
});
const get = (id: string) => fx.find((f) => f.id === id)!;

describe('sales insights are computed, not invented', () => {
  it('customers_declined matches an independent calculation from the ground truth', async () => {
    const f = get('lt-csv-utf8');
    const a = analyzeSales((await runFixture(f)).records)!;
    const ins = a.insights.find((i) => i.id === 'sales.customers_declined')!;
    expect(ins).toBeDefined();

    // independent re-computation (cents → euros), windows: last 30 days vs the 30 before
    const cur = new Map<string, number>();
    const prev = new Map<string, number>();
    for (const t of f.truth) {
      const m = t.date >= '2025-11-16' ? cur : t.date >= '2025-10-17' && t.date <= '2025-11-15' ? prev : null;
      m?.set(t.customer, (m.get(t.customer) ?? 0) + t.net / 100);
    }
    const prevTotal = [...prev.values()].reduce((x, y) => x + y, 0);
    let count = 0;
    let loss = 0;
    let lost = 0;
    for (const [c, p] of prev) {
      const n = cur.get(c) ?? 0;
      if (p >= Math.max(prevTotal * 0.005, 1) && n <= p * 0.7) {
        count++;
        loss += p - n;
        if (n === 0) lost++;
      }
    }
    expect(ins.params.count).toBe(count);
    expect(ins.params.lost).toBe(lost);
    expect((ins.params.loss as { money: number }).money).toBeCloseTo(loss, 2);
    expect(ins.impact.value).toBeCloseTo(loss, 2);
    expect(ins.evidence.length).toBeGreaterThan(0);
  });

  it('every insight is complete and explainable', async () => {
    const a = analyzeSales((await runFixture(get('en-xlsx-multisheet'))).records)!;
    expect(a.insights.length).toBeGreaterThanOrEqual(4);
    expect(a.insights.length).toBeLessThanOrEqual(MAX_INSIGHTS);
    for (const i of a.insights) {
      expect(i.titleKey && i.bodyKey && i.actionKey && i.reliabilityReasonKey).toBeTruthy();
      expect(['high', 'medium', 'low']).toContain(i.reliability);
      expect(i.impact.value).toBeGreaterThan(0);
      expect(i.score).toBeGreaterThan(0);
    }
    // sorted by score
    expect(a.insights.map((i) => i.score)).toEqual([...a.insights.map((i) => i.score)].sort((x, y) => y - x));
  });

  it('never repeats a topic and caps story groups', async () => {
    for (const id of ['lt-csv-utf8', 'pl-csv-1250', 'en-xlsx-multisheet']) {
      const a = analyzeSales((await runFixture(get(id))).records)!;
      const topics = a.insights.map((i) => i.topic);
      expect(new Set(topics).size).toBe(topics.length);
      const groups = new Map<string, number>();
      a.insights.forEach((i) => groups.set(i.group, (groups.get(i.group) ?? 0) + 1));
      expect(Math.max(...groups.values())).toBeLessThanOrEqual(3);
    }
  });

  it('near-duplicate insights on one topic collapse to the best one', () => {
    const mk = (id: string, value: number): Insight => ({
      id, topic: 'same', group: 'decline', module: 'sales', severity: 'risk', titleKey: 't', bodyKey: 'b', actionKey: 'a', params: {},
      reliability: 'high', reliabilityReasonKey: 'r', impact: { value, unit: 'money' }, actionable: true, evidence: [], score: 0,
    });
    const out = rankInsights([mk('a', 10), mk('b', 50), mk('c', 20)], { total: 100, window: 100 });
    expect(out.map((i) => i.id)).toEqual(['b']);
  });
});

describe('missing data → no insight (A4)', () => {
  it('no cost column → no margin claims', async () => {
    const a = analyzeSales((await runFixture(get('lt-csv-utf8'))).records)!;
    expect(a.kpis.margin).toBeUndefined();
    expect(a.insights.some((i) => i.topic === 'margin')).toBe(false);
    expect(a.unavailable).toContainEqual({ rule: 'margin', reason: 'no_cost' });
  });
  it('no salesperson → no salesperson insight', async () => {
    const a = analyzeSales((await runFixture(get('en-xlsx-multisheet'))).records)!;
    expect(a.insights.some((i) => i.id === 'sales.salesperson_decline')).toBe(false);
    expect(a.unavailable).toContainEqual({ rule: 'salesperson_decline', reason: 'no_salesperson' });
  });
  it('cost on <80 % of lines → margin is not reported', async () => {
    const r = (await runFixture(get('en-xlsx-multisheet'))).records;
    const thin = r.map((x, i) => (i % 3 === 0 ? x : { ...x, cost: undefined }));
    expect(analyzeSales(thin)!.kpis.margin).toBeUndefined();
  });
  it('margin is not computed on gross or unspecified-VAT amounts', async () => {
    const r = (await runFixture(get('en-xlsx-multisheet'))).records;
    const gross = r.map((x) => ({ ...x, basis: 'gross' as const }));
    expect(analyzeSales(gross)!.kpis.margin).toBeUndefined();
  });
  it('under two weeks of history → no period comparisons', async () => {
    const r = (await runFixture(get('lt-csv-utf8'))).records.filter((x) => x.date <= '2025-09-10');
    const a = analyzeSales(r)!;
    expect(a.periods).toBeNull();
    expect(a.insights.some((i) => ['sales.revenue_change', 'sales.customers_declined'].includes(i.id))).toBe(false);
  });
  it('without any customer column no customer insights are produced', async () => {
    const r = (await runFixture(get('lt-csv-utf8'))).records.map((x) => ({ ...x, customerName: undefined, customerId: undefined }));
    const a = analyzeSales(r)!;
    expect(a.insights.some((i) => i.id.includes('customer'))).toBe(false);
  });
});

describe('series are separated', () => {
  it('analyses one currency at a time', async () => {
    const eur = (await runFixture(get('lt-csv-utf8'))).records;
    const pln = (await runFixture(get('pl-csv-1250'))).records;
    const mixed = [...eur, ...pln];
    const a = analyzeSales(mixed)!;
    expect(a.allSeries).toHaveLength(2);
    const b = analyzeSales(mixed, { currency: 'PLN', basis: 'net' })!;
    expect(b.series.currency).toBe('PLN');
    expect(b.kpis.lines).toBe(pln.length);
  });
});

describe('revenue change rule', () => {
  const rec = (date: string, amount: number, i: number): SalesRecord => ({ key: `k${i}`, date, amount, basis: 'net', currency: 'EUR', sourceRow: i, customerName: 'C' + (i % 5) });
  it('detects a 50 % decline between equal windows', () => {
    const rows: SalesRecord[] = [];
    let n = 0;
    for (let d = 0; d < 60; d++) {
      const date = new Date(Date.UTC(2025, 0, 1 + d)).toISOString().slice(0, 10);
      rows.push(rec(date, d < 30 ? 200 : 100, n++), rec(date, d < 30 ? 200 : 100, n++));
    }
    const a = analyzeSales(assignKeys(rows.map(({ key: _k, ...r }) => (void _k, r))))!;
    const ins = a.insights.find((i) => i.id === 'sales.revenue_change')!;
    expect(ins.titleKey).toContain('down');
    expect((ins.params.pct as { pct: number }).pct).toBeCloseTo(0.5, 5);
    expect((ins.params.delta as { money: number }).money).toBeCloseTo(6000, 5);
  });
});

describe('truth generator sanity', () => {
  it('is deterministic', () => {
    expect(makeTruth('lt')).toEqual(makeTruth('lt'));
  });
});
