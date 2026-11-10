import type { CellValue } from '../types';
import { inferDateOrder, looksLikeDate, parseDate, type DateOrder } from '../schema/dates';
import { detectCurrencyInText, inferColumnDecimal, interpretNumberString, parseNumber, type Decimal } from '../schema/numbers';
import type { UCell, UColumn, UType } from './types';

const SAMPLE = 20000;
const BOOL_TRUE = new Set(['true', 'yes', 'y', 'taip', 'tak', 't', '1']);
const BOOL_FALSE = new Set(['false', 'no', 'n', 'ne', 'nie', 'f', '0']);
const DATETIME_RE = /^\s*\d{1,4}[-./]\d{1,2}[-./]\d{1,4}[ T]\d{1,2}:\d{2}(:\d{2})?/;
const PCT_RE = /%\s*$/;
const ID_HEADER = /(^|[\s_.-])(id|kod\w*|code|nr|no|numer\w*|number|nummer|sku|ref\w*|numeris|identyfikator)([\s_.-]|$)/i;
const DATE_HEADER = /(dat[ae]|data|date|day|diena|dzień|dzien|time|laikas|czas|period|laikotarp|okres)/i;
const PCT_HEADER = /(%|pct|percent|proc|procent|share|dalis|udział|udzial|rate|margin|marža|marza)/i;

const bool = (v: CellValue): boolean | null => {
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  return BOOL_TRUE.has(s) ? true : BOOL_FALSE.has(s) ? false : null;
};

export interface ColumnReading {
  decimal: Decimal;
  dateOrder: DateOrder;
}

/**
 * Suggests a type for every column. Several readings are often plausible (a column of 0/1 is a flag or a count; a 4-digit year is a date or a
 * number); those columns are marked `ambiguous` and the user must decide. Nothing here assigns business meaning.
 */
export function profileUniversal(headers: string[], rows: CellValue[][], decimalHint: Decimal = ','): { columns: UColumn[]; readings: ColumnReading[] } {
  const sample = rows.length > SAMPLE ? rows.slice(0, SAMPLE) : rows;
  const readings: ColumnReading[] = [];
  const columns = headers.map((header, index): UColumn => {
    const values: CellValue[] = [];
    for (const r of sample) {
      const v = r[index];
      if (v !== null && v !== undefined && v !== '') values.push(v);
    }
    const n = values.length;
    let missingAll = 0;
    for (const r of rows) {
      const v = r[index];
      if (v === null || v === undefined || v === '') missingAll++;
    }
    const nonEmptyAll = rows.length - missingAll;
    const distinctSet = new Set<string>();
    let dates = 0, datetimes = 0, numbers = 0, texts = 0, pcts = 0, bools = 0, ints = 0, leadingZero = 0, serials = 0, fraction = 0, textLen = 0;
    const cur = new Map<string, number>();
    for (const v of values) {
      distinctSet.add(String(v).toLowerCase());
      if (bool(v) !== null && (typeof v === 'boolean' || (typeof v === 'string' && (!/^\d+$/.test(v) || /^[01]$/.test(v.trim()))) || v === 0 || v === 1)) bools++;
      if (typeof v === 'number') {
        numbers++;
        if (Number.isInteger(v)) ints++;
        if (Number.isInteger(v) && v >= 30000 && v <= 60000) serials++;
        if (v >= 0 && v <= 1) fraction++;
      } else if (typeof v === 'string') {
        if (looksLikeDate(v.trim().split(/[ T]/)[0]!) && /^\s*\d/.test(v)) {
          dates++;
          if (DATETIME_RE.test(v)) datetimes++;
        } else if (interpretNumberString(v)) {
          numbers++;
          if (PCT_RE.test(v)) pcts++;
          if (/^\s*-?\d+\s*$/.test(v)) ints++;
          if (/^0\d+$/.test(v.trim())) leadingZero++;
          const c = detectCurrencyInText(v);
          if (c) cur.set(c, (cur.get(c) ?? 0) + 1);
        } else {
          texts++;
          textLen += v.length;
        }
      } else texts++;
    }
    const decimal = inferColumnDecimal(values, decimalHint).decimal;
    const dateOrder = inferDateOrder(values);
    readings[index] = { decimal, dateOrder };
    const distinct = distinctSet.size;
    const dr = n ? distinct / n : 0;
    const base = { index, header, nonEmpty: nonEmptyAll, missing: missingAll, invalid: 0, distinct, samples: [...new Set(values.slice(0, 40).map((v) => String(v)))].slice(0, 3), currency: undefined as string | undefined };
    const make = (type: UType, confidence: number, reason: string, alternatives: UType[] = [], force = false): UColumn => ({
      ...base, type, suggested: type, confidence, ambiguous: force || confidence < 0.8, alternatives: alternatives.filter((a) => a !== type), reason,
    });
    if (n === 0) return make('empty', 1, 'empty');
    const dateR = dates / n, numR = numbers / n, pctR = pcts / n, boolR = bools / n, serialR = serials / n;
    // booleans: only two distinct readings, all of them flag-like
    if (distinct <= 2 && boolR >= 0.98) {
      const onlyDigits = [...distinctSet].every((x) => x === '0' || x === '1');
      return onlyDigits ? make('boolean', 0.6, 'flag01', ['numeric', 'category'], true) : make('boolean', 0.95, 'flag');
    }
    // dates
    if (dateR >= 0.8) {
      const t = datetimes / dates >= 0.8 ? 'datetime' : 'date';
      const mixed = dateOrder === 'dmy' && values.some((v) => typeof v === 'string' && /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(v)) && !values.some((v) => typeof v === 'string' && /^(\d{1,2})[./-](\d{1,2})/.test(v) && Number(/^(\d{1,2})/.exec(v)![1]) > 12);
      return make(t, mixed ? 0.7 : 0.95, mixed ? 'dateOrder' : 'date', [t === 'date' ? 'datetime' : 'date', 'text'], mixed);
    }
    if (serialR >= 0.9 && DATE_HEADER.test(header)) return make('date', 0.75, 'serialDate', ['numeric'], true);
    // percent
    if (pctR >= 0.6 && numR >= 0.8) return make('percent', 0.95, 'percentSign', ['numeric']);
    if (numR >= 0.8 && fraction / n >= 0.95 && PCT_HEADER.test(header) && distinct > 3) return make('percent', 0.65, 'fraction', ['numeric'], true);
    // numbers
    if (numR >= 0.8) {
      const top = [...cur.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] >= n * 0.5) {
        const c = make('currency', 0.92, 'currencySymbol', ['numeric']);
        c.currency = top[0];
        return c;
      }
      const allInt = ints / n >= 0.98;
      if (leadingZero > 0 || (allInt && dr >= 0.95 && n >= 20 && ID_HEADER.test(header))) return make('identifier', leadingZero ? 0.9 : 0.85, ID_HEADER.test(header) ? 'idHeader' : 'leadingZeros', ['numeric']);
      if (allInt && dr >= 0.98 && n >= 20) return make('numeric', 0.55, 'uniqueInts', ['identifier'], true);
      if (allInt && distinct <= 12 && n >= 20 && dr < 0.2) {
        const yearish = [...distinctSet].every((x) => /^(19|20)\d{2}$/.test(x));
        return make(yearish ? 'category' : 'numeric', 0.55, yearish ? 'yearLike' : 'fewInts', yearish ? ['date', 'numeric'] : ['category'], true);
      }
      if (numR < 0.95) return make('numeric', 0.6, 'mixedNumbers', ['text', 'category'], true);
      return make('numeric', 0.95, 'numbers');
    }
    // text-like
    const avg = texts ? textLen / texts : 0;
    if (numR >= 0.5) return make('text', 0.5, 'mixedText', ['numeric', 'category'], true);
    if (avg > 45 && dr > 0.5) return make('text', 0.85, 'longText', ['category']);
    if (dr >= 0.9 && n >= 20) {
      if (ID_HEADER.test(header) || /^[A-Za-z]{0,4}[-_ ]?\d{2,}$/.test(String(values[0]))) return make('identifier', 0.85, 'idPattern', ['text', 'category']);
      return make(avg <= 24 ? 'identifier' : 'text', 0.55, 'manyDistinct', avg <= 24 ? ['text', 'category'] : ['category'], true);
    }
    if (distinct <= 60 || dr <= 0.3) return make('category', dr < 0.5 ? 0.9 : 0.7, 'fewDistinct', ['text', 'identifier']);
    return make('category', 0.6, 'moderateDistinct', ['text', 'identifier'], true);
  });
  return { columns, readings };
}

