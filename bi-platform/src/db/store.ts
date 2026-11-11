import type { ConfirmedMapping, ExportMode, ImportStats, FinanceRecord, InventoryRecord, ModuleId, PurchaseRecord, SalesRecord } from '@/engine/types';
import { defaultPolicy, docKey, identityOf, planMerge, type ExistingLine, type Identity, type ImportPolicy, type LineLike, type MergePlan } from '@/engine/import/merge';
import type { AppDB, ImportRow, SavedMapping, StoredMeta } from './db';
import type { Table } from 'dexie';

/** A stored line of either module. */
type Line = (SalesRecord | PurchaseRecord | InventoryRecord | FinanceRecord) & StoredMeta;
type AnyLine = SalesRecord | PurchaseRecord | InventoryRecord | FinanceRecord;

const table = (db: AppDB, m: ModuleId): Table<Line, string> => (m === 'purchasing' ? db.purchases : m === 'inventory' ? db.inventory : m === 'finance' ? db.finance : db.sales) as unknown as Table<Line, string>;
const MODULES: ModuleId[] = ['sales', 'purchasing', 'inventory', 'finance'];

export interface CommitInput {
  checksum: string;
  fileName: string;
  sheetName: string;
  exportMode: ExportMode;
  records: AnyLine[];
  stats: ImportStats;
  mapping: ConfirmedMapping;
  templateId?: string;
  /** Which module the lines belong to (default: sales). */
  module?: ModuleId;
  /** Allow importing a file whose checksum was imported before (default: refuse). */
  allowSameChecksum?: boolean;
  /** Choices for ambiguous changes. Defaults to `defaultPolicy`. */
  policy?: ImportPolicy;
  /** The user explicitly confirmed the destructive / ambiguous consequences shown in the preview. */
  confirmed?: boolean;
  /** Extra facts stored on the import row (e.g. purchasing discount mode). */
  extra?: Partial<ImportRow>;
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
async function rowsByDocKeys(db: AppDB, m: ModuleId, docs: string[]): Promise<Line[]> {
  if (docs.length === 0) return [];
  if (docs.length <= 400) return table(db, m).where('docKey').anyOf(docs).toArray();
  const wanted = new Set(docs);
  return table(db, m).filter((r) => Boolean(r.docKey) && wanted.has(r.docKey!)).toArray();
}

/** Marks stored lines as replaced. Primary-key reads/writes only, so it stays fast for thousands of lines. */
async function markSuperseded(db: AppDB, m: ModuleId, keys: string[], by: string): Promise<void> {
  if (keys.length === 0) return;
  const rows = (await table(db, m).bulkGet(keys)).filter((r): r is Line => Boolean(r) && !r!.supersededBy);
  await table(db, m).bulkPut(rows.map((r) => ({ ...r, supersededBy: by })));
}

async function loadExisting(db: AppDB, m: ModuleId, records: AnyLine[]) {
  const keys = records.map((r) => r.key);
  const found = await table(db, m).bulkGet(keys);
  const existingByKey = new Map<string, ExistingLine>();
  found.forEach((f) => f && existingByKey.set(f.key, f));
  const docs = [...new Set(records.map((r) => docKey(r)).filter((d): d is string => Boolean(d)))];
  const existingActiveByDoc = new Map<string, ExistingLine[]>();
  if (docs.length) {
    const rows = await rowsByDocKeys(db, m, docs);
    for (const r of rows) {
      if (r.supersededBy || r.heldBy || r.discarded || !r.docKey) continue;
      (existingActiveByDoc.get(r.docKey) ?? existingActiveByDoc.set(r.docKey, []).get(r.docKey)!).push(r);
    }
  }
  return { existingByKey, existingActiveByDoc };
}

const isActive = (r: Line) => !r.supersededBy && !r.heldBy && !r.discarded;

/** Date range of ACTIVE stored data (used by the content-only choices). */
async function storedRange(db: AppDB, m: ModuleId): Promise<{ min: string; max: string } | undefined> {
  const first = await table(db, m).orderBy('date').filter(isActive).first();
  if (!first) return undefined;
  const last = await table(db, m).orderBy('date').reverse().filter(isActive).first();
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
  /** Sales: documents whose number is also used by a stored document of another year (numbering restarts yearly): kept as separate documents. */
  sharedNumberDocs: number;
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

async function plan(db: AppDB, m: ModuleId, records: AnyLine[], mode: ExportMode, policyIn?: ImportPolicy) {
  const { existingByKey, existingActiveByDoc } = await loadExisting(db, m, records);
  const { identity, coverage } = identityOf(records);
  let overlapRisk = false;
  const range = await storedRange(db, m);
  if (identity !== 'document' && records.length) {
    const dates = records.map((r) => r.date).sort();
    const lo = dates[0]!;
    const hi = dates[dates.length - 1]!;
    // existence check with early exit (an index range over many equal dates is slow; a filtered scan stops at the first hit)
    overlapRisk = Boolean(await table(db, m).filter((r) => r.date >= lo && r.date <= hi && isActive(r)).first());
  }
  const proposed = defaultPolicy(mode, identity, overlapRisk);
  const policy = policyIn ?? proposed;
  const mp = planMerge(records as LineLike[], existingByKey, existingActiveByDoc, { mode, policy, stored: range, yearScoped: m === 'sales' }) as MergePlan<AnyLine>;
  return { mp, identity, coverage, overlapRisk, proposed, policy };
}

/** Dry run shown to the user before they confirm. Writes nothing. */
export async function previewImport(db: AppDB, records: AnyLine[], mode: ExportMode, policyIn?: ImportPolicy, module: ModuleId = 'sales'): Promise<MergePreview> {
  const { mp, identity, coverage, overlapRisk, proposed, policy } = await plan(db, module, records, mode, policyIn);
  // stored documents inside the file's date range that the file does not contain (reported only)
  let absentDocs = 0;
  if (identity === 'document' && records.length) {
    const dates = records.map((r) => r.date).sort();
    const present = new Set(records.map((r) => docKey(r)).filter(Boolean) as string[]);
    const lo = dates[0]!;
    const hi = dates[dates.length - 1]!;
    const absent = new Set<string>();
    await table(db, module).each((r) => {
      if (r.date >= lo && r.date <= hi && isActive(r) && r.docKey && !present.has(r.docKey)) absent.add(r.docKey);
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
    removedDocs: mp.docs.removed, omittedDocs: mp.docs.omitted, heldLines: mp.toHold.length, heldDocs: mp.docs.held, additionsDocs: mp.docs.additions, newDocs: mp.docs.added, sharedNumberDocs: mp.docs.sharedNumber,
    absentDocs, skippedLines: mp.skipped, overlapRisk, needsConfirmation: needs, ambiguous: mp.toHold.length,
  };
}

/**
 * Stores the import. Nothing is ever deleted: replaced lines are kept (`supersededBy`), ambiguous lines are held (`heldBy`),
 * and every change is written to the audit log. Destructive / ambiguous consequences require `confirmed: true`.
 */
export async function commitImport(db: AppDB, input: CommitInput): Promise<CommitResult> {
  const module = input.module ?? 'sales';
  if (!input.allowSameChecksum) {
    const existing = await findByChecksum(db, input.checksum);
    if (existing) return { status: 'duplicate_file', existing };
  }
  const preview = await previewImport(db, input.records, input.exportMode, input.policy, module);
  if (preview.needsConfirmation.length > 0 && !input.confirmed) return { status: 'needs_confirmation', preview };
  const tbl = table(db, module);
  return db.transaction('rw', db.imports, tbl as unknown as Table, db.audit, async () => {
    const { mp, identity, coverage, policy } = await plan(db, module, input.records, input.exportMode, input.policy);
    const id = newId();
    const row: ImportRow = {
      id, module, checksum: input.checksum, fileName: input.fileName, sheetName: input.sheetName, importedAt: Date.now(), exportMode: input.exportMode, stats: input.stats,
      added: mp.toAdd.length, duplicates: mp.duplicates, conflicts: mp.toHold.length, revisedDocs: mp.docs.replaced, supersededLines: mp.supersede.length, staleLines: mp.stale,
      heldLines: mp.toHold.length, heldDocs: mp.docs.held, removedDocs: mp.docs.removed, skippedLines: mp.skipped,
      policy: { conflicts: policy.conflicts, content: policy.content }, confirmed: Boolean(input.confirmed),
      identity, idCoverage: coverage, mapping: input.mapping, templateId: input.templateId, ...input.extra,
    };
    await db.imports.add(row);
    await markSuperseded(db, module, mp.supersede, id);
    await tbl.bulkPut(mp.toAdd.map((r): Line => ({ ...r, importId: id, docKey: docKey(r) })));
    await tbl.bulkPut(mp.toHold.map((r): Line => ({ ...r, importId: id, docKey: docKey(r), heldBy: id, replaces: mp.holdReplaces.get(docKey(r) ?? '') ?? [] })));
    await db.audit.add({
      at: Date.now(), importId: id, action: 'import',
      detail: { module, file: input.fileName, mode: input.exportMode, conflicts: policy.conflicts, content: policy.content, confirmed: Boolean(input.confirmed), added: row.added, duplicates: row.duplicates, replacedDocs: row.revisedDocs, supersededLines: row.supersededLines, removedDocs: mp.docs.removed, heldLines: row.heldLines ?? 0, stale: row.staleLines },
    });
    return { status: 'ok' as const, import: row };
  });
}

function strip<T extends { importId?: string }>(rows: T[]): unknown[] {
  return (rows as (T & StoredMeta)[]).map(({ docKey: _d, supersededBy: _s, heldBy: _h, discarded: _x, replaces: _p, ...r }) => {
    void _d; void _s; void _h; void _x; void _p;
    return r;
  });
}

/** Active (not superseded / held / discarded) lines with provenance (`importId`, `sourceRow`). */
export async function loadAllSales(db: AppDB): Promise<SalesRecord[]> {
  return strip(await db.sales.filter(isActive as never).toArray()) as SalesRecord[];
}
export async function loadAllPurchases(db: AppDB): Promise<PurchaseRecord[]> {
  return strip(await db.purchases.filter(isActive as never).toArray()) as PurchaseRecord[];
}

export async function loadAllFinance(db: AppDB): Promise<FinanceRecord[]> {
  return strip(await db.finance.filter(isActive as never).toArray()) as FinanceRecord[];
}
export async function loadAllInventory(db: AppDB): Promise<InventoryRecord[]> {
  return strip(await db.inventory.filter(isActive as never).toArray()) as InventoryRecord[];
}

/** Lines waiting for the user's decision (all modules unless one is given). */
export async function pendingHeldCount(db: AppDB, module?: ModuleId): Promise<number> {
  let n = 0;
  for (const m of module ? [module] : MODULES) n += await table(db, m).where('heldBy').aboveOrEqual('').filter((r) => !r.discarded).count();
  return n;
}

// ───────── conflict review ─────────
/** A stored line as the conflict review shows it. Inventory lines get `amount` = their value (0 when unvalued). */
export type ConflictLine = AnyLine & StoredMeta & { amount: number };
const asConflictLine = (r: Line): ConflictLine => {
  const x = r as unknown as { amount?: number; outstanding?: number; value?: number; kind?: string };
  // sales / purchase lines already have an amount; inventory lines show their value; finance snapshot lines their OUTSTANDING balance, finance flows their amount
  if (typeof x.amount === 'number' && x.kind === undefined) return r as ConflictLine;
  const snapshot = x.kind === 'open_item' || x.kind === 'aging' || x.kind === 'balance';
  return { ...r, amount: (snapshot ? x.outstanding : x.amount) ?? x.outstanding ?? x.value ?? 0 } as ConflictLine;
};

export interface ConflictGroup {
  module: ModuleId;
  importId: string;
  fileName: string;
  /** null = lines without a document number */
  docKey: string | null;
  held: ConflictLine[];
  /** The stored, active lines of the same document (empty for lines without a document number). */
  stored: ConflictLine[];
}

export async function listConflicts(db: AppDB): Promise<ConflictGroup[]> {
  const imports = new Map((await db.imports.toArray()).map((i) => [i.id, i.fileName]));
  const out: ConflictGroup[] = [];
  for (const m of MODULES) {
    const held = await table(db, m).where('heldBy').aboveOrEqual('').filter((r) => !r.discarded).toArray();
    const groups = new Map<string, ConflictGroup>();
    for (const r of held) {
      const k = `${r.heldBy}|${r.docKey ?? ''}`;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { module: m, importId: r.heldBy!, fileName: imports.get(r.heldBy!) ?? '?', docKey: r.docKey ?? null, held: [], stored: [] }));
      g.held.push(asConflictLine(r));
    }
    const docs = [...new Set([...groups.values()].map((g) => g.docKey).filter((d): d is string => Boolean(d)))];
    if (docs.length) {
      const rows = (await rowsByDocKeys(db, m, docs)).filter(isActive);
      for (const g of groups.values()) if (g.docKey) g.stored = rows.filter((r) => r.docKey === g.docKey).map(asConflictLine);
    }
    out.push(...groups.values());
  }
  return out.sort((a, b) => (a.docKey ?? '').localeCompare(b.docKey ?? ''));
}

export type ResolveAction = 'use_new' | 'keep_stored' | 'keep_both';

/**
 * use_new      – stored lines of the document are replaced by the held ones (old lines kept for audit)
 * keep_stored  – held lines are discarded (kept for audit)
 * keep_both    – held lines are added next to the stored ones (may double count; the user chose it)
 * Lines without a document number have nothing to replace: use_new / keep_both both add them.
 */
export async function resolveConflicts(db: AppDB, items: { importId: string; docKey: string | null; module?: ModuleId }[], action: ResolveAction): Promise<number> {
  let touched = 0;
  await db.transaction('rw', [db.sales, db.purchases, db.inventory, db.finance, db.audit], async () => {
    for (const it of items) {
      const m = it.module ?? 'sales';
      const tbl = table(db, m);
      const held = await tbl.where('heldBy').equals(it.importId).filter((r) => (r.docKey ?? null) === it.docKey && !r.discarded).toArray();
      if (held.length === 0) continue;
      if (action === 'keep_stored') {
        await tbl.bulkPut(held.map((r) => { const { heldBy: _h, replaces: _r, ...rest } = r; void _h; void _r; return { ...rest, discarded: true } as Line; }));
      } else {
        if (action === 'use_new' && it.docKey) {
          // only the stored lines this version actually replaces – lines the new version also contains stay untouched
          const keys = [...new Set(held.flatMap((r) => r.replaces ?? []))];
          if (keys.length) {
            const rows = (await tbl.bulkGet(keys)).filter((r): r is Line => Boolean(r) && isActive(r!));
            await tbl.bulkPut(rows.map((r) => ({ ...r, supersededBy: it.importId })));
          }
        }
        await tbl.bulkPut(held.map((r) => { const { heldBy: _h, replaces: _r, ...rest } = r; void _h; void _r; return rest as Line; }));
      }
      touched += held.length;
      await db.audit.add({ at: Date.now(), importId: it.importId, action: 'resolve_conflict', detail: { module: m, doc: it.docKey ?? '(no document number)', action, lines: held.length } });
    }
  });
  return touched;
}

export async function deleteImport(db: AppDB, id: string): Promise<void> {
  const row = await db.imports.get(id);
  if (row?.module === 'universal') {
    await db.transaction('rw', [db.imports, db.universal, db.audit], async () => {
      await db.universal.where('importId').equals(id).delete();
      await db.imports.delete(id);
      await db.audit.add({ at: Date.now(), importId: id, action: 'delete_import', detail: { module: 'universal' } });
    });
    return;
  }
  const m: ModuleId = (row?.module as ModuleId | undefined) ?? 'sales';
  const tbl = table(db, m);
  await db.transaction('rw', [db.imports, db.sales, db.purchases, db.inventory, db.finance, db.audit], async () => {
    const own = await tbl.where('importId').equals(id).count();
    await tbl.where('importId').equals(id).delete();
    // lines this import had replaced become active again
    let restored = 0;
    await tbl.where('importId').notEqual(id).filter((r) => r.supersededBy === id).modify((r) => {
      delete r.supersededBy;
      restored++;
    });
    await db.imports.delete(id);
    await db.audit.add({ at: Date.now(), importId: id, action: 'delete_import', detail: { module: m, removedLines: own, restoredLines: restored } });
  });
}

/** "Delete everything": removes every table's contents. */
export async function wipeAll(db: AppDB): Promise<void> {
  await db.transaction('rw', [db.imports, db.sales, db.purchases, db.inventory, db.finance, db.universal, db.links, db.reviews, db.missed, db.pilot, db.mappings, db.settings, db.audit], async () => {
    await Promise.all([db.reviews.clear(), db.missed.clear(), db.pilot.clear(), db.imports.clear(), db.sales.clear(), db.purchases.clear(), db.inventory.clear(), db.finance.clear(), db.universal.clear(), db.links.clear(), db.mappings.clear(), db.settings.clear(), db.audit.clear()]);
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
  sales: (SalesRecord & StoredMeta)[];
  purchases?: (PurchaseRecord & StoredMeta)[];
  inventory?: (InventoryRecord & StoredMeta)[];
  finance?: (FinanceRecord & StoredMeta)[];
  universal?: import('./db').StoredUniversal[];
  links?: import('./db').StoredLink[];
  reviews?: import('@/engine/pilot/types').Review[];
  missed?: import('@/engine/pilot/types').Missed[];
  pilot?: import('@/engine/pilot/types').PilotMeta[];
  mappings: SavedMapping[];
  audit?: import('./db').AuditEntry[];
}

export async function exportBackup(db: AppDB): Promise<Backup> {
  return { version: 1, exportedAt: new Date().toISOString(), imports: await db.imports.toArray(), sales: await db.sales.toArray(), purchases: await db.purchases.toArray(), inventory: await db.inventory.toArray(), finance: await db.finance.toArray(), universal: await db.universal.toArray(), links: await db.links.toArray(), reviews: await db.reviews.toArray(), missed: await db.missed.toArray(), pilot: await db.pilot.toArray(), mappings: await db.mappings.toArray(), audit: await db.audit.toArray() };
}

export async function restoreBackup(db: AppDB, b: Backup): Promise<void> {
  if (b?.version !== 1 || !Array.isArray(b.imports) || !Array.isArray(b.sales)) throw new Error('invalid_backup');
  await db.transaction('rw', [db.imports, db.sales, db.purchases, db.inventory, db.finance, db.universal, db.links, db.reviews, db.missed, db.pilot, db.mappings, db.audit], async () => {
    await db.imports.bulkPut(b.imports);
    if (Array.isArray(b.reviews)) await db.reviews.bulkPut(b.reviews);
    if (Array.isArray(b.missed)) await db.missed.bulkPut(b.missed);
    if (Array.isArray(b.pilot)) await db.pilot.bulkPut(b.pilot);
    if (Array.isArray(b.universal)) await db.universal.bulkPut(b.universal);
    if (Array.isArray(b.links)) await db.links.bulkPut(b.links);
    await db.sales.bulkPut(b.sales.map((r) => ({ ...r, docKey: docKey(r) })) as never);
    if (Array.isArray(b.purchases)) await db.purchases.bulkPut(b.purchases.map((r) => ({ ...r, docKey: docKey(r) })) as never);
    if (Array.isArray(b.inventory)) await db.inventory.bulkPut(b.inventory.map((r) => ({ ...r, docKey: docKey(r) })) as never);
    if (Array.isArray(b.finance)) await db.finance.bulkPut(b.finance.map((r) => ({ ...r, docKey: docKey(r) })) as never);
    await db.mappings.bulkPut(b.mappings ?? []);
    if (Array.isArray(b.audit)) await db.audit.bulkPut(b.audit.map(({ id: _id, ...a }) => (void _id, a)));
  });
}

// ───────── cross-module link decisions (the user's own; only `confirmed` ones ever join data) ─────────
export async function decideLink(db: AppDB, link: Pick<import('./db').StoredLink, 'id' | 'kind' | 'a' | 'b' | 'basis' | 'evidence'>, status: 'confirmed' | 'rejected'): Promise<void> {
  await db.transaction('rw', [db.links, db.audit], async () => {
    await db.links.put({ ...link, status, decidedAt: Date.now() });
    await db.audit.add({ at: Date.now(), action: 'link_decision', detail: { link: link.id, status, kind: link.kind, basis: link.basis } });
  });
}
export async function clearLink(db: AppDB, id: string): Promise<void> {
  await db.transaction('rw', [db.links, db.audit], async () => {
    await db.links.delete(id);
    await db.audit.add({ at: Date.now(), action: 'link_decision', detail: { link: id, status: 'undone' } });
  });
}
export const listLinks = (db: AppDB) => db.links.toArray();

// ───────── pilot review data (the reviewer's own decisions; local, audited, backed up, wiped with everything else) ─────────
export async function saveReview(db: AppDB, r: import('@/engine/pilot/types').Review): Promise<void> {
  await db.transaction('rw', [db.reviews, db.audit], async () => {
    await db.reviews.put(r);
    await db.audit.add({ at: Date.now(), action: 'review_decision', detail: { finding: r.id, decision: r.decision, category: r.category } });
  });
}
export async function clearReview(db: AppDB, id: string): Promise<void> {
  await db.transaction('rw', [db.reviews, db.audit], async () => { await db.reviews.delete(id); await db.audit.add({ at: Date.now(), action: 'review_decision', detail: { finding: id, decision: 'cleared' } }); });
}
export const saveMissed = (db: AppDB, m: import('@/engine/pilot/types').Missed) => db.missed.put(m);
export const deleteMissed = (db: AppDB, id: string) => db.missed.delete(id);
export const savePilotMeta = (db: AppDB, m: import('@/engine/pilot/types').PilotMeta) => db.pilot.put({ ...m, updatedAt: Date.now() });
