import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { commitImport, deleteImport, exportBackup, listConflicts, loadAllPurchases, loadAllSales, pendingHeldCount, previewImport, resolveConflicts, restoreBackup, wipeAll } from '@/db/store';
import { EngineSession, type AnalysisLite } from '@/lib/engineSession';
import { assignPurchaseKeys } from '@/engine/purchasing/keys';
import { buildFixtures } from './fixtures/formats';
import { buildPurchasingFixtures, type PFixture } from './fixtures/purchasingFormats';
import { makePurchasing, sumNet } from './fixtures/purchasing';
import type { ExportMode, PurchaseRecord } from '@/engine/types';

let pfx: PFixture[] = [];
beforeAll(async () => {
  pfx = await buildPurchasingFixtures();
});
const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const mkSession = () => new EngineSession(new AppDB('pi-' + Math.random().toString(36).slice(2)));

async function loadP(s: EngineSession, f: PFixture) {
  const parsed = await s.parse(buf(f.bytes), f.fileName);
  const idx = Math.max(0, parsed.sheets.findIndex((x) => x.hasTable));
  const a = (await s.analyze(idx, ',', 'purchasing')) as AnalysisLite;
  return { idx, a, entries: a.proposal.entries, currency: a.proposal.detectedCurrency ?? f.defaultCurrency };
}

