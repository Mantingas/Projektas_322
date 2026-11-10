import type { AmountBasis, FinanceRecord, FinanceSide } from '../types';
import type { Series } from '../analytics/aggregate';
import type { ChartPlan } from '../analytics/charts';
import { addDays, daysBetween, weekStart } from '../analytics/dates';
import { compareWith, composition, pareto, waterfall, type EntityRow, type EntityTable, type MetricComparison, type ParetoPoint, type Waterfall } from '../analytics/compare';
import type { FilterSpec } from '../analytics/filters';
import { isComparisonBlocked, resolvePeriods, type PeriodSelection, type PeriodWarning, type ResolvedPeriods } from '../analytics/periods';
import { cpKey, cpLabel, norm } from './keys';
import {
  behaviour, buildUniverse, coverageOf, creditReview, daysPastDue, DUE_SOON_DAYS, DUP_WINDOW_DAYS, duplicatePayments, LONG_OVERDUE_DAYS, listSnapshots, matchPayments, MATCH_MIN, pickSnapshot, positionOf, posSig,
  type BehaviourRow, type Bucketed, type CreditRow, type DupGroup, type FinPos, type FinSnapshot, type PayInfo, type Universe,
} from './ledger';
import { evaluateWindow, explainFinanceInputs, FINANCE_KPI_ORDER, FINANCE_METRICS, type FinanceContext, type FinInput, type FinWindow } from './metrics';

export type FinanceLimitation =
  | { code: 'other_series_hidden'; count: number } | { code: 'filtered' } | { code: 'identity_content' } | { code: 'identity_mixed' } | { code: 'held_pending'; lines: number }
  | { code: 'f_no_position' } | { code: 'f_no_previous_snapshot' } | { code: 'f_snapshot_lag'; days: number } | { code: 'f_multi_source'; count: number }
  | { code: 'f_source_aging' } | { code: 'f_source_balance' } | { code: 'f_due_missing'; count: number } | { code: 'f_duplicate_invoices'; count: number } | { code: 'f_conflicting_invoices'; count: number }
  | { code: 'f_unreferenced_payments'; count: number } | { code: 'f_unmatched_payments'; count: number } | { code: 'f_no_registers' } | { code: 'f_days_basis' } | { code: 'f_unused_sources'; count: number }
  | { code: 'f_thresholds'; soon: number; long: number; dup: number; min: number };

export interface FinanceOptions {
  series: Series | { currency: string; basis: AmountBasis };
  side: FinanceSide;
  filters: FilterSpec;
  period: PeriodSelection;
  identity?: 'document' | 'mixed' | 'content';
  heldPending?: number;
}

export interface OverviewSide { outstanding: number; overdue: number | null; asOf: string; source: string; lag: number }
export interface OverdueRow { key: string; label: string; overdue: number; over90: number; outstanding: number; lines: number; share: number }
export interface OverdueLine { key: string; cp: string; label: string; no: string; due: string; days: number; outstanding: number }
export interface TrendPoint2 { date: string; outstanding: number; overdue: number | null }
export interface TimelinePoint { start: string; amount: number; overdue: boolean }
export interface CreditView { key: string; date: string; no: string; cp: string; label: string; amount: number; status: string; reference?: string; possible: { no: string; amount: number }[] }
export interface DupView { id: string; tier: string; cp: string; label: string; excess: number; latest: string; inWindow: boolean; invoiceNo?: string; payments: { key: string; date: string; ref?: string; amount: number; invoice?: string }[] }

