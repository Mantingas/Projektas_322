import type { CellValue, TableDetection } from '../types';
import type { Decimal } from '../schema/numbers';
import { applyDecisions, materialize, profileUniversal, unresolvedColumns, type ColumnReading } from './profile';
import type { UColumn, UDataset, UType } from './types';

export interface UniversalProfile { columns: UColumn[]; readings: ColumnReading[]; rowCount: number }

export function profileTable(table: Pick<TableDetection, 'headers' | 'dataRows'>, decimalHint: Decimal): UniversalProfile {
  const { columns, readings } = profileUniversal(table.headers, table.dataRows, decimalHint);
  return { columns, readings, rowCount: table.dataRows.length };
}

/** Builds the typed dataset from the user's decisions. Returns the columns that still need a decision instead when any are open. */
export function buildDataset(table: Pick<TableDetection, 'dataRows' | 'dataRowNumbers'>, prof: UniversalProfile, decisions: Record<number, UType>, meta: { id: string; fileName: string; sheetName: string; importedAt: number }): { ok: true; dataset: UDataset } | { ok: false; unresolved: number[] } {
  const open = unresolvedColumns(prof.columns, decisions);
  if (open.length) return { ok: false, unresolved: open };
  const final = applyDecisions(prof.columns, decisions);
  const rows: CellValue[][] = table.dataRows;
  const { cols, columns } = materialize(rows, final, prof.readings);
  return { ok: true, dataset: { ...meta, rowCount: rows.length, columns, cols, rowNumbers: table.dataRowNumbers } };
}
