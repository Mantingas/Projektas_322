import ExcelJS from 'exceljs';
import iconv from 'iconv-lite';
import type { SalesField } from '@/engine/types';
import { makeTruth, type TruthLine } from './truth';

const NBSP = ' ';

export type NumStyle = 'lt' | 'ltplain' | 'en' | 'dot' | 'eurSuffix';
export function fmtMoney(cents: number, style: NumStyle): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const w = String(whole);
  const group = (sep: string) => w.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  let s: string;
  if (style === 'lt') s = `${group(NBSP)},${frac}`;
  else if (style === 'ltplain') s = `${w},${frac}`;
  else if (style === 'en') s = `${group(',')}.${frac}`;
  else if (style === 'dot') s = `${w}.${frac}`;
  else s = `${group(' ')},${frac} €`;
  return neg ? '-' + s : s;
}

export type DateStyle = 'iso' | 'dmy.' | 'dmy/' | 'ymd.';
export function fmtDate(iso: string, style: DateStyle): string {
  const [y, m, d] = iso.split('-') as [string, string, string];
  if (style === 'iso') return iso;
  if (style === 'dmy.') return `${d}.${m}.${y}`;
  if (style === 'dmy/') return `${d}/${m}/${y}`;
  return `${y}.${m}.${d}`;
}

