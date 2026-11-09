/**
 * Creates an ANONYMISED compatibility fixture from a real export, entirely on this machine (no network access).
 *
 *   npx tsx scripts/compat-new.ts <export file> --vendor rivile --id rivile-sales-001 [--sheet NAME] [--scale 0.37] [--shift-days 41] [--out <fixtures dir>]
 *
 * What it does
 *   • keeps the header row and every format convention (delimiter, encoding, number and date format, title rows, totals rows)
 *   • replaces customer / salesperson / product / document values by stable pseudonyms (Customer 0007, DOC-0012 …)
 *   • blanks every column the importer does not recognise (remarks, addresses … may contain personal data)
 *   • optionally multiplies all amounts by --scale and shifts all dates by --shift-days, so the values are not the real ones
 *   • writes manifest.json with status "draft": YOU must add the control totals from the accounting program's own report
 *     (multiplied by the same --scale) and review the file before setting status to "ready".
 *
 * It is a helper, not a guarantee. Read the output file before committing it.
 */
import fs from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';
import { parseFile } from '../src/engine/parsing/parseFile';
import { analyzeSheet } from '../src/engine/pipeline';
import { interpretNumberString } from '../src/engine/schema/numbers';
import { addDays } from '../src/engine/analytics/dates';
import { parseDate } from '../src/engine/schema/dates';
import type { CellValue, FieldId as SalesField } from '../src/engine/types';

const argv = process.argv.slice(2);
const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const file = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true);
const vendor = arg('vendor');
const id = arg('id');
if (!file || !vendor || !id) {
  console.error('usage: npx tsx scripts/compat-new.ts <export file> --vendor <id> --id <fixture id> [--sheet NAME] [--scale N] [--shift-days N]');
  process.exit(1);
}
const scale = arg('scale') ? Number(arg('scale')) : 1;
const shift = arg('shift-days') ? Number(arg('shift-days')) : 0;

const bytes = new Uint8Array(fs.readFileSync(file));
const parsed = await parseFile(bytes, path.basename(file));
const sheet = arg('sheet') ? parsed.sheets.find((s) => s.name === arg('sheet')) : parsed.sheets[0];
if (!sheet) throw new Error('sheet not found');
const a = analyzeSheet(sheet, { decimalHint: ',' });
if (!a) throw new Error('no table found');

const fieldOf = new Map<number, SalesField>(a.proposal.entries.map((e) => [e.columnIndex, e.field]));
const PSEUDO: Partial<Record<SalesField, string>> = { customer_name: 'Customer', customer_id: 'CID', product_name: 'Product', product_id: 'PID', salesperson: 'Person', document_id: 'DOC', product_category: 'Group' };
const AMOUNT = new Set<SalesField>(['net_amount', 'gross_amount', 'amount_unknown_basis', 'vat_amount', 'cost_amount', 'unit_cost', 'unit_price']);
const maps = new Map<string, Map<string, number>>();
const pseudo = (field: SalesField, v: string) => {
  const m = maps.get(field) ?? maps.set(field, new Map()).get(field)!;
  if (!m.has(v)) m.set(v, m.size + 1);
  return `${PSEUDO[field]} ${String(m.get(v)).padStart(4, '0')}`;
};

/** Scales a number written as text, keeping its separators and number of decimals. */
function scaleText(text: string, f: number): string {
  const r = interpretNumberString(text);
  if (!r) return text;
  const v = 'value' in r ? r.value : r.asDecimal;
  const m = /^(\D*?)([\d][\d ., ]*)(\D*)$/.exec(text.trim());
  if (!m) return text;
  const body = m[2]!;
  const dec = /[.,](\d{1,2})$/.exec(body);
  const decSep = dec ? body[body.length - dec[0].length]! : '';
  const decimals = dec ? dec[1]!.length : 0;
  const thou = /[  ]/.test(body) ? body.match(/[  ]/)![0] : body.includes('.') && decSep === ',' ? '.' : body.includes(',') && decSep === '.' ? ',' : '';
  let out = Math.abs(v * f).toFixed(decimals);
  const [i, d] = out.split('.');
  const grouped = thou ? i!.replace(/\B(?=(\d{3})+(?!\d))/g, thou) : i!;
  out = d !== undefined ? `${grouped}${decSep || '.'}${d}` : grouped;
  return `${m[1]}${v * f < 0 ? '-' : ''}${out}${m[3]}`;
}

