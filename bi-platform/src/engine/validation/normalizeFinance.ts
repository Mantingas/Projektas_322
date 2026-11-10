import type { AgingBuckets, CellValue, FieldId, FinanceRecord, FinanceSide, ImportStats, IssueCode } from '../types';
import { parseDate } from '../schema/dates';
import { normalizeCurrency, parseNumber } from '../schema/numbers';
import { isCreditType } from '../purchasing/units';
import { assignFinanceKeys, cpKey, financeScope, isSnapshotKind, snapshotDocId } from '../finance/keys';
import { financeKindFromFields, FINANCE_GRAIN, RECORD_KIND, SNAPSHOT_DATASETS, type FinanceDatasetKind } from '../finance/kind';
import { MappingError, type NormalizeOptions } from './normalize';

export interface FinanceNormalizeResult {
  records: FinanceRecord[];
  stats: ImportStats;
  kind: FinanceDatasetKind;
  grain: (typeof FINANCE_GRAIN)[FinanceDatasetKind];
  side: FinanceSide;
  /** Distinct as-of dates (snapshot kinds only). */
  snapshotDates: string[];
  dateFromAsOf: boolean;
}

const MIN_YEAR = 1990;
const clean = (v: CellValue): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? undefined : s;
};

/**
 * Receivable / payable files → canonical finance lines. Never invents anything: an outstanding balance is only ever READ from the file (or derived from
 * the SAME line's original − paid), never computed from other documents; no currency conversion; no guessed due dates, counterparties or document links.
 */
