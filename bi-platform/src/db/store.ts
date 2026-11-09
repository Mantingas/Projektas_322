import type { ConfirmedMapping, ExportMode, ImportStats, SalesRecord } from '@/engine/types';
import { defaultPolicy, docKey, identityOf, planMerge, type ExistingLine, type Identity, type ImportPolicy, type MergePlan } from '@/engine/import/merge';
import type { AppDB, ImportRow, SavedMapping, StoredRecord } from './db';

export interface CommitInput {
  checksum: string;
  fileName: string;
  sheetName: string;
  exportMode: ExportMode;
  records: SalesRecord[];
  stats: ImportStats;
  mapping: ConfirmedMapping;
  templateId?: string;
  /** Allow importing a file whose checksum was imported before (default: refuse). */
  allowSameChecksum?: boolean;
  /** Choices for ambiguous changes. Defaults to `defaultPolicy`. */
  policy?: ImportPolicy;
  /** The user explicitly confirmed the destructive / ambiguous consequences shown in the preview. */
  confirmed?: boolean;
}

export type ConfirmReason = 'replacements' | 'removals' | 'add_alongside' | 'content_overlap';

export type CommitResult =
  | { status: 'duplicate_file'; existing: ImportRow }
  | { status: 'needs_confirmation'; preview: MergePreview }
  | { status: 'ok'; import: ImportRow };

