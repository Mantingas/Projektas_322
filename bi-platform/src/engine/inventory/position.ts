import type { InventoryRecord } from '../types';
import { daysBetween } from '../analytics/dates';
import { comparableUnit, type UnitPolicy } from '../purchasing/units';
import { productRef, warehouseRef } from './entities';

export type IdentityBasisLike = 'sku' | 'name';

export const VALUE_COVERAGE_MIN = 0.8;

/** The value of a line: the stated stock value, else quantity × unit cost, else unknown. NEVER estimated from other lines. */
export function lineValue(r: InventoryRecord): number | null {
  if (r.value !== undefined) return r.value;
  if (r.unitCost !== undefined && r.quantity !== undefined) return r.quantity * r.unitCost;
  return null;
}
/** The stated value and quantity × unit cost disagree by more than 2 % (or 0.02). The stated value is used and the conflict is reported. */
export function valueConflict(r: InventoryRecord): boolean {
  return r.value !== undefined && r.unitCost !== undefined && r.quantity !== undefined && Math.abs(r.value - r.quantity * r.unitCost) > Math.max(0.02, Math.abs(r.value) * 0.02);
}

export interface PosLine {
  rec: InventoryRecord;
  pk: string;
  label: string;
  identity: IdentityBasisLike;
  /** Group key for matching movements: product, plus the comparable unit when both files carry units. */
  gk: string;
  unit: string | undefined;
  /** Factor from the file's unit to the comparable unit (1 unless the metric policy converts g→kg etc.). */
  factor: number;
  wh: string;
  whLabel: string;
  category?: string;
  /** Quantity in the comparable unit; 0 when the line has no quantity. */
  qty: number;
  hasQty: boolean;
  value: number | null;
  conflict: boolean;
}

export interface LineCtx {
  policy: UnitPolicy;
  /** Units take part in matching snapshot lines with movement lines (both files carry units). */
  unitInKey: boolean;
}

export function toPosLine(rec: InventoryRecord, ctx: LineCtx): PosLine | null {
  const p = productRef(rec);
  if (!p) return null;
  const cu = comparableUnit(rec.unit, ctx.policy);
  const w = warehouseRef(rec);
  const hasQty = rec.quantity !== undefined;
  return {
    rec, pk: p.key, label: p.label, identity: p.identity, gk: ctx.unitInKey ? `${p.key}|${cu.unit ?? ''}` : p.key, unit: cu.unit, factor: cu.factor,
    wh: w?.key ?? '', whLabel: w?.label ?? '', category: rec.category, qty: hasQty ? rec.quantity! * cu.factor : 0, hasQty, value: lineValue(rec), conflict: valueConflict(rec),
  };
}

/** Snapshot lines indexed by warehouse and date; picks "the latest snapshot on or before D" for every warehouse. */
export class SnapIndex {
  /** warehouse key → sorted dates → lines */
  readonly byWh = new Map<string, { label: string; dates: string[]; lines: Map<string, InventoryRecord[]> }>();
  readonly allDates: string[];
  constructor(snaps: InventoryRecord[]) {
    const all = new Set<string>();
    for (const r of snaps) {
      const w = warehouseRef(r);
      const k = w?.key ?? '';
      let e = this.byWh.get(k);
      if (!e) this.byWh.set(k, (e = { label: w?.label ?? '', dates: [], lines: new Map() }));
      let l = e.lines.get(r.date);
      if (!l) { e.lines.set(r.date, (l = [])); e.dates.push(r.date); }
      l.push(r);
      all.add(r.date);
    }
    for (const e of this.byWh.values()) e.dates.sort();
    this.allDates = [...all].sort();
  }
  get empty() { return this.allDates.length === 0; }

  /** Per warehouse: the latest snapshot date ≤ D. */
  datesAt(d: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const [k, e] of this.byWh) {
      let lo = 0;
      let hi = e.dates.length - 1;
      let best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (e.dates[mid]! <= d) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (best >= 0) out.set(k, e.dates[best]!);
    }
    return out;
  }

  /** Σ line value of the position at D, plus how many lines were valued (for the trend chart). */
  valueAt(d: string): { value: number; lines: number; valued: number } {
    let value = 0;
    let lines = 0;
    let valued = 0;
    for (const [k, date] of this.datesAt(d)) {
      for (const r of this.byWh.get(k)!.lines.get(date)!) {
        if (r.quantity === 0) continue;
        lines++;
        const v = lineValue(r);
        if (v !== null) { value += v; valued++; }
      }
    }
    return { value, lines, valued };
  }
}

