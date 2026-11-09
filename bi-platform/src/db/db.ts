import Dexie, { type Table } from 'dexie';
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
  conflicts: number;
  mapping: ConfirmedMapping;
  templateId?: string;
}

export interface StoredRecord extends SalesRecord {
  importId: string;
}

export interface SavedMapping {
  /** layout signature (normalised, sorted header names) */
  signature: string;
  /** field → normalised header */
  fields: Partial<Record<SalesField, string>>;
  defaultCurrency?: string;
  updatedAt: number;
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

  constructor(name = 'bi-platform') {
    super(name);
    this.version(1).stores({
      imports: 'id, checksum, importedAt',
      sales: 'key, importId, date',
      mappings: 'signature',
      settings: 'key',
    });
  }
}

let shared: AppDB | null = null;
export function getDb(): AppDB {
  if (!shared) shared = new AppDB();
  return shared;
}
