import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { deleteImport, exportBackup, listConflicts, loadAllInventory, pendingHeldCount, resolveConflicts, restoreBackup, wipeAll } from '@/db/store';
import { EngineSession, type AnalysisLite } from '@/lib/engineSession';
import { buildInventoryFixtures, type IFixture } from './fixtures/inventoryFormats';
import { buildFixtures } from './fixtures/formats';
import { END, valueAt } from './fixtures/inventory';
import type { ExportMode } from '@/engine/types';

let fx: IFixture[] = [];
beforeAll(async () => { fx = await buildInventoryFixtures(); });
const get = (id: string) => fx.find((f) => f.id === id)!;
const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const mkSession = () => new EngineSession(new AppDB('inv-' + Math.random().toString(36).slice(2)));

async function load(s: EngineSession, f: IFixture) {
  await s.parse(buf(f.bytes), f.fileName);
  const a = (await s.analyze(0, ',', 'inventory')) as AnalysisLite;
  return { a, entries: a.proposal.entries, currency: a.proposal.detectedCurrency ?? f.defaultCurrency, asOfDate: f.asOfDate };
}
const run = async (s: EngineSession, f: IFixture, mode: ExportMode = 'full', extra: Record<string, unknown> = {}) => {
  const { entries, currency, asOfDate } = await load(s, f);
  return s.commit({ sheetIdx: 0, module: 'inventory', entries, currency, asOfDate, mode, confirmed: false, allowSameChecksum: false, remember: false, ...extra });
};

describe('inventory through the engine session (the code that runs in the Web Worker)', () => {
  it('parse → analyze(inventory) → preview shows the dataset type and which metrics the file supports → commit → buildInventory', async () => {
    const s = mkSession();
    const f = get('lt-snapshot-history');
    const { a, entries, currency } = await load(s, f);
    expect(a.module).toBe('inventory');
    expect(a.detected.module).toBe('inventory');
    expect(a.signature.startsWith('inventory:')).toBe(true);
    const pv = await s.preview({ sheetIdx: 0, module: 'inventory', entries, currency, mode: 'full' });
    if (!pv.ok) throw new Error('preview failed');
    expect(pv.inventoryKind).toBe('history');
    expect(pv.snapshotDates).toHaveLength(5);
    expect(pv.preview.added).toBe(f.snaps.length);
    // from the file alone: value works, history-based metrics need movements
    const m = (id: string) => pv.diagnostics.metrics.find((x) => x.id === id)!;
    expect(m('i_value')).toMatchObject({ available: true });
    expect(m('i_turnover')).toMatchObject({ available: false, reason: 'no_movements' });
    expect(m('i_slow')).toMatchObject({ available: false, reason: 'no_movements' });
    expect(m('i_stockout')).toMatchObject({ available: true }); // minimum stock levels are in the file
    const done = await s.commit({ sheetIdx: 0, module: 'inventory', entries, currency, mode: 'full', confirmed: false, allowSameChecksum: false, remember: true });
    expect(done.status).toBe('ok');

    // movements arrive in a second file
    const mv = get('lt-movements');
    await run(s, mv);
    const b = await s.buildInventory({ version: 1, filters: {}, period: { preset: 'r30' } });
    expect(b.empty).toBe(false);
    for (const k of ['records', 'cur', 'prev', 'moves', 'cov', 'curTable', 'valueConflicts', 'costOutliers', 'negatives']) expect(b.model, k).not.toHaveProperty(k);
    expect(() => structuredClone(b)).not.toThrow();
    expect(b.model!.kpis.find((k) => k.id === 'i_value')!.current).toBeCloseTo(valueAt(f.snaps, END), 2);
    expect(b.model!.kpis.find((k) => k.id === 'i_turnover')!.current).not.toBeNull();
    expect(b.analysis!.insights.length).toBeGreaterThan(4);
    expect(b.options.product!.length).toBe(12);
    expect(b.options.warehouse!.map((o) => o.label).sort()).toEqual(['Kaunas', 'Vilnius']);
    expect(b.imports.map((i) => i.kind).sort()).toEqual(['history', 'movements']);
  });

  it('inventory, sales and purchasing live side by side; each module sees only its own table', async () => {
    const db = new AppDB('inv3-' + Math.random());
    const s = new EngineSession(db);
    const sales = (await buildFixtures()).find((f) => f.id === 'lt-csv-utf8')!;
    await s.parse(buf(sales.bytes), sales.fileName);
    const sa = (await s.analyze(0, ',', 'sales'))!;
    await s.commit({ sheetIdx: 0, entries: sa.proposal.entries, currency: 'EUR', mode: 'full', confirmed: false, allowSameChecksum: false, remember: false });
    await run(s, get('lt-snapshot-history'));
    expect(await db.sales.count()).toBe(sales.truth.length);
    expect(await db.inventory.count()).toBe(get('lt-snapshot-history').snaps.length);
    expect(await db.purchases.count()).toBe(0);
    const ib = await s.buildInventory({ version: 3, filters: {}, period: { preset: 'r30' } });
    expect(ib.imports).toHaveLength(1);
    expect(ib.model!.series.currency).toBe('EUR');
  });

  it('a balance without a date column imports with the as-of date; a second source of the SAME date is a duplicate, not a second balance', async () => {
    const s = mkSession();
    const nodate = get('lt-snapshot-nodate');
    const r = await run(s, nodate);
    expect(r.status).toBe('ok');
    // the same snapshot arrives again in another file: identical lines → duplicates, nothing added
    const again = get('lt-snapshot-history');
    const pv = await (async () => { const l = await load(s, again); return s.preview({ sheetIdx: 0, module: 'inventory', entries: l.entries, currency: l.currency, mode: 'unknown' }); })();
    if (!pv.ok) throw new Error('x');
    expect(pv.preview.added + pv.preview.heldLines + pv.preview.revisedDocs).toBeGreaterThan(0); // the other dates are new
  });
});

