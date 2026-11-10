/** Pilot review data: an independent reviewer's decisions about findings, known misses, and the pilot's own facts. All of it stays on this device. */
export type Decision = 'not_reviewed' | 'confirmed' | 'false_positive' | 'inconclusive';
export const DECISIONS: Decision[] = ['not_reviewed', 'confirmed', 'false_positive', 'inconclusive'];

export interface Review {
  /** the finding id (stable: derived from the content of the source records) */
  id: string;
  decision: Decision;
  /** snapshot of what the app said when it was reviewed, so later re-imports cannot rewrite history */
  category: string;
  side: 'receivable' | 'payable';
  evidenceStatus: string;
  calculatedAmount: number | null;
  currency: string;
  /** how the reviewer reconciled it against the accounting system / bank */
  reconciliation: string;
  /** why it was rejected or is uncertain */
  reason: string;
  /** confirmed accounting discrepancy (the amount the reviewer agrees is wrong in the books) */
  confirmedDiscrepancy: number | null;
  /** amount the customer says is recoverable (not yet recovered) */
  recoverable: number | null;
  /** money actually recovered, with where it was independently reported */
  recovered: number | null;
  recoveredEvidence: string;
  /** loss that was prevented (e.g. a payment stopped), with evidence */
  prevented: number | null;
  preventedEvidence: string;
  /** minutes the reviewer needed to reconcile this finding */
  minutes: number | null;
  reviewer: string;
  reviewedAt: number;
}

export interface Missed {
  id: string;
  description: string;
  category: string;
  amount: number | null;
  currency: string;
  /** where the reviewer found it (document numbers, system, report) */
  sourceRefs: string;
  /** the finding that covers it, if the app found it */
  findingId: string;
  /** if not found: why (no references, outside period, unsupported document, withheld …) */
  reason: string;
  addedAt: number;
}

export interface PilotMeta {
  key: 'meta';
  /** the reviewer attests that the data are real, lawfully supplied and authorised for this use */
  realDataAttested: boolean;
  organisation: string;
  periodFrom: string;
  periodTo: string;
  /** documented snapshot date and the report it comes from */
  snapshotDate: string;
  snapshotSource: string;
  /** minutes the customer's existing process needs for the same scope */
  baselineMinutes: number | null;
  baselineNote: string;
  /** minutes spent preparing / importing the data for the app */
  prepMinutes: number | null;
  /** the reviewer states that the list of independently identified problems is complete for the scope */
  missedListComplete: boolean;
  reviewer: string;
  updatedAt: number;
}
export const emptyMeta = (): PilotMeta => ({ key: 'meta', realDataAttested: false, organisation: '', periodFrom: '', periodTo: '', snapshotDate: '', snapshotSource: '', baselineMinutes: null, baselineNote: '', prepMinutes: null, missedListComplete: false, reviewer: '', updatedAt: 0 });
