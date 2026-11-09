import Papa from 'papaparse';
import type { CellValue, ParsedFile, RawSheet } from '../types';
import { MAX_COLUMNS, MAX_ROWS_PER_SHEET } from './limits';
import { ParseError } from './errors';
import { sanitizeText } from './text';

function count(re: RegExp, s: string): number {
  return (s.match(re) ?? []).length;
}

/** UTF-8 if it decodes cleanly; otherwise choose between Windows-1257 (LT) and Windows-1250 (PL) by letter statistics. */
export function decodeCsv(bytes: Uint8Array): { text: string; encoding: string } {
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  const body = start ? bytes.subarray(start) : bytes;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'utf-8' };
  } catch {
    // not UTF-8
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  const t1257 = new TextDecoder('windows-1257').decode(body);
  const t1250 = new TextDecoder('windows-1250').decode(body);
  // Letters that exist in only one alphabet are the discriminators.
  const lt = count(/[čėįšųūžČĖĮŠŲŪŽ]/g, t1257) - count(/[ćłńśźżĆŁŃŚŹŻ]/g, t1257);
  const pl = count(/[ćłńśźżĆŁŃŚŹŻ]/g, t1250) - count(/[čėįšųūžČĖĮŠŲŪŽ]/g, t1250);
  return lt > pl ? { text: t1257, encoding: 'windows-1257' } : { text: t1250, encoding: 'windows-1250' };
}

const CANDIDATES = [';', '\t', '|', ','] as const;

/**
 * Picks the delimiter whose field count is most consistent across the first lines. Papa Parse's own guess fails on narrow files
 * with decimal commas ("2025-01-02;10,00" has the same number of commas as a comma-separated row).
 * Ties go to ';' > TAB > '|' > ',' (the usual order in LT / PL exports).
 */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 60).join('\n');
  let best = ',';
  let bestScore = 0;
  for (const d of CANDIDATES) {
    const rows = Papa.parse<string[]>(sample, { delimiter: d, skipEmptyLines: true }).data;
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    let modal = 0;
    let modalN = 0;
    for (const [len, n] of counts) if (n > modalN || (n === modalN && len > modal)) { modal = len; modalN = n; }
    const score = modal > 1 ? (modalN / Math.max(1, rows.length)) * 100 + Math.min(modal, 20) / 100 : 0;
    if (score > bestScore + 1e-9) { best = d; bestScore = score; }
  }
  return best;
}

export function parseCsv(bytes: Uint8Array, fileName: string): ParsedFile {
  const { text, encoding } = decodeCsv(bytes);
  const result = Papa.parse<string[]>(text, {
    delimiter: detectDelimiter(text),
    skipEmptyLines: false,
    dynamicTyping: false,
  });
  const rows: CellValue[][] = [];
  let truncated = false;
  for (const raw of result.data) {
    if (rows.length >= MAX_ROWS_PER_SHEET) {
      truncated = true;
      break;
    }
    const cells = raw.slice(0, MAX_COLUMNS).map((c): CellValue => {
      const t = sanitizeText(String(c)).trim();
      return t === '' ? null : t;
    });
    rows.push(cells);
  }
  if (!rows.some((r) => r.some((c) => c !== null))) throw new ParseError('empty_file');
  const sheet: RawSheet = { name: fileName.replace(/\.[^.]+$/, ''), rows, truncated };
  return { fileName, kind: 'csv', sheets: [sheet], encoding, delimiter: result.meta.delimiter };
}
