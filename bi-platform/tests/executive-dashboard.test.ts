import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { EngineSession } from '@/lib/engineSession';
import { composeExecutive, WEIGHTS, MAX_INSIGHTS, MAX_KPIS, type ModuleSnapshot } from '@/engine/executive/compose';
import { customerLink, makeExecutive, productLinks, seedDb, link } from './fixtures/executive';
import { END, refOutstanding, refOverdue } from './fixtures/finance';
import type { Insight } from '@/engine/types';

const d = makeExecutive();
async function session(links = [...productLinks(), customerLink()], tweak?: (db: AppDB) => Promise<void>) {
  const db = new AppDB('exec-' + Math.random().toString(36).slice(2));
  await seedDb(db, d, links);
  await tweak?.(db);
  return new EngineSession(db);
}
let model: Awaited<ReturnType<EngineSession['buildExecutive']>>['model'];
beforeAll(async () => { model = (await (await session()).buildExecutive({ version: 1 })).model; });
const sumBy = (f: (x: { date: string; amount: number }) => boolean, rows: { date: string; amount: number }[]) => rows.filter(f).reduce((s, r) => s + r.amount, 0);
const kpi = (module: string, id: string, side?: string) => model.kpis.find((k) => k.module === module && k.id === id && k.side === side)!;

