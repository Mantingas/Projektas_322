import type { FinanceKind, FinanceRecord, FinanceSide } from '../types';
import { hash106 } from '../import/hash';

export const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Counterparty identity: the code when the file has one, otherwise the name. */
export const cpKey = (r: Pick<FinanceRecord, 'counterpartyId' | 'counterpartyName'>) => norm(r.counterpartyId) || norm(r.counterpartyName);
export const cpLabel = (r: Pick<FinanceRecord, 'counterpartyId' | 'counterpartyName'>) => r.counterpartyName ?? r.counterpartyId ?? '';

export const SNAPSHOT_KINDS: FinanceKind[] = ['open_item', 'aging', 'balance'];
export const isSnapshotKind = (k: FinanceKind) => SNAPSHOT_KINDS.includes(k);

/** Snapshot lines are the "document" a re-import can duplicate or contradict. */
export const snapshotDocId = (kind: FinanceKind, side: FinanceSide, date: string) => `${kind} ${side} ${date}`;

/**
 * Merge scope. Document numbers are only comparable within the same kind and side; supplier invoices, credit notes of suppliers and ALL payments
 * are also scoped to the counterparty (their numbers are only unique per counterparty). Our own receivable invoice numbers are one series.
 */
export function financeScope(kind: FinanceKind, side: FinanceSide, cp: string): string {
  const base = `${kind}:${side}`;
  if (isSnapshotKind(kind)) return base;
  return side === 'payable' || kind === 'payment' ? `${base}:${cp}` : base;
}

export function financeBaseKey(r: Omit<FinanceRecord, 'key' | 'sourceRow'>): string {
  const parts = [
    r.kind, r.side, r.date, norm(r.documentId), norm(r.invoiceNo), norm(r.reference), cpKey(r), r.invoiceDate ?? '', r.dueDate ?? '',
    r.amount?.toFixed(4) ?? '', r.outstanding?.toFixed(4) ?? '', r.paid?.toFixed(4) ?? '', r.buckets ? Object.values(r.buckets).map((x) => x.toFixed(2)).join(',') : '', r.currency,
  ];
  // a credit note and its reversal have the same magnitude: only the original sign tells them apart (keys of ordinary rows are unchanged)
  if (r.rawAmount !== undefined && r.amount !== undefined && r.rawAmount !== r.amount && r.rawAmount !== Math.abs(r.rawAmount) && r.kind === 'credit_note') parts.push(`raw${r.rawAmount.toFixed(4)}`);
  return hash106(parts.join('\u001f'));
}

/** Genuinely identical lines in one file get occurrence numbers, so re-importing the same file yields the same keys. */
export function assignFinanceKeys(records: Omit<FinanceRecord, 'key'>[]): FinanceRecord[] {
  const seen = new Map<string, number>();
  return records.map((r) => {
    const b = financeBaseKey(r);
    const n = seen.get(b) ?? 0;
    seen.set(b, n + 1);
    return { ...r, key: `${b}#${n}` };
  });
}
