import type { InventoryRecord, AmountBasis } from '../types';
import type { Series } from '../analytics/aggregate';
import type { ChartPlan } from '../analytics/charts';
import { addDays, daysBetween, monthStart, weekStart } from '../analytics/dates';
import { compareWith, composition, pareto, waterfall, autoGranularity, type EntityRow, type EntityTable, type MetricComparison, type ParetoPoint, type TrendPoint, type Waterfall } from '../analytics/compare';
import { resolvePeriods, isComparisonBlocked, type PeriodSelection, type PeriodWarning, type Range, type ResolvedPeriods } from '../analytics/periods';
import type { InventoryDimension } from './entities';
import { comparableUnit, type UnitPolicy } from '../purchasing/units';
import { ambiguousInventoryCodes, applyInventoryFilters, hasInventoryDimension } from './entities';
import { flowTotals, moveCoverage, reconcile, toMoveLine, transferCheck, SLOW_COVER_DAYS, TARGET_COVER_DAYS, RISK_COVER_DAYS, HISTORY_WANT_DAYS, type FlowTotals, type ItemStatus, type MoveCoverage, type MoveLine, type ReconRow, type RiskRow, type TransferCheck } from './flows';
import { evaluateWindow, explainInventoryInputs, INVENTORY_KPI_ORDER, INVENTORY_METRICS, posSig, type InventoryContext, type WindowEval } from './metrics';
import { SnapIndex, toPosLine, VALUE_COVERAGE_MIN, type LineCtx, type PosAgg, type PosLine } from './position';

export type InventoryLimitation =
  | { code: 'other_series_hidden'; count: number }
  | { code: 'filtered' }
  | { code: 'identity_content' }
  | { code: 'identity_mixed' }
  | { code: 'held_pending'; lines: number }
  | { code: 'no_comparison' }
  | { code: 'i_no_snapshot' }
  | { code: 'i_no_movements' }
  | { code: 'i_no_previous_snapshot' }
  | { code: 'i_cost_partial'; pct: number }
  | { code: 'i_negative_stock'; lines: number }
  | { code: 'i_value_conflict'; lines: number }
  | { code: 'i_snapshot_lag'; days: number }
  | { code: 'i_multi_source'; count: number }
  | { code: 'i_mixed_units'; count: number }
  | { code: 'i_units_not_provided' }
  | { code: 'i_metric_units' }
  | { code: 'i_code_ambiguity'; count: number }
  | { code: 'i_name_identity'; count: number }
  | { code: 'i_unmatched'; count: number }
  | { code: 'i_movement_unclear'; pct: number }
  | { code: 'i_unbalanced_transfers'; count: number }
  | { code: 'i_thresholds'; slow: number; target: number; risk: number; days: number };

export interface InventoryOptions {
  series: Series | { currency: string; basis: AmountBasis };
  filters: import('../analytics/filters').FilterSpec;
  period: PeriodSelection;
  unitPolicy?: UnitPolicy;
  identity?: 'document' | 'mixed' | 'content';
  heldPending?: number;
}

export interface AbcClass { count: number; value: number; share: number }
export interface MovementPoint { start: string; receipts: number; issues: number; lines: number }

