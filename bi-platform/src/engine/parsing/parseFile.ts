import type { ParsedFile } from '../types';
import { MAX_FILE_BYTES } from './limits';
import { ParseError } from './errors';
import { parseCsv } from './csv';
import { parseXlsx } from './xlsx';
import { inspectZip } from './zip';

export { ParseError } from './errors';

function ext(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1]!.toLowerCase() : '';
}

/** Entry point: bytes + file name → raw sheets. Never executes macros or formulas. */
export async function parseFile(bytes: Uint8Array, fileName: string): Promise<ParsedFile> {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new ParseError('file_too_large');
  if (bytes.byteLength === 0) throw new ParseError('empty_file');
  const e = ext(fileName);
  if (e === 'xls') throw new ParseError('legacy_xls');
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (isOle) throw new ParseError('legacy_xls'); // legacy .xls or an encrypted OOXML container
  if (e === 'xlsx' || e === 'xlsm') {
    if (!isZip) throw new ParseError('corrupt_file');
    inspectZip(bytes); // before anything is inflated
    return parseXlsx(bytes, fileName);
  }
  if (e === 'csv' || e === 'tsv' || e === 'txt') return parseCsv(bytes, fileName);
  throw new ParseError('unsupported_format');
}
