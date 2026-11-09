import type { InventoryRecord } from '../types';
import { hash106 } from '../import/hash';

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export const snapshotDocId = (date: string, warehouse: string | undefined) => `snap ${date}${warehouse ? ` ${warehouse.trim()}` : ''}`;

/** Identity of an inventory line, independent of which file it came from. */
export function inventoryBaseKey(r: Omit<InventoryRecord, 'key' | 'sourceRow'>): string {
  return hash106(
    [
      r.kind, r.date, norm(r.documentId), norm(r.productId) || norm(r.productName), norm(r.warehouse), norm(r.warehouseTo), r.movementType ?? '',
      r.quantity ?? '', r.unit ?? '', r.value?.toFixed(4) ?? '', r.unitCost?.toFixed(6) ?? '', r.currency,
    ].join('\u001f'),
  );
}

/** Genuinely identical lines in one file get occurrence numbers, so re-importing the same file yields the same keys. */
export function assignInventoryKeys(records: Omit<InventoryRecord, 'key'>[]): InventoryRecord[] {
  const seen = new Map<string, number>();
  return records.map((r) => {
    const b = inventoryBaseKey(r);
    const n = seen.get(b) ?? 0;
    seen.set(b, n + 1);
    return { ...r, key: `${b}#${n}` };
  });
}