function csv(rows: string[][], delim: string): string {
  const q = (c: string) => (/["\n\r]/.test(c) || c.includes(delim) ? '"' + c.replace(/"/g, '""') + '"' : c);
  return rows.map((r) => r.map(q).join(delim)).join('\r\n') + '\r\n';
}

export interface Fixture {
  id: string;
  label: string;
  fileName: string;
  bytes: Uint8Array;
  truth: TruthLine[];
  /** Fields the engine must propose without manual correction. */
  expectFields: SalesField[];
  expectBasis: 'net' | 'gross' | 'unknown';
  /** What the user would confirm when the file has no currency column. */
  defaultCurrency?: string;
  expectCurrency: string;
  expectCost?: boolean;
  /** Sheet to analyse (defaults to the first). */
  sheet?: string;
  /** Number of title / junk rows above the header row. */
  expectHeaderRow?: number;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

async function xlsx(build: (wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

const utcDate = (iso: string) => new Date(iso + 'T00:00:00Z');
const serial = (iso: string) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000);

export async function buildFixtures(): Promise<Fixture[]> {
  const lt = makeTruth('lt');
  const pl = makeTruth('pl');
  const out: Fixture[] = [];

  // 1. LT CSV, UTF-8, ';' delimiter, nbsp thousands, ISO dates, net amounts, no currency column
  out.push({
    id: 'lt-csv-utf8', label: 'LT CSV UTF-8 (;)', fileName: 'pardavimai_2025.csv', truth: lt,
    bytes: utf8('﻿' + csv([['Data', 'Dokumento Nr.', 'Klientas', 'Prekės kodas', 'Prekė', 'Kiekis', 'Suma be PVM', 'Pardavėjas'],
      ...lt.map((t) => [t.date, t.doc, t.customer, t.sku, t.product, String(t.qty), fmtMoney(t.net, 'lt'), t.person])], ';')),
    expectFields: ['document_date', 'document_id', 'customer_name', 'product_id', 'product_name', 'quantity', 'net_amount', 'salesperson'],
    expectBasis: 'net', defaultCurrency: 'EUR', expectCurrency: 'EUR',
  });

  // 2. LT CSV Windows-1257, dd.mm.yyyy, plain comma decimals, currency column, net + VAT
  out.push({
    id: 'lt-csv-1257', label: 'LT CSV Windows-1257', fileName: 'saskaitos_spalis.csv', truth: lt,
    bytes: new Uint8Array(iconv.encode(csv([['Dok. data', 'Sąskaitos Nr.', 'Pirkėjas', 'Prekė', 'Kiekis', 'Vertė be PVM', 'PVM', 'Valiuta', 'Vadybininkas'],
      ...lt.map((t) => [fmtDate(t.date, 'dmy.'), t.doc, t.customer, t.product, String(t.qty), fmtMoney(t.net, 'ltplain'), fmtMoney(t.vat, 'ltplain'), 'EUR', t.person])], ';'), 'win1257')),
    expectFields: ['document_date', 'document_id', 'customer_name', 'product_name', 'quantity', 'net_amount', 'vat_amount', 'currency', 'salesperson'],
    expectBasis: 'net', expectCurrency: 'EUR',
  });

  // 3. PL CSV Windows-1250, dd.mm.yyyy, nbsp thousands
  out.push({
    id: 'pl-csv-1250', label: 'PL CSV Windows-1250', fileName: 'sprzedaz_pozycje.csv', truth: pl,
    bytes: new Uint8Array(iconv.encode(csv([['Data sprzedaży', 'Numer faktury', 'Kontrahent', 'Kod towaru', 'Nazwa towaru', 'Ilość', 'Wartość netto', 'Waluta', 'Handlowiec'],
      ...pl.map((t) => [fmtDate(t.date, 'dmy.'), t.doc, t.customer, t.sku, t.product, String(t.qty), fmtMoney(t.net, 'lt'), 'PLN', t.person])], ';'), 'win1250')),
    expectFields: ['document_date', 'document_id', 'customer_name', 'product_id', 'product_name', 'quantity', 'net_amount', 'currency', 'salesperson'],
    expectBasis: 'net', expectCurrency: 'PLN',
  });

  // 4. PL CSV UTF-8, ',' delimiter, dot decimals, dd/mm/yyyy, net AND gross columns
  out.push({
    id: 'pl-csv-comma', label: 'PL CSV UTF-8 (,) net+gross', fileName: 'faktury_export.csv', truth: pl,
    bytes: utf8(csv([['Data wystawienia', 'Nr dokumentu', 'Nabywca', 'Towar', 'Ilość', 'Netto', 'Brutto'],
      ...pl.map((t) => [fmtDate(t.date, 'dmy/'), t.doc, t.customer, t.product, String(t.qty), fmtMoney(t.net, 'dot'), fmtMoney(t.net + t.vat, 'dot')])], ',')),
    expectFields: ['document_date', 'document_id', 'customer_name', 'product_name', 'quantity', 'net_amount', 'gross_amount'],
    expectBasis: 'net', defaultCurrency: 'PLN', expectCurrency: 'PLN',
  });

  // 5. EN CSV, comma delimiter, quoted "1,234.56", ISO dates
  out.push({
    id: 'en-csv', label: 'EN CSV (1,234.56)', fileName: 'sales_detail.csv', truth: lt,
    bytes: utf8(csv([['Invoice Date', 'Invoice No', 'Customer', 'SKU', 'Product', 'Qty', 'Net Amount', 'Currency', 'Sales Rep'],
      ...lt.map((t) => [t.date, t.doc, t.customer, t.sku, t.product, String(t.qty), fmtMoney(t.net, 'en'), 'EUR', t.person])], ',')),
    expectFields: ['document_date', 'document_id', 'customer_name', 'product_id', 'product_name', 'quantity', 'net_amount', 'currency', 'salesperson'],
    expectBasis: 'net', expectCurrency: 'EUR',
  });

  // 6. LT XLSX with report title rows, real date cells, numeric cells and a totals row
  out.push({
    id: 'lt-xlsx-title', label: 'LT XLSX + title rows + totals', fileName: 'pardavimu_ataskaita.xlsx', truth: lt,
    bytes: await xlsx((wb) => {
      const ws = wb.addWorksheet('Pardavimai');
      ws.addRow(['UAB Pavyzdys – pardavimų ataskaita']);
      ws.addRow(['Laikotarpis: 2025-09-01 – 2025-12-15']);
      ws.addRow([]);
      ws.addRow(['Data', 'Dokumentas', 'Klientas', 'Prekės kodas', 'Prekės pavadinimas', 'Kiekis', 'Suma be PVM', 'Suma su PVM', 'Savikaina']);
      for (const t of lt) ws.addRow([utcDate(t.date), t.doc, t.customer, t.sku, t.product, t.qty, t.net / 100, (t.net + t.vat) / 100, t.cost / 100]);
      ws.addRow(['Iš viso', null, null, null, null, lt.reduce((a, t) => a + t.qty, 0), lt.reduce((a, t) => a + t.net, 0) / 100, null, null]);
    }),
    expectFields: ['document_date', 'document_id', 'customer_name', 'product_id', 'product_name', 'quantity', 'net_amount', 'gross_amount', 'cost_amount'],
    expectBasis: 'net', defaultCurrency: 'EUR', expectCurrency: 'EUR', expectCost: true, expectHeaderRow: 3,
  });

  // 7. PL XLSX: dates as text, numeric cells, "Razem" totals row, net+gross
  out.push({
    id: 'pl-xlsx', label: 'PL XLSX text dates + Razem', fileName: 'raport_sprzedazy.xlsx', truth: pl,
    bytes: await xlsx((wb) => {
      const ws = wb.addWorksheet('Raport');
      ws.addRow(['Data dokumentu', 'Numer', 'Kontrahent', 'Towar', 'Ilość', 'Wartość netto', 'Wartość brutto', 'Handlowiec']);
      for (const t of pl) ws.addRow([fmtDate(t.date, 'dmy.'), t.doc, t.customer, t.product, t.qty, t.net / 100, (t.net + t.vat) / 100, t.person]);
      ws.addRow(['Razem', null, null, null, null, pl.reduce((a, t) => a + t.net, 0) / 100, null, null]);
    }),
    expectFields: ['document_date', 'document_id', 'customer_name', 'product_name', 'quantity', 'net_amount', 'gross_amount', 'salesperson'],
    expectBasis: 'net', defaultCurrency: 'PLN', expectCurrency: 'PLN',
  });

  // 8. EN XLSX, junk first sheet, cost column
  out.push({
    id: 'en-xlsx-multisheet', label: 'EN XLSX multi-sheet + cost', fileName: 'monthly_pack.xlsx', truth: lt,
    sheet: 'Sales', bytes: await xlsx((wb) => {
      const notes = wb.addWorksheet('Notes');
      notes.addRow(['Prepared by finance']);
      notes.addRow(['Contact', 'finance@example.invalid']);
      const ws = wb.addWorksheet('Sales');
      ws.addRow(['Date', 'Document No', 'Customer', 'Item Code', 'Item', 'Quantity', 'Net sales', 'Cost of sales', 'Currency']);
      for (const t of lt) ws.addRow([utcDate(t.date), t.doc, t.customer, t.sku, t.product, t.qty, t.net / 100, t.cost / 100, 'EUR']);
    }),
    expectFields: ['document_date', 'document_id', 'customer_name', 'product_id', 'product_name', 'quantity', 'net_amount', 'cost_amount', 'currency'],
    expectBasis: 'net', expectCurrency: 'EUR', expectCost: true,
  });

  // 9. LT CSV, amount column "Suma" with € suffix → VAT basis UNKNOWN, currency read from values
  out.push({
    id: 'lt-csv-unknown-basis', label: 'LT CSV "Suma" € (basis unknown)', fileName: 'eksportas.csv', truth: lt,
    bytes: utf8(csv([['Data', 'Dok. Nr.', 'Klientas', 'Preke', 'Kiekis', 'Suma'],
      ...lt.map((t) => [fmtDate(t.date, 'dmy.'), t.doc, t.customer, t.product, String(t.qty), fmtMoney(t.net, 'eurSuffix')])], ';')),
    expectFields: ['document_date', 'document_id', 'customer_name', 'product_name', 'quantity', 'amount_unknown_basis'],
    expectBasis: 'unknown', expectCurrency: 'EUR',
  });

  // 10. PL TSV with BOM, yyyy.mm.dd, unit cost (koszt jednostkowy)
  out.push({
    id: 'pl-tsv', label: 'PL TSV yyyy.mm.dd + unit cost', fileName: 'sprzedaz.txt', truth: pl,
    bytes: utf8('﻿' + csv([['Data', 'Dokument', 'Odbiorca', 'Symbol', 'Nazwa', 'Ilość', 'Netto', 'Koszt jednostkowy'],
      ...pl.map((t) => [fmtDate(t.date, 'ymd.'), t.doc, t.customer, t.sku, t.product, String(t.qty), fmtMoney(t.net, 'ltplain'), t.qty !== 0 ? fmtMoney(Math.round(t.cost / t.qty), 'ltplain') : '0,00'])], '\t')),
    expectFields: ['document_date', 'document_id', 'customer_name', 'product_id', 'product_name', 'quantity', 'net_amount', 'unit_cost'],
    expectBasis: 'net', defaultCurrency: 'PLN', expectCurrency: 'PLN', expectCost: true,
  });

  // 11. PL XLSX with Excel serial dates stored as plain numbers
  out.push({
    id: 'pl-xlsx-serial', label: 'PL XLSX serial dates', fileName: 'obroty.xlsx', truth: pl,
    bytes: await xlsx((wb) => {
      const ws = wb.addWorksheet('Obroty');
      ws.addRow(['Data operacji', 'Kontrahent', 'Towar', 'Ilość', 'Kwota netto', 'Waluta']);
      for (const t of pl) ws.addRow([serial(t.date), t.customer, t.product, t.qty, t.net / 100, 'PLN']);
    }),
    expectFields: ['document_date', 'customer_name', 'product_name', 'quantity', 'net_amount', 'currency'],
    expectBasis: 'net', expectCurrency: 'PLN',
  });

  return out;
}
