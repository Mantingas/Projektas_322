import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { commitImport, deleteImport, exportBackup, loadAllSales, restoreBackup, wipeAll } from '@/db/store';
import { buildFixtures } from './fixtures/formats';
import { runFixture } from './helpers';
import { assignKeys } from '@/engine/import/keys';
import { sha256Hex } from '@/engine/import/hash';
import { computeKpis, listSeries } from '@/engine/sales/kpi';
import { control } from './fixtures/truth';

let db: AppDB;
beforeEach(() => {
  db = new AppDB('test-' + Math.random().toString(36).slice(2));
});

async function load(id: string) {
  const f = (await buildFixtures()).find((x) => x.id === id)!;
  const r = await runFixture(f);
  return { f, r, checksum: await sha256Hex(f.bytes) };
}

const commit = (x: Awaited<ReturnType<typeof load>>, extra: object = {}) =>
  commitImport(db, { checksum: x.checksum, fileName: x.f.fileName, sheetName: 's', exportMode: 'full', records: x.r.records, stats: x.r.stats, mapping: x.r.mapping, ...extra });

const revenue = async () => {
  const all = await loadAllSales(db);
  const s = listSeries(all)[0]!;
  return Math.round(computeKpis(all, s)!.revenue * 100);
};

describe('duplicate prevention', () => {
  it('refuses the very same file twice (checksum)', async () => {
    const x = await load('lt-csv-utf8');
    expect((await commit(x)).status).toBe('ok');
    const again = await commit(x);
    expect(again.status).toBe('duplicate_file');
    expect(await revenue()).toBe(control(x.f.truth).netCents);
  });

  it('same period exported in another format is not double-counted', async () => {
    const a = await load('lt-csv-utf8'); // no currency column, default EUR
    const b = await load('en-csv'); // same truth, different headers/number format/currency column
    await commit(a);
    const second = await commit(b);
    expect(second.status === 'ok' && second.import.added).toBe(0);
    expect(second.status === 'ok' && second.import.duplicates).toBe(a.r.records.length);
    expect(await revenue()).toBe(control(a.f.truth).netCents);
  });

  it('overlapping partial export only adds new lines', async () => {
    const x = await load('lt-csv-utf8');
    const half = Math.floor(x.r.records.length * 0.6);
    // first export = first 60 % of lines; second = the whole period (overlaps 60 %)
    const first = assignKeys(x.r.records.slice(0, half).map(({ key: _k, ...r }) => (void _k, r)));
    const r1 = await commitImport(db, { checksum: 'a', fileName: 'a', sheetName: 's', exportMode: 'incremental', records: first, stats: x.r.stats, mapping: x.r.mapping });
    expect(r1.status === 'ok' && r1.import.added).toBe(half);
    const r2 = await commitImport(db, { checksum: 'b', fileName: 'b', sheetName: 's', exportMode: 'full', records: x.r.records, stats: x.r.stats, mapping: x.r.mapping });
    expect(r2.status === 'ok' && r2.import.duplicates).toBe(half);
    // lines of documents that were split across the two exports are reported as conflicts, never silently doubled
    const stored = (await loadAllSales(db)).length;
    expect(stored).toBeLessThanOrEqual(x.r.records.length);
    expect(r2.status === 'ok' && r2.import.added + r2.import.conflicts + r2.import.duplicates).toBe(x.r.records.length);
  });

  it('identical lines inside one file are all kept, and re-import keeps the same keys', () => {
    const base = { date: '2025-01-01', documentId: 'A1', customerName: 'X', productName: 'P', quantity: 1, amount: 10, basis: 'net' as const, currency: 'EUR', sourceRow: 1 };
    const a = assignKeys([base, { ...base, sourceRow: 2 }]);
    const b = assignKeys([base, { ...base, sourceRow: 9 }]);
    expect(new Set(a.map((r) => r.key)).size).toBe(2);
    expect(a.map((r) => r.key)).toEqual(b.map((r) => r.key));
  });
});

describe('persistence and deletion', () => {
  it('survives reopening the database', async () => {
    const x = await load('lt-csv-utf8');
    await commit(x);
    const name = db.name;
    db.close();
    const reopened = new AppDB(name);
    expect((await reopened.imports.count())).toBe(1);
    expect((await reopened.sales.count())).toBe(x.r.records.length);
    reopened.close();
  });

  it('deleting one import removes its lines only', async () => {
    const a = await load('lt-csv-utf8');
    const b = await load('pl-csv-1250');
    const ra = await commit(a);
    await commit(b);
    if (ra.status !== 'ok') throw new Error('x');
    await deleteImport(db, ra.import.id);
    expect(await db.sales.count()).toBe(b.r.records.length);
  });

  it('wipeAll empties every table', async () => {
    await commit(await load('lt-csv-utf8'));
    await db.settings.put({ key: 'lang', value: 'lt' });
    await wipeAll(db);
    expect(await db.imports.count()).toBe(0);
    expect(await db.sales.count()).toBe(0);
    expect(await db.mappings.count()).toBe(0);
    expect(await db.settings.count()).toBe(0);
  });

  it('backup round-trips', async () => {
    await commit(await load('lt-csv-utf8'));
    const backup = JSON.parse(JSON.stringify(await exportBackup(db)));
    await wipeAll(db);
    await restoreBackup(db, backup);
    expect(await db.sales.count()).toBeGreaterThan(0);
    await expect(restoreBackup(db, { version: 2 } as never)).rejects.toThrow('invalid_backup');
  });
});

describe('currencies are never mixed', () => {
  it('keeps EUR and PLN as separate series', async () => {
    await commit(await load('lt-csv-utf8'));
    await commit(await load('pl-csv-1250'));
    const series = listSeries(await loadAllSales(db));
    expect(series.map((s) => s.currency).sort()).toEqual(['EUR', 'PLN']);
  });
});
