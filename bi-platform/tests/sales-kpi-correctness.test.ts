import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { H, kpi, runSales, type Cell } from './fixtures/salesCsv';
import { aggregate } from '@/engine/analytics/aggregate';
import { evaluateMargin, quantityInOneUnit } from '@/engine/analytics/metrics';
import type { SalesRecord } from '@/engine/types';

const D = '2025-06-15';
const ins = (r: Awaited<ReturnType<typeof runSales>>, id: string) => r.b.analysis!.insights.find((i) => i.id === id);
const lims = (r: Awaited<ReturnType<typeof runSales>>) => r.b.model!.limitations.map((l) => l.code);

describe('M1 – the margin needs cost coverage of LINES and of REVENUE', () => {
  it('scenario A: 90 % of lines have a cost but only 30 % of the money → margin withheld (was 40 %)', async () => {
    const rows: Cell[][] = [];
    for (let i = 0; i < 9; i++) rows.push([D, `A${i}`, 'K' + i, 'P' + i, 1, 300 / 9, 20]);
    rows.push([D, 'A9', 'Didelis', 'PBIG', 1, 700, '']);
    const r = await runSales(H, rows);
    expect(kpi(r.b, 'margin').current).toBeNull();
    expect(kpi(r.b, 'margin').unavailable).toBe('cost_revenue_coverage');
    expect(ins(r, 'sales.margin_overview')).toBeUndefined();
    expect(ins(r, 'sales.low_margin_products')).toBeUndefined();
  });
  it('scenario B: 80 % of lines have a cost, the two biggest customers do not → margin withheld (was 60 %)', async () => {
    const rows: Cell[][] = [];
    for (let i = 0; i < 8; i++) rows.push([D, `B${i}`, 'M' + i, 'P' + i, 1, 25, 10]);
    rows.push([D, 'B8', 'Didžiausias 1', 'PX', 1, 400, ''], [D, 'B9', 'Didžiausias 2', 'PY', 1, 400, '']);
    const r = await runSales(H, rows);
    expect(kpi(r.b, 'margin').current).toBeNull();
    expect(kpi(r.b, 'margin').unavailable).toBe('cost_revenue_coverage');
  });
  it('85 % of revenue costed: the margin is shown, labelled as the margin of the costed sales only', async () => {
    const rows: Cell[][] = [];
    for (let i = 0; i < 17; i++) rows.push([D, `C${i}`, 'K' + i, 'P' + i, 1, 100, 60]);
    for (let i = 0; i < 3; i++) rows.push([D, `U${i}`, 'U' + i, 'Q' + i, 1, 100, '']);
    const r = await runSales(H, rows);
    expect(kpi(r.b, 'margin').current).toBeCloseTo(0.4, 9);
    expect(lims(r)).toContain('margin_partial');
    expect(r.b.model!.limitations.find((l) => l.code === 'margin_partial')).toMatchObject({ pct: 0.85 });
    expect(ins(r, 'sales.margin_overview')!.params.coverage).toEqual({ pct: 0.85 });
    expect(r.b.model!.explain.margin).toMatchObject({ lines: 17, positive: 20, coverage: 85, whole: 0 });
  });
  it('full coverage: whole-turnover margin, no partial-margin limitation', async () => {
    const rows: Cell[][] = Array.from({ length: 10 }, (_, i) => [D, `F${i}`, 'K' + i, 'P' + i, 1, 100, 60]);
    const r = await runSales(H, rows);
    expect(kpi(r.b, 'margin').current).toBeCloseTo(0.4, 9);
    expect(lims(r)).not.toContain('margin_partial');
  });
});

