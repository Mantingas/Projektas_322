import { describe, expect, it } from 'vitest';
import { inventoryData, toRecords } from './fixtures/inventoryRecords';
import { END, type IMove } from './fixtures/inventory';
import { buildInventoryDashboard } from '@/engine/inventory/dashboard';
import { analyzeInventoryPeriod } from '@/engine/inventory/insights';
import type { InventoryRecord } from '@/engine/types';

const data = inventoryData('lt');
const run = (records: InventoryRecord[] = data.records) => {
  const m = buildInventoryDashboard(records, { series: { currency: 'EUR', basis: 'net' }, filters: {}, period: { preset: 'r30' } })!;
  return { m, a: analyzeInventoryPeriod(m) };
};
const byId = (a: ReturnType<typeof run>['a'], id: string) => a.insights.find((i) => i.id === `inventory.${id}`);
const money = (i: { params: Record<string, unknown> } | undefined, k: string) => (i!.params[k] as { money: number }).money;

describe('inventory insights: deterministic, evidenced, explainable', () => {
  const { m, a } = run();

  it('the planted situations are found – and only those', () => {
    const ids = a.insights.map((i) => i.id.replace('inventory.', '')).sort();
    expect(ids).toEqual(['excess_stock', 'negative_stock', 'non_moving', 'slow_moving', 'stale'].filter((x) => x !== 'stale').concat(['stock_inconsistent', 'stockout_risk', 'valuation_anomaly', 'value_concentration']).sort());
    // nothing was invented for the rules that found nothing
    const why = Object.fromEntries(a.unavailable.map((u) => [u.rule, u.reason]));
    expect(why).toMatchObject({ value_increase: 'nothing_found', unusual_movements: 'nothing_found' });
  });

  it('every insight carries evidence, confidence, an action and a reason; none claims a saving', () => {
    for (const i of a.insights) {
      expect(i.module).toBe('inventory');
      expect(i.evidence.length, i.id).toBeGreaterThan(0);
      expect(['high', 'medium', 'low']).toContain(i.reliability);
      expect(i.actionKey && i.whyKey && i.titleKey && i.bodyKey && i.reliabilityReasonKey, i.id).toBeTruthy();
      expect(i.savings, i.id).toBeUndefined();
      expect(i.score).toBeGreaterThan(0);
    }
  });

  it('non-moving and slow-moving: the amounts are the stock values of exactly those items (tied-up capital, not a loss)', () => {
    expect(money(byId(a, 'non_moving'), 'amount')).toBeCloseTo(4000, 2);
    expect(byId(a, 'non_moving')!.params.count).toBe(1);
    expect(money(byId(a, 'slow_moving'), 'amount')).toBeCloseTo(2500, 2);
    expect(byId(a, 'non_moving')!.evidence[0]).toMatchObject({ key: 'sku:p04', current: 4000, unit: 'money' });
    expect(byId(a, 'slow_moving')!.evidence[0]).toMatchObject({ key: 'sku:p03', current: 2500 });
  });

  it('stockout risk lists the three items with the reason, from minimum stock and from cover', () => {
    const i = byId(a, 'stockout_risk')!;
    expect(i.params).toMatchObject({ count: 3, out: 1, min: 1, cover: 1 });
    expect(i.impact).toEqual({ value: 3, unit: 'qty' }); // a count, never a made-up money figure
    expect(i.evidence.map((e) => e.key).sort()).toEqual(['sku:p06', 'sku:p07', 'sku:p09']);
    const p07 = i.evidence.find((e) => e.key === 'sku:p07')!;
    expect([p07.current, p07.previous]).toEqual([40, 60]); // stock → minimum
  });

  it('negative stock, snapshot-vs-movement mismatch and valuation conflicts come with their exact figures', () => {
    expect(byId(a, 'negative_stock')!.params.count).toBe(1);
    expect(byId(a, 'negative_stock')!.evidence[0]).toMatchObject({ key: 'sku:p09', current: -4 });
    const rec = byId(a, 'stock_inconsistent')!;
    expect(rec.params.count).toBe(1);
    expect(rec.reliability).toBe('medium'); // movement history may be incomplete: a difference is not proof of loss
    expect(rec.evidence[0]).toMatchObject({ current: 93, previous: 100 });
    expect(money(rec, 'amount')).toBeCloseTo(7 * 4, 2);
    const val = byId(a, 'valuation_anomaly')!;
    expect(val.params.conflicts).toBe(1);
    expect(money(val, 'gap')).toBeCloseTo(360, 2);
    expect(val.evidence[0]).toMatchObject({ current: 2160, previous: 1800, unit: 'money' });
  });

  it('concentration: top item and top-3 share, from the same table the dashboard shows', () => {
    const i = byId(a, 'value_concentration')!;
    const rows = m.tables.product!.rows.filter((r) => r.current > 0).sort((x, y) => y.current - x.current);
    const total = rows.reduce((s, r) => s + r.current, 0);
    expect((i.params.share1 as { pct: number }).pct).toBeCloseTo(rows[0]!.current / total, 6);
    expect((i.params.share3 as { pct: number }).pct).toBeCloseTo(rows.slice(0, 3).reduce((s, r) => s + r.current, 0) / total, 6);
    expect(i.evidence.map((e) => e.label)).toEqual(rows.slice(0, 5).map((r) => r.label));
  });

  it('every insight names the period it describes', () => {
    for (const i of a.insights) {
      expect((i.params.asof as { date: string }).date).toBe(END);
      expect((i.params.from as { date: string }).date).toBe(m.periods.current.from);
    }
  });

  it('insights follow the filters: a warehouse filter removes findings about the other warehouse', () => {
    const w2 = buildInventoryDashboard(data.records, { series: { currency: 'EUR', basis: 'net' }, filters: { warehouses: ['kaunas'] }, period: { preset: 'r30' } })!;
    const ids = analyzeInventoryPeriod(w2).insights.map((i) => i.id);
    expect(ids).not.toContain('inventory.non_moving'); // P04 lives in Vilnius
    expect(ids).toContain('inventory.negative_stock'); // P09 lives in Kaunas
  });
});

