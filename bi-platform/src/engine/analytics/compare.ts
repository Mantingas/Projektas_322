import type { SalesRecord } from '../types';
import { aggregate, groupAggregates, type Aggregate } from './aggregate';
import { dimensionOf, disambiguateLabels, type Dimension, type SalesDimension } from './filters';
import { addDays, daysBetween, lengthDays, monthStart, weekStart } from './dates';
import { evaluate, METRICS, type MetricContext, type MetricId, type MetricUnit, type Unavailable } from './metrics';
import { isComparisonBlocked, type Range, type ResolvedPeriods } from './periods';

export const inRange = <T extends { date: string }>(records: T[], r: Range): T[] => records.filter((x) => x.date >= r.from && x.date <= r.to);

// ───────── metric comparison ─────────
export interface GenericMetric<A, C> {
  id: string;
  unit: MetricUnit;
  higherIsBetter: boolean;
  /** Neither direction is "good" (e.g. spend or quantity): the change is shown without red / green. */
  neutral?: boolean;
  evaluate(a: A, ctx: C): { value: number | null; unavailable?: string };
}

export type ChangeStatus = 'ok' | 'unavailable' | 'no_previous_value' | 'zero_base' | 'blocked';
export interface MetricComparison {
  id: string;
  unit: MetricUnit;
  higherIsBetter: boolean;
  current: number | null;
  previous: number | null;
  /** current − previous (for pct metrics: percentage points). */
  abs: number | null;
  /** (current − previous) / |previous|; null when previous is 0 or a value is missing. */
  pct: number | null;
  direction: 'up' | 'down' | 'flat' | null;
  status: ChangeStatus;
  unavailable?: string;
  /** Whether the change is "good" for the business (null when unknown / flat). */
  good: boolean | null;
}

export function compareMetric(id: MetricId, cur: Aggregate, prev: Aggregate, ctx: MetricContext, periods?: ResolvedPeriods): MetricComparison {
  return compareWith(METRICS[id], cur, prev, ctx, periods);
}

/** Generic comparison of ANY registered metric (sales, purchasing …): same rules for zero bases, blocked periods and direction. */
export function compareWith<A, C>(def: GenericMetric<A, C>, cur: A, prev: A, ctx: C, periods?: ResolvedPeriods): MetricComparison {
  const id = def.id;
  const c = def.evaluate(cur, ctx);
  const p = def.evaluate(prev, ctx);
  const base = { id, unit: def.unit, higherIsBetter: def.higherIsBetter, current: c.value, previous: p.value, abs: null, pct: null, direction: null, good: null } as const;
  if (c.value === null) return { ...base, status: 'unavailable', unavailable: c.unavailable };
  if (periods && isComparisonBlocked(periods)) return { ...base, status: 'blocked' };
  if (p.value === null) return { ...base, status: 'no_previous_value', unavailable: p.unavailable };
  const abs = c.value - p.value;
  const pct = p.value !== 0 && def.unit !== 'pct' ? abs / Math.abs(p.value) : null;
  const flat = Math.abs(abs) < 1e-9 || (pct !== null && Math.abs(pct) < 0.005) || (def.unit === 'pct' && Math.abs(abs) < 0.005);
  const direction = flat ? 'flat' : abs > 0 ? 'up' : 'down';
  const status: ChangeStatus = p.value === 0 && def.unit !== 'pct' ? 'zero_base' : 'ok';
  return { ...base, abs, pct, direction, status, good: flat || def.neutral ? null : abs > 0 === def.higherIsBetter };
}

export interface ComparisonResult {
  periods: ResolvedPeriods;
  current: Aggregate;
  previous: Aggregate;
  metrics: MetricComparison[];
}

/** `incompletePrevious`: the previous window is only partly covered by the data, so no change may be reported (values stay, comparisons are blocked). */
export function comparePeriods(records: SalesRecord[], periods: ResolvedPeriods, ids: MetricId[], ctx: MetricContext, incompletePrevious = false): ComparisonResult {
  const current = aggregate(inRange(records, periods.current));
  const previous = aggregate(inRange(records, periods.previous));
  const metrics = ids.map((id) => {
    const m = compareMetric(id, current, previous, ctx, periods);
    return incompletePrevious && m.status !== 'unavailable' ? { ...m, previous: null, abs: null, pct: null, direction: null, good: null, status: 'blocked' as const } : m;
  });
  return { periods, current, previous, metrics };
}