describe('M2 – sales, returns, returned cost and gross profit reconcile', () => {
  const inv = (n: number): Cell[][] => Array.from({ length: n }, (_, i) => [D, `S${i}`, 'K' + i, 'P', 1, 100, 60]);
  it('returns WITH a cost of the right sign: profit is net of returns (was 200 on net sales of 200)', async () => {
    const rows = [...inv(5), ...[0, 1, 2].map((i): Cell[] => [D, `KR${i}`, 'K' + i, 'P', -1, -100, -60])];
    const r = await runSales(H, rows);
    expect(kpi(r.b, 'sales').current).toBe(200);
    expect(kpi(r.b, 'returns').current).toBe(300);
    expect(kpi(r.b, 'margin').current).toBeCloseTo(0.4, 9);       // (200 − 120) / 200
    expect(ins(r, 'sales.margin_overview')!.params.profit).toEqual({ money: 80 });     // was 200
  });
  it('returns whose cost has the WRONG sign (+60 on −100) are not trusted: material returns → margin withheld', async () => {
    const rows = [...inv(5), ...[0, 1, 2].map((i): Cell[] => [D, `KR${i}`, 'K' + i, 'P', -1, -100, 60])];
    const r = await runSales(H, rows);
    expect(kpi(r.b, 'margin').current).toBeNull();
    expect(kpi(r.b, 'margin').unavailable).toBe('returns_cost_unknown');
  });
  it('returns without any cost: same – material returns withhold the margin', async () => {
    const rows = [...inv(5), [D, 'KR0', 'K0', 'P', -1, -100, '']];
    const r = await runSales(H, rows);
    expect(kpi(r.b, 'margin').unavailable).toBe('returns_cost_unknown');
  });
  it('negligible returns (≤ 2 % of sales) of unknown cost are left out and the margin stays available', async () => {
    const rows = [...inv(50), [D, 'KR0', 'K0', 'P', -1, -50, '']];     // 50 of 5000 = 1 %
    const r = await runSales(H, rows);
    expect(kpi(r.b, 'margin').current).toBeCloseTo(0.4, 9);
  });
  it('the margin KPI equals an independent calculation net of returns', () => {
    const mk = (amount: number, cost?: number): SalesRecord => ({ key: Math.random().toString(), date: D, documentId: 'x' + Math.random(), amount, cost, basis: 'net', currency: 'EUR', sourceRow: 1 });
    const recs = [mk(1000, 600), mk(500, 250), mk(-200, -120), mk(-50, -25)];
    const m = evaluateMargin(aggregate(recs), 'net');
    expect(m.ok && m.r.profit).toBeCloseTo((1000 + 500 - 200 - 50) - (600 + 250 - 120 - 25), 9);
    expect(m.ok && m.r.value).toBeCloseTo(((1250) - 705) / 1250, 9);
  });
});

describe('Z1 – zero, negative and absurd costs', () => {
  it('a column of zeros is a placeholder for "unknown": no margin (was 100 %)', async () => {
    const r = await runSales(H, Array.from({ length: 6 }, (_, i) => [D, `Z${i}`, 'K' + i, 'P' + i, 1, 100, 0]));
    expect(kpi(r.b, 'margin').current).toBeNull();
    expect(kpi(r.b, 'margin').unavailable).toBe('no_cost');
  });
  it('an occasional real zero cost (free goods) stays a real value', async () => {
    const rows: Cell[][] = Array.from({ length: 9 }, (_, i) => [D, `Z${i}`, 'K' + i, 'P' + i, 1, 100, 60]);
    rows.push([D, 'Z9', 'K9', 'P9', 1, 100, 0]);
    const r = await runSales(H, rows);
    expect(kpi(r.b, 'margin').current).toBeCloseTo((1000 - 540) / 1000, 9);
  });
  it('an absurd or negative cost is ignored, not averaged in (was −128 509 %)', async () => {
    const rows: Cell[][] = Array.from({ length: 10 }, (_, i) => [D, `N${i}`, 'K' + i, 'P' + i, 1, 100, 60]);
    rows.push([D, 'N10', 'K10', 'P10', 1, 100, 900000]);
    const r = await runSales(H, rows);
    expect(kpi(r.b, 'margin').current).toBeCloseTo(0.4, 9);
    rows.push([D, 'N11', 'K11', 'P11', 1, 100, -40]);
    const r2 = await runSales(H, rows);
    expect(kpi(r2.b, 'margin').current).toBeCloseTo(0.4, 9);
  });
  it('too many bad costs reduce the coverage below the limit and withhold the margin', async () => {
    const rows: Cell[][] = Array.from({ length: 5 }, (_, i) => [D, `N${i}`, 'K' + i, 'P' + i, 1, 100, 60]);
    rows.push([D, 'N5', 'K5', 'P5', 1, 100, 900000], [D, 'N6', 'K6', 'P6', 1, 100, -40]);
    const r = await runSales(H, rows);
    expect(kpi(r.b, 'margin').current).toBeNull();
  });
});

