import type { ExportMode } from '../types';

/** The part of a line that merging needs. Sales and purchase lines both satisfy it. */
export interface LineLike {
  key: string;
  date: string;
  documentId?: string;
  currency: string;
  supplierId?: string;
  supplierName?: string;
  /** Finance: document kind / side / counterparty the number belongs to. */
  scope?: string;
}

/** Document numbers are only comparable within one currency / numbering series. */
export const docKey = (r: { documentId?: string; currency: string; supplierId?: string; supplierName?: string; scope?: string }) => {
  if (!r.documentId) return undefined;
  // Purchase-document numbers are only unique per supplier. Sales records have no supplier, so their keys keep the original format.
  const scope = (r.scope ?? r.supplierId ?? r.supplierName ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return scope ? `${r.currency}|${scope}|${r.documentId.trim().toLowerCase()}` : `${r.currency}|${r.documentId.trim().toLowerCase()}`;
};

export type Identity = 'document' | 'mixed' | 'content';

/** How reliable is the identity of transactions in this set? Without document numbers it is only content-based. */
export function identityOf(records: { documentId?: string }[]): { identity: Identity; coverage: number } {
  if (records.length === 0) return { identity: 'content', coverage: 0 };
  const withId = records.filter((r) => r.documentId).length;
  const coverage = withId / records.length;
  return { identity: coverage >= 0.95 ? 'document' : coverage === 0 ? 'content' : 'mixed', coverage };
}

/** What to do with a stored document whose incoming version differs. */
export type ConflictPolicy = 'hold' | 'replace' | 'add_alongside';
/** What to do with lines that have no document number and fall inside already-stored dates. */
export type ContentPolicy = 'dedupe_exact' | 'only_new_dates' | 'hold_overlap';
export interface ImportPolicy {
  conflicts: ConflictPolicy;
  content: ContentPolicy;
}

/**
 * Safe defaults. Replacement is proposed ONLY for a declared full snapshot with reliable document numbers – and even then the
 * caller must confirm it. Every other situation holds the ambiguous lines for review instead of guessing.
 */
export function defaultPolicy(mode: ExportMode, identity: Identity, overlapRisk: boolean): ImportPolicy {
  return {
    conflicts: mode === 'full' && identity === 'document' ? 'replace' : 'hold',
    content: overlapRisk ? 'hold_overlap' : 'dedupe_exact',
  };
}

export interface ExistingLine {
  key: string;
  docKey?: string;
  /** Replaced by a later import (kept for audit). */
  supersededBy?: string;
  /** Waiting for the user's decision. */
  heldBy?: string;
  /** The user decided to keep the stored version; kept for audit. */
  discarded?: boolean;
}

export interface MergePlan<R extends LineLike = LineLike> {
  /** New lines to store as active. */
  toAdd: R[];
  /** Lines stored but held out of analytics until the user decides. */
  toHold: R[];
  /** For held documents: the stored lines that the held version would replace (document key → keys). */
  holdReplaces: Map<string, string[]>;
  /** Keys of active stored lines replaced by this import (kept for audit, excluded from analytics). */
  supersede: string[];
  /** Incoming lines identical to a stored line. */
  duplicates: number;
  /** Incoming lines that match an already-superseded (older) version. Never re-activated. */
  stale: number;
  /** Lines skipped because of the content policy (only_new_dates). */
  skipped: number;
  docs: {
    added: number; // new documents
    additions: number; // existing documents that gain lines
    replaced: number; // documents whose stored lines were replaced
    removed: number; // documents that lost lines with no replacement (full snapshot + replace only)
    held: number; // documents with lines held for review
    omitted: number; // stored lines absent from the file but kept (completeness unknown)
    identical: number;
  };
}

export interface MergeOptions {
  mode: ExportMode;
  policy: ImportPolicy;
  /** Date range of data already stored (for the content policies). */
  stored?: { min: string; max: string };
}

export function planMerge<R extends LineLike>(
  incoming: R[],
  existingByKey: ReadonlyMap<string, ExistingLine>,
  existingActiveByDoc: ReadonlyMap<string, ExistingLine[]>,
  opts: MergeOptions = { mode: 'unknown', policy: { conflicts: 'hold', content: 'dedupe_exact' } },
): MergePlan<R> {
  const plan: MergePlan<R> = {
    toAdd: [], toHold: [], holdReplaces: new Map(), supersede: [], duplicates: 0, stale: 0, skipped: 0,
    docs: { added: 0, additions: 0, replaced: 0, removed: 0, held: 0, omitted: 0, identical: 0 },
  };
  const { mode, policy } = opts;
  const byDoc = new Map<string, R[]>();
  const noDoc: R[] = [];
  for (const r of incoming) {
    const d = docKey(r);
    if (d) (byDoc.get(d) ?? byDoc.set(d, []).get(d)!).push(r);
    else noDoc.push(r);
  }

  // an older, already-replaced version of a document must never overwrite its newer version
  const staleDocs = new Set<string>();
  for (const [d, lines] of byDoc) if (lines.some((r) => existingByKey.get(r.key)?.supersededBy)) staleDocs.add(d);

  for (const [d, lines] of byDoc) {
    if (staleDocs.has(d)) {
      plan.stale += lines.length;
      continue;
    }
    let dup = 0;
    const fresh: R[] = [];
    for (const r of lines) {
      if (existingByKey.has(r.key)) dup++;
      else fresh.push(r);
    }
    plan.duplicates += dup;
    const old = existingActiveByDoc.get(d);
    if (!old || old.length === 0) {
      if (fresh.length) {
        plan.toAdd.push(...fresh);
        plan.docs.added++;
      }
      continue;
    }
    const incomingKeys = new Set(lines.map((r) => r.key));
    const oldOnly = old.filter((o) => !incomingKeys.has(o.key));
    if (fresh.length === 0 && oldOnly.length === 0) {
      plan.docs.identical++;
      continue;
    }
    if (oldOnly.length === 0) {
      // the file only ADDS lines to a stored document
      if ((mode === 'full' || mode === 'partial') || policy.conflicts !== 'hold') {
        plan.toAdd.push(...fresh);
        plan.docs.additions++;
      } else {
        plan.toHold.push(...fresh);
        plan.docs.held++;
      }
      continue;
    }
    if (fresh.length === 0) {
      // stored lines are missing from the file and nothing replaces them: only a declared full snapshot may remove them
      if (mode === 'full' && policy.conflicts === 'replace') {
        plan.supersede.push(...oldOnly.map((o) => o.key));
        plan.docs.removed++;
      } else plan.docs.omitted++;
      continue;
    }
    // genuinely different version of a stored document
    if (policy.conflicts === 'replace') {
      plan.supersede.push(...oldOnly.map((o) => o.key));
      plan.toAdd.push(...fresh);
      plan.docs.replaced++;
    } else if (policy.conflicts === 'add_alongside') {
      plan.toAdd.push(...fresh);
      plan.docs.additions++;
    } else {
      plan.toHold.push(...fresh);
      plan.holdReplaces.set(d, oldOnly.map((o) => o.key));
      plan.docs.held++;
    }
  }

  for (const r of noDoc) {
    const ex = existingByKey.get(r.key);
    if (ex?.supersededBy) {
      plan.stale++;
      continue;
    }
    if (ex) {
      plan.duplicates++;
      continue;
    }
    const st = opts.stored;
    if (policy.content === 'only_new_dates' && st && r.date <= st.max) plan.skipped++;
    else if (policy.content === 'hold_overlap' && st && r.date >= st.min && r.date <= st.max) plan.toHold.push(r);
    else plan.toAdd.push(r);
  }
  return plan;
}