describe('executive dashboard reconciles with the modules', () => {
  it('every KPI equals an independent calculation from the source records', () => {
    // each module is shown for ITS OWN latest 30 days: purchasing ends with its last purchase, not with the last sale
    const win = (k: { window?: { from: string; to: string } }) => (x: { date: string }) => x.date >= k.window!.from && x.date <= k.window!.to;
    expect(kpi('sales', 'sales').window).toEqual({ from: '2025-11-16', to: END });
    expect(kpi('purchasing', 'p_spend').window).toEqual({ from: '2025-11-06', to: '2025-12-05' });
    expect(kpi('sales', 'sales').metric.current).toBeCloseTo(sumBy(win(kpi('sales', 'sales')), d.sales), 6);
    expect(kpi('purchasing', 'p_spend').metric.current).toBeCloseTo(sumBy(win(kpi('purchasing', 'p_spend')), d.purchases), 6);
    expect(kpi('inventory', 'i_value').metric.current).toBeCloseTo(d.inventory.reduce((s, r) => s + r.value!, 0), 6);
    expect(kpi('finance', 'f_outstanding', 'receivable').metric.current).toBeCloseTo(refOutstanding(d.ar, END), 2);
    expect(kpi('finance', 'f_overdue', 'receivable').metric.current).toBeCloseTo(refOverdue(d.ar, END), 2);
    expect(kpi('finance', 'f_outstanding', 'payable').metric.current).toBeCloseTo(refOutstanding(d.ap, END), 2);
  });

  it('4–8 KPI cards, one per module metric, each with its own currency and period; nothing is added across modules', () => {
    expect(model.kpis.length).toBeGreaterThanOrEqual(4);
    expect(model.kpis.length).toBeLessThanOrEqual(MAX_KPIS);
    expect(new Set(model.kpis.map((k) => `${k.module}|${k.side}|${k.id}`)).size).toBe(model.kpis.length);
    expect(model.kpis.every((k) => k.currency === 'EUR' && (k.window || k.asOf))).toBe(true);
    // no cross-module total exists: the only totals are per-currency, per-side exposure inside the settlement findings
    expect(Object.keys(model).filter((k) => /total|sum/i.test(k))).toEqual([]);
    expect(JSON.stringify({ ...model, trust: [] })).not.toMatch(/"total(Impact|Value)?"/);
    expect(model.kpis.map((k) => k.module)).toEqual(expect.arrayContaining(['sales', 'purchasing', 'inventory', 'finance']));
  });

  it('5–10 ranked findings, best first, with the documented weights; each belongs to exactly one class', () => {
    expect(model.insights.length).toBeGreaterThanOrEqual(5);
    expect(model.insights.length).toBeLessThanOrEqual(MAX_INSIGHTS);
    const scores = model.insights.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    for (const r of model.insights) {
      const p = r.parts;
      expect(r.score).toBeCloseTo(p.materiality * WEIGHTS.materiality + p.confidence * WEIGHTS.confidence + p.urgency * WEIGHTS.urgency + p.actionability * WEIGHTS.actionability + p.novelty * WEIGHTS.novelty, 9);
      for (const v of Object.values(p)) expect(v >= 0 && v <= 1).toBe(true);
      expect(['fact', 'risk', 'opportunity', 'scenario']).toContain(r.class);
    }
    const all = [...model.risks, ...model.opportunities, ...model.scenarios, ...model.facts].map((r) => r.insight.id).sort();
    expect(all).toEqual(model.insights.map((r) => r.insight.id).sort());
  });

  it('findings come from several modules and from confirmed links', () => {
    const mods = new Set(model.insights.map((r) => r.module));
    expect(mods.size).toBeGreaterThanOrEqual(3);
    expect(model.cross.confirmedLinks).toBeGreaterThan(0);
    expect(model.insights.some((r) => r.module === 'cross')).toBe(true);
  });

  it('shows when data was last imported and what each module covers', () => {
    expect(model.lastImportedAt).toBe(Date.parse('2025-12-16T10:00:00Z'));
    const cov = Object.fromEntries(model.coverage.map((c) => [c.module, c]));
    expect(cov.sales).toMatchObject({ present: true, from: '2025-07-01', to: END, series: 'EUR · net' });
    expect(cov.finance!.sides).toEqual(['receivable', 'payable']);
    expect(model.coverage.every((c) => c.present && c.lastImportedAt === model.lastImportedAt)).toBe(true);
  });

  it('only what is imported is shown: missing modules produce no KPI and no finding', async () => {
    const db = new AppDB('exec-partial');
    const only = { ...d, purchases: [], inventory: [], finance: [] };
    await seedDb(db, only as never, []);
    const m = (await new EngineSession(db).buildExecutive({ version: 1 })).model;
    expect(m.kpis.map((k) => k.module)).toEqual(['sales']);
    expect(m.insights.every((r) => r.module === 'sales')).toBe(true);
    expect(m.coverage.find((c) => c.module === 'inventory')!.present).toBe(false);
    const empty = (await new EngineSession(new AppDB('exec-none')).buildExecutive({ version: 1 })).model;
    expect(empty).toMatchObject({ empty: true, kpis: [], insights: [] });
  });

  it('without confirmed links there are no cross-module findings, but links are proposed', async () => {
    const m = (await (await session([])).buildExecutive({ version: 1 })).model;
    expect(m.insights.some((r) => r.module === 'cross')).toBe(false);
    expect(m.cross.confirmedLinks).toBe(0);
    expect(m.cross.proposedLinks).toBeGreaterThan(0);
    expect(m.cross.reasons.every((r) => r.reason === 'no_links')).toBe(true);
  });

  it('a rejected link behaves like no link', async () => {
    const m = (await (await session([...productLinks('rejected'), customerLink('rejected')])).buildExecutive({ version: 1 })).model;
    expect(m.insights.some((r) => r.module === 'cross')).toBe(false);
  });

  it('incompatible series are never merged: a second currency is listed, not added', async () => {
    const db = new AppDB('exec-multi');
    await seedDb(db, d, []);
    await db.sales.bulkAdd([{ ...d.sales[0]!, key: 'pln1', currency: 'PLN', amount: 999999, importId: 'imp_s', docKey: 'pln1' }, { ...d.sales[1]!, key: 'pln2', currency: 'PLN', amount: 1, importId: 'imp_s', docKey: 'pln2' }] as never);
    const m = (await new EngineSession(db).buildExecutive({ version: 1 })).model;
    const sales = m.coverage.find((c) => c.module === 'sales')!;
    expect(sales.flags).toContain('other_series');
    expect(sales.otherSeries.join(',')).toContain('PLN');
    expect(kpi.call(null, 'sales', 'sales') === undefined).toBe(false);
    expect(m.kpis.find((k) => k.module === 'sales' && k.id === 'sales')!.currency).toBe('EUR');
    expect(m.kpis.find((k) => k.module === 'sales' && k.id === 'sales')!.metric.current).toBeLessThan(900000);
  });

  it('held lines are flagged in the coverage and are not counted', async () => {
    const m = (await (await session(undefined, async (db) => { await db.sales.where('date').equals(END).modify({ heldBy: 'imp_x' }); })).buildExecutive({ version: 1 })).model;
    expect(m.coverage.find((c) => c.module === 'sales')!.flags).toContain('held');
    expect(m.coverage.find((c) => c.module === 'sales')!.to).toBe('2025-12-14'); // the held last day is not part of the data
  });

  it('the result is plain data: it can be cloned across the worker boundary and holds no source records', () => {
    expect(() => structuredClone(model)).not.toThrow();
    // settlement findings carry the few supporting records of each finding (document, amount, file, row); nothing else of a record leaves the worker
    const json = JSON.stringify({ ...model, trust: [] });
    expect(json).not.toMatch(/SF-\d+-P0/);
    expect(json).not.toContain('sourceRow');
    expect(JSON.stringify(model.trust)).not.toMatch(/"(counterpartyId|dueDate|scope|basis)"/);
  });
});

