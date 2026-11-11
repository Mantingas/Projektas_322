import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { H, importCsv, kpi, mkSession, runSales, type Cell } from './fixtures/salesCsv';

const D = '2025-06-15';
const HT = ['Data', 'Dokumento Nr.', 'Dokumento tipas', 'Klientas', 'Prekė', 'Kiekis', 'Suma be PVM'];
const INV = 'Sąskaita faktūra', CRN = 'Kreditinė sąskaita';

describe('S1 – credit notes are recognised from the document type, the sign is only checked against it', () => {
  it('credit notes written as POSITIVE numbers are made negative (they used to be counted as sales)', async () => {
    const r = await runSales(HT, [[D, 'SF1', INV, 'K1', 'P', 1, 100], [D, 'SF2', INV, 'K2', 'P', 1, 100], [D, 'KR1', CRN, 'K1', 'P', 1, 100], [D, 'KR2', CRN, 'K2', 'P', 1, 100]]);
    expect(r.map['Dokumento tipas']).toBe('document_type');
    expect(kpi(r.b, 'sales').current).toBe(0);                 // was 400
    expect(kpi(r.b, 'returns').current).toBe(200);
    expect(r.pv.ok && r.pv.stats.warnings.credit_sign_normalised).toBe(2);
    expect(r.records.filter((x) => x.amount < 0)).toHaveLength(2);
  });
  it('credit notes that are ALREADY negative are never flipped a second time', async () => {
    const r = await runSales(HT, [[D, 'SF1', INV, 'K1', 'P', 1, 100], [D, 'SF2', INV, 'K2', 'P', 1, 100], [D, 'KR1', CRN, 'K1', 'P', -1, -100]]);
    expect(kpi(r.b, 'sales').current).toBe(100);
    expect(r.pv.ok && r.pv.stats.warnings.credit_sign_normalised).toBeUndefined();
  });
  it('a file mixing positive and negative credit rows is ambiguous: the positive ones are NOT imported, are counted and flagged to the user', async () => {
    const r = await runSales(HT, [[D, 'SF1', INV, 'K1', 'P', 1, 100], [D, 'KR1', CRN, 'K1', 'P', -1, -100], [D, 'KR2', CRN, 'K2', 'P', 1, 100]]);
    expect(r.pv.ok && r.pv.stats.errors.credit_sign_ambiguous).toBe(1);
    expect(r.pv.ok && r.pv.stats.rowsImported).toBe(2);
    expect(r.pv.ok && r.pv.trust.some((t) => t.code === 'credit_ambiguous' && t.level === 'warn' && t.params.n === 1)).toBe(true);
    expect(kpi(r.b, 'sales').current).toBe(0);                  // 100 − 100: the ambiguous +100 is not silently counted as a sale
  });
  it('without a type column the sign is the only evidence and nothing is changed', async () => {
    const r = await runSales(H, [[D, 'SF1', 'K1', 'P', 1, 100, ''], [D, 'KR1', 'K1', 'P', -1, -40, '']]);
    expect(kpi(r.b, 'sales').current).toBe(60);
    expect(r.map['Dokumento Nr.']).toBe('document_id');
  });
  it('"Korekta" (a correction, which may raise an amount) is not treated as a credit note', async () => {
    const r = await runSales(HT, [[D, 'SF1', INV, 'K1', 'P', 1, 100], [D, 'KO1', 'Korekta', 'K1', 'P', 1, 20]]);
    expect(kpi(r.b, 'sales').current).toBe(120);
  });
});

