import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { checkAmountConsistency, headerScore, suggestMapping } from '@/engine/mapping/mapper';
import { profileColumns } from '@/engine/schema/profile';
import type { FieldId } from '@/engine/types';
import { importCsv as importRaw, mkSession, type Cell } from './fixtures/salesCsv';

/** The preview result is a union with an error branch; these tests only import valid files. */
const importCsv = async (...args: Parameters<typeof importRaw>) => { const r = await importRaw(...args); return { ...r, pv: r.pv as any }; };

/** The 28 columns of the first real-looking export (names and meaning), with a generator for consistent rows. */
const COLS28 = ['Įrašo_ID', 'Data', 'Mėnuo', 'Dokumento_nr', 'Dokumento_tipas', 'Eilutės_nr', 'Kliento_ID', 'Kliento_pavadinimas', 'Miestas', 'Apskritis', 'Vadybininkas', 'Užsakymo_kanalas', 'SKU', 'Prekės_pavadinimas', 'Kategorija', 'Subkategorija', 'Kiekis_vnt', 'Katalogo_kaina_be_PVM_EUR', 'Nuolaida_proc', 'Pardavimo_kaina_be_PVM_EUR', 'Pardavimo_suma_be_PVM_EUR', 'PVM_EUR', 'Pardavimo_suma_su_PVM_EUR', 'Savikaina_vnt_EUR', 'Savikaina_EUR', 'Bendrasis_pelnas_EUR', 'Marža_proc', 'Susieta_SF'];
const N = 60;
function row28(i: number): Record<string, Cell> {
  const qty = 1 + (i % 9), list = 10 + (i % 7), disc = i % 4 === 0 ? 10 : 0, price = Math.round(list * (1 - disc / 100) * 100) / 100, net = Math.round(qty * price * 100) / 100, vat = Math.round(net * 21) / 100, cost = 6 + (i % 3);
  return {
    'Įrašo_ID': 'R' + (1000 + i), Data: `2025-0${1 + (i % 6)}-${String(1 + (i % 27)).padStart(2, '0')}`, 'Mėnuo': '2025-0' + (1 + (i % 6)), Dokumento_nr: 'INV-' + (100 + Math.floor(i / 2)),
    Dokumento_tipas: i % 15 === 0 ? 'Kreditinė sąskaita' : 'Pardavimo sąskaita faktūra', 'Eilutės_nr': 1 + (i % 2), Kliento_ID: 'K' + (i % 8), Kliento_pavadinimas: 'Klientas ' + (i % 8),
    Miestas: ['Vilnius', 'Kaunas', 'Klaipėda'][i % 3]!, Apskritis: ['Vilniaus', 'Kauno', 'Klaipėdos'][i % 3]!, Vadybininkas: 'Vad ' + (i % 4), 'Užsakymo_kanalas': ['El. paštas', 'Telefonas'][i % 2]!,
    SKU: 'P' + (i % 12), 'Prekės_pavadinimas': 'Prekė ' + (i % 12), Kategorija: 'Kat ' + (i % 3), Subkategorija: 'Sub ' + (i % 5),
    Kiekis_vnt: qty, Katalogo_kaina_be_PVM_EUR: list, Nuolaida_proc: disc, Pardavimo_kaina_be_PVM_EUR: price, Pardavimo_suma_be_PVM_EUR: net, PVM_EUR: vat, Pardavimo_suma_su_PVM_EUR: Math.round((net + vat) * 100) / 100,
    Savikaina_vnt_EUR: cost, Savikaina_EUR: qty * cost, Bendrasis_pelnas_EUR: Math.round((net - qty * cost) * 100) / 100, 'Marža_proc': 30, Susieta_SF: i % 5 === 0 ? 'SF-' + i : '',
  };
}
const EXPECT28: Record<string, FieldId> = {
  Data: 'document_date', Dokumento_nr: 'document_id', Dokumento_tipas: 'document_type', Kliento_ID: 'customer_id', Kliento_pavadinimas: 'customer_name',
  SKU: 'product_id', 'Prekės_pavadinimas': 'product_name', Kiekis_vnt: 'quantity', Pardavimo_kaina_be_PVM_EUR: 'unit_price', Pardavimo_suma_be_PVM_EUR: 'net_amount',
  PVM_EUR: 'vat_amount', Pardavimo_suma_su_PVM_EUR: 'gross_amount', Savikaina_vnt_EUR: 'unit_cost', Savikaina_EUR: 'cost_amount',
};
const build = (cols: string[], n = N) => ({ header: cols, rows: Array.from({ length: n }, (_, i) => { const r = row28(i); return cols.map((c) => r[c] ?? ''); }) });
const mapOf = (a: { proposal: { entries: { field: FieldId; columnIndex: number }[] }; headers: string[] }) => Object.fromEntries(a.proposal.entries.map((e) => [a.headers[e.columnIndex]!, e.field]));
const shuffle = <T,>(xs: T[], seed: number) => { const a = [...xs]; let s = seed; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };

