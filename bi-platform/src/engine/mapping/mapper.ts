import type { ColumnProfile, MappingEntry, MappingProposal, MappingWarning, SalesField } from '../types';
import { SALES_FIELDS } from '../types';
import { GROSS_HINT_TOKENS, ID_FIELDS, NET_HINT_TOKENS, NUMERIC_FIELDS, SALES_SYNONYMS, TEXT_FIELDS } from './dictionary';
import { levenshtein, normalizeHeader, tokens } from './normalize';
import { matchTemplate } from './templates';
import { normalizeCurrency } from '../schema/numbers';

export const PROPOSE_THRESHOLD = 0.55;
export const LOW_CONFIDENCE = 0.75;

/** Name-based score of a header for a field: 1 exact, 0.7–0.9 token subset, 0.75 near-match. */
export function headerScore(header: string, field: SalesField): number {
  const n = normalizeHeader(header);
  if (!n) return 0;
  const toks = n.split(' ');
  let best = 0;
  for (const syn of SALES_SYNONYMS[field]) {
    if (syn === n) return 1;
    const st = syn.split(' ');
    if (st.every((t) => toks.includes(t))) best = Math.max(best, 0.6 + 0.1 * Math.min(st.length, 3));
    else if (n.length >= 5 && syn.length >= 5 && levenshtein(n, syn) <= 1) best = Math.max(best, 0.75);
  }
  return best;
}

function basisHint(header: string): 'net' | 'gross' | null {
  const toks = tokens(header);
  const joined = ` ${toks.join(' ')} `;
  const net = toks.some((t) => NET_HINT_TOKENS.includes(t)) || joined.includes(' be pvm ') || joined.includes(' bez vat ');
  const gross = toks.some((t) => GROSS_HINT_TOKENS.includes(t)) || joined.includes(' su pvm ') || joined.includes(' z vat ');
  if (net && !gross) return 'net';
  if (gross && !net) return 'gross';
  return null;
}

function valueCompat(field: SalesField, p: ColumnProfile): number {
  if (p.nonEmpty === 0) return 0;
  if (field === 'document_date') return Math.max(p.dateRatio, p.serialDateRatio);
  if (NUMERIC_FIELDS.includes(field)) return p.numberRatio;
  if (TEXT_FIELDS.includes(field)) return p.numberRatio > 0.8 || p.dateRatio > 0.8 ? 0.1 : p.textRatio;
  if (ID_FIELDS.includes(field)) return p.dateRatio > 0.8 ? 0.1 : 0.9;
  if (field === 'currency') return p.textRatio > 0.8 && p.avgTextLength <= 5 && p.distinctRatio < 0.2 ? 1 : 0.2;
  return 0.5;
}

interface Candidate {
  field: SalesField;
  column: number;
  score: number;
}

export interface MapperOptions {
  /** field → normalised header, from a mapping the user confirmed earlier on the same layout. */
  saved?: Partial<Record<SalesField, string>>;
}

