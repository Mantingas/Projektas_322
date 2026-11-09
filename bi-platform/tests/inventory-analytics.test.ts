import { beforeAll, describe, expect, it } from 'vitest';
import { inventoryData } from './fixtures/inventoryRecords';
import { toRecords } from './fixtures/inventoryRecords';
import { CUR, END, PREV, rnd, signed, valueAt, type IMove, type ISnap } from './fixtures/inventory';
import { buildInventoryDashboard, type InventoryModel, type InventoryOptions } from '@/engine/inventory/dashboard';
import { drillInventoryRecords } from '@/engine/inventory/drill';
import { lineValue } from '@/engine/inventory/position';
import type { InventoryRecord } from '@/engine/types';
import type { PeriodSelection } from '@/engine/analytics/periods';

const NET = { currency: 'EUR', basis: 'net' as const };
const data = inventoryData('lt');
const dash = (records: InventoryRecord[] = data.records, o: Partial<InventoryOptions> = {}): InventoryModel => buildInventoryDashboard(records, { series: NET, filters: {}, period: { preset: 'r30' } as PeriodSelection, ...o })!;
const kpi = (d: InventoryModel, id: string) => d.kpis.find((k) => k.id === id)!;
const price = (sku: string) => data.plans.find((p) => p.sku === sku)!.cost;

// ───────── independent reference calculations (plain loops over the truth) ─────────
const refValue = (date: string) => valueAt(data.snaps, date);
const refSkus = (date: string) => new Set(data.snaps.filter((s) => s.date === date && s.qty > 0).map((s) => s.sku)).size;
const inWin = (m: IMove, w: { from: string; to: string }) => m.date >= w.from && m.date <= w.to;
/** net issue value: issues − customer returns, in money; transfers, adjustments and receipts are NOT demand */
const refIssueValue = (w: { from: string; to: string }) => data.moves.filter((m) => inWin(m, w)).reduce((s, m) => s + (m.type === 'issue' ? m.qty * m.cost : m.type === 'return_in' ? -m.qty * m.cost : 0), 0);
const refDemand = (sku: string, unit: string, w: { from: string; to: string }) => data.moves.filter((m) => m.sku === sku && m.unit === unit && inWin(m, w)).reduce((s, m) => s + (m.type === 'issue' ? m.qty : m.type === 'return_in' ? -m.qty : 0), 0);

