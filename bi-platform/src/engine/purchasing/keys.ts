import type { PurchaseRecord } from '../types';
import { hash106 } from '../import/hash';

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Supplier identity used for scoping document numbers: supplier invoice numbers are only unique PER SUPPLIER. */
export const supplierScope = (r: Pick<PurchaseRecord, 'supplierId' | 'supplierName'>) => norm(r.supplierId) || norm(r.supplierName) || undefined;

/** Identity of a purchase line, independent of which file it came from. */
export function purchaseBaseKey(r: Omit<PurchaseRecord, 'key' | 'sourceRow'>): string {
  return hash106(
    [
      r.date, norm(r.documentId), supplierScope(r) ?? '', norm(r.productId) || norm(r.productName), r.quantity ?? '', r.unit ?? '',
      r.amount.toFixed(4), r.basis, r.currency, norm(r.warehouse),
    ].join('\u001f'),
  );
}

/** Genuinely identical lines in one file get occurrence numbers, so re-importing the same file yields the same keys. */
export function assignPurchaseKeys(records: Omit<PurchaseRecord, 'key'>[]): PurchaseRecord[] {
  const seen = new Map<string, number>();
  return records.map((r) => {
    const b = purchaseBaseKey(r);
    const n = seen.get(b) ?? 0;
    seen.set(b, n + 1);
    return { ...r, key: `${b}#${n}` };
  });
}