export function suggestMapping(profiles: ColumnProfile[], opts: MapperOptions = {}): MappingProposal {
  const entries: MappingEntry[] = [];
  const usedCols = new Set<number>();
  const usedFields = new Set<SalesField>();
  const normHeaders = profiles.map((p) => normalizeHeader(p.header));

  const apply = (map: Partial<Record<SalesField, string>>, source: MappingEntry['source'], confidence: number) => {
    for (const [field, nh] of Object.entries(map) as [SalesField, string][]) {
      const idx = normHeaders.findIndex((h, i) => h === nh && !usedCols.has(i));
      if (idx < 0 || usedFields.has(field)) continue;
      entries.push({ field, columnIndex: idx, confidence, source });
      usedCols.add(idx);
      usedFields.add(field);
    }
  };

  let templateId: string | undefined;
  if (opts.saved) apply(opts.saved, 'saved', 0.98);
  else {
    const m = matchTemplate(normHeaders);
    if (m) {
      templateId = m.template.id;
      apply(m.template.headers, 'template', 0.9 + 0.08 * m.ratio);
    }
  }

  // Heuristic pass for everything still unmapped.
  const candidates: Candidate[] = [];
  for (const p of profiles) {
    if (usedCols.has(p.index)) continue;
    const hint = basisHint(p.header);
    for (const field of SALES_FIELDS) {
      if (usedFields.has(field)) continue;
      let h = headerScore(p.header, field);
      // VAT basis words in the header decide between net / gross / unspecified.
      if (field === 'net_amount' && hint === 'net' && p.numberRatio >= 0.8) h = Math.max(h, 0.85);
      if (field === 'gross_amount' && hint === 'gross' && p.numberRatio >= 0.8) h = Math.max(h, 0.85);
      if (field === 'amount_unknown_basis' && hint) h = 0;
      if (field === 'net_amount' && hint === 'gross') h = 0;
      if (field === 'gross_amount' && hint === 'net') h = 0;
      const compat = valueCompat(field, p);
      let score: number;
      if (h > 0) {
        score = h * 0.7 + compat * 0.3;
        if (compat < 0.5) score *= 0.4;
      } else if (field === 'document_date' && p.dateRatio >= 0.9) {
        score = 0.58; // values alone are enough for a *proposal* of the date column
      } else if (field === 'currency' && p.textRatio > 0.9 && p.nonEmpty > 0 && valueCompat('currency', p) === 1) {
        score = 0.58;
      } else continue;
      if (score >= PROPOSE_THRESHOLD) candidates.push({ field, column: p.index, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    if (usedCols.has(c.column) || usedFields.has(c.field)) continue;
    entries.push({ field: c.field, columnIndex: c.column, confidence: Math.round(c.score * 100) / 100, source: 'heuristic' });
    usedCols.add(c.column);
    usedFields.add(c.field);
  }

  // Currency from values (e.g. "12,50 €") when there is no currency column.
  let detectedCurrency: string | undefined;
  if (!usedFields.has('currency')) {
    const amountCols = entries.filter((e) => ['net_amount', 'gross_amount', 'amount_unknown_basis'].includes(e.field));
    for (const e of amountCols) {
      const hints = profiles[e.columnIndex]?.currencyHints ?? [];
      if (hints.length === 1) detectedCurrency = normalizeCurrency(hints[0]!) ?? undefined;
    }
    if (!detectedCurrency) {
      for (const p of profiles) {
        const m = /\b(eur|pln|usd|gbp)\b/i.exec(p.header);
        if (m) detectedCurrency = m[1]!.toUpperCase();
      }
      if (!detectedCurrency && /€/.test(profiles.map((p) => p.header).join(' '))) detectedCurrency = 'EUR';
      if (!detectedCurrency && /zł/i.test(profiles.map((p) => p.header).join(' '))) detectedCurrency = 'PLN';
    }
  }

  return { entries: entries.sort((a, b) => a.columnIndex - b.columnIndex), templateId, detectedCurrency, warnings: validateMapping(entries) };
}

export function validateMapping(entries: Pick<MappingEntry, 'field' | 'confidence'>[]): MappingWarning[] {
  const w: MappingWarning[] = [];
  const has = (f: SalesField) => entries.some((e) => e.field === f);
  if (!has('document_date')) w.push({ code: 'missing_date' });
  const amountFields = (['net_amount', 'gross_amount', 'amount_unknown_basis'] as const).filter(has);
  if (amountFields.length === 0) w.push({ code: 'missing_amount' });
  if (amountFields.length > 1) w.push({ code: 'multiple_amounts' });
  if (amountFields.length === 1 && amountFields[0] === 'amount_unknown_basis') w.push({ code: 'amount_basis_unknown' });
  for (const e of entries) if (e.confidence < LOW_CONFIDENCE) w.push({ code: 'low_confidence', field: e.field });
  return w;
}

/** A mapping can only be confirmed when it has a date and at least one amount column. */
export function isMappingConfirmable(warnings: MappingWarning[]): boolean {
  return !warnings.some((w) => w.code === 'missing_date' || w.code === 'missing_amount');
}

/** Makes a mapping reusable on another file with the same layout. */
export function mappingToSaved(entries: Pick<MappingEntry, 'field' | 'columnIndex'>[], headers: string[]): Partial<Record<SalesField, string>> {
  const out: Partial<Record<SalesField, string>> = {};
  for (const e of entries) out[e.field] = normalizeHeader(headers[e.columnIndex] ?? '');
  return out;
}

export function layoutSignature(headers: string[]): string {
  return headers.map(normalizeHeader).filter(Boolean).sort().join('|');
}
