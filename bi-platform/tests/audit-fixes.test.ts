import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { commitImport, deleteImport, loadAllSales, previewImport } from '@/db/store';
import { assignKeys } from '@/engine/import/keys';
import { identityOf } from '@/engine/import/merge';
import { parseFile } from '@/engine/parsing/parseFile';
import { computeKpis } from '@/engine/sales/kpi';
import type { ExportMode, SalesRecord } from '@/engine/types';

export const mk = (o: Partial<SalesRecord> = {}): Omit<SalesRecord, 'key'> => ({
  date: '2025-01-05', documentId: 'A1', customerName: 'X', productName: 'P', quantity: 1, amount: 100, basis: 'net', currency: 'EUR', sourceRow: 1, ...o,
});
const stats = { rowsRead: 1, rowsImported: 1, rowsSkipped: 0, errors: {}, warnings: {}, examples: [], currencies: ['EUR'] };
let db: AppDB;
beforeEach(() => {
  db = new AppDB('t-' + Math.random().toString(36).slice(2));
});
const imp = (n: string, lines: Omit<SalesRecord, 'key'>[], mode: ExportMode = 'full') =>
  commitImport(db, { checksum: n, fileName: n, sheetName: 's', exportMode: mode, records: assignKeys(lines), stats, mapping: { columns: {} } });
const total = async () => (await loadAllSales(db)).reduce((a, r) => a + r.amount, 0);

describe('corrected invoices are never lost', () => {
  it('a corrected line supersedes the old one; both are kept for audit', async () => {
    await imp('a', [mk(), mk({ productName: 'Q', amount: 50 })]);
    const r = await imp('b', [mk({ amount: 120 }), mk({ productName: 'Q', amount: 50 })]);
    expect(await total()).toBe(170);
    expect(r.status === 'ok' && [r.import.revisedDocs, r.import.supersededLines, r.import.duplicates, r.import.added]).toEqual([1, 1, 1, 1]);
    expect(await db.sales.count()).toBe(3); // the replaced line is retained
    const kept = await db.sales.filter((x) => Boolean(x.supersededBy)).toArray();
    expect(kept.map((x) => x.amount)).toEqual([100]);
  });
  it('deleting the correcting import restores the original line', async () => {
    await imp('a', [mk()]);
    const r = await imp('b', [mk({ amount: 120 })]);
    expect(await total()).toBe(120);
    if (r.status === 'ok') await deleteImport(db, r.import.id);
    expect(await total()).toBe(100);
  });
  it('re-importing the older version later does not revert the correction (stale)', async () => {
    await imp('a', [mk()]);
    await imp('b', [mk({ amount: 120 })]);
    const r = await imp('c', [mk()]);
    expect(await total()).toBe(120);
    expect(r.status === 'ok' && r.import.staleLines).toBe(1);
  });
  it('a line added to a document by a later full export is kept', async () => {
    await imp('a', [mk()]);
    await imp('b', [mk(), mk({ productName: 'Q', amount: 50 })]);
    expect(await total()).toBe(150);
  });
  it('incremental exports never supersede; additions to stored documents are flagged', async () => {
    await imp('a', [mk()]);
    const r = await imp('b', [mk({ amount: 120 })], 'incremental');
    expect(await total()).toBe(220); // ambiguous: cannot tell a correction from an addition
    expect(r.status === 'ok' && r.import.conflicts).toBe(1);
  });
  it('the preview reports the same numbers the commit will produce', async () => {
    await imp('a', [mk()]);
    const lines = assignKeys([mk({ amount: 120 })]);
    const p = await previewImport(db, lines, 'full');
    expect([p.added, p.revisedDocs, p.supersededLines, p.duplicates]).toEqual([1, 1, 1, 0]);
  });
});

describe('missing transaction identifiers', () => {
  it('classifies identity reliability', () => {
    expect(identityOf([{ documentId: 'a' }, { documentId: 'b' }]).identity).toBe('document');
    expect(identityOf([{ documentId: 'a' }, {}]).identity).toBe('mixed');
    expect(identityOf([{}, {}]).identity).toBe('content');
  });
  it('flags overlap risk instead of calling it safe when there is no document number', async () => {
    const noId = (o: Partial<SalesRecord> = {}) => mk({ documentId: undefined, ...o });
    await imp('a', [noId()]);
    const p = await previewImport(db, assignKeys([noId({ amount: 120 })]), 'full');
    expect(p.identity).toBe('content');
    expect(p.overlapRisk).toBe(true);
    const r = await imp('b', [noId({ amount: 120 })]);
    expect(r.status === 'ok' && r.import.identity).toBe('content');
  });
  it('with document numbers there is no overlap warning', async () => {
    await imp('a', [mk()]);
    expect((await previewImport(db, assignKeys([mk({ amount: 120 })]), 'full')).overlapRisk).toBe(false);
  });
});

describe('provenance', () => {
  it('loaded records carry importId and source row', async () => {
    await imp('a', [mk({ sourceRow: 7 })]);
    const [r] = await loadAllSales(db);
    expect(r!.importId).toMatch(/^imp_/);
    expect(r!.sourceRow).toBe(7);
  });
});

describe('Excel ZIP limits', () => {
  it('rejects a decompression bomb before inflating it', async () => {
    const z = new JSZip();
    z.file('xl/junk.bin', new Uint8Array(150 * 1024 * 1024), { compression: 'DEFLATE' });
    const bytes = await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    expect(bytes.length).toBeLessThan(1024 * 1024);
    const before = process.memoryUsage().rss;
    await expect(parseFile(bytes, 'bomb.xlsx')).rejects.toMatchObject({ code: 'zip_limits' });
    expect(process.memoryUsage().rss - before).toBeLessThan(100 * 1024 * 1024);
  });
  it('rejects archives with too many entries', async () => {
    const z = new JSZip();
    for (let i = 0; i < 1100; i++) z.file(`f${i}.txt`, 'x');
    await expect(parseFile(await z.generateAsync({ type: 'uint8array' }), 'many.xlsx')).rejects.toMatchObject({ code: 'zip_limits' });
  });
  it('rejects a truncated archive as corrupt', async () => {
    await expect(parseFile(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]), 'x.xlsx')).rejects.toMatchObject({ code: 'corrupt_file' });
  });
});

describe('order metrics exclude credit notes', () => {
  it('AOV is computed on positive documents only', () => {
    const recs = assignKeys([mk({ documentId: 'D1' }), mk({ documentId: 'D2', customerName: 'Y' }), mk({ documentId: 'KR1', amount: -100 })]);
    const k = computeKpis(recs, { currency: 'EUR', basis: 'net' })!;
    expect(k.orders).toBe(2);
    expect(k.averageDocumentValue).toBe(100);
  });
});