/** Columns whose suggestion needs an explicit decision and have none yet. */
export function unresolvedColumns(columns: UColumn[], decisions: Record<number, UType>): number[] {
  return columns.filter((c) => c.ambiguous && decisions[c.index] === undefined).map((c) => c.index);
}

export function applyDecisions(columns: UColumn[], decisions: Record<number, UType>): UColumn[] {
  return columns.map((c) => ({ ...c, type: decisions[c.index] ?? c.type, ambiguous: c.ambiguous && decisions[c.index] === undefined }));
}

/** Converts raw cells to typed cells for the final column types, counting values that do not fit. */
export function materialize(rows: CellValue[][], columns: UColumn[], readings: ColumnReading[]): { cols: UCell[][]; columns: UColumn[] } {
  const out: UCell[][] = [];
  const fin = columns.map((c) => ({ ...c, invalid: 0 }));
  columns.forEach((c, ci) => {
    const { decimal, dateOrder } = readings[ci] ?? { decimal: ',' as Decimal, dateOrder: 'dmy' as DateOrder };
    const col: UCell[] = new Array(rows.length);
    const fractionToPct = c.type === 'percent' && c.suggested === 'percent' && c.reason === 'fraction';
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i]![c.index];
      if (v === null || v === undefined || v === '') { col[i] = null; continue; }
      let cell: UCell = null;
      switch (c.type) {
        case 'numeric': case 'currency': cell = parseNumber(typeof v === 'string' ? v.replace(PCT_RE, '') : v, decimal); break;
        case 'percent': { const x = parseNumber(typeof v === 'string' ? v.replace(PCT_RE, '') : v, decimal); cell = x === null ? null : fractionToPct ? x * 100 : x; break; }
        case 'date': cell = typeof v === 'string' ? parseDate(v.trim().split(/[ T]/)[0]!, dateOrder) : parseDate(v, dateOrder); break;
        case 'datetime': {
          const d = typeof v === 'string' ? parseDate(v.trim().split(/[ T]/)[0]!, dateOrder) : parseDate(v, dateOrder);
          const t = typeof v === 'string' ? /[ T](\d{1,2}):(\d{2})/.exec(v) : null;
          cell = d ? (t ? `${d}T${t[1]!.padStart(2, '0')}:${t[2]}` : d) : null;
          break;
        }
        case 'boolean': { const b = bool(v); cell = b === null ? null : b ? 1 : 0; break; }
        case 'empty': cell = null; break;
        default: cell = String(v).trim();
      }
      if (cell === null) fin[ci]!.invalid++;
      col[i] = cell;
    }
    out.push(col);
  });
  return { cols: out, columns: fin };
}