export interface FinanceView {
  side: FinanceSide;
  series: Series;
  bounds: { dateMin: string; dateMax: string };
  periods: ResolvedPeriods;
  comparable: boolean;
  kpis: MetricComparison[];
  trend: never[];
  aligned: { bucketDays: number; points: never[] };
  tables: Partial<Record<'customer' | 'supplier', EntityTable | null>>;
  pareto: { dimension: 'customer' | 'supplier'; points: ParetoPoint[]; countFor80: number; total: number } | null;
  waterfall: { dimension: 'customer' | 'supplier'; data: Waterfall } | null;
  composition: { label: string; value: number; share: number; other?: boolean }[];
  aging: { source: string; asOf: string; rows: { id: keyof Bucketed; amount: number; previous: number | null }[]; total: number } | null;
  overdueRank: OverdueRow[];
  overdueLines: OverdueLine[];
  overdueLinesTotal: number;
  overdueTrend: TrendPoint2[];
  dueTimeline: TimelinePoint[];
  behaviour: BehaviourRow[];
  credits: CreditView[];
  openCredits: { key: string; no: string; label: string; amount: number }[];
  duplicates: DupView[];
  matching: { matched: number; unreferenced: number; notFound: number; conflict: number };
  overview: Record<FinanceSide, OverviewSide | null> & { net: number | null };
  asOf: { current: string | null; previous: string | null; source: string | null };
  sources: { snapshots: { kind: string; date: string; lines: number }[]; registers: Record<'invoice' | 'payment' | 'credit_note', { min: string; max: string; lines: number } | null> };
  keys: { overdue: string[] };
  charts: ChartPlan[];
  warnings: PeriodWarning[];
  limitations: FinanceLimitation[];
  explain: Partial<Record<string, Record<string, number>>>;
  thresholds: { soon: number; long: number; dup: number; min: number };
}

export interface FinanceModel extends FinanceView {
  records: FinanceRecord[];
  cur: FinWindow;
  prev: FinWindow;
  universe: Universe;
  pays: PayInfo[];
  creditRows: CreditRow[];
  dupAll: DupGroup[];
}

export function applyFinanceFilters(records: FinanceRecord[], side: FinanceSide, f: FilterSpec): FinanceRecord[] {
  const set = (l?: string[]) => (l && l.length ? new Set(l) : null);
  const cps = set(side === 'receivable' ? f.customers : f.suppliers);
  const text = f.text?.trim().toLowerCase();
  if (!cps && !text) return records;
  return records.filter((r) => {
    if (cps && !cps.has(cpKey(r))) return false;
    if (text && ![r.counterpartyName, r.counterpartyId, r.documentId, r.invoiceNo, r.reference].filter(Boolean).join(' ').toLowerCase().includes(text)) return false;
    return true;
  });
}

function table(dim: 'customer' | 'supplier', cur: FinPos | null, prev: FinPos | null): EntityTable {
  const c = cur?.byCp ?? new Map();
  const p = prev?.byCp ?? new Map();
  const keys = new Set([...c.keys(), ...p.keys()]);
  const totalCurrent = [...c.values()].reduce((s, x) => s + x.outstanding, 0);
  const totalPrevious = [...p.values()].reduce((s, x) => s + x.outstanding, 0);
  const pos = [...c.values()].reduce((s, x) => s + Math.max(0, x.outstanding), 0);
  const rows: EntityRow[] = [...keys].map((k) => {
    const a = c.get(k);
    const b = p.get(k);
    const cv = a?.outstanding ?? 0;
    const pv = b?.outstanding ?? 0;
    return { key: k, label: (a ?? b)!.label, current: cv, previous: pv, change: cv - pv, changePct: pv !== 0 ? (cv - pv) / Math.abs(pv) : null, share: pos > 0 ? Math.max(0, cv) / pos : 0, lines: a?.lines ?? 0, quantity: null, orders: null, margin: null };
  });
  return { dimension: dim, rows, unassigned: { current: 0, previous: 0 }, totalCurrent, totalPrevious };
}

function sidePos(snaps: FinSnapshot[], to: string): OverviewSide | null {
  const s = pickSnapshot(snaps, to);
  if (!s) return null;
  const p = positionOf(s, to);
  const dueOk = p.dueKnown === null || p.dueKnown >= 0.8;
  return { outstanding: p.total, overdue: p.source === 'balance' || !dueOk ? null : p.overdue, asOf: p.asOf, source: p.source, lag: p.lag };
}

/**
 * The receivables / payables dashboard model for ONE side. Positions come from ONE snapshot per date (open items > aging > balance, never added together);
 * invoiced / paid / credited totals are separate flows that are never turned into balances; matching needs exact references under the same counterparty.
 */
