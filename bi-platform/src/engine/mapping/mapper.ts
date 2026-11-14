import type { ColumnProfile, FieldId, MappingEntry, MappingProposal, MappingWarning, ModuleId } from '../types';
import { FINANCE_WORDS, GROSS_HINT_TOKENS, INVENTORY_WORDS, PAYABLE_WORDS, RECEIVABLE_WORDS, NET_HINT_TOKENS, PURCHASING_WORDS, SALES_WORDS, SPECS, type ModuleSpec } from './dictionary';
import { levenshtein, normalizeHeader, tokens } from './normalize';
import { matchTemplate } from './templates';
import { normalizeCurrency, parseNumber } from '../schema/numbers';
import type { CellValue } from '../types';

export const PROPOSE_THRESHOLD = 0.55;
export const LOW_CONFIDENCE = 0.75;
const CONTESTED_MARGIN = 0.03;
const SUSPECT_SAVED_CONFIDENCE = 0.5;
const CONTESTED_CONFIDENCE = 0.7;

/** Currency suffixes ("Suma_EUR", "Kaina PLN") say which currency a column is in, not what it is. */
const CURRENCY_WORDS = new Set(['eur', 'euro', 'euros', 'pln', 'usd', 'gbp', 'czk', 'sek', 'zl']);
/** A catalogue / list price is not the price a line was sold at. */
const LIST_PRICE_WORDS = new Set(['katalogo', 'katalogine', 'katalog', 'katalogowa', 'list', 'cennikowa', 'bazine', 'base']);
/** A rate, not an amount: "PVM %", "PVM proc", "VAT rate". */
const RATE_WORDS = new Set(['proc', 'procent', 'procentai', 'percent', 'pct', 'rate', 'tarifas', 'stawka']);

/** Header words without currency suffixes. */
function coreTokens(header: string): string[] {
  const t = tokens(header);
  const core = t.filter((w) => !CURRENCY_WORDS.has(w));
  return core.length ? core : t;
}

/** True when the header's own words rule the field out: a VAT basis or rate is not a VAT amount; a list price is not the price a line was sold at. */
export function contradictsHeader(header: string, field: FieldId): boolean {
  const toks = coreTokens(header);
  if (field === 'vat_amount') return basisHint(header) !== null || toks.some((t) => RATE_WORDS.has(t)) || header.includes('%');
  if (field === 'unit_price') return toks.some((t) => LIST_PRICE_WORDS.has(t));
  return false;
}

/** Name-based score of a header for a field: 1 exact, 0.7–0.9 token subset, 0.75 near-match. */
export function headerScore(header: string, field: FieldId, module: ModuleId = 'sales'): number {
  const toks = coreTokens(header);
  const n = toks.join(' ');
  if (!n) return 0;
  // a header that names the VAT basis ("be PVM", "su PVM", "net", "gross") or a rate is not a VAT amount; a list price is not the sold price
  if (contradictsHeader(header, field)) return 0;
  let best = 0;
  for (const syn of SPECS[module].synonyms(field)) {
    if (syn === n) return 1;
    const st = syn.split(' ');
    if (st.every((t) => toks.includes(t))) best = Math.max(best, 0.6 + 0.1 * Math.min(st.length, 3));
    else if (n.length >= 5 && syn.length >= 5 && levenshtein(n, syn) <= 1) best = Math.max(best, 0.75);
  }
  return best;
}

function basisHint(header: string): 'net' | 'gross' | null {
  const toks = coreTokens(header);
  const joined = ` ${toks.join(' ')} `;
  const net = toks.some((t) => NET_HINT_TOKENS.includes(t)) || joined.includes(' be pvm ') || joined.includes(' bez vat ');
  const gross = toks.some((t) => GROSS_HINT_TOKENS.includes(t)) || joined.includes(' su pvm ') || joined.includes(' z vat ');
  if (net && !gross) return 'net';
  if (gross && !net) return 'gross';
  return null;
}