describe('the real 28-column export', () => {
  it('maps the unambiguous fields, ignores the list price, and does not mistake price or VAT-excluded headers for VAT', async () => {
    const { header, rows } = build(COLS28);
    const { a, pv } = await importCsv(mkSession(), header, rows);
    const map = mapOf(a);
    for (const [h, f] of Object.entries(EXPECT28)) expect(map[h], h).toBe(f);
    expect(map.Katalogo_kaina_be_PVM_EUR).toBeUndefined();
    expect(Object.values(map).filter((f) => f === 'vat_amount')).toHaveLength(1);
    expect(a.proposal.detectedCurrency).toBe('EUR');
    expect(pv.stats.rowsImported).toBe(N);
    expect(pv.trust.some((t: { code: string }) => t.code === 'vat_inconsistent')).toBe(false);
  });

  it('gives the same mapping and the same money whatever the column order', async () => {
    const base = await importCsv(mkSession(), ...(Object.values(build(COLS28)) as [string[], Cell[][]]));
    const baseMap = mapOf(base.a);
    const sum = (r: { records: any[] }) => Math.round(r.records.reduce((s, x) => s + (x.netAmount ?? 0), 0) * 100) / 100;
    for (const seed of [1, 2, 3, 4, 5]) {
      const { header, rows } = build(seed === 5 ? [...COLS28].reverse() : shuffle(COLS28, seed));
      const r = await importCsv(mkSession(), header, rows);
      const m = mapOf(r.a);
      for (const [h, f] of Object.entries(EXPECT28)) expect(m[h], `${h} seed ${seed}`).toBe(f);
      expect(m).toEqual(baseMap);
      expect(r.pv.stats.rowsImported).toBe(N);
      expect(sum(r)).toBe(sum(base));
    }
  });
});

describe('header normalisation', () => {
  it('currency suffixes and basis words decide nothing about VAT', () => {
    for (const h of ['Pardavimo_suma_be_PVM_EUR', 'Pardavimo_suma_su_PVM_EUR', 'Pardavimo_kaina_be_PVM_EUR', 'Katalogo_kaina_be_PVM_EUR', 'PVM %', 'PVM_proc', 'VAT rate', 'Price excl. VAT', 'Cena netto PLN']) expect(headerScore(h, 'vat_amount'), h).toBe(0);
    for (const h of ['PVM_EUR', 'PVM', 'VAT', 'Kwota VAT PLN', 'Tax']) expect(headerScore(h, 'vat_amount'), h).toBeGreaterThanOrEqual(0.9);
    expect(headerScore('Katalogo_kaina_be_PVM_EUR', 'unit_price')).toBe(0);
    expect(headerScore('Pardavimo_kaina_be_PVM_EUR', 'unit_price')).toBeGreaterThan(0.7);
    expect(headerScore('Kaina_EUR', 'unit_price')).toBeGreaterThan(0.9);
  });
});

describe('currency', () => {
  const profiles = (header: string[], rows: Cell[][]) => profileColumns(header, rows.map((r) => r.map((c) => String(c))), ',');
  const rows = (n: number, f: (i: number) => Cell[]) => Array.from({ length: n }, (_, i) => f(i));

  it('a part-number column is not a currency, and the file is not silently dropped', async () => {
    const header = ['Order ref', 'Document date', 'Dealer', 'OE number', 'Pieces', 'Revenue', 'Tax', 'Total incl. tax'];
    const data = rows(60, (i) => ['O' + i, `2025-03-${String(1 + (i % 28)).padStart(2, '0')}`, 'Dealer ' + (i % 7), 'OE' + (i % 11), 1 + (i % 9), 100 + i, 21 + i * 0.21, 121 + i * 1.21]);
    const { a, pv } = await importCsv(mkSession(), header, data.map((r) => r.map((c) => (typeof c === 'number' ? Math.round(c * 100) / 100 : c))));
    expect(a.proposal.entries.some((e) => e.field === 'currency')).toBe(false);
    expect(pv.stats.rowsImported).toBe(60);
  });

  it('a real currency column is still recognised, with its values', () => {
    const p = suggestMapping(profiles(['Data', 'Valiuta', 'Suma be PVM'], rows(30, (i) => [`2025-01-${String(1 + (i % 28)).padStart(2, '0')}`, 'EUR', '10,50'])));
    expect(p.entries.find((e) => e.field === 'currency')?.columnIndex).toBe(1);
  });

  it('no currency column: the suffix gives the currency; conflicting suffixes or none give nothing to assume', () => {
    const one = suggestMapping(profiles(['Data', 'Suma_be_PVM_PLN'], rows(10, () => ['2025-01-02', '5,00'])));
    expect(one.detectedCurrency).toBe('PLN');
    const two = suggestMapping(profiles(['Data', 'Suma_be_PVM_EUR', 'Savikaina_USD'], rows(10, () => ['2025-01-02', '5,00', '3,00'])));
    expect(two.detectedCurrency).toBeUndefined();
    const none = suggestMapping(profiles(['Data', 'Suma be PVM'], rows(10, () => ['2025-01-02', '5,00'])));
    expect(none.detectedCurrency).toBeUndefined();
  });
});