const header = a.table.headerRow;
const rows: CellValue[][] = sheet.rows.map((row, r) => {
  if (r < header) return row.map((c) => (c === null ? null : r === 0 ? 'REPORT TITLE' : 'REPORT SUBTITLE'));
  if (r === header) return row;
  return row.map((c, ci) => {
    if (c === null || c === '') return c;
    const field = fieldOf.get(ci);
    if (!field) return typeof c === 'number' && AMOUNT.size ? c : ''; // unrecognised column → blank
    if (field === 'document_date') {
      const iso = parseDate(c, 'dmy');
      if (iso && shift) {
        const s = addDays(iso, shift);
        return typeof c === 'string' && /^\d{2}[./]\d{2}[./]\d{4}$/.test(c) ? `${s.slice(8)}${c[2]}${s.slice(5, 7)}${c[2]}${s.slice(0, 4)}` : s;
      }
      return c;
    }
    if (AMOUNT.has(field)) return typeof c === 'number' ? Math.round(c * scale * 100) / 100 : scaleText(String(c), scale);
    if (PSEUDO[field]) return pseudo(field, String(c));
    return c; // quantity, currency
  });
});

const out = path.join(arg('out') ?? 'tests/compat/fixtures', vendor, id);
fs.mkdirSync(out, { recursive: true });
let fileName: string;
if (parsed.kind === 'csv') {
  fileName = 'export.csv';
  const delim = parsed.delimiter || ';';
  const quote = (c: CellValue) => { const t = c === null ? '' : String(c); return t.includes(delim) || /["\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const text = rows.map((r) => r.map(quote).join(delim)).join('\r\n') + '\r\n';
  const enc = parsed.encoding === 'windows-1257' ? 'win1257' : parsed.encoding === 'windows-1250' ? 'win1250' : null;
  fs.writeFileSync(path.join(out, fileName), enc ? iconv.encode(text, enc) : Buffer.from('﻿' + text));
} else {
  fileName = 'export.xlsx';
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet.name);
  for (const r of rows) ws.addRow(r);
  fs.writeFileSync(path.join(out, fileName), Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer));
  console.warn('NOTE: for .xlsx the cell TYPES (date vs text, number vs text) are rewritten; check the result against the original in Excel.');
}

const fields: Record<string, string> = {};
for (const e of a.proposal.entries) fields[e.field] = a.table.headers[e.columnIndex]!;
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({
  id, vendor, product: 'TODO: program name and edition', version: 'TODO: program version', provenance: 'real-anonymized', status: 'draft', file: fileName,
  ...(arg('sheet') ? { sheet: arg('sheet') } : {}), decimalHint: ',',
  anonymization: { method: `compat-new.ts: pseudonyms, unrecognised columns blanked${scale !== 1 ? `, amounts × ${scale}` : ''}${shift ? `, dates shifted ${shift} d` : ''}`, reviewedBy: 'TODO: your name', date: new Date().toISOString().slice(0, 10) },
  expect: { headerRow: header + 1, fields, basis: 'TODO net|gross|unknown', currency: 'TODO EUR|PLN', rowsImported: a.table.dataRows.length },
  controlTotals: { source: "TODO: name the accounting program's own report these totals come from (and the period)", netSales: null, lines: null, documents: null, tolerance: 0.01 },
}, null, 2) + '\n');
console.log(`written ${out}\nNext: read ${fileName}, fill the TODOs and the control totals (from the ERP report, × the same --scale), then set "status": "ready".`);
