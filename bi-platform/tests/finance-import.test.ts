import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { exportBackup, listConflicts, loadAllFinance, pendingHeldCount, resolveConflicts, restoreBackup, wipeAll } from '@/db/store';
import { EngineSession, type AnalysisLite } from '@/lib/engineSession';
import { buildFinanceFixtures, type FFixture } from './fixtures/financeFormats';
import { END, refOutstanding, refOverdue } from './fixtures/finance';
import type { ExportMode } from '@/engine/types';

let fx: FFixture[] = [];
beforeAll(async () => { fx = await buildFinanceFixtures(); });
const get = (id: string) => fx.find((f) => f.id === id)!;
const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const mk = () => new EngineSession(new AppDB('fin-' + Math.random().toString(36).slice(2)));
const text = (f: FFixture) => new TextDecoder().decode(f.bytes);
const withText = (f: FFixture, t: string, name = 'x.csv'): FFixture => ({ ...f, fileName: name, bytes: new TextEncoder().encode(t) });

async function load(s: EngineSession, f: FFixture) {
  await s.parse(buf(f.bytes), f.fileName);
  const a = (await s.analyze(0, ',', 'finance')) as AnalysisLite;
  return { a, entries: a.proposal.entries };
}
const run = async (s: EngineSession, f: FFixture, mode: ExportMode = 'full', extra: Record<string, unknown> = {}) => {
  const { entries } = await load(s, f);
  return s.commit({ sheetIdx: 0, module: 'finance', side: f.side, entries, currency: f.currency, asOfDate: f.asOfDate, mode, confirmed: false, allowSameChecksum: false, remember: false, ...extra });
};
/** change the outstanding column (index 8) of one line of the open-item history file */
const setOutstanding = (f: FFixture, snapshot: string, no: string, value: number) => text(f).split('\r\n').map((l) => { const c = l.split(';'); if (c[0] !== snapshot || c[3] !== no) return l; c[8] = value.toFixed(2).replace('.', ','); return c.join(';'); }).join('\r\n');
const BUILD = { version: 1, side: 'receivable' as const, filters: {}, period: { preset: 'r30' as const } };