describe('M3 – low-margin products need the product’s OWN cost coverage', () => {
  it('a product with a cost on 6 of 40 lines is not flagged (the table withholds its margin too)', async () => {
    const rows: Cell[][] = [];
    for (let i = 0; i < 40; i++) rows.push([D, `X${i}`, 'K' + (i % 5), 'X', 1, 100, i < 6 ? 95 : '']);
    for (let i = 0; i < 400; i++) rows.push([D, `Y${i}`, 'K' + (i % 5), 'Y', 1, 100, 40]);
    const r = await runSales(H, rows);
    expect(ins(r, 'sales.low_margin_products')).toBeUndefined();
    expect(r.b.model!.tables.product!.rows.find((x) => x.label === 'X')!.margin).toBeNull();
  });
  it('a fully costed low-margin product is flagged with its WHOLE revenue and its margin', async () => {
    const rows: Cell[][] = [];
    for (let i = 0; i < 40; i++) rows.push([D, `X${i}`, 'K' + (i % 5), 'X', 1, 100, 96]);
    for (let i = 0; i < 400; i++) rows.push([D, `Y${i}`, 'K' + (i % 5), 'Y', 1, 100, 40]);
    const r = await runSales(H, rows);
    const f = ins(r, 'sales.low_margin_products')!;
    expect(f.params.count).toBe(1);
    expect(f.params.revenue).toEqual({ money: 4000 });
    expect(f.evidence[0]).toMatchObject({ label: 'X', unit: 'pct' });
    expect(f.evidence[0]!.current).toBeCloseTo(0.04, 9);
  });
});

