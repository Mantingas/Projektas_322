import Dexie, { type Table } from 'dexie';
import { REAL_DB, activeDbName } from './dbName';
import { docKey } from '@/engine/import/merge';
import type { Missed, PilotMeta, Review } from '@/engine/pilot/types';
import type { UDataset } from '@/engine/universal/types';
import type { ConfirmedMapping, ExportMode, FieldId, ImportStats, FinanceRecord, InventoryRecord, ModuleId, PurchaseRecord, SalesRecord } from '@/engine/types';

/** Everything below lives ONLY in this browser's IndexedDB. Nothing here is ever sent anywhere. */
export interface ImportRow {
  id: string;
  /** Which module the file belongs to (rows stored before purchasing existed have none = sales). */
  module?: ModuleId | 'universal';
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
  /** Purchasing: what the arithmetic showed about discount columns (none / included / deducted / unverified). */
  discountMode?: string;
  /** Inventory: what the file was recognised as (snapshot / valuation / history / movements). */
  inventoryKind?: string;
  /** Finance: what the file was recognised as (open_items / aging / balance / invoices / payments / credit_notes) and which side. */
  financeKind?: string;
  financeSide?: string;
  /** How reliable transaction identity was for this file. */
  identity: 'document' | 'mixed' | 'content';
  idCoverage: number;
  mapping: ConfirmedMapping;
  templateId?: string;
}

/** Bookkeeping shared by the stored lines of every module. */
export interface StoredMeta {
  importId: string;
  docKey?: string;
  supersededBy?: string;
  heldBy?: string;
  replaces?: string[];
  discarded?: boolean;
}

export type StoredPurchase = PurchaseRecord & StoredMeta;
export type StoredInventory = InventoryRecord & StoredMeta;
export type StoredFinance = FinanceRecord & StoredMeta;
/** A universal (free-form) table: typed columns, kept whole in this browser. */
export type StoredUniversal = UDataset & { importId: string };
/** A cross-module relationship the user decided on. Only `confirmed` links ever join data; `rejected` ones are remembered so they are not proposed again. */
export interface StoredLink {
  id: string;
  kind: 'product' | 'counterparty';
  a: { module: string; key: string; label: string };
  b: { module: string; key: string; label: string };
  basis: 'identifier_equal' | 'user_confirmed';
  status: 'confirmed' | 'rejected';
  evidence: string;
  decidedAt: number;
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
  fields: Partial<Record<FieldId, string>>;
  defaultCurrency?: string;
  updatedAt: number;
}

export interface AuditEntry {
  id?: number;
  at: number;
  importId?: string;
  action: 'import' | 'delete_import' | 'resolve_conflict' | 'link_decision' | 'review_decision';
  detail: Record<string, string | number | boolean>;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export class AppDB extends Dexie {
  imports!: Table<ImportRow, string>;
  sales!: Table<StoredRecord, string>;
  purchases!: Table<StoredPurchase, string>;
  inventory!: Table<StoredInventory, string>;
  finance!: Table<StoredFinance, string>;
  universal!: Table<StoredUniversal, string>;
  links!: Table<StoredLink, string>;
  reviews!: Table<Review, string>;
  missed!: Table<Missed, string>;
  pilot!: Table<PilotMeta, string>;
  mappings!: Table<SavedMapping, string>;
  settings!: Table<SettingRow, string>;
  audit!: Table<AuditEntry, number>;

  constructor(name = REAL_DB) {
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
    // v4: purchasing lines live in their own table; everything else is unchanged
    this.version(4).stores({ purchases: 'key, importId, date, docKey, heldBy' });
    // v5: inventory lines (snapshots and movements) in their own table
    this.version(5).stores({ inventory: 'key, importId, date, docKey, heldBy' });
    // v6: receivables / payables / cash lines (open items, aging, balances, invoices, payments, credit notes)
    this.version(6).stores({ finance: 'key, importId, date, docKey, heldBy' });
    // v7: universal tables and the user's cross-module link decisions
    this.version(7).stores({ universal: 'id, importId', links: 'id, status, kind' });
    // v8: pilot validation – an independent reviewer's decisions, known misses and the pilot's own facts (nothing else changes)
    this.version(8).stores({ reviews: 'id, decision', missed: 'id', pilot: 'key' });
  }
}

let shared: AppDB | null = null;
export function getDb(): AppDB {
  const name = activeDbName();
  // switching between the visitor's workspace and the demo inside one page session must never keep using the other database
  if (shared && shared.name !== name) { shared.close(); shared = null; }
  if (!shared) shared = new AppDB(name);
  return shared;
}