describe('finance through the engine session (the code that runs in the Web Worker)', () => {
  it('parse → analyze(finance) → preview states dataset kind, grain and side and what the file supports → commit → buildFinance', async () => {
    const s = mk();
    const f = get('ar-open-items-history');
    const { a, entries } = await load(s, f);
    expect(a.module).toBe('finance');
    expect(a.detected).toMatchObject({ module: 'finance', side: 'receivable' });
    expect(a.signature.startsWith('finance:')).toBe(true);
    const pv = await s.preview({ sheetIdx: 0, module: 'finance', side: 'receivable', entries, currency: 'EUR', mode: 'full' });
    if (!pv.ok) throw new Error('preview failed');
    expect(pv.financeKind).toBe('open_items');
    expect(pv.financeGrain).toBe('invoice_at_date');
    expect(pv.financeSide).toBe('receivable');
    expect(pv.snapshotDates).toHaveLength(4);
    expect(pv.preview.added).toBe(f.rows);
    const m = (id: string) => pv.diagnostics.metrics.find((x) => x.id === id)!;
    expect(m('f_outstanding')).toMatchObject({ available: true });
    expect(m('f_overdue')).toMatchObject({ available: true });
    expect(m('f_delay')).toMatchObject({ available: false, reason: 'no_payment_register' });
    expect(m('f_dso')).toMatchObject({ available: false, reason: 'no_invoice_register' });
    expect(m('f_dup')).toMatchObject({ available: false, reason: 'no_payment_register' });
    expect((await s.commit({ sheetIdx: 0, module: 'finance', side: 'receivable', entries, currency: 'EUR', mode: 'full', confirmed: false, allowSameChecksum: false, remember: true })).status).toBe('ok');

    for (const id of ['ar-payments', 'ar-credit-notes']) expect((await run(s, get(id))).status).toBe('ok');
    // the invoice register repeats the credit notes WITHOUT their references: the versions that differ from the stored ones are held, not added
    const reg = await run(s, get('ar-invoices'), 'unknown');
    if (reg.status !== 'ok') throw new Error('x');
    expect(reg.import.heldLines).toBe(2); // KR-3 has no reference in either file: identical, so a duplicate
    const b = await s.buildFinance(BUILD);
    expect(b.empty).toBe(false);
    for (const k of ['records', 'cur', 'prev', 'universe', 'pays', 'creditRows', 'dupAll']) expect(b.model, k).not.toHaveProperty(k);
    expect(() => structuredClone(b)).not.toThrow();
    const k = (id: string) => b.model!.kpis.find((x) => x.id === id)!;
    expect(k('f_outstanding').current).toBeCloseTo(refOutstanding(f.truth, END), 2);
    expect(k('f_overdue').current).toBeCloseTo(refOverdue(f.truth, END), 2);
    expect(k('f_delay').current).not.toBeNull();
    expect(k('f_dso').current).not.toBeNull();
    expect(b.analysis!.insights.length).toBeGreaterThan(6);
    expect(b.options.customer!.length).toBe(10);
    expect(b.sides).toEqual(['receivable']);
    expect(b.imports.map((i) => i.kind).sort()).toEqual(['credit_notes', 'invoices', 'open_items', 'payments']);
  });

  it('receivables and payables live side by side in one currency; sales, purchasing and inventory tables stay untouched', async () => {
    const db = new AppDB('fin2-' + Math.random());
    const s = new EngineSession(db);
    await run(s, get('ar-open-items-history'));
    await run(s, get('ap-open-items'));
    expect(await db.sales.count() + await db.purchases.count() + await db.inventory.count()).toBe(0);
    expect(await db.finance.count()).toBe(get('ar-open-items-history').rows + get('ap-open-items').rows);
    const r = await s.buildFinance({ ...BUILD, version: 2 });
    const p = await s.buildFinance({ ...BUILD, version: 2, side: 'payable' });
    expect(r.sides).toEqual(['receivable', 'payable']);
    expect(r.model!.kpis.find((x) => x.id === 'f_outstanding')!.current).toBeCloseTo(refOutstanding(get('ar-open-items-history').truth, END), 2);
    expect(p.model!.kpis.find((x) => x.id === 'f_outstanding')!.current).toBeCloseTo(refOutstanding(get('ap-open-items').truth, END), 2);
    expect(p.model!.side).toBe('payable');
    expect(r.model!.overview.net).toBeCloseTo(refOutstanding(get('ar-open-items-history').truth, END) - refOutstanding(get('ap-open-items').truth, END), 2);
    // an aging report in another currency is its own series
    await run(s, get('pl-aging-ap'));
    const b = await s.buildFinance({ ...BUILD, version: 3, side: 'payable' });
    expect(b.allSeries.map((x) => x.currency).sort()).toEqual(['EUR', 'PLN']);
    const pln = await s.buildFinance({ ...BUILD, version: 3, side: 'payable', seriesKey: 'PLN|net' });
    expect(pln.model!.asOf.source).toBe('aging');
  });
});

