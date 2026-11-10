/**
 * Hand-built finance records for ground-truth scenarios. Every expectation in the tests is written by hand from the scenario, never produced by
 * running the analysis.
 */
import type { FinanceRecord, FinanceSide } from '@/engine/types';
import { assignFinanceKeys, financeScope, snapshotDocId } from '@/engine/finance/keys';

export interface CP { id: string; name: string }
export const S1: CP = { id: 'S1', name: 'UAB Tiekėjas Vienas' };
export const S2: CP = { id: 'S2', name: 'UAB Tiekėjas Du' };

type Draft = Omit<FinanceRecord, 'key'>;
export class Book {
  private rows: Draft[] = [];
  constructor(public side: FinanceSide = 'payable', public currency = 'EUR') {}
  private base(cp: CP) { return { side: this.side, basis: 'net' as const, currency: this.currency, importId: 'imp_a', counterpartyId: cp.id, counterpartyName: cp.name, sourceRow: this.rows.length + 2 }; }
  invoice(cp: CP, no: string, date: string, due: string, amount: number) { this.rows.push({ ...this.base(cp), kind: 'invoice', date, documentId: no, dueDate: due, amount, rawAmount: amount, scope: financeScope('invoice', this.side, cp.id) }); return this; }
  payment(cp: CP, ref: string | undefined, date: string, amount: number, payNo?: string) { this.rows.push({ ...this.base(cp), kind: 'payment', date, documentId: payNo ?? `P-${this.rows.length}`, reference: ref, amount, rawAmount: amount, scope: financeScope('payment', this.side, cp.id) }); return this; }
  credit(cp: CP, no: string, date: string, amount: number, ref?: string, evidence: 'register' | 'type' | 'sign' = 'register', rawSign: 1 | -1 = 1) { this.rows.push({ ...this.base(cp), kind: 'credit_note', date, documentId: no, reference: ref, amount: Math.abs(amount), rawAmount: rawSign * Math.abs(amount), creditEvidence: evidence, scope: financeScope('credit_note', this.side, cp.id) }); return this; }
  /** a line of an open-item report as of `asof`: outstanding is what is still owed (negative = credit balance) */
  open(asof: string, cp: CP, no: string, outstanding: number, amount?: number, due?: string) { this.rows.push({ ...this.base(cp), kind: 'open_item', date: asof, documentId: snapshotDocId('open_item', this.side, asof), invoiceNo: no, dueDate: due, amount, outstanding, scope: financeScope('open_item', this.side, cp.id) }); return this; }
  get records(): FinanceRecord[] { return assignFinanceKeys(this.rows); }
}