export const newId = () => `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export async function findByChecksum(db: AppDB, checksum: string): Promise<ImportRow | undefined> {
  return db.imports.where('checksum').equals(checksum).first();
}

/** Stored lines of the given documents. Few documents: indexed lookup; many: ONE pass with a Set (thousands of index ranges are far slower). */
async function rowsByDocKeys(db: AppDB, docs: string[]): Promise<StoredRecord[]> {
  if (docs.length === 0) return [];
  if (docs.length <= 400) return db.sales.where('docKey').anyOf(docs).toArray();
  const wanted = new Set(docs);
  return db.sales.filter((r) => Boolean(r.docKey) && wanted.has(r.docKey!)).toArray();
}

/** Marks stored lines as replaced. Primary-key reads/writes only, so it stays fast for thousands of lines. */
async function markSuperseded(db: AppDB, keys: string[], by: string): Promise<void> {
  if (keys.length === 0) return;
  const rows = (await db.sales.bulkGet(keys)).filter((r): r is StoredRecord => Boolean(r) && !r!.supersededBy);
  await db.sales.bulkPut(rows.map((r) => ({ ...r, supersededBy: by })));
}

async function loadExisting(db: AppDB, records: SalesRecord[]) {
  const keys = records.map((r) => r.key);
  const found = await db.sales.bulkGet(keys);
  const existingByKey = new Map<string, ExistingLine>();
  found.forEach((f) => f && existingByKey.set(f.key, f));
  const docs = [...new Set(records.map(docKey).filter((d): d is string => Boolean(d)))];
  const existingActiveByDoc = new Map<string, ExistingLine[]>();
  if (docs.length) {
    const rows = await rowsByDocKeys(db, docs);
    for (const r of rows) {
      if (r.supersededBy || r.heldBy || r.discarded || !r.docKey) continue;
      (existingActiveByDoc.get(r.docKey) ?? existingActiveByDoc.set(r.docKey, []).get(r.docKey)!).push(r);
    }
  }
  return { existingByKey, existingActiveByDoc };
}

/** Date range of ACTIVE stored data (used by the content-only choices). */
async function storedRange(db: AppDB): Promise<{ min: string; max: string } | undefined> {
  const first = await db.sales.orderBy('date').filter((r) => !r.supersededBy && !r.heldBy && !r.discarded).first();
  if (!first) return undefined;
  const last = await db.sales.orderBy('date').reverse().filter((r) => !r.supersededBy && !r.heldBy && !r.discarded).first();
  return { min: first.date, max: last!.date };
}

export interface MergePreview {
  mode: ExportMode;
  policy: ImportPolicy;
  /** The safe defaults for this file – what is proposed before the user chooses. */
  proposedPolicy: ImportPolicy;
  identity: Identity;
  idCoverage: number;
  /** Lines stored as active. */
  added: number;
  /** Identical to stored lines (skipped). */
  duplicates: number;
  /** Older versions of already-corrected lines (ignored). */
  stale: number;
  /** Documents whose stored lines would be replaced, and how many stored lines that supersedes. */
  revisedDocs: number;
  supersededLines: number;
  /** Documents that would lose lines with no replacement. */
  removedDocs: number;
  /** Stored lines missing from the file that are KEPT because completeness is not established. */
  omittedDocs: number;
  /** Lines held for review (not in analytics until resolved). */
  heldLines: number;
  heldDocs: number;
  /** Documents that gain lines. */
  additionsDocs: number;
  newDocs: number;
  /** Stored documents inside the file's date range that are absent from the file – reported, never touched. */
  absentDocs: number;
  skippedLines: number;
  /** Content-only identity AND the dates overlap stored data: double counting cannot be ruled out. */
  overlapRisk: boolean;
  /** Consequences the user must confirm explicitly before importing. */
  needsConfirmation: ConfirmReason[];
  /** Kept for backwards compatibility: lines held for review. */
  ambiguous: number;
}

async function plan(db: AppDB, records: SalesRecord[], mode: ExportMode, policyIn?: ImportPolicy) {
  const { existingByKey, existingActiveByDoc } = await loadExisting(db, records);
  const { identity, coverage } = identityOf(records);
  let overlapRisk = false;
  const range = await storedRange(db);
  if (identity !== 'document' && records.length) {
    const dates = records.map((r) => r.date).sort();
    const lo = dates[0]!;
    const hi = dates[dates.length - 1]!;
    // existence check with early exit (an index range over many equal dates is slow; a filtered scan stops at the first hit)
    overlapRisk = Boolean(await db.sales.filter((r) => r.date >= lo && r.date <= hi && !r.supersededBy && !r.heldBy && !r.discarded).first());
  }
  const proposed = defaultPolicy(mode, identity, overlapRisk);
  const policy = policyIn ?? proposed;
  const mp: MergePlan = planMerge(records, existingByKey, existingActiveByDoc, { mode, policy, stored: range });
  return { mp, identity, coverage, overlapRisk, proposed, policy };
}

/** Dry run shown to the user before they confirm. Writes nothing. */
export async function previewImport(db: AppDB, records: SalesRecord[], mode: ExportMode, policyIn?: ImportPolicy): Promise<MergePreview> {
  const { mp, identity, coverage, overlapRisk, proposed, policy } = await plan(db, records, mode, policyIn);
  // stored documents inside the file's date range that the file does not contain (reported only)
  let absentDocs = 0;
  if (identity === 'document' && records.length) {
    const dates = records.map((r) => r.date).sort();
    const present = new Set(records.map(docKey).filter(Boolean) as string[]);
    const lo = dates[0]!;
    const hi = dates[dates.length - 1]!;
    const absent = new Set<string>();
    await db.sales.each((r) => {
      if (r.date >= lo && r.date <= hi && !r.supersededBy && !r.heldBy && !r.discarded && r.docKey && !present.has(r.docKey)) absent.add(r.docKey);
    });
    absentDocs = absent.size;
  }
  const needs: ConfirmReason[] = [];
  if (mp.docs.replaced > 0) needs.push('replacements');
  if (mp.docs.removed > 0) needs.push('removals');
  if (policy.conflicts === 'add_alongside' && mp.docs.additions > 0 && mode !== 'full' && mode !== 'partial') needs.push('add_alongside');
  if (overlapRisk && policy.content === 'dedupe_exact' && mp.toAdd.length > 0) needs.push('content_overlap');
  return {
    mode, policy, proposedPolicy: proposed, identity, idCoverage: coverage,
    added: mp.toAdd.length, duplicates: mp.duplicates, stale: mp.stale, revisedDocs: mp.docs.replaced, supersededLines: mp.supersede.length,
    removedDocs: mp.docs.removed, omittedDocs: mp.docs.omitted, heldLines: mp.toHold.length, heldDocs: mp.docs.held, additionsDocs: mp.docs.additions, newDocs: mp.docs.added,
    absentDocs, skippedLines: mp.skipped, overlapRisk, needsConfirmation: needs, ambiguous: mp.toHold.length,
  };
}

/**
 * Stores the import. Nothing is ever deleted: replaced lines are kept (`supersededBy`), ambiguous lines are held (`heldBy`),
 * and every change is written to the audit log. Destructive / ambiguous consequences require `confirmed: true`.
 */
export async function commitImport(db: AppDB, input: CommitInput): Promise<CommitResult> {
  if (!input.allowSameChecksum) {
    const existing = await findByChecksum(db, input.checksum);
    if (existing) return { status: 'duplicate_file', existing };
  }
  const preview = await previewImport(db, input.records, input.exportMode, input.policy);
  if (preview.needsConfirmation.length > 0 && !input.confirmed) return { status: 'needs_confirmation', preview };
  return db.transaction('rw', db.imports, db.sales, db.audit, async () => {
    const { mp, identity, coverage, policy } = await plan(db, input.records, input.exportMode, input.policy);
    const id = newId();
    const row: ImportRow = {
      id, checksum: input.checksum, fileName: input.fileName, sheetName: input.sheetName, importedAt: Date.now(), exportMode: input.exportMode, stats: input.stats,
      added: mp.toAdd.length, duplicates: mp.duplicates, conflicts: mp.toHold.length, revisedDocs: mp.docs.replaced, supersededLines: mp.supersede.length, staleLines: mp.stale,
      heldLines: mp.toHold.length, heldDocs: mp.docs.held, removedDocs: mp.docs.removed, skippedLines: mp.skipped,
      policy: { conflicts: policy.conflicts, content: policy.content }, confirmed: Boolean(input.confirmed),
      identity, idCoverage: coverage, mapping: input.mapping, templateId: input.templateId,
    };
    await db.imports.add(row);
    await markSuperseded(db, mp.supersede, id);
    await db.sales.bulkPut(mp.toAdd.map((r): StoredRecord => ({ ...r, importId: id, docKey: docKey(r) })));
    await db.sales.bulkPut(mp.toHold.map((r): StoredRecord => ({ ...r, importId: id, docKey: docKey(r), heldBy: id, replaces: mp.holdReplaces.get(docKey(r) ?? '') ?? [] })));
    await db.audit.add({
      at: Date.now(), importId: id, action: 'import',
      detail: { file: input.fileName, mode: input.exportMode, conflicts: policy.conflicts, content: policy.content, confirmed: Boolean(input.confirmed), added: row.added, duplicates: row.duplicates, replacedDocs: row.revisedDocs, supersededLines: row.supersededLines, removedDocs: mp.docs.removed, heldLines: row.heldLines ?? 0, stale: row.staleLines },
    });
    return { status: 'ok' as const, import: row };
  });
}

const isActive = (r: StoredRecord) => !r.supersededBy && !r.heldBy && !r.discarded;

/** Active (not superseded / held / discarded) lines with provenance (`importId`, `sourceRow`). */
export async function loadAllSales(db: AppDB): Promise<SalesRecord[]> {
  const rows = await db.sales.filter(isActive).toArray();
  return rows.map(({ docKey: _d, supersededBy: _s, heldBy: _h, discarded: _x, replaces: _p, ...r }) => {
    void _d; void _s; void _h; void _x; void _p;
    return r;
  });
}

/** Lines waiting for the user's decision. */
export async function pendingHeldCount(db: AppDB): Promise<number> {
  return db.sales.where('heldBy').aboveOrEqual('').filter((r) => !r.discarded).count();
}

// ───────── conflict review ─────────
export interface ConflictGroup {
  importId: string;
  fileName: string;
  /** null = lines without a document number */
  docKey: string | null;
  held: StoredRecord[];
  /** The stored, active lines of the same document (empty for lines without a document number). */
  stored: StoredRecord[];
}

export async function listConflicts(db: AppDB): Promise<ConflictGroup[]> {
  const held = await db.sales.where('heldBy').aboveOrEqual('').filter((r) => !r.discarded).toArray();
  const imports = new Map((await db.imports.toArray()).map((i) => [i.id, i.fileName]));
  const groups = new Map<string, ConflictGroup>();
  for (const r of held) {
    const k = `${r.heldBy}|${r.docKey ?? ''}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { importId: r.heldBy!, fileName: imports.get(r.heldBy!) ?? '?', docKey: r.docKey ?? null, held: [], stored: [] }));
    g.held.push(r);
  }
  const docs = [...new Set([...groups.values()].map((g) => g.docKey).filter((d): d is string => Boolean(d)))];
  if (docs.length) {
    const rows = (await rowsByDocKeys(db, docs)).filter(isActive);
    for (const g of groups.values()) if (g.docKey) g.stored = rows.filter((r) => r.docKey === g.docKey);
  }
  return [...groups.values()].sort((a, b) => (a.docKey ?? '').localeCompare(b.docKey ?? ''));
}

