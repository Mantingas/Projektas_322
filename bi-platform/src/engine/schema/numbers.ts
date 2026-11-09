import type { CellValue } from '../types';

export type Decimal = ',' | '.';

const CURRENCY_TOKENS: [RegExp, string][] = [
  [/€|\beur(o|os|ai)?\b/i, 'EUR'],
  [/zł|\bpln\b|\bzl\b|złot/i, 'PLN'],
  [/\$|\busd\b/i, 'USD'],
  [/£|\bgbp\b/i, 'GBP'],
  [/\bczk\b|kč/i, 'CZK'],
  [/\bsek\b/i, 'SEK'],
];

export function detectCurrencyInText(text: string): string | undefined {
  for (const [re, code] of CURRENCY_TOKENS) if (re.test(text)) return code;
  return undefined;
}

const KNOWN_CODES = new Set(['EUR', 'PLN', 'USD', 'GBP', 'CZK', 'SEK', 'NOK', 'DKK', 'CHF', 'LTL', 'LVL']);

/** Normalises a currency cell ("€", "eur", "Zł") to an ISO code, or undefined if unrecognised. */
export function normalizeCurrency(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const up = t.toUpperCase();
  if (KNOWN_CODES.has(up)) return up;
  return detectCurrencyInText(t);
}

const STRIP = /[\s  '’]/g;

/** Cleans a numeric string down to digits, separators and a sign. Returns null if it doesn't look numeric. */
function clean(raw: string): { s: string; negative: boolean } | null {
  let t = raw.trim();
  if (!t) return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  // remove currency symbols / codes / percent
  t = t.replace(/€|zł|\$|£|kč|%/gi, '').replace(/\b(eur|pln|usd|gbp|czk|sek|zl)\b/gi, '');
  t = t.replace(STRIP, '');
  if (t.endsWith('-')) {
    negative = true;
    t = t.slice(0, -1);
  }
  if (t.startsWith('-') || t.startsWith('−')) {
    negative = !negative;
    t = t.slice(1);
  } else if (t.startsWith('+')) t = t.slice(1);
  if (!/^\d[\d.,]*$/.test(t) && !/^[.,]\d+$/.test(t)) return null;
  return { s: t, negative };
}

export type Interpretation = { value: number } | { ambiguous: true; asDecimal: number; asThousands: number } | null;

/** Interprets a numeric string without outside knowledge. Ambiguous cases are flagged, not guessed. */
export function interpretNumberString(raw: string): Interpretation {
  const c = clean(raw);
  if (!c) return null;
  const { s, negative } = c;
  const sign = negative ? -1 : 1;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  const num = (str: string) => {
    const v = Number(str);
    return Number.isFinite(v) ? sign * v : null;
  };
  if (!hasDot && !hasComma) {
    const v = num(s);
    return v === null ? null : { value: v };
  }
  if (hasDot && hasComma) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    // The thousands separator must not appear after the decimal one.
    if (s.lastIndexOf(thou) > s.lastIndexOf(dec)) return null;
    const v = num(s.split(thou).join('').replace(dec, '.'));
    return v === null ? null : { value: v };
  }
  const sep = hasDot ? '.' : ',';
  const parts = s.split(sep);
  if (parts.length > 2) {
    // 1.234.567 → thousands only if groups of 3
    if (parts.slice(1).every((p) => p.length === 3)) {
      const v = num(parts.join(''));
      return v === null ? null : { value: v };
    }
    return null;
  }
  const [intPart, frac] = parts as [string, string];
  if (frac === '') return null;
  if (frac.length === 3 && intPart.length >= 1 && intPart.length <= 3 && intPart !== '0') {
    const asThousands = num(intPart + frac);
    const asDecimal = num(intPart + '.' + frac);
    if (asThousands === null || asDecimal === null) return null;
    return { ambiguous: true, asDecimal, asThousands };
  }
  const v = num(intPart + '.' + frac);
  return v === null ? null : { value: v };
}

export interface NumberFormatEvidence {
  decimal: Decimal;
  /** Number of values that could not be resolved from the column itself. */
  ambiguous: number;
}

/**
 * Infers the decimal separator of a column from all its values.
 * Evidence: values like "12,5" or "1.234,56" prove comma-decimal; "12.5" / "1,234.56" prove dot-decimal.
 * With no evidence, `hint` (the UI language convention) decides.
 */
export function inferColumnDecimal(values: CellValue[], hint: Decimal = ','): NumberFormatEvidence {
  let comma = 0;
  let dot = 0;
  let ambiguous = 0;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const c = clean(v);
    if (!c) continue;
    const s = c.s;
    const hasDot = s.includes('.');
    const hasComma = s.includes(',');
    if (hasDot && hasComma) {
      if (s.lastIndexOf('.') > s.lastIndexOf(',')) dot++;
      else comma++;
    } else if (hasDot || hasComma) {
      const sep = hasDot ? '.' : ',';
      const parts = s.split(sep);
      if (parts.length > 2) {
        if (sep === '.') comma++; // 1.234.567 → dot is thousands → comma decimal
        else dot++;
      } else {
        const frac = parts[1] ?? '';
        if (frac.length !== 3 || (parts[0] ?? '') === '0') {
          if (sep === ',') comma++;
          else dot++;
        } else ambiguous++;
      }
    }
  }
  if (comma > dot) return { decimal: ',', ambiguous: 0 };
  if (dot > comma) return { decimal: '.', ambiguous: 0 };
  return { decimal: hint, ambiguous };
}

/** Parses one cell to a number using the column's decimal convention. */
export function parseNumber(v: CellValue, decimal: Decimal): number | null {
  if (v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return null;
  const r = interpretNumberString(v);
  if (!r) return null;
  if ('value' in r) return r.value;
  return decimal === '.' ? r.asDecimal : r.asThousands;
}
