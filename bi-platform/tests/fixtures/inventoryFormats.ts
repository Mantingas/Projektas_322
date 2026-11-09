import iconv from 'iconv-lite';
import type { InventoryField } from '@/engine/types';
import { END, makeInventory, type IMove, type IMoveType, type ISnap } from './inventory';

const csv = (rows: string[][], delim: string) => rows.map((r) => r.map((c) => (/["\n\r]/.test(c) || c.includes(delim) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(delim)).join('\r\n') + '\r\n';
const num = (v: number | undefined, dec: ',' | '.', d = 2) => (v === undefined ? '' : v.toFixed(d).replace('.', dec));
const qtyOut = (v: number, dec: ',' | '.') => String(v).replace('.', dec);

export interface IFixture {
  id: string;
  label: string;
  fileName: string;
  bytes: Uint8Array;
  kind: 'snapshot' | 'valuation' | 'history' | 'movements';
  expectFields: InventoryField[];
  currency: string;
  defaultCurrency?: string;
  /** the file has no date column: the as-of date the user types */
  asOfDate?: string;
  snaps: ISnap[];
  moves: IMove[];
  locale: 'lt' | 'pl' | 'en';
  signedIssues?: boolean;
}

const UNIT = { pcs: 'vnt.', kg: 'kg', g: 'g' } as Record<string, string>;
const UNIT_PL = { pcs: 'szt.', kg: 'kg', g: 'g' } as Record<string, string>;

const TYPE: Record<'lt' | 'pl' | 'en', Record<IMoveType, string>> = {
  lt: { receipt: 'Pajamavimas', issue: 'Išrašymas', transfer_out: 'Perkėlimas iš sandėlio', transfer_in: 'Perkėlimas į sandėlį', transfer_single: 'Perkėlimas tarp sandėlių', return_in: 'Grąžinimas iš pirkėjo', return_out: 'Grąžinimas tiekėjui', adjustment: 'Nurašymas' },
  pl: { receipt: 'Przyjęcie', issue: 'Wydanie', transfer_out: 'Przesunięcie wydanie', transfer_in: 'Przesunięcie przyjęcie', transfer_single: 'Przesunięcie międzymagazynowe', return_in: 'Zwrot od klienta', return_out: 'Zwrot do dostawcy', adjustment: 'Spisanie' },
  en: { receipt: 'Goods receipt', issue: 'Goods issue', transfer_out: 'Transfer out', transfer_in: 'Transfer in', transfer_single: 'Stock transfer', return_in: 'Customer return', return_out: 'Supplier return', adjustment: 'Write-off' },
};
const sign = (t: IMoveType) => (t === 'receipt' || t === 'return_in' || t === 'transfer_in' ? 1 : -1);

export async function buildInventoryFixtures(): Promise<IFixture[]> {
  const lt = makeInventory('lt');
  const pl = makeInventory('pl');
  const out: IFixture[] = [];

  // 1. LT CSV UTF-8: HISTORICAL snapshots (5 dates, 2 warehouses) with cost, value and minimum stock
  out.push({
    id: 'lt-snapshot-history', label: 'LT CSV – historical snapshots', fileName: 'likuciai_istorija.csv', kind: 'history', currency: 'EUR', defaultCurrency: 'EUR', locale: 'lt', snaps: lt.snaps, moves: [],
    bytes: new TextEncoder().encode('﻿' + csv([['Likučio data', 'Sandėlis', 'Prekės kodas', 'Prekė', 'Prekių grupė', 'Likutis', 'Matavimo vnt.', 'Vieneto savikaina', 'Likučio vertė', 'Minimalus likutis'],
      ...lt.snaps.map((s) => [s.date, s.wh, s.sku, s.product, s.category, qtyOut(s.qty, ','), UNIT[s.unit] ?? s.unit, num(s.cost, ',', 4), num(s.value, ','), num(s.min, ',', 0)])], ';')),
    expectFields: ['snapshot_date', 'warehouse', 'product_id', 'product_name', 'product_category', 'quantity', 'unit', 'unit_cost', 'stock_value', 'min_stock'],
  });

  // 2. LT CSV UTF-8: MOVEMENTS, issues written as POSITIVE quantities; transfers as two legs and as one line with a destination
  out.push({
    id: 'lt-movements', label: 'LT CSV – movements (unsigned)', fileName: 'judejimai.csv', kind: 'movements', currency: 'EUR', defaultCurrency: 'EUR', locale: 'lt', snaps: [], moves: lt.moves,
    bytes: new TextEncoder().encode('﻿' + csv([['Data', 'Dokumento Nr.', 'Judėjimo tipas', 'Sandėlis', 'Į sandėlį', 'Prekės kodas', 'Prekė', 'Kiekis', 'Matavimo vnt.', 'Vieneto savikaina'],
      ...lt.moves.map((m) => [m.date, m.doc, TYPE.lt[m.type], m.wh, m.whTo ?? '', m.sku, m.product, qtyOut(m.qty, ','), UNIT[m.unit] ?? m.unit, num(m.cost, ',', 4)])], ';')),
    expectFields: ['movement_date', 'document_id', 'movement_type', 'warehouse', 'warehouse_to', 'product_id', 'product_name', 'quantity', 'unit', 'unit_cost'],
  });

  // 3. PL CSV Windows-1250: ONE valuation snapshot ("Stan na dzień" column)
  const plEnd = pl.snaps.filter((s) => s.date === END);
  out.push({
    id: 'pl-valuation-1250', label: 'PL CSV 1250 – valuation report', fileName: 'wycena_zapasow.csv', kind: 'valuation', currency: 'PLN', defaultCurrency: 'PLN', locale: 'pl', snaps: plEnd, moves: [],
    bytes: new Uint8Array(iconv.encode(csv([['Stan na dzień', 'Magazyn', 'Kod towaru', 'Nazwa towaru', 'Grupa towarowa', 'Stan', 'J.m.', 'Cena ewidencyjna', 'Wartość stanu'],
      ...plEnd.map((s) => [s.date.split('-').reverse().join('.'), s.wh, s.sku, s.product, s.category, qtyOut(s.qty, ','), UNIT_PL[s.unit] ?? s.unit, num(s.cost, ',', 4), num(s.value, ',')])], ';'), 'win1250')),
    expectFields: ['snapshot_date', 'warehouse', 'product_id', 'product_name', 'product_category', 'quantity', 'unit', 'unit_cost', 'stock_value'],
  });

  // 4. EN CSV: movements with SIGNED quantities (issues negative)
  out.push({
    id: 'en-movements-signed', label: 'EN CSV – movements (signed)', fileName: 'stock_movements.csv', kind: 'movements', currency: 'EUR', defaultCurrency: 'EUR', locale: 'en', signedIssues: true, snaps: [], moves: lt.moves,
    bytes: new TextEncoder().encode(csv([['Posting date', 'Document no', 'Movement type', 'Warehouse', 'To warehouse', 'Item code', 'Item name', 'Quantity', 'UoM', 'Unit cost'],
      ...lt.moves.map((m) => [m.date, m.doc, TYPE.en[m.type], m.wh, m.whTo ?? '', m.sku, m.product, String(m.type === 'transfer_single' ? -m.qty : sign(m.type) * m.qty), m.unit, num(m.cost, '.', 4)])], ',')),
    expectFields: ['movement_date', 'document_id', 'movement_type', 'warehouse', 'warehouse_to', 'product_id', 'product_name', 'quantity', 'unit', 'unit_cost'],
  });

  // 5. LT CSV: a balance WITHOUT a date column and WITHOUT costs (the user types the as-of date)
  const ltEnd = lt.snaps.filter((s) => s.date === END);
  out.push({
    id: 'lt-snapshot-nodate', label: 'LT CSV – balance without date or cost', fileName: 'likuciai.csv', kind: 'snapshot', currency: 'EUR', defaultCurrency: 'EUR', asOfDate: END, locale: 'lt', snaps: ltEnd, moves: [],
    bytes: new TextEncoder().encode('﻿' + csv([['Sandėlis', 'Prekės kodas', 'Prekė', 'Likutis', 'Matavimo vnt.', 'Minimalus likutis'],
      ...ltEnd.map((s) => [s.wh, s.sku, s.product, qtyOut(s.qty, ','), UNIT[s.unit] ?? s.unit, num(s.min, ',', 0)])], ';')),
    expectFields: ['warehouse', 'product_id', 'product_name', 'quantity', 'unit', 'min_stock'],
  });
  return out;
}
