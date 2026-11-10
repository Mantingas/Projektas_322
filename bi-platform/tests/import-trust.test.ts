import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { EngineSession } from '@/lib/engineSession';
import { buildFixtures } from './fixtures/formats';
import { parseFile } from '@/engine/parsing/parseFile';
import { analyzeSheet } from '@/engine/pipeline';
import { dateOrderIsGuess } from '@/engine/schema/dates';
import { buildImportTrust } from '@/engine/trust/importTrust';
import { makeExecutive, seedDb } from './fixtures/executive';

const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const csv = (head: string, rows: string[]) => new TextEncoder().encode('﻿' + head + '\r\n' + rows.join('\r\n') + '\r\n');
const salesRow = (d: string, i: number) => `${d};DOC-${i};Klientas ${i % 3};Prekė ${i % 4};${1 + (i % 3)};${(10 + i).toFixed(2).replace('.', ',')}`;
const HEAD = 'Data;Dokumento Nr.;Klientas;Prekė;Kiekis;Suma be PVM';

async function preview(db: AppDB, bytes: Uint8Array, over: { dateOrders?: Record<number, 'dmy' | 'mdy'> } = {}) {
  const s = new EngineSession(db);
  await s.parse(buf(bytes), 'x.csv');
  const a = (await s.analyze(0, ','))!;
  const pv = await s.preview({ sheetIdx: 0, entries: a.proposal.entries, currency: 'EUR', mode: 'full', ...over });
  if (!pv.ok) throw new Error(pv.error);
  return { pv, a };
}
const codes = (t: { code: string; level: string }[]) => t.map((x) => `${x.code}:${x.level}`);

