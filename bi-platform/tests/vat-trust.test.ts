import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { EngineSession } from '@/lib/engineSession';

const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const HEAD = 'Data;Dokumento Nr.;Klientas;Prekė;Kiekis;Suma be PVM;PVM suma;Suma su PVM';
const f = (n: number) => n.toFixed(2).replace('.', ',');
function file(lines: { net: number; rate: number; grossOverride?: number }[]) {
  const rows = lines.map((l, i) => { const vat = Math.round(l.net * l.rate) / 100; const gross = l.grossOverride ?? l.net + vat; return `2025-03-${String(1 + (i % 28)).padStart(2, '0')};DOC-${i};Klientas ${i % 4};Prekė ${i % 5};${1 + (i % 3)};${f(l.net)};${f(vat)};${f(gross)}`; });
  return new TextEncoder().encode('﻿' + HEAD + '\r\n' + rows.join('\r\n') + '\r\n');
}
async function preview(bytes: Uint8Array) {
  const s = new EngineSession(new AppDB('vat-' + Math.random().toString(36).slice(2)));
  await s.parse(buf(bytes), 'v.csv');
  const a = (await s.analyze(0, ','))!;
  const pv = await s.preview({ sheetIdx: 0, entries: a.proposal.entries, currency: 'EUR', mode: 'full' });
  if (!pv.ok) throw new Error(pv.error);
  return pv;
}

describe('VAT: rates are implied only from stated VAT amounts; contradictions are reported', () => {
  it('mixed VAT rates (21 %, 9 %, exempt) are listed with their line counts, and nothing is assigned to lines without a VAT amount', async () => {
    const lines = [...Array.from({ length: 10 }, (_, i) => ({ net: 100 + i, rate: 21 })), ...Array.from({ length: 6 }, (_, i) => ({ net: 50 + i, rate: 9 })), ...Array.from({ length: 4 }, (_, i) => ({ net: 70 + i, rate: 0 }))];
    const pv = await preview(file(lines));
    const it = pv.trust.find((x) => x.code === 'vat_rates')!;
    expect(it.params.list).toBe('21% (10), 9% (6), 0% (4)');
    expect(it.params.mixed).toBe(1);
    expect(pv.trust.find((x) => x.code === 'vat_inconsistent')).toBeUndefined();
    expect(pv.trust.find((x) => x.code === 'vat_basis')!.params.basis).toBe('net');   // net is preferred over gross when both exist
  });

  it('a single rate is a plain OK item', async () => {
    const pv = await preview(file(Array.from({ length: 8 }, (_, i) => ({ net: 100 + i, rate: 21 }))));
    expect(pv.trust.find((x) => x.code === 'vat_rates')).toMatchObject({ level: 'ok', params: { list: '21% (8)', mixed: 0 } });
  });

  it('net + VAT ≠ gross beyond rounding is reported, and a one-cent rounding difference is not', async () => {
    const bad = await preview(file([...Array.from({ length: 6 }, (_, i) => ({ net: 100 + i, rate: 21 })), { net: 200, rate: 21, grossOverride: 260 }, { net: 300, rate: 21, grossOverride: 363.02 }]));
    expect(bad.trust.find((x) => x.code === 'vat_inconsistent')).toMatchObject({ level: 'warn', params: { n: 1 } });   // 260 is wrong; 363.02 is 2 cents off → within tolerance? no: > 0.02? exactly 0.02 → accepted
    const ok = await preview(file(Array.from({ length: 6 }, (_, i) => ({ net: 100 + i, rate: 21, grossOverride: Math.round((100 + i) * 121) / 100 + 0.01 }))));
    expect(ok.trust.find((x) => x.code === 'vat_inconsistent')).toBeUndefined();
  });
});
