import type { InventoryRecord, MovementType } from '../types';
import { addDays, daysBetween } from '../analytics/dates';
import type { Range } from '../analytics/periods';
import { comparableUnit, type UnitPolicy } from '../purchasing/units';
import { productRef, warehouseRef } from './entities';
import { toPosLine, VALUE_COVERAGE_MIN, type LineCtx, type PosLine, type Position } from './position';

/** Thresholds, stated to the user in the dashboard. */
export const SLOW_COVER_DAYS = 180;
export const TARGET_COVER_DAYS = 90;
export const RISK_COVER_DAYS = 14;
export const HISTORY_WANT_DAYS = 180;
export const HISTORY_MIN_DAYS = 60;
export const UNKNOWN_TYPE_MAX = 0.2;

export interface MoveLine {
  rec: InventoryRecord;
  type: MovementType;
  pk: string | null;
  label: string;
  gk: string;
  wh: string;
  whTo: string;
  /** SIGNED change of stock in the comparable unit (+ in, − out). */
  qty: number;
  /** SIGNED value (same sign as qty), or null when neither a value nor a unit cost is given. */
  value: number | null;
  date: string;
}

export function toMoveLine(rec: InventoryRecord, ctx: LineCtx): MoveLine {
  const p = productRef(rec);
  const cu = comparableUnit(rec.unit, ctx.policy);
  const qty = (rec.quantity ?? 0) * cu.factor;
  let value: number | null = rec.value !== undefined ? rec.value : rec.unitCost !== undefined && rec.quantity !== undefined ? rec.quantity * rec.unitCost : null;
  // a value is as signed as its quantity (files often print it unsigned)
  if (value !== null && qty !== 0) value = (qty < 0 ? -1 : 1) * Math.abs(value);
  return {
    rec, type: rec.movementType ?? 'unknown', pk: p?.key ?? null, label: p?.label ?? '', gk: p ? (ctx.unitInKey ? `${p.key}|${cu.unit ?? ''}` : p.key) : '',
    wh: warehouseRef(rec)?.key ?? '', whTo: rec.warehouseTo ? rec.warehouseTo.trim().toLowerCase().replace(/\s+/g, ' ') : '', qty, value, date: rec.date,
  };
}

export interface MoveCoverage {
  min: string;
  max: string;
  lines: number;
  unknownShare: number;
}
export function moveCoverage(moves: MoveLine[]): MoveCoverage | null {
  if (moves.length === 0) return null;
  let min = moves[0]!.date;
  let max = min;
  let unknown = 0;
  for (const m of moves) { if (m.date < min) min = m.date; if (m.date > max) max = m.date; if (m.type === 'unknown') unknown++; }
  return { min, max, lines: moves.length, unknownShare: unknown / moves.length };
}

export type HistoryReason = 'no_movements' | 'short_history' | 'history_gap' | 'movement_types_unclear';
/** Is there enough movement history ending near `asOf` to talk about demand? No snapshot – however many – can answer that. */
export function historyFor(cov: MoveCoverage | null, asOf: string): { ok: true; from: string; days: number } | { ok: false; reason: HistoryReason } {
  if (!cov) return { ok: false, reason: 'no_movements' };
  if (cov.unknownShare > UNKNOWN_TYPE_MAX) return { ok: false, reason: 'movement_types_unclear' };
  const tol = 7;
  if (cov.max < addDays(asOf, -tol)) return { ok: false, reason: 'history_gap' };
  const available = daysBetween(cov.min, asOf) + 1;
  if (available < HISTORY_MIN_DAYS) return { ok: false, reason: 'short_history' };
  const days = Math.min(HISTORY_WANT_DAYS, available);
  return { ok: true, from: addDays(asOf, -(days - 1)), days };
}

export interface Demand {
  /** Net quantity that left stock for customers / consumption: issues + customer returns reversed. */
  net: number;
  /** Gross outflow events (issues) – any issue at all in the window. */
  issuedGross: number;
  receipts: number;
  lastIssue?: string;
  lastReceipt?: string;
  lines: number;
}