export function buildFinanceDashboard(all: FinanceRecord[], o: FinanceOptions): FinanceModel | null {
  const seriesAll = all.filter((r) => r.currency === o.series.currency);
  const sideAll = seriesAll.filter((r) => r.side === o.side);
  if (seriesAll.length === 0) return null;
  const records = applyFinanceFilters(sideAll, o.side, o.filters);
  const dim = o.side === 'receivable' ? 'customer' : 'supplier';

  let sMin = seriesAll[0]!.date, sMax = sMin;
  const dates = new Set<string>();
  for (const r of seriesAll) { if (r.date < sMin) sMin = r.date; if (r.date > sMax) sMax = r.date; dates.add(r.date); }
  const periods = resolvePeriods(o.period, { dateMin: sMin, dateMax: sMax, dates });

  const universe = buildUniverse(records);
  const pays = matchPayments(records, universe);
  const creditRows = creditReview(records, universe, periods.current.to);
  const snaps = listSnapshots(records);
  const base: FinInput = {
    records, snaps, universe, pays, creditRows,
    covInvoice: coverageOf(sideAll, ['invoice']), covPayment: coverageOf(sideAll, ['payment']), covCredit: coverageOf(sideAll, ['credit_note']),
  };
  const cur = evaluateWindow(base, periods.current);
  const prev = evaluateWindow({ ...base, sameAs: posSig(cur.position) }, periods.previous);
  const ctx: FinanceContext = { side: o.side };
  const order = FINANCE_KPI_ORDER[o.side];
  const kpis = order.map((id) => compareWith(FINANCE_METRICS[id], cur, prev, ctx, periods));
  const comparable = !isComparisonBlocked(periods) && cur.position !== null && prev.position !== null;
  const pos = cur.position;

  const tbl = pos ? table(dim, pos, prev.position) : null;
  const nCp = tbl?.rows.filter((r) => r.current > 0).length ?? 0;
  const movers = tbl?.rows.filter((r) => Math.abs(r.change) > 1e-9).length ?? 0;

  // aging
  const aging: FinanceView['aging'] = pos?.buckets ? {
    source: pos.source, asOf: pos.asOf, total: pos.total,
    rows: (['nd', 'd30', 'd60', 'd90', 'd90p', 'noDue', 'credits'] as (keyof Bucketed)[]).filter((id) => pos.source === 'open_item' || (id !== 'noDue' && id !== 'credits')).map((id) => ({ id, amount: pos.buckets![id], previous: prev.position?.buckets && prev.position.source === pos.source ? prev.position.buckets[id] : null })),
  } : null;

  // overdue ranking and lines
  const overdueRank: OverdueRow[] = pos && pos.overdue !== null ? [...pos.byCp.entries()].filter(([, c]) => (c.overdue ?? 0) > 0).map(([key, c]) => ({ key, label: c.label, overdue: c.overdue!, over90: c.over90 ?? 0, outstanding: c.outstanding, lines: c.lines, share: pos.overdue! > 0 ? c.overdue! / pos.overdue! : 0 })).sort((a, b) => b.overdue - a.overdue || a.label.localeCompare(b.label)).slice(0, 15) : [];
  const allOverdueLines: OverdueLine[] = pos && pos.source === 'open_item' ? pos.recs.filter((r) => (r.outstanding ?? 0) > 0 && r.dueDate && daysPastDue(r.dueDate, pos.asOf) >= 1).map((r) => ({ key: r.key, cp: cpKey(r), label: cpLabel(r) || '—', no: r.invoiceNo ?? '–', due: r.dueDate!, days: daysPastDue(r.dueDate!, pos.asOf), outstanding: r.outstanding! })).sort((a, b) => b.outstanding - a.outstanding || b.days - a.days) : [];

  // overdue trend over snapshot dates (one snapshot per date: the most detailed)
  const byDate = new Map<string, FinSnapshot>();
  for (const s of snaps) { const have = byDate.get(s.date); if (!have || (s.kind === 'open_item') || (s.kind === 'aging' && have.kind === 'balance')) byDate.set(s.date, s); }
  const overdueTrend: TrendPoint2[] = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((s) => { const p = positionOf(s, s.date); const okDue = p.source !== 'balance' && (p.dueKnown === null || p.dueKnown >= 0.8); return { date: s.date, outstanding: p.total, overdue: okDue ? p.overdue : null }; });

  // due-date timeline (open items, weekly)
  const timeline = new Map<string, TimelinePoint>();
  if (pos && pos.source === 'open_item') {
    const from = addDays(pos.asOf, -56), to = addDays(pos.asOf, 56);
    for (const r of pos.recs) {
      if ((r.outstanding ?? 0) <= 0 || !r.dueDate || r.dueDate < from || r.dueDate > to) continue;
      const w = weekStart(r.dueDate);
      const e = timeline.get(w) ?? { start: w, amount: 0, overdue: addDays(w, 6) < pos.asOf };
      e.amount += r.outstanding!;
      timeline.set(w, e);
    }
  }
  const dueTimeline = [...timeline.values()].sort((a, b) => a.start.localeCompare(b.start));

  const beh = behaviour(pays, periods.current, periods.previous);
  const credits: CreditView[] = creditRows.slice(0, 100).map((c) => ({ key: c.rec.key, date: c.rec.date, no: c.rec.documentId ?? '–', cp: c.cp, label: c.label, amount: c.amount, status: c.status, reference: c.rec.reference, possible: c.possible.map((i) => ({ no: i.no, amount: i.amount ?? 0 })) }));
  const openCredits = pos && pos.source === 'open_item' ? pos.recs.filter((r) => (r.outstanding ?? 0) < 0).map((r) => ({ key: r.key, no: r.invoiceNo ?? '–', label: cpLabel(r) || '—', amount: r.outstanding! })).sort((a, b) => a.amount - b.amount).slice(0, 20) : [];
  const paysTo = pays.filter((p) => p.rec.date <= periods.current.to);
  const dupAll = duplicatePayments(paysTo, creditRows);
  const duplicates: DupView[] = dupAll.slice(0, 50).map((g) => ({ id: g.id, tier: g.tier, cp: g.cp, label: g.label, excess: g.excess, latest: g.latest, inWindow: g.latest >= periods.current.from, invoiceNo: g.inv?.no, payments: g.payments.map((p) => ({ key: p.rec.key, date: p.rec.date, ref: p.rec.documentId, amount: p.amount, invoice: p.rec.reference })) }));
  const matching = { matched: paysTo.filter((p) => p.status === 'matched').length, unreferenced: paysTo.filter((p) => p.status === 'unreferenced').length, notFound: paysTo.filter((p) => p.status === 'not_found').length, conflict: paysTo.filter((p) => p.status === 'counterparty_conflict').length };

  // overview of both sides (same currency, same date)
  const sidesAll = (s: FinanceSide) => listSnapshots(seriesAll.filter((r) => r.side === s));
  const ov = { receivable: sidePos(sidesAll('receivable'), periods.current.to), payable: sidePos(sidesAll('payable'), periods.current.to) };
  const overview = { ...ov, net: ov.receivable && ov.payable ? ov.receivable.outstanding - ov.payable.outstanding : null };

  const noPos = !pos;
  const charts: ChartPlan[] = [
    { id: 'aging', ...(aging ? { available: true } : { available: false, reason: noPos ? ('no_ledger' as const) : ('needs_open_items' as const) }) },
    { id: 'overdueTrend', ...(overdueTrend.filter((p) => p.overdue !== null).length >= 2 ? { available: true } : { available: false, reason: noPos ? ('no_ledger' as const) : ('too_few_points' as const) }) },
    { id: 'dueTimeline', ...(dueTimeline.length >= 2 ? { available: true } : { available: false, reason: noPos ? ('no_ledger' as const) : ('needs_due_dates' as const) }) },
    { id: 'behaviour', ...(beh.filter((r) => r.cur.avg !== null).length >= 2 ? { available: true } : { available: false, reason: pays.length ? ('too_few_entities' as const) : ('needs_payments' as const) }) },
    { id: dim === 'customer' ? 'topCustomers' : 'topSuppliers', dimension: dim, ...(!tbl ? { available: false, reason: 'no_ledger' as const } : nCp < 2 ? { available: false, reason: 'too_few_entities' as const } : { available: true }) },
    { id: 'pareto', dimension: dim, ...(nCp >= 5 ? { available: true } : { available: false, reason: noPos ? ('no_ledger' as const) : ('too_few_entities' as const) }) },
    { id: 'waterfall', dimension: dim, ...(!comparable ? { available: false, reason: noPos ? ('no_ledger' as const) : ('no_comparison' as const) } : movers >= 2 ? { available: true } : { available: false, reason: 'too_few_entities' as const }) },
  ];

  const lim: FinanceLimitation[] = [];
  if (o.identity === 'content') lim.push({ code: 'identity_content' });
  if (o.identity === 'mixed') lim.push({ code: 'identity_mixed' });
  const others = new Set(all.map((r) => r.currency)).size - 1;
  if (others > 0) lim.push({ code: 'other_series_hidden', count: others });
  if (records.length !== sideAll.length) lim.push({ code: 'filtered' });
  if (o.heldPending) lim.push({ code: 'held_pending', lines: o.heldPending });
  if (!pos) lim.push({ code: 'f_no_position' });
  else {
    if (!prev.position) lim.push({ code: 'f_no_previous_snapshot' });
    if (pos.lag > 7 && pos.lag > (daysBetween(periods.current.from, periods.current.to) + 1) / 4) lim.push({ code: 'f_snapshot_lag', days: pos.lag });
    if (pos.multiSource) lim.push({ code: 'f_multi_source', count: 1 });
    if (pos.source === 'aging') lim.push({ code: 'f_source_aging' });
    if (pos.source === 'balance') lim.push({ code: 'f_source_balance' });
    if (pos.noDueLines) lim.push({ code: 'f_due_missing', count: pos.noDueLines });
    const unused = snaps.filter((s) => s.date === pos.asOf && s.kind !== pos.source).length;
    if (unused) lim.push({ code: 'f_unused_sources', count: unused });
  }
  if (universe.identicalDuplicates) lim.push({ code: 'f_duplicate_invoices', count: universe.identicalDuplicates });
  if (universe.conflicts) lim.push({ code: 'f_conflicting_invoices', count: universe.conflicts });
  if (matching.unreferenced) lim.push({ code: 'f_unreferenced_payments', count: matching.unreferenced });
  if (matching.notFound + matching.conflict) lim.push({ code: 'f_unmatched_payments', count: matching.notFound + matching.conflict });
  if (!base.covInvoice && !base.covPayment && !base.covCredit) lim.push({ code: 'f_no_registers' });
  if (kpis.some((k) => (k.id === 'f_dso' || k.id === 'f_dpo') && k.current !== null)) lim.push({ code: 'f_days_basis' });
  lim.push({ code: 'f_thresholds', soon: DUE_SOON_DAYS, long: LONG_OVERDUE_DAYS, dup: DUP_WINDOW_DAYS, min: MATCH_MIN });

  const explain: FinanceView['explain'] = {};
  for (const id of order) explain[id] = explainFinanceInputs(id, cur);
  const series: Series = { currency: o.series.currency, basis: o.series.basis } as Series;
  const regs = { invoice: base.covInvoice, payment: base.covPayment, credit_note: base.covCredit };
  return {
    side: o.side, series, bounds: { dateMin: sMin, dateMax: sMax }, periods, comparable, kpis, trend: [], aligned: { bucketDays: 1, points: [] }, tables: { [dim]: tbl },
    pareto: nCp >= 5 && tbl ? { dimension: dim, ...pareto(tbl.rows) } : null,
    waterfall: comparable && movers >= 2 && tbl ? { dimension: dim, data: waterfall(tbl) } : null,
    composition: tbl ? composition(tbl) : [], aging, overdueRank, overdueLines: allOverdueLines.slice(0, 50), overdueLinesTotal: allOverdueLines.length, overdueTrend, dueTimeline, behaviour: beh.slice(0, 15),
    credits, openCredits, duplicates, matching, overview,
    asOf: { current: pos?.asOf ?? null, previous: prev.position?.asOf ?? null, source: pos?.source ?? null },
    sources: { snapshots: snaps.map((s) => ({ kind: s.kind, date: s.date, lines: s.records.length })), registers: regs },
    keys: { overdue: [...new Set(allOverdueLines.map((l) => l.cp))].slice(0, 500) },
    charts, warnings: periods.warnings, limitations: lim, explain, thresholds: { soon: DUE_SOON_DAYS, long: LONG_OVERDUE_DAYS, dup: DUP_WINDOW_DAYS, min: MATCH_MIN },
    records, cur, prev, universe, pays, creditRows, dupAll,
  };
}
void norm;
