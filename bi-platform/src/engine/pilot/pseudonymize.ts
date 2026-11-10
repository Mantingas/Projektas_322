import { parseFile } from '../parsing/parseFile';
import { analyzeSheet } from '../pipeline';
import { parseNumber } from '../schema/numbers';
import { normalizeHeader } from '../mapping/normalize';
import type { CellValue, FieldId } from '../types';

/** A currency column is never identifying; small files can fail the importer's value test for it, so the header alone keeps it. */
const CURRENCY_HEADERS = new Set(['valiuta', 'val', 'waluta', 'currency', 'ccy', 'cur']);

/**
 * Deterministic, local pseudonymisation of confidential accounting exports for pilot validation.
 *
 *  • Counterparty identifiers / names and document references are replaced by keyed pseudonyms (HMAC-SHA-256 with a secret only the data owner
 *    holds). The same value always gives the same pseudonym – inside a file and ACROSS files – so every reconciliation relationship survives.
 *  • Amounts, dates, currencies, document types and every other recognised field are kept exactly (reconciliation needs them).
 *  • Columns the importer does not recognise (remarks, addresses, bank accounts …) are BLANKED; export titles and footers are dropped.
 *
 * THIS IS PSEUDONYMISATION, NOT ANONYMISATION. Amounts, dates and document patterns can still identify a supplier to someone who knows the
 * business; small suppliers, one-off amounts and unusual dates are the weak spots. The pseudonym key must never leave the data owner. The
 * function never logs or returns original values except in `reverse`, which is meant for a local, git-ignored key file.
 */
export type Hmac = (secret: string, message: string) => string;

export const PARTY_FIELDS: FieldId[] = ['counterparty_id', 'counterparty_name'];
export const DOC_FIELDS: FieldId[] = ['document_id', 'credit_reference', 'invoice_reference', 'payment_reference'];
const AMOUNT_FIELDS: FieldId[] = ['original_amount', 'outstanding_amount', 'paid_amount'];
export const MIN_SECRET = 16;

export interface PseudoOptions { secret: string; hmac: Hmac; keepDocumentNumbers?: boolean; sheet?: string }
export interface PseudoResult {
  csv: string;
  rows: number;
  /** recognised fields kept as they are */
  keptFields: string[];
  pseudonymisedFields: string[];
  /** number of columns blanked because the importer does not recognise them (headers are never listed: they may be identifying) */
  blankedColumns: number;
  /** control totals of the ORIGINAL file, to check the pseudonymised copy against (sums of recognised amount columns, row count) */
  control: { rows: number; sums: Record<string, number>; dateMin?: string; dateMax?: string };
  /** pseudonym → original, for the data owner's local key file ONLY */
  reverse: Record<string, string>;
  warnings: ('no_table' | 'no_counterparty' | 'no_amount' | 'multi_sheet')[];
}

const norm = (v: CellValue) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const csvCell = (s: string) => (/[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);

export async function pseudonymise(bytes: Uint8Array, fileName: string, o: PseudoOptions): Promise<PseudoResult> {
  if (o.secret.length < MIN_SECRET) throw new Error('secret_too_short');
  const parsed = await parseFile(bytes, fileName);
  const warnings: PseudoResult['warnings'] = [];
  if (parsed.sheets.length > 1 && !o.sheet) warnings.push('multi_sheet');
  const sheet = o.sheet ? parsed.sheets.find((s) => s.name === o.sheet) : parsed.sheets.find((s) => analyzeSheet(s, { module: 'finance' }) !== null);
  const a = sheet ? analyzeSheet(sheet, { module: 'finance' }) : null;
  const empty: PseudoResult = { csv: '', rows: 0, keptFields: [], pseudonymisedFields: [], blankedColumns: 0, control: { rows: 0, sums: {} }, reverse: {}, warnings: [...warnings, 'no_table'] };
  if (!a) return empty;
  const byCol = new Map(a.proposal.entries.map((e) => [e.columnIndex, e.field]));
  a.table.headers.forEach((h, i) => { if (!byCol.has(i) && CURRENCY_HEADERS.has(normalizeHeader(h)) && ![...byCol.values()].includes('currency')) byCol.set(i, 'currency'); });
  const fields = [...byCol.values()];
  if (!fields.some((f) => PARTY_FIELDS.includes(f))) warnings.push('no_counterparty');
  if (!fields.some((f) => AMOUNT_FIELDS.includes(f) || f.startsWith('aging_'))) warnings.push('no_amount');

  const reverse: Record<string, string> = {};
  const pseudo = (kind: string, value: CellValue, prefix: string): string => {
    const n = norm(value);
    if (!n) return '';
    const p = `${prefix}-${o.hmac(o.secret, `${kind}|${n}`).slice(0, 10).toUpperCase()}`;
    reverse[p] = String(value).trim();
    return p;
  };
  const sums: Record<string, number> = {};
  const dates: string[] = [];
  const header = a.table.headers.map((h, i) => (byCol.has(i) ? h : ''));
  const lines: string[] = [header.map(csvCell).join(';')];
  for (const row of a.table.dataRows) {
    const out = a.table.headers.map((_, i) => {
      const f = byCol.get(i);
      const v = row[i] ?? null;
      if (f === undefined) return '';
      if (f === 'counterparty_id') return pseudo('party_id', v, 'ID');
      if (f === 'counterparty_name') return pseudo('party_name', v, 'Supplier');
      if (DOC_FIELDS.includes(f)) return o.keepDocumentNumbers ? String(v ?? '') : pseudo('doc', v, 'D');
      if (AMOUNT_FIELDS.includes(f) || f.startsWith('aging_')) { const n = parseNumber(v, a.profiles[i]!.decimal); if (n !== null) sums[f] = Math.round(((sums[f] ?? 0) + n) * 100) / 100; }
      if (f.endsWith('_date') && typeof v === 'string') dates.push(v);
      return String(v ?? '');
    });
    lines.push(out.map(csvCell).join(';'));
  }
  const dsort = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return {
    csv: '﻿' + lines.join('\r\n') + '\r\n', rows: a.table.dataRows.length,
    keptFields: [...new Set(fields.filter((f) => !PARTY_FIELDS.includes(f) && !DOC_FIELDS.includes(f)))],
    pseudonymisedFields: [...new Set(fields.filter((f) => PARTY_FIELDS.includes(f) || (DOC_FIELDS.includes(f) && !o.keepDocumentNumbers)))],
    blankedColumns: a.table.headers.length - byCol.size, control: { rows: a.table.dataRows.length, sums, dateMin: dsort[0], dateMax: dsort[dsort.length - 1] }, reverse, warnings,
  };
}
