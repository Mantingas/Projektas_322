import { AppDB } from '@/db/db';
import { EngineSession, type AnalysisLite } from '@/lib/engineSession';
import type { SalesRecord } from '@/engine/types';

const enc = (s: string) => { const u = new TextEncoder().encode(s); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; };
export const num = (x: number) => String(x).replace('.', ',');
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const mkSession = () => new EngineSession(new AppDB('sc-' + Math.random().toString(36).slice(2)));
export type Cell = string | number;
export const H = ['Data', 'Dokumento Nr.', 'Klientas', 'Prekė', 'Kiekis', 'Suma be PVM', 'Savikaina'];

export function csv(header: string[], rows: Cell[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map((c) => (typeof c === 'number' ? num(c) : c)).join(';')).join('\r\n');
}

/** Imports one synthetic CSV through the real engine session (parse → analyse → preview → commit). */
export async function importCsv(s: EngineSession, header: string[], rows: Cell[][], name = 'x.csv', opts: { currency?: string; mode?: 'full' | 'incremental' | 'partial' | 'unknown'; confirmed?: boolean } = {}) {
  await s.parse(enc(csv(header, rows)), name);
  const a = (await s.analyze(0, ',', 'sales')) as AnalysisLite;
  const req = { sheetIdx: 0, module: 'sales' as const, entries: a.proposal.entries, currency: opts.currency ?? 'EUR', mode: opts.mode ?? 'full' };
  const pv = await s.preview(req);
  const records: SalesRecord[] = (s.lastNormalised() ?? []).slice();
  const commit = await s.commit({ ...req, confirmed: opts.confirmed ?? true, allowSameChecksum: true, remember: false });
  const map = Object.fromEntries(a.proposal.entries.map((e) => [a.headers[e.columnIndex]!, e.field]));
  return { a, pv, records, commit, map };
}

export async function runSales(header: string[], rows: Cell[][], period: unknown = { preset: 'r30' }, filters: unknown = {}) {
  const s = mkSession();
  const imp = await importCsv(s, header, rows);
  const b = await s.build({ version: 1, filters: filters as never, period: period as never });
  return { s, b, ...imp };
}
export const kpi = (b: Awaited<ReturnType<typeof runSales>>['b'], id: string) => b.model!.kpis.find((k) => k.id === id)!;

/** Same as importCsv for any module (purchasing, finance, inventory); extra request fields (side, coverage …) are passed through. */
export async function importAny(s: EngineSession, module: 'sales' | 'purchasing' | 'finance' | 'inventory', header: string[], rows: Cell[][], name: string, extra: Record<string, unknown> = {}, confirmed = true) {
  await s.parse(enc(csv(header, rows)), name);
  const a = (await s.analyze(0, ',', module)) as AnalysisLite;
  const req: any = { sheetIdx: 0, module, entries: a.proposal.entries, currency: 'EUR', mode: 'full', ...extra };
  const pv: any = await s.preview(req);
  const commit: any = await s.commit({ ...req, confirmed, allowSameChecksum: true, remember: false });
  return { a, pv, commit };
}
export const PH = ['Data', 'Tiekėjo sąskaitos Nr.', 'Tiekėjas', 'Prekė', 'Kiekis', 'Matavimo vnt.', 'Suma be PVM'];
