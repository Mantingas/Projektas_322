import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { PH, H, addDays, importAny, mkSession, runSales, type Cell } from './fixtures/salesCsv';
import { previousCoverage, resolvePeriods } from '@/engine/analytics/periods';
import { cleanCoverage } from '@/lib/engineSession';

const END = '2025-06-30';
const salesFlat = (days: number): Cell[][] => Array.from({ length: days }, (_, d) => [addDays(END, -(days - 1) + d), `S${d}`, 'K' + (d % 5), 'P' + (d % 4), 1, 100, '']);
const buyFlat = (days: number): Cell[][] => Array.from({ length: days }, (_, d) => [addDays(END, -(days - 1) + d), `T${d}`, 'S1', 'P1', 1, 'kg', 100]);
const codes = (b: { model?: { warnings: { code: string }[] } }) => b.model!.warnings.map((w) => w.code);
const lim = (b: { model?: { limitations: { code: string }[] } }) => b.model!.limitations.map((l) => l.code);

describe('previousCoverage – four honest answers instead of a guess from days with transactions', () => {
  const p = resolvePeriods({ preset: 'r30' }, { dateMin: '2025-04-01', dateMax: END });
  const prev = p.previous;                                   // 2025-05-02 … 2025-05-31
  it('covered: there is a transaction at or before the start of the window', () => expect(previousCoverage(prev, 30, '2025-05-02').state).toBe('covered'));
  it('tolerated: a quiet beginning of up to max(3 days, 10 %)', () => expect(previousCoverage(prev, 30, '2025-05-05').state).toBe('tolerated'));
  it('unknown: a later first transaction and no declared export period', () => expect(previousCoverage(prev, 30, '2025-05-20')).toMatchObject({ state: 'unknown', dataFrom: '2025-05-20' }));
  it('declared: the user states the export starts before the window → covered even though the first transaction is later (a real quiet period)', () => expect(previousCoverage(prev, 30, '2025-05-20', '2025-04-01').state).toBe('covered'));
  it('declared_incomplete: the user states the export starts INSIDE the window → proven partial', () => expect(previousCoverage(prev, 30, '2025-05-20', '2025-05-15')).toMatchObject({ state: 'declared_incomplete', declaredFrom: '2025-05-15' }));
  it('a declared start LATER than the first transaction contradicts the file and is ignored (stays unknown)', () => expect(previousCoverage(prev, 30, '2025-05-20', '2025-05-25').state).toBe('unknown'));
  it('none: no previous data at all', () => expect(previousCoverage(prev, 30, '2025-07-01').state).toBe('none'));
  it('cleanCoverage keeps valid ISO dates in order and drops contradictions', () => {
    expect(cleanCoverage({ from: '2025-01-01', to: '2025-06-30' })).toEqual({ from: '2025-01-01', to: '2025-06-30' });
    expect(cleanCoverage({ from: '2025-06-30', to: '2025-01-01' })).toBeUndefined();
    expect(cleanCoverage({ from: 'yesterday' })).toBeUndefined();
    expect(cleanCoverage({ to: '2025-06-30' })).toEqual({ to: '2025-06-30' });
  });
});

describe('sales – unknown vs declared coverage', () => {
  it('undeclared: unknown (not "incomplete"), change withheld, no growth finding', async () => {
    const r = await runSales(H, salesFlat(40));
    expect(codes(r.b)).toContain('previous_unverified');
    expect(lim(r.b)).toContain('previous_unknown');
    expect(r.b.model!.kpis.find((k) => k.id === 'sales')!.status).toBe('blocked');
    expect(r.b.analysis!.insights.map((i) => i.id)).not.toContain('sales.revenue_change');
  });
  it('declared start before the window: a genuinely quiet beginning – the comparison is allowed and the data is trusted as declared', async () => {
    const s = mkSession();
    await importAny(s, 'sales', H, salesFlat(40), 'a.csv', { coverage: { from: addDays(END, -80), to: END } });
    const b = await s.build({ version: 1, filters: {}, period: { preset: 'r30' } });
    expect(codes(b)).not.toContain('previous_unverified');
    const k = b.model!.kpis.find((x) => x.id === 'sales')!;
    expect(k.status).toBe('ok');
    expect(k.previous).toBe(1000);                          // the previous window really had only 10 days of sales
  });
  it('declared start inside the previous window: proven partial, labelled as declared', async () => {
    const s = mkSession();
    await importAny(s, 'sales', H, salesFlat(40), 'a.csv', { coverage: { from: addDays(END, -39) } });
    const b = await s.build({ version: 1, filters: {}, period: { preset: 'r30' } });
    expect(codes(b)).toContain('previous_declared_incomplete');
    expect(lim(b)).toContain('previous_incomplete');
    expect(lim(b)).not.toContain('previous_unknown');
    expect(b.model!.kpis.find((x) => x.id === 'sales')!.status).toBe('blocked');
  });
  it('a declared end after the last transaction is a quiet end, not missing data: the current window ends at the declared end', async () => {
    const s = mkSession();
    await importAny(s, 'sales', H, salesFlat(70).slice(0, 65), 'a.csv', { coverage: { to: END } });      // last sale 5 days before END
    const b = await s.build({ version: 1, filters: {}, period: { preset: 'r30' } });
    expect(b.model!.periods.current.to).toBe(END);
    const s2 = mkSession();
    await importAny(s2, 'sales', H, salesFlat(70).slice(0, 65), 'a.csv');
    expect((await s2.build({ version: 1, filters: {}, period: { preset: 'r30' } })).model!.periods.current.to).toBe(addDays(END, -5));
  });
  it('the declared period is stored on the import and the import carries the rules version', async () => {
    const s = mkSession();
    const imp = await importAny(s, 'sales', H, salesFlat(10), 'a.csv', { coverage: { from: '2025-01-01', to: END } });
    expect(imp.commit.import.coverage).toEqual({ from: '2025-01-01', to: END });
    expect(imp.commit.import.rules).toBe(2);
  });
});

