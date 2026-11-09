import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { commitImport, deleteImport, exportBackup, listConflicts, loadAllSales, pendingHeldCount, previewImport, resolveConflicts, restoreBackup, wipeAll } from '@/db/store';
import { assignKeys } from '@/engine/import/keys';
import { defaultPolicy, planMerge } from '@/engine/import/merge';
import type { ExportMode, SalesRecord } from '@/engine/types';

const mk = (o: Partial<SalesRecord> = {}): Omit<SalesRecord, 'key'> => ({
  date: '2025-03-05', documentId: 'A1', customerName: 'X', productName: 'P', quantity: 1, amount: 100, basis: 'net', currency: 'EUR', sourceRow: 1, ...o,
});
const noId = (o: Partial<SalesRecord> = {}) => mk({ documentId: undefined, ...o });
const stats = { rowsRead: 1, rowsImported: 1, rowsSkipped: 0, errors: {}, warnings: {}, examples: [], currencies: ['EUR'] };
let db: AppDB;
beforeEach(() => {
  db = new AppDB('s-' + Math.random().toString(36).slice(2));
});
type Extra = Partial<Parameters<typeof commitImport>[1]>;
const imp = (n: string, lines: Omit<SalesRecord, 'key'>[], mode: ExportMode, extra: Extra = {}) =>
  commitImport(db, { checksum: n, fileName: n, sheetName: 's', exportMode: mode, records: assignKeys(lines), stats, mapping: { columns: {} }, ...extra });
const total = async () => (await loadAllSales(db)).reduce((a, r) => a + r.amount, 0);
const ok = (r: Awaited<ReturnType<typeof imp>>) => { if (r.status !== 'ok') throw new Error(r.status); return r.import; };

describe('destructive changes need explicit confirmation', () => {
  it('replacing stored lines without confirmation is refused and writes nothing', async () => {
    ok(await imp('a', [mk()], 'full'));
    const r = await imp('b', [mk({ amount: 120 })], 'full');
    expect(r.status).toBe('needs_confirmation');
    expect(r.status === 'needs_confirmation' && r.preview.needsConfirmation).toEqual(['replacements']);
    expect(await total()).toBe(100);
    expect(await db.imports.count()).toBe(1);
    expect(await db.sales.count()).toBe(1);
  });
  it('with confirmation the old line is superseded (kept) and the audit log records it', async () => {
    ok(await imp('a', [mk()], 'full'));
    ok(await imp('b', [mk({ amount: 120 })], 'full', { confirmed: true }));
    expect(await total()).toBe(120);
    expect(await db.sales.count()).toBe(2);
    const entries = await db.audit.toArray();
    expect(entries.map((e) => e.action)).toEqual(['import', 'import']);
    expect(entries[1]!.detail).toMatchObject({ confirmed: true, replacedDocs: 1, supersededLines: 1, conflicts: 'replace' });
  });
  it('a stored line missing from a declared full snapshot is only removed after confirmation, and stays recoverable', async () => {
    ok(await imp('a', [mk(), mk({ productName: 'Q', amount: 50 })], 'full'));
    const attempt = await imp('b', [mk()], 'full');
    expect(attempt.status === 'needs_confirmation' && attempt.preview.needsConfirmation).toEqual(['removals']);
    expect(await total()).toBe(150);
    const b = ok(await imp('b', [mk()], 'full', { confirmed: true }));
    expect(b.removedDocs).toBe(1);
    expect(await total()).toBe(100);
    await deleteImport(db, b.id);
    expect(await total()).toBe(150); // reversible
  });
  it('when completeness is not established, missing lines are KEPT (never removed)', async () => {
    for (const mode of ['incremental', 'partial', 'unknown'] as ExportMode[]) {
      const d = new AppDB('m-' + mode + Math.random());
      const run = (n: string, lines: Omit<SalesRecord, 'key'>[]) => commitImport(d, { checksum: n, fileName: n, sheetName: 's', exportMode: mode, records: assignKeys(lines), stats, mapping: { columns: {} }, confirmed: true });
      await run('a', [mk(), mk({ productName: 'Q', amount: 50 })]);
      const r = await run('b', [mk()]);
      expect(r.status === 'ok' && r.import.removedDocs).toBe(0);
      expect((await loadAllSales(d)).reduce((s, x) => s + x.amount, 0), mode).toBe(150);
    }
  });
  it('stored documents absent from a full snapshot are reported, never touched', async () => {
    ok(await imp('a', [mk(), mk({ documentId: 'A2' })], 'full'));
    const p = await previewImport(db, assignKeys([mk()]), 'full');
    expect(p.absentDocs).toBe(1);
    ok(await imp('b', [mk()], 'full'));
    expect(await total()).toBe(200);
  });
});

