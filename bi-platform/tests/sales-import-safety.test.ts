import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { EngineSession } from '@/lib/engineSession';
import { H, importCsv, kpi, runSales, type Cell } from './fixtures/salesCsv';

const D = '2025-06-15';
const HT = ['Data', 'Dokumento Nr.', 'Dokumento tipas', 'Klientas', 'Prekė', 'Kiekis', 'Suma be PVM'];
const lims = (b: { model?: { limitations: { code: string }[] } }) => b.model!.limitations.map((l) => l.code);

describe('A – imports made before the current rules: warned, never changed or deleted', () => {
  it('an import without a rules version raises a limitation with the count; a new import does not; no data is touched', async () => {
    const db = new AppDB('legacy-' + Math.random());
    const s = new EngineSession(db);
    const rows: Cell[][] = Array.from({ length: 10 }, (_, i) => [D, `S${i}`, 'K' + i, 'P', 1, 100, '']);
    const first = await importCsv(s, H, rows, 'old.csv');
    expect(first.commit.status === 'ok' && first.commit.import.rules).toBe(2);
    let b = await s.build({ version: 1, filters: {}, period: { preset: 'r30' } });
    expect(lims(b)).not.toContain('legacy_import');
    // simulate a workspace that was imported before the rules existed
    const imp = (await db.imports.toArray())[0]!;
    await db.imports.update(imp.id, { rules: undefined });
    const before = await db.sales.count();
    b = await s.build({ version: 2, filters: {}, period: { preset: 'r30' } });
    expect(b.model!.limitations.find((l) => l.code === 'legacy_import')).toMatchObject({ n: 1 });
    expect(await db.sales.count()).toBe(before);                         // nothing deleted
    expect(await db.imports.count()).toBe(1);
    expect(kpi(b, 'sales').current).toBe(1000);                          // numbers unchanged: only a warning
    // re-importing (the advised path, after deleting the old import) clears the warning
    await db.imports.delete(imp.id); await db.sales.clear();
    await importCsv(s, H, rows, 'old.csv');
    b = await s.build({ version: 3, filters: {}, period: { preset: 'r30' } });
    expect(lims(b)).not.toContain('legacy_import');
  });
  it('purchasing / other modules never get the sales legacy warning', async () => {
    const db = new AppDB('legacy2-' + Math.random());
    const s = new EngineSession(db);
    await importCsv(s, H, [[D, 'S1', 'K1', 'P', 1, 100, '']], 's.csv');
    await db.imports.toCollection().modify((i) => { i.module = 'purchasing'; delete i.rules; });
    const b = await s.build({ version: 4, filters: {}, period: { preset: 'r30' } });
    expect(lims(b)).not.toContain('legacy_import');
  });
});

describe('B – cost thresholds: legitimate values stay, suspicious ones are ignored visibly, nothing is lost', () => {
  const base = (): Cell[][] => Array.from({ length: 10 }, (_, i) => [D, `N${i}`, 'K' + i, 'P' + i, 1, 100, 60]);
  it('a legitimate zero cost (free goods) is kept in the margin and is not reported as ignored', async () => {
    const rows = base(); rows.push([D, 'Z1', 'KZ', 'PZ', 1, 100, 0]);
    const r = await runSales(H, rows);
    expect(kpi(r.b, 'margin').current).toBeCloseTo((1100 - 600) / 1100, 9);
    expect(lims(r.b)).not.toContain('cost_ignored');
  });
  it('a negative cost and an absurd cost are ignored in the margin, counted on screen, and still present in the stored data', async () => {
    const rows = base(); rows.push([D, 'X1', 'K1', 'P1', 1, 100, 900000], [D, 'X2', 'K2', 'P2', 1, 100, -40]);
    const r = await runSales(H, rows);
    expect(kpi(r.b, 'margin').current).toBeCloseTo(0.4, 9);
    expect(r.b.model!.limitations.find((l) => l.code === 'cost_ignored')).toMatchObject({ n: 2 });
    expect(r.pv.ok && r.pv.stats.warnings.cost_suspect).toBe(2);                                   // import notice
    expect(r.records.find((x) => x.documentId === 'X1')!.cost).toBe(900000);                      // the value is not discarded
    expect(r.records.find((x) => x.documentId === 'X2')!.cost).toBe(-40);
  });
  it('when ignoring unreliable costs leaves too little cost, the margin is withheld with the reason "unreliable cost" (not "no cost")', async () => {
    const rows: Cell[][] = Array.from({ length: 5 }, (_, i) => [D, `N${i}`, 'K' + i, 'P' + i, 1, 100, 60]);
    rows.push([D, 'X1', 'K1', 'P1', 1, 100, 900000], [D, 'X2', 'K2', 'P2', 1, 100, -40]);
    const r = await runSales(H, rows);
    expect(kpi(r.b, 'margin').current).toBeNull();
    expect(kpi(r.b, 'margin').unavailable).toBe('cost_suspect');
  });
  it('a column of zeros is reported as ignored on every line', async () => {
    const r = await runSales(H, Array.from({ length: 6 }, (_, i) => [D, `Z${i}`, 'K' + i, 'P' + i, 1, 100, 0]));
    expect(r.b.model!.limitations.find((l) => l.code === 'cost_ignored')).toMatchObject({ n: 6 });
  });
  it('no cost column at all stays the plain "no cost" case without a misleading warning', async () => {
    const r = await runSales(['Data', 'Dokumento Nr.', 'Klientas', 'Prekė', 'Kiekis', 'Suma be PVM'], [[D, 'A1', 'K', 'P', 1, 100]]);
    expect(kpi(r.b, 'margin').unavailable).toBe('no_cost');
    expect(lims(r.b)).not.toContain('cost_ignored');
  });
});

