import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { EngineSession } from '@/lib/engineSession';
import { clearLink, decideLink, deleteImport, exportBackup, restoreBackup, wipeAll } from '@/db/store';
import { makeUniversal, universalCsv } from './fixtures/universal';
import { analyzeUniversal } from '@/engine/universal/analyze';
import { toDataset } from './fixtures/universal';
import { customerLink, makeExecutive, productLinks, seedDb } from './fixtures/executive';

const truth = makeUniversal();
const bytes = universalCsv(truth, 'lt');
const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const fresh = () => { const db = new AppDB('u-' + Math.random().toString(36).slice(2)); return { db, s: new EngineSession(db) }; };

async function importIt(s: EngineSession, decisions: Record<number, string> = { 8: 'numeric' }, name = 'orders.csv') {
  await s.parse(buf(bytes), name);
  const p = await s.universalProfile(0, ',');
  const out = await s.universalCommit({ sheetIdx: 0, decimalHint: ',', decisions: decisions as never, allowSameChecksum: false });
  return { p, out };
}

describe('universal tables through the engine session (the worker code)', () => {
  it('profile → confirm ambiguous columns → import → analyse, with the same numbers as the direct calculation', async () => {
    const { s } = fresh();
    const { p, out } = await importIt(s);
    expect(p!.columns.filter((c) => c.ambiguous).map((c) => c.index)).toEqual([8]);
    expect(out).toMatchObject({ status: 'ok', rows: truth.rows.length });
    const list = await s.universalList();
    expect(list).toHaveLength(1);
    const b = (await s.universalBuild({ id: list[0]!.id, cfg: {} }))!;
    const direct = analyzeUniversal((await toDataset(bytes, 'orders.csv', { 8: 'numeric' })).ds);
    expect(b.analysis.overview).toEqual(direct.overview);
    expect(b.analysis.ranks.map((r) => r.top.map((x) => [x.key, Math.round(x.value * 100)]))).toEqual(direct.ranks.map((r) => r.top.map((x) => [x.key, Math.round(x.value * 100)])));
    expect(b.charts.length).toBeGreaterThan(3);
    expect(b.charts.every((c) => c.table.rows.length > 0)).toBe(true);
    expect(b.insights.length).toBeGreaterThan(2);
    expect(Object.keys(b.options)).toContain('2'); // regions are filterable; identifiers are not offered as filters
    expect(Object.keys(b.options)).not.toContain('1');
    expect(() => structuredClone(b)).not.toThrow();
  });

  it('an import with undecided ambiguous columns is refused and stores nothing', async () => {
    const { s, db } = fresh();
    const { out } = await importIt(s, {});
    expect(out).toEqual({ status: 'unresolved', columns: [8] });
    expect(await db.universal.count()).toBe(0);
    expect(await db.imports.count()).toBe(0);
  });

  it('the same file is not imported twice by accident; it can be imported again knowingly', async () => {
    const { s, db } = fresh();
    await importIt(s);
    await s.parse(buf(bytes), 'orders-copy.csv');
    const p = await s.universalProfile(0, ',');
    expect(p!.duplicateOf?.fileName).toBe('orders.csv');
    const again = await s.universalCommit({ sheetIdx: 0, decimalHint: ',', decisions: { 8: 'numeric' }, allowSameChecksum: false });
    expect(again.status).toBe('duplicate_file');
    expect(await db.universal.count()).toBe(1);
    const knowingly = await s.universalCommit({ sheetIdx: 0, decimalHint: ',', decisions: { 8: 'numeric' }, allowSameChecksum: true });
    expect(knowingly.status).toBe('ok');
    expect(await db.universal.count()).toBe(2);
  });

  it('the import is audited; deleting it removes the table and is audited too; other modules are untouched', async () => {
    const { s, db } = fresh();
    await seedDb(db, makeExecutive(), []);
    const { out } = await importIt(s);
    const id = (out as { id: string }).id;
    expect((await db.audit.toArray()).some((a) => a.importId === id && a.action === 'import' && a.detail.module === 'universal')).toBe(true);
    expect((await db.imports.get(id))!.module).toBe('universal');
    await deleteImport(db, id);
    expect(await db.universal.count()).toBe(0);
    expect(await db.sales.count()).toBeGreaterThan(0);
    expect((await db.audit.toArray()).some((a) => a.importId === id && a.action === 'delete_import')).toBe(true);
  });

  it('the sales dashboard is not polluted by universal tables or by other modules’ imports', async () => {
    const { s, db } = fresh();
    await seedDb(db, makeExecutive(), []);
    await importIt(s);
    const b = await s.build({ version: 1, filters: {}, period: { preset: 'r30' } });
    expect(b.empty).toBe(false);
    const e = (await s.buildExecutive({ version: 1 })).model;
    expect(e.kpis.map((k) => k.module)).not.toContain('universal');
    expect(e.coverage.map((c) => c.module)).toEqual(['sales', 'purchasing', 'inventory', 'finance']);
  });
});

describe('link decisions and universal tables are local, audited, backed up and wiped with everything else', () => {
  it('decisions are stored, can be undone, and are audited', async () => {
    const { db } = fresh();
    const l = productLinks()[0]!;
    await decideLink(db, l, 'confirmed');
    expect((await db.links.get(l.id))!.status).toBe('confirmed');
    await decideLink(db, l, 'rejected');
    expect((await db.links.get(l.id))!.status).toBe('rejected');
    await clearLink(db, l.id);
    expect(await db.links.count()).toBe(0);
    expect((await db.audit.toArray()).filter((a) => a.action === 'link_decision').map((a) => a.detail.status)).toEqual(['confirmed', 'rejected', 'undone']);
  });

  it('backup and restore round-trip universal tables and links; "delete everything" removes them', async () => {
    const a = fresh();
    await importIt(a.s);
    await decideLink(a.db, customerLink(), 'confirmed');
    const backup = JSON.parse(JSON.stringify(await exportBackup(a.db)));
    expect(backup.universal).toHaveLength(1);
    expect(backup.links).toHaveLength(1);
    const b = fresh();
    await restoreBackup(b.db, { ...backup, sales: backup.sales ?? [] });
    expect(await b.db.universal.count()).toBe(1);
    expect((await b.db.links.toArray())[0]!.status).toBe('confirmed');
    expect((await b.s.universalBuild({ id: (await b.s.universalList())[0]!.id, cfg: {} }))!.analysis.overview.rows).toBe(truth.rows.length);
    await wipeAll(b.db);
    expect([await b.db.universal.count(), await b.db.links.count(), await b.db.imports.count()]).toEqual([0, 0, 0]);
  });

  it('old backups without universal tables or links still restore', async () => {
    const a = fresh();
    await seedDb(a.db, makeExecutive(), []);
    const backup = JSON.parse(JSON.stringify(await exportBackup(a.db)));
    delete backup.universal; delete backup.links;
    const b = fresh();
    await restoreBackup(b.db, backup);
    expect(await b.db.sales.count()).toBe(makeExecutive().sales.length);
  });
});
