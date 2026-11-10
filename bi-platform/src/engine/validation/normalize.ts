import type { CellValue, ColumnProfile, ConfirmedMapping, ImportStats, IssueCode, SalesField, SalesRecord } from '../types';
import { parseDate } from '../schema/dates';
import { normalizeCurrency, parseNumber } from '../schema/numbers';
import { assignKeys } from '../import/keys';

export interface NormalizeOptions {
  profiles: ColumnProfile[];
  mapping: ConfirmedMapping;
  /** 1-based sheet row numbers aligned with dataRows. */
  rowNumbers: number[];
  skippedTotalRows?: number;
  /** ISO date used for the "future date" sanity check (injected so tests are deterministic). */
  today?: string;
  /** Inventory: the snapshot date to use when the file has no date column (the user states it). */
  asOfDate?: string;
  /** Finance: receivables or payables (the user's choice). */
  side?: 'receivable' | 'payable';
}

export class MappingError extends Error {
  constructor(public readonly code: 'missing_date' | 'missing_amount' | 'currency_required' | 'missing_product' | 'missing_quantity' | 'missing_counterparty') {
    super(code);
  }
}

const MIN_YEAR = 1990;
const clean = (v: CellValue): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? undefined : s;
};

export function normalizeSales(dataRows: CellValue[][], opts: NormalizeOptions): { records: SalesRecord[]; stats: ImportStats } {
  const { mapping, profiles, rowNumbers } = opts;
  const col = mapping.columns;
  if (col.document_date === undefined) throw new MappingError('missing_date');
  const amountField: SalesField | undefined = (['net_amount', 'gross_amount', 'amount_unknown_basis'] as const).find((f) => col[f] !== undefined);
  if (!amountField) throw new MappingError('missing_amount');
  if (col.currency === undefined && !mapping.defaultCurrency) throw new MappingError('currency_required');
  const basis = amountField === 'net_amount' ? 'net' : amountField === 'gross_amount' ? 'gross' : 'unknown';
  const maxYear = Number((opts.today ?? new Date().toISOString().slice(0, 10)).slice(0, 4)) + 1;

  const stats: ImportStats = {
    rowsRead: dataRows.length + (opts.skippedTotalRows ?? 0),
    rowsImported: 0,
    rowsSkipped: 0,
    errors: {},
    warnings: {},
    examples: [],
    currencies: [],
  };
  if (opts.skippedTotalRows) {
    stats.warnings.total_row = opts.skippedTotalRows;
    stats.rowsSkipped += opts.skippedTotalRows;
  }
  const note = (kind: 'errors' | 'warnings', code: IssueCode, row: number) => {
    stats[kind][code] = (stats[kind][code] ?? 0) + 1;
    if (stats.examples.length < 20) stats.examples.push({ row, code });
  };

  const decimalOf = (f: SalesField) => (col[f] === undefined ? ',' : (profiles[col[f]!]?.decimal ?? ','));
  const dateOrder = profiles[col.document_date]?.dateOrder ?? 'dmy';
  // ambiguous-number warnings are reported once per column, not per row
  for (const f of ['net_amount', 'gross_amount', 'amount_unknown_basis', 'quantity', 'cost_amount', 'unit_cost'] as SalesField[]) {
    const a = col[f] === undefined ? 0 : (profiles[col[f]!]?.ambiguousNumbers ?? 0);
    if (a > 0) stats.warnings.ambiguous_number_format = (stats.warnings.ambiguous_number_format ?? 0) + a;
  }

  const get = (row: CellValue[], f: SalesField): CellValue => (col[f] === undefined ? null : (row[col[f]!] ?? null));
  const partial: Omit<SalesRecord, 'key'>[] = [];
  const currencies = new Set<string>();

  dataRows.forEach((row, i) => {
    const rowNo = rowNumbers[i] ?? i + 1;
    const date = parseDate(get(row, 'document_date'), dateOrder);
    if (!date) {
      note('errors', 'invalid_date', rowNo);
      stats.rowsSkipped++;
      return;
    }
    const year = Number(date.slice(0, 4));
    if (year < MIN_YEAR || year > maxYear) {
      note('errors', 'date_out_of_range', rowNo);
      stats.rowsSkipped++;
      return;
    }
    const rawAmount = get(row, amountField);
    if (rawAmount === null || rawAmount === '') {
      note('errors', 'empty_amount', rowNo);
      stats.rowsSkipped++;
      return;
    }
    const amount = parseNumber(rawAmount, decimalOf(amountField));
    if (amount === null) {
      note('errors', 'invalid_amount', rowNo);
      stats.rowsSkipped++;
      return;
    }
    let currency = mapping.defaultCurrency?.toUpperCase();
    if (col.currency !== undefined) {
      const raw = clean(get(row, 'currency'));
      const parsed = raw ? normalizeCurrency(raw) : undefined;
      if (parsed) currency = parsed;
      else if (!currency) {
        note('errors', 'unknown_currency', rowNo);
        stats.rowsSkipped++;
        return;
      } else note('warnings', 'unknown_currency', rowNo);
    }
    if (amount < 0) note('warnings', 'negative_amount', rowNo);

    let quantity: number | undefined;
    const rawQty = get(row, 'quantity');
    if (rawQty !== null && rawQty !== '') {
      const q = parseNumber(rawQty, decimalOf('quantity'));
      if (q === null) note('warnings', 'invalid_quantity', rowNo);
      else quantity = q;
    }
    let cost: number | undefined;
    const rawCost = get(row, 'cost_amount');
    const rawUnitCost = get(row, 'unit_cost');
    if (rawCost !== null && rawCost !== '') {
      const c = parseNumber(rawCost, decimalOf('cost_amount'));
      if (c === null) note('warnings', 'invalid_cost', rowNo);
      else cost = c;
    } else if (rawUnitCost !== null && rawUnitCost !== '' && quantity !== undefined) {
      const c = parseNumber(rawUnitCost, decimalOf('unit_cost'));
      if (c === null) note('warnings', 'invalid_cost', rowNo);
      else cost = c * quantity;
    }
    let vat: number | undefined;
    const rawVat = get(row, 'vat_amount');
    if (rawVat !== null && rawVat !== '') vat = parseNumber(rawVat, decimalOf('vat_amount')) ?? undefined;

    // net + VAT must equal gross (within a cent of rounding); a file where it does not has contradictory columns
    if (col.net_amount !== undefined && col.gross_amount !== undefined && vat !== undefined) {
      const n = parseNumber(get(row, 'net_amount'), decimalOf('net_amount')), g = parseNumber(get(row, 'gross_amount'), decimalOf('gross_amount'));
      if (n !== null && g !== null && Math.abs(n + vat - g) > 0.02) note('warnings', 'vat_inconsistent', rowNo);
    }

    const customerName = clean(get(row, 'customer_name'));
    const customerId = clean(get(row, 'customer_id'));
    const productName = clean(get(row, 'product_name'));
    const productId = clean(get(row, 'product_id'));
    if (col.customer_name !== undefined && !customerName) note('warnings', 'missing_customer', rowNo);
    if (col.product_name !== undefined && !productName) note('warnings', 'missing_product', rowNo);

    currencies.add(currency!);
    partial.push({
      date,
      documentId: clean(get(row, 'document_id')),
      customerName,
      customerId,
      productName,
      productId,
      quantity,
      amount,
      basis,
      vatAmount: vat,
      cost,
      currency: currency!,
      salesperson: clean(get(row, 'salesperson')),
      category: clean(get(row, 'product_category')),
      sourceRow: rowNo,
    });
  });

  const records = assignKeys(partial);
  stats.rowsImported = records.length;
  stats.currencies = [...currencies].sort();
  for (const r of records) {
    if (!stats.dateMin || r.date < stats.dateMin) stats.dateMin = r.date;
    if (!stats.dateMax || r.date > stats.dateMax) stats.dateMax = r.date;
  }
  return { records, stats };
}
