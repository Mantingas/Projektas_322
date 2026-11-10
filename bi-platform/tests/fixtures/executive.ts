/**
 * One small company across all four modules, with PLANTED cross-module situations (the expected values are computed here by plain arithmetic,
 * never by the engine):
 *   P01 Widget   – sold 1/day, only 8 on hand (cover 8 days → LOW) · unit cost 10 → 11 while the price stays 20 (margin 50 % → 45 %)
 *   P02 Gadget   – sold 1 per 10 days, 100 on hand worth 2 000 (cover 1 000 days → EXCESS) while purchases continue (20 months of purchasing in stock)
 *   P03 Gizmo    – normal: 2/day, 120 on hand (cover 60 days)
 *   Sprocket     – the same NAME in sales and stock, but no shared code: must never be linked automatically
 *   Customers    – C06 buys about 35 % of net sales and has a large overdue balance (finance fixture); C01 buys 5 % with a small one
 */
import type { FinanceRecord, InventoryRecord, PurchaseRecord, SalesRecord } from '@/engine/types';
import { financeData } from './financeRecords';
import { END } from './finance';
import { AppDB, type ImportRow } from '@/db/db';
import type { EntityLink } from '@/engine/entities/links';

export const SALES_START = '2025-07-01';
export const INV_DATE = END; // 2025-12-15
const add = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const days = (from: string, to: string) => { const o: string[] = []; for (let d = from; d <= to; d = add(d, 1)) o.push(d); return o; };

const CUSTOMERS = [['C06', 'UAB Žalioji dirbtuvė'], ['C01', 'UAB Alfa prekyba'], ['C02', 'UAB Beta grupė'], ['C03', 'AB Gama pienas'], ['C04', 'MB Delta paslaugos'], ['C05', 'UAB Epsilon'], ['C07', 'UAB Eta logistika'], ['C08', 'UAB Teta statyba'], ['C09', 'AB Jota maistas'], ['C10', 'UAB Kapa transportas']] as const;
const pickCustomer = (i: number) => (i % 20 < 7 ? CUSTOMERS[0] : i % 20 === 7 ? CUSTOMERS[1] : CUSTOMERS[2 + (i % 20 - 8) % 8]!);

export interface ExecOptions { salesCurrency?: string; salesBasis?: 'net' | 'gross'; inventoryDate?: string; purchaseCurrency?: string }

export function makeExecutive(o: ExecOptions = {}) {
  const sCur = o.salesCurrency ?? 'EUR', sBasis = o.salesBasis ?? 'net';
  let n = 0;
  const sales: SalesRecord[] = [];
  for (const d of days(SALES_START, END)) {
    const i = n++;
    const line = (code: string, name: string, qty: number, price: number, k: number) => {
      const c = pickCustomer(i * 4 + k);
      sales.push({ key: `s${i}-${code}`, date: d, documentId: `SF-${i}-${code}`, customerId: c[0], customerName: c[1], productId: code === 'SP' ? undefined : code, productName: name, quantity: qty, amount: qty * price, basis: sBasis, currency: sCur, sourceRow: 2 + i });
    };
    line('P01', 'Widget', 1, 20, 0);
    if (i % 10 === 0) line('P02', 'Gadget', 1, 15, 1);
    line('P03', 'Gizmo', 2, 5, 2);
    line('SP', 'Sprocket', 1, 8, 3);
  }
  const pCur = o.purchaseCurrency ?? 'EUR';
  const buy = (code: string, name: string, date: string, qty: number, cost: number): PurchaseRecord => ({ key: `p-${code}-${date}`, date, documentId: `PI-${code}-${date}`, supplierId: 'S01', supplierName: 'UAB Tiekėjas Vienas', productId: code, productName: name, quantity: qty, unit: 'pcs', unitPrice: cost, amount: qty * cost, basis: 'net', currency: pCur, sourceRow: 2 });
  const purchases: PurchaseRecord[] = [
    buy('P01', 'Widget', '2025-07-10', 30, 10), buy('P01', 'Widget', '2025-08-10', 30, 10), buy('P01', 'Widget', '2025-10-10', 30, 11), buy('P01', 'Widget', '2025-11-10', 30, 11),
    buy('P02', 'Gadget', '2025-09-20', 5, 20), buy('P02', 'Gadget', '2025-10-25', 5, 20), buy('P02', 'Gadget', '2025-12-05', 5, 20),
    buy('P03', 'Gizmo', '2025-10-05', 60, 2), buy('P03', 'Gizmo', '2025-11-05', 60, 2),
  ];
  const invDate = o.inventoryDate ?? INV_DATE;
  const snap = (code: string | undefined, name: string, qty: number, cost: number): InventoryRecord => ({ key: `i-${code ?? name}`, kind: 'snapshot', date: invDate, documentId: `snap ${invDate} main`, productId: code, productName: name, warehouse: 'Main', quantity: qty, unit: 'pcs', unitCost: cost, value: qty * cost, basis: 'net', currency: 'EUR', sourceRow: 2 });
  const inventory: InventoryRecord[] = [snap('P01', 'Widget', 8, 10), snap('P02', 'Gadget', 100, 20), snap('P03', 'Gizmo', 120, 5), snap(undefined, 'Sprocket', 5, 4)];
  const ar = financeData('receivable');
  const ap = financeData('payable', 'en');
  const finance: FinanceRecord[] = [...ar.records, ...ap.records];
  return { sales, purchases, inventory, finance, ar, ap };
}