describe('stock position and value (single and multiple snapshots)', () => {
  it('KPI stock value = Σ line values of the latest snapshot of each warehouse; the previous value uses ITS OWN snapshot', () => {
    const d = dash();
    expect(d.periods.current).toEqual(CUR);
    expect(d.periods.previous).toEqual(PREV);
    expect(kpi(d, 'i_value').current).toBeCloseTo(refValue(END), 2);
    expect(kpi(d, 'i_value').previous).toBeCloseTo(refValue('2025-10-31'), 2); // nothing newer than 11-15 exists before 11-30
    expect(kpi(d, 'i_value').abs).toBeCloseTo(refValue(END) - refValue('2025-10-31'), 2);
    expect(d.asOf).toEqual({ current: END, previous: '2025-10-31' });
  });

  it('active SKUs counts products with positive stock; concentration is the top item\'s share of positive value', () => {
    const d = dash();
    expect(kpi(d, 'i_skus').current).toBe(refSkus(END));
    const bySku = new Map<string, number>();
    for (const s of data.snaps.filter((x) => x.date === END && (x.value ?? 0) > 0)) bySku.set(s.sku, (bySku.get(s.sku) ?? 0) + s.value!);
    const total = [...bySku.values()].reduce((a, b) => a + b, 0);
    expect(kpi(d, 'i_concentration').current).toBeCloseTo(Math.max(...bySku.values()) / total, 6);
    expect([...bySku.entries()].sort((a, b) => b[1] - a[1])[0]![0]).toBe('P04'); // 500 × 8.00 = 4 000 is the largest item
  });

  it('warehouse distribution and product table reconcile with the KPI', () => {
    const d = dash();
    const sum = (rows: { current: number }[]) => rows.reduce((s, r) => s + r.current, 0);
    expect(sum(d.tables.warehouse!.rows)).toBeCloseTo(refValue(END), 2);
    expect(sum(d.tables.product!.rows)).toBeCloseTo(refValue(END), 2);
    expect(sum(d.tables.category!.rows)).toBeCloseTo(refValue(END), 2);
    const w1 = data.snaps.filter((s) => s.date === END && s.wh === 'Vilnius').reduce((s, x) => s + (x.value ?? 0), 0);
    expect(d.tables.warehouse!.rows.find((r) => r.label === 'Vilnius')!.current).toBeCloseTo(w1, 2);
    expect(d.tables.product!.totalCurrent).toBeCloseTo(kpi(d, 'i_value').current!, 2);
  });

  it('a single snapshot: the position is shown, the CHANGE is withheld (no previous snapshot), history-based metrics are withheld', () => {
    const only = data.records.filter((r) => r.kind === 'snapshot' && r.date === END);
    const d = dash(only);
    expect(kpi(d, 'i_value').current).toBeCloseTo(refValue(END), 2);
    expect(['blocked', 'no_previous_value']).toContain(kpi(d, 'i_value').status); // one date: there is nothing to compare with
    expect(kpi(d, 'i_value').previous).toBeNull();
    expect(kpi(d, 'i_value').abs).toBeNull();
    for (const id of ['i_turnover', 'i_doh', 'i_slow', 'i_nonmoving']) expect([id, kpi(d, id).current], id).toEqual([id, null]);
    expect(kpi(d, 'i_turnover').unavailable).toBe('no_opening');
    expect(kpi(d, 'i_slow').unavailable).toBe('no_movements');
    expect(d.limitations.map((l) => l.code)).toContain('i_no_movements');
    expect(d.limitations.map((l) => l.code)).toContain('i_no_previous_snapshot');
    expect(d.charts.find((c) => c.id === 'trend')!.available).toBe(false);
    expect(d.charts.find((c) => c.id === 'slowMoving')!.available).toBe(false);
    expect(d.waterfall).toBeNull();
  });

  it('stock value trend has one point per snapshot date and matches the reference at each date', () => {
    const d = dash();
    expect(d.trend.map((p) => p.start)).toEqual(['2025-08-31', '2025-09-30', '2025-10-31', '2025-11-30', END]);
    for (const p of d.trend) expect(p.revenue).toBeCloseTo(refValue(p.start), 2);
  });
});