export type ResolveAction = 'use_new' | 'keep_stored' | 'keep_both';

/**
 * use_new      – stored lines of the document are replaced by the held ones (old lines kept for audit)
 * keep_stored  – held lines are discarded (kept for audit)
 * keep_both    – held lines are added next to the stored ones (may double count; the user chose it)
 * Lines without a document number have nothing to replace: use_new / keep_both both add them.
 */
export async function resolveConflicts(db: AppDB, items: { importId: string; docKey: string | null }[], action: ResolveAction): Promise<number> {
  let touched = 0;
  await db.transaction('rw', db.sales, db.audit, async () => {
    for (const it of items) {
      const held = await db.sales.where('heldBy').equals(it.importId).filter((r) => (r.docKey ?? null) === it.docKey && !r.discarded).toArray();
      if (held.length === 0) continue;
      if (action === 'keep_stored') {
        await db.sales.bulkPut(held.map((r) => { const { heldBy: _h, replaces: _r, ...rest } = r; void _h; void _r; return { ...rest, discarded: true }; }));
      } else {
        if (action === 'use_new' && it.docKey) {
          // only the stored lines this version actually replaces – lines the new version also contains stay untouched
          const keys = [...new Set(held.flatMap((r) => r.replaces ?? []))];
          if (keys.length) {
            const rows = (await db.sales.bulkGet(keys)).filter((r): r is StoredRecord => Boolean(r) && isActive(r!));
            await db.sales.bulkPut(rows.map((r) => ({ ...r, supersededBy: it.importId })));
          }
        }
        await db.sales.bulkPut(held.map((r) => { const { heldBy: _h, replaces: _r, ...rest } = r; void _h; void _r; return rest; }));
      }
      touched += held.length;
      await db.audit.add({ at: Date.now(), importId: it.importId, action: 'resolve_conflict', detail: { doc: it.docKey ?? '(no document number)', action, lines: held.length } });
    }
  });
  return touched;
}