export interface InventoryView {
  series: Series;
  ctx: InventoryContext;
  bounds: { dateMin: string; dateMax: string };
  periods: ResolvedPeriods;
  /** A previous position exists (from its own snapshot) and the periods are comparable. */
  comparable: boolean;
  kpis: MetricComparison[];
  trend: TrendPoint[];
  aligned: { bucketDays: number; points: never[] };
  tables: Partial<Record<InventoryDimension, EntityTable | null>>;
  pareto: { dimension: InventoryDimension; points: ParetoPoint[]; countFor80: number; total: number } | null;
  waterfall: { dimension: InventoryDimension; data: Waterfall } | null;
  composition: { label: string; value: number; share: number; other?: boolean }[];
  abc: { a: AbcClass; b: AbcClass; c: AbcClass } | null;
  /** Slow-moving and non-moving items, most value first. */
  slow: ItemStatus[];
  slowTotal: number;
  /** Capital above the 90-day target cover for items with observed demand (not a loss). */
  excessValue: number | null;
  risk: RiskRow[];
  riskTotal: number;
  /** Product keys behind the slow / non-moving / stockout KPIs (for "view records"; capped). */
  keys: { slow: string[]; nonMoving: string[]; risk: string[] };
  movementTrend: { unit: 'value' | 'qty'; points: MovementPoint[] } | null;
  flows: FlowTotals | null;
  transfers: TransferCheck;
  recon: ReconRow[];
  /** Snapshot dates of the series and the movement span, for the data-sources panel. */
  snapshotDates: string[];
  movementSpan: { from: string; to: string; lines: number } | null;
  asOf: { current: string | null; previous: string | null };
  charts: ChartPlan[];
  warnings: PeriodWarning[];
  limitations: InventoryLimitation[];
  explain: Partial<Record<string, Record<string, number>>>;
  unitPolicy: UnitPolicy;
  thresholds: { slow: number; target: number; risk: number; days: number | null };
}

/** The view plus what the insight rules need. Never leaves the worker. */
export interface InventoryModel extends InventoryView {
  records: InventoryRecord[];
  cur: WindowEval;
  prev: WindowEval;
  moves: MoveLine[];
  cov: MoveCoverage | null;
  curTable: PosAgg | null;
  valueConflicts: { label: string; warehouse: string; stated: number; computed: number }[];
  costOutliers: { label: string; min: number; max: number; ratio: number }[];
  negatives: PosLine[];
}

const DIMS: InventoryDimension[] = ['product', 'warehouse', 'category'];

function entityTable(dim: InventoryDimension, cur: PosAgg | null, prev: PosAgg | null): EntityTable {
  const pick = (a: PosAgg | null) => {
    const m = new Map<string, { label: string; value: number; lines: number; qty: number | null }>();
    if (!a) return m;
    if (dim === 'product') for (const [k, p] of a.byProduct) m.set(k, { label: p.label, value: p.value, lines: p.lines, qty: p.qtyByUnit.size === 1 ? [...p.qtyByUnit.values()][0]! : null });
    else for (const [k, p] of dim === 'warehouse' ? a.byWarehouse : a.byCategory) m.set(k, { label: p.label || '—', value: p.value, lines: p.lines, qty: null });
    return m;
  };
  const c = pick(cur);
  const p = pick(prev);
  const keys = new Set([...c.keys(), ...p.keys()]);
  const totalCurrent = [...c.values()].reduce((s, x) => s + x.value, 0);
  const totalPrevious = [...p.values()].reduce((s, x) => s + x.value, 0);
  const pos = [...c.values()].reduce((s, x) => s + Math.max(0, x.value), 0);
  const rows: EntityRow[] = [...keys].map((k) => {
    const a = c.get(k);
    const b = p.get(k);
    const cv = a?.value ?? 0;
    const pv = b?.value ?? 0;
    return { key: k, label: (a ?? b)!.label, current: cv, previous: pv, change: cv - pv, changePct: pv !== 0 ? (cv - pv) / Math.abs(pv) : null, share: pos > 0 ? Math.max(0, cv) / pos : 0, lines: a?.lines ?? 0, quantity: a?.qty ?? null, orders: null, margin: null };
  });
  return { dimension: dim as never, rows, unassigned: { current: 0, previous: 0 }, totalCurrent, totalPrevious };
}

function abcOf(rows: EntityRow[]): InventoryView['abc'] {
  const pos = rows.filter((r) => r.current > 0).sort((a, b) => b.current - a.current || a.label.localeCompare(b.label));
  const total = pos.reduce((s, r) => s + r.current, 0);
  if (pos.length < 3 || total <= 0) return null;
  const z = (): AbcClass => ({ count: 0, value: 0, share: 0 });
  const out = { a: z(), b: z(), c: z() };
  let acc = 0;
  for (const r of pos) {
    const before = acc / total;
    acc += r.current;
    const k = before < 0.8 ? 'a' : before < 0.95 ? 'b' : 'c'; // an item belongs to the class in which the cumulative share STARTS
    out[k].count++;
    out[k].value += r.current;
  }
  for (const k of ['a', 'b', 'c'] as const) out[k].share = out[k].value / total;
  return out;
}

