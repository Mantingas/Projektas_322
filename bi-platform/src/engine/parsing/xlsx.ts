import ExcelJS from 'exceljs';
import type { CellValue, ParsedFile, RawSheet } from '../types';
import { MAX_CELLS_PER_SHEET, MAX_COLUMNS, MAX_ROW_GAP, MAX_ROWS_PER_SHEET, MAX_SHEETS } from './limits';
import { ParseError } from './errors';
import { sanitizeText } from './text';
import { toIso } from '../schema/dates';

/**
 * Converts one ExcelJS cell value into a plain CellValue.
 * Formulas are NEVER evaluated: only the cached result stored in the file is read.
 */
export function cellToValue(v: ExcelJS.CellValue): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const t = sanitizeText(v).trim();
    return t === '' ? null : t;
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return toIso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('error' in o) return null; // #DIV/0! etc.
    if ('result' in o) return cellToValue(o.result as ExcelJS.CellValue); // formula → cached result
    if ('formula' in o || 'sharedFormula' in o) return null; // formula without cached result
    if ('richText' in o && Array.isArray(o.richText)) {
      const text = (o.richText as { text?: string }[]).map((r) => r.text ?? '').join('');
      return cellToValue(text);
    }
    if ('text' in o) return cellToValue(String(o.text)); // hyperlink
  }
  return null;
}

export async function parseXlsx(bytes: Uint8Array, fileName: string): Promise<ParsedFile> {
  const wb = new ExcelJS.Workbook();
  try {
    // ExcelJS' type wants a Node Buffer; at runtime any Uint8Array/ArrayBuffer works.
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/encrypt|password/i.test(msg)) throw new ParseError('password_protected');
    throw new ParseError('corrupt_file');
  }
  const sheets: RawSheet[] = [];
  let cells = 0;
  for (const ws of wb.worksheets) {
    cells = 0;
    if (sheets.length >= MAX_SHEETS) break;
    if (ws.state === 'veryHidden') continue;
    const rows: CellValue[][] = [];
    let truncated = false;
    let last = 0; // last sheet row number that was emitted
    // Only rows that exist are visited: a sheet that merely DECLARES a million rows costs nothing.
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (truncated) return;
      const gap = rowNumber - last - 1;
      if (rows.length + gap + 1 > MAX_ROWS_PER_SHEET || gap > MAX_ROW_GAP || cells + row.cellCount > MAX_CELLS_PER_SHEET) {
        truncated = true;
        return;
      }
      for (let g = 0; g < gap; g++) rows.push([]); // keep sheet row numbers aligned for blank rows
      const out: CellValue[] = [];
      const colCount = Math.min(row.cellCount, MAX_COLUMNS);
      for (let c = 1; c <= colCount; c++) out.push(cellToValue(row.getCell(c).value));
      cells += colCount;
      rows.push(out);
      last = rowNumber;
    });
    if (rows.some((r) => r.some((c) => c !== null))) sheets.push({ name: sanitizeText(ws.name), rows, truncated });
  }
  if (sheets.length === 0) throw new ParseError('empty_file');
  return { fileName, kind: 'xlsx', sheets };
}