/** the links a user would confirm after seeing the proposals */
export const link = (kind: 'product' | 'counterparty', a: [string, string, string], b: [string, string, string], status: EntityLink['status'] = 'confirmed', basis: EntityLink['basis'] = 'identifier_equal'): EntityLink => ({
  id: `${kind}:${a[0]}-${b[0]}:${a[1]}`, kind, a: { module: a[0] as never, key: a[1], label: a[2] }, b: { module: b[0] as never, key: b[1], label: b[2] }, basis, status, evidence: 'test',
});
export const productLinks = (status: EntityLink['status'] = 'confirmed'): EntityLink[] => [['P01', 'Widget'], ['P02', 'Gadget'], ['P03', 'Gizmo']].flatMap(([c, nm]) => {
  const k = `sku:${c!.toLowerCase()}`;
  return [link('product', ['sales', k, nm!], ['inventory', k, nm!], status), link('product', ['purchasing', k, nm!], ['sales', k, nm!], status), link('product', ['inventory', k, nm!], ['purchasing', k, nm!], status)];
});
export const customerLink = (status: EntityLink['status'] = 'confirmed'): EntityLink => link('counterparty', ['sales', 'cp:c06', 'UAB Žalioji dirbtuvė'], ['finance', 'cp:c06', 'UAB Žalioji dirbtuvė'], status);

// ───────── a database holding the fixture, as imports would have left it ─────────
export async function seedDb(db: AppDB, d: ReturnType<typeof makeExecutive>, links: EntityLink[] = [], at = Date.parse('2025-12-16T10:00:00Z')) {
  const row = (id: string, module: ImportRow['module'], fileName: string, count: number, extra: Partial<ImportRow> = {}): ImportRow => ({ id, module, checksum: id, fileName, sheetName: 'S', importedAt: at, exportMode: 'full', stats: { rowsRead: count, rowsImported: count, rowsSkipped: 0, errors: {}, warnings: {}, examples: [], currencies: ['EUR'] }, added: count, duplicates: 0, conflicts: 0, revisedDocs: 0, supersededLines: 0, staleLines: 0, identity: 'document', idCoverage: 1, mapping: { columns: {} }, ...extra });
  await db.imports.bulkAdd([row('imp_s', undefined, 'sales.csv', d.sales.length), row('imp_p', 'purchasing', 'purchases.csv', d.purchases.length), row('imp_i', 'inventory', 'stock.csv', d.inventory.length, { inventoryKind: 'snapshot' }), row('imp_f', 'finance', 'debts.csv', d.finance.length, { financeKind: 'open_items' })]);
  await db.sales.bulkAdd(d.sales.map((r) => ({ ...r, importId: 'imp_s', docKey: r.key })) as never);
  await db.purchases.bulkAdd(d.purchases.map((r) => ({ ...r, importId: 'imp_p', docKey: r.key })) as never);
  await db.inventory.bulkAdd(d.inventory.map((r) => ({ ...r, importId: 'imp_i', docKey: r.key })) as never);
  await db.finance.bulkAdd(d.finance.map((r) => ({ ...r, importId: 'imp_f', docKey: r.key })) as never);
  if (links.length) await db.links.bulkAdd(links.map((l) => ({ id: l.id, kind: l.kind, a: l.a, b: l.b, basis: l.basis, status: l.status as 'confirmed' | 'rejected', evidence: l.evidence, decidedAt: 1 })));
}

/** the same data as plain rows for the browser tests (IndexedDB stores) */
export function seedPayload(d: ReturnType<typeof makeExecutive>, links: EntityLink[] = [], at = Date.parse('2025-12-16T10:00:00Z')) {
  const row = (id: string, module: ImportRow['module'], fileName: string, count: number, extra: Partial<ImportRow> = {}): ImportRow => ({ id, module, checksum: id, fileName, sheetName: 'S', importedAt: at, exportMode: 'full', stats: { rowsRead: count, rowsImported: count, rowsSkipped: 0, errors: {}, warnings: {}, examples: [], currencies: ['EUR'] }, added: count, duplicates: 0, conflicts: 0, revisedDocs: 0, supersededLines: 0, staleLines: 0, identity: 'document', idCoverage: 1, mapping: { columns: {} }, ...extra });
  return {
    imports: [row('imp_s', undefined, 'sales.csv', d.sales.length), row('imp_p', 'purchasing', 'purchases.csv', d.purchases.length), row('imp_i', 'inventory', 'stock.csv', d.inventory.length, { inventoryKind: 'snapshot' }), row('imp_f', 'finance', 'debts.csv', d.finance.length, { financeKind: 'open_items' })],
    sales: d.sales.map((r) => ({ ...r, importId: 'imp_s', docKey: r.key })), purchases: d.purchases.map((r) => ({ ...r, importId: 'imp_p', docKey: r.key })),
    inventory: d.inventory.map((r) => ({ ...r, importId: 'imp_i', docKey: r.key })), finance: d.finance.map((r) => ({ ...r, importId: 'imp_f', docKey: r.key })),
    links: links.map((l) => ({ id: l.id, kind: l.kind, a: l.a, b: l.b, basis: l.basis, status: l.status, evidence: l.evidence, decidedAt: 1 })),
  };
}
