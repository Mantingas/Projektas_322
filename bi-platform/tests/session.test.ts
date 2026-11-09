import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { EngineSession, type AnalysisLite } from '@/lib/engineSession';
import { buildDiagnostics, renderDiagnosticsText } from '@/engine/import/diagnostics';
import { buildFixtures, type Fixture } from './fixtures/formats';
import { control } from './fixtures/truth';

let fx: Fixture[] = [];
beforeAll(async () => {
  fx = await buildFixtures();
});
const get = (id: string) => fx.find((f) => f.id === id)!;
const buf = (f: Fixture) => f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) as ArrayBuffer;
const sessionFor = () => new EngineSession(new AppDB('sess-' + Math.random().toString(36).slice(2)));

async function load(s: EngineSession, f: Fixture) {
  const parsed = await s.parse(buf(f), f.fileName);
  const idx = f.sheet ? parsed.sheets.findIndex((x) => x.name === f.sheet) : Math.max(0, parsed.sheets.findIndex((x) => x.hasTable));
  const a = (await s.analyze(idx, ',')) as AnalysisLite;
  return { parsed, idx, a, entries: a.proposal.entries, currency: a.proposal.detectedCurrency ?? f.defaultCurrency };
}

describe('engine session (the code that runs inside the Web Worker)', () => {
  it('parse → analyze → preview → commit → build gives the same numbers as the control calculation', async () => {
    const s = sessionFor();
    const f = get('lt-xlsx-title');
    const { parsed, idx, a, entries, currency } = await load(s, f);
    expect(parsed.sheets[idx]).toMatchObject({ hasTable: true });
    expect(a.headerRow).toBe(3);
    const pv = await s.preview({ sheetIdx: idx, entries, currency, mode: 'full' });
    expect(pv.ok).toBe(true);
    if (!pv.ok) return;
    expect(pv.preview.added).toBe(f.truth.length);
    expect(pv.preview.needsConfirmation).toEqual([]);
    const done = await s.commit({ sheetIdx: idx, entries, currency, mode: 'full', confirmed: false, allowSameChecksum: false, remember: true });
    expect(done.status).toBe('ok');
    const b = await s.build({ version: 1, filters: {}, period: { preset: 'r30' } });
    const c = control(f.truth);
    const total = b.model!.trend.reduce((x, p) => x + p.revenue, 0);
    expect(Math.round(total * 100)).toBe(c.netCents);
    expect(b.model).not.toHaveProperty('records'); // the record list never crosses to the UI thread
    expect(b.analysis!.insights.length).toBeGreaterThan(2);
    expect(b.imports).toHaveLength(1);
  });

  it('the result of every call is plain, structured-cloneable data', async () => {
    const s = sessionFor();
    const f = get('pl-csv-1250');
    const { idx, a, entries, currency } = await load(s, f);
    const pv = await s.preview({ sheetIdx: idx, entries, currency, mode: 'full' });
    await s.commit({ sheetIdx: idx, entries, currency, mode: 'full', confirmed: false, allowSameChecksum: false, remember: false });
    const b = await s.build({ version: 1, filters: {}, period: { preset: 'mom' }, includeRolling: true });
    for (const v of [a, pv, b]) expect(() => structuredClone(v)).not.toThrow();
    expect(b.rolling?.insights).toBeDefined();
  });

  it('drill-down pages add up to the KPI and the CSV has every line', async () => {
    const s = sessionFor();
    const f = get('lt-xlsx-title');
    const { idx, entries, currency } = await load(s, f);
    await s.commit({ sheetIdx: idx, entries, currency, mode: 'full', confirmed: false, allowSameChecksum: false, remember: false });
    const b = await s.build({ version: 1, filters: {}, period: { preset: 'r30' } });
    const cur = b.model!.periods.current;
    const spec = { filter: {}, range: cur };
    const d0 = await s.drill({ version: 1, spec, page: 0, pageSize: 25 });
    const sales = b.model!.kpis.find((k) => k.id === 'sales')!;
    expect(d0.total).toBeCloseTo(sales.current!, 6);
    expect(d0.rows).toHaveLength(25);
    expect(d0.sources[0]!.lines).toBe(d0.lines);
    const d1 = await s.drill({ version: 1, spec, page: 1, pageSize: 25 });
    expect(d1.rows[0]!.key).not.toBe(d0.rows[0]!.key);
    const csv = await s.drillCsv({ version: 1, spec, headers: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], fileNames: {}, unknownFile: '?' });
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(d0.lines + 1);
  });

  it('data changes are picked up through the version number', async () => {
    const s = sessionFor();
    const f = get('lt-csv-utf8');
    const { idx, entries, currency } = await load(s, f);
    expect((await s.build({ version: 1, filters: {}, period: { preset: 'r30' } })).empty).toBe(true);
    await s.commit({ sheetIdx: idx, entries, currency, mode: 'full', confirmed: false, allowSameChecksum: false, remember: false });
    expect((await s.build({ version: 2, filters: {}, period: { preset: 'r30' } })).empty).toBe(false);
  });

  it('the same file twice is flagged by checksum; a corrected export is held or needs confirmation', async () => {
    const db = new AppDB('sess2-' + Math.random());
    const s = new EngineSession(db);
    const f = get('lt-csv-utf8');
    let r = await load(s, f);
    await s.commit({ sheetIdx: r.idx, entries: r.entries, currency: r.currency, mode: 'full', confirmed: false, allowSameChecksum: false, remember: false });
    const again = await s.parse(buf(f), f.fileName);
    expect(again.duplicateOf).toBeDefined();
    // a different file for the same period (other format) → all duplicates, nothing replaced
    const en = get('en-csv');
    r = await load(s, en);
    const pv = await s.preview({ sheetIdx: r.idx, entries: r.entries, currency: r.currency, mode: 'full' });
    expect(pv.ok && [pv.preview.added, pv.preview.duplicates]).toEqual([0, f.truth.length]);
  });

  it('a missing required mapping is reported, not thrown', async () => {
    const s = sessionFor();
    const { idx, entries } = await load(s, get('lt-csv-utf8'));
    const pv = await s.preview({ sheetIdx: idx, entries: entries.filter((e) => e.field !== 'document_date'), currency: 'EUR', mode: 'full' });
    expect(pv).toEqual({ ok: false, error: 'missing_date' });
    const noCur = await s.preview({ sheetIdx: idx, entries, mode: 'full' });
    expect(noCur).toEqual({ ok: false, error: 'currency_required' });
  });

  it('analyze offers saved mappings on the next file with the same layout', async () => {
    const db = new AppDB('sess3-' + Math.random());
    const s = new EngineSession(db);
    const f = get('lt-csv-utf8');
    let r = await load(s, f);
    expect(r.a.usedSaved).toBe(false);
    await s.commit({ sheetIdx: r.idx, entries: r.entries, currency: 'EUR', mode: 'full', confirmed: false, allowSameChecksum: false, remember: true });
    r = await load(s, f);
    expect(r.a.usedSaved).toBe(true);
    expect(r.a.savedCurrency).toBe('EUR');
  });
});

