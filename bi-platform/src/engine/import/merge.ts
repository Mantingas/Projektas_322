import type { SalesRecord } from '../types';

/** Document numbers are only comparable within one currency / numbering series. */
export const docKey = (r: Pick<SalesRecord, 'documentId' | 'currency'>) =>
  r.documentId ? `${r.currency}|${r.documentId.trim().toLowerCase()}` : undefined;

export type Identity = 'document' | 'mixed' | 'content';

/** How reliable is the identity of transactions in this set? Without document numbers it is only content-based. */
export function identityOf(records: Pick<SalesRecord, 'documentId'>[]): { identity: Identity; coverage: number } {
  if (records.length === 0) return { identity: 'content', coverage: 0 };
  const withId = records.filter((r) => r.documentId).length;
  const coverage = withId / records.length;
  return { identity: coverage >= 0.95 ? 'document' : coverage === 0 ? 'content' : 'mixed', coverage };
}

export interface ExistingLine {
  key: string;
  docKey?: string;
  /** Set when a later import replaced this line. */
  supersededBy?: string;
}

export interface MergePlan {
  /** New lines to store. */
  toAdd: SalesRecord[];
  /** Incoming lines identical to a stored, active line. */
  duplicates: number;
  /** Incoming lines that match an already-superseded (older) version of a line. Never re-activated. */
  stale: number;
  /** Keys of stored lines replaced by this import (kept for audit, excluded from analytics). */
  supersede: string[];
  /** Documents whose content changed (corrected invoices). */
  revisedDocs: number;
  /** Lines added to an already-stored document in 'incremental' mode: a correction cannot be told apart from an addition. */
  ambiguous: number;
}

/**
 * Document-level merge.
 *  - identical line → duplicate;
 *  - document exists with different lines → in full/unknown mode the new version supersedes the stored lines that are
 *    missing from the file (kept for audit); in incremental mode nothing is superseded and the additions are flagged;
 *  - a file that contains superseded (older) lines is a stale version → its changes to that document are ignored.
 *  - lines without a document number can only be matched by exact content (see `identityOf`).
 */
export function planMerge(
  incoming: SalesRecord[],
  existingByKey: ReadonlyMap<string, ExistingLine>,
  existingActiveByDoc: ReadonlyMap<string, ExistingLine[]>,
  mode: 'full' | 'incremental' | 'unknown' = 'unknown',
): MergePlan {
  const plan: MergePlan = { toAdd: [], duplicates: 0, stale: 0, supersede: [], revisedDocs: 0, ambiguous: 0 };
  const byDoc = new Map<string, SalesRecord[]>();
  for (const r of incoming) {
    const d = docKey(r);
    if (d) (byDoc.get(d) ?? byDoc.set(d, []).get(d)!).push(r);
  }
  const staleDocs = new Set<string>();
  for (const [d, lines] of byDoc) if (lines.some((r) => existingByKey.get(r.key)?.supersededBy)) staleDocs.add(d);

  const newByDoc = new Map<string, number>();
  for (const r of incoming) {
    const ex = existingByKey.get(r.key);
    const d = docKey(r);
    if (ex?.supersededBy) {
      plan.stale++;
      continue;
    }
    if (ex) {
      plan.duplicates++;
      continue;
    }
    if (d && staleDocs.has(d)) {
      plan.stale++;
      continue;
    }
    plan.toAdd.push(r);
    if (d) newByDoc.set(d, (newByDoc.get(d) ?? 0) + 1);
  }
  for (const [d, lines] of byDoc) {
    if (staleDocs.has(d)) continue;
    const old = existingActiveByDoc.get(d);
    if (!old || old.length === 0) continue;
    const incomingKeys = new Set(lines.map((r) => r.key));
    const oldOnly = old.filter((o) => !incomingKeys.has(o.key));
    const added = newByDoc.get(d) ?? 0;
    if (mode === 'incremental') {
      plan.ambiguous += added;
    } else if (oldOnly.length > 0) {
      plan.supersede.push(...oldOnly.map((o) => o.key));
      plan.revisedDocs++;
    }
  }
  return plan;
}
