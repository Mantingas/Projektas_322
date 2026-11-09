import type { CellValue, ColumnProfile, ConfirmedMapping, FieldId, ImportStats, IssueCode, PurchaseRecord } from '../types';
import { parseDate } from '../schema/dates';
import { normalizeCurrency, parseNumber } from '../schema/numbers';
import { assignPurchaseKeys } from '../purchasing/keys';
import { isCreditType, normalizeUnit } from '../purchasing/units';
import { MappingError, type NormalizeOptions } from './normalize';

export type DiscountMode = 'none' | 'included' | 'deducted' | 'unverified';

export interface PurchaseNormalizeResult {
  records: PurchaseRecord[];
  stats: ImportStats;
  /**
   * What the file says about discounts:
   *  none       – no discount column
   *  included   – amount = qty × price − discount on the rows that can be checked (the discount is already inside the amount)
   *  deducted   – amount = qty × price (before discount): the discount was subtracted by us, and the stats say so
   *  unverified – discount present but the arithmetic does not settle it: amounts are used AS GIVEN and a limitation is reported
   */
  discountMode: DiscountMode;
  /** Share of lines whose quantity × unit price disagrees with the line amount by more than 1 % (before any discount). */
  priceMismatchShare: number;
}

const MIN_YEAR = 1990;
const clean = (v: CellValue): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? undefined : s;
};

/**
 * Purchase lines → canonical records. Never invents values: no currency or unit conversion, no estimated prices, no guessed VAT basis.
 * Credit notes are negative. A document-type column that says "credit note / return" over a POSITIVE amount flips the sign – and that is counted and reported.
 */
