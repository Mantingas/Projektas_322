import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { PH, importAny, mkSession, type Cell } from './fixtures/salesCsv';

const FH = ['Data', 'Sąskaitos Nr.', 'Kliento kodas', 'Klientas', 'Sąskaitos suma', 'Apmokėjimo terminas'];
const OH = ['Ataskaitos data', 'Kliento kodas', 'Klientas', 'Sąskaitos Nr.', 'Sąskaitos data', 'Apmokėjimo terminas', 'Sąskaitos suma', 'Sumokėta suma', 'Neapmokėta suma', 'Valiuta'];
const IH = ['Data', 'Dokumento Nr.', 'Judėjimo tipas', 'Sandėlis', 'Prekės kodas', 'Prekė', 'Kiekis', 'Matavimo vnt.', 'Vieneto savikaina'];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('D1 – purchasing: supplier + document number + year', () => {
  const y24: Cell[][] = [['2024-12-20', '1', 'S1', 'P', 1, 'kg', 100], ['2024-12-21', '2', 'S1', 'P', 1, 'kg', 100]];
  const y25: Cell[][] = [['2025-01-05', '1', 'S1', 'P', 1, 'kg', 250], ['2025-01-06', '2', 'S1', 'P', 1, 'kg', 250]];
  const spend = async (s: ReturnType<typeof mkSession>) => {
    const b: any = await s.buildPurchasing({ version: 5, filters: {}, period: { preset: 'custom', custom: { current: { from: '2024-12-01', to: '2025-01-31' }, previous: { from: '2024-10-01', to: '2024-11-30' } } } } as any);
    return b.model.kpis.find((k: any) => k.id === 'p_spend').current as number;
  };
  it('the same supplier’s numbers next year do not replace last year’s documents (was a "replacement" that removed 200 of spend)', async () => {
    const s = mkSession();
    await importAny(s, 'purchasing', PH, y24, 'a.csv');
    const b = await importAny(s, 'purchasing', PH, y25, 'b.csv', {}, false);
    expect(b.pv.preview.revisedDocs).toBe(0);
    expect(b.pv.preview.needsConfirmation).toEqual([]);
    expect(b.pv.preview.sharedNumberDocs).toBe(2);
    expect(b.commit.status).toBe('ok');
    expect(await spend(s)).toBe(700);                                              // was 500
  });
  it('the same number at two DIFFERENT suppliers in the same year are two documents, and neither is a conflict', async () => {
    const s = mkSession();
    await importAny(s, 'purchasing', PH, [['2025-02-01', '77', 'Tiekėjas A', 'P', 1, 'kg', 100]], 'a.csv');
    const b = await importAny(s, 'purchasing', PH, [['2025-02-02', '77', 'Tiekėjas B', 'P', 1, 'kg', 40]], 'b.csv', {}, false);
    expect(b.pv.preview.revisedDocs).toBe(0);
    expect(b.pv.preview.newDocs).toBe(1);
    expect(b.pv.preview.sharedNumberDocs).toBe(0);                                 // different scope: not even "shared"
  });
  it('a corrected document of the SAME supplier and year is still a replacement that needs confirmation, and leaves other years alone', async () => {
    const s = mkSession();
    await importAny(s, 'purchasing', PH, y24, 'a.csv'); await importAny(s, 'purchasing', PH, y25, 'b.csv');
    const fixed: Cell[][] = [['2025-01-05', '1', 'S1', 'P', 1, 'kg', 300], ['2025-01-06', '2', 'S1', 'P', 1, 'kg', 250]];
    const c = await importAny(s, 'purchasing', PH, fixed, 'c.csv', {}, false);
    expect(c.pv.preview.revisedDocs).toBe(1);
    expect(c.pv.preview.needsConfirmation).toContain('replacements');
    expect(c.commit.status).toBe('needs_confirmation');
    await importAny(s, 'purchasing', PH, fixed, 'c2.csv', {}, true);
    expect(await spend(s)).toBe(100 + 100 + 300 + 250);
  });
  it('re-importing the same files changes nothing', async () => {
    const s = mkSession();
    for (const [n, f] of [['a', y24], ['b', y25], ['a2', y24], ['b2', y25]] as const) await importAny(s, 'purchasing', PH, f as Cell[][], `${n}.csv`);
    expect(await spend(s)).toBe(700);
  });
});