describe('purchasing – S2 (was +200 % from 10 days of history)', () => {
  const spend = (b: any) => b.model.kpis.find((k: any) => k.id === 'p_spend');
  it('40 days of flat spend, undeclared: unknown coverage → change withheld, no spend finding (was +200 %)', async () => {
    const s = mkSession(); await importAny(s, 'purchasing', PH, buyFlat(40), 'p.csv');
    const b: any = await s.buildPurchasing({ version: 1, filters: {}, period: { preset: 'r30' } });
    expect(spend(b).current).toBe(3000);
    expect(spend(b).status).toBe('blocked');
    expect(spend(b).pct).toBeNull();
    expect(codes(b)).toContain('previous_unverified');
    expect(b.model.comparable).toBe(false);
    expect(b.analysis.insights.map((i: any) => i.id)).not.toContain('purchasing.spend_change');
    expect(b.analysis.insights.map((i: any) => i.id)).not.toContain('purchasing.supplier_cost_increase');
  });
  it('70 days of the same spend: a complete comparison with no change', async () => {
    const s = mkSession(); await importAny(s, 'purchasing', PH, buyFlat(70), 'p.csv');
    const b: any = await s.buildPurchasing({ version: 1, filters: {}, period: { preset: 'r30' } });
    expect(spend(b).status).toBe('ok'); expect(spend(b).pct).toBe(0);
  });
  it('sparse but fully covered history (every 5th day over 100 days) is not mistaken for missing data', async () => {
    const s = mkSession(); await importAny(s, 'purchasing', PH, buyFlat(100).filter((_, i) => i % 5 === 0), 'p.csv');
    const b: any = await s.buildPurchasing({ version: 1, filters: {}, period: { preset: 'r30' } });
    expect(codes(b)).not.toContain('previous_unverified');
  });
  it('declared export period: quiet start accepted; declared partial start blocked', async () => {
    const s = mkSession(); await importAny(s, 'purchasing', PH, buyFlat(40), 'p.csv', { coverage: { from: addDays(END, -90) } });
    const ok: any = await s.buildPurchasing({ version: 1, filters: {}, period: { preset: 'r30' } });
    expect(spend(ok).status).toBe('ok');
    const s2 = mkSession(); await importAny(s2, 'purchasing', PH, buyFlat(40), 'p.csv', { coverage: { from: addDays(END, -39) } });
    const bad: any = await s2.buildPurchasing({ version: 1, filters: {}, period: { preset: 'r30' } });
    expect(codes(bad)).toContain('previous_declared_incomplete');
    expect(spend(bad).status).toBe('blocked');
  });
});

describe('executive summary follows the modules: no unfounded growth', () => {
  it('purchasing and sales with 40 days of history: no module reports a comparison-based change', async () => {
    const s = mkSession();
    await importAny(s, 'purchasing', PH, buyFlat(40), 'p.csv');
    await importAny(s, 'sales', H, salesFlat(40), 's.csv');
    const ex: any = await s.buildExecutive({ version: 1 });
    const kpis = ex.model.kpis as { metric: { id: string; pct: number | null; status: string; current: number | null } }[];
    for (const id of ['p_spend', 'sales']) {
      const k = kpis.find((x) => x.metric.id === id);
      expect(k, `${id} present in the executive model`).toBeTruthy();
      expect(k!.metric.status, id).toBe('blocked'); expect(k!.metric.pct, id).toBeNull();
    }
    expect(JSON.stringify(ex.model)).not.toMatch(/"pct":2[,}]/);                  // the former +200 %
  });
});
