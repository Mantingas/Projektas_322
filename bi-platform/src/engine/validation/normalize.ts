import type { CellValue, ColumnProfile, ConfirmedMapping, ImportStats, IssueCode, SalesField, SalesRecord } from '../types';
import { parseDate } from '../schema/dates';
import { normalizeCurrency, parseNumber } from '../schema/numbers';
import { assignKeys } from '../import/keys';
import { isCreditType, normalizeUnit } from '../purchasing/units';

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
  const creditTypedRow: boolean[] = [];
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
    const docType = clean(get(row, 'document_type'));
    const creditTyped = col.document_type !== undefined && isCreditType(docType);
    if (amount < 0 && !creditTyped) note('warnings', 'negative_amount', rowNo);

    let quantity: number | undefined;
    const rawQty = get(row, 'quantity');
    if (rawQty !== null && rawQty !== '') {
      const q = parseNumber(rawQty, decimalOf('quantity'));
      if (q === null) note('warnings', 'invalid_quantity', rowNo);
      else quantity = q;
    }
    let unit: string | undefined;
    if (col.unit !== undefined) {
      const u = normalizeUnit(clean(get(row, 'unit')));
      if (u) unit = u.code;
      else if (quantity !== undefined) note('warnings', 'missing_unit', rowNo);
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
      unit,
      amount,
      basis,
      vatAmount: vat,
      cost,
      currency: currency!,
      salesperson: clean(get(row, 'salesperson')),
      category: clean(get(row, 'product_category')),
      sourceRow: rowNo,
    });
    creditTypedRow.push(creditTyped);
  });

  // ── credit notes: the document-type column decides, the sign is only checked against it ───────────────────────────────
  // All credit-typed amounts positive → the file writes credit notes as positive numbers: they are made negative (with a notice).
  // All already negative → left alone (never flipped twice). A mix of both → ambiguous: the positive ones are NOT imported (they would
  // silently be counted as sales) and the user is told how many, so the file can be corrected.
  const creditIdx = partial.map((_, i) => i).filter((i) => creditTypedRow[i] && partial[i]!.amount !== 0);
  const creditPos = creditIdx.filter((i) => partial[i]!.amount > 0);
  const creditNeg = creditIdx.length - creditPos.length;
  const drop = new Set<number>();
  if (creditPos.length > 0 && creditNeg > 0) {
    for (const i of creditPos) { drop.add(i); note('errors', 'credit_sign_ambiguous', partial[i]!.sourceRow); }
    stats.rowsSkipped += creditPos.length;
  } else if (creditPos.length > 0) {
    for (const i of creditPos) {
      const r = partial[i]!;
      r.amount = -r.amount;
      if (r.vatAmount !== undefined) r.vatAmount = -r.vatAmount;
      // the cost of a credit line keeps the convention of its amount: positive amount & positive cost → both negative; any other combination is left for the cost sanity check
      if (r.cost !== undefined && r.cost > 0) r.cost = -r.cost;
      else if (r.cost !== undefined && r.cost < 0) { r.cost = undefined; note('warnings', 'cost_suspect', r.sourceRow); } // a negative cost on a positive credit amount contradicts itself
      note('warnings', 'credit_sign_normalised', r.sourceRow);
    }
  }
  const kept = partial.filter((_, i) => !drop.has(i));

  // ── quantity sign must follow the amount sign (a return reduces the quantity) ────────────────────────────────────────
  const negQty = kept.filter((r) => r.amount < 0 && r.quantity !== undefined && r.quantity !== 0);
  const negQtyPositive = negQty.filter((r) => r.quantity! > 0);
  if (negQtyPositive.length > 0 && negQtyPositive.length === negQty.length) {
    // every negative-amount line carries a positive quantity: that is the file's convention for returns
    for (const r of negQtyPositive) { r.quantity = -r.quantity!; note('warnings', 'quantity_sign_normalised', r.sourceRow); }
  } else if (negQtyPositive.length > 0) {
    // the file mixes conventions: the quantity of the lines whose sign disagrees is not trustworthy → not used
    for (const r of negQtyPositive) { r.quantity = undefined; r.unit = undefined; note('warnings', 'quantity_sign_ambiguous', r.sourceRow); }
  }
  for (const r of kept) if (r.amount > 0 && r.quantity !== undefined && r.quantity < 0) { r.quantity = undefined; r.unit = undefined; note('warnings', 'quantity_sign_ambiguous', r.sourceRow); }

  // ── cost sanity: only reported here (the figures are protected where margins are computed, so already stored data is protected too) ──
  for (const r of kept) {
    if (r.cost === undefined) continue;
    if (r.amount > 0 && (r.cost < 0 || r.cost > 5 * r.amount)) note('warnings', 'cost_suspect', r.sourceRow);
    else if (r.amount < 0 && r.cost > 0) note('warnings', 'cost_suspect', r.sourceRow);
    else if (r.amount > 0 && r.cost === 0) note('warnings', 'cost_zero', r.sourceRow);
  }

  const records = assignKeys(kept);
  stats.rowsImported = records.length;
  stats.currencies = [...currencies].sort();
  for (const r of records) {
    if (!stats.dateMin || r.date < stats.dateMin) stats.dateMin = r.date;
    if (!stats.dateMax || r.date > stats.dateMax) stats.dateMax = r.date;
  }
  return { records, stats };
}