/** Demand and receipts per group key inside a window. Transfers, adjustments, opening balances and unknown lines are NOT demand. */
export function demandByGroup(moves: MoveLine[], w: Range): Map<string, Demand> {
  const m = new Map<string, Demand>();
  for (const l of moves) {
    if (!l.pk || l.date < w.from || l.date > w.to) continue;
    let d = m.get(l.gk);
    if (!d) m.set(l.gk, (d = { net: 0, issuedGross: 0, receipts: 0, lines: 0 }));
    if (l.type === 'issue') {
      d.net += -l.qty;
      if (l.qty < 0) { d.issuedGross += -l.qty; if (!d.lastIssue || l.date > d.lastIssue) d.lastIssue = l.date; }
      d.lines++;
    } else if (l.type === 'return') {
      if (l.qty > 0) d.net -= l.qty; // customer return: reverses an issue
      else d.receipts += l.qty; // supplier return: reverses a receipt
      d.lines++;
    } else if (l.type === 'receipt') {
      d.receipts += l.qty;
      if (l.qty > 0 && (!d.lastReceipt || l.date > d.lastReceipt)) d.lastReceipt = l.date;
      d.lines++;
    }
  }
  return m;
}

export interface FlowTotals {
  /** Net issue value (issues − customer returns), positive. */
  netIssueValue: number;
  /** Issue lines with a known value / all issue lines. */
  issueValueCoverage: number;
  issueLines: number;
  receiptValue: number;
  receiptLines: number;
  receiptValueCoverage: number;
  adjustmentValue: number;
  adjustmentLines: number;
  transferLines: number;
  unknownLines: number;
}

export function flowTotals(moves: MoveLine[], w: Range): FlowTotals {
  const t: FlowTotals = { netIssueValue: 0, issueValueCoverage: 0, issueLines: 0, receiptValue: 0, receiptLines: 0, receiptValueCoverage: 0, adjustmentValue: 0, adjustmentLines: 0, transferLines: 0, unknownLines: 0 };
  let issueKnown = 0;
  let recKnown = 0;
  for (const l of moves) {
    if (l.date < w.from || l.date > w.to) continue;
    switch (l.type) {
      case 'issue':
        t.issueLines++;
        if (l.value !== null) { issueKnown++; t.netIssueValue += -l.value; }
        break;
      case 'return':
        if (l.qty > 0) { t.issueLines++; if (l.value !== null) { issueKnown++; t.netIssueValue -= l.value; } }
        else { t.receiptLines++; if (l.value !== null) { recKnown++; t.receiptValue += l.value; } }
        break;
      case 'receipt':
        t.receiptLines++;
        if (l.value !== null) { recKnown++; t.receiptValue += l.value; }
        break;
      case 'adjustment': t.adjustmentLines++; if (l.value !== null) t.adjustmentValue += l.value; break;
      case 'transfer': t.transferLines++; break;
      case 'unknown': t.unknownLines++; break;
      default: break;
    }
  }
  t.issueValueCoverage = t.issueLines ? issueKnown / t.issueLines : 0;
  t.receiptValueCoverage = t.receiptLines ? recKnown / t.receiptLines : 0;
  return t;
}

/** The window is covered by movement data (starts and ends near the movement file's span). */
export function windowCovered(cov: MoveCoverage | null, w: Range): boolean {
  if (!cov) return false;
  const days = daysBetween(w.from, w.to) + 1;
  const tol = Math.max(3, Math.ceil(days * 0.1));
  return cov.min <= addDays(w.from, tol) && cov.max >= addDays(w.to, -tol);
}

// ───────── item status: slow-moving, non-moving, excess, stockout risk ─────────
export type ItemState = 'non_moving' | 'slow' | 'ok' | 'new_stock' | 'unmatched' | 'ambiguous';

export interface ItemStatus {
  gk: string;
  pk: string;
  label: string;
  identity: 'sku' | 'name';
  unit?: string;
  category?: string;
  stockQty: number;
  stockValue: number | null;
  unitValue: number | null;
  demand: number;
  perDay: number;
  coverDays: number | null;
  lastIssue?: string;
  lastReceipt?: string;
  state: ItemState;
  excessQty: number;
  excessValue: number | null;
  warehouses: string[];
}

export type RiskReason = 'out_of_stock' | 'below_min' | 'low_cover';
export interface RiskRow {
  gk: string;
  pk: string;
  label: string;
  identity: 'sku' | 'name';
  unit?: string;
  warehouse?: string;
  qty: number;
  minStock?: number;
  perDay?: number;
  coverDays?: number;
  reason: RiskReason;
}

export interface StatusResult {
  items: ItemStatus[];
  /** Stock lines whose product never appears in the movement file (identifiers may differ – not classified). */
  unmatched: number;
  ambiguous: number;
  history: { from: string; days: number };
}