describe('amount consistency', () => {
  const header = ['Data', 'Suma be PVM', 'PVM', 'Suma su PVM'];
  const mk = (vat: (n: number) => number) => {
    const rows = Array.from({ length: 30 }, (_, i) => { const n = 100 + i; return [`2025-02-${String(1 + (i % 27)).padStart(2, '0')}`, String(n), String(vat(n)), String(Math.round(n * 121) / 100)]; });
    const profiles = profileColumns(header, rows, ',');
    return { profiles, rows, proposal: suggestMapping(profiles) };
  };
  it('keeps confidence when net + VAT ≈ gross', () => {
    const { profiles, rows, proposal } = mk((n) => Math.round(n * 21) / 100);
    const out = checkAmountConsistency(proposal, profiles, rows);
    expect(out.entries.map((e) => e.confidence)).toEqual(proposal.entries.map((e) => e.confidence));
  });
  it('asks for confirmation when most rows contradict the reading', () => {
    const { profiles, rows, proposal } = mk((n) => n * 0.5);
    const out = checkAmountConsistency(proposal, profiles, rows);
    for (const f of ['net_amount', 'vat_amount', 'gross_amount'] as const) expect(out.entries.find((e) => e.field === f)!.confidence).toBeLessThan(0.75);
    expect(out.warnings.some((w) => w.code === 'low_confidence')).toBe(true);
  });
  it('also questions a remembered mapping that the data contradicts', () => {
    const { profiles, rows } = mk((n) => n * 0.5);
    const saved = suggestMapping(profiles, { saved: { document_date: 'data', net_amount: 'suma be pvm', vat_amount: 'pvm', gross_amount: 'suma su pvm' } });
    expect(saved.entries.every((e) => e.source === 'saved')).toBe(true);
    const out = checkAmountConsistency(saved, profiles, rows);
    expect(out.entries.find((e) => e.field === 'vat_amount')!.confidence).toBeLessThan(0.75);
  });
  it('never compares a unit price with a line total', () => {
    const rows = Array.from({ length: 30 }, (_, i) => [`2025-02-${String(1 + (i % 27)).padStart(2, '0')}`, String(5 + (i % 3)), String(100 + i)]);
    const profiles = profileColumns(['Data', 'Kaina', 'Suma be PVM'], rows, ',');
    const proposal = suggestMapping(profiles);
    expect(checkAmountConsistency(proposal, profiles, rows)).toBe(proposal);
  });
});

describe('other trading sectors and languages', () => {
  const cases: Record<string, { header: string[]; expect: Record<string, FieldId> }> = {
    'PL building materials': { header: ['Data sprzedaży', 'Nr faktury', 'Kontrahent', 'Symbol towaru', 'Nazwa towaru', 'Ilość', 'Cena sprzedaży netto', 'Wartość netto', 'VAT', 'Wartość brutto', 'Waluta'], expect: { 'Data sprzedaży': 'document_date', 'Nr faktury': 'document_id', 'Wartość netto': 'net_amount', VAT: 'vat_amount', 'Wartość brutto': 'gross_amount', Waluta: 'currency', 'Ilość': 'quantity' } },
    'EN industrial goods': { header: ['Invoice date', 'Invoice no', 'Customer name', 'Item code', 'Description', 'Qty', 'Net sales', 'VAT amount', 'Gross amount', 'Currency'], expect: { 'Invoice date': 'document_date', 'Net sales': 'net_amount', 'VAT amount': 'vat_amount', 'Gross amount': 'gross_amount', Qty: 'quantity', Currency: 'currency' } },
    'LT spaces': { header: ['Data', 'Dokumento Nr.', 'Klientas', 'Prekės kodas', 'Prekė', 'Kiekis', 'Suma be PVM', 'PVM suma', 'Suma su PVM', 'Valiuta'], expect: { 'Suma be PVM': 'net_amount', 'PVM suma': 'vat_amount', 'Suma su PVM': 'gross_amount', Valiuta: 'currency' } },
  };
  for (const [name, c] of Object.entries(cases)) {
    it(name, async () => {
      const rows = Array.from({ length: 40 }, (_, i) => c.header.map((h) => {
        const k = h.toLowerCase();
        if (/dat/.test(k)) return `2025-04-${String(1 + (i % 27)).padStart(2, '0')}`;
        if (/waluta|valiuta|currency/.test(k)) return 'EUR';
        if (/ilo|qty|kiek/.test(k)) return String(1 + (i % 5));
        if (/brutto|gross|su pvm/.test(k)) return String(121 + i);
        if (/vat|pvm suma/.test(k) && !/\b(be|su)\b/.test(k)) return String(21 + i * 0.21).slice(0, 6);
        if (/netto|net|be pvm|cena/.test(k)) return String(100 + i);
        return 'X' + (i % 6);
      }));
      const { a, pv } = await importCsv(mkSession(), c.header, rows as Cell[][]);
      const m = mapOf(a);
      for (const [h, f] of Object.entries(c.expect)) expect(m[h], h).toBe(f);
      expect(pv.stats.rowsImported).toBe(40);
    });
  }
});
