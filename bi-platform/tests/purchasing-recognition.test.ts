import { beforeAll, describe, expect, it } from 'vitest';
import { buildPurchasingFixtures, type PFixture } from './fixtures/purchasingFormats';
import { runPurchasingFixture } from './helpers';
import { normalizeUnit, comparableUnit, isCreditType } from '@/engine/purchasing/units';
import { detectModule, headerScore } from '@/engine/mapping/mapper';
import { parseFile } from '@/engine/parsing/parseFile';
import { analyzeSheet } from '@/engine/pipeline';

let fx: PFixture[] = [];
beforeAll(async () => {
  fx = await buildPurchasingFixtures();
});
const get = (id: string) => fx.find((f) => f.id === id)!;

describe('purchasing column recognition (LT / PL / EN)', () => {
  it('has at least six formats', () => expect(fx.length).toBeGreaterThanOrEqual(6));

  it.each(Array.from({ length: 7 }, (_, i) => i))('format #%i: mapping is proposed without correction and every line is imported', async (i) => {
    const f = fx[i]!;
    const r = await runPurchasingFixture(f);
    const mapped = new Set(r.analysis.proposal.entries.map((e) => e.field));
    for (const field of f.expectFields) expect(mapped.has(field), `${f.id}: ${field} not proposed`).toBe(true);
    expect(r.stats.errors, f.id).toEqual({});
    expect(r.records.length).toBe(f.truth.length);
    expect(r.records[0]!.basis).toBe(f.expectBasis);
    expect(r.stats.currencies).toEqual([f.currency]);
    // total spend equals the ground truth (credit notes negative, discounts already inside amounts)
    const spend = r.records.reduce((s, x) => s + x.amount, 0);
    expect(Math.round(spend * 100)).toBe(f.truth.reduce((s, t) => s + t.net, 0));
  });

  it('title rows and the totals row of the XLSX are not data', async () => {
    const r = await runPurchasingFixture(get('en-xlsx-title'));
    expect(r.analysis.table.headerRow).toBe(3);
    expect(r.analysis.table.skippedTotalRows).toBe(1);
  });

  it('"Pardavėjas" and "Kontrahent" mean SUPPLIER in purchasing, and "vnt" is a unit, not a quantity', () => {
    expect(headerScore('Pardavėjas', 'supplier_name', 'purchasing')).toBeGreaterThanOrEqual(1);
    expect(headerScore('Pardavėjas', 'salesperson', 'sales')).toBeGreaterThanOrEqual(1);
    expect(headerScore('Kontrahent', 'supplier_name', 'purchasing')).toBe(1);
    expect(headerScore('vnt', 'quantity', 'purchasing')).toBe(0);
    expect(headerScore('Matavimo vnt.', 'unit', 'purchasing')).toBe(1);
    expect(headerScore('JM', 'unit', 'purchasing')).toBe(1);
    expect(headerScore('Rabat', 'discount_amount', 'purchasing')).toBe(1);
    expect(headerScore('Magazyn', 'warehouse', 'purchasing')).toBe(1);
  });

  it('a mapping to the purchasing module needs a date and an amount; a missing supplier is flagged but not blocking', async () => {
    const csv = 'Data;Prekė;Kiekis;Suma be PVM\r\n2025-01-02;A;1;10,00\r\n2025-01-03;B;2;20,00\r\n';
    const a = analyzeSheet((await parseFile(new TextEncoder().encode(csv), 'x.csv')).sheets[0]!, { module: 'purchasing' })!;
    expect(a.proposal.warnings.map((w) => w.code)).toContain('missing_supplier');
    expect(a.proposal.warnings.map((w) => w.code)).not.toContain('missing_amount');
    expect(a.signature.startsWith('purchasing:')).toBe(true);
  });

  it('module detection: supplier words → purchasing; customer words or ambiguous words → sales', () => {
    expect(detectModule(['Data', 'Tiekėjas', 'Prekė', 'Suma']).module).toBe('purchasing');
    expect(detectModule(['Data', 'Dostawca', 'Towar', 'Kwota']).module).toBe('purchasing');
    expect(detectModule(['Date', 'Vendor', 'Item', 'Amount']).module).toBe('purchasing');
    expect(detectModule(['Data', 'Klientas', 'Prekė', 'Suma']).module).toBe('sales');
    expect(detectModule(['Data sprzedaży', 'Kontrahent', 'Towar', 'Wartość netto']).module).toBe('sales'); // "kontrahent" is ambiguous
    expect(detectModule(['Data', 'Pardavėjas', 'Prekė', 'Suma']).module).toBe('sales');
  });
});

