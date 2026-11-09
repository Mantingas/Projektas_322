import en, { type MessageKey, type Messages } from './en';
import lt from './lt';
import pl from './pl';
import type { ParamValue } from '@/engine/types';

export type Lang = 'lt' | 'pl' | 'en';
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'lt', label: 'LT' },
  { code: 'pl', label: 'PL' },
  { code: 'en', label: 'EN' },
];
export const DICTS: Record<Lang, Messages> = { lt, pl, en };
export const LOCALE: Record<Lang, string> = { lt: 'lt-LT', pl: 'pl-PL', en: 'en-GB' };
export type { MessageKey };

export interface FormatCtx {
  lang: Lang;
  currency: string;
}

export function money(n: number, { lang, currency }: FormatCtx): string {
  try {
    return new Intl.NumberFormat(LOCALE[lang], { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 2 }).format(n)} ${currency}`;
  }
}
export const pct = (n: number, lang: Lang) => new Intl.NumberFormat(LOCALE[lang], { style: 'percent', maximumFractionDigits: 1 }).format(n);
export const num = (n: number, lang: Lang) => new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 2 }).format(n);
export const fmtDate = (iso: string, lang: Lang) =>
  new Intl.DateTimeFormat(LOCALE[lang], { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));

export function formatParam(v: ParamValue, ctx: FormatCtx): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return num(v, ctx.lang);
  if ('money' in v) return money(v.money, ctx);
  if ('price' in v) return new Intl.NumberFormat(LOCALE[ctx.lang], { style: 'currency', currency: ctx.currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v.price);
  if ('pct' in v) return pct(v.pct, ctx.lang);
  if ('qty' in v) return num(v.qty, ctx.lang);
  return fmtDate(v.date, ctx.lang);
}

/** Replaces {name} placeholders. Params are formatted for the language; unknown placeholders are left visible. */
export function translate(lang: Lang, key: MessageKey, params: Record<string, ParamValue> = {}, currency = 'EUR'): string {
  const raw = DICTS[lang][key] ?? en[key] ?? String(key); // a missing key must never crash the page
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? formatParam(params[name]!, { lang, currency }) : m));
}
