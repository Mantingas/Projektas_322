import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { H, addDays, importCsv, kpi, mkSession, runSales, type Cell } from './fixtures/salesCsv';
import { previousIncomplete, resolvePeriods } from '@/engine/analytics/periods';
import { planMerge, type ExistingLine } from '@/engine/import/merge';
import { buildSummaryDoc } from '@/lib/summary';

const END = '2025-06-30';
const flat = (days: number, step = 1): Cell[][] => {
  const rows: Cell[][] = [];
  for (let d = 0; d < days; d += step) rows.push([addDays(END, -(days - 1) + d), `S${d}`, 'K' + (d % 5), 'P' + (d % 4), 1, 100, '']);
  return rows;
};
const ins = (r: Awaited<ReturnType<typeof runSales>>) => r.b.analysis!.insights.map((i) => i.id);

describe('S2 – a change is never reported against a previous window the data does not cover', () => {
  it('40 days of flat sales, last 30 vs the 30 before: no +200 %, comparison withheld, no growth findings, summary says so', async () => {
    const r = await runSales(H, flat(40));
    const s = kpi(r.b, 'sales');
    expect(s.current).toBe(3000);
    expect(s.status).toBe('blocked');                          // was ok with pct = 2 (+200 %)
    expect(s.pct).toBeNull();
    expect(r.b.model!.comparable).toBe(false);
    expect(r.b.model!.previousIncomplete).toBe(true);
    expect(r.b.model!.limitations.find((l) => l.code === 'previous_incomplete')).toMatchObject({ missing: 20 });
    expect(ins(r)).not.toContain('sales.revenue_change');
    expect(ins(r)).not.toContain('sales.product_growth');
    expect(ins(r)).not.toContain('sales.customers_declined');
    const doc = buildSummaryDoc(r.b.model!, r.b.analysis!.insights, 'lt', {}, {});
    expect(doc.executive[0]).not.toMatch(/200/);
    expect(doc.executive[0]).toMatch(/Patikimo palyginimo nėra/);
    expect(r.b.model!.charts.find((c) => c.id === 'waterfall')!.available).toBe(false);
  });
  it('70 days of the same data: the comparison is complete and correctly shows no change', async () => {
    const r = await runSales(H, flat(70));
    const s = kpi(r.b, 'sales');
    expect(s.status).toBe('ok');
    expect(s.pct).toBe(0);
    expect(s.direction).toBe('flat');
    expect(r.b.model!.previousIncomplete).toBe(false);
  });
  it('a business with few sales days is NOT judged by its number of days with sales: every 5th day over 100 days still compares', async () => {
    const r = await runSales(H, flat(100, 5));
    expect(r.b.model!.previousIncomplete).toBe(false);
    expect(kpi(r.b, 'sales').status).toBe('ok');
  });
  it('a couple of empty leading days (within the tolerance) do not block the comparison; the existing warning stays', async () => {
    const rows = flat(60).slice(2);                                // data starts 2 days after the window
    const r = await runSales(H, rows);
    expect(r.b.model!.previousIncomplete).toBe(false);
    expect(r.b.model!.warnings.map((w) => w.code)).toContain('history_starts_late');
    expect(kpi(r.b, 'sales').status).toBe('ok');
  });
  it('calendar presets are protected too: data starting in the middle of the previous month', async () => {
    const rows: Cell[][] = [];
    for (let d = '2025-05-20'; d <= END; d = addDays(d, 1)) rows.push([d, 'M' + d, 'K1', 'P', 1, 100, '']);
    const r = await runSales(H, rows, { preset: 'mom' });
    expect(r.b.model!.previousIncomplete).toBe(true);
    expect(kpi(r.b, 'sales').status).toBe('blocked');
  });
  it('previousIncomplete: pure function', () => {
    const p = resolvePeriods({ preset: 'r30' }, { dateMin: '2025-05-01', dateMax: END });
    expect(previousIncomplete(p, '2025-05-01')).toBeNull();                                  // window starts 2025-05-02: covered
    expect(previousIncomplete(p, '2025-05-05')).toBeNull();                                  // 3 days missing: tolerated
    expect(previousIncomplete(p, '2025-05-06')).toMatchObject({ missingDays: 4 });
    expect(previousIncomplete(p, '2025-07-01')).toBeNull();                                  // no previous data at all is the existing "no_previous_data" case
  });
});