export function classifyItems(pos: Position, moves: MoveLine[], hist: { from: string; days: number }, asOf: string, ambiguous: Set<string>): StatusResult {
  const w: Range = { from: hist.from, to: asOf };
  const dem = demandByGroup(moves, w);
  const everSeen = new Set<string>();
  const lastEver = new Map<string, string>();
  for (const l of moves) {
    if (!l.pk || l.date > asOf) continue;
    if (l.type === 'issue' || l.type === 'receipt' || l.type === 'return') { everSeen.add(l.gk); if (!lastEver.has(l.gk) || l.date > lastEver.get(l.gk)!) lastEver.set(l.gk, l.date); }
  }
  const groups = new Map<string, { lines: PosLine[] }>();
  for (const l of pos.lines) {
    if (!l.hasQty) continue;
    (groups.get(l.gk) ?? groups.set(l.gk, { lines: [] }).get(l.gk)!).lines.push(l);
  }
  const items: ItemStatus[] = [];
  let unmatched = 0;
  let amb = 0;
  for (const [gk, g] of groups) {
    const first = g.lines[0]!;
    const stockQty = g.lines.reduce((s, l) => s + l.qty, 0);
    const valued = g.lines.filter((l) => l.value !== null);
    const stockValue = valued.length === g.lines.length ? valued.reduce((s, l) => s + l.value!, 0) : null;
    const unitValue = stockValue !== null && stockQty > 0 ? stockValue / stockQty : null;
    const d = dem.get(gk);
    const base: ItemStatus = {
      gk, pk: first.pk, label: first.label, identity: first.identity, unit: first.unit, category: first.category, stockQty, stockValue, unitValue,
      demand: 0, perDay: 0, coverDays: null, state: 'ok', excessQty: 0, excessValue: null, warehouses: [...new Set(g.lines.map((l) => l.whLabel).filter(Boolean))],
    };
    if (ambiguous.has(first.pk)) { amb++; items.push({ ...base, state: 'ambiguous' }); continue; }
    if (!everSeen.has(gk)) { if (stockQty > 0) unmatched++; items.push({ ...base, state: 'unmatched' }); continue; }
    const demand = Math.max(0, d?.net ?? 0);
    const perDay = demand / hist.days;
    const it: ItemStatus = { ...base, demand, perDay, lastIssue: d?.lastIssue, lastReceipt: d?.lastReceipt ?? undefined };
    if (stockQty > 0) {
      const issued = d?.issuedGross ?? 0;
      const received = (d?.receipts ?? 0) > 0;
      if (issued === 0 && demand === 0) it.state = received ? 'new_stock' : 'non_moving';
      else if (perDay > 0) {
        it.coverDays = stockQty / perDay;
        if (it.coverDays > SLOW_COVER_DAYS) it.state = 'slow';
        const keep = TARGET_COVER_DAYS * perDay;
        it.excessQty = Math.max(0, stockQty - keep);
        it.excessValue = unitValue !== null ? it.excessQty * unitValue : null;
      }
      if (it.state === 'non_moving') { it.excessQty = stockQty; it.excessValue = stockValue; it.lastIssue = lastEver.get(gk); }
    }
    items.push(it);
  }
  return { items, unmatched, ambiguous: amb, history: hist };
}

export interface RiskResult {
  rows: RiskRow[];
  /** below-minimum checks ran / cover-based checks ran */
  usedMin: boolean;
  usedHistory: boolean;
}

export function stockoutRisks(pos: Position, status: StatusResult | null): RiskResult {
  const rows: RiskRow[] = [];
  let usedMin = false;
  const seen = new Set<string>();
  for (const l of pos.lines) {
    const min = l.rec.minStock !== undefined ? l.rec.minStock * l.factor : undefined;
    if (min === undefined || min <= 0 || !l.hasQty) continue;
    usedMin = true;
    if (l.qty < min) {
      rows.push({ gk: l.gk, pk: l.pk, label: l.label, identity: l.identity, unit: l.unit, warehouse: l.whLabel || undefined, qty: l.qty, minStock: min, reason: l.qty <= 0 ? 'out_of_stock' : 'below_min' });
      seen.add(l.gk);
    }
  }
  if (status) {
    for (const it of status.items) {
      if (it.state === 'ambiguous' || it.state === 'unmatched' || it.perDay <= 0) continue;
      if (it.stockQty <= 0) { if (!seen.has(it.gk)) rows.push({ gk: it.gk, pk: it.pk, label: it.label, identity: it.identity, unit: it.unit, qty: it.stockQty, perDay: it.perDay, reason: 'out_of_stock' }); continue; }
      const cover = it.stockQty / it.perDay;
      if (cover < RISK_COVER_DAYS && !seen.has(it.gk)) rows.push({ gk: it.gk, pk: it.pk, label: it.label, identity: it.identity, unit: it.unit, qty: it.stockQty, perDay: it.perDay, coverDays: cover, reason: 'low_cover' });
    }
  }
  const rank = { out_of_stock: 0, below_min: 1, low_cover: 2 } as const;
  rows.sort((a, b) => rank[a.reason] - rank[b.reason] || (a.coverDays ?? 1e9) - (b.coverDays ?? 1e9) || a.label.localeCompare(b.label));
  return { rows, usedMin, usedHistory: status !== null };
}

