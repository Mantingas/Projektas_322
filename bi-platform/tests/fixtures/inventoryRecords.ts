import type { InventoryRecord, MovementType } from '@/engine/types';
import { assignInventoryKeys, snapshotDocId } from '@/engine/inventory/keys';
import { makeInventory, type ILocale, type IMove, type ISnap } from './inventory';

const MT: Record<IMove['type'], MovementType> = { receipt: 'receipt', issue: 'issue', transfer_out: 'transfer', transfer_in: 'transfer', transfer_single: 'transfer', return_in: 'return', return_out: 'return', adjustment: 'adjustment' };
const dir = (t: IMove['type']) => (t === 'receipt' || t === 'return_in' || t === 'transfer_in' ? 1 : -1);

/** Truth rows → stored-record shape (what the importer would have produced), without going through a file. */
export function toRecords(snaps: ISnap[], moves: IMove[], currency = 'EUR', importId = 'imp_a'): InventoryRecord[] {
  const s = snaps.map((x): Omit<InventoryRecord, 'key'> => ({
    kind: 'snapshot', date: x.date, documentId: snapshotDocId(x.date, x.wh), productId: x.sku, productName: x.product, category: x.category, warehouse: x.wh, quantity: x.qty, unit: x.unit,
    unitCost: x.cost, value: x.value, minStock: x.min, basis: 'net', currency, sourceRow: 2, importId,
  }));
  const m = moves.map((x, i): Omit<InventoryRecord, 'key'> => ({
    kind: 'movement', date: x.date, documentId: x.doc, productId: x.sku, productName: x.product, warehouse: x.wh, warehouseTo: x.whTo, quantity: dir(x.type) * x.qty, unit: x.unit, unitCost: x.cost,
    movementType: MT[x.type], basis: 'net', currency, sourceRow: 2 + i, importId,
  }));
  return assignInventoryKeys([...s, ...m]);
}

export function inventoryData(locale: ILocale = 'lt') {
  const t = makeInventory(locale);
  return { ...t, records: toRecords(t.snaps, t.moves, locale === 'lt' ? 'EUR' : 'PLN') };
}