function movementTrend(moves: MoveLine[], cov: MoveCoverage | null): InventoryView['movementTrend'] {
  if (!cov) return null;
  const typed = moves.filter((m) => m.type === 'receipt' || m.type === 'issue' || m.type === 'return');
  if (typed.length === 0) return null;
  const known = typed.filter((m) => m.value !== null).length / typed.length;
  const units = new Set(typed.map((m) => m.gk.split('|')[1] ?? ''));
  const unit: 'value' | 'qty' | null = known >= VALUE_COVERAGE_MIN ? 'value' : units.size === 1 && !units.has('') ? 'qty' : null;
  if (!unit) return null;
  const g = autoGranularity(daysBetween(cov.min, cov.max) + 1);
  const bucket = (d: string) => (g === 'day' ? d : g === 'week' ? weekStart(d) : monthStart(d));
  const map = new Map<string, MovementPoint>();
  for (let d = cov.min; d <= cov.max; d = addDays(d, 1)) { const b = bucket(d); if (!map.has(b)) map.set(b, { start: b, receipts: 0, issues: 0, lines: 0 }); }
  for (const m of typed) {
    const x = unit === 'value' ? m.value : m.qty;
    if (x === null) continue;
    const p = map.get(bucket(m.date))!;
    p.lines++;
    if (m.type === 'receipt' || (m.type === 'return' && m.qty < 0)) p.receipts += x; // supplier returns reduce receipts (x is negative)
    else if (m.type === 'issue') p.issues += -x;
    else p.issues -= x; // customer return reverses an issue
  }
  return { unit, points: [...map.values()] };
}

/**
 * The inventory dashboard model: stock position at the end of each comparison window (from the latest snapshot of every warehouse on or before that date),
 * flow metrics from movements, status of items. Same period engine, filters, comparison rules, entity tables, Pareto and waterfall as sales and purchasing.
 * Metrics that need history (turnover, slow / non-moving, cover-based stockout risk) are WITHHELD unless the movement data supports them.
 */
