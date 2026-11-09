import type { CellValue, FieldId, ImportStats, InventoryRecord, IssueCode } from '../types';
import { parseDate } from '../schema/dates';
import { normalizeCurrency, parseNumber } from '../schema/numbers';
import { assignInventoryKeys, snapshotDocId } from '../inventory/keys';
import { classifyMovement } from '../inventory/movements';
import { normalizeUnit } from '../purchasing/units';
import { MappingError, type NormalizeOptions } from './normalize';

/** What the file is. Decided from the mapping and the data – shown to the user, who confirms it by confirming the mapping. */
export type InventoryKind = 'snapshot' | 'valuation' | 'history' | 'movements';

export interface InventoryNormalizeResult {
  records: InventoryRecord[];
  stats: ImportStats;
  kind: InventoryKind;
  /** Distinct snapshot dates (snapshots only). */
  snapshotDates: string[];
  /** The date came from the as-of date the user typed, not from a column. */
  dateFromAsOf: boolean;
  /** Share of movement lines whose type could not be recognised. */
  unknownTypeShare: number;
}

const MIN_YEAR = 1990;
const clean = (v: CellValue): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? undefined : s;
};

/**
 * Stock files → canonical inventory lines. Never invents anything: no cost estimation, no unit or currency conversion, no guessed dates.
 *  - snapshot rows (balance, valuation, history): quantity on hand + optional unit cost / stock value / minimum stock
 *  - movement rows: SIGNED stock change; transfers / adjustments / opening balances keep their own type so they are never counted as purchases or sales
 */
