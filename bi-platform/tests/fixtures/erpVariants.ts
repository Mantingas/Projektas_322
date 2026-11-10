/**
 * Synthetic export VARIANTS. These imitate how business systems commonly shape CSV exports (titles, footers, encodings, separators, headers) –
 * they are NOT exports of any real ERP, and nothing here proves compatibility with one. The truth rows are plain data, so the expected totals
 * never come from the importer.
 */
import iconv from 'iconv-lite';

export interface Line { cp: string; cpId: string; no: string; invDate: string; due: string; amount: number; outstanding: number; note: string }
export const TRUTH: Line[] = [
  { cp: 'UAB Žalioji dirbtuvė', cpId: 'C06', no: 'SF-1001', invDate: '2025-07-14', due: '2025-08-13', amount: 1740.5, outstanding: 1740.5, note: 'Statybos darbai' },
  { cp: 'AB Gama pienas', cpId: 'C03', no: 'SF-1002', invDate: '2025-07-30', due: '2025-09-13', amount: 840, outstanding: 840, note: 'Pienas\nlapkričio užsakymas' },
  { cp: 'MB Delta paslaugos', cpId: 'C04', no: 'SF-1003', invDate: '2025-08-02', due: '2025-09-01', amount: 1234.56, outstanding: 234.56, note: 'Dalinis apmokėjimas' },
  { cp: 'UAB Epsilon', cpId: 'C05', no: 'SF-1004', invDate: '2025-08-20', due: '2025-09-19', amount: 15999.99, outstanding: 15999.99, note: '' },
  { cp: 'UAB Eta logistika', cpId: 'C07', no: 'SF-1005', invDate: '2025-09-05', due: '2025-10-05', amount: 99.9, outstanding: 99.9, note: 'Transportas "greitas"' },
];
export const TOTAL_OUTSTANDING = TRUTH.reduce((s, l) => s + l.outstanding, 0);
export const ASOF = '2025-12-15';

export interface Variant {
  id: string;
  delim?: string;
  decimal?: ',' | '.';
  thousands?: '' | ' ' | ',' | '.';
  date?: 'iso' | 'dmy_dot' | 'dmy_slash' | 'mdy_slash';
  encoding?: 'utf8' | 'utf8bom' | 'cp1257' | 'cp1250' | 'cp1252';
  lang?: 'lt' | 'pl' | 'en' | 'mixed';
  title?: boolean;
  footer?: boolean;
  emptyColumn?: boolean;
  shuffle?: boolean;
  parenNegative?: boolean;
  noIds?: boolean;
  noAsOfColumn?: boolean;
  /** extra rows that must be ignored */
  junkRows?: boolean;
}

const HEAD = {
  lt: { asof: 'Ataskaitos data', cpId: 'Kliento kodas', cp: 'Klientas', no: 'Sąskaitos Nr.', invDate: 'Sąskaitos data', due: 'Apmokėjimo terminas', amount: 'Sąskaitos suma', outstanding: 'Neapmokėta suma', cur: 'Valiuta', note: 'Aprašymas' },
  pl: { asof: 'Data raportu', cpId: 'Kod kontrahenta', cp: 'Kontrahent', no: 'Nr faktury', invDate: 'Data wystawienia', due: 'Termin płatności', amount: 'Kwota faktury', outstanding: 'Pozostało do zapłaty', cur: 'Waluta', note: 'Opis' },
  en: { asof: 'Report date', cpId: 'Customer code', cp: 'Customer', no: 'Invoice no.', invDate: 'Invoice date', due: 'Due date', amount: 'Invoice amount', outstanding: 'Outstanding amount', cur: 'Currency', note: 'Description' },
} as const;

const fmtDate = (iso: string, d: Variant['date']) => { const [y, m, dd] = iso.split('-'); return d === 'dmy_dot' ? `${dd}.${m}.${y}` : d === 'dmy_slash' ? `${dd}/${m}/${y}` : d === 'mdy_slash' ? `${Number(m)}/${Number(dd)}/${y}` : iso; };
const fmtNum = (n: number, v: Variant) => {
  const neg = n < 0; let s = Math.abs(n).toFixed(2); const [i, f] = s.split('.');
  const th = v.thousands ?? '';
  const ip = th ? i!.replace(/\B(?=(\d{3})+(?!\d))/g, th) : i!;
  s = `${ip}${v.decimal === '.' ? '.' : ','}${f}`;
  return neg ? (v.parenNegative ? `(${s})` : `-${s}`) : s;
};
const esc = (c: string, delim: string) => (/["\r\n]/.test(c) || c.includes(delim) ? '"' + c.replace(/"/g, '""') + '"' : c);

/** open-item report variants. Returns file bytes. */
export function openItemsFile(v: Variant, lines: Line[] = TRUTH): Uint8Array {
  const delim = v.delim ?? ';';
  const lang = v.lang ?? 'lt';
  const h = lang === 'mixed' ? { ...HEAD.lt, cp: HEAD.en.cp, amount: HEAD.pl.amount, due: HEAD.en.due } : HEAD[lang];
  let cols: { head: string; get: (l: Line) => string }[] = [
    ...(v.noAsOfColumn ? [] : [{ head: h.asof, get: () => fmtDate(ASOF, v.date) }]),
    ...(v.noIds ? [] : [{ head: h.cpId, get: (l: Line) => l.cpId }]),
    { head: h.cp, get: (l) => l.cp }, { head: h.no, get: (l) => l.no }, { head: h.invDate, get: (l) => fmtDate(l.invDate, v.date) }, { head: h.due, get: (l) => fmtDate(l.due, v.date) },
    { head: h.amount, get: (l) => fmtNum(l.amount, v) }, { head: h.outstanding, get: (l) => fmtNum(l.outstanding, v) }, { head: h.cur, get: () => 'EUR' }, { head: h.note, get: (l) => l.note },
    ...(v.emptyColumn ? [{ head: '', get: () => '' }] : []),
  ];
  if (v.shuffle) cols = [...cols].reverse();
  const rows: string[] = [];
  if (v.title) { rows.push(`Neapmokėtų sąskaitų ataskaita${delim.repeat(cols.length - 1)}`, `Įmonė: Pavyzdys UAB${delim.repeat(cols.length - 1)}`, delim.repeat(cols.length - 1)); }
  rows.push(cols.map((c) => esc(c.head, delim)).join(delim));
  if (v.junkRows) rows.push(cols.map(() => '').join(delim));
  for (const l of lines) rows.push(cols.map((c) => esc(c.get(l), delim)).join(delim));
  if (v.footer) rows.push(cols.map((c, i) => (i === 0 ? 'Iš viso' : c.head === h.outstanding ? fmtNum(lines.reduce((s, l) => s + l.outstanding, 0), v) : '')).join(delim));
  const text = rows.join('\r\n') + '\r\n';
  switch (v.encoding) {
    case 'cp1257': return iconv.encode(text, 'win1257');
    case 'cp1250': return iconv.encode(text, 'win1250');
    case 'cp1252': return iconv.encode(text, 'win1252');
    case 'utf8': return new TextEncoder().encode(text);
    default: return new TextEncoder().encode('﻿' + text);
  }
}