describe('D1 – finance: dated flows are year-scoped, snapshots are untouched', () => {
  it('an invoice number that restarts next year is a new invoice, not a revision (was "replacements")', async () => {
    const s = mkSession();
    await importAny(s, 'finance', FH, [['2024-12-20', 'SF1', 'C1', 'K1', '100,00', '2025-01-20']], 'a.csv', { side: 'receivable' });
    const b = await importAny(s, 'finance', FH, [['2025-01-05', 'SF1', 'C1', 'K1', '250,00', '2025-02-05']], 'b.csv', { side: 'receivable' }, false);
    expect(b.pv.preview.revisedDocs).toBe(0);
    expect(b.pv.preview.needsConfirmation).toEqual([]);
    expect(b.pv.preview.sharedNumberDocs).toBe(1);
    expect(b.commit.status).toBe('ok');
  });
  it('a corrected invoice of the same year still needs confirmation', async () => {
    const s = mkSession();
    await importAny(s, 'finance', FH, [['2025-01-05', 'SF1', 'C1', 'K1', '100,00', '2025-02-05']], 'a.csv', { side: 'receivable' });
    const b = await importAny(s, 'finance', FH, [['2025-01-05', 'SF1', 'C1', 'K1', '250,00', '2025-02-05']], 'b.csv', { side: 'receivable' }, false);
    expect(b.pv.preview.revisedDocs).toBe(1);
    expect(b.commit.status).toBe('needs_confirmation');
  });
  it('open-item snapshots: the same report twice is identical, a later snapshot (even in the next year) is not a conflict', async () => {
    const s = mkSession();
    const snap = (d: string, no: string): Cell[][] => [[d, 'C1', 'K1', no, '2024-11-01', '2024-12-01', '100,00', '0,00', '100,00', 'EUR']];
    await importAny(s, 'finance', OH, snap('2024-12-31', 'SF9'), 's1.csv', { side: 'receivable' });
    const again = await importAny(s, 'finance', OH, snap('2024-12-31', 'SF9'), 's1b.csv', { side: 'receivable' }, false);
    expect(again.pv.preview.added).toBe(0);
    expect(again.pv.preview.revisedDocs).toBe(0);
    const next = await importAny(s, 'finance', OH, snap('2025-01-31', 'SF9'), 's2.csv', { side: 'receivable' }, false);
    expect(next.pv.preview.revisedDocs).toBe(0);
    expect(next.pv.preview.needsConfirmation).toEqual([]);
    expect(next.commit.status).toBe('ok');
  });
});

describe('D1 – inventory: dated movements are year-scoped, snapshots are untouched', () => {
  it('a movement document number that restarts next year is a new document (was "replacements")', async () => {
    const s = mkSession();
    await importAny(s, 'inventory', IH, [['2024-12-20', '1', 'Pajamavimas', 'Vilnius', 'P01', 'Pienas', 10, 'vnt.', '1,00']], 'a.csv');
    const b = await importAny(s, 'inventory', IH, [['2025-01-05', '1', 'Pajamavimas', 'Vilnius', 'P01', 'Pienas', 25, 'vnt.', '1,00']], 'b.csv', {}, false);
    expect(b.pv.preview.revisedDocs).toBe(0);
    expect(b.pv.preview.sharedNumberDocs).toBe(1);
    expect(b.commit.status).toBe('ok');
  });
  it('a corrected movement in the same year still needs confirmation', async () => {
    const s = mkSession();
    await importAny(s, 'inventory', IH, [['2025-01-05', '1', 'Pajamavimas', 'Vilnius', 'P01', 'Pienas', 10, 'vnt.', '1,00']], 'a.csv');
    const b = await importAny(s, 'inventory', IH, [['2025-01-05', '1', 'Pajamavimas', 'Vilnius', 'P01', 'Pienas', 25, 'vnt.', '1,00']], 'b.csv', {}, false);
    expect(b.pv.preview.revisedDocs).toBe(1);
  });
});