describe('export modes are distinguished', () => {
  const base = [mk(), mk({ productName: 'Q', amount: 50 })];
  const corrected = [mk({ amount: 120 }), mk({ productName: 'Q', amount: 50 })];
  it('defaults are safe: replacement is proposed only for full + document numbers', () => {
    expect(defaultPolicy('full', 'document', false).conflicts).toBe('replace');
    for (const m of ['incremental', 'partial', 'unknown'] as ExportMode[]) expect(defaultPolicy(m, 'document', false).conflicts).toBe('hold');
    expect(defaultPolicy('full', 'content', true)).toEqual({ conflicts: 'hold', content: 'hold_overlap' });
    expect(defaultPolicy('full', 'mixed', false).conflicts).toBe('hold');
  });
  it.each(['incremental', 'partial', 'unknown'] as ExportMode[])('%s: a corrected document is HELD, analytics unchanged, nothing replaced', async (mode) => {
    ok(await imp('a', base, 'full'));
    const r = ok(await imp('b', corrected, mode)); // no confirmation needed: nothing destructive happens
    expect(r.revisedDocs).toBe(0);
    expect([r.heldLines, r.heldDocs]).toEqual([1, 1]);
    expect(await total()).toBe(150);
    expect(await pendingHeldCount(db)).toBe(1);
  });
  it('partial: a file that only adds lines to a stored document is accepted', async () => {
    ok(await imp('a', [mk()], 'partial'));
    ok(await imp('b', [mk(), mk({ productName: 'Q', amount: 50 })], 'partial'));
    expect(await total()).toBe(150);
  });
  it('unknown / incremental: additions to a stored document are held too (could be a correction)', async () => {
    ok(await imp('a', [mk()], 'full'));
    const r = ok(await imp('b', [mk(), mk({ productName: 'Q', amount: 50 })], 'unknown'));
    expect(r.heldLines).toBe(1);
    expect(await total()).toBe(100);
  });
  it('new documents are always added, in every mode', async () => {
    ok(await imp('a', [mk()], 'full'));
    for (const [i, mode] of (['incremental', 'partial', 'unknown', 'full'] as ExportMode[]).entries()) ok(await imp('n' + i, [mk({ documentId: 'N' + i })], mode));
    expect(await total()).toBe(500);
  });
  it('overlapping reporting periods: identical lines are duplicates, whatever the mode', async () => {
    ok(await imp('a', base, 'full'));
    const r = ok(await imp('b', base, 'unknown'));
    expect([r.added, r.duplicates, r.heldLines]).toEqual([0, 2, 0]);
  });
});

describe('conflict review: every decision is explicit, audited and reversible', () => {
  async function heldScenario() {
    ok(await imp('a', [mk(), mk({ productName: 'Q', amount: 50 })], 'full'));
    return ok(await imp('b', [mk({ amount: 120 }), mk({ productName: 'Q', amount: 50 })], 'unknown'));
  }
  it('lists stored and held versions side by side', async () => {
    const b = await heldScenario();
    const g = await listConflicts(db);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ importId: b.id, fileName: 'b' });
    expect(g[0]!.held.map((x) => x.amount)).toEqual([120]);
    expect(g[0]!.stored.map((x) => x.amount).sort((a, b) => a - b)).toEqual([50, 100]);
  });
  it('use_new: replaces the stored lines (kept for audit) and activates the held ones', async () => {
    const b = await heldScenario();
    await resolveConflicts(db, [{ importId: b.id, docKey: 'EUR|a1' }], 'use_new');
    expect(await total()).toBe(170);
    expect(await pendingHeldCount(db)).toBe(0);
    expect((await db.audit.toArray()).at(-1)).toMatchObject({ action: 'resolve_conflict', detail: { action: 'use_new', lines: 1 } });
    await deleteImport(db, b.id); // undo everything the second import did
    expect(await total()).toBe(150);
  });
  it('keep_stored: held lines are discarded but retained; re-importing the same file does not resurrect them', async () => {
    const b = await heldScenario();
    await resolveConflicts(db, [{ importId: b.id, docKey: 'EUR|a1' }], 'keep_stored');
    expect(await total()).toBe(150);
    expect(await db.sales.filter((r) => Boolean(r.discarded)).count()).toBe(1);
    const again = ok(await imp('b2', [mk({ amount: 120 }), mk({ productName: 'Q', amount: 50 })], 'unknown'));
    expect([again.heldLines, again.duplicates]).toEqual([0, 2]);
  });
  it('keep_both: held lines are added next to the stored ones', async () => {
    const b = await heldScenario();
    await resolveConflicts(db, [{ importId: b.id, docKey: 'EUR|a1' }], 'keep_both');
    expect(await total()).toBe(270);
  });
  it('re-importing a file that is already held creates no second copy', async () => {
    await heldScenario();
    const again = ok(await imp('b-again', [mk({ amount: 120 }), mk({ productName: 'Q', amount: 50 })], 'unknown'));
    expect(again.heldLines).toBe(0);
    expect(await pendingHeldCount(db)).toBe(1);
  });
  it('deleting an import also removes the lines it holds', async () => {
    const b = await heldScenario();
    await deleteImport(db, b.id);
    expect(await pendingHeldCount(db)).toBe(0);
    expect(await total()).toBe(150);
  });
});