describe('turnover and days on hand: only from movements that cover the window', () => {
  it('turnover = net issue value ÷ average of the opening and closing stock value; transfers, adjustments and receipts are not demand', () => {
    const d = dash();
    const issue = refIssueValue(CUR);
    const avg = (refValue('2025-10-31') + refValue(END)) / 2;
    expect(kpi(d, 'i_turnover').current).toBeCloseTo(issue / avg, 6);
    expect(kpi(d, 'i_doh').current).toBeCloseTo(avg / (issue / 30), 6);
    // previous window: opening 09-30, closing 10-31
    const issueP = refIssueValue(PREV);
    const avgP = (refValue('2025-09-30') + refValue('2025-10-31')) / 2;
    expect(kpi(d, 'i_turnover').previous).toBeCloseTo(issueP / avgP, 6);
  });

  it('warehouse transfers are never counted as receipts or issues (no double counting)', () => {
    const d = dash();
    const f = d.flows!;
    const recv = data.moves.filter((m) => inWin(m, CUR)).reduce((s, m) => s + (m.type === 'receipt' ? m.qty * m.cost : m.type === 'return_out' ? -m.qty * m.cost : 0), 0); // a supplier return reduces receipts
    expect(f.receiptValue).toBeCloseTo(recv, 2);
    expect(f.netIssueValue).toBeCloseTo(refIssueValue(CUR), 2);
    expect(f.transferLines).toBe(data.moves.filter((m) => inWin(m, CUR) && m.type.startsWith('transfer')).length);
    // the same data WITHOUT the transfer documents gives identical purchases / sales figures
    const noTr = data.records.filter((r) => r.movementType !== 'transfer');
    const f2 = dash(noTr).flows!;
    expect(f2.receiptValue).toBeCloseTo(f.receiptValue, 6);
    expect(f2.netIssueValue).toBeCloseTo(f.netIssueValue, 6);
    expect(d.transfers.unbalanced).toEqual([]);
    expect(d.transfers.documents).toBe(2);
  });

  it('a transfer document missing one leg is reported as unbalanced', () => {
    const broken = data.records.filter((r) => !(r.documentId === 'TR-1001' && r.quantity! > 0));
    const d = dash(broken);
    expect(d.transfers.unbalanced).toHaveLength(1);
    expect(d.transfers.unbalanced[0]).toMatchObject({ doc: 'TR-1001', net: -100 });
    expect(d.limitations.map((l) => l.code)).toContain('i_unbalanced_transfers');
  });

  it('partial movement history: 45 days of movements → slow / non-moving withheld, current turnover possible, previous not', () => {
    const partial = data.records.filter((r) => r.kind === 'snapshot' || r.date >= '2025-11-01');
    const d = dash(partial);
    expect(kpi(d, 'i_slow').current).toBeNull();
    expect(kpi(d, 'i_slow').unavailable).toBe('short_history');
    expect(kpi(d, 'i_nonmoving').unavailable).toBe('short_history');
    expect(kpi(d, 'i_turnover').current).not.toBeNull();
    expect(kpi(d, 'i_turnover').previous).toBeNull();
    expect(kpi(d, 'i_turnover').status).toBe('no_previous_value');
    expect(d.slow).toEqual([]);
  });

  it('movements only (no snapshot): stock metrics are withheld, the movement view still works', () => {
    const d = dash(data.records.filter((r) => r.kind === 'movement'));
    for (const id of ['i_value', 'i_quantity', 'i_skus', 'i_concentration', 'i_turnover', 'i_slow', 'i_stockout']) expect(kpi(d, id).current, id).toBeNull();
    expect(kpi(d, 'i_value').unavailable).toBe('no_snapshot');
    expect(d.limitations.map((l) => l.code)).toContain('i_no_snapshot');
    expect(d.flows!.issueLines).toBeGreaterThan(0);
    expect(d.charts.find((c) => c.id === 'movementTrend')!.available).toBe(true);
  });

  it('missing costs: value, concentration, turnover and slow-moving value are withheld; quantities and counts still work', () => {
    const noCost = data.records.map((r) => ({ ...r, unitCost: undefined, value: undefined }));
    const d = dash(noCost);
    for (const id of ['i_value', 'i_concentration', 'i_turnover', 'i_doh', 'i_slow', 'i_nonmoving']) expect(kpi(d, id).unavailable, id).toBe('cost_missing');
    expect(kpi(d, 'i_skus').current).toBe(refSkus(END));
    expect(kpi(d, 'i_stockout').current).not.toBeNull(); // below-minimum needs no cost
  });

  it('partial cost coverage (≥ 80 %): value is shown with the share of valued lines in the limitations', () => {
    const d = dash();
    const lim = d.limitations.find((l) => l.code === 'i_cost_partial') as { pct: number };
    expect(lim.pct).toBeCloseTo(13 / 14, 6); // 1 of 14 lines has no cost / value
  });
});

