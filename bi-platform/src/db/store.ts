import type { ConfirmedMapping, ExportMode, ImportStats, SalesRecord } from '@/engine/types';
import { docKey, planMerge } from '@/engine/import/merge';
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

/** Adds only lines that are not stored yet, so overlapping exports are never double-counted. */
export async function commitImport(db: AppDB, input: CommitInput): Promise<CommitResult> {
  if (!input.allowSameChecksum) {
    const existing = await findByChecksum(db, input.checksum);
    if (existing) return { status: 'duplicate_file', existing };
  }
  return db.transaction('rw', db.imports, db.sales, async () => {
    const keys = input.records.map((r) => r.key);
    const found = await db.sales.bulkGet(keys);
    const existingKeys = new Set<string>();
    found.forEach((f, i) => f && existingKeys.add(keys[i]!));
    // documents that are already stored
    const docIds = [...new Set(input.records.map(docKey).filter((d): d is string => Boolean(d)))];
    const existingDocs = new Set<string>();
    if (docIds.length) {
      const all = await db.sales.toArray();
      const wanted = new Set(docIds);
      for (const r of all) {
        const d = docKey(r);
        if (d && wanted.has(d)) existingDocs.add(d);
      }
    }
    const plan = planMerge(input.records, existingKeys, existingDocs);
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
      conflicts: plan.conflicts.length,
      mapping: input.mapping,
      templateId: input.templateId,
    };
    await db.imports.add(row);
    const stored: StoredRecord[] = plan.toAdd.map((r) => ({ ...r, importId: id }));
    await db.sales.bulkPut(stored);
    return { status: 'ok' as const, import: row };
  });
}

export async function loadAllSales(db: AppDB): Promise<SalesRecord[]> {
  const rows = await db.sales.toArray();
  return rows.map(({ importId: _importId, ...r }) => {
    void _importId;
    return r;
  });
}

export async function deleteImport(db: AppDB, id: string): Promise<void> {
  await db.transaction('rw', db.imports, db.sales, async () => {
    await db.sales.where('importId').equals(id).delete();
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
    await db.sales.bulkPut(b.sales);
    await db.mappings.bulkPut(b.mappings ?? []);
  });
}