// ───────── time series ─────────
export type Granularity = 'day' | 'week' | 'month';
export interface TrendPoint {
  start: string;
  end: string;
  revenue: number;
  lines: number;
}

export function autoGranularity(days: number): Granularity {
  return days <= 45 ? 'day' : days <= 200 ? 'week' : 'month';
}

const bucketStart = (iso: string, g: Granularity) => (g === 'day' ? iso : g === 'week' ? weekStart(iso) : monthStart(iso));

/** Zero-filled sales trend over a range. */
export function salesTrend(records: { date: string; amount: number }[], range: Range, g: Granularity = autoGranularity(lengthDays(range.from, range.to))): TrendPoint[] {
  const map = new Map<string, TrendPoint>();
  // build buckets
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    const s = bucketStart(d, g);
    if (!map.has(s)) map.set(s, { start: s, end: s, revenue: 0, lines: 0 });
    map.get(s)!.end = d;
  }
  for (const r of records) {
    if (r.date < range.from || r.date > range.to) continue;
    const p = map.get(bucketStart(r.date, g));
    if (p) {
      p.revenue += r.amount;
      p.lines++;
    }
  }
  return [...map.values()];
}

export interface AlignedPoint {
  index: number;
  currentFrom: string;
  previousFrom: string;
  current: number;
  previous: number;
}

/** Current vs previous aligned by position in the period (day 1 vs day 1 …), bucketed when the period is long. */
export function alignedSeries(records: { date: string; amount: number }[], periods: ResolvedPeriods): { bucketDays: number; points: AlignedPoint[] } {
  const n = Math.max(periods.currentDays, periods.previousDays);
  const bucketDays = n <= 45 ? 1 : n <= 200 ? 7 : 30;
  const count = Math.ceil(n / bucketDays);
  const points: AlignedPoint[] = Array.from({ length: count }, (_, i) => ({
    index: i, currentFrom: addDays(periods.current.from, i * bucketDays), previousFrom: addDays(periods.previous.from, i * bucketDays), current: 0, previous: 0,
  }));
  for (const r of records) {
    if (r.date >= periods.current.from && r.date <= periods.current.to) points[Math.floor(daysBetween(periods.current.from, r.date) / bucketDays)]!.current += r.amount;
    if (r.date >= periods.previous.from && r.date <= periods.previous.to) points[Math.floor(daysBetween(periods.previous.from, r.date) / bucketDays)]!.previous += r.amount;
  }
  return { bucketDays, points };
}

// ───────── entity tables / rankings ─────────
export interface EntityRow {
  key: string;
  label: string;
  current: number;
  previous: number;
  change: number;
  /** null when previous is 0 (new entity) */
  changePct: number | null;
  /** Share of current total (all entities incl. unassigned). */
  share: number;
  lines: number;
  quantity: number | null;
  orders: number | null;
  /** Margin when cost coverage is sufficient for this entity. */
  margin: number | null;
}

export interface EntityTable {
  dimension: Dimension;
  rows: EntityRow[];
  unassigned: { current: number; previous: number };
  totalCurrent: number;
  totalPrevious: number;
}

