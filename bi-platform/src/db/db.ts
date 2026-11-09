import Dexie, { type Table } from 'dexie';
import { docKey } from '@/engine/import/merge';
import type { ConfirmedMapping, ExportMode, ImportStats, SalesField, SalesRecord } from '@/engine/types';

/** Everything below lives ONLY in this browser's IndexedDB. Nothing here is ever sent anywhere. */
export interface ImportRow {
  id: string;
  checksum: string;
  fileName: string;
  sheetName: string;
  importedAt: number;
  exportMode: ExportMode;
  stats: ImportStats;
  /** Lines added to the store by this import (the rest were duplicates / conflicts). */
  added: number;
  duplicates: number;
  /** Lines added to already-stored documents in 'incremental' mode (cannot be told from corrections). */
  conflicts: number;
  revisedDocs: number;
  supersededLines: number;
  staleLines: number;
  /** Lines stored but held out of analytics until the user decides (ambiguous changes). */
  heldLines?: number;
  heldDocs?: number;
  /** Documents that lost lines with no replacement (only from an explicitly confirmed full snapshot). */
  removedDocs?: number;
  /** Lines skipped by the "only new dates" choice. */
  skippedLines?: number;
  /** The choices that were applied (and confirmed). */
  policy?: { conflicts: string; content: string };
  confirmed?: boolean;
  /** How reliable transaction identity was for this file. */
  identity: 'document' | 'mixed' | 'content';
  idCoverage: number;
  mapping: ConfirmedMapping;
  templateId?: string;
}

export interface StoredRecord extends SalesRecord {
  importId: string;
  docKey?: string;
  /** Import that replaced this line with a corrected version. Superseded lines are kept for audit but excluded from analytics. */
  supersededBy?: string;
  /** Import that holds this line for review: excluded from analytics until the user resolves it. */
  heldBy?: string;
  /** For held lines: the stored lines a "use new version" decision would replace. */
  replaces?: string[];
  /** The user kept the stored version instead; retained for audit. */
  discarded?: boolean;
}

export interface SavedMapping {
  /** layout signature (normalised, sorted header names) */
  signature: string;
  /** field → normalised header */
  fields: Partial<Record<SalesField, string>>;
  defaultCurrency?: string;
  updatedAt: number;
}

export interface AuditEntry {
  id?: number;
  at: number;
  importId?: string;
  action: 'import' | 'delete_import' | 'resolve_conflict';
  detail: Record<string, string | number | boolean>;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export class AppDB extends Dexie {
  imports!: Table<ImportRow, string>;
  sales!: Table<StoredRecord, string>;
  mappings!: Table<SavedMapping, string>;
  settings!: Table<SettingRow, string>;
  audit!: Table<AuditEntry, number>;

  constructor(name = 'bi-platform') {
    super(name);
    this.version(1).stores({
      imports: 'id, checksum, importedAt',
      sales: 'key, importId, date',
      mappings: 'signature',
      settings: 'key',
    });
    this.version(2)
      .stores({ sales: 'key, importId, date, docKey' })
      .upgrade((tx) =>
        tx.table('sales').toCollection().modify((r: StoredRecord) => {
          r.docKey = docKey(r);
        }),
      );
    this.version(3).stores({ sales: 'key, importId, date, docKey, heldBy', audit: '++id, at, importId' });
  }
}

let shared: AppDB | null = null;
export function getDb(): AppDB {
  if (!shared) shared = new AppDB();
  return shared;
}