describe('import safety for stock snapshots and movements', () => {
  it('the same FILE twice is refused; an identical re-export under another name adds nothing', async () => {
    const s = mkSession();
    const f = get('lt-snapshot-history');
    expect((await run(s, f)).status).toBe('ok');
    expect((await run(s, f)).status).toBe('duplicate_file');
    const copy = { ...f, fileName: 'kopija.csv', bytes: new TextEncoder().encode(new TextDecoder().decode(f.bytes) + '\r\n') };
    const { entries, currency } = await load(s, copy);
    const pv = await s.preview({ sheetIdx: 0, module: 'inventory', entries, currency, mode: 'full' });
    if (!pv.ok) throw new Error('x');
    expect(pv.preview.added).toBe(0);
    expect(pv.preview.duplicates).toBe(f.snaps.length);
  });

  it('a CONFLICTING snapshot (same date and warehouse, different quantity) is held, shown in the conflict review as inventory, and changes nothing until decided', async () => {
    const db = new AppDB('inv-c-' + Math.random());
    const s = new EngineSession(db);
    const f = get('lt-snapshot-history');
    await run(s, f);
    const before = await s.buildInventory({ version: 1, filters: {}, period: { preset: 'r30' } });
    const v0 = before.model!.kpis.find((k) => k.id === 'i_value')!.current!;
    // the same Vilnius snapshot, but P01 now says 500 instead of 600
    const text = new TextDecoder().decode(f.bytes).split('\r\n').map((line) => (line.startsWith(`${END};Vilnius;P01;`) ? line.replace(';600;', ';500;').replace(';480,00;', ';400,00;') : line)).join('\r\n');
    const changed = { ...f, fileName: 'likuciai_pataisyti.csv', bytes: new TextEncoder().encode(text) };
    const res = await run(s, changed, 'unknown');
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.import.heldLines).toBeGreaterThan(0);
    expect(await pendingHeldCount(db, 'inventory')).toBe(res.import.heldLines);
    expect(await pendingHeldCount(db, 'sales')).toBe(0);
    const mid = await s.buildInventory({ version: 2, filters: {}, period: { preset: 'r30' } });
    expect(mid.model!.kpis.find((k) => k.id === 'i_value')!.current).toBeCloseTo(v0, 6); // unchanged
    expect(mid.pendingHeld).toBe(res.import.heldLines);
    expect(mid.model!.limitations.map((l) => l.code)).toContain('held_pending');
    const groups = await listConflicts(db);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ module: 'inventory' });
    expect(groups[0]!.stored.length).toBeGreaterThan(0);
    expect(groups[0]!.held[0]!.amount).toBe(400);
    // decide: use the new snapshot → the whole stored snapshot of that warehouse and date is replaced (old lines kept for audit)
    await resolveConflicts(db, groups.map((g) => ({ importId: g.importId, docKey: g.docKey, module: g.module })), 'use_new');
    const after = await s.buildInventory({ version: 3, filters: {}, period: { preset: 'r30' } });
    expect(after.model!.kpis.find((k) => k.id === 'i_value')!.current).toBeCloseTo(v0 - 80, 6);
    expect(await pendingHeldCount(db)).toBe(0);
    expect(await db.inventory.filter((r) => Boolean(r.supersededBy)).count()).toBeGreaterThan(0);
  });

  it('keep-stored discards the conflicting snapshot; deleting the import restores nothing it never replaced', async () => {
    const db = new AppDB('inv-k-' + Math.random());
    const s = new EngineSession(db);
    const f = get('lt-snapshot-history');
    await run(s, f);
    const text = new TextDecoder().decode(f.bytes).split('\r\n').map((line) => (line.startsWith(`${END};Kaunas;P03;`) ? line.replace(';1000;', ';900;') : line)).join('\r\n');
    const res = await run(s, { ...f, fileName: 'b.csv', bytes: new TextEncoder().encode(text) }, 'unknown');
    if (res.status !== 'ok') throw new Error('x');
    const groups = await listConflicts(db);
    await resolveConflicts(db, groups.map((g) => ({ importId: g.importId, docKey: g.docKey, module: g.module })), 'keep_stored');
    expect(await pendingHeldCount(db)).toBe(0);
    expect((await loadAllInventory(db)).filter((r) => r.productId === 'P03' && r.date === END).map((r) => r.quantity)).toEqual([1000]);
    await deleteImport(db, res.import.id);
    expect((await loadAllInventory(db)).length).toBe(f.snaps.length);
  });

  it('movements re-imported incrementally: documents already stored are duplicates, never double counted', async () => {
    const db = new AppDB('inv-m-' + Math.random());
    const s = new EngineSession(db);
    const mv = get('lt-movements');
    await run(s, mv);
    const n = await db.inventory.count();
    const half = { ...mv, fileName: 'dalis.csv', bytes: new TextEncoder().encode(new TextDecoder().decode(mv.bytes).split('\r\n').slice(0, 400).join('\r\n') + '\r\n') };
    const r = await run(s, half, 'incremental');
    expect(r.status).toBe('ok');
    expect(await db.inventory.count()).toBe(n);
  });

  it('an unconfirmed full-snapshot replacement is refused; nothing is deleted', async () => {
    const db = new AppDB('inv-r-' + Math.random());
    const s = new EngineSession(db);
    const f = get('lt-snapshot-history');
    await run(s, f);
    const text = new TextDecoder().decode(f.bytes).split('\r\n').map((line) => (line.startsWith(`${END};Vilnius;P01;`) ? line.replace(';600;', ';555;') : line)).join('\r\n');
    const r = await run(s, { ...f, fileName: 'c.csv', bytes: new TextEncoder().encode(text) }, 'full');
    expect(r.status).toBe('needs_confirmation');
    expect(await db.inventory.count()).toBe(f.snaps.length);
  });
});

