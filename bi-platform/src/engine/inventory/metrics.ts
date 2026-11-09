import type { GenericMetric } from '../analytics/compare';
import type { InventoryRecord } from '../types';
import { addDays } from '../analytics/dates';
import type { Range } from '../analytics/periods';
import type { UnitPolicy } from '../purchasing/units';
import {
  classifyItems, demandByGroup, flowTotals, historyFor, stockoutRisks, windowCovered, UNKNOWN_TYPE_MAX,
  type HistoryReason, type MoveCoverage, type MoveLine, type RiskResult, type StatusResult,
} from './flows';
import { aggregatePosition, positionAt, VALUE_COVERAGE_MIN, type LineCtx, type Position, type PosAgg, type SnapIndex } from './position';

export type InventoryMetricId = 'i_value' | 'i_quantity' | 'i_skus' | 'i_concentration' | 'i_turnover' | 'i_doh' | 'i_slow' | 'i_nonmoving' | 'i_stockout';
export const INVENTORY_KPI_ORDER: InventoryMetricId[] = ['i_value', 'i_quantity', 'i_skus', 'i_concentration', 'i_turnover', 'i_doh', 'i_slow', 'i_nonmoving', 'i_stockout'];

export type InventoryUnavailable =
  | 'no_data' | 'no_snapshot' | 'cost_missing' | 'mixed_units' | 'unit_missing' | 'few_items'
  | HistoryReason | 'no_opening' | 'no_issue_values' | 'no_demand' | 'needs_history_or_min' | 'window_not_covered' | 'no_previous_snapshot';

export interface InventoryContext {
  policy: UnitPolicy;
  /** The snapshot file has a unit column. */
  hasUnitColumn: boolean;
}

export interface TurnoverEval {
  /** Net issue value ÷ average stock value over the window (not annualised). */
  turnover: number;
  /** Average stock value ÷ average daily net issue value; null when nothing was issued. */
  doh: number | null;
  avgValue: number;
  openValue: number;
  closeValue: number;
  issueValue: number;
  days: number;
}

/** Everything the metrics need about ONE window (and its closing date). Computed once, then read by the metric registry, tables, charts and insights. */
export interface WindowEval {
  window: Range;
  asOf: string;
  position: Position | null;
  pos: PosAgg | null;
  turnover: TurnoverEval | null;
  turnoverWhy?: InventoryUnavailable;
  status: StatusResult | null;
  statusWhy?: InventoryUnavailable;
  risk: RiskResult | null;
  riskWhy?: InventoryUnavailable;
}

export interface EvalInput {
  idx: SnapIndex;
  moves: MoveLine[];
  /** Coverage of the WHOLE movement file of the series (filters must not change what counts as "enough history"). */
  cov: MoveCoverage | null;
  ambiguous: Set<string>;
  lineCtx: LineCtx;
  /** Signature (`posSig`) of the CURRENT position: a previous position built from the very same snapshots is dropped (a previous period needs its own snapshot). */
  sameAs?: string;
}

/** Which snapshot (per warehouse) a position is made of. */
export const posSig = (p: Position | null): string => (p ? JSON.stringify([...p.warehouses.entries()].sort()) : '');

const valuedOk = (p: PosAgg) => p.lines > 0 && p.valued / p.lines >= VALUE_COVERAGE_MIN;

export function evaluateWindow(inp: EvalInput, window: Range): WindowEval {
  const { idx, moves, cov, ambiguous, lineCtx } = inp;
  let position = positionAt(idx, window.to, lineCtx);
  if (position && inp.sameAs !== undefined && posSig(position) === inp.sameAs) position = null;
  const pos = position ? aggregatePosition(position) : null;
  const ev: WindowEval = { window, asOf: window.to, position, pos, turnover: null, status: null, risk: null };
  if (!position || !pos) {
    ev.turnoverWhy = 'no_snapshot'; ev.statusWhy = 'no_snapshot'; ev.riskWhy = 'no_snapshot';
    return ev;
  }

  // ── turnover and days on hand: two valued snapshots, movements covering the window, issue values ──
  const opening = positionAt(idx, addDays(window.from, -1), lineCtx);
  const open = opening ? aggregatePosition(opening) : null;
  if (!open || opening!.newest >= position.oldest) ev.turnoverWhy = 'no_opening';
  else if (!cov) ev.turnoverWhy = 'no_movements';
  else if (cov.unknownShare > UNKNOWN_TYPE_MAX) ev.turnoverWhy = 'movement_types_unclear';
  else if (!windowCovered(cov, window)) ev.turnoverWhy = 'window_not_covered';
  else if (!valuedOk(pos) || !valuedOk(open)) ev.turnoverWhy = 'cost_missing';
  else {
    const f = flowTotals(moves, window);
    if (f.issueLines > 0 && f.issueValueCoverage < VALUE_COVERAGE_MIN) ev.turnoverWhy = 'no_issue_values';
    else {
      const days = Math.round((Date.parse(window.to) - Date.parse(window.from)) / 86400000) + 1;
      const avg = (open.value + pos.value) / 2;
      if (avg <= 0) ev.turnoverWhy = 'no_data';
      else {
        ev.turnover = { turnover: f.netIssueValue / avg, doh: f.netIssueValue > 0 ? avg / (f.netIssueValue / days) : null, avgValue: avg, openValue: open.value, closeValue: pos.value, issueValue: f.netIssueValue, days };
      }
    }
  }

  // ── slow / non-moving / excess: movement history before the closing date ──
  const hist = historyFor(cov, window.to);
  if (!hist.ok) ev.statusWhy = hist.reason;
  else ev.status = classifyItems(position, moves, hist, window.to, ambiguous);

  // ── stockout risk: minimum stock levels (snapshot only) and/or cover from demand history ──
  const risk = stockoutRisks(position, ev.status);
  if (!risk.usedMin && !risk.usedHistory) ev.riskWhy = 'needs_history_or_min';
  else ev.risk = risk;
  return ev;
}

