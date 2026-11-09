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

export function parseCsv(bytes: Uint8Array, fileName: string): ParsedFile {
  const { text, encoding } = decodeCsv(bytes);
  const result = Papa.parse<string[]>(text, {
    delimitersToGuess: [';', ',', '\t', '|'],
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