// ───────── transfers and reconciliation ─────────
export interface TransferCheck {
  documents: number;
  unbalanced: { doc: string; product: string; net: number }[];
}
/** Transfers must leave company stock unchanged: per document and product the signed quantities of all legs add up to zero. Single-line transfers (with a destination) balance by construction. */
export function transferCheck(moves: MoveLine[], w?: Range): TransferCheck {
  const docs = new Map<string, { product: string; net: number }>();
  const names = new Set<string>();
  for (const l of moves) {
    if (l.type !== 'transfer' || !l.pk) continue;
    if (w && (l.date < w.from || l.date > w.to)) continue;
    if (l.whTo) { names.add(l.rec.documentId ?? l.rec.key); continue; }
    const k = `${l.rec.documentId ?? l.rec.key}|${l.gk}`;
    const e = docs.get(k) ?? { product: l.label, net: 0 };
    e.net += l.qty;
    docs.set(k, e);
    names.add(l.rec.documentId ?? l.rec.key);
  }
  const unbalanced = [...docs.entries()].filter(([, e]) => Math.abs(e.net) > 1e-9).map(([k, e]) => ({ doc: k.split('|')[0]!, product: e.product, net: e.net }));
  return { documents: names.size, unbalanced };
}

export interface ReconRow {
  gk: string;
  label: string;
  warehouse: string;
  opening: number;
  movements: number;
  expected: number;
  actual: number;
  diff: number;
  unitValue: number | null;
}

/**
 * Snapshot A + movements in (A, B] should equal snapshot B for the same warehouse and product. Only done where the movement file covers the interval,
 * only for products present in BOTH snapshots, and only with the movement types that change stock (transfers move stock between warehouses).
 */
export function reconcile(snaps: Map<string, { date: string; lines: PosLine[] }[]>, moves: MoveLine[], cov: MoveCoverage | null): ReconRow[] {
  if (!cov) return [];
  const out: ReconRow[] = [];
  for (const [wh, list] of snaps) {
    const s = [...list].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < s.length; i++) {
      const A = s[i - 1]!;
      const B = s[i]!;
      if (cov.min > addDays(A.date, 1) || cov.max < B.date) continue; // movement file does not cover the interval
      const delta = new Map<string, number>();
      for (const m of moves) {
        if (!m.pk || m.date <= A.date || m.date > B.date || m.type === 'opening') continue;
        if (m.type === 'transfer' && m.whTo) {
          if (m.wh === wh) delta.set(m.gk, (delta.get(m.gk) ?? 0) + m.qty); // leaves
          if (m.whTo === wh) delta.set(m.gk, (delta.get(m.gk) ?? 0) - m.qty); // arrives (qty is negative on the sending side)
          continue;
        }
        if (m.wh === wh) delta.set(m.gk, (delta.get(m.gk) ?? 0) + m.qty);
      }
      const a = new Map<string, PosLine>();
      for (const l of A.lines) if (l.hasQty) a.set(l.gk, l);
      for (const l of B.lines) {
        if (!l.hasQty) continue;
        const prev = a.get(l.gk);
        if (!prev) continue;
        const mv = delta.get(l.gk) ?? 0;
        const expected = prev.qty + mv;
        const diff = l.qty - expected;
        if (Math.abs(diff) > Math.max(1e-6, Math.abs(expected) * 1e-9)) {
          out.push({ gk: l.gk, label: l.label, warehouse: l.whLabel, opening: prev.qty, movements: mv, expected, actual: l.qty, diff, unitValue: l.value !== null && l.qty !== 0 ? l.value / l.qty : prev.value !== null && prev.qty !== 0 ? prev.value / prev.qty : null });
        }
      }
    }
  }
  return out;
}

export { toPosLine, VALUE_COVERAGE_MIN };