const ok = (value: number) => ({ value });
const no = (unavailable: InventoryUnavailable) => ({ value: null as number | null, unavailable });

/** The inventory metric registry: pure functions of a WindowEval, compared with the same engine as sales and purchasing (compareWith). */
export const INVENTORY_METRICS: Record<InventoryMetricId, GenericMetric<WindowEval, InventoryContext>> = {
  i_value: {
    id: 'i_value', unit: 'money', higherIsBetter: false, neutral: true,
    evaluate: (a) => (!a.pos ? no('no_snapshot') : a.pos.lines === 0 ? no('no_data') : !valuedOk(a.pos) ? no('cost_missing') : ok(a.pos.value)),
  },
  i_quantity: {
    id: 'i_quantity', unit: 'qty', higherIsBetter: false, neutral: true,
    evaluate: (a, ctx) => {
      if (!a.pos || a.pos.lines === 0) return no(a.pos ? 'no_data' : 'no_snapshot');
      const units = [...a.pos.qtyByUnit.keys()];
      if (units.length === 0) return no('no_data');
      if (ctx.hasUnitColumn && units.includes('')) return no('unit_missing');
      if (units.length !== 1) return no('mixed_units'); // kg + pcs + boxes is not a quantity
      return ok(a.pos.qtyByUnit.get(units[0]!)!);
    },
  },
  i_skus: { id: 'i_skus', unit: 'count', higherIsBetter: false, neutral: true, evaluate: (a) => (!a.pos ? no('no_snapshot') : ok(a.pos.skus)) },
  i_concentration: {
    id: 'i_concentration', unit: 'pct', higherIsBetter: false,
    evaluate: (a) => {
      if (!a.pos) return no('no_snapshot');
      if (!valuedOk(a.pos)) return no('cost_missing');
      const vals = [...a.pos.byProduct.values()].map((p) => p.value).filter((v) => v > 0);
      if (vals.length < 3 || a.pos.positiveValue <= 0) return no('few_items');
      return ok(Math.max(...vals) / a.pos.positiveValue);
    },
  },
  i_turnover: { id: 'i_turnover', unit: 'qty', higherIsBetter: true, evaluate: (a) => (a.turnover ? ok(a.turnover.turnover) : no(a.turnoverWhy ?? 'no_data')) },
  i_doh: { id: 'i_doh', unit: 'qty', higherIsBetter: false, evaluate: (a) => (a.turnover ? (a.turnover.doh !== null ? ok(a.turnover.doh) : no('no_demand')) : no(a.turnoverWhy ?? 'no_data')) },
  i_slow: {
    id: 'i_slow', unit: 'money', higherIsBetter: false,
    evaluate: (a) => (!a.status ? no(a.statusWhy ?? 'no_data') : !a.pos || !valuedOk(a.pos) ? no('cost_missing') : ok(a.status.items.filter((i) => i.state === 'slow').reduce((s, i) => s + (i.stockValue ?? 0), 0))),
  },
  i_nonmoving: {
    id: 'i_nonmoving', unit: 'money', higherIsBetter: false,
    evaluate: (a) => (!a.status ? no(a.statusWhy ?? 'no_data') : !a.pos || !valuedOk(a.pos) ? no('cost_missing') : ok(a.status.items.filter((i) => i.state === 'non_moving').reduce((s, i) => s + (i.stockValue ?? 0), 0))),
  },
  i_stockout: { id: 'i_stockout', unit: 'count', higherIsBetter: false, evaluate: (a) => (a.risk ? ok(new Set(a.risk.rows.map((r) => r.gk)).size) : no(a.riskWhy ?? 'needs_history_or_min')) },
};