// ───────── ranking, de-duplication, contradictions: pure composition over module findings ─────────
const ins = (id: string, o: Partial<Insight> = {}): Insight => ({ id, topic: id, group: id, module: 'purchasing', severity: 'risk', titleKey: `${id}.title`, bodyKey: `${id}.body`, actionKey: `${id}.action`, whyKey: `${id}.why`, params: {}, reliability: 'high', reliabilityReasonKey: 'rel.enoughLines', impact: { value: 100, unit: 'money' }, actionable: true, evidence: [{ key: 'sku:p02', label: 'Gadget', current: 100, previous: 80, unit: 'money' }], score: 0.5, ...o });
const snap = (module: ModuleSnapshot['module'], insights: Insight[], base = 10000): ModuleSnapshot => ({ module, series: { currency: 'EUR', basis: 'net' }, otherSeries: [], kpis: [], insights, trend: [], bounds: { dateMin: '2025-01-01', dateMax: '2025-12-15' }, lines: 10, imports: [{ fileName: 'f.csv', added: 10, importedAt: 1 }], base, pendingHeld: 0 });
const cross = { insights: [] as Insight[], unavailable: [] };

describe('executive ranking avoids duplicate and contradictory advice', () => {
  it('findings that tell the same story are folded into the strongest one', () => {
    const a = ins('purchasing.price_increase', { impact: { value: 2000, unit: 'money' } });
    const b = ins('purchasing.supplier_cost_increase', { impact: { value: 500, unit: 'money' } });
    const c = ins('purchasing.spend_change', { impact: { value: 300, unit: 'money' } });
    const m = composeExecutive({ snapshots: [snap('purchasing', [a, b, c])], cross, links: [] });
    expect(m.insights.map((r) => r.insight.id)).toEqual(['purchasing.price_increase']);
    expect(m.insights[0]!.related.sort()).toEqual(['purchasing.spend_change', 'purchasing.supplier_cost_increase']);
    expect(m.suppressed.map((s) => s.reason)).toEqual(['duplicate', 'duplicate']);
    expect(m.suppressed[0]!.title.key).toMatch(/\.title$/);
  });

  it('buying more of a product that is piling up is withheld – but only for a link the user confirmed', () => {
    const buy = ins('purchasing.price_decrease', { severity: 'opportunity', evidence: [{ key: 'sku:p02', label: 'Gadget', current: 8, previous: 10, unit: 'price' }] });
    const excess = ins('inventory.excess_stock', { module: 'inventory', severity: 'opportunity', evidence: [{ key: 'sku:p02', label: 'Gadget', current: 100, unit: 'qty' }] });
    const snaps = [snap('purchasing', [buy]), snap('inventory', [excess])];
    const confirmed = composeExecutive({ snapshots: snaps, cross, links: [link('product', ['purchasing', 'sku:p02', 'Gadget'], ['inventory', 'sku:p02', 'Gadget'])] });
    expect(confirmed.insights.map((r) => r.insight.id)).toEqual(['inventory.excess_stock']);
    expect(confirmed.suppressed.map((s) => [s.id, s.reason, s.by])).toEqual([['purchasing.price_decrease', 'contradiction', 'inventory.excess_stock']]);
    for (const links of [[], [link('product', ['purchasing', 'sku:p02', 'Gadget'], ['inventory', 'sku:p02', 'Gadget'], 'rejected')], [link('product', ['purchasing', 'sku:p02', 'Gadget'], ['inventory', 'sku:p02', 'Gadget'], 'proposed' as never)]]) {
      const m = composeExecutive({ snapshots: snaps, cross, links });
      expect(m.insights.map((r) => r.insight.id).sort()).toEqual(['inventory.excess_stock', 'purchasing.price_decrease']);
      expect(m.suppressed).toEqual([]);
    }
    // a different product is unaffected
    const other = ins('inventory.excess_stock', { module: 'inventory', severity: 'opportunity', evidence: [{ key: 'sku:p09', label: 'Other', current: 1, unit: 'qty' }] });
    expect(composeExecutive({ snapshots: [snap('purchasing', [buy]), snap('inventory', [other])], cross, links: [link('product', ['purchasing', 'sku:p02', 'Gadget'], ['inventory', 'sku:p02', 'Gadget'])] }).insights.length).toBe(2);
  });

  it('facts, risks, potential opportunities and hypothetical scenarios stay in separate classes', () => {
    const risk = ins('inventory.stockout_risk', { module: 'inventory' });
    const opp = ins('purchasing.supplier_price_gap', { severity: 'opportunity', savings: { kind: 'potential', amount: 500 } });
    const scen = ins('purchasing.historical_price_scenario', { severity: 'opportunity', savings: { kind: 'hypothetical', amount: 9000 }, impact: { value: 9000, unit: 'money' } });
    const fact = ins('sales.revenue_change', { module: 'sales', severity: 'info' });
    const m = composeExecutive({ snapshots: [snap('purchasing', [opp, scen]), snap('inventory', [risk]), snap('sales', [fact])], cross, links: [] });
    const cls = Object.fromEntries(m.insights.map((r) => [r.insight.id, r.class]));
    expect(cls).toEqual({ 'inventory.stockout_risk': 'risk', 'purchasing.supplier_price_gap': 'opportunity', 'purchasing.historical_price_scenario': 'scenario', 'sales.revenue_change': 'fact' });
    expect(m.scenarios.map((r) => r.insight.id)).toEqual(['purchasing.historical_price_scenario']);
    expect(m.opportunities.map((r) => r.insight.id)).not.toContain('purchasing.historical_price_scenario');
    // a hypothetical scenario never outranks an equally large potential opportunity
    const big = ins('purchasing.supplier_price_gap', { severity: 'opportunity', savings: { kind: 'potential', amount: 9000 }, impact: { value: 9000, unit: 'money' } });
    const r = composeExecutive({ snapshots: [snap('purchasing', [big, scen])], cross, links: [] });
    expect(r.insights[0]!.insight.id).toBe('purchasing.supplier_price_gap');
  });

  it('materiality is relative to the module’s own base; urgency, confidence and certainty matter', () => {
    const small = ins('finance.long_overdue', { module: 'debts', impact: { value: 500, unit: 'money' } });
    const large = ins('finance.long_overdue', { module: 'debts', impact: { value: 5000, unit: 'money' } });
    const a = composeExecutive({ snapshots: [{ ...snap('finance', [small], 100000), side: 'receivable' }], cross, links: [] }).insights[0]!;
    const b = composeExecutive({ snapshots: [{ ...snap('finance', [large], 100000), side: 'receivable' }], cross, links: [] }).insights[0]!;
    expect(b.parts.materiality).toBeGreaterThan(a.parts.materiality);
    expect(a.parts.urgency).toBe(1);
    const weak = composeExecutive({ snapshots: [snap('purchasing', [ins('purchasing.spend_anomaly', { reliability: 'low', certainty: 'possible' })])], cross, links: [] }).insights[0]!;
    const strong = composeExecutive({ snapshots: [snap('purchasing', [ins('purchasing.spend_anomaly', { reliability: 'high', certainty: 'fact' })])], cross, links: [] }).insights[0]!;
    expect(strong.parts.confidence).toBeGreaterThan(weak.parts.confidence);
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it('at most ten findings are shown, and the order is deterministic', () => {
    const many = Array.from({ length: 14 }, (_, i) => ins(`purchasing.unique_${i}`, { impact: { value: 100 + i, unit: 'money' } }));
    const m1 = composeExecutive({ snapshots: [snap('purchasing', many)], cross, links: [] });
    const m2 = composeExecutive({ snapshots: [snap('purchasing', [...many].reverse())], cross, links: [] });
    expect(m1.insights.length).toBe(MAX_INSIGHTS);
    expect(m1.insights.map((r) => r.insight.id)).toEqual(m2.insights.map((r) => r.insight.id));
  });
});