export interface Position {
  /** Requested date. */
  at: string;
  /** Latest snapshot date used / oldest snapshot date used. */
  newest: string;
  oldest: string;
  /** Days between the requested date and the OLDEST snapshot used (a stale warehouse snapshot makes the position stale). */
  lag: number;
  lines: PosLine[];
  /** Warehouse snapshots that came from more than one import (a duplicate or contradicting snapshot kept side by side). */
  multiSource: number;
  warehouses: Map<string, string>;
}

/** The stock position at date D, or null when no snapshot exists on or before D. */
export function positionAt(idx: SnapIndex, d: string, ctx: LineCtx): Position | null {
  const dates = idx.datesAt(d);
  if (dates.size === 0) return null;
  const lines: PosLine[] = [];
  let newest = '';
  let oldest = '9999-12-31';
  let multi = 0;
  for (const [k, date] of dates) {
    const recs = idx.byWh.get(k)!.lines.get(date)!;
    if (date > newest) newest = date;
    if (date < oldest) oldest = date;
    if (new Set(recs.map((r) => r.importId ?? '')).size > 1) multi++;
    for (const r of recs) {
      const l = toPosLine(r, ctx);
      if (l) lines.push(l);
    }
  }
  return { at: d, newest, oldest, lag: daysBetween(oldest, d), lines, multiSource: multi, warehouses: dates };
}

export interface ProductPos {
  pk: string;
  label: string;
  identity: IdentityBasisLike;
  category?: string;
  value: number;
  valued: number;
  lines: number;
  qtyByUnit: Map<string, number>;
}

export interface PosAgg {
  at: string;
  newest: string;
  oldest: string;
  lag: number;
  /** Lines with a non-zero quantity (or a value). */
  lines: number;
  valued: number;
  /** Book value of ALL valued lines (negative stock included – it is what the source says). */
  value: number;
  /** Σ of positive line values (shares / concentration are shares of this). */
  positiveValue: number;
  negativeLines: number;
  conflictLines: number;
  multiSource: number;
  byProduct: Map<string, ProductPos>;
  byWarehouse: Map<string, { label: string; value: number; lines: number }>;
  byCategory: Map<string, { label: string; value: number; lines: number }>;
  qtyByUnit: Map<string, number>;
  skus: number;
}

export function aggregatePosition(pos: Position): PosAgg {
  const a: PosAgg = {
    at: pos.at, newest: pos.newest, oldest: pos.oldest, lag: pos.lag, lines: 0, valued: 0, value: 0, positiveValue: 0, negativeLines: 0, conflictLines: 0, multiSource: pos.multiSource,
    byProduct: new Map(), byWarehouse: new Map(), byCategory: new Map(), qtyByUnit: new Map(), skus: 0,
  };
  const inStock = new Set<string>();
  for (const l of pos.lines) {
    if (l.hasQty && l.qty === 0 && l.value === null) continue;
    a.lines++;
    if (l.qty < 0) a.negativeLines++;
    if (l.conflict) a.conflictLines++;
    let p = a.byProduct.get(l.pk);
    if (!p) a.byProduct.set(l.pk, (p = { pk: l.pk, label: l.label, identity: l.identity, category: l.category, value: 0, valued: 0, lines: 0, qtyByUnit: new Map() }));
    p.lines++;
    if (l.hasQty) p.qtyByUnit.set(l.unit ?? '', (p.qtyByUnit.get(l.unit ?? '') ?? 0) + l.qty);
    if (l.hasQty) a.qtyByUnit.set(l.unit ?? '', (a.qtyByUnit.get(l.unit ?? '') ?? 0) + l.qty);
    if (l.qty > 0) inStock.add(l.pk);
    if (l.value !== null) {
      a.valued++;
      p.valued++;
      p.value += l.value;
      a.value += l.value;
      if (l.value > 0) a.positiveValue += l.value;
      const w = a.byWarehouse.get(l.wh) ?? { label: l.whLabel, value: 0, lines: 0 };
      w.value += l.value; w.lines++;
      a.byWarehouse.set(l.wh, w);
      if (l.category) {
        const ck = l.category.trim().toLowerCase().replace(/\s+/g, ' ');
        const c = a.byCategory.get(ck) ?? { label: l.category, value: 0, lines: 0 };
        c.value += l.value; c.lines++;
        a.byCategory.set(ck, c);
      }
    }
  }
  a.skus = inStock.size;
  return a;
}
