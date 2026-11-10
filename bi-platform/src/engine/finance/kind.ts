import type { FieldId, FinanceKind } from '../types';

export type FinanceDatasetKind = 'open_items' | 'aging' | 'balance' | 'invoices' | 'payments' | 'credit_notes';

/** What one row of each dataset kind IS. Shown to the user next to the kind. */
export const FINANCE_GRAIN: Record<FinanceDatasetKind, 'invoice_at_date' | 'counterparty_bucket' | 'counterparty_at_date' | 'invoice' | 'payment' | 'credit_note'> = {
  open_items: 'invoice_at_date', aging: 'counterparty_bucket', balance: 'counterparty_at_date', invoices: 'invoice', payments: 'payment', credit_notes: 'credit_note',
};
/** Kinds that describe the ledger AT a date (they are snapshots – never added together). */
export const SNAPSHOT_DATASETS: FinanceDatasetKind[] = ['open_items', 'aging', 'balance'];

export const RECORD_KIND: Record<FinanceDatasetKind, FinanceKind> = { open_items: 'open_item', aging: 'aging', balance: 'balance', invoices: 'invoice', payments: 'payment', credit_notes: 'credit_note' };

const AGING: FieldId[] = ['aging_current', 'aging_1_30', 'aging_31_60', 'aging_61_90', 'aging_90_plus'];

/**
 * Dataset kind from the CONFIRMED mapping alone (so the import screen can show it before anything is read):
 *  aging buckets → aging report · payment date / payment reference → payment register · credit-note reference → credit-note register ·
 *  outstanding + document number → open items · outstanding without document number → balance snapshot · otherwise an invoice register.
 * A register that mixes invoices and credit notes (document-type column) is still an invoice register; its credit rows are split off when read.
 */
export function financeKindFromFields(fields: Iterable<FieldId>): FinanceDatasetKind {
  const f = new Set(fields);
  if (AGING.some((x) => f.has(x))) return 'aging';
  if (f.has('payment_date') || f.has('payment_reference') || (f.has('invoice_reference') && !f.has('outstanding_amount'))) return 'payments';
  if (f.has('credit_reference') && !f.has('outstanding_amount')) return 'credit_notes';
  if (f.has('outstanding_amount')) return f.has('document_id') ? 'open_items' : 'balance';
  return 'invoices';
}
