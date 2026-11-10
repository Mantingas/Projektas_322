import type { ParamValue } from '../types';

/**
 * Evidence classification of a financial finding.
 *  verified  – the figure is directly supported by sufficient, internally consistent records IN THE IMPORTED DATA (not an audit of the underlying books)
 *  candidate – strong indication, but business / accounting verification is still required
 *  estimate  – the figure depends on disclosed assumptions (thresholds, proxies, scenarios)
 *  withheld  – missing, incompatible or contradictory evidence: no conclusion is drawn
 * The status is decided by the KIND and QUALITY of the evidence only – never by how large the amount is.
 */
export type EvidenceStatus = 'verified' | 'candidate' | 'estimate' | 'withheld';
export const EVIDENCE_ORDER: EvidenceStatus[] = ['verified', 'candidate', 'estimate', 'withheld'];

export interface EvidenceRecord {
  key: string;
  kind: string;
  /** what this record contributes to the finding (i18n suffix `trust.role.*`) */
  role: 'credit' | 'invoice' | 'payment' | 'reversal' | 'open_balance' | 'refund' | 'other';
  date: string;
  documentId?: string;
  counterparty?: string;
  amount: number;
  importId?: string;
  sourceRow: number;
}

export interface Described { key: string; params?: Record<string, ParamValue> }

export interface EvidenceDossier {
  status: EvidenceStatus;
  currency?: string;
  /** the amount basis the file states; finance reports do not state a VAT basis, which is disclosed as a limitation */
  amountBasis: 'as_stated' | 'net' | 'gross' | 'unknown' | 'none';
  period?: { from: string; to: string };
  /** which date the period refers to – a comparison must always say which date dimension it used (i18n `trust.date.*`) */
  dateDimension?: 'document' | 'snapshot' | 'due' | 'document_payment' | 'document_snapshot' | 'snapshot_movement';
  records: EvidenceRecord[];
  calculation: Described;
  assumptions: Described[];
  limitations: Described[];
  /** evidence that would raise the finding to the next level */
  missing: Described[];
  rationale: Described;
  /** only when status is 'withheld' */
  withheldReason?: Described;
}

export type SettlementRule = 'unapplied_credit' | 'duplicate_payment' | 'overpayment' | 'unmatched_payment' | 'counterparty_conflict' | 'unclear_settlement';
export type ExposureKind = 'open_credit_balance' | 'possible_excess' | 'investigate';

export interface TrustFinding extends EvidenceDossier {
  id: string;
  rule: SettlementRule;
  side: 'receivable' | 'payable';
  cp: string;
  label: string;
  /** how much money the finding is about, and what KIND of money it is. `investigate` amounts are never recoverable claims. */
  exposure: { amount: number; kind: ExposureKind } | null;
  /** for credits: what state the evidence shows */
  state?: 'open_in_report' | 'partially_applied' | 'unmatched_review' | 'applied' | 'settled_per_report' | 'reversed' | 'insufficient';
}

export interface PotentialValue {
  currency: string;
  total: number;
  /** one entry per NON-OVERLAPPING group of findings; the largest exposure of a group is used, never the sum of overlapping ones */
  parts: { id: string; label: string; rule: SettlementRule; status: EvidenceStatus; amount: number; overlaps: string[] }[];
  /** findings left out and why: investigate-only amounts, withheld, estimates */
  excluded: { id: string; reason: 'investigate_only' | 'withheld' | 'overlap'; }[];
}

export interface SettlementResult {
  currency: string;
  side: 'receivable' | 'payable';
  findings: TrustFinding[];
  /** classifications that are NOT findings but shown so reconciled items are visible (applied, reversed, settled) */
  reconciled: { id: string; state: NonNullable<TrustFinding['state']>; label: string; amount: number; recordKey: string }[];
  potential: PotentialValue;
}