describe('U1 – quantities of different units are never added', () => {
  const UH = ['Data', 'Dokumento Nr.', 'Klientas', 'Prekė', 'Kiekis', 'Mato vnt.', 'Suma be PVM'];
  it('kg + pcs + l: the quantity KPI is withheld (was 5 280)', async () => {
    const r = await runSales(UH, [[D, 'U1', 'K1', 'Miltai', 100, 'kg', 200], [D, 'U2', 'K2', 'Sviestas', 50, 'vnt.', 250], [D, 'U3', 'K3', 'Pienas', 20, 'l', 30]]);
    expect(kpi(r.b, 'quantity').current).toBeNull();
    expect(kpi(r.b, 'quantity').unavailable).toBe('mixed_units');
    expect(r.b.model!.tables.product!.rows.every((x) => x.quantity !== null)).toBe(true);   // each product alone has a single unit
  });
  it('kg and g of the same product are converted exactly: 100 kg + 5000 g = 105 kg; the price is per kg (was 0.041 per mixed unit)', async () => {
    const rows: Cell[][] = [[D, 'U1', 'K1', 'Miltai', 100, 'kg', 200], [D, 'U2', 'K2', 'Miltai', 5000, 'g', 10]];
    const r = await runSales(UH, rows, { preset: 'r30' }, { products: ['name:miltai'] });
    expect(kpi(r.b, 'quantity').current).toBeCloseTo(105, 9);
    expect(kpi(r.b, 'asp').current).toBeCloseTo(210 / 105, 9);
    expect(r.b.model!.explain.asp).toMatchObject({ unit: 'kg' });
  });
  it('boxes and pieces of one product have no stated rule: quantity and price are withheld', async () => {
    const r = await runSales(UH, [[D, 'U1', 'K1', 'Kiaušiniai', 10, 'dėžė', 100], [D, 'U2', 'K2', 'Kiaušiniai', 100, 'vnt.', 90]], { preset: 'r30' }, { products: ['name:kiaušiniai'] });
    expect(kpi(r.b, 'quantity').unavailable).toBe('mixed_units');
    expect(kpi(r.b, 'asp').unavailable).toBe('mixed_units');
    expect(r.b.model!.tables.product!.rows[0]!.quantity).toBeNull();
  });
  it('some lines without a unit in a file that has a unit column: withheld, not guessed', async () => {
    const r = await runSales(UH, [[D, 'U1', 'K1', 'Miltai', 100, 'kg', 200], [D, 'U2', 'K2', 'Miltai', 5, '', 10]]);
    expect(kpi(r.b, 'quantity').unavailable).toBe('units_missing');
  });
  it('a file without any unit column keeps the quantity but says that units are not stated', async () => {
    const r = await runSales(H, [[D, 'U1', 'K1', 'Miltai', 100, 100, ''], [D, 'U2', 'K2', 'Miltai', 5, 10, '']].map((x) => [x[0]!, x[1]!, x[2]!, x[3]!, x[4]!, x[5]!, '']));
    expect(kpi(r.b, 'quantity').current).toBe(105);
    expect(lims(r)).toContain('units_unstated');
  });
  it('quantityInOneUnit: no units → plain sum; metric conversions only', () => {
    const mk = (quantity: number, unit?: string): SalesRecord => ({ key: Math.random().toString(), date: D, quantity, unit, amount: 1, basis: 'net', currency: 'EUR', sourceRow: 1 });
    expect(quantityInOneUnit(aggregate([mk(3), mk(4)]))).toEqual({ ok: true, value: 7 });
    expect(quantityInOneUnit(aggregate([mk(1, 'l'), mk(500, 'ml')]))).toEqual({ ok: true, value: 1.5, unit: 'l' });
    expect(quantityInOneUnit(aggregate([mk(1, 'kg'), mk(1, 'l')]))).toEqual({ ok: false, reason: 'mixed_units' });
  });
});

describe('O1 – a sales document is identified by number, year and customer', () => {
  it('numbering that restarts every year does not merge documents (was 2 instead of 4)', async () => {
    const rows: Cell[][] = [['2024-12-20', '1', 'K1', 'P', 1, 100, ''], ['2024-12-21', '2', 'K1', 'P', 1, 100, ''], ['2025-01-05', '1', 'K2', 'P', 1, 100, ''], ['2025-01-06', '2', 'K2', 'P', 1, 100, '']];
    const r = await runSales(H, rows, { preset: 'custom', custom: { current: { from: '2024-12-01', to: '2025-01-31' }, previous: { from: '2024-10-01', to: '2024-11-30' } } });
    expect(kpi(r.b, 'orders').current).toBe(4);
    expect(kpi(r.b, 'aov').current).toBe(100);
  });
  it('the same number for two different customers is two documents', async () => {
    const r = await runSales(H, [[D, '10', 'K5', 'P', 1, 40, ''], [D, '10', 'K6', 'P', 1, 60, '']]);
    expect(kpi(r.b, 'orders').current).toBe(2);
  });
  it('one document with several lines is still one document, and credit notes are not documents of sales', async () => {
    const rows: Cell[][] = [...Array.from({ length: 5 }, (_, i): Cell[] => [D, 'SF1', 'K1', 'P' + i, 1, 100, '']), [D, 'KR1', 'K1', 'P', -1, -50, '']];
    const r = await runSales(H, rows);
    expect(kpi(r.b, 'orders').current).toBe(1);
    expect(kpi(r.b, 'aov').current).toBe(500);
  });
});