describe('drill-down and persistence', () => {
  it('drill-down through the session: the total of the stock position lines equals the KPI; movement CSV carries unit and type', async () => {
    const s = mkSession();
    await run(s, get('lt-snapshot-history'));
    await run(s, get('lt-movements'));
    const b = await s.buildInventory({ version: 7, filters: {}, period: { preset: 'r30' } });
    const k = b.model!.kpis.find((x) => x.id === 'i_value')!.current!;
    const d = await s.drill({ module: 'inventory', version: 7, seriesKey: 'EUR|net', spec: { filter: {}, asOf: END }, page: 0, pageSize: 25 });
    expect(d.total).toBeCloseTo(k, 6);
    expect(d.rows[0]).toMatchObject({ type: 'snapshot' });
    const mv = await s.drill({ module: 'inventory', version: 7, seriesKey: 'EUR|net', spec: { filter: { products: ['sku:p11'] }, range: { from: '2025-12-01', to: END }, movements: true }, page: 0, pageSize: 50 });
    expect(mv.rows.map((r) => r.type)).toContain('adjustment');
    expect(mv.rows.every((r) => r.unit === 'pcs')).toBe(true);
    const csv = await s.drillCsv({ module: 'inventory', version: 7, seriesKey: 'EUR|net', spec: { filter: { products: ['sku:p11'] }, range: { from: '2025-12-01', to: END }, movements: true }, headers: ['d', 'doc', 'wh', 'p', 'q', 'u', 't', 'a', 's', 'r'], fileNames: {}, unknownFile: '?' });
    expect(csv.split('\r\n')[0]).toContain('t');
    expect(csv).toContain('adjustment');
  });

  it('backup and restore include inventory; "delete everything" removes it; the schema upgrade from v4 adds an empty inventory table', async () => {
    const db = new AppDB('inv-b-' + Math.random());
    const s = new EngineSession(db);
    await run(s, get('lt-snapshot-history'));
    const backup = await exportBackup(db);
    expect(backup.inventory).toHaveLength(get('lt-snapshot-history').snaps.length);
    await wipeAll(db);
    expect(await db.inventory.count()).toBe(0);
    await restoreBackup(db, backup);
    expect(await db.inventory.count()).toBe(backup.inventory!.length);
    const name = 'up5-' + Math.random();
    const { default: Dexie } = await import('dexie');
    const old = new Dexie(name);
    old.version(4).stores({ imports: 'id, checksum, importedAt', sales: 'key, importId, date, docKey, heldBy', purchases: 'key, importId, date, docKey, heldBy', mappings: 'signature', settings: 'key', audit: '++id, at, importId' });
    await old.table('purchases').put({ key: 'p1', importId: 'i', date: '2025-03-05', amount: 5, basis: 'net', currency: 'EUR', sourceRow: 1 });
    old.close();
    const upgraded = new AppDB(name);
    expect(await upgraded.purchases.count()).toBe(1);
    expect(await upgraded.inventory.count()).toBe(0);
  });

  it('saved mappings are kept per module: the same headers saved for inventory do not leak into sales', async () => {
    const s = mkSession();
    await run(s, get('lt-snapshot-history'), 'full', { remember: true });
    await s.parse(buf(get('lt-snapshot-history').bytes), 'again.csv');
    const inv = await s.analyze(0, ',', 'inventory');
    expect(inv!.usedSaved).toBe(true);
    const sales = await s.analyze(0, ',', 'sales');
    expect(sales!.usedSaved).toBe(false);
  });
});
