import type { CellValue, ColumnProfile } from '../types';
import { inferDateOrder, looksLikeDate } from './dates';
import { detectCurrencyInText, inferColumnDecimal, interpretNumberString, type Decimal } from './numbers';

const PROFILE_SAMPLE = 20000;

export function profileColumns(headers: string[], dataRows: CellValue[][], decimalHint: Decimal = ','): ColumnProfile[] {
  const rows = dataRows.length > PROFILE_SAMPLE ? dataRows.slice(0, PROFILE_SAMPLE) : dataRows;
  return headers.map((header, index) => {
    const values: CellValue[] = [];
    for (const r of rows) {
      const v = r[index];
      if (v !== null && v !== undefined && v !== '') values.push(v);
    }
    const n = values.length;
    let dates = 0;
    let serials = 0;
    let numbers = 0;
    let texts = 0;
    let negatives = 0;
    let textLen = 0;
    const currencyHits = new Map<string, number>();
    const distinct = new Set<string>();
    for (const v of values) {
      distinct.add(String(v));
      if (typeof v === 'number') {
        numbers++;
        if (Number.isInteger(v) && v >= 30000 && v <= 60000) serials++;
        if (v < 0) negatives++;
      } else if (typeof v === 'string') {
        if (looksLikeDate(v)) dates++;
        else if (interpretNumberString(v)) {
          numbers++;
          if (/^\(|^-|^−|-$/.test(v.trim())) negatives++;
          const cur = detectCurrencyInText(v);
          if (cur) currencyHits.set(cur, (currencyHits.get(cur) ?? 0) + 1);
        } else {
          texts++;
          textLen += v.length;
        }
      } else texts++;
    }
    const { decimal, ambiguous } = inferColumnDecimal(values, decimalHint);
    const dateRatio = n ? dates / n : 0;
    const numberRatio = n ? numbers / n : 0;
    const textRatio = n ? texts / n : 0;
    const type = n === 0 ? 'empty' : dateRatio >= 0.8 ? 'date' : numberRatio >= 0.8 ? 'number' : 'text';
    return {
      index,
      header,
      nonEmpty: n,
      dateRatio,
      serialDateRatio: n ? serials / n : 0,
      numberRatio,
      textRatio,
      distinctRatio: n ? distinct.size / n : 0,
      avgTextLength: texts ? textLen / texts : 0,
      negativeRatio: n ? negatives / n : 0,
      currencyHints: [...currencyHits.entries()].filter(([, c]) => c >= n * 0.5).map(([k]) => k),
      type,
      decimal,
      dateOrder: inferDateOrder(values),
      ambiguousNumbers: ambiguous,
    } satisfies ColumnProfile;
  });
}
