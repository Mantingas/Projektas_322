import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { commitImport, previewImport } from '@/db/store';
import { buildDashboardWithInsights } from '@/engine/analytics/dashboard';
import { analyzeSales } from '@/engine/insights/engine';
import { assignKeys } from '@/engine/import/keys';
import { parseFile } from '@/engine/parsing/parseFile';
import { analyzeSheet, confirmedFromEntries } from '@/engine/pipeline';
import { normalizeSales } from '@/engine/validation/normalize';
import type { SalesRecord } from '@/engine/types';

const timed = async <T,>(label: string, fn: () => T | Promise<T>): Promise<{ value: T; ms: number }> => {
  const t = performance.now();
  const value = await fn();
  const ms = Math.round(performance.now() - t);
  console.log(`perf ${label}: ${ms} ms`);
  return { value, ms };
};

function csv(n: number): Uint8Array {
  const lines = ['Data;Dokumento Nr.;Klientas;Prekė;Kiekis;Suma be PVM'];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2024, 0, 1) + (i % 700) * 86400000).toISOString().slice(0, 10);
    lines.push(`${d};DOC-${Math.floor(i / 3)};Customer ${i % 800};Product ${i % 1500};${1 + (i % 9)};${(10 + (i % 97)).toFixed(2).replace('.', ',')}`);
  }
  return new TextEncoder().encode(lines.join('\r\n') + '\r\n');
}

describe('performance (budgets are generous: they catch order-of-magnitude regressions, not noise)', () => {
  const N = 150_000;
  it(`parses, profiles and normalises ${N} CSV lines`, async () => {
    const bytes = csv(N);
    const parse = await timed('parse csv', () => parseFile(bytes, 'big.csv'));
    expect(parse.ms).toBeLessThan(6000);
    const an = await timed('detect+profile', () => analyzeSheet(parse.value.sheets[0]!));
    expect(an.ms).toBeLessThan(4000);
    const a = an.value!;
    const norm = await timed('normalise', () => normalizeSales(a.table.dataRows, { profiles: a.profiles, mapping: confirmedFromEntries(a.proposal.entries, 'EUR'), rowNumbers: a.table.dataRowNumbers, today: '2026-01-01' }));
    expect(norm.value.records).toHaveLength(N);
    expect(norm.ms).toBeLessThan(6000);
  }, 60_000);

  it('builds the dashboard, insights and rolling alerts for 150 000 lines', async () => {
    const base: Omit<SalesRecord, 'key'>[] = [];
    for (let i = 0; i < N; i++) base.push({ date: new Date(Date.UTC(2024, 0, 1) + (i % 700) * 86400000).toISOString().slice(0, 10), documentId: `D${Math.floor(i / 3)}`, customerName: `C${i % 800}`, productName: `P${i % 1500}`, quantity: 1 + (i % 9), amount: 10 + (i % 97), basis: 'net', currency: 'EUR', sourceRow: i, category: `G${i % 12}`, salesperson: `S${i % 15}` });
    const recs = (await timed('assign keys', () => assignKeys(base))).value;
    for (const preset of ['r30', 'mom', 'ytd'] as const) {
      const r = await timed(`dashboard+insights ${preset}`, () => buildDashboardWithInsights(recs, { series: { currency: 'EUR', basis: 'net' }, filters: {}, period: { preset } }));
      expect(r.value!.analysis).not.toBeNull();
      expect(r.ms).toBeLessThan(3500);
    }
    const roll = await timed('rolling alerts', () => analyzeSales(recs, { currency: 'EUR', basis: 'net' }));
    expect(roll.ms).toBeLessThan(3500);
    const filtered = await timed('dashboard with customer filter', () => buildDashboardWithInsights(recs, { series: { currency: 'EUR', basis: 'net' }, filters: { customers: ['c7'] }, period: { preset: 'r30' } }));
    expect(filtered.ms).toBeLessThan(3500);
  }, 120_000);

  it('plans and commits a 20 000-line import (IndexedDB)', async () => {
    const db = new AppDB('perf-' + Math.random());
    const lines: Omit<SalesRecord, 'key'>[] = [];
    for (let i = 0; i < 20_000; i++) lines.push({ date: '2025-03-01', documentId: `D${Math.floor(i / 3)}`, customerName: `C${i % 50}`, productName: `P${i % 70}`, quantity: 1, amount: 5 + (i % 11), basis: 'net', currency: 'EUR', sourceRow: i });
    const recs = assignKeys(lines);
    const pv = await timed('preview (empty store)', () => previewImport(db, recs, 'full'));
    expect(pv.value.added).toBe(20_000);
    const c = await timed('commit', () => commitImport(db, { checksum: 'x', fileName: 'x', sheetName: 's', exportMode: 'full', records: recs, stats: { rowsRead: 1, rowsImported: 1, rowsSkipped: 0, errors: {}, warnings: {}, examples: [], currencies: ['EUR'] }, mapping: { columns: {} } }));
    expect(c.value.status).toBe('ok');
    expect(c.ms).toBeLessThan(15_000);
    const again = await timed('preview (all duplicates)', () => previewImport(db, recs, 'full'));
    expect(again.value.duplicates).toBe(20_000);
    expect(again.ms).toBeLessThan(10_000);
  }, 120_000);
});
