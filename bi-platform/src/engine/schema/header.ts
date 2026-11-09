import type { CellValue, TableDetection } from '../types';
import { SALES_SYNONYMS } from '../mapping/dictionary';
import { normalizeHeader } from '../mapping/normalize';
import { looksLikeDate } from './dates';
import { interpretNumberString } from './numbers';

const ALL_SYNONYMS = new Set(Object.values(SALES_SYNONYMS).flat());
const TOTAL_WORDS = /^(iso|is viso|viso|bendra suma|bendrai|tarpine suma|razem|ogolem|suma koncowa|podsumowanie|total|totals|grand total|subtotal|sum)\b/;

function nonEmpty(row: CellValue[]): CellValue[] {
  return row.filter((c) => c !== null && c !== '');
}

function isNumericLike(c: CellValue): boolean {
  if (typeof c === 'number') return true;
  if (typeof c !== 'string') return false;
  return interpretNumberString(c) !== null;
}

function isHeaderish(c: CellValue): boolean {
  return typeof c === 'string' && !isNumericLike(c) && !looksLikeDate(c);
}

function synonymHit(c: CellValue): boolean {
  if (typeof c !== 'string') return false;
  const n = normalizeHeader(c);
  if (!n) return false;
  if (ALL_SYNONYMS.has(n)) return true;
  const toks = n.split(' ');
  return toks.length > 1 && [...ALL_SYNONYMS].some((s) => s.split(' ').every((t) => toks.includes(t)) && s.length >= 4);
}

export function isTotalRow(row: CellValue[]): boolean {
  const cells = nonEmpty(row);
  if (cells.length === 0) return false;
  if (cells.some((c) => typeof c === 'string' && looksLikeDate(c))) return false;
  return cells.some((c) => typeof c === 'string' && TOTAL_WORDS.test(normalizeHeader(c)));
}

/** Finds the header row (skipping report titles above the table) and returns headers + data rows. */
export function detectTable(rows: CellValue[][]): TableDetection | null {
  const limit = Math.min(rows.length, 40);
  let best = -1;
  let bestScore = -1;
  let bestHits = 0;
  let bestDataLike = 0;
  for (let r = 0; r < limit; r++) {
    const row = rows[r]!;
    const cells = nonEmpty(row);
    if (cells.length < 2) continue;
    const headerish = cells.filter(isHeaderish).length;
    const strRatio = headerish / cells.length;
    const hits = cells.filter(synonymHit).length;
    // how data-like are the following rows?
    let dataLike = 0;
    let seen = 0;
    for (let k = r + 1; k < rows.length && seen < 5; k++) {
      const nr = nonEmpty(rows[k]!);
      if (nr.length === 0) continue;
      seen++;
      const widthOk = nr.length >= Math.ceil(cells.length * 0.5);
      const hasValue = nr.some((c) => isNumericLike(c) || (typeof c === 'string' && looksLikeDate(c)));
      if (widthOk && hasValue) dataLike++;
    }
    const dataRatio = seen ? dataLike / seen : 0;
    const score = hits * 2 + strRatio * 2 + (cells.length >= 3 ? 1 : 0) + dataRatio * 2;
    if (strRatio >= 0.6 && score > bestScore) {
      best = r;
      bestScore = score;
      bestHits = hits;
      bestDataLike = dataRatio;
    }
  }
  if (best < 0) return null;
  const headerCells = rows[best]!;
  const width = Math.max(headerCells.length, ...rows.slice(best + 1, best + 200).map((r) => r.length));
  const seenNames = new Map<string, number>();
  const headers: string[] = [];
  for (let c = 0; c < width; c++) {
    const raw = headerCells[c];
    let name = raw === null || raw === undefined || raw === '' ? `Column ${c + 1}` : String(raw).trim();
    const n = seenNames.get(name) ?? 0;
    seenNames.set(name, n + 1);
    if (n > 0) name = `${name} (${n + 1})`;
    headers.push(name);
  }
  const dataRows: CellValue[][] = [];
  const dataRowNumbers: number[] = [];
  let skippedTotalRows = 0;
  for (let r = best + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (nonEmpty(row).length === 0) continue;
    if (isTotalRow(row)) {
      skippedTotalRows++;
      continue;
    }
    dataRowNumbers.push(r + 1);
    dataRows.push(row.length < width ? [...row, ...Array<CellValue>(width - row.length).fill(null)] : row);
  }
  const confidence = Math.min(1, 0.35 + 0.15 * Math.min(bestHits, 4) + 0.25 * bestDataLike);
  return { headerRow: best, headers, dataRows, dataRowNumbers, confidence, skippedTotalRows };
}