export function normalizeFinance(dataRows: CellValue[][], opts: NormalizeOptions): FinanceNormalizeResult {
  const { mapping, profiles, rowNumbers } = opts;
  const col = mapping.columns;
  const side: FinanceSide = opts.side ?? 'receivable';
  const kind = financeKindFromFields(Object.keys(col) as FieldId[]);
  const rk = RECORD_KIND[kind];
  const snapshot = SNAPSHOT_DATASETS.includes(kind);
  if (col.counterparty_id === undefined && col.counterparty_name === undefined) throw new MappingError('missing_counterparty');
  const amountCols: FieldId[] = ['original_amount', 'outstanding_amount', 'paid_amount', 'aging_current', 'aging_1_30', 'aging_31_60', 'aging_61_90', 'aging_90_plus'];
  if (!amountCols.some((f) => col[f] !== undefined)) throw new MappingError('missing_amount');
  const dateField: FieldId | undefined = snapshot ? (col.snapshot_date !== undefined ? 'snapshot_date' : undefined) : kind === 'payments' ? (col.payment_date !== undefined ? 'payment_date' : col.document_date !== undefined ? 'document_date' : undefined) : col.document_date !== undefined ? 'document_date' : undefined;
  if (!dateField && !(snapshot && opts.asOfDate)) throw new MappingError('missing_date');
  if (col.currency === undefined && !mapping.defaultCurrency) throw new MappingError('currency_required');
  const maxYear = Number((opts.today ?? new Date().toISOString().slice(0, 10)).slice(0, 4)) + 1;

  const stats: ImportStats = { rowsRead: dataRows.length + (opts.skippedTotalRows ?? 0), rowsImported: 0, rowsSkipped: 0, errors: {}, warnings: {}, examples: [], currencies: [] };
  if (opts.skippedTotalRows) { stats.warnings.total_row = opts.skippedTotalRows; stats.rowsSkipped += opts.skippedTotalRows; }
  const note = (k: 'errors' | 'warnings', code: IssueCode, row: number) => {
    stats[k][code] = (stats[k][code] ?? 0) + 1;
    if (stats.examples.length < 20) stats.examples.push({ row, code });
  };
  const decimalOf = (f: FieldId) => (col[f] === undefined ? ',' : (profiles[col[f]!]?.decimal ?? ','));
  const orderOf = (f: FieldId | undefined) => (f && col[f] !== undefined ? (profiles[col[f]!]?.dateOrder ?? 'dmy') : 'dmy');
  for (const f of amountCols) {
    const a = col[f] === undefined ? 0 : (profiles[col[f]!]?.ambiguousNumbers ?? 0);
    if (a > 0) stats.warnings.ambiguous_number_format = (stats.warnings.ambiguous_number_format ?? 0) + a;
  }
  const get = (row: CellValue[], f: FieldId): CellValue => (col[f] === undefined ? null : (row[col[f]!] ?? null));
  const num = (row: CellValue[], f: FieldId): number | null | undefined => {
    const raw = get(row, f);
    if (raw === null || raw === '') return undefined;
    return parseNumber(raw, decimalOf(f));
  };

  const drafts: Omit<FinanceRecord, 'key'>[] = [];
  const currencies = new Set<string>();
  dataRows.forEach((row, i) => {
    const rowNo = rowNumbers[i] ?? i + 1;
    let date: string | null;
    if (dateField && col[dateField] !== undefined) {
      date = parseDate(get(row, dateField), orderOf(dateField));
      if (!date) { note('errors', 'invalid_date', rowNo); stats.rowsSkipped++; return; }
    } else { date = opts.asOfDate!; note('warnings', 'date_from_as_of', rowNo); }
    const year = Number(date.slice(0, 4));
    if (year < MIN_YEAR || year > maxYear) { note('errors', 'date_out_of_range', rowNo); stats.rowsSkipped++; return; }
    let currency = mapping.defaultCurrency?.toUpperCase();
    if (col.currency !== undefined) {
      const raw = clean(get(row, 'currency'));
      const parsed = raw ? normalizeCurrency(raw) : undefined;
      if (parsed) currency = parsed;
      else if (!currency) { note('errors', 'unknown_currency', rowNo); stats.rowsSkipped++; return; }
      else note('warnings', 'unknown_currency', rowNo);
    }
    const counterpartyId = clean(get(row, 'counterparty_id'));
    const counterpartyName = clean(get(row, 'counterparty_name'));
    if (!counterpartyId && !counterpartyName) note('warnings', 'missing_counterparty', rowNo);
    const cp = cpKey({ counterpartyId, counterpartyName });
    const docNo = clean(get(row, 'document_id'));

    let dueDate: string | undefined;
    if (col.due_date !== undefined) {
      const raw = get(row, 'due_date');
      if (raw === null || raw === '') note('warnings', 'missing_due_date', rowNo);
      else { const d = parseDate(raw, orderOf('due_date')); if (d) dueDate = d; else note('warnings', 'invalid_due_date', rowNo); }
    }
    let invoiceDate: string | undefined;
    if (snapshot && col.document_date !== undefined) invoiceDate = parseDate(get(row, 'document_date'), orderOf('document_date')) ?? undefined;
    const base = { side, currency: currency!, basis: 'net' as const, sourceRow: rowNo, counterpartyId, counterpartyName };
    currencies.add(currency!);

    // ── aging summary: one line per counterparty with its buckets ──
    if (kind === 'aging') {
      const parts = (['aging_current', 'aging_1_30', 'aging_31_60', 'aging_61_90', 'aging_90_plus'] as const).map((f) => num(row, f));
      if (parts.some((x) => x === null)) { note('errors', 'invalid_amount', rowNo); stats.rowsSkipped++; return; }
      const [nd, d30, d60, d90, d90p] = parts.map((x) => x ?? 0) as [number, number, number, number, number];
      const buckets: AgingBuckets = { nd, d30, d60, d90, d90p };
      const sum = nd + d30 + d60 + d90 + d90p;
      const total = num(row, 'outstanding_amount') ?? num(row, 'original_amount'); // a "Total" column is the sum of the buckets
      if (total === null) { note('errors', 'invalid_amount', rowNo); stats.rowsSkipped++; return; }
      if (total !== undefined && Math.abs(total - sum) > Math.max(0.02, Math.abs(total) * 0.01)) note('warnings', 'aging_total_mismatch', rowNo);
      drafts.push({ ...base, kind: rk, date, documentId: snapshotDocId('aging', side, date), outstanding: total ?? sum, buckets, scope: financeScope('aging', side, cp) });
      return;
    }

    // ── balance snapshot: one line per counterparty ──
    if (kind === 'balance') {
      const out = num(row, 'outstanding_amount');
      if (out === undefined) { note('errors', 'empty_amount', rowNo); stats.rowsSkipped++; return; }
      if (out === null) { note('errors', 'invalid_amount', rowNo); stats.rowsSkipped++; return; }
      if (out < 0) note('warnings', 'negative_outstanding', rowNo);
      drafts.push({ ...base, kind: rk, date, documentId: snapshotDocId('balance', side, date), outstanding: out, scope: financeScope('balance', side, cp) });
      return;
    }

    // ── open items: one line per invoice still open AT the as-of date ──
    if (kind === 'open_items') {
      const original = num(row, 'original_amount');
      const paid = num(row, 'paid_amount');
      let out = num(row, 'outstanding_amount');
      if (original === null || paid === null || out === null) { note('errors', 'invalid_amount', rowNo); stats.rowsSkipped++; return; }
      if (out === undefined) {
        if (original !== undefined && paid !== undefined) { out = original - paid; note('warnings', 'outstanding_derived', rowNo); } // the SAME line says both numbers
        else { note('errors', 'empty_amount', rowNo); stats.rowsSkipped++; return; }
      }
      if (!docNo) note('warnings', 'missing_invoice_number', rowNo);
      if (col.document_type !== undefined && isCreditType(clean(get(row, 'document_type'))) && out > 0) { out = -out; note('warnings', 'credit_sign_normalised', rowNo); }
      if (out < 0) note('warnings', 'negative_outstanding', rowNo);
      drafts.push({ ...base, kind: rk, date, documentId: snapshotDocId('open_item', side, date), invoiceNo: docNo, invoiceDate, dueDate, amount: original ?? undefined, outstanding: out, paid: paid ?? undefined, scope: financeScope('open_item', side, cp) });
      return;
    }

    // ── payments ──
    if (kind === 'payments') {
      const paid = num(row, 'paid_amount') ?? num(row, 'original_amount');
      if (paid === undefined) { note('errors', 'empty_amount', rowNo); stats.rowsSkipped++; return; }
      if (paid === null) { note('errors', 'invalid_amount', rowNo); stats.rowsSkipped++; return; }
      const payRef = clean(get(row, 'payment_reference'));
      // a lone document-number column in a payment file names the invoice that is paid (a payment's own number is the payment reference)
      const invRef = clean(get(row, 'invoice_reference')) ?? clean(get(row, 'credit_reference')) ?? docNo;
      if (!invRef) note('warnings', 'payment_without_reference', rowNo); // cannot be linked to an invoice
      drafts.push({ ...base, kind: rk, date, documentId: payRef, reference: invRef, amount: paid, rawAmount: paid, scope: financeScope('payment', side, cp) });
      return;
    }

    // ── invoice register and credit-note register (credit rows are split off) ──
    let amount = num(row, 'original_amount') ?? num(row, 'paid_amount');
    if (amount === undefined) { note('errors', 'empty_amount', rowNo); stats.rowsSkipped++; return; }
    if (amount === null) { note('errors', 'invalid_amount', rowNo); stats.rowsSkipped++; return; }
    const credit = kind === 'credit_notes' || amount < 0 || (col.document_type !== undefined && isCreditType(clean(get(row, 'document_type'))));
    if (!docNo) note('warnings', 'missing_invoice_number', rowNo);
    const rawAmount = amount;
    const typed = col.document_type !== undefined && isCreditType(clean(get(row, 'document_type')));
    const creditEvidence: 'register' | 'type' | 'sign' | undefined = !credit ? undefined : kind === 'credit_notes' ? 'register' : typed ? 'type' : 'sign';
    // a negative amount in an invoice register is only ASSUMED to be a credit note: say so, the findings built on it are qualified
    if (creditEvidence === 'sign') note('warnings', 'negative_assumed_credit', rowNo);
    amount = Math.abs(amount);
    const ref = clean(get(row, 'credit_reference')) ?? clean(get(row, 'invoice_reference'));
    const k = credit ? 'credit_note' : 'invoice';
    drafts.push({ ...base, kind: k, date, documentId: docNo, reference: credit ? ref : undefined, dueDate: credit ? undefined : dueDate, amount, rawAmount, ...(creditEvidence ? { creditEvidence } : {}), scope: financeScope(k, side, cp) });
  });

  // identical invoice numbers inside one register (an invoice register has ONE line per invoice)
  if (kind === 'invoices') {
    const seen = new Map<string, number>();
    for (const d of drafts) if (d.kind === 'invoice' && d.documentId) { const k = `${cpKey(d)}|${d.documentId.toLowerCase()}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
    let dup = 0;
    for (const n of seen.values()) if (n > 1) dup += n - 1;
    if (dup) stats.warnings.duplicate_invoice_number = dup;
  }

  const records = assignFinanceKeys(drafts);
  stats.rowsImported = records.length;
  stats.currencies = [...currencies].sort();
  for (const r of records) {
    if (!stats.dateMin || r.date < stats.dateMin) stats.dateMin = r.date;
    if (!stats.dateMax || r.date > stats.dateMax) stats.dateMax = r.date;
  }
  const snapshotDates = records.some((r) => isSnapshotKind(r.kind)) ? [...new Set(records.map((r) => r.date))].sort() : [];
  return { records, stats, kind, grain: FINANCE_GRAIN[kind], side, snapshotDates, dateFromAsOf: snapshot && col.snapshot_date === undefined };
}