export function normalizeInventory(dataRows: CellValue[][], opts: NormalizeOptions): InventoryNormalizeResult {
  const { mapping, profiles, rowNumbers } = opts;
  const col = mapping.columns;
  const isMovement = col.movement_date !== undefined || col.movement_type !== undefined;
  const dateField: FieldId | undefined = isMovement ? (col.movement_date !== undefined ? 'movement_date' : col.snapshot_date !== undefined ? 'snapshot_date' : undefined) : col.snapshot_date !== undefined ? 'snapshot_date' : undefined;
  if (!dateField && !opts.asOfDate) throw new MappingError('missing_date');
  if (col.product_id === undefined && col.product_name === undefined) throw new MappingError('missing_product');
  if (col.quantity === undefined && col.stock_value === undefined) throw new MappingError('missing_quantity');
  if (col.currency === undefined && !mapping.defaultCurrency) throw new MappingError('currency_required');
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
  const dateOrder = dateField && col[dateField] !== undefined ? (profiles[col[dateField]!]?.dateOrder ?? 'dmy') : 'dmy';
  for (const f of ['quantity', 'unit_cost', 'stock_value', 'min_stock'] as FieldId[]) {
    const a = col[f] === undefined ? 0 : (profiles[col[f]!]?.ambiguousNumbers ?? 0);
    if (a > 0) stats.warnings.ambiguous_number_format = (stats.warnings.ambiguous_number_format ?? 0) + a;
  }
  const get = (row: CellValue[], f: FieldId): CellValue => (col[f] === undefined ? null : (row[col[f]!] ?? null));

  interface Draft extends Omit<InventoryRecord, 'key'> { rawQty?: number }
  const drafts: Draft[] = [];
  const currencies = new Set<string>();
  const parseOpt = (row: CellValue[], f: FieldId, rowNo: number, bad: IssueCode, nonNegative = false): number | undefined => {
    const raw = get(row, f);
    if (raw === null || raw === '') return undefined;
    const n = parseNumber(raw, decimalOf(f));
    if (n === null || (nonNegative && n < 0)) { note('warnings', bad, rowNo); return undefined; }
    return n;
  };

  dataRows.forEach((row, i) => {
    const rowNo = rowNumbers[i] ?? i + 1;
    let date: string | null;
    if (dateField && col[dateField] !== undefined) {
      date = parseDate(get(row, dateField), dateOrder);
      if (!date) { note('errors', 'invalid_date', rowNo); stats.rowsSkipped++; return; }
    } else {
      date = opts.asOfDate!;
      note('warnings', 'date_from_as_of', rowNo);
    }
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
    const productName = clean(get(row, 'product_name'));
    const productId = clean(get(row, 'product_id'));
    if (!productName && !productId) { note('warnings', 'missing_product', rowNo); stats.rowsSkipped++; return; }

    let quantity: number | undefined;
    const rawQty = get(row, 'quantity');
    if (rawQty !== null && rawQty !== '') {
      const q = parseNumber(rawQty, decimalOf('quantity'));
      if (q === null) note('warnings', 'invalid_quantity', rowNo);
      else quantity = q;
    }
    const unitCost = parseOpt(row, 'unit_cost', rowNo, 'invalid_cost', true);
    let value: number | undefined;
    const rawVal = get(row, 'stock_value');
    if (rawVal !== null && rawVal !== '') {
      const v = parseNumber(rawVal, decimalOf('stock_value'));
      if (v === null) note('warnings', 'invalid_stock_value', rowNo);
      else value = v;
    }
    if (quantity === undefined && value === undefined) { note('errors', 'empty_quantity', rowNo); stats.rowsSkipped++; return; }
    const minStock = parseOpt(row, 'min_stock', rowNo, 'invalid_min_stock', true);
    let unit: string | undefined;
    if (col.unit !== undefined) {
      const info = normalizeUnit(clean(get(row, 'unit')));
      if (!info) note('warnings', 'missing_unit', rowNo);
      else { unit = info.code; if (info.dim === 'unknown') note('warnings', 'unknown_unit', rowNo); }
    }
    const warehouse = clean(get(row, 'warehouse'));
    if (col.warehouse !== undefined && !warehouse) note('warnings', 'missing_warehouse', rowNo);
    const warehouseTo = clean(get(row, 'warehouse_to'));
    const category = clean(get(row, 'product_category'));
    const documentId = clean(get(row, 'document_id'));

    if (!isMovement) {
      if (quantity !== undefined && quantity < 0) note('warnings', 'negative_stock', rowNo);
      // a stated value that disagrees with quantity × unit cost: both are kept, the stated value is used, the conflict is reported
      if (value !== undefined && quantity !== undefined && unitCost !== undefined && Math.abs(value - quantity * unitCost) > Math.max(0.02, Math.abs(value) * 0.02)) note('warnings', 'value_mismatch', rowNo);
      if (quantity !== undefined && quantity > 0 && value === undefined && unitCost === undefined && (col.stock_value !== undefined || col.unit_cost !== undefined)) note('warnings', 'missing_cost', rowNo);
      currencies.add(currency!);
      drafts.push({ kind: 'snapshot', date, documentId: snapshotDocId(date, warehouse), productName, productId, category, warehouse, quantity, unit, unitCost, value, minStock, basis: 'net', currency: currency!, sourceRow: rowNo });
      return;
    }

    // ── movement ──
    let cls = classifyMovement(clean(get(row, 'movement_type')));
    if (col.movement_type === undefined) cls = { type: 'unknown' };
    if (cls.type === 'unknown') note('warnings', 'unknown_movement_type', rowNo);
    if (cls.type === 'return' && cls.bySign) note('warnings', 'return_direction_by_sign', rowNo);
    currencies.add(currency!);
    drafts.push({ kind: 'movement', date, documentId, productName, productId, category, warehouse, warehouseTo, quantity, rawQty: quantity, unit, unitCost, value, minStock, movementType: cls.type, basis: 'net', currency: currency!, sourceRow: rowNo, ...(cls.forcedSign ? { _forced: cls.forcedSign } : {}) } as Draft);
  });

  // ── sign convention of movement files ──
  // Files either write issues as NEGATIVE numbers (signed) or as positive "quantity issued". Decided from the file as a whole and reported.
  if (isMovement) {
    const issues = drafts.filter((d) => d.movementType === 'issue' && d.quantity !== undefined && d.quantity !== 0);
    const negShare = issues.length ? issues.filter((d) => d.quantity! < 0).length / issues.length : 0;
    const unsignedIssues = issues.length > 0 && negShare < 0.5;
    for (const d of drafts) {
      const forced = (d as unknown as { _forced?: 1 | -1 })._forced;
      delete (d as unknown as { _forced?: 1 | -1 })._forced;
      if (d.quantity === undefined) continue;
      const mag = Math.abs(d.quantity);
      let want: number | undefined;
      if (forced) want = forced * mag;
      else if (d.movementType === 'issue' && unsignedIssues) want = -d.quantity; // "quantity issued" is positive; a negative one is a reversal (stock goes back up)
      if (want !== undefined) {
        if (want !== d.quantity) note('warnings', 'movement_sign_normalised', d.sourceRow);
        d.quantity = want;
        if (d.value !== undefined) d.value = (want < 0 ? -1 : 1) * Math.abs(d.value);
      }
      // single-line transfers with a destination: the line's quantity LEAVES `warehouse` (receiving side is implied by warehouseTo)
      if (d.movementType === 'transfer' && d.warehouseTo) d.quantity = -Math.abs(d.quantity);
    }
  }

  const records = assignInventoryKeys(drafts.map(({ rawQty: _r, ...r }) => (void _r, r)));
  stats.rowsImported = records.length;
  stats.currencies = [...currencies].sort();
  for (const r of records) {
    if (!stats.dateMin || r.date < stats.dateMin) stats.dateMin = r.date;
    if (!stats.dateMax || r.date > stats.dateMax) stats.dateMax = r.date;
  }
  const snapshotDates = isMovement ? [] : [...new Set(records.map((r) => r.date))].sort();
  const hasCost = records.some((r) => r.value !== undefined || r.unitCost !== undefined);
  const kind: InventoryKind = isMovement ? 'movements' : snapshotDates.length > 1 ? 'history' : hasCost ? 'valuation' : 'snapshot';
  const unknown = isMovement ? records.filter((r) => r.movementType === 'unknown').length : 0;
  return { records, stats, kind, snapshotDates, dateFromAsOf: !dateField, unknownTypeShare: isMovement && records.length ? unknown / records.length : 0 };
}
