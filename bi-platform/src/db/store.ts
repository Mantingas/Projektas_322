import type { ConfirmedMapping, ExportMode, ImportStats, SalesRecord } from '@/engine/types';
import { docKey, identityOf, planMerge, type ExistingLine, type Identity } from '@/engine/import/merge';
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
}

export type CommitResult =
  | { status: 'duplicate_file'; existing: ImportRow }
  | { status: 'ok'; import: ImportRow };

export const newId = () => `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export async function findByChecksum(db: AppDB, checksum: string): Promise<ImportRow | undefined> {
  return db.imports.where('checksum').equals(checksum).first();
}

async function loadExisting(db: AppDB, records: SalesRecord[]) {
  const keys = records.map((r) => r.key);
  const found = await db.sales.bulkGet(keys);
  const existingByKey = new Map<string, ExistingLine>();
  found.forEach((f) => f && existingByKey.set(f.key, f));
  const docs = [...new Set(records.map(docKey).filter((d): d is string => Boolean(d)))];
  const existingActiveByDoc = new Map<string, ExistingLine[]>();
  if (docs.length) {
    const rows = await db.sales.where('docKey').anyOf(docs).toArray();
    for (const r of rows) {
      if (r.supersededBy || !r.docKey) continue;
      (existingActiveByDoc.get(r.docKey) ?? existingActiveByDoc.set(r.docKey, []).get(r.docKey)!).push(r);
    }
  }
  return { existingByKey, existingActiveByDoc };
}

export interface MergePreview {
  added: number;
  duplicates: number;
  stale: number;
  revisedDocs: number;
  supersededLines: number;
  ambiguous: number;
  identity: Identity;
  idCoverage: number;
  /** Content-only identity AND the date range overlaps data that is already stored → double-counting cannot be ruled out. */
  overlapRisk: boolean;
}

/** Dry run shown to the user before they confirm. Writes nothing. */
export async function previewImport(db: AppDB, records: SalesRecord[], mode: ExportMode): Promise<MergePreview> {
  const { existingByKey, existingActiveByDoc } = await loadExisting(db, records);
  const plan = planMerge(records, existingByKey, existingActiveByDoc, mode);
  const { identity, coverage } = identityOf(records);
  let overlapRisk = false;
  if (identity !== 'document' && records.length) {
    const dates = records.map((r) => r.date).sort();
    const lo = dates[0]!;
    const hi = dates[dates.length - 1]!;
    overlapRisk = (await db.sales.where('date').between(lo, hi, true, true).filter((r) => !r.supersededBy).count()) > 0;
  }
  return { added: plan.toAdd.length, duplicates: plan.duplicates, stale: plan.stale, revisedDocs: plan.revisedDocs, supersededLines: plan.supersede.length, ambiguous: plan.ambiguous, identity, idCoverage: coverage, overlapRisk };
}

/**
 * Stores new lines, never silently drops a corrected one: replaced lines are kept (flagged `supersededBy`) so the change can be
 * audited and undone by deleting the import.
 */
export async function commitImport(db: AppDB, input: CommitInput): Promise<CommitResult> {
  if (!input.allowSameChecksum) {
    const existing = await findByChecksum(db, input.checksum);
    if (existing) return { status: 'duplicate_file', existing };
  }
  return db.transaction('rw', db.imports, db.sales, async () => {
    const { existingByKey, existingActiveByDoc } = await loadExisting(db, input.records);
    const plan = planMerge(input.records, existingByKey, existingActiveByDoc, input.exportMode);
    const { identity, coverage } = identityOf(input.records);
    const id = newId();
    const row: ImportRow = {
      id,
      checksum: input.checksum,
      fileName: input.fileName,
      sheetName: input.sheetName,
      importedAt: Date.now(),
      exportMode: input.exportMode,
      stats: input.stats,
      added: plan.toAdd.length,
      duplicates: plan.duplicates,
      conflicts: plan.ambiguous,
      revisedDocs: plan.revisedDocs,
      supersededLines: plan.supersede.length,
      staleLines: plan.stale,
      identity,
      idCoverage: coverage,
      mapping: input.mapping,
      templateId: input.templateId,
    };
    await db.imports.add(row);
    if (plan.supersede.length) await db.sales.where('key').anyOf(plan.supersede).modify({ supersededBy: id });
    await db.sales.bulkPut(plan.toAdd.map((r): StoredRecord => ({ ...r, importId: id, docKey: docKey(r) })));
    return { status: 'ok' as const, import: row };
  });
}

/** Active (not superseded) lines with provenance (`importId`, `sourceRow`). */
export async function loadAllSales(db: AppDB): Promise<SalesRecord[]> {
  const rows = await db.sales.filter((r) => !r.supersededBy).toArray();
  return rows.map(({ docKey: _d, supersededBy: _s, ...r }) => {
    void _d;
    void _s;
    return r;
  });
}

export async function deleteImport(db: AppDB, id: string): Promise<void> {
  await db.transaction('rw', db.imports, db.sales, async () => {
    await db.sales.where('importId').equals(id).delete();
    // lines this import had replaced become active again
    await db.sales.where('importId').notEqual(id).filter((r) => r.supersededBy === id).modify((r) => {
      delete r.supersededBy;
    });
    await db.imports.delete(id);
  });
}

/** "Delete everything": removes every table's contents. */
export async function wipeAll(db: AppDB): Promise<void> {
  await db.transaction('rw', db.imports, db.sales, db.mappings, db.settings, async () => {
    await Promise.all([db.imports.clear(), db.sales.clear(), db.mappings.clear(), db.settings.clear()]);
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
}

export async function exportBackup(db: AppDB): Promise<Backup> {
  return { version: 1, exportedAt: new Date().toISOString(), imports: await db.imports.toArray(), sales: await db.sales.toArray(), mappings: await db.mappings.toArray() };
}

export async function restoreBackup(db: AppDB, b: Backup): Promise<void> {
  if (b?.version !== 1 || !Array.isArray(b.imports) || !Array.isArray(b.sales)) throw new Error('invalid_backup');
  await db.transaction('rw', db.imports, db.sales, db.mappings, async () => {
    await db.imports.bulkPut(b.imports);
    await db.sales.bulkPut(b.sales.map((r) => ({ ...r, docKey: docKey(r) })));
    await db.mappings.bulkPut(b.mappings ?? []);
  });
}