describe('slow-moving, non-moving, excess and stockout risk', () => {
  const win = { from: '2025-06-19', to: END }; // 180 days ending at the closing date
  it('non-moving = stock on hand, no issue and no receipt in the lookback; slow = cover above 180 days – matches the reference', () => {
    const d = dash();
    expect(d.cur.status!.history).toMatchObject({ from: '2025-06-19', days: 180 });
    const stock = new Map<string, number>();
    for (const s of data.snaps.filter((x) => x.date === END)) stock.set(`${s.sku}|${s.unit}`, (stock.get(`${s.sku}|${s.unit}`) ?? 0) + s.qty);
    const slow: string[] = [];
    const dead: string[] = [];
    for (const [k, q] of stock) {
      const [sku, unit] = k.split('|') as [string, string];
      if (q <= 0) continue;
      const mv = data.moves.filter((m) => m.sku === sku && m.unit === unit);
      if (mv.length === 0) continue; // unmatched: never in the movement file
      const demand = refDemand(sku, unit, win);
      const recent = mv.some((m) => inWin(m, win) && m.type === 'receipt');
      if (demand === 0 && !recent) dead.push(sku);
      else if (demand > 0 && q / (demand / 180) > 180) slow.push(sku);
    }
    expect(dead.sort()).toEqual(['P04']);
    expect(slow.sort()).toEqual(['P03']);
    const got = (s: string) => d.cur.status!.items.filter((i) => i.state === s).map((i) => i.pk.replace('sku:', '').toUpperCase()).sort();
    expect(got('non_moving')).toEqual(dead);
    expect(got('slow')).toEqual(slow);
    expect(kpi(d, 'i_nonmoving').current).toBeCloseTo(4000, 2); // 500 × 8.00
    expect(kpi(d, 'i_slow').current).toBeCloseTo(2500, 2); // 1000 × 2.50
  });

  it('items with stock but no movement line at all are NOT called non-moving (identifiers may differ) – they are reported as unmatched', () => {
    const d = dash();
    const g = d.cur.status!.items.find((i) => i.pk === 'sku:p12' && i.unit === 'g')!;
    expect(g.state).toBe('unmatched');
    expect(d.cur.status!.unmatched).toBe(1);
    expect(d.limitations).toContainEqual({ code: 'i_unmatched', count: 1 });
  });

  it('excess = stock above 90 days of observed demand, valued at the item\'s own stock value', () => {
    const d = dash();
    let ref = 0;
    for (const sku of ['P01', 'P02', 'P03', 'P05', 'P06', 'P07', 'P08', 'P10', 'P11', 'P12']) {
      const units = sku === 'P12' ? ['kg'] : ['pcs'];
      for (const unit of units) {
        const qty = data.snaps.filter((s) => s.date === END && s.sku === sku && s.unit === unit).reduce((s, x) => s + x.qty, 0);
        const val = data.snaps.filter((s) => s.date === END && s.sku === sku && s.unit === unit);
        if (qty <= 0 || val.some((v) => v.value === undefined)) continue;
        const demand = refDemand(sku, unit, win);
        if (demand <= 0) continue;
        const keep = (demand / 180) * 90;
        const unitValue = val.reduce((s, x) => s + x.value!, 0) / qty;
        ref += Math.max(0, qty - keep) * unitValue;
      }
    }
    // P10 has a line without a cost: its value is unknown, so it is excluded from the monetary excess (never estimated)
    expect(d.excessValue).toBeCloseTo(ref, 2);
  });

  it('stockout risk: below minimum (snapshot only), cover under 14 days and out-of-stock with demand (history) – nothing else', () => {
    const d = dash();
    const by = (r: string) => d.cur.risk!.rows.filter((x) => x.reason === r).map((x) => x.pk.replace('sku:', '').toUpperCase()).sort();
    expect(by('below_min')).toEqual(['P07']);
    expect(by('low_cover')).toEqual(['P06']);
    expect(by('out_of_stock')).toEqual(['P09']);
    expect(kpi(d, 'i_stockout').current).toBe(3);
    const p06 = d.cur.risk!.rows.find((x) => x.pk === 'sku:p06')!;
    expect(p06.coverDays).toBeCloseTo(80 / (refDemand('P06', 'pcs', win) / 180), 4);
  });

  it('stockout risk from a snapshot with minimum levels needs NO movement history – and says so; without minimums or history it is withheld', () => {
    const snapsOnly = data.records.filter((r) => r.kind === 'snapshot');
    const d = dash(snapsOnly);
    expect(d.cur.risk!.rows.map((r) => r.reason)).toEqual(['below_min']);
    expect(d.cur.risk!.usedHistory).toBe(false);
    const noMin = dash(snapsOnly.map((r) => ({ ...r, minStock: undefined })));
    expect(kpi(noMin, 'i_stockout').current).toBeNull();
    expect(kpi(noMin, 'i_stockout').unavailable).toBe('needs_history_or_min');
  });

  it('a movement file with mostly unrecognised types is NOT used for demand', () => {
    const muddy = data.records.map((r) => (r.kind === 'movement' && r.movementType === 'issue' ? { ...r, movementType: 'unknown' as const } : r));
    const d = dash(muddy);
    expect(kpi(d, 'i_slow').unavailable).toBe('movement_types_unclear');
    expect(kpi(d, 'i_turnover').unavailable).toBe('movement_types_unclear');
    expect(d.limitations.map((l) => l.code)).toContain('i_movement_unclear');
  });
});