export function entityTable(records: SalesRecord[], dim: SalesDimension, periods: ResolvedPeriods, ctx: MetricContext): EntityTable {
  const cur = groupAggregates(inRange(records, periods.current), dim);
  const prev = groupAggregates(inRange(records, periods.previous), dim);
  const keys = new Set([...cur.groups.keys(), ...prev.groups.keys()]);
  const totalCurrent = [...cur.groups.values()].reduce((s, g) => s + g.agg.revenue, 0) + cur.unassigned.revenue;
  const totalPrevious = [...prev.groups.values()].reduce((s, g) => s + g.agg.revenue, 0) + prev.unassigned.revenue;
  const rows: EntityRow[] = [...keys].map((k) => {
    const c = cur.groups.get(k);
    const p = prev.groups.get(k);
    const a = c?.agg;
    const cv = a ? evaluate('sales', a, ctx).value ?? 0 : 0;
    const pv = p ? evaluate('sales', p.agg, ctx).value ?? 0 : 0;
    return {
      key: k, label: (c ?? p)!.label, current: cv, previous: pv, change: cv - pv, changePct: pv !== 0 ? (cv - pv) / Math.abs(pv) : null,
      share: totalCurrent !== 0 ? cv / totalCurrent : 0, lines: a?.lines ?? 0,
      quantity: a ? evaluate('quantity', a, ctx).value : null, orders: a ? evaluate('orders', a, ctx).value : null,
      margin: a ? evaluate('margin', a, ctx).value : null,
    };
  });
  return { dimension: dim, rows: disambiguateLabels(rows), unassigned: { current: cur.unassigned.revenue, previous: prev.unassigned.revenue }, totalCurrent, totalPrevious };
}

export function topBottom(rows: EntityRow[], n: number): { top: EntityRow[]; bottom: EntityRow[] } {
  const active = rows.filter((r) => r.current > 0).sort((a, b) => b.current - a.current || a.label.localeCompare(b.label));
  return { top: active.slice(0, n), bottom: active.length > n ? active.slice(-Math.min(n, active.length - n)).reverse() : [] };
}

// ───────── Pareto ─────────
export interface ParetoPoint {
  key: string;
  label: string;
  value: number;
  cumulativeShare: number;
}
export function pareto(rows: EntityRow[]): { points: ParetoPoint[]; countFor80: number; total: number } {
  const pos = rows.filter((r) => r.current > 0).sort((a, b) => b.current - a.current || a.label.localeCompare(b.label));
  const total = pos.reduce((s, r) => s + r.current, 0);
  let acc = 0;
  let countFor80 = 0;
  const points = pos.map((r) => {
    acc += r.current;
    if (countFor80 === 0 && acc >= total * 0.8) countFor80 = pos.indexOf(r) + 1;
    return { key: r.key, label: r.label, value: r.current, cumulativeShare: total ? acc / total : 0 };
  });
  return { points, countFor80, total };
}

// ───────── waterfall ─────────
export interface WaterfallStep {
  key: string;
  label: string;
  delta: number;
  kind: 'entity' | 'other' | 'unassigned';
}
export interface Waterfall {
  start: number;
  end: number;
  steps: WaterfallStep[];
}

/** previous total + Σ step deltas = current total, exactly. Entities beyond `maxSteps` are folded into "other". */
export function waterfall(table: EntityTable, maxSteps = 8): Waterfall {
  const moved = table.rows.filter((r) => Math.abs(r.change) > 1e-9).sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.label.localeCompare(b.label));
  const shown = moved.slice(0, maxSteps);
  const rest = moved.slice(maxSteps);
  const steps: WaterfallStep[] = shown.map((r) => ({ key: r.key, label: r.label, delta: r.change, kind: 'entity' }));
  const otherDelta = rest.reduce((s, r) => s + r.change, 0);
  if (rest.length) steps.push({ key: '__other', label: '', delta: otherDelta, kind: 'other' });
  const un = table.unassigned.current - table.unassigned.previous;
  if (Math.abs(un) > 1e-9) steps.push({ key: '__unassigned', label: '', delta: un, kind: 'unassigned' });
  return { start: table.totalPrevious, end: table.totalCurrent, steps };
}

// ───────── composition ─────────
export function composition(table: EntityTable, maxItems = 8): { label: string; value: number; share: number; other?: boolean }[] {
  const pos = table.rows.filter((r) => r.current > 0).sort((a, b) => b.current - a.current);
  const total = pos.reduce((s, r) => s + r.current, 0);
  if (total <= 0) return [];
  const head = pos.slice(0, maxItems).map((r) => ({ label: r.label, value: r.current, share: r.current / total }));
  const tail = pos.slice(maxItems).reduce((s, r) => s + r.current, 0);
  return tail > 0 ? [...head, { label: '', value: tail, share: tail / total, other: true }] : head;
}

export { dimensionOf };
