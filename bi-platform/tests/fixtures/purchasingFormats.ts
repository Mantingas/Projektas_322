import ExcelJS from 'exceljs';
import iconv from 'iconv-lite';
import type { PurchaseField } from '@/engine/types';
import { fmtDate, fmtMoney } from './formats';
import { makePurchasing, type PLine } from './purchasing';

const utc = (iso: string) => new Date(iso + 'T00:00:00Z');
const csv = (rows: string[][], delim: string) => rows.map((r) => r.map((c) => (/["\n\r]/.test(c) || c.includes(delim) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(delim)).join('\r\n') + '\r\n';
const num = (v: number, dec: ',' | '.', d = 2) => v.toFixed(d).replace('.', dec);

export interface PFixture {
  id: string;
  label: string;
  fileName: string;
  bytes: Uint8Array;
  truth: PLine[];
  expectFields: PurchaseField[];
  expectBasis: 'net' | 'gross' | 'unknown';
  currency: string;
  defaultCurrency?: string;
  sheet?: string;
  hasUnits: boolean;
  hasSku: boolean;
  /** Credit notes are exported with POSITIVE amounts plus a document-type column. */
  creditsByType?: boolean;
  /** Discounts are exported as a separate column. */
  hasDiscount?: boolean;
}

async function xlsx(build: (wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
const unitOut = { 'dėž.': 'dėž.', pcs: 'vnt.', l: 'l', kg: 'kg', g: 'g' } as Record<string, string>;

export async function buildPurchasingFixtures(): Promise<PFixture[]> {
  const lt = makePurchasing('lt');
  const pl = makePurchasing('pl');
  const out: PFixture[] = [];

  // 1. LT CSV UTF-8 ';' – supplier code, SKU, unit, unit price, net amount, warehouse; credit notes as NEGATIVE amounts
  out.push({
    id: 'lt-csv-utf8', label: 'LT CSV UTF-8', fileName: 'pirkimai_2025.csv', truth: lt, hasUnits: true, hasSku: true, expectBasis: 'net', currency: 'EUR', defaultCurrency: 'EUR',
    bytes: new TextEncoder().encode('﻿' + csv([['Data', 'Tiekėjo sąskaitos Nr.', 'Tiekėjas', 'Tiekėjo kodas', 'Prekės kodas', 'Prekė', 'Kiekis', 'Matavimo vnt.', 'Kaina', 'Suma be PVM', 'Sandėlis'],
      ...lt.map((t) => [t.date, t.doc, t.supplier, t.supplierId, t.sku, t.product, String(t.qty).replace('.', ','), unitOut[t.unit] ?? t.unit, num(t.price, ',', 4), fmtMoney(t.net, 'lt'), t.warehouse])], ';')),
    expectFields: ['document_date', 'document_id', 'supplier_name', 'supplier_id', 'product_id', 'product_name', 'quantity', 'unit', 'unit_price', 'net_amount', 'warehouse'],
  });

  // 2. LT CSV Windows-1257, dd.mm.yyyy, net + gross, currency, credit notes with POSITIVE amounts and "Dokumento tipas"
  out.push({
    id: 'lt-csv-1257-credit-type', label: 'LT CSV 1257, credits by type', fileName: 'tiekeju_saskaitos.csv', truth: lt, hasUnits: true, hasSku: false, expectBasis: 'net', currency: 'EUR', creditsByType: true,
    bytes: new Uint8Array(iconv.encode(csv([['Pirkimo data', 'Dokumento Nr.', 'Pardavėjas', 'Prekė', 'Kiekis', 'Mato vnt.', 'Kaina be PVM', 'Pirkimo suma be PVM', 'Pirkimo suma su PVM', 'Valiuta', 'Dokumento tipas'],
      ...lt.map((t) => [fmtDate(t.date, 'dmy.'), t.doc, t.supplier, t.product, String(t.qty).replace('.', ','), unitOut[t.unit] ?? t.unit, num(t.price, ',', 4), fmtMoney(Math.abs(t.net), 'ltplain'), fmtMoney(Math.abs(Math.round(t.net * 1.21)), 'ltplain'), 'EUR', t.credit ? 'Kreditinė sąskaita' : 'Pirkimo sąskaita'])], ';'), 'win1257')),
    expectFields: ['document_date', 'document_id', 'supplier_name', 'product_name', 'quantity', 'unit', 'unit_price', 'net_amount', 'gross_amount', 'currency', 'document_type'],
  });

  // 3. PL CSV Windows-1250: supplier, SKU, JM, net price, net value, warehouse, currency PLN
  out.push({
    id: 'pl-csv-1250', label: 'PL CSV 1250', fileName: 'zakupy_pozycje.csv', truth: pl, hasUnits: true, hasSku: true, expectBasis: 'net', currency: 'PLN',
    bytes: new Uint8Array(iconv.encode(csv([['Data zakupu', 'Numer faktury zakupu', 'Dostawca', 'Kod towaru', 'Nazwa towaru', 'Ilość', 'JM', 'Cena zakupu netto', 'Wartość netto', 'Magazyn', 'Waluta'],
      ...pl.map((t) => [fmtDate(t.date, 'dmy.'), t.doc, t.supplier, t.sku, t.product, String(t.qty).replace('.', ','), t.unit === 'pcs' ? 'szt' : t.unit === 'dėž.' ? 'karton' : t.unit, num(t.price, ',', 4), fmtMoney(t.net, 'lt'), t.warehouse, 'PLN'])], ';'), 'win1250')),
    expectFields: ['document_date', 'document_id', 'supplier_name', 'product_id', 'product_name', 'quantity', 'unit', 'unit_price', 'net_amount', 'warehouse', 'currency'],
  });

  // 4. EN XLSX with title rows and a totals row; real date cells; credits negative
  out.push({
    id: 'en-xlsx-title', label: 'EN XLSX + title + totals', fileName: 'purchase_ledger.xlsx', truth: lt, hasUnits: true, hasSku: true, expectBasis: 'net', currency: 'EUR', defaultCurrency: 'EUR',
    bytes: await xlsx((wb) => {
      const ws = wb.addWorksheet('Purchases');
      ws.addRow(['Purchase ledger – Example Ltd']);
      ws.addRow(['Period 2025-09-01 – 2025-12-15']);
      ws.addRow([]);
      ws.addRow(['Purchase Date', 'Supplier Invoice No', 'Supplier', 'Item Code', 'Item', 'Qty', 'UoM', 'Unit Price', 'Net Amount']);
      for (const t of lt) ws.addRow([utc(t.date), t.doc, t.supplier, t.sku, t.product, t.qty, unitOut[t.unit] ?? t.unit, t.price, t.net / 100]);
      ws.addRow(['Total', null, null, null, null, null, null, null, lt.reduce((s, t) => s + t.net, 0) / 100]);
    }),
    expectFields: ['document_date', 'document_id', 'supplier_name', 'product_id', 'product_name', 'quantity', 'unit', 'unit_price', 'net_amount'],
  });

  // 5. EN CSV, comma-delimited, NO unit column, NO SKU, "Amount" (VAT status unknown), names only
  out.push({
    id: 'en-csv-names-only', label: 'EN CSV names only, no units', fileName: 'vendor_bills.csv', truth: lt, hasUnits: false, hasSku: false, expectBasis: 'unknown', currency: 'EUR', defaultCurrency: 'EUR',
    bytes: new TextEncoder().encode(csv([['Date', 'Vendor', 'Product', 'Quantity', 'Amount'],
      ...lt.map((t) => [t.date, t.supplier, t.product, String(t.qty), fmtMoney(t.net, 'en')])], ',')),
    expectFields: ['document_date', 'supplier_name', 'product_name', 'quantity', 'amount_unknown_basis'],
  });

  // 6. PL CSV UTF-8, discount column: amount ALREADY net of the discount (kwota = ilość × cena − rabat)
  out.push({
    id: 'pl-csv-discount-included', label: 'PL CSV discount (included)', fileName: 'zakupy_rabat.csv', truth: pl, hasUnits: true, hasSku: true, hasDiscount: true, expectBasis: 'net', currency: 'PLN', defaultCurrency: 'PLN',
    bytes: new TextEncoder().encode('﻿' + csv([['Data', 'Dostawca', 'Kod', 'Towar', 'Ilość', 'JM', 'Cena', 'Rabat', 'Kwota netto'],
      ...pl.map((t) => [fmtDate(t.date, 'ymd.'), t.supplier, t.sku, t.product, String(t.qty).replace('.', ','), t.unit === 'pcs' ? 'szt' : t.unit === 'dėž.' ? 'karton' : t.unit, num(t.price, ',', 4), fmtMoney(t.discount, 'ltplain'), fmtMoney(t.net, 'ltplain')])], ';')),
    expectFields: ['document_date', 'supplier_name', 'product_id', 'product_name', 'quantity', 'unit', 'unit_price', 'discount_amount', 'net_amount'],
  });

  // 7. PL CSV, discount column but the amount is BEFORE the discount (amount = qty × price)
  out.push({
    id: 'pl-csv-discount-before', label: 'PL CSV discount (before)', fileName: 'zakupy_rabat_przed.csv', truth: pl, hasUnits: true, hasSku: true, hasDiscount: true, expectBasis: 'net', currency: 'PLN', defaultCurrency: 'PLN',
    bytes: new TextEncoder().encode('﻿' + csv([['Data', 'Dostawca', 'Kod', 'Towar', 'Ilość', 'JM', 'Cena', 'Rabat', 'Kwota netto'],
      ...pl.map((t) => [fmtDate(t.date, 'ymd.'), t.supplier, t.sku, t.product, String(t.qty).replace('.', ','), t.unit === 'pcs' ? 'szt' : t.unit === 'dėž.' ? 'karton' : t.unit, num(t.price, ',', 4), fmtMoney(t.discount, 'ltplain'), fmtMoney(t.net + t.discount, 'ltplain')])], ';')),
    expectFields: ['document_date', 'supplier_name', 'product_id', 'product_name', 'quantity', 'unit', 'unit_price', 'discount_amount', 'net_amount'],
  });
  return out;
}