describe('negative, inconsistent and conflicting stock', () => {
  it('negative stock is shown as it is (book value), counted, and listed', () => {
    const d = dash();
    expect(d.negatives).toHaveLength(1);
    expect(d.negatives[0]).toMatchObject({ pk: 'sku:p09', qty: -4 });
    expect(d.cur.pos!.negativeLines).toBe(1);
    expect(d.limitations).toContainEqual({ code: 'i_negative_stock', lines: 1 });
  });

  it('snapshots are reconciled with the movements between them: exactly the planted unrecorded loss is found', () => {
    const d = dash();
    expect(d.recon).toHaveLength(1);
    expect(d.recon[0]).toMatchObject({ warehouse: 'Vilnius', opening: 133, movements: -33, actual: 93, diff: -7 }); // 11-30 → 12-15: 133 − 33 issued = 100 expected, 93 counted
    expect(d.recon[0]!.label).toContain('Kava');
    expect(d.recon[0]!.expected).toBe(100);
  });

  it('a stated value that disagrees with quantity × unit cost is flagged and the STATED value is used', () => {
    const d = dash();
    expect(d.valueConflicts).toEqual([{ label: 'Planšetė', warehouse: 'Vilnius', stated: 2160, computed: 1800 }]);
    expect(d.cur.pos!.conflictLines).toBe(1);
    expect(kpi(d, 'i_value').current).toBeCloseTo(refValue(END), 2); // refValue uses the stated 2 160
  });

  it('two imports of the same snapshot kept side by side are flagged as multi-source (possible double count)', () => {
    const dup = data.records.filter((r) => r.kind === 'snapshot' && r.date === END && r.warehouse === 'Vilnius').map((r) => ({ ...r, key: r.key + '-b', importId: 'imp_b' }));
    const d = dash([...data.records, ...dup]);
    expect(d.limitations.find((l) => l.code === 'i_multi_source')).toBeTruthy();
  });
});