function valueCompat(field: FieldId, p: ColumnProfile, spec: ModuleSpec): number {
  if (p.nonEmpty === 0) return 0;
  if (field === 'document_date' || field === 'snapshot_date' || field === 'movement_date' || field === 'due_date' || field === 'payment_date') return Math.max(p.dateRatio, p.serialDateRatio);
  if (spec.numeric.includes(field)) return p.numberRatio;
  if (field === 'unit' || field === 'document_type' || field === 'movement_type') return p.textRatio > 0.8 && p.avgTextLength <= 32 && (p.distinctRatio < 0.2 || p.distinctRatio * p.nonEmpty <= 12) ? 1 : 0.3; // few distinct values: a categorical column, even in a short file
  if (spec.text.includes(field)) return p.numberRatio > 0.8 || p.dateRatio > 0.8 ? 0.1 : p.textRatio;
  // identifiers carry no value evidence: a generic header such as "Vidinis kodas" must not look confident
  if (spec.ids.includes(field)) return p.dateRatio > 0.8 ? 0.1 : 0.6;
  // a currency column holds currency codes; "OE11", "A12" are short and repetitive too, but they are not currencies
  if (field === 'currency') return p.currencyCodeRatio !== undefined ? (p.currencyCodeRatio >= 0.8 && p.textRatio > 0.8 ? 1 : 0.2) : p.textRatio > 0.8 && p.avgTextLength <= 5 && p.distinctRatio < 0.2 ? 1 : 0.2;
  return 0.5;
}

interface Candidate {
  field: FieldId;
  column: number;
  score: number;
}

export interface MapperOptions {
  /** field → normalised header, from a mapping the user confirmed earlier on the same layout. */
  saved?: Partial<Record<FieldId, string>>;
  /** Which module's vocabulary and fields to use (default: sales). */
  module?: ModuleId;
}

export function suggestMapping(profiles: ColumnProfile[], opts: MapperOptions = {}): MappingProposal {
  const module = opts.module ?? 'sales';
  const spec = SPECS[module];
  const entries: MappingEntry[] = [];
  const usedCols = new Set<number>();
  const usedFields = new Set<FieldId>();
  const normHeaders = profiles.map((p) => normalizeHeader(p.header));

  const apply = (map: Partial<Record<FieldId, string>>, source: MappingEntry['source'], confidence: number) => {
    for (const [field, nh] of Object.entries(map) as [FieldId, string][]) {
      const idx = normHeaders.findIndex((h, i) => h === nh && !usedCols.has(i));
      if (idx < 0 || usedFields.has(field)) continue;
      // a remembered choice does not bypass the header rules: if the header itself rules the field out, keep the choice but ask for review
      entries.push({ field, columnIndex: idx, confidence: source === 'saved' && contradictsHeader(profiles[idx]!.header, field) ? SUSPECT_SAVED_CONFIDENCE : confidence, source });
      usedCols.add(idx);
      usedFields.add(field);
    }
  };

  let templateId: string | undefined;
  if (opts.saved) apply(opts.saved, 'saved', 0.98);
  else if (module === 'sales') {
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
    for (const field of spec.fields) {
      if (usedFields.has(field)) continue;
      let h = headerScore(p.header, field, module);
      // VAT basis words in the header decide between net / gross / unspecified.
      if (field === 'net_amount' && hint === 'net' && p.numberRatio >= 0.8) h = Math.max(h, 0.85);
      if (field === 'gross_amount' && hint === 'gross' && p.numberRatio >= 0.8) h = Math.max(h, 0.85);
      if (field === 'amount_unknown_basis' && hint) h = 0;
      if (field === 'net_amount' && hint === 'gross') h = 0;
      if (field === 'gross_amount' && hint === 'net') h = 0;
      const compat = valueCompat(field, p, spec);
      let score: number;
      if (h > 0) {
        score = h * 0.7 + compat * 0.3;
        if (compat < 0.5) score *= 0.4;
      } else if ((field === 'document_date' || field === 'snapshot_date') && p.dateRatio >= 0.9) {
        score = 0.58; // values alone are enough for a *proposal* of the date column
      } else if (field === 'currency' && p.textRatio > 0.9 && p.nonEmpty > 0 && valueCompat('currency', p, spec) === 1) {
        score = 0.58;
      } else continue;
      if (score >= PROPOSE_THRESHOLD) candidates.push({ field, column: p.index, score });
    }
  }
  // ties are settled by header text, not by column position: the same columns in another order must map the same way
  candidates.sort((a, b) => b.score - a.score || normHeaders[a.column]!.localeCompare(normHeaders[b.column]!) || a.column - b.column);
  for (const c of candidates) {
    if (usedCols.has(c.column) || usedFields.has(c.field)) continue;
    // another free column is almost as good a fit for this field: take one, but ask the user to confirm
    const rival = candidates.some((o) => o.field === c.field && o.column !== c.column && !usedCols.has(o.column) && o.score >= c.score - CONTESTED_MARGIN);
    const confidence = Math.round((rival ? Math.min(c.score, CONTESTED_CONFIDENCE) : c.score) * 100) / 100;
    entries.push({ field: c.field, columnIndex: c.column, confidence, source: 'heuristic' });
    usedCols.add(c.column);
    usedFields.add(c.field);
  }

  // Currency from values (e.g. "12,50 €") when there is no currency column.
  let detectedCurrency: string | undefined;
  if (!usedFields.has('currency')) {
    const amountCols = entries.filter((e) => ['net_amount', 'gross_amount', 'amount_unknown_basis', 'stock_value', 'unit_cost'].includes(e.field));
    for (const e of amountCols) {
      const hints = profiles[e.columnIndex]?.currencyHints ?? [];
      if (hints.length === 1) detectedCurrency = normalizeCurrency(hints[0]!) ?? undefined;
    }
    if (!detectedCurrency) {
      // only when the headers agree on one currency: "Suma_EUR" next to "Suma_USD" says nothing about the file
      const found = new Set<string>();
      for (const p of profiles) for (const w of tokens(p.header)) if (['eur', 'pln', 'usd', 'gbp'].includes(w)) found.add(w.toUpperCase());
      if (found.size === 1) detectedCurrency = [...found][0];
      if (!detectedCurrency && /€/.test(profiles.map((p) => p.header).join(' '))) detectedCurrency = 'EUR';
      if (!detectedCurrency && /zł/i.test(profiles.map((p) => p.header).join(' '))) detectedCurrency = 'PLN';
    }
  }

  // inventory: a date column next to a movement-type column is a MOVEMENT date, not a snapshot date
  if (module === 'inventory') {
    const hasType = entries.some((e) => e.field === 'movement_type');
    const snap = entries.find((e) => e.field === 'snapshot_date');
    if (hasType && snap && !entries.some((e) => e.field === 'movement_date')) snap.field = 'movement_date';
  }
  return { entries: entries.sort((a, b) => a.columnIndex - b.columnIndex), templateId, detectedCurrency, warnings: validateMapping(entries, module) };
}

