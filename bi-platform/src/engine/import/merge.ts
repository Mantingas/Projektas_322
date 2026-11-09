import type { SalesRecord } from '../types';

export interface MergePlan {
  toAdd: SalesRecord[];
  /** Lines that already exist (same key) – skipped so nothing is counted twice. */
  duplicates: number;
  /**
   * Lines whose document number already exists in the store but whose content differs
   * (e.g. a corrected invoice). Not added automatically; reported to the user.
   */
  conflicts: SalesRecord[];
}

/** Document numbers are only comparable within one currency / numbering series. */
export const docKey = (r: Pick<SalesRecord, 'documentId' | 'currency'>) =>
  r.documentId ? `${r.currency}|${r.documentId.trim().toLowerCase()}` : undefined;

export function planMerge(incoming: SalesRecord[], existingKeys: ReadonlySet<string>, existingDocIds: ReadonlySet<string>): MergePlan {
  const toAdd: SalesRecord[] = [];
  const conflicts: SalesRecord[] = [];
  let duplicates = 0;
  for (const r of incoming) {
    if (existingKeys.has(r.key)) {
      duplicates++;
      continue;
    }
    const d = docKey(r);
    if (d && existingDocIds.has(d)) conflicts.push(r);
    else toAdd.push(r);
  }
  return { toAdd, duplicates, conflicts };
}