describe('units, currencies, identity', () => {
  it('quantities are only added within one comparable unit; strict by default, exact metric conversion only when switched on', () => {
    const all = dash();
    expect(kpi(all, 'i_quantity').unavailable).toBe('mixed_units');
    const sugar = { products: ['sku:p12'] };
    const strict = dash(data.records, { filters: sugar });
    expect(kpi(strict, 'i_quantity').unavailable).toBe('mixed_units'); // kg and g are different units under the strict policy
    const metric = dash(data.records, { filters: sugar, unitPolicy: 'metric' });
    expect(kpi(metric, 'i_quantity').current).toBeCloseTo(800 + 300, 6); // 800 kg + 300 000 g
    expect(metric.limitations.map((l) => l.code)).toContain('i_metric_units');
    // pieces are never converted into anything
    const pcs = dash(data.records, { filters: { products: ['sku:p01'] } });
    expect(kpi(pcs, 'i_quantity').current).toBe(600);
  });

  it('under the metric policy the gram line of sugar joins the kilogram movements (no longer "unmatched")', () => {
    const d = dash(data.records, { unitPolicy: 'metric' });
    expect(d.cur.status!.unmatched).toBe(0);
    const sugar = d.cur.status!.items.find((i) => i.pk === 'sku:p12')!;
    expect(sugar.stockQty).toBeCloseTo(1100, 6);
  });

  it('currencies never mix: each currency is its own series', () => {
    const pl = inventoryData('pl');
    const both = [...data.records, ...pl.records];
    const eur = dash(both);
    expect(kpi(eur, 'i_value').current).toBeCloseTo(refValue(END), 2);
    expect(eur.limitations).toContainEqual({ code: 'other_series_hidden', count: 1 });
    const pln = buildInventoryDashboard(both, { series: { currency: 'PLN', basis: 'net' }, filters: {}, period: { preset: 'r30' } })!;
    expect(kpi(pln, 'i_value').current).toBeCloseTo(valueAt(pl.snaps, END), 2);
  });

  it('items identified by name only are compared but flagged; one code with two names is excluded from movement conclusions', () => {
    const named = dash(data.records.map((r) => ({ ...r, productId: undefined })));
    expect(named.limitations.find((l) => l.code === 'i_name_identity')).toBeTruthy();
    const amb = data.records.map((r) => (r.productId === 'P03' && r.kind === 'movement' ? { ...r, productName: 'Kita prekė' } : r));
    const d = dash(amb);
    expect(d.limitations).toContainEqual({ code: 'i_code_ambiguity', count: 1 });
    expect(d.cur.status!.items.find((i) => i.pk === 'sku:p03')!.state).toBe('ambiguous');
    expect(kpi(d, 'i_slow').current).toBeCloseTo(0, 6); // P03 no longer judged
  });

  it('units are not matched when the movement file has none (matching falls back to the product, with a limitation)', () => {
    const d = dash(data.records.map((r) => (r.kind === 'movement' ? { ...r, unit: undefined } : r)));
    expect(d.cur.status).not.toBeNull();
    expect(d.cur.status!.items.find((i) => i.pk === 'sku:p03')!.state).toBe('slow');
  });
});