/**
 * Cross-checks the amount columns on the data: net + VAT ≈ gross on the same line. If most rows disagree, the header reading is doubtful,
 * so the three columns are lowered to "please confirm". Only lines are compared with lines (never a unit price with a line total).
 */
export function checkAmountConsistency(proposal: MappingProposal, profiles: ColumnProfile[], rows: CellValue[][]): MappingProposal {
  const col = (f: FieldId) => proposal.entries.find((e) => e.field === f);
  const net = col('net_amount'), vat = col('vat_amount'), gross = col('gross_amount');
  if (!net || !vat || !gross) return proposal;
  let ok = 0, seen = 0;
  for (let i = 0; i < rows.length && seen < 2000; i++) {
    const r = rows[i]!;
    const n = parseNumber(r[net.columnIndex] ?? null, profiles[net.columnIndex]!.decimal);
    const v = parseNumber(r[vat.columnIndex] ?? null, profiles[vat.columnIndex]!.decimal);
    const g = parseNumber(r[gross.columnIndex] ?? null, profiles[gross.columnIndex]!.decimal);
    if (n === null || v === null || g === null || (n === 0 && v === 0 && g === 0)) continue;
    seen++;
    if (Math.abs(n + v - g) <= Math.max(0.02, Math.abs(g) * 0.005)) ok++;
  }
  if (seen < 5 || ok / seen >= 0.6) return proposal;
  const entries = proposal.entries.map((e) => (e === net || e === vat || e === gross) ? { ...e, confidence: Math.min(e.confidence, 0.6) } : e);
  return { ...proposal, entries, warnings: validateMapping(entries, 'sales') };
}