export function normalizePurchases(dataRows: CellValue[][], opts: NormalizeOptions): PurchaseNormalizeResult {
  const { mapping, profiles, rowNumbers } = opts;
  const col = mapping.columns;
  if (col.document_date === undefined) throw new MappingError('missing_date');
  const amountField = (['net_amount', 'gross_amount', 'amount_unknown_basis'] as const).find((f) => col[f] !== undefined);
  if (!amountField) throw new MappingError('missing_amount');
  if (col.currency === undefined && !mapping.defaultCurrency) throw new MappingError('currency_required');
  const basis = amountField === 'net_amount' ? 'net' : amountField === 'gross_amount' ? 'gross' : 'unknown';
  const maxYear = Number((opts.today ?? new Date().toISOString().slice(0, 10)).slice(0, 4)) + 1;

  const stats: ImportStats = { rowsRead: dataRows.length + (opts.skippedTotalRows ?? 0), rowsImported: 0, rowsSkipped: 0, errors: {}, warnings: {}, examples: [], currencies: [] };
  if (opts.skippedTotalRows) {
    stats.warnings.total_row = opts.skippedTotalRows;
    stats.rowsSkipped += opts.skippedTotalRows;
  }
  const note = (kind: 'errors' | 'warnings', code: IssueCode, row: number) => {
    stats[kind][code] = (stats[kind][code] ?? 0) + 1;
    if (stats.examples.length < 20) stats.examples.push({ row, code });
  };
  const decimalOf = (f: FieldId) => (col[f] === undefined ? ',' : (profiles[col[f]!]?.decimal ?? ','));
  const dateOrder = profiles[col.document_date]?.dateOrder ?? 'dmy';
  for (const f of ['net_amount', 'gross_amount', 'amount_unknown_basis', 'quantity', 'unit_price', 'discount_amount'] as FieldId[]) {
    const a = col[f] === undefined ? 0 : (profiles[col[f]!]?.ambiguousNumbers ?? 0);
    if (a > 0) stats.warnings.ambiguous_number_format = (stats.warnings.ambiguous_number_format ?? 0) + a;
  }
  const get = (row: CellValue[], f: FieldId): CellValue => (col[f] === undefined ? null : (row[col[f]!] ?? null));

  interface Draft extends Omit<PurchaseRecord, 'key'> { rawAmount: number }
  const drafts: Draft[] = [];
  const currencies = new Set<string>();
  let checkable = 0;
  let asDiscounted = 0; // amount ≈ qty × price − discount
  let asGross = 0; // amount ≈ qty × price (discount NOT in the amount)
  let mismatches = 0;
  let priced = 0;

  dataRows.forEach((row, i) => {
    const rowNo = rowNumbers[i] ?? i + 1;
    const date = parseDate(get(row, 'document_date'), dateOrder);
    if (!date) { note('errors', 'invalid_date', rowNo); stats.rowsSkipped++; return; }
    const year = Number(date.slice(0, 4));
    if (year < MIN_YEAR || year > maxYear) { note('errors', 'date_out_of_range', rowNo); stats.rowsSkipped++; return; }
    const rawAmountCell = get(row, amountField);
    if (rawAmountCell === null || rawAmountCell === '') { note('errors', 'empty_amount', rowNo); stats.rowsSkipped++; return; }
    let amount = parseNumber(rawAmountCell, decimalOf(amountField));
    if (amount === null) { note('errors', 'invalid_amount', rowNo); stats.rowsSkipped++; return; }
    let currency = mapping.defaultCurrency?.toUpperCase();
    if (col.currency !== undefined) {
      const raw = clean(get(row, 'currency'));
      const parsed = raw ? normalizeCurrency(raw) : undefined;
      if (parsed) currency = parsed;
      else if (!currency) { note('errors', 'unknown_currency', rowNo); stats.rowsSkipped++; return; }
      else note('warnings', 'unknown_currency', rowNo);
    }
    // credit notes / returns: by sign, or by a document-type column over a positive amount
    let creditByType = false;
    if (col.document_type !== undefined && isCreditType(clean(get(row, 'document_type'))) && amount > 0) {
      amount = -amount;
      creditByType = true;
      note('warnings', 'credit_sign_normalised', rowNo);
    }
    if (amount < 0) note('warnings', 'negative_amount', rowNo);

    let quantity: number | undefined;
    const rawQty = get(row, 'quantity');
    if (rawQty !== null && rawQty !== '') {
      const q = parseNumber(rawQty, decimalOf('quantity'));
      if (q === null) note('warnings', 'invalid_quantity', rowNo);
      else quantity = creditByType && q > 0 ? -q : q;
    }
    let unit: string | undefined;
    if (col.unit !== undefined) {
      const info = normalizeUnit(clean(get(row, 'unit')));
      if (!info) note('warnings', 'missing_unit', rowNo);
      else {
        unit = info.code;
        if (info.dim === 'unknown') note('warnings', 'unknown_unit', rowNo);
      }
    }
    let unitPrice: number | undefined;
    const rawPrice = get(row, 'unit_price');
    if (rawPrice !== null && rawPrice !== '') {
      const p = parseNumber(rawPrice, decimalOf('unit_price'));
      if (p === null || p < 0) note('warnings', 'invalid_unit_price', rowNo);
      else unitPrice = p;
    }
    let discount: number | undefined;
    const rawDisc = get(row, 'discount_amount');
    if (rawDisc !== null && rawDisc !== '') {
      const d = parseNumber(rawDisc, decimalOf('discount_amount'));
      if (d === null) note('warnings', 'invalid_discount', rowNo);
      else discount = Math.abs(d);
    }
    // arithmetic evidence about discounts / price consistency (only on ordinary purchase lines that carry all the numbers)
    if (unitPrice !== undefined && quantity !== undefined && quantity > 0 && amount > 0) {
      priced++;
      const gross = quantity * unitPrice;
      const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.01);
      if (discount !== undefined && discount > 0) {
        checkable++;
        if (near(amount, gross - discount)) asDiscounted++;
        else if (near(amount, gross)) asGross++;
      } else if (!near(amount, gross)) mismatches++;
    }

    const supplierName = clean(get(row, 'supplier_name'));
    const supplierId = clean(get(row, 'supplier_id'));
    if ((col.supplier_name !== undefined || col.supplier_id !== undefined) && !supplierName && !supplierId) note('warnings', 'missing_supplier', rowNo);
    const productName = clean(get(row, 'product_name'));
    const productId = clean(get(row, 'product_id'));
    if (col.product_name !== undefined && !productName && !productId) note('warnings', 'missing_product', rowNo);
    let vat: number | undefined;
    const rawVat = get(row, 'vat_amount');
    if (rawVat !== null && rawVat !== '') vat = parseNumber(rawVat, decimalOf('vat_amount')) ?? undefined;

    currencies.add(currency!);
    drafts.push({
      date, documentId: clean(get(row, 'document_id')), supplierName, supplierId, productName, productId, quantity, unit, unitPrice, discount, amount, rawAmount: amount, basis,
      vatAmount: vat, currency: currency!, warehouse: clean(get(row, 'warehouse')), creditByType: creditByType || undefined, sourceRow: rowNo,
    });
  });

  let discountMode: DiscountMode = col.discount_amount === undefined ? 'none' : 'unverified';
  if (col.discount_amount !== undefined && checkable >= 3) {
    if (asDiscounted / checkable >= 0.8) discountMode = 'included';
    else if (asGross / checkable >= 0.8) discountMode = 'deducted';
  }
  if (discountMode === 'deducted') {
    for (const d of drafts) {
      if (d.discount && d.discount > 0 && d.amount > 0) {
        d.amount = Math.round((d.amount - d.discount) * 1e6) / 1e6;
        stats.warnings.discount_deducted = (stats.warnings.discount_deducted ?? 0) + 1;
      }
    }
  }
  if (priced > 0 && mismatches / priced > 0.02) stats.warnings.price_mismatch = mismatches;

  const records = assignPurchaseKeys(drafts.map(({ rawAmount: _r, ...r }) => (void _r, r)));
  stats.rowsImported = records.length;
  stats.currencies = [...currencies].sort();
  for (const r of records) {
    if (!stats.dateMin || r.date < stats.dateMin) stats.dateMin = r.date;
    if (!stats.dateMax || r.date > stats.dateMax) stats.dateMax = r.date;
  }
  return { records, stats, discountMode, priceMismatchShare: priced ? mismatches / priced : 0 };
}

export type { ColumnProfile, ConfirmedMapping };