describe('filters, drill-down and charts reconcile with the KPIs', () => {
  it('a product filter changes KPIs, tables and drill-down consistently', () => {
    const f = { products: ['sku:p05'] };
    const d = dash(data.records, { filters: f });
    expect(kpi(d, 'i_value').current).toBeCloseTo(2160, 2);
    expect(kpi(d, 'i_skus').current).toBe(1);
    expect(kpi(d, 'i_value').previous).toBeCloseTo(data.snaps.find((s) => s.date === '2025-10-31' && s.sku === 'P05')!.value!, 2);
    expect(d.tables.product!.rows).toHaveLength(1);
    const rows = drillInventoryRecords(data.records, { filter: f, asOf: END });
    expect(rows.reduce((s, r) => s + (lineValue(r) ?? 0), 0)).toBeCloseTo(kpi(d, 'i_value').current!, 6);
  });

  it('drill-down of the stock value KPI = the KPI (all lines of the position, any filter combination)', () => {
    for (const filters of [{}, { warehouses: ['vilnius'] }, { categories: ['bakalėja'] }, { warehouses: ['kaunas'], categories: ['gėrimai'] }, { text: 'sultys' }]) {
      const d = dash(data.records, { filters });
      const rows = drillInventoryRecords(data.records, { filter: filters, asOf: d.cur.asOf });
      const sum = rows.reduce((s, r) => s + (lineValue(r) ?? 0), 0);
      const k = kpi(d, 'i_value');
      if (k.current === null) expect(k.unavailable, JSON.stringify(filters)).toBe('cost_missing'); // too few valued lines: the KPI is withheld, never partial
      else expect(sum, JSON.stringify(filters)).toBeCloseTo(k.current, 6);
    }
    // previous period as well
    const d = dash();
    const prev = drillInventoryRecords(data.records, { filter: {}, asOf: d.periods.previous.to });
    expect(prev.reduce((s, r) => s + (lineValue(r) ?? 0), 0)).toBeCloseTo(kpi(d, 'i_value').previous!, 6);
  });

  it('movement drill-down: lines of a period and type reconcile with the flow totals', () => {
    const d = dash();
    const issues = drillInventoryRecords(data.records, { filter: {}, range: CUR, movements: true, moveTypes: ['issue'] });
    expect(issues.reduce((s, r) => s + -(r.quantity! * r.unitCost!), 0)).toBeCloseTo(data.moves.filter((m) => inWin(m, CUR) && m.type === 'issue').reduce((s, m) => s + m.qty * m.cost, 0), 2);
    expect(d.flows!.issueLines).toBe(issues.length + 1); // + the customer return that reverses an issue
  });

  it('waterfall steps add up to the change; Pareto shares add up to 100 %; ABC classes cover every item', () => {
    const d = dash();
    const w = d.waterfall!.data;
    expect(w.start + w.steps.reduce((s, x) => s + x.delta, 0)).toBeCloseTo(w.end, 6);
    expect(w.end - w.start).toBeCloseTo(kpi(d, 'i_value').abs!, 6);
    const last = d.pareto?.points[d.pareto.points.length - 1];
    if (last) expect(last.cumulativeShare).toBeCloseTo(1, 6);
    const abc = d.abc!;
    expect(abc.a.count + abc.b.count + abc.c.count).toBe(d.tables.product!.rows.filter((r) => r.current > 0).length);
    expect(abc.a.share + abc.b.share + abc.c.share).toBeCloseTo(1, 6);
  });

  it('charts the data cannot support are hidden WITH a reason', () => {
    const snaps = dash(data.records.filter((r) => r.kind === 'snapshot'));
    const why = (id: string) => snaps.charts.find((c) => c.id === id)!;
    expect(why('slowMoving')).toMatchObject({ available: false });
    expect(why('movementTrend')).toMatchObject({ available: false, reason: 'needs_movements' });
    expect(why('trend').available).toBe(true);
  });

  it('movement trend: receipts and issues per bucket add up to the flow totals (transfers excluded)', () => {
    const d = dash();
    const mt = d.movementTrend!;
    expect(mt.unit).toBe('value');
    const issues = mt.points.reduce((s, p) => s + p.issues, 0);
    const all = data.moves.reduce((s, m) => s + (m.type === 'issue' ? m.qty * m.cost : m.type === 'return_in' ? -m.qty * m.cost : 0), 0);
    expect(issues).toBeCloseTo(all, 2);
  });
});

describe('performance', () => {
  it('100 000 inventory lines build the dashboard in well under 3 seconds', () => {
    const snaps: ISnap[] = [];
    const moves: IMove[] = [];
    for (let i = 0; i < 2000; i++) for (const date of ['2025-09-30', '2025-10-31', '2025-11-30', END]) snaps.push({ date, wh: i % 2 ? 'A' : 'B', sku: `S${i}`, product: `Prekė ${i}`, category: `K${i % 20}`, qty: 100 + (i % 7), unit: 'pcs', cost: 1 + (i % 13), value: (100 + (i % 7)) * (1 + (i % 13)) });
    let n = 0;
    for (let i = 0; i < 2000 && n < 92000; i++) for (let d = 0; d < 46; d++) { n++; moves.push({ date: `2025-${d < 30 ? '11' : '12'}-${String((d % 30) + 1).padStart(2, '0')}`, doc: `D${n}`, type: d % 5 === 0 ? 'receipt' : 'issue', sku: `S${i}`, product: `Prekė ${i}`, wh: i % 2 ? 'A' : 'B', qty: 3, unit: 'pcs', cost: 1 + (i % 13) }); }
    const recs = toRecords(snaps, moves);
    expect(recs.length).toBeGreaterThan(95000);
    const t = Date.now();
    const d = dash(recs);
    expect(kpi(d, 'i_value').current).not.toBeNull();
    expect(Date.now() - t).toBeLessThan(3000);
  });
});