export function validateMapping(entries: Pick<MappingEntry, 'field' | 'confidence'>[], module: ModuleId = 'sales', ctx: { hasDefaultDate?: boolean } = {}): MappingWarning[] {
  const w: MappingWarning[] = [];
  const has = (f: FieldId) => entries.some((e) => e.field === f);
  if (module === 'finance') {
    // a finance file needs: a counterparty, an amount (or aging buckets) and a date (a column, or the as-of date the user states)
    if (!has('counterparty_id') && !has('counterparty_name')) w.push({ code: 'missing_counterparty' });
    const amount = ['original_amount', 'outstanding_amount', 'paid_amount', 'aging_current', 'aging_1_30', 'aging_31_60', 'aging_61_90', 'aging_90_plus'].some((f) => has(f as FieldId));
    if (!amount) w.push({ code: 'missing_amount' });
    if (!['document_date', 'snapshot_date', 'payment_date'].some((f) => has(f as FieldId)) && !ctx.hasDefaultDate) w.push({ code: 'missing_date' });
    for (const e of entries) if (e.confidence < LOW_CONFIDENCE) w.push({ code: 'low_confidence', field: e.field });
    return w;
  }
  if (module === 'inventory') {
    // a stock file needs: a date (a column, or the as-of date the user states), a product, and a quantity or a stock value
    if (!has('snapshot_date') && !has('movement_date') && !ctx.hasDefaultDate) w.push({ code: 'missing_date' });
    if (!has('product_id') && !has('product_name')) w.push({ code: 'missing_product' });
    if (!has('quantity') && !has('stock_value')) w.push({ code: 'missing_quantity' });
    for (const e of entries) if (e.confidence < LOW_CONFIDENCE) w.push({ code: 'low_confidence', field: e.field });
    return w;
  }
  if (!has('document_date')) w.push({ code: 'missing_date' });
  const amountFields = (['net_amount', 'gross_amount', 'amount_unknown_basis'] as const).filter(has);
  if (amountFields.length === 0) w.push({ code: 'missing_amount' });
  if (amountFields.length > 1) w.push({ code: 'multiple_amounts' });
  if (amountFields.length === 1 && amountFields[0] === 'amount_unknown_basis') w.push({ code: 'amount_basis_unknown' });
  if (module === 'purchasing' && !has('supplier_name') && !has('supplier_id')) w.push({ code: 'missing_supplier' });
  for (const e of entries) if (e.confidence < LOW_CONFIDENCE) w.push({ code: 'low_confidence', field: e.field });
  return w;
}

/** Remembered choices the header itself rules out (flagged with low confidence by suggestMapping): an import using them needs the person's explicit confirmation. */
export function suspectSavedEntries<T extends Pick<MappingEntry, 'source' | 'confidence'>>(entries: T[]): T[] {
  return entries.filter((e) => e.source === 'saved' && e.confidence < LOW_CONFIDENCE);
}

/** A mapping can only be confirmed when it has a date and at least one amount column. */
export function isMappingConfirmable(warnings: MappingWarning[]): boolean {
  return !warnings.some((w) => w.code === 'missing_date' || w.code === 'missing_amount' || w.code === 'missing_product' || w.code === 'missing_quantity' || w.code === 'missing_counterparty');
}

/** Makes a mapping reusable on another file with the same layout. */
export function mappingToSaved(entries: Pick<MappingEntry, 'field' | 'columnIndex'>[], headers: string[]): Partial<Record<FieldId, string>> {
  const out: Partial<Record<FieldId, string>> = {};
  for (const e of entries) out[e.field] = normalizeHeader(headers[e.columnIndex] ?? '');
  return out;
}

export function layoutSignature(headers: string[], module: ModuleId = 'sales'): string {
  const sig = headers.map(normalizeHeader).filter(Boolean).sort().join('|');
  return module === 'sales' ? sig : `${module}:${sig}`; // sales signatures stay unchanged
}

/**
 * Suggests which kind of file this is from header words. Ambiguous words ("kontrahent", "pardavėjas") count for neither;
 * ties and unclear files default to sales. The user always confirms the choice.
 */
/** Receivable (customers) or payable (suppliers) from header words; null when the words do not decide. */
export function detectSide(headers: string[]): 'receivable' | 'payable' | null {
  const toks = new Set(headers.flatMap((h) => normalizeHeader(h).split(' ')));
  const r = RECEIVABLE_WORDS.filter((w) => toks.has(w)).length;
  const p = PAYABLE_WORDS.filter((w) => toks.has(w)).length;
  return r > p ? 'receivable' : p > r ? 'payable' : null;
}

export function detectModule(headers: string[]): { module: ModuleId; purchasing: number; sales: number; inventory: number; finance: number } {
  const toks = new Set(headers.flatMap((h) => normalizeHeader(h).split(' ')));
  const purchasing = PURCHASING_WORDS.filter((w) => toks.has(w)).length;
  const sales = SALES_WORDS.filter((w) => toks.has(w)).length;
  const inventory = INVENTORY_WORDS.filter((w) => toks.has(w)).length;
  const finance = FINANCE_WORDS.filter((w) => toks.has(w)).length;
  const module: ModuleId = finance >= 2 && finance >= Math.max(purchasing, sales, inventory) ? 'finance' : inventory > purchasing && inventory > sales ? 'inventory' : purchasing > sales ? 'purchasing' : 'sales';
  return { module, purchasing, sales, inventory, finance };
}