describe('purchasing through the engine session (the code that runs in the Web Worker)', () => {
  it('parse → analyze(purchasing) → preview → commit → buildPurchasing; the record list never reaches the UI thread', async () => {
    const s = mkSession();
    const f = pfx[0]!;
    const { idx, a, entries, currency } = await loadP(s, f);
    expect(a.module).toBe('purchasing');
    expect(a.detected.module).toBe('purchasing');
    expect(a.signature.startsWith('purchasing:')).toBe(true);
    const pv = await s.preview({ sheetIdx: idx, module: 'purchasing', entries, currency, mode: 'full' });
    if (!pv.ok) throw new Error('x');
    expect(pv.preview.added).toBe(f.truth.length);
    expect(pv.diagnostics.metrics.map((m) => m.id)).toContain('p_spend');
    expect(pv.diagnostics.metrics.find((m) => m.id === 'p_quantity')).toMatchObject({ available: false, reason: 'mixed_units' });
    const done = await s.commit({ sheetIdx: idx, module: 'purchasing', entries, currency, mode: 'full', confirmed: false, allowSameChecksum: false, remember: true });
    expect(done.status).toBe('ok');
    const b = await s.buildPurchasing({ version: 1, filters: {}, period: { preset: 'r30' } });
    expect(b.empty).toBe(false);
    expect(b.model).not.toHaveProperty('records');
    expect(b.model).not.toHaveProperty('analysis');
    expect(() => structuredClone(b)).not.toThrow();
    expect(Math.round(b.model!.trend.reduce((x, p) => x + p.revenue, 0) * 100)).toBe(f.truth.reduce((x, t) => x + t.net, 0));
    expect(b.analysis!.insights.length).toBeGreaterThan(5);
    expect(b.options.supplier!.length).toBe(6);
    expect(b.imports).toHaveLength(1);
  });

  it('sales and purchasing live side by side without mixing: each dashboard sees only its own lines', async () => {
    const db = new AppDB('both-' + Math.random());
    const s = new EngineSession(db);
    const sales = (await buildFixtures()).find((f) => f.id === 'lt-csv-utf8')!;
    await s.parse(buf(sales.bytes), sales.fileName);
    const sa = (await s.analyze(0, ',', 'sales'))!;
    expect(sa.detected.module).toBe('sales');
    await s.commit({ sheetIdx: 0, entries: sa.proposal.entries, currency: 'EUR', mode: 'full', confirmed: false, allowSameChecksum: false, remember: false });
    const { idx, entries, currency } = await loadP(s, pfx[0]!);
    await s.commit({ sheetIdx: idx, module: 'purchasing', entries, currency, mode: 'full', confirmed: false, allowSameChecksum: false, remember: false });
    expect(await db.sales.count()).toBe(sales.truth.length);
    expect(await db.purchases.count()).toBe(pfx[0]!.truth.length);
    const sb = await s.build({ version: 2, filters: {}, period: { preset: 'r30' } });
    const pb = await s.buildPurchasing({ version: 2, filters: {}, period: { preset: 'r30' } });
    expect(sb.imports.length).toBe(2); // the sales build lists all imports (legacy), the purchasing build only its own
    expect(pb.imports).toHaveLength(1);
    expect(pb.model!.series.currency).toBe('EUR');
    const spend = pb.model!.kpis.find((k) => k.id === 'p_spend')!.current!;
    const salesRev = sb.model!.kpis.find((k) => k.id === 'sales')!.current!;
    expect(spend).not.toBeCloseTo(salesRev, 0);
  });

  it('purchasing drill-down pages add up to the KPI, show supplier and unit, and the CSV has every line', async () => {
    const s = mkSession();
    const { idx, entries, currency } = await loadP(s, pfx[0]!);
    await s.commit({ sheetIdx: idx, module: 'purchasing', entries, currency, mode: 'full', confirmed: false, allowSameChecksum: false, remember: false });
    const b = await s.buildPurchasing({ version: 1, filters: {}, period: { preset: 'r30' } });
    const spec = { filter: {}, range: b.model!.periods.current };
    const d = await s.drill({ module: 'purchasing', version: 1, spec, page: 0, pageSize: 25 });
    expect(d.total).toBeCloseTo(b.model!.kpis.find((k) => k.id === 'p_spend')!.current!, 6);
    expect(d.rows[0]!.party).toBeTruthy();
    expect(d.rows.some((r) => r.unit)).toBe(true);
    expect(d.sources[0]!.lines).toBe(d.lines);
    const csv = await s.drillCsv({ module: 'purchasing', version: 1, spec, headers: ['d', 'doc', 's', 'p', 'q', 'u', 'a', 'f', 'r'], fileNames: {}, unknownFile: '?' });
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(d.lines + 1);
    // a supplier row's drill equals its table value
    const row = b.model!.tables.supplier!.rows.find((r) => r.current > 0)!;
    const dr = await s.drill({ module: 'purchasing', version: 1, spec: { filter: { suppliers: [row.key] }, range: b.model!.periods.current }, page: 0, pageSize: 5 });
    expect(dr.total).toBeCloseTo(row.current, 6);
  });

  it('the price-trend request returns quantity-weighted prices per supplier for one comparable item', async () => {
    const s = mkSession();
    const { idx, entries, currency } = await loadP(s, pfx[0]!);
    await s.commit({ sheetIdx: idx, module: 'purchasing', entries, currency, mode: 'full', confirmed: false, allowSameChecksum: false, remember: false });
    const t = await s.priceTrendFor({ version: 1, filters: {}, gk: 'sku:p01|l' });
    expect(t.points.length).toBeGreaterThan(2);
    expect(t.points[0]!.overall).toBeCloseTo(0.6, 9);
    expect(t.points[t.points.length - 1]!.overall).toBeCloseTo(0.72, 9);
    expect(t.suppliers).toHaveLength(1);
  });

  it('a purchasing mapping is remembered separately from a sales mapping with the same headers', async () => {
    const db = new AppDB('sig-' + Math.random());
    const s = new EngineSession(db);
    const f = pfx[0]!;
    const first = await loadP(s, f);
    await s.commit({ sheetIdx: first.idx, module: 'purchasing', entries: first.entries, currency: first.currency, mode: 'full', confirmed: false, allowSameChecksum: false, remember: true });
    const again = await loadP(s, f);
    expect(again.a.usedSaved).toBe(true);
    await s.parse(buf(f.bytes), f.fileName);
    expect((await s.analyze(0, ',', 'sales'))!.usedSaved).toBe(false); // no saved SALES mapping for this layout
  });

  it('names-only data: the discount mode, unit limitation and diagnostics are reported honestly', async () => {
    const s = mkSession();
    const f = pfx.find((x) => x.id === 'en-csv-names-only')!;
    const { idx, entries, currency } = await loadP(s, f);
    const pv = await s.preview({ sheetIdx: idx, module: 'purchasing', entries, currency, mode: 'full' });
    if (!pv.ok) throw new Error('x');
    expect(pv.diagnostics.metrics.find((m) => m.id === 'p_quantity')!.available).toBe(true); // no unit column: summed quantity is allowed but flagged on the dashboard
    expect(pv.diagnostics.unrecognized).toEqual([]);
  });
});

