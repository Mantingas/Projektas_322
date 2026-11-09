import type { ColumnProfile, ConfirmedMapping, MappingEntry, MappingProposal, RawSheet, SalesField, TableDetection } from './types';
import { detectTable } from './schema/header';
import { profileColumns } from './schema/profile';
import type { Decimal } from './schema/numbers';
import { layoutSignature, suggestMapping } from './mapping/mapper';

export interface SheetAnalysis {
  table: TableDetection;
  profiles: ColumnProfile[];
  proposal: MappingProposal;
  signature: string;
}

/** Steps 1–3: find the table, profile its columns, propose a mapping. Nothing is imported yet. */
export function analyzeSheet(sheet: RawSheet, opts: { decimalHint?: Decimal; savedMapping?: Partial<Record<SalesField, string>> } = {}): SheetAnalysis | null {
  const table = detectTable(sheet.rows);
  if (!table || table.dataRows.length === 0) return null;
  const profiles = profileColumns(table.headers, table.dataRows, opts.decimalHint ?? ',');
  const proposal = suggestMapping(profiles, { saved: opts.savedMapping });
  return { table, profiles, proposal, signature: layoutSignature(table.headers) };
}

export function confirmedFromEntries(entries: Pick<MappingEntry, 'field' | 'columnIndex'>[], defaultCurrency?: string): ConfirmedMapping {
  const columns: ConfirmedMapping['columns'] = {};
  for (const e of entries) columns[e.field] = e.columnIndex;
  return { columns, defaultCurrency };
}
