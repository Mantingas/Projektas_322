import type { SalesRecord } from '../types';
import { hash106 } from './hash';

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Identity of a transaction line, independent of which file it came from. */
export function baseKey(r: Omit<SalesRecord, 'key' | 'sourceRow'>): string {
  return hash106(
    [
      r.date,
      norm(r.documentId),
      norm(r.customerId) || norm(r.customerName),
      norm(r.productId) || norm(r.productName),
      r.quantity ?? '',
      r.amount.toFixed(4),
      r.basis,
      r.currency,
    ].join('\u001f'),
  );
}

/**
 * Two genuinely identical lines in the same file get occurrence numbers #0, #1…,
 * so re-importing the same file yields the same set of keys and nothing is counted twice.
 */
export function assignKeys(records: Omit<SalesRecord, 'key'>[]): SalesRecord[] {
  const seen = new Map<string, number>();
  return records.map((r) => {
    const b = baseKey(r);
    const n = seen.get(b) ?? 0;
    seen.set(b, n + 1);
    return { ...r, key: `${b}#${n}` };
  });
}