export async function deleteImport(db: AppDB, id: string): Promise<void> {
  await db.transaction('rw', db.imports, db.sales, db.audit, async () => {
    const own = await db.sales.where('importId').equals(id).count();
    await db.sales.where('importId').equals(id).delete();
    // lines this import had replaced become active again
    let restored = 0;
    await db.sales.where('importId').notEqual(id).filter((r) => r.supersededBy === id).modify((r) => {
      delete r.supersededBy;
      restored++;
    });
    await db.imports.delete(id);
    await db.audit.add({ at: Date.now(), importId: id, action: 'delete_import', detail: { removedLines: own, restoredLines: restored } });
  });
}

/** "Delete everything": removes every table's contents. */
export async function wipeAll(db: AppDB): Promise<void> {
  await db.transaction('rw', db.imports, db.sales, db.mappings, db.settings, db.audit, async () => {
    await Promise.all([db.imports.clear(), db.sales.clear(), db.mappings.clear(), db.settings.clear(), db.audit.clear()]);
  });
}

export async function saveMapping(db: AppDB, m: SavedMapping): Promise<void> {
  await db.mappings.put(m);
}
export const getSavedMapping = (db: AppDB, signature: string) => db.mappings.get(signature);

export interface Backup {
  version: 1;
  exportedAt: string;
  imports: ImportRow[];
  sales: StoredRecord[];
  mappings: SavedMapping[];
  audit?: import('./db').AuditEntry[];
}

export async function exportBackup(db: AppDB): Promise<Backup> {
  return { version: 1, exportedAt: new Date().toISOString(), imports: await db.imports.toArray(), sales: await db.sales.toArray(), mappings: await db.mappings.toArray(), audit: await db.audit.toArray() };
}

export async function restoreBackup(db: AppDB, b: Backup): Promise<void> {
  if (b?.version !== 1 || !Array.isArray(b.imports) || !Array.isArray(b.sales)) throw new Error('invalid_backup');
  await db.transaction('rw', db.imports, db.sales, db.mappings, db.audit, async () => {
    await db.imports.bulkPut(b.imports);
    await db.sales.bulkPut(b.sales.map((r) => ({ ...r, docKey: docKey(r) })));
    await db.mappings.bulkPut(b.mappings ?? []);
    if (Array.isArray(b.audit)) await db.audit.bulkPut(b.audit.map(({ id: _id, ...a }) => (void _id, a)));
  });
}
