import type { ColumnProfile, FieldId, ImportStats, ModuleId } from '../types';

export type TrustLevel = 'ok' | 'info' | 'warn' | 'confirm';
export interface TrustItem {
  /** i18n suffix `itrust.<code>` (title) and `itrust.<code>.d` (explanation) */
  code: 'vat_rates' | 'vat_inconsistent' | 'currency' | 'vat_basis' | 'dates' | 'date_order' | 'identifiers' | 'duplicates' | 'coverage' | 'credit_sign' | 'compat_currency' | 'compat_basis' | 'doc_semantics' | 'amount_sign';
  level: TrustLevel;
  params: Record<string, string | number>;
  /** the user can resolve this here (date order, currency, VAT basis) */
  choice?: 'date_order' | 'currency' | 'vat_basis';
  /** column indexes the item is about */
  columns?: number[];
}

export interface StoredContext { module: string; currency: string; basis?: string }
export interface ImportTrustInput {
  module: ModuleId;
  profiles: ColumnProfile[];
  entries: { field: FieldId; columnIndex: number }[];
  stats: ImportStats;
  /** the currency source: a mapped currency column, or the one the user picked */
  currencyFromColumn: boolean;
  currency?: string;
  basis: 'net' | 'gross' | 'unknown' | 'not_stated';
  duplicates: number;
  rows: number;
  /** what is already stored in the other modules */
  stored: StoredContext[];
  dateOrders: Record<number, 'dmy' | 'mdy' | 'ymd'>;
  /** implied VAT rates of the lines that state a VAT amount (rate in %, number of lines); 0 = VAT-exempt or zero-rated */
  vatRates?: { rate: number; n: number }[];
}

const DATE_FIELDS: FieldId[] = ['document_date', 'due_date', 'payment_date', 'invoice_date', 'snapshot_date', 'movement_date'] as FieldId[];

/**
 * What a person should know about a file BEFORE trusting numbers from it: how currency, VAT basis and dates were read, what is missing, what is
 * already stored in other modules and would clash. Only items that matter are returned – an unambiguous file yields a short, all-green list.
 */
export function buildImportTrust(i: ImportTrustInput): TrustItem[] {
  const out: TrustItem[] = [];
  const w = i.stats.warnings, e = i.stats.errors;
  const n = (k: string) => (w as Record<string, number | undefined>)[k] ?? (e as Record<string, number | undefined>)[k] ?? 0;

  // currency
  const cur = i.stats.currencies.length ? i.stats.currencies : i.currency ? [i.currency] : [];
  if (cur.length > 1) out.push({ code: 'currency', level: 'warn', params: { list: cur.join(', '), source: 'column' }, choice: undefined });
  else if (cur.length === 1) out.push({ code: 'currency', level: i.currencyFromColumn ? 'ok' : 'info', params: { list: cur[0]!, source: i.currencyFromColumn ? 'column' : 'chosen' }, choice: i.currencyFromColumn ? undefined : 'currency' });

  // VAT basis
  if (i.basis === 'unknown') out.push({ code: 'vat_basis', level: 'confirm', params: { basis: 'unknown' }, choice: 'vat_basis' });
  else if (i.basis === 'not_stated') out.push({ code: 'vat_basis', level: 'info', params: { basis: 'not_stated' } });
  else out.push({ code: 'vat_basis', level: 'ok', params: { basis: i.basis } });

  // VAT rates implied by the file (only where the file states a VAT amount) and contradictory VAT columns
  if (i.vatRates && i.vatRates.length) out.push({ code: 'vat_rates', level: i.vatRates.filter((r) => r.rate > 0).length > 1 ? 'info' : 'ok', params: { list: i.vatRates.map((r) => `${r.rate}% (${r.n})`).join(', '), mixed: i.vatRates.filter((r) => r.rate > 0).length > 1 ? 1 : 0 } });
  const vatBad = n('vat_inconsistent');
  if (vatBad) out.push({ code: 'vat_inconsistent', level: 'warn', params: { n: vatBad } });

  // date interpretation
  const mapped = i.entries.filter((x) => DATE_FIELDS.includes(x.field));
  const guessed = mapped.filter((x) => i.profiles[x.columnIndex]?.dateOrderGuess);
  if (guessed.length) out.push({ code: 'date_order', level: 'confirm', params: { order: i.dateOrders[guessed[0]!.columnIndex] ?? i.profiles[guessed[0]!.columnIndex]!.dateOrder, n: guessed.length }, choice: 'date_order', columns: guessed.map((x) => x.columnIndex) });
  else if (mapped.length) out.push({ code: 'dates', level: 'ok', params: { order: i.profiles[mapped[0]!.columnIndex]?.dateOrder ?? 'ymd' } });
  const badDates = n('invalid_date') + n('invalid_due_date') + n('invalid_payment_date');
  if (badDates) out.push({ code: 'dates', level: 'warn', params: { bad: badDates, order: '' } });

  // identifiers
  const missingIds = n('missing_invoice_number') + n('missing_counterparty') + n('payment_without_reference') + n('missing_product') + n('missing_document_id');
  if (missingIds) out.push({ code: 'identifiers', level: 'warn', params: { n: missingIds } });

  // duplicates
  if (i.duplicates > 0) out.push({ code: 'duplicates', level: 'info', params: { n: i.duplicates } });
  const dupInvoices = n('duplicate_invoice_number');
  if (dupInvoices) out.push({ code: 'duplicates', level: 'warn', params: { n: dupInvoices } });

  // document semantics and sign conventions
  const signCredits = n('negative_assumed_credit');
  if (signCredits) out.push({ code: 'credit_sign', level: 'warn', params: { n: signCredits } });
  const normalised = n('credit_sign_normalised') + n('negative_amount') + n('negative_outstanding');
  if (normalised) out.push({ code: 'amount_sign', level: 'info', params: { n: normalised } });

  // coverage
  if (i.stats.dateMin && i.stats.dateMax) out.push({ code: 'coverage', level: 'ok', params: { from: i.stats.dateMin, to: i.stats.dateMax, rows: i.rows } });

  // clashes with data already stored in OTHER modules (they would make cross-module findings withheld)
  const mine = cur[0];
  for (const s of i.stored) {
    if (s.module === i.module) continue;
    if (mine && s.currency !== mine) out.push({ code: 'compat_currency', level: 'warn', params: { module: s.module, other: s.currency, mine } });
    else if (s.basis && i.basis !== 'not_stated' && s.basis !== i.basis && (s.basis !== 'unknown' || i.basis !== 'unknown') && (i.module === 'sales' || i.module === 'purchasing') && (s.module === 'sales' || s.module === 'purchasing')) out.push({ code: 'compat_basis', level: 'warn', params: { module: s.module, other: s.basis, mine: i.basis } });
  }
  return out;
}