describe('insights stay silent when the data cannot support them', () => {
  it('snapshots only: slow, non-moving, excess and cover-based findings are WITHHELD with the reason; position-based findings remain', () => {
    const { a } = run(data.records.filter((r) => r.kind === 'snapshot'));
    const ids = a.insights.map((i) => i.id.replace('inventory.', ''));
    for (const x of ['slow_moving', 'non_moving', 'excess_stock', 'unusual_movements']) expect(ids, x).not.toContain(x);
    const why = Object.fromEntries(a.unavailable.map((u) => [u.rule, u.reason]));
    expect(why).toMatchObject({ slow_moving: 'no_movements', non_moving: 'no_movements', excess_stock: 'no_movements', unusual_movements: 'no_movements' });
    expect(ids).toEqual(expect.arrayContaining(['negative_stock', 'valuation_anomaly', 'value_concentration']));
    // stockout from the minimum level only, and it says so
    const so = byId(a, 'stockout_risk')!;
    expect(so.params).toMatchObject({ count: 1, min: 1 });
    expect(so.reliabilityReasonKey).toBe('rel.minStockOnly');
  });

  it('a single snapshot cannot produce "value increased"', () => {
    const { a } = run(data.records.filter((r) => r.kind === 'snapshot' && r.date === END));
    expect(byId(a, 'value_increase')).toBeUndefined();
    expect(a.unavailable.find((u) => u.rule === 'value_increase')!.reason).toBe('no_previous_snapshot');
  });

  it('without costs there is no monetary finding at all', () => {
    const { a } = run(data.records.map((r) => ({ ...r, unitCost: undefined, value: undefined })));
    for (const i of a.insights) expect(['inventory.stockout_risk', 'inventory.negative_stock', 'inventory.stock_inconsistent']).toContain(i.id);
    expect(a.unavailable.find((u) => u.rule === 'slow_moving')!.reason).toBe('cost_missing');
  });

  it('name-only items give low-reliability findings', () => {
    const { a } = run(data.records.map((r) => ({ ...r, productId: undefined })));
    expect(byId(a, 'value_concentration')!.reliability).toBe('low');
    expect(byId(a, 'value_concentration')!.reliabilityReasonKey).toBe('rel.nameIdentity');
  });
});

describe('insights that need a different story', () => {
  it('a significant increase of stock value is reported with its contributors and with receipts vs issues when the movements support it', () => {
    const snaps = data.snaps.map((s) => (s.date === END && s.sku === 'P05' ? { ...s, qty: 75, value: 75 * 120 } : s));
    const { a, m } = run(toRecords(snaps, data.moves));
    const i = byId(a, 'value_increase')!;
    expect(i).toBeTruthy();
    expect(money(i, 'delta')).toBeCloseTo(m.kpis.find((k) => k.id === 'i_value')!.abs!, 6);
    expect(i.evidence[0]).toMatchObject({ key: 'sku:p05', unit: 'money' });
    expect(i.bodyKey).toBe('inventory.value_increase.body_flows');
    const noMoves = run(toRecords(snaps, [])).a;
    expect(byId(noMoves, 'value_increase')!.bodyKey).toBe('inventory.value_increase.body');
  });

  it('an unusual movement (a quantity far above the item\'s history) and a large write-off are found', () => {
    const extra: IMove = { date: '2025-12-09', doc: 'JD-ODD', type: 'issue', sku: 'P02', product: 'Miltai 1 kg', wh: 'Vilnius', qty: 400, unit: 'pcs', cost: 0.9 };
    const writeOff: IMove = { date: '2025-12-10', doc: 'ADJ-BIG', type: 'adjustment', sku: 'P05', product: 'Planšetė', wh: 'Vilnius', qty: 4, unit: 'pcs', cost: 120 };
    const { a } = run(toRecords(data.snaps, [...data.moves, extra, writeOff]));
    const i = byId(a, 'unusual_movements')!;
    expect(i).toBeTruthy();
    expect(i.params).toMatchObject({ count: 1, adjCount: 2 });
    expect(i.bodyKey).toBe('inventory.unusual_movements.body_both');
    expect(i.evidence[0]).toMatchObject({ label: 'JD-ODD · Miltai 1 kg', current: 400 });
  });
});
