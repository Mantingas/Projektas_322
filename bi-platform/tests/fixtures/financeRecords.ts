import type { FinanceRecord, FinanceSide } from '@/engine/types';
import { assignFinanceKeys, financeScope, snapshotDocId } from '@/engine/finance/keys';
import { makeFinance, type FinTruth, type FLocale } from './finance';

export interface Parts { open?: boolean; invoices?: boolean; payments?: boolean; credits?: boolean; snapshots?: string[] }

/** Truth rows → stored-record shape (what the importer would have produced), without going through a file. */
export function toFinanceRecords(t: FinTruth, parts: Parts = {}, importId = 'imp_a'): FinanceRecord[] {
  const { open = true, invoices = true, payments = true, credits = true } = parts;
  const side: FinanceSide = t.side;
  const base = { side, basis: 'net' as const, currency: t.currency, importId };
  const out: Omit<FinanceRecord, 'key'>[] = [];
  if (open) for (const o of t.open) {
    if (parts.snapshots && !parts.snapshots.includes(o.snapshot)) continue;
    out.push({ ...base, kind: 'open_item', date: o.snapshot, documentId: snapshotDocId('open_item', side, o.snapshot), invoiceNo: o.no, counterpartyId: o.cp, counterpartyName: o.name, invoiceDate: o.invDate, dueDate: o.due, amount: o.amount, outstanding: o.outstanding, paid: o.paid, scope: financeScope('open_item', side, o.cp), sourceRow: 2 });
  }
  if (invoices) for (const i of t.invoices) out.push({ ...base, kind: 'invoice', date: i.date, documentId: i.no, counterpartyId: i.cp, counterpartyName: i.name, dueDate: i.due, amount: i.amount, scope: financeScope('invoice', side, i.cp), sourceRow: 2 });
  if (payments) for (const p of t.payments) out.push({ ...base, kind: 'payment', date: p.date, documentId: p.ref, reference: p.invoice, counterpartyId: p.cp, counterpartyName: p.name, amount: p.amount, scope: financeScope('payment', side, p.cp), sourceRow: 2 });
  if (credits) for (const c of t.credits) out.push({ ...base, kind: 'credit_note', date: c.date, documentId: c.no, reference: c.ref, counterpartyId: c.cp, counterpartyName: c.name, amount: c.amount, scope: financeScope('credit_note', side, c.cp), sourceRow: 2 });
  return assignFinanceKeys(out);
}

export function financeData(side: FinanceSide = 'receivable', locale: FLocale = 'lt', parts: Parts = {}) {
  const t = makeFinance(side, locale);
  return { ...t, records: toFinanceRecords(t, parts) };
}