describe('units are normalised, never silently converted', () => {
  it.each([
    ['kg', 'kg', 'mass'], ['Kg.', 'kg', 'mass'], ['kilogramas', 'kg', 'mass'], ['g', 'g', 'mass'], ['t', 't', 'mass'], ['l', 'l', 'volume'], ['litr', 'l', 'volume'], ['ml', 'ml', 'volume'],
    ['vnt.', 'pcs', 'count'], ['szt', 'pcs', 'count'], ['pcs', 'pcs', 'count'], ['dėž.', 'box', 'pack'], ['karton', 'box', 'pack'], ['opak.', 'pack', 'pack'], ['pak', 'pack', 'pack'], ['paletė', 'pallet', 'pack'],
  ])('%s → %s (%s)', (raw, code, dim) => {
    expect(normalizeUnit(raw)).toMatchObject({ code, dim });
  });
  it('unknown units stay their own unit and empty cells are "not provided"', () => {
    expect(normalizeUnit('kibiras')).toMatchObject({ code: 'kibiras', dim: 'unknown' });
    expect(normalizeUnit('  ')).toBeUndefined();
    expect(normalizeUnit(null)).toBeUndefined();
  });
  it('strict policy never converts; metric policy converts ONLY exact SI units', () => {
    expect(comparableUnit('g', 'strict')).toEqual({ unit: 'g', factor: 1 });
    expect(comparableUnit('g', 'metric')).toEqual({ unit: 'kg', factor: 0.001 });
    expect(comparableUnit('t', 'metric')).toEqual({ unit: 'kg', factor: 1000 });
    expect(comparableUnit('ml', 'metric')).toEqual({ unit: 'l', factor: 0.001 });
    for (const u of ['pcs', 'box', 'pack', 'pallet', 'kibiras']) expect(comparableUnit(u, 'metric'), u).toEqual({ unit: u, factor: 1 }); // pieces, boxes, packs: no rule exists
  });
  it('credit-note document types are recognised in LT / PL / EN; "korekta" is deliberately not', () => {
    for (const t of ['Kreditinė sąskaita', 'kredytowa', 'Credit note', 'Zwrot towaru', 'Grąžinimas', 'Return']) expect(isCreditType(t), t).toBe(true);
    for (const t of ['Pirkimo sąskaita', 'Faktura zakupu', 'Invoice', 'Korekta faktury']) expect(isCreditType(t), t).toBe(false);
  });
});

describe('credit notes, discounts and identifiers', () => {
  it('a document-type column over positive amounts makes credit notes negative – counted and reported, never silent', async () => {
    const r = await runPurchasingFixture(get('lt-csv-1257-credit-type'));
    const credits = r.records.filter((x) => x.creditByType);
    expect(credits).toHaveLength(get('lt-csv-1257-credit-type').truth.filter((t) => t.credit).length);
    expect(credits.every((x) => x.amount < 0 && (x.quantity ?? 0) < 0)).toBe(true);
    expect(r.stats.warnings.credit_sign_normalised).toBe(credits.length);
  });
  it('discount already inside the amount is recognised from the arithmetic and amounts are used as given', async () => {
    const r = await runPurchasingFixture(get('pl-csv-discount-included'));
    expect(r.discountMode).toBe('included');
    expect(r.stats.warnings.discount_deducted).toBeUndefined();
  });
  it('discount NOT inside the amount (amount = qty × price) is deducted – and the stats say how often', async () => {
    const f = get('pl-csv-discount-before');
    const r = await runPurchasingFixture(f);
    expect(r.discountMode).toBe('deducted');
    expect(r.stats.warnings.discount_deducted).toBe(f.truth.filter((t) => t.discount > 0).length);
    expect(Math.round(r.records.reduce((s, x) => s + x.amount, 0) * 100)).toBe(f.truth.reduce((s, t) => s + t.net, 0));
  });
  it('unverifiable discounts leave amounts untouched and are reported as unverified', async () => {
    const csv = 'Data;Dostawca;Towar;Ilość;Cena;Rabat;Kwota netto\r\n2025-01-02;A;X;10;2,00;1,00;17,50\r\n2025-01-03;A;X;10;2,00;1,00;19,00\r\n2025-01-04;A;X;10;2,00;1,00;18,10\r\n2025-01-05;A;X;10;2,00;1,00;20,00\r\n';
    const a = analyzeSheet((await parseFile(new TextEncoder().encode(csv), 'x.csv')).sheets[0]!, { module: 'purchasing' })!;
    const { normalizePurchases } = await import('@/engine/validation/normalizePurchases');
    const { confirmedFromEntries } = await import('@/engine/pipeline');
    const r = normalizePurchases(a.table.dataRows, { profiles: a.profiles, mapping: confirmedFromEntries(a.proposal.entries, 'EUR'), rowNumbers: a.table.dataRowNumbers });
    expect(r.discountMode).toBe('unverified');
    expect(r.records.map((x) => x.amount)).toEqual([17.5, 19, 18.1, 20]);
  });
  it('names-only data: no unit and no SKU are NOT invented', async () => {
    const r = await runPurchasingFixture(get('en-csv-names-only'));
    expect(r.records.every((x) => x.unit === undefined && x.productId === undefined && x.supplierId === undefined)).toBe(true);
    expect(r.records.every((x) => x.basis === 'unknown')).toBe(true);
  });
  it('purchase lines carry provenance and a document key scoped by supplier', async () => {
    const r = await runPurchasingFixture(get('lt-csv-utf8'));
    expect(r.records[0]!.sourceRow).toBeGreaterThan(0);
    const { docKey } = await import('@/engine/import/merge');
    expect(docKey({ documentId: 'A1', currency: 'EUR', supplierName: 'Acme' })).toBe('EUR|acme|a1');
    expect(docKey({ documentId: 'A1', currency: 'EUR' })).toBe('EUR|a1'); // sales keys are unchanged
    expect(docKey({ documentId: 'A1', currency: 'EUR', supplierName: 'Beta' })).not.toBe(docKey({ documentId: 'A1', currency: 'EUR', supplierName: 'Acme' }));
  });
});