describe('insufficient identity: disclosed, with safe choices', () => {
  it('no document numbers: overlapping lines are held by default, later dates are added', async () => {
    ok(await imp('a', [noId(), noId({ date: '2025-03-06', customerName: 'Y', amount: 70 })], 'full'));
    const p = await previewImport(db, assignKeys([noId({ amount: 120 }), noId({ date: '2025-03-20', amount: 30 })]), 'full');
    expect(p.identity).toBe('content');
    expect(p.overlapRisk).toBe(true);
    expect(p.policy.content).toBe('hold_overlap');
    expect([p.heldLines, p.added]).toEqual([1, 1]);
    expect(p.needsConfirmation).toEqual([]);
    ok(await imp('b', [noId({ amount: 120 }), noId({ date: '2025-03-20', amount: 30 })], 'full'));
    expect(await total()).toBe(200); // 100 + 70 + 30; the overlapping 120 waits for review
    const g = await listConflicts(db);
    expect(g[0]).toMatchObject({ docKey: null });
    expect(g[0]!.held.map((x) => x.amount)).toEqual([120]);
  });
  it("'only new dates' skips everything inside the stored range and reports it", async () => {
    ok(await imp('a', [noId()], 'full'));
    const r = ok(await imp('b', [noId({ amount: 120 }), noId({ date: '2025-03-20', amount: 30 })], 'full', { policy: { conflicts: 'hold', content: 'only_new_dates' } }));
    expect([r.added, r.skippedLines]).toEqual([1, 1]);
    expect(await total()).toBe(130);
  });
  it("'exact duplicates only' may double-count a correction, so it needs explicit confirmation", async () => {
    ok(await imp('a', [noId()], 'full'));
    const lines = [noId({ amount: 120 })];
    const refused = await imp('b', lines, 'full', { policy: { conflicts: 'hold', content: 'dedupe_exact' } });
    expect(refused.status === 'needs_confirmation' && refused.preview.needsConfirmation).toEqual(['content_overlap']);
    ok(await imp('b', lines, 'full', { policy: { conflicts: 'hold', content: 'dedupe_exact' }, confirmed: true }));
    expect(await total()).toBe(220);
  });
  it('without any stored overlap there is nothing to warn about', async () => {
    const p = await previewImport(db, assignKeys([noId()]), 'full');
    expect([p.overlapRisk, p.needsConfirmation]).toEqual([false, []]);
  });
  it('mixed identity: documents are matched, document-less lines follow the content policy', async () => {
    ok(await imp('a', [mk(), noId({ date: '2025-03-06', amount: 70 })], 'full'));
    const p = await previewImport(db, assignKeys([mk(), noId({ date: '2025-03-06', amount: 75 })]), 'full');
    expect(p.identity).toBe('mixed');
    expect(p.duplicates).toBe(1);
    expect(p.heldLines).toBe(1);
  });
});

describe('the pure planner', () => {
  it('never marks lines of a stale document as replacements', () => {
    const old = assignKeys([mk()]);
    const cur = assignKeys([mk({ amount: 120 })]);
    const byKey = new Map([[old[0]!.key, { key: old[0]!.key, docKey: 'EUR|a1', supersededBy: 'x' }], [cur[0]!.key, { key: cur[0]!.key, docKey: 'EUR|a1' }]]);
    const p = planMerge(old, byKey, new Map([['EUR|a1', [{ key: cur[0]!.key, docKey: 'EUR|a1' }]]]), { mode: 'full', policy: { conflicts: 'replace', content: 'dedupe_exact' } });
    expect([p.stale, p.supersede.length, p.toAdd.length]).toEqual([1, 0, 0]);
  });
});

describe('audit and backup', () => {
  it('records imports, resolutions and deletions; wipeAll clears the log; backups round-trip with it', async () => {
    ok(await imp('a', [mk()], 'full'));
    const b = ok(await imp('b', [mk({ amount: 120 })], 'unknown'));
    await resolveConflicts(db, [{ importId: b.id, docKey: 'EUR|a1' }], 'keep_stored');
    await deleteImport(db, b.id);
    expect((await db.audit.toArray()).map((e) => e.action)).toEqual(['import', 'import', 'resolve_conflict', 'delete_import']);
    const backup = JSON.parse(JSON.stringify(await exportBackup(db)));
    await wipeAll(db);
    expect(await db.audit.count()).toBe(0);
    await restoreBackup(db, backup);
    expect(await db.audit.count()).toBe(4);
    expect(await total()).toBe(100);
  });
  it('the schema upgrade keeps data stored by the previous version', async () => {
    const name = 'up-' + Math.random();
    const { default: Dexie } = await import('dexie');
    const old = new Dexie(name);
    old.version(2).stores({ imports: 'id, checksum, importedAt', sales: 'key, importId, date, docKey', mappings: 'signature', settings: 'key' });
    await old.table('sales').put({ key: 'k1', importId: 'i', date: '2025-03-05', amount: 5, basis: 'net', currency: 'EUR', documentId: 'D', docKey: 'EUR|d', sourceRow: 1 });
    old.close();
    const upgraded = new AppDB(name);
    expect(await upgraded.sales.count()).toBe(1);
    expect(await pendingHeldCount(upgraded)).toBe(0);
    expect(await upgraded.audit.count()).toBe(0);
  });
});