describe('Q1 – quantity sign follows the amount sign', () => {
  it('returns carrying a POSITIVE quantity (the file’s convention) reduce the quantity', async () => {
    const rows: Cell[][] = [];
    for (let i = 0; i < 4; i++) rows.push([D, `Q${i}`, 'K' + i, 'P', 10, 100, '']);
    rows.push([D, 'QR1', 'K0', 'P', 10, -100, '']); rows.push([D, 'QR2', 'K1', 'P', 10, -100, '']);
    const r = await runSales(H, rows);
    expect(r.records.filter((x) => x.amount < 0).map((x) => x.quantity)).toEqual([-10, -10]);
    expect(r.pv.ok && r.pv.stats.warnings.quantity_sign_normalised).toBe(2);
    expect(kpi(r.b, 'quantity').current).toBe(20);              // was 60
  });
  it('mixed sign conventions: the contradicting quantities are ignored, not guessed', async () => {
    const r = await runSales(H, [[D, 'A1', 'K1', 'P', 10, 100, ''], [D, 'R1', 'K1', 'P', -10, -100, ''], [D, 'R2', 'K2', 'P', 10, -100, '']]);
    expect(r.records.find((x) => x.documentId === 'R2')!.quantity).toBeUndefined();
    expect(r.pv.ok && r.pv.stats.warnings.quantity_sign_ambiguous).toBe(1);
  });
  it('a positive amount with a negative quantity is not trusted either', async () => {
    const r = await runSales(H, [[D, 'A1', 'K1', 'P', -5, 100, '']]);
    expect(r.records[0]!.quantity).toBeUndefined();
  });
});

describe('U1 – the unit column is read', () => {
  it('"Mato vnt." is mapped to the unit field and stored as a canonical code', async () => {
    const r = await runSales(['Data', 'Dokumento Nr.', 'Klientas', 'Prekė', 'Kiekis', 'Mato vnt.', 'Suma be PVM'], [[D, 'U1', 'K1', 'Miltai', 100, 'kg', 200], [D, 'U2', 'K2', 'Miltai', 5000, 'g', 10], [D, 'U3', 'K3', 'Pienas', 2, 'l', 3], [D, 'U4', 'K4', 'Sviestas', 5, '', 3]]);
    expect(r.map['Mato vnt.']).toBe('unit');
    expect(r.records.map((x) => x.unit)).toEqual(['kg', 'g', 'l', undefined]);
    expect(r.pv.ok && r.pv.stats.warnings.missing_unit).toBe(1);
  });
});

describe('Z1 – cost problems are reported at import', () => {
  it('negative, absurd, zero and wrong-sign return costs are counted', async () => {
    const rows: Cell[][] = [];
    for (let i = 0; i < 5; i++) rows.push([D, `N${i}`, 'K' + i, 'P' + i, 1, 100, 60]);
    rows.push([D, 'N5', 'K5', 'P5', 1, 100, 900000], [D, 'N6', 'K6', 'P6', 1, 100, -40], [D, 'N7', 'K7', 'P7', 1, 100, 0], [D, 'R1', 'K0', 'P0', -1, -100, 60]);
    const r = await runSales(H, rows);
    expect(r.pv.ok && r.pv.stats.warnings.cost_suspect).toBe(3);   // 900000, −40, and +60 on a return
    expect(r.pv.ok && r.pv.stats.warnings.cost_zero).toBe(1);
  });
});

describe('shared import code still works for the other modules', () => {
  it('the engine session still imports a purchasing file with document type and unit columns', async () => {
    const s = mkSession();
    const csvText = '﻿Data;Tiekėjo sąskaitos Nr.;Tiekėjas;Prekė;Kiekis;Matavimo vnt.;Dokumento tipas;Suma be PVM\r\n2025-06-10;T1;S1;Miltai;10;kg;Sąskaita;100,00\r\n2025-06-11;T2;S1;Miltai;10;kg;Kreditinė;100,00';
    await s.parse(new TextEncoder().encode(csvText).buffer as ArrayBuffer, 'p.csv');
    const a: any = await s.analyze(0, ',', 'purchasing');
    expect(a.proposal.entries.map((e: any) => e.field)).toEqual(expect.arrayContaining(['unit', 'document_type']));
    const c = await s.commit({ sheetIdx: 0, module: 'purchasing', entries: a.proposal.entries, currency: 'EUR', mode: 'full', confirmed: true, allowSameChecksum: true, remember: false });
    expect(c.status).toBe('ok');
  });
});