describe('D1 – document numbers that restart every year never replace another year’s documents', () => {
  const y24: Cell[][] = [['2024-12-20', '1', 'K1', 'P', 1, 100, ''], ['2024-12-21', '2', 'K1', 'P', 1, 100, '']];
  const y25: Cell[][] = [['2025-01-05', '1', 'K2', 'P', 1, 250, ''], ['2025-01-06', '2', 'K2', 'P', 1, 250, '']];
  const total = async (s: ReturnType<typeof mkSession>) => {
    const b = await s.build({ version: 9, filters: {}, period: { preset: 'custom', custom: { current: { from: '2024-12-01', to: '2025-01-31' }, previous: { from: '2024-10-01', to: '2024-11-30' } } } });
    return b.model!.kpis.find((k) => k.id === 'sales')!.current;
  };
  it('the next year’s file with the same numbers and "full" mode is added, not substituted (was 500 instead of 700)', async () => {
    const s = mkSession();
    await importCsv(s, H, y24, 'a.csv');
    const b = await importCsv(s, H, y25, 'b.csv', { confirmed: false });
    expect(b.pv.ok && b.pv.preview.needsConfirmation).toEqual([]);
    expect(b.pv.ok && b.pv.preview.revisedDocs).toBe(0);
    expect(b.pv.ok && b.pv.preview.sharedNumberDocs).toBe(2);
    expect(b.pv.ok && b.pv.preview.newDocs).toBe(2);
    expect(b.commit.status).toBe('ok');
    expect(await total(s)).toBe(700);
  });
  it('a corrected 2025 file still replaces only 2025 documents, and needs the usual confirmation', async () => {
    const s = mkSession();
    await importCsv(s, H, y24, 'a.csv');
    await importCsv(s, H, y25, 'b.csv');
    const fixed: Cell[][] = [['2025-01-05', '1', 'K2', 'P', 1, 300, ''], ['2025-01-06', '2', 'K2', 'P', 1, 250, '']];
    const c = await importCsv(s, H, fixed, 'b2.csv', { confirmed: false });
    expect(c.pv.ok && c.pv.preview.revisedDocs).toBe(1);
    expect(c.pv.ok && c.pv.preview.needsConfirmation).toContain('replacements');
    expect(c.commit.status).toBe('needs_confirmation');
    await importCsv(s, H, fixed, 'b3.csv', { confirmed: true });
    expect(await total(s)).toBe(100 + 100 + 300 + 250);          // 2024 untouched
  });
  it('re-importing the same files changes nothing', async () => {
    const s = mkSession();
    await importCsv(s, H, y24, 'a.csv'); await importCsv(s, H, y25, 'b.csv');
    await importCsv(s, H, y24, 'a-again.csv'); await importCsv(s, H, y25, 'b-again.csv');
    expect(await total(s)).toBe(700);
  });
  it('planMerge keeps the old behaviour when yearScoped is off (purchasing, finance, inventory are not changed)', () => {
    const line = (key: string, date: string, amount: number) => ({ key, date, documentId: '1', currency: 'EUR', amount });
    const stored: ExistingLine & { date: string } = { key: 'old', docKey: 'EUR|1', date: '2024-12-20' };
    const incoming = [line('new', '2025-01-05', 250)];
    const by = new Map([['EUR|1', [stored]]]);
    const opts = { mode: 'full' as const, policy: { conflicts: 'replace' as const, content: 'dedupe_exact' as const } };
    expect(planMerge(incoming, new Map([['old', stored]]), by, opts).docs.replaced).toBe(1);
    const scoped = planMerge(incoming, new Map([['old', stored]]), by, { ...opts, yearScoped: true });
    expect(scoped.docs.replaced).toBe(0);
    expect(scoped.docs.added).toBe(1);
    expect(scoped.docs.sharedNumber).toBe(1);
    expect(scoped.supersede).toEqual([]);
  });
});