describe('import safety: snapshots are documents, flows are never double counted', () => {
  it('the same FILE twice is refused; an identical re-export under another name adds nothing', async () => {
    const s = mk();
    const f = get('ar-open-items-history');
    expect((await run(s, f)).status).toBe('ok');
    expect((await run(s, f)).status).toBe('duplicate_file');
    const copy = withText(f, text(f) + '\r\n', 'kopija.csv');
    const { entries } = await load(s, copy);
    const pv = await s.preview({ sheetIdx: 0, module: 'finance', side: 'receivable', entries, currency: 'EUR', mode: 'full' });
    if (!pv.ok) throw new Error('x');
    expect(pv.preview.added).toBe(0);
    expect(pv.preview.duplicates).toBe(f.rows);
  });

  it('a CONFLICTING open-item snapshot (same side and date, one changed balance) is held, reviewed as finance, and changes nothing until decided', async () => {
    const db = new AppDB('fin-c-' + Math.random());
    const s = new EngineSession(db);
    const f = get('ar-open-items-history');
    await run(s, f);
    const before = await s.buildFinance(BUILD);
    const v0 = before.model!.kpis.find((x) => x.id === 'f_outstanding')!.current!;
    const target = f.truth.open.find((o) => o.snapshot === END && o.outstanding > 1000)!;
    const changed = setOutstanding(f, END, target.no, target.outstanding - 100);
    expect(changed).not.toBe(text(f));
    const res = await run(s, withText(f, changed, 'pataisyta.csv'), 'unknown');
    if (res.status !== 'ok') throw new Error('x');
    expect(res.import.heldLines).toBeGreaterThan(0);
    expect(await pendingHeldCount(db, 'finance')).toBe(res.import.heldLines);
    expect(await pendingHeldCount(db, 'sales')).toBe(0);
    const mid = await s.buildFinance({ ...BUILD, version: 2 });
    expect(mid.model!.kpis.find((x) => x.id === 'f_outstanding')!.current).toBeCloseTo(v0, 6);
    expect(mid.model!.limitations.map((l) => l.code)).toContain('held_pending');
    const groups = await listConflicts(db);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ module: 'finance' });
    expect(groups[0]!.stored.length).toBeGreaterThan(0);
    expect(groups[0]!.held[0]!.amount).toBeCloseTo(target.outstanding - 100, 2); // the review shows the outstanding balance of the line
    await resolveConflicts(db, groups.map((g) => ({ importId: g.importId, docKey: g.docKey, module: g.module })), 'use_new');
    const after = await s.buildFinance({ ...BUILD, version: 3 });
    expect(after.model!.kpis.find((x) => x.id === 'f_outstanding')!.current).toBeCloseTo(v0 - 100, 6);
    expect(await pendingHeldCount(db)).toBe(0);
  });

  it('a corrected invoice (same number, new amount) is held – it never replaces or doubles the original', async () => {
    const db = new AppDB('fin-i-' + Math.random());
    const s = new EngineSession(db);
    const f = get('ar-invoices');
    await run(s, f);
    const inv = f.truth.invoices[5]!;
    const corrected = text(f).split('\r\n').map((l) => (l.includes(`;${inv.no};`) ? l.replace(inv.amount.toFixed(2).replace('.', ','), (inv.amount + 100).toFixed(2).replace('.', ',')) : l)).join('\r\n');
    const res = await run(s, withText(f, corrected, 'pataisytos.csv'), 'incremental');
    if (res.status !== 'ok') throw new Error('x');
    expect(res.import.heldLines).toBe(1);
    expect(await db.finance.filter((r) => r.documentId === inv.no && !r.heldBy).count()).toBe(1);
    const b = await s.buildFinance({ ...BUILD, version: 5, period: { preset: 'custom', custom: { current: { from: inv.date, to: inv.date }, previous: { from: '2025-01-01', to: '2025-01-02' } } } as never });
    void b;
    const groups = await listConflicts(db);
    expect(groups[0]!.held[0]!.amount).toBeCloseTo(inv.amount + 100, 2);
  });

  it('payment registers: a re-sent file adds nothing; the identical repeated line INSIDE one file is kept (and flagged), not silently dropped', async () => {
    const db = new AppDB('fin-p-' + Math.random());
    const s = new EngineSession(db);
    const f = get('ar-payments');
    await run(s, f);
    expect(await db.finance.count()).toBe(f.rows); // the repeated line is among them
    const again = withText(f, text(f) + '\r\n', 'dar_karta.csv');
    const { entries } = await load(s, again);
    const pv = await s.preview({ sheetIdx: 0, module: 'finance', side: 'receivable', entries, currency: 'EUR', mode: 'full' });
    if (!pv.ok) throw new Error('x');
    expect(pv.preview.added).toBe(0);
    const b = await s.buildFinance({ ...BUILD, version: 9 });
    expect(b.model!.duplicates.filter((d) => d.tier === 'exact_repeat')).toHaveLength(1);
  });

  it('an unconfirmed full-snapshot replacement is refused; nothing is deleted', async () => {
    const db = new AppDB('fin-r-' + Math.random());
    const s = new EngineSession(db);
    const f = get('ar-open-items-history');
    await run(s, f);
    const target = f.truth.open.find((o) => o.snapshot === END && o.outstanding > 1000)!;
    const changed = setOutstanding(f, END, target.no, 1);
    const r = await run(s, withText(f, changed, 'c.csv'), 'full');
    expect(r.status).toBe('needs_confirmation');
    expect(await db.finance.count()).toBe(f.rows);
  });
});