describe('C – ambiguous credit notes are never silently skipped: count and amount are shown at import, on the dashboard and in the history', () => {
  const rows: Cell[][] = [[D, 'SF1', 'Sąskaita faktūra', 'K1', 'P', 1, 1000], [D, 'KR1', 'Kreditinė sąskaita', 'K1', 'P', -1, -200], [D, 'KR2', 'Kreditinė sąskaita', 'K2', 'P', 1, 150], [D, 'KR3', 'Kreditinė sąskaita', 'K3', 'P', 1, 50]];
  it('the import preview reports the number AND the amount of the rows that were not imported', async () => {
    const r = await runSales(HT, rows);
    expect(r.pv.ok && r.pv.stats.errors.credit_sign_ambiguous).toBe(2);
    expect(r.pv.ok && r.pv.stats.ambiguousCreditAmount).toBe(200);
    expect(r.pv.ok && r.pv.stats.rowsSkipped).toBe(2);
    const item = r.pv.ok ? r.pv.trust.find((t) => t.code === 'credit_ambiguous') : undefined;
    expect(item).toMatchObject({ level: 'warn', params: { n: 2, amount: 200 } });
  });
  it('the dashboard keeps saying so after the import (sales may be overstated by that amount)', async () => {
    const r = await runSales(HT, rows);
    expect(r.b.model!.limitations.find((l) => l.code === 'credit_rows_excluded')).toMatchObject({ n: 2, amount: { money: 200 } });
    expect(kpi(r.b, 'sales').current).toBe(800);              // 1000 − 200; the two ambiguous +150 / +50 are NOT inside
  });
  it('the numbers shown in the three languages carry the count and the amount (no raw placeholders)', async () => {
    const { DICTS } = await import('@/i18n');
    for (const lang of ['lt', 'pl', 'en'] as const) {
      expect(DICTS[lang]['lim.credit_rows_excluded']).toContain('{n}');
      expect(DICTS[lang]['lim.credit_rows_excluded']).toContain('{amount}');
      expect(DICTS[lang]['itrust.credit_ambiguous']).toContain('{amount}');
    }
  });
});

describe('robustness – old or minimal import records never break the dashboard', () => {
  it('an import row without stats.errors / rules (as written by very old versions or hand-seeded) is read without error', async () => {
    const db = new AppDB('min-' + Math.random());
    const s = new EngineSession(db);
    const rows: Cell[][] = Array.from({ length: 10 }, (_, i) => [D, `S${i}`, 'K' + i, 'P', 1, 100, '']);
    await importCsv(s, H, rows, 'x.csv');
    await db.imports.toCollection().modify((i) => { (i as any).stats = { currencies: ['EUR'] }; delete i.rules; });
    const b = await s.build({ version: 7, filters: {}, period: { preset: 'r30' } });
    expect(b.model!.kpis.find((k) => k.id === 'sales')!.current).toBe(1000);
    expect(b.model!.limitations.some((l) => l.code === 'legacy_import')).toBe(true);
  });
});