describe('import safety applies to purchasing exactly as to sales', () => {
  const stats = { rowsRead: 1, rowsImported: 1, rowsSkipped: 0, errors: {}, warnings: {}, examples: [], currencies: ['EUR'] };
  const line = (o: Partial<PurchaseRecord> = {}): Omit<PurchaseRecord, 'key'> => ({ date: '2025-03-05', documentId: 'INV-1', supplierName: 'Acme', supplierId: 'S1', productId: 'P1', productName: 'Widget', quantity: 10, unit: 'kg', amount: 100, basis: 'net', currency: 'EUR', sourceRow: 1, ...o });
  let db: AppDB;
  const imp = (n: string, lines: Omit<PurchaseRecord, 'key'>[], mode: ExportMode, extra: Partial<Parameters<typeof commitImport>[1]> = {}) =>
    commitImport(db, { checksum: n, fileName: n, sheetName: 's', exportMode: mode, records: assignPurchaseKeys(lines), stats, mapping: { columns: {} }, module: 'purchasing', ...extra });
  const total = async () => (await loadAllPurchases(db)).reduce((s, r) => s + r.amount, 0);
  const ok = (r: Awaited<ReturnType<typeof imp>>) => { if (r.status !== 'ok') throw new Error(r.status); return r.import; };
  beforeAll(() => { db = new AppDB('x'); });
  const fresh = () => { db = new AppDB('pis-' + Math.random().toString(36).slice(2)); };

  it('the same purchase file twice is refused; the same period in another layout adds nothing', async () => {
    fresh();
    ok(await imp('a', [line(), line({ documentId: 'INV-2', amount: 50 })], 'full'));
    expect((await imp('a', [line()], 'full')).status).toBe('duplicate_file');
    const r = ok(await imp('b', [line(), line({ documentId: 'INV-2', amount: 50 })], 'full'));
    expect([r.added, r.duplicates]).toEqual([0, 2]);
    expect(await total()).toBe(150);
  });
  it('the SAME document number from DIFFERENT suppliers are different documents (supplier invoice numbers are only unique per supplier)', async () => {
    fresh();
    ok(await imp('a', [line()], 'full'));
    const r = ok(await imp('b', [line({ supplierName: 'Beta', supplierId: 'S2', amount: 77 })], 'unknown'));
    expect([r.added, r.heldLines]).toEqual([1, 0]);
    expect(await total()).toBe(177);
  });
  it('the same supplier and number with different content is a correction: replacement needs confirmation, otherwise it is held', async () => {
    fresh();
    ok(await imp('a', [line(), line({ productId: 'P2', productName: 'Gadget', amount: 50 })], 'full'));
    const refused = await imp('b', [line({ amount: 120 }), line({ productId: 'P2', productName: 'Gadget', amount: 50 })], 'full');
    expect(refused.status === 'needs_confirmation' && refused.preview.needsConfirmation).toEqual(['replacements']);
    expect(await total()).toBe(150);
    const held = ok(await imp('b', [line({ amount: 120 }), line({ productId: 'P2', productName: 'Gadget', amount: 50 })], 'unknown'));
    expect([held.heldLines, held.revisedDocs]).toEqual([1, 0]);
    expect(await total()).toBe(150);
    expect(await pendingHeldCount(db, 'purchasing')).toBe(1);
    expect(await pendingHeldCount(db, 'sales')).toBe(0);
  });
  it('conflict review lists purchasing groups with their module; "use new" replaces only the lines it replaces; deleting the import restores them', async () => {
    fresh();
    ok(await imp('a', [line(), line({ productId: 'P2', productName: 'Gadget', amount: 50 })], 'full'));
    const b = ok(await imp('b', [line({ amount: 120 }), line({ productId: 'P2', productName: 'Gadget', amount: 50 })], 'unknown'));
    const g = await listConflicts(db);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ module: 'purchasing', docKey: 'EUR|s1|inv-1', importId: b.id });
    await resolveConflicts(db, [{ importId: b.id, docKey: g[0]!.docKey, module: 'purchasing' }], 'use_new');
    expect(await total()).toBe(170);
    expect((await db.audit.toArray()).at(-1)!.detail).toMatchObject({ module: 'purchasing', action: 'use_new' });
    await deleteImport(db, b.id);
    expect(await total()).toBe(150);
  });
  it('an explicit full-snapshot replacement keeps the replaced line for audit and is reversible', async () => {
    fresh();
    ok(await imp('a', [line()], 'full'));
    const b = ok(await imp('b', [line({ amount: 130 })], 'full', { confirmed: true }));
    expect(await total()).toBe(130);
    expect(await db.purchases.count()).toBe(2);
    await deleteImport(db, b.id);
    expect(await total()).toBe(100);
  });
  it('without document numbers only content can match: overlap is disclosed and held by default', async () => {
    fresh();
    ok(await imp('a', [line({ documentId: undefined })], 'full'));
    const p = await previewImport(db, assignPurchaseKeys([line({ documentId: undefined, amount: 130 })]), 'full', undefined, 'purchasing');
    expect([p.identity, p.overlapRisk, p.policy.content, p.heldLines]).toEqual(['content', true, 'hold_overlap', 1]);
  });
  it('currencies and VAT bases are stored as they are: nothing is converted on import', async () => {
    fresh();
    ok(await imp('a', [line({ currency: 'PLN', amount: 400 }), line({ documentId: 'INV-9', basis: 'gross', amount: 123 })], 'full'));
    const rows = await loadAllPurchases(db);
    expect(rows.map((r) => [r.currency, r.basis, r.amount]).sort()).toEqual([['EUR', 'gross', 123], ['PLN', 'net', 400]]);
  });
  it('purchase lines are included in backups and in "delete everything"', async () => {
    fresh();
    ok(await imp('a', [line()], 'full'));
    const backup = JSON.parse(JSON.stringify(await exportBackup(db)));
    expect(backup.purchases).toHaveLength(1);
    await wipeAll(db);
    expect(await db.purchases.count()).toBe(0);
    await restoreBackup(db, backup);
    expect(await total()).toBe(100);
    expect(await loadAllSales(db)).toHaveLength(0);
  });
  it('the schema upgrade from the previous version keeps existing sales data and adds an empty purchases table', async () => {
    const name = 'up4-' + Math.random();
    const { default: Dexie } = await import('dexie');
    const old = new Dexie(name);
    old.version(3).stores({ imports: 'id, checksum, importedAt', sales: 'key, importId, date, docKey, heldBy', mappings: 'signature', settings: 'key', audit: '++id, at, importId' });
    await old.table('sales').put({ key: 'k1', importId: 'i', date: '2025-03-05', amount: 5, basis: 'net', currency: 'EUR', sourceRow: 1 });
    old.close();
    const upgraded = new AppDB(name);
    expect(await upgraded.sales.count()).toBe(1);
    expect(await upgraded.purchases.count()).toBe(0);
  });
  it('a real-size purchasing import (the full fixture) is stored and totals match the ground truth', async () => {
    fresh();
    const truth = makePurchasing('lt');
    const f = pfx[0]!;
    const s = new EngineSession(db);
    const parsed = await s.parse(buf(f.bytes), f.fileName);
    void parsed;
    const a = (await s.analyze(0, ',', 'purchasing'))!;
    await s.commit({ sheetIdx: 0, module: 'purchasing', entries: a.proposal.entries, currency: 'EUR', mode: 'full', confirmed: false, allowSameChecksum: false, remember: false });
    expect((await loadAllPurchases(db)).reduce((x, r) => x + r.amount, 0)).toBeCloseTo(sumNet(truth), 2);
  });
});