export function buildInventoryDashboard(all: InventoryRecord[], o: InventoryOptions): InventoryModel | null {
  const seriesAll = all.filter((r) => r.currency === o.series.currency);
  if (seriesAll.length === 0) return null;
  const policy: UnitPolicy = o.unitPolicy ?? 'strict';
  const records = applyInventoryFilters(seriesAll, { ...o.filters, dateFrom: undefined, dateTo: undefined });
  const snapsAll = seriesAll.filter((r) => r.kind === 'snapshot');
  const movesAll = seriesAll.filter((r) => r.kind === 'movement');
  const snapHasUnit = snapsAll.some((r) => r.unit !== undefined);
  const moveHasUnit = movesAll.some((r) => r.unit !== undefined);
  // units take part in matching only when both sides carry them; otherwise matching is by product and the limitation says so
  const lineCtx: LineCtx = { policy, unitInKey: snapHasUnit && moveHasUnit };
  const snaps = records.filter((r) => r.kind === 'snapshot');
  const idx = new SnapIndex(snaps);
  const movesFiltered = records.filter((r) => r.kind === 'movement').map((r) => toMoveLine(r, lineCtx));
  const covAll = moveCoverage(movesAll.map((r) => toMoveLine(r, lineCtx)));
  const ambiguous = ambiguousInventoryCodes(seriesAll);

  let sMin = seriesAll[0]!.date;
  let sMax = sMin;
  const dates = new Set<string>();
  for (const r of seriesAll) { if (r.date < sMin) sMin = r.date; if (r.date > sMax) sMax = r.date; dates.add(r.date); }
  const periods = resolvePeriods(o.period, { dateMin: sMin, dateMax: sMax, dates });
  const ctx: InventoryContext = { policy, hasUnitColumn: snapHasUnit };

  const base = { idx, moves: movesFiltered, cov: covAll, ambiguous, lineCtx };
  const cur = evaluateWindow(base, periods.current);
  const prev = evaluateWindow({ ...base, sameAs: posSig(cur.position) }, periods.previous);
  const kpis = INVENTORY_KPI_ORDER.map((id) => compareWith(INVENTORY_METRICS[id], cur, prev, ctx, periods));
  const comparable = !isComparisonBlocked(periods) && cur.pos !== null && prev.pos !== null;

  const tables: InventoryView['tables'] = {};
  for (const d of DIMS) tables[d] = hasInventoryDimension(snaps, d) && cur.pos ? entityTable(d, cur.pos, prev.pos) : null;
  const pDim = (['product', 'warehouse'] as InventoryDimension[]).find((d) => (tables[d]?.rows.filter((r) => r.current > 0).length ?? 0) >= 5);
  const wDim = (['product', 'warehouse'] as InventoryDimension[]).find((d) => (tables[d]?.rows.filter((r) => Math.abs(r.change) > 1e-9).length ?? 0) >= 2);

  // stock value over time: one point per snapshot date (latest snapshot of each warehouse up to that date)
  const valued = idx.allDates.map((d) => ({ d, ...idx.valueAt(d) })).filter((x) => x.lines > 0 && x.valued / x.lines >= VALUE_COVERAGE_MIN);
  const step = Math.max(1, Math.ceil(valued.length / 120));
  const trend: TrendPoint[] = valued.filter((_, i) => i % step === 0 || i === valued.length - 1).map((x) => ({ start: x.d, end: x.d, revenue: x.value, lines: x.lines }));

  // statuses
  const statusItems = cur.status?.items ?? [];
  const slowAll = statusItems.filter((i) => i.state === 'slow' || i.state === 'non_moving').sort((a, b) => (b.stockValue ?? -1) - (a.stockValue ?? -1) || a.label.localeCompare(b.label));
  const excessItems = statusItems.filter((i) => i.excessValue !== null && i.state !== 'non_moving');
  const excessValue = cur.status && cur.pos && cur.pos.lines > 0 && cur.pos.valued / cur.pos.lines >= VALUE_COVERAGE_MIN ? excessItems.reduce((s, i) => s + (i.excessValue ?? 0), 0) : null;
  const riskRows = cur.risk?.rows ?? [];
  const mt = movementTrend(movesFiltered, covAll);
  const flows = covAll ? flowTotals(movesFiltered, periods.current) : null;
  const transfers = transferCheck(movesFiltered, periods.current);

  // reconciliation of consecutive snapshots with the movements between them
  const bySnap = new Map<string, { date: string; lines: PosLine[] }[]>();
  for (const [k, e] of idx.byWh) {
    const list: { date: string; lines: PosLine[] }[] = [];
    for (const d of e.dates) list.push({ date: d, lines: e.lines.get(d)!.map((r) => toPosLine(r, lineCtx)).filter((l): l is PosLine => l !== null) });
    if (list.length > 1) bySnap.set(k, list);
  }
  const recon = reconcile(bySnap, movesFiltered, covAll).sort((a, b) => Math.abs(b.diff * (b.unitValue ?? 1)) - Math.abs(a.diff * (a.unitValue ?? 1)));

  // valuation anomalies at the closing position
  const posLines = cur.position?.lines ?? [];
  const valueConflicts = posLines.filter((l) => l.conflict).map((l) => ({ label: l.label, warehouse: l.whLabel, stated: l.rec.value!, computed: l.rec.quantity! * l.rec.unitCost! }));
  const costByProduct = new Map<string, { label: string; costs: number[] }>();
  for (const l of posLines) {
    if (l.qty <= 0 || l.value === null || l.value <= 0) continue;
    const c = l.value / l.qty;
    const e = costByProduct.get(l.gk) ?? { label: l.label, costs: [] };
    e.costs.push(c);
    costByProduct.set(l.gk, e);
  }
  const costOutliers = [...costByProduct.values()].filter((e) => e.costs.length > 1).map((e) => ({ label: e.label, min: Math.min(...e.costs), max: Math.max(...e.costs), ratio: Math.max(...e.costs) / Math.min(...e.costs) })).filter((e) => e.ratio >= 3).sort((a, b) => b.ratio - a.ratio);
  const negatives = posLines.filter((l) => l.qty < 0);

  // charts: only what the data supports, with the reason when hidden
  const noSnap = !cur.pos;
  const charts: ChartPlan[] = [
    { id: 'trend', ...(trend.length >= 2 ? { available: true } : { available: false, reason: noSnap ? ('no_snapshot' as const) : valued.length === 0 ? ('no_value' as const) : ('too_few_points' as const) }) },
    { id: 'topProducts', dimension: 'product' as never, ...(!tables.product ? { available: false, reason: noSnap ? ('no_snapshot' as const) : ('needs_dimension' as const) } : (tables.product.rows.filter((r) => r.current > 0).length < 2 ? { available: false, reason: 'too_few_entities' as const } : { available: true })) },
    { id: 'warehouseComparison', dimension: 'warehouse' as never, ...(!tables.warehouse ? { available: false, reason: noSnap ? ('no_snapshot' as const) : ('needs_dimension' as const) } : tables.warehouse.rows.length < 2 ? { available: false, reason: 'too_few_entities' as const } : { available: true }) },
    { id: 'pareto', dimension: (pDim ?? 'product') as never, ...(pDim ? { available: true } : { available: false, reason: noSnap ? ('no_snapshot' as const) : ('too_few_entities' as const) }) },
    { id: 'abc', ...(abcOf(tables.product?.rows ?? []) ? { available: true } : { available: false, reason: noSnap ? ('no_snapshot' as const) : ('too_few_entities' as const) }) },
    { id: 'waterfall', dimension: (wDim ?? 'product') as never, ...(!comparable ? { available: false, reason: noSnap ? ('no_snapshot' as const) : ('no_comparison' as const) } : wDim ? { available: true } : { available: false, reason: 'too_few_entities' as const }) },
    { id: 'slowMoving', ...(cur.status ? { available: true } : { available: false, reason: cur.statusWhy === 'no_snapshot' ? ('no_snapshot' as const) : cur.statusWhy === 'short_history' || cur.statusWhy === 'history_gap' ? ('short_history' as const) : ('needs_movements' as const) }) },
    { id: 'stockoutRisk', ...(cur.risk ? { available: true } : { available: false, reason: noSnap ? ('no_snapshot' as const) : ('needs_movements' as const) }) },
    { id: 'movementTrend', ...(mt && mt.points.filter((p) => p.lines > 0).length >= 2 ? { available: true } : { available: false, reason: !covAll ? ('needs_movements' as const) : ('no_value' as const) }) },
  ];

  // limitations
  const lim: InventoryLimitation[] = [];
  if (o.identity === 'content') lim.push({ code: 'identity_content' });
  if (o.identity === 'mixed') lim.push({ code: 'identity_mixed' });
  const others = new Set(all.map((r) => r.currency)).size - 1;
  if (others > 0) lim.push({ code: 'other_series_hidden', count: others });
  if (records.length !== seriesAll.length) lim.push({ code: 'filtered' });
  if (o.heldPending) lim.push({ code: 'held_pending', lines: o.heldPending });
  if (snapsAll.length === 0) lim.push({ code: 'i_no_snapshot' });
  else if (movesAll.length === 0) lim.push({ code: 'i_no_movements' });
  if (cur.pos && !prev.pos) lim.push({ code: 'i_no_previous_snapshot' });
  if (cur.pos && cur.pos.lines > 0 && cur.pos.valued < cur.pos.lines) lim.push({ code: 'i_cost_partial', pct: cur.pos.valued / cur.pos.lines });
  if (cur.pos && cur.pos.negativeLines) lim.push({ code: 'i_negative_stock', lines: cur.pos.negativeLines });
  if (cur.pos && cur.pos.conflictLines) lim.push({ code: 'i_value_conflict', lines: cur.pos.conflictLines });
  const windowDays = daysBetween(periods.current.from, periods.current.to) + 1;
  if (cur.pos && cur.pos.lag > 7 && cur.pos.lag > windowDays / 4) lim.push({ code: 'i_snapshot_lag', days: cur.pos.lag });
  if (cur.pos && cur.pos.multiSource) lim.push({ code: 'i_multi_source', count: cur.pos.multiSource });
  if (cur.pos && cur.pos.lines && [...cur.pos.qtyByUnit.keys()].length > 1) lim.push({ code: 'i_mixed_units', count: cur.pos.qtyByUnit.size });
  if (snapsAll.length && !snapHasUnit) lim.push({ code: 'i_units_not_provided' });
  if (policy === 'metric') lim.push({ code: 'i_metric_units' });
  if (ambiguous.size) lim.push({ code: 'i_code_ambiguity', count: ambiguous.size });
  const nameOnly = cur.pos ? [...cur.pos.byProduct.values()].filter((p) => p.identity === 'name').length : 0;
  if (nameOnly) lim.push({ code: 'i_name_identity', count: nameOnly });
  if (cur.status && cur.status.unmatched) lim.push({ code: 'i_unmatched', count: cur.status.unmatched });
  if (covAll && covAll.unknownShare > 0.2) lim.push({ code: 'i_movement_unclear', pct: covAll.unknownShare });
  if (transfers.unbalanced.length) lim.push({ code: 'i_unbalanced_transfers', count: new Set(transfers.unbalanced.map((u) => u.doc)).size });
  if (cur.status) lim.push({ code: 'i_thresholds', slow: SLOW_COVER_DAYS, target: TARGET_COVER_DAYS, risk: RISK_COVER_DAYS, days: cur.status.history.days });

  const explain: InventoryView['explain'] = {};
  for (const id of INVENTORY_KPI_ORDER) explain[id] = explainInventoryInputs(id, cur);
  const series: Series = { currency: o.series.currency, basis: o.series.basis } as Series;
  const view: InventoryModel = {
    series, ctx, bounds: { dateMin: sMin, dateMax: sMax }, periods, comparable, kpis, trend, aligned: { bucketDays: 1, points: [] }, tables,
    pareto: pDim ? { dimension: pDim, ...pareto(tables[pDim]!.rows) } : null,
    waterfall: wDim && comparable ? { dimension: wDim, data: waterfall(tables[wDim]!) } : null,
    composition: tables.warehouse ? composition(tables.warehouse) : [],
    abc: abcOf(tables.product?.rows ?? []),
    slow: slowAll.slice(0, 50), slowTotal: slowAll.length, excessValue, risk: riskRows.slice(0, 50), riskTotal: riskRows.length,
    keys: { slow: statusItems.filter((i) => i.state === 'slow').map((i) => i.pk).slice(0, 500), nonMoving: statusItems.filter((i) => i.state === 'non_moving').map((i) => i.pk).slice(0, 500), risk: [...new Set(riskRows.map((r) => r.pk))].slice(0, 500) },
    movementTrend: mt, flows, transfers, recon: recon.slice(0, 50),
    snapshotDates: idx.allDates, movementSpan: covAll ? { from: covAll.min, to: covAll.max, lines: covAll.lines } : null,
    asOf: { current: cur.position?.newest ?? null, previous: prev.position?.newest ?? null },
    charts, warnings: periods.warnings, limitations: lim, explain, unitPolicy: policy, thresholds: { slow: SLOW_COVER_DAYS, target: TARGET_COVER_DAYS, risk: RISK_COVER_DAYS, days: cur.status?.history.days ?? null },
    records, cur, prev, moves: movesFiltered, cov: covAll, curTable: cur.pos, valueConflicts, costOutliers, negatives,
  };
  void HISTORY_WANT_DAYS; void comparableUnit;
  return view;
}