describe('import diagnostics', () => {
  it('reports structure, mappings, unrecognised columns, issues and unavailable metrics – without cell values', async () => {
    const s = sessionFor();
    const f = get('lt-csv-utf8'); // no cost, no category, has salesperson
    const { idx, a, entries, currency } = await load(s, f);
    const pv = await s.preview({ sheetIdx: idx, entries, currency, mode: 'full' });
    if (!pv.ok) throw new Error('x');
    const d = pv.diagnostics;
    expect(d.structure).toMatchObject({ kind: 'csv', headerRow: 1, delimiter: ';' });
    expect(d.columns.find((c) => c.header === 'Suma be PVM')).toMatchObject({ field: 'net_amount', recognized: true });
    expect(d.rows.imported).toBe(f.truth.length);
    const m = Object.fromEntries(d.metrics.map((x) => [x.id, x]));
    expect(m.margin).toMatchObject({ available: false, reason: 'no_cost' });
    expect(m.sales!.available).toBe(true);
    expect(m.asp).toMatchObject({ available: false, reason: 'needs_single_product' });
    const text = renderDiagnosticsText(d, { app: 'x', generatedAt: 'now' });
    expect(text).toContain('margin: unavailable (no_cost)');
    for (const t of f.truth.slice(0, 20)) {
      expect(text).not.toContain(t.customer);
      expect(text).not.toContain(t.doc);
    }
    expect(a.samples[0]!.length).toBeGreaterThan(0);
  });

  it('unrecognised columns and validation issues are listed', async () => {
    const s = sessionFor();
    const csv = 'Data;Klientas;Suma be PVM;Pastabos;Kodas XYZ\r\n2025-01-01;A;10,00;labas;1\r\nneteisinga;B;abc;x;2\r\n2025-01-03;C;5,00;y;3\r\n';
    const bytes = new TextEncoder().encode(csv);
    await s.parse(bytes.buffer.slice(0) as ArrayBuffer, 'x.csv');
    const a = (await s.analyze(0, ','))!;
    const pv = await s.preview({ sheetIdx: 0, entries: a.proposal.entries, currency: 'EUR', mode: 'full' });
    if (!pv.ok) throw new Error('x');
    expect(pv.diagnostics.unrecognized).toContain('Pastabos');
    const codes = pv.diagnostics.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['invalid_date']));
    expect(pv.diagnostics.issues.find((i) => i.code === 'invalid_date')!.rows).toEqual([3]);
    expect(pv.diagnostics.rows).toMatchObject({ read: 3, imported: 2, skipped: 1 });
  });

  it('buildDiagnostics works on its own for empty data', () => {
    const d = buildDiagnostics({ structure: { kind: 'csv', sheet: 's', sheets: 1, rows: 0, columns: 0, headerRow: 1, headerConfidence: 0, skippedTotalRows: 0, truncated: false }, profiles: [], entries: [], records: [], basis: 'net' });
    expect(d.metrics.every((m) => !m.available)).toBe(true);
  });
});
