import { beforeAll, describe, expect, it } from 'vitest';
import { buildInventoryFixtures, type IFixture } from './fixtures/inventoryFormats';
import { runInventoryFixture } from './helpers';
import { classifyMovement } from '@/engine/inventory/movements';
import { detectModule, validateMapping, isMappingConfirmable } from '@/engine/mapping/mapper';
import { normalizeInventory } from '@/engine/validation/normalizeInventory';
import { END } from './fixtures/inventory';

let fixtures: IFixture[] = [];
beforeAll(async () => { fixtures = await buildInventoryFixtures(); });
const fx = (id: string) => fixtures.find((f) => f.id === id)!;

describe('inventory recognition: LT / PL / EN columns, dataset type, module', () => {
  it('every format is recognised as inventory and mapped to the expected fields', async () => {
    for (const f of fixtures) {
      const r = await runInventoryFixture(f);
      expect(detectModule(r.analysis.table.headers).module, f.id).toBe('inventory');
      const got = new Set(r.analysis.proposal.entries.map((e) => e.field));
      for (const field of f.expectFields) expect(got.has(field), `${f.id}: ${field} (got ${[...got].join(',')})`).toBe(true);
      expect(r.kind, f.id).toBe(f.kind);
    }
  });

  it('historical snapshots: all lines and dates are read, values and minimum stock are kept as given', async () => {
    const f = fx('lt-snapshot-history');
    const r = await runInventoryFixture(f);
    expect(r.records).toHaveLength(f.snaps.length);
    expect(r.snapshotDates).toHaveLength(5);
    const p05 = r.records.find((x) => x.productId === 'P05' && x.date === END)!;
    expect(p05.value).toBeCloseTo(2160, 2);
    expect(p05.unitCost).toBeCloseTo(120, 4);
    expect(r.records.find((x) => x.productId === 'P07')!.minStock).toBe(60);
    // the planted value that disagrees with quantity × cost is reported, not silently "fixed"
    expect(r.stats.warnings.value_mismatch).toBe(1);
    expect(r.stats.warnings.negative_stock).toBeGreaterThanOrEqual(1);
    // snapshot lines are "documents" a re-import can duplicate or contradict
    expect(r.records.every((x) => x.kind === 'snapshot' && x.documentId?.startsWith('snap '))).toBe(true);
  });

  it('units are normalised to canonical codes (vnt. → pcs), unknown units stay their own', async () => {
    const r = await runInventoryFixture(fx('lt-snapshot-history'));
    expect(new Set(r.records.map((x) => x.unit))).toEqual(new Set(['pcs', 'kg', 'g']));
  });

  it('LT movements with UNSIGNED quantities: issues become negative, receipts stay positive, the normalisation is counted', async () => {
    const f = fx('lt-movements');
    const r = await runInventoryFixture(f);
    expect(r.records).toHaveLength(f.moves.length);
    const issues = r.records.filter((x) => x.movementType === 'issue');
    expect(issues.length).toBeGreaterThan(500);
    expect(issues.every((x) => x.quantity! < 0)).toBe(true);
    expect(r.records.filter((x) => x.movementType === 'receipt').every((x) => x.quantity! > 0)).toBe(true);
    expect(r.stats.warnings.movement_sign_normalised).toBeGreaterThan(500);
    expect(r.unknownTypeShare).toBe(0);
  });

  it('EN movements with SIGNED quantities give the same stock effect as the unsigned LT file (no double flipping)', async () => {
    const a = await runInventoryFixture(fx('lt-movements'));
    const b = await runInventoryFixture(fx('en-movements-signed'));
    const eff = (rs: typeof a.records) => Object.fromEntries([...rs.reduce((m, x) => m.set(`${x.productId}|${x.warehouse}`, (m.get(`${x.productId}|${x.warehouse}`) ?? 0) + (x.movementType === 'transfer' && x.warehouseTo ? 0 : x.quantity!)), new Map<string, number>())]);
    expect(eff(b.records)).toEqual(eff(a.records));
    expect(b.stats.warnings.movement_sign_normalised ?? 0).toBeLessThan(20); // only the few lines whose type fixes the direction
  });

  it('transfers, returns and write-offs keep their own type and direction', async () => {
    const r = await runInventoryFixture(fx('lt-movements'));
    const by = (doc: string) => r.records.filter((x) => x.documentId === doc);
    const t1 = by('TR-1001');
    expect(t1.map((x) => x.movementType)).toEqual(['transfer', 'transfer']);
    expect(t1.map((x) => x.quantity!).sort((x, y) => x - y)).toEqual([-100, 100]);
    const t2 = by('TR-1002');
    expect(t2).toHaveLength(1);
    expect(t2[0]).toMatchObject({ movementType: 'transfer', quantity: -50, warehouseTo: 'Vilnius' });
    expect(by('RT-1')[0]).toMatchObject({ movementType: 'return', quantity: 30 }); // customer return: stock up
    expect(by('RT-2')[0]).toMatchObject({ movementType: 'return', quantity: -20 }); // supplier return: stock down
    expect(by('ADJ-1')[0]).toMatchObject({ movementType: 'adjustment', quantity: -15 }); // write-off: stock down
  });

  it('a balance without a date column needs the as-of date the user states – without it the import is refused', async () => {
    const f = fx('lt-snapshot-nodate');
    const r = await runInventoryFixture(f);
    expect(r.dateFromAsOf).toBe(true);
    expect(r.records.every((x) => x.date === END)).toBe(true);
    expect(r.stats.warnings.date_from_as_of).toBe(r.records.length);
    await expect(runInventoryFixture({ ...f, asOfDate: undefined })).rejects.toMatchObject({ code: 'missing_date' });
  });

  it('PL Windows-1250 valuation report: diacritics, dd.mm.yyyy dates, decimal comma', async () => {
    const f = fx('pl-valuation-1250');
    const r = await runInventoryFixture(f);
    expect(r.records).toHaveLength(f.snaps.length);
    expect(r.records.every((x) => x.date === END && x.currency === 'PLN')).toBe(true);
    expect(r.records.find((x) => x.productId === 'P11')!.warehouse).toBe('Łódź');
  });

  it('mapping confirmation: product + quantity (or value) + a date are required; nothing is guessed', () => {
    const w = (fields: string[], ctx = {}) => validateMapping(fields.map((f) => ({ field: f as never, confidence: 1 })), 'inventory', ctx).map((x) => x.code);
    expect(w(['product_id', 'quantity', 'snapshot_date'])).toEqual([]);
    expect(w(['product_name', 'stock_value', 'movement_date'])).toEqual([]);
    expect(w(['product_id', 'quantity'])).toEqual(['missing_date']);
    expect(w(['product_id', 'quantity'], { hasDefaultDate: true })).toEqual([]);
    expect(w(['quantity', 'snapshot_date'])).toEqual(['missing_product']);
    expect(w(['product_id', 'snapshot_date'])).toEqual(['missing_quantity']);
    expect(isMappingConfirmable(validateMapping([{ field: 'product_id', confidence: 1 }], 'inventory'))).toBe(false);
  });

  it('movement types in LT / PL / EN; unknown wording is never guessed (and never becomes demand)', () => {
    const t = (s: string) => classifyMovement(s).type;
    expect([t('Pajamavimas'), t('Przyjęcie'), t('Goods receipt'), t('PZ')]).toEqual(['receipt', 'receipt', 'receipt', 'receipt']);
    expect([t('Išrašymas'), t('Wydanie'), t('Sales issue'), t('WZ')]).toEqual(['issue', 'issue', 'issue', 'issue']);
    expect([t('Perkėlimas'), t('Przesunięcie MM'), t('Stock transfer'), t('MM')]).toEqual(['transfer', 'transfer', 'transfer', 'transfer']);
    expect([t('Inventorizacija'), t('Inwentaryzacja'), t('Stock count')]).toEqual(['adjustment', 'adjustment', 'adjustment']);
    expect([t('Pradinis likutis'), t('Bilans otwarcia'), t('Opening balance')]).toEqual(['opening', 'opening', 'opening']);
    expect(t('Grąžinimas')).toBe('return');
    expect(classifyMovement('Grąžinimas').bySign).toBe(true);
    expect(classifyMovement('Zwrot od klienta').forcedSign).toBe(1);
    expect(classifyMovement('Return to supplier').forcedSign).toBe(-1);
    expect(t('Kažkas kita')).toBe('unknown');
    expect(t('')).toBe('unknown');
  });

  it('a movement file with an unrecognised type column is flagged, row by row', () => {
    const rows = [['2025-01-01', 'A1', 'Dingo', 'W', 'P1', 'Item', '5', 'pcs']];
    const headers = ['Data', 'Dok nr', 'Tipas', 'Sandėlis', 'Prekės kodas', 'Prekė', 'Kiekis', 'Vnt'];
    void headers;
    const r = normalizeInventory(rows as never, {
      profiles: headers.map((h, i) => ({ index: i, header: h, nonEmpty: 1, dateRatio: i === 0 ? 1 : 0, serialDateRatio: 0, numberRatio: i === 6 ? 1 : 0, textRatio: 1, distinctRatio: 1, avgTextLength: 3, negativeRatio: 0, currencyHints: [], type: 'text', decimal: ',', dateOrder: 'ymd', ambiguousNumbers: 0 })) as never,
      mapping: { columns: { movement_date: 0, document_id: 1, movement_type: 2, warehouse: 3, product_id: 4, product_name: 5, quantity: 6, unit: 7 }, defaultCurrency: 'EUR' }, rowNumbers: [2], today: '2026-01-01',
    });
    expect(r.records[0]!.movementType).toBe('unknown');
    expect(r.stats.warnings.unknown_movement_type).toBe(1);
    expect(r.unknownTypeShare).toBe(1);
  });
});
