import { parseFile } from '@/engine/parsing/parseFile';
import { detectTable } from '@/engine/schema/header';
import { buildDataset, profileTable } from '@/engine/universal/dataset';
import type { UDataset, UType } from '@/engine/universal/types';

/** deterministic PRNG so fixtures and their reference values never change */
export function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ULocale = 'lt' | 'pl' | 'en';
export interface UTruthRow { n: number; date: string; id: string; region: string; qty: number; price: number; total: number; discountPct: number | null; delivered: boolean; rating: number; note: string | null }
export interface UTruth { rows: UTruthRow[] }

export const START = '2025-01-01';
const REGIONS = ['Vilnius', 'Kaunas', 'Klaipėda', 'Šiauliai', 'Panevėžys'];
const WEIGHTS = [0.52, 0.2, 0.12, 0.1, 0.06];
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** 400 orders over 9 months with planted structure: skewed regions, quantity↔total correlation, 3 outliers, late missing discounts, duplicates. */
export function makeUniversal(): UTruth {
  const r = rng(7);
  const rows: UTruthRow[] = [];
  for (let i = 0; i < 400; i++) {
    const date = addDays(START, Math.floor((i / 400) * 270) + (i % 3 === 0 ? 1 : 0));
    const u = r();
    let acc = 0, region = REGIONS[0]!;
    for (let k = 0; k < REGIONS.length; k++) { acc += WEIGHTS[k]!; if (u <= acc) { region = REGIONS[k]!; break; } }
    const qty = 1 + Math.floor(r() * 20);
    const price = Math.round((8 + r() * 12) * 100) / 100;
    let total = Math.round((qty * price + (r() - 0.5) * 4) * 100) / 100;
    if (i === 100) total = 9800; if (i === 200) total = 12500.5; if (i === 300) total = 15000;
    rows.push({
      n: i + 1, date, id: `UZ-${String(i + 1).padStart(5, '0')}`, region, qty, price, total,
      discountPct: i >= 280 && i % 4 !== 0 ? null : [0, 5, 10, 15][Math.floor(r() * 4)]!, delivered: r() > 0.2, rating: Math.floor(r() * 5) + 1, note: i % 5 < 3 ? null : `pastaba ${i % 7}`,
    });
  }
  // two exact duplicate lines (the second copy of rows 10 and 20)
  rows.splice(11, 0, { ...rows[10]! });
  rows.splice(22, 0, { ...rows[21]! });
  return { rows };
}

const fmtNum = (v: number, dec: ',' | '.') => v.toFixed(2).replace('.', dec);
const dateFmt = (iso: string, l: ULocale) => { const [y, m, d] = iso.split('-'); return l === 'lt' ? `${y}.${m}.${d}` : l === 'pl' ? `${d}.${m}.${y}` : `${y}-${m}-${d}`; };

const HEAD: Record<ULocale, string[]> = {
  lt: ['Užsakymo data', 'Užsakymo Nr.', 'Regionas', 'Kiekis', 'Kaina', 'Suma', 'Nuolaida', 'Pristatyta', 'Reitingas', 'Pastabos'],
  pl: ['Data zamówienia', 'Numer zamówienia', 'Region', 'Ilość', 'Cena', 'Kwota', 'Rabat', 'Dostarczono', 'Ocena', 'Uwagi'],
  en: ['Order date', 'Order no.', 'Region', 'Quantity', 'Price', 'Amount', 'Discount', 'Delivered', 'Rating', 'Notes'],
};

export function universalCsv(truth: UTruth, l: ULocale = 'lt'): Uint8Array {
  const dec = l === 'en' ? '.' : ',';
  const delim = l === 'en' ? ',' : ';';
  const cur = l === 'pl' ? ' zł' : ' €';
  const yes = l === 'lt' ? 'Taip' : l === 'pl' ? 'Tak' : 'Yes', no = l === 'lt' ? 'Ne' : l === 'pl' ? 'Nie' : 'No';
  const esc = (c: string) => (/["\n\r]/.test(c) || c.includes(delim) ? '"' + c.replace(/"/g, '""') + '"' : c);
  const lines = [HEAD[l].join(delim)];
  for (const x of truth.rows) {
    lines.push([dateFmt(x.date, l), x.id, x.region, String(x.qty), `${fmtNum(x.price, dec)}${cur}`, fmtNum(x.total, dec), x.discountPct === null ? '' : `${x.discountPct}%`, x.delivered ? yes : no, String(x.rating), x.note ?? ''].map(esc).join(delim));
  }
  return new TextEncoder().encode('﻿' + lines.join('\r\n') + '\r\n');
}

/** CSV → typed dataset through the real parser and profiler. */
export async function toDataset(bytes: Uint8Array, fileName: string, decisions: Record<number, UType> | 'accept' = 'accept', decimal: ',' | '.' = ','): Promise<{ ds: UDataset; columns: ReturnType<typeof profileTable>['columns']; unresolved?: number[] }> {
  const parsed = await parseFile(bytes, fileName);
  const table = detectTable(parsed.sheets[0]!.rows)!;
  const prof = profileTable(table, decimal);
  const dec = decisions === 'accept' ? Object.fromEntries(prof.columns.filter((c) => c.ambiguous).map((c) => [c.index, c.suggested])) : decisions;
  const built = buildDataset(table, prof, dec, { id: 'u1', fileName, sheetName: parsed.sheets[0]!.name, importedAt: 1 });
  if (!built.ok) return { ds: undefined as never, columns: prof.columns, unresolved: built.unresolved };
  return { ds: built.dataset, columns: prof.columns };
}

// ───────── independent reference calculations (plain loops over the truth, never the engine) ─────────
export const refSum = (rows: UTruthRow[], f: (r: UTruthRow) => number) => rows.reduce((s, r) => s + f(r), 0);
export const refByRegion = (rows: UTruthRow[]) => { const m: Record<string, number> = {}; for (const r of rows) m[r.region] = (m[r.region] ?? 0) + r.total; return m; };
export function refMonthly(rows: UTruthRow[]) { const m: Record<string, number> = {}; for (const r of rows) { const k = r.date.slice(0, 7) + '-01'; m[k] = (m[k] ?? 0) + r.total; } return m; }
export function refPearson(x: number[], y: number[]) {
  const n = x.length; const mx = x.reduce((a, b) => a + b, 0) / n; const my = y.reduce((a, b) => a + b, 0) / n;
  let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { a += (x[i]! - mx) * (y[i]! - my); b += (x[i]! - mx) ** 2; c += (y[i]! - my) ** 2; }
  return a / Math.sqrt(b * c);
}
export function refQuantile(v: number[], p: number) { const s = [...v].sort((a, b) => a - b); const h = (s.length - 1) * p; const lo = Math.floor(h), hi = Math.ceil(h); return s[lo]! + (s[hi]! - s[lo]!) * (h - lo); }