describe('drill-down and persistence', () => {
  it('drill through the session: position lines add up to the KPI; the CSV carries type, due date, days overdue and outstanding', async () => {
    const s = mk();
    await run(s, get('ar-open-items-history'));
    const b = await s.buildFinance({ ...BUILD, version: 7 });
    const k = (id: string) => b.model!.kpis.find((x) => x.id === id)!.current!;
    const spec = (bucket?: 'overdue') => ({ filter: {}, fin: { side: 'receivable' as const, mode: 'position' as const, asOf: END, bucket } });
    const all = await s.drill({ module: 'finance', version: 7, seriesKey: 'EUR|net', spec: spec(), page: 0, pageSize: 25 });
    expect(all.total).toBeCloseTo(k('f_outstanding'), 6);
    const od = await s.drill({ module: 'finance', version: 7, seriesKey: 'EUR|net', spec: spec('overdue'), page: 0, pageSize: 500 });
    expect(od.total).toBeCloseTo(k('f_overdue'), 6);
    expect(od.lines).toBe(k('f_overdue_count'));
    expect(od.rows[0]).toMatchObject({ type: 'open_item' });
    expect(od.rows.every((r) => (r.days ?? 0) >= 1 && r.due && r.outstanding === r.amount)).toBe(true);
    const csv = await s.drillCsv({ module: 'finance', version: 7, seriesKey: 'EUR|net', spec: spec('overdue'), headers: ['d', 'doc', 'cp', 't', 'ref', 'due', 'days', 'out', 'amt', 'src', 'row'], fileNames: {}, unknownFile: '?' });
    expect(csv.split('\r\n')[1]).toMatch(/open_item/);
  });

  it('backup and restore include finance; "delete everything" removes it; the schema upgrade from v5 adds an empty finance table', async () => {
    const db = new AppDB('fin-b-' + Math.random());
    const s = new EngineSession(db);
    await run(s, get('ar-open-items-history'));
    const backup = await exportBackup(db);
    expect(backup.finance).toHaveLength(get('ar-open-items-history').rows);
    await wipeAll(db);
    expect(await db.finance.count()).toBe(0);
    await restoreBackup(db, backup);
    expect(await loadAllFinance(db)).toHaveLength(backup.finance!.length);
    const name = 'up6-' + Math.random();
    const { default: Dexie } = await import('dexie');
    const old = new Dexie(name);
    old.version(5).stores({ imports: 'id, checksum, importedAt', sales: 'key, importId, date, docKey, heldBy', purchases: 'key, importId, date, docKey, heldBy', inventory: 'key, importId, date, docKey, heldBy', mappings: 'signature', settings: 'key', audit: '++id, at, importId' });
    await old.table('inventory').put({ key: 'i1', importId: 'i', date: '2025-03-05', kind: 'snapshot', basis: 'net', currency: 'EUR', sourceRow: 1 });
    old.close();
    const upgraded = new AppDB(name);
    expect(await upgraded.inventory.count()).toBe(1);
    expect(await upgraded.finance.count()).toBe(0);
  });

  it('saved mappings are kept per module', async () => {
    const s = mk();
    await run(s, get('ar-open-items-history'), 'full', { remember: true });
    await s.parse(buf(get('ar-open-items-history').bytes), 'again.csv');
    expect((await s.analyze(0, ',', 'finance'))!.usedSaved).toBe(true);
    expect((await s.analyze(0, ',', 'sales'))!.usedSaved).toBe(false);
  });
});