/** Numbers behind "How is this calculated?". Keys ending in "Value" are rendered as money by the UI. */
export function explainInventoryInputs(id: InventoryMetricId, a: WindowEval): Record<string, number> {
  const p = a.pos;
  switch (id) {
    case 'i_value': return { lines: p?.lines ?? 0, valued: p?.valued ?? 0, negative: p?.negativeLines ?? 0, warehouses: p?.byWarehouse.size ?? 0 };
    case 'i_quantity': return { lines: p?.lines ?? 0, units: p?.qtyByUnit.size ?? 0 };
    case 'i_skus': return { lines: p?.lines ?? 0 };
    case 'i_concentration': return { products: [...(p?.byProduct.values() ?? [])].filter((x) => x.value > 0).length };
    case 'i_turnover': return { issueValue: a.turnover?.issueValue ?? 0, avgValue: a.turnover?.avgValue ?? 0, openValue: a.turnover?.openValue ?? 0, closeValue: a.turnover?.closeValue ?? 0, days: a.turnover?.days ?? 0 };
    case 'i_doh': return { avgValue: a.turnover?.avgValue ?? 0, issueValue: a.turnover?.issueValue ?? 0, days: a.turnover?.days ?? 0 };
    case 'i_slow': return { days: a.status?.history.days ?? 0, items: a.status?.items.filter((i) => i.state === 'slow').length ?? 0 };
    case 'i_nonmoving': return { days: a.status?.history.days ?? 0, items: a.status?.items.filter((i) => i.state === 'non_moving').length ?? 0 };
    case 'i_stockout': return { items: new Set(a.risk?.rows.map((r) => r.gk)).size, days: a.status?.history.days ?? 0 };
  }
}

/** Which metrics a freshly normalised file can support (import diagnostics) – judged from the file alone. */
export function predictInventoryMetrics(records: InventoryRecord[]): { id: string; available: boolean; reason?: string }[] {
  const snaps = records.filter((r) => r.kind === 'snapshot');
  const moves = records.filter((r) => r.kind === 'movement');
  const hasCost = snaps.some((r) => r.value !== undefined || r.unitCost !== undefined);
  const hasMin = snaps.some((r) => r.minStock !== undefined);
  const dates = new Set(snaps.map((r) => r.date)).size;
  const typed = moves.length > 0 && moves.filter((r) => r.movementType === 'unknown').length / moves.length <= UNKNOWN_TYPE_MAX;
  const hasUnit = snaps.some((r) => r.unit !== undefined);
  const day = (d: string) => Date.parse(d) / 86400000;
  const span = moves.length ? day(moves.reduce((m, r) => (r.date > m ? r.date : m), moves[0]!.date)) - day(moves.reduce((m, r) => (r.date < m ? r.date : m), moves[0]!.date)) + 1 : 0;
  const hist = typed && span >= 60;
  const snapOnly = (id: string, okay: boolean, reason: string) => ({ id, available: snaps.length > 0 && okay, reason: snaps.length === 0 ? 'no_snapshot' : okay ? undefined : reason });
  return [
    snapOnly('i_value', hasCost, 'cost_missing'),
    snapOnly('i_quantity', hasUnit || snaps.length > 0, 'no_data'),
    snapOnly('i_skus', true, 'no_data'),
    snapOnly('i_concentration', hasCost, 'cost_missing'),
    { id: 'i_turnover', available: snaps.length > 0 && dates >= 2 && hist && hasCost, reason: snaps.length === 0 ? 'no_snapshot' : dates < 2 ? 'no_opening' : moves.length === 0 ? 'no_movements' : !typed ? 'movement_types_unclear' : span < 60 ? 'short_history' : 'cost_missing' },
    { id: 'i_doh', available: snaps.length > 0 && dates >= 2 && hist && hasCost, reason: snaps.length === 0 ? 'no_snapshot' : dates < 2 ? 'no_opening' : moves.length === 0 ? 'no_movements' : !typed ? 'movement_types_unclear' : span < 60 ? 'short_history' : 'cost_missing' },
    { id: 'i_slow', available: snaps.length > 0 && hist && hasCost, reason: snaps.length === 0 ? 'no_snapshot' : moves.length === 0 ? 'no_movements' : !typed ? 'movement_types_unclear' : span < 60 ? 'short_history' : 'cost_missing' },
    { id: 'i_nonmoving', available: snaps.length > 0 && hist && hasCost, reason: snaps.length === 0 ? 'no_snapshot' : moves.length === 0 ? 'no_movements' : !typed ? 'movement_types_unclear' : span < 60 ? 'short_history' : 'cost_missing' },
    { id: 'i_stockout', available: snaps.length > 0 && (hasMin || hist), reason: snaps.length === 0 ? 'no_snapshot' : 'needs_history_or_min' },
  ];
}

export { demandByGroup };