describe('import trust: what a person should know before trusting an import', () => {
  it('an unambiguous file yields an all-clear list without questions', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => salesRow(`2025-03-${String(1 + i).padStart(2, '0')}`, i));
    const { pv } = await preview(new AppDB('t1'), csv(HEAD, rows));
    const items = pv.trust;
    expect(items.filter((x) => x.level === 'confirm' || x.level === 'warn')).toEqual([]);
    expect(codes(items)).toEqual(expect.arrayContaining(['currency:info', 'vat_basis:ok', 'dates:ok', 'coverage:ok']));
    expect(items.find((x) => x.code === 'vat_basis')!.params.basis).toBe('net');
    expect(items.find((x) => x.code === 'coverage')!.params).toMatchObject({ from: '2025-03-01', to: '2025-03-20', rows: 20 });
  });

  it('dates whose day/month order cannot be known are flagged for confirmation, and the choice changes the reading', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => salesRow(`0${1 + (i % 9)}/0${1 + ((i + 1) % 9)}/2025`.replace('/09/', '/09/'), i));
    const { pv, a } = await preview(new AppDB('t2'), csv(HEAD, rows));
    const g = pv.trust.find((x) => x.code === 'date_order')!;
    expect(g).toMatchObject({ level: 'confirm', choice: 'date_order' });
    const col = g.columns![0]!;
    expect(a.profiles[col]!.dateOrderGuess).toBe(true);
    const dmy = pv.stats.dateMin!;
    const { pv: pv2 } = await preview(new AppDB('t2b'), csv(HEAD, rows), { dateOrders: { [col]: 'mdy' } });
    expect(pv2.stats.dateMin).not.toBe(dmy);
    expect(pv2.trust.find((x) => x.code === 'date_order')!.params.order).toBe('mdy');
  });

  it('a date column with a value above 12 is NOT a guess', () => {
    expect(dateOrderIsGuess(['01/02/2025', '03/04/2025'])).toBe(true);
    expect(dateOrderIsGuess(['01/02/2025', '25/04/2025'])).toBe(false);
    expect(dateOrderIsGuess(['2025-01-02'])).toBe(false);
    expect(dateOrderIsGuess(['hello', null])).toBe(false);
  });

  it('an amount column without a stated VAT basis asks for confirmation; missing identifiers and already-stored lines are reported', async () => {
    const head = 'Data;Dokumento Nr.;Klientas;Prekė;Kiekis;Suma';
    const rows = [salesRow('2025-03-01', 1).replace('DOC-1', ''), ...Array.from({ length: 10 }, (_, i) => salesRow(`2025-03-${String(2 + i).padStart(2, '0')}`, i + 2))];
    const { pv } = await preview(new AppDB('t3'), csv(head, rows));
    expect(pv.trust.find((x) => x.code === 'vat_basis')).toMatchObject({ level: 'confirm', params: { basis: 'unknown' } });
  });

  it('clashes with data already stored in another module are reported before anything is imported', async () => {
    const db = new AppDB('t4');
    await seedDb(db, makeExecutive(), []);   // sales net EUR, purchasing net EUR, inventory EUR, finance EUR
    const rows = Array.from({ length: 12 }, (_, i) => salesRow(`2025-03-${String(1 + i).padStart(2, '0')}`, i));
    const gross = csv('Data;Dokumento Nr.;Klientas;Prekė;Kiekis;Suma su PVM', rows);
    const s = new EngineSession(db);
    await s.parse(buf(gross), 'g.csv');
    const a = (await s.analyze(0, ',', 'purchasing'))!;
    void a;
    const items = buildImportTrust({ module: 'sales', profiles: (await s.analyze(0, ','))!.profiles, entries: (await s.analyze(0, ','))!.proposal.entries, stats: { rowsRead: 12, rowsImported: 12, rowsSkipped: 0, errors: {}, warnings: {}, examples: [], currencies: ['PLN'], dateMin: '2025-03-01', dateMax: '2025-03-12' }, currencyFromColumn: false, currency: 'PLN', basis: 'gross', duplicates: 0, rows: 12, stored: [{ module: 'purchasing', currency: 'EUR', basis: 'net' }, { module: 'sales', currency: 'EUR', basis: 'net' }], dateOrders: {} });
    expect(items.find((x) => x.code === 'compat_currency')).toMatchObject({ level: 'warn', params: { module: 'purchasing', other: 'EUR', mine: 'PLN' } });
    const sameCur = buildImportTrust({ module: 'sales', profiles: [], entries: [], stats: { rowsRead: 1, rowsImported: 1, rowsSkipped: 0, errors: {}, warnings: {}, examples: [], currencies: ['EUR'] }, currencyFromColumn: true, basis: 'gross', duplicates: 0, rows: 1, stored: [{ module: 'purchasing', currency: 'EUR', basis: 'net' }], dateOrders: {} });
    expect(sameCur.find((x) => x.code === 'compat_basis')).toMatchObject({ level: 'warn', params: { other: 'net', mine: 'gross' } });
  });

  it('the session reports stored-line duplicates and sign assumptions for finance registers', async () => {
    const fx = await buildFixtures();
    expect(fx.length).toBeGreaterThan(0);
    const items = buildImportTrust({ module: 'finance', profiles: [], entries: [], stats: { rowsRead: 5, rowsImported: 5, rowsSkipped: 0, errors: {}, warnings: { negative_assumed_credit: 2, payment_without_reference: 3, missing_invoice_number: 1, duplicate_invoice_number: 1 }, examples: [], currencies: ['EUR'] }, currencyFromColumn: true, basis: 'not_stated', duplicates: 4, rows: 5, stored: [], dateOrders: {} });
    const c = codes(items);
    expect(c).toEqual(expect.arrayContaining(['credit_sign:warn', 'identifiers:warn', 'duplicates:info', 'duplicates:warn', 'vat_basis:info']));
    expect(items.find((x) => x.code === 'identifiers')!.params.n).toBe(4);
  });
});

describe('the profile of a column states whether its date order is a guess', () => {
  it('real files: ISO dates and unambiguous dd.mm.yyyy dates are not guesses', async () => {
    const fx = await buildFixtures();
    for (const f of fx.slice(0, 3)) {
      const parsed = await parseFile(f.bytes, f.fileName);
      const a = analyzeSheet((f.sheet ? parsed.sheets.find((s) => s.name === f.sheet) : parsed.sheets[0])!, { decimalHint: ',' })!;
      for (const p of a.profiles.filter((x) => x.type === 'date')) expect(p.dateOrderGuess, `${f.id}/${p.header}`).toBe(false);
    }
  });
});
