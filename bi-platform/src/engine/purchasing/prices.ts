import type { PurchaseRecord } from '../types';
import { addDays, monthStart, weekStart } from '../analytics/dates';
import { autoGranularity, type Granularity } from '../analytics/compare';
import { lengthDays } from '../analytics/dates';
import type { Range, ResolvedPeriods } from '../analytics/periods';
import { ambiguousCodes, productRef, supplierRef, type IdentityBasis } from './entities';
import { comparableUnit, type UnitPolicy } from './units';

/** A purchase line that can be used as price evidence: positive amount AND quantity, an identified product, a known unit. */
export interface PriceLine {
  gk: string; // comparable group = product key + unit
  pk: string;
  unit: string;
  supplier: string; // '' when the line has no supplier
  supplierLabel: string;
  productLabel: string;
  identity: IdentityBasis;
  date: string;
  qty: number; // in the comparison unit
  amount: number;
  documentId?: string;
  key: string;
}

export interface ExcludedCounts {
  ambiguousCode: number;
  noUnit: number;
  noProduct: number;
  noQuantity: number;
  credit: number;
}

export interface PriceOptions {
  policy: UnitPolicy;
  /** The file has a unit column. Without one every line is in the "unspecified" unit and the report says so. */
  hasUnitColumn: boolean;
}

export function toPriceLines(records: PurchaseRecord[], o: PriceOptions): { lines: PriceLine[]; excluded: ExcludedCounts; ambiguous: Map<string, string[]> } {
  const ambiguous = ambiguousCodes(records);
  const excluded: ExcludedCounts = { ambiguousCode: 0, noUnit: 0, noProduct: 0, noQuantity: 0, credit: 0 };
  const lines: PriceLine[] = [];
  for (const r of records) {
    if (r.amount <= 0) { if (r.amount < 0) excluded.credit++; continue; }
    if (r.quantity === undefined || r.quantity <= 0) { excluded.noQuantity++; continue; }
    const p = productRef(r);
    if (!p) { excluded.noProduct++; continue; }
    if (p.identity === 'sku' && ambiguous.has(p.key)) { excluded.ambiguousCode++; continue; }
    if (o.hasUnitColumn && !r.unit) { excluded.noUnit++; continue; }
    const c = comparableUnit(r.unit, o.policy);
    const unit = c.unit ?? '';
    const s = supplierRef(r);
    lines.push({
      gk: `${p.key}|${unit}`, pk: p.key, unit, supplier: s?.key ?? '', supplierLabel: s?.label ?? '', productLabel: p.label, identity: p.identity, date: r.date,
      qty: r.quantity * c.factor, amount: r.amount, documentId: r.documentId, key: r.key,
    });
  }
  return { lines, excluded, ambiguous };
}

interface AQ { A: number; Q: number; lines: number }
const price = (x: AQ | undefined) => (x && x.Q > 0 ? x.A / x.Q : null);
const addTo = (m: Map<string, AQ>, k: string, l: PriceLine) => {
  const e = m.get(k) ?? { A: 0, Q: 0, lines: 0 };
  e.A += l.amount; e.Q += l.qty; e.lines++;
  m.set(k, e);
};

export interface GroupRow {
  gk: string;
  pk: string;
  label: string;
  unit: string;
  identity: IdentityBasis;
  cur: AQ & { price: number | null };
  prev: AQ & { price: number | null };
  kind: 'both' | 'new' | 'lost';
  priceChangePct: number | null;
  /** (P1 − P0) × Q1 – split into like-for-like supplier price and supplier mix */
  priceEffect: number;
  lflEffect: number;
  mixEffect: number;
  volumeEffect: number;
  suppliersCur: number;
}

export interface PairRow {
  gk: string;
  pk: string;
  label: string;
  unit: string;
  identity: IdentityBasis;
  supplier: string;
  supplierLabel: string;
  p0: number;
  p1: number;
  q0: number;
  q1: number;
  l0: number;
  l1: number;
  changePct: number;
  /** (p1 − p0) × q1: what the current quantity cost more (negative = cost less) than at the previous period's price from the SAME supplier. */
  effect: number;
}

export interface Bridge {
  total: number;
  /** like-for-like price change of the same item from the same supplier */
  price: number;
  /** price change caused by buying the same item from a different supplier mix */
  supplierMix: number;
  volume: number;
  newItems: number;
  lostItems: number;
  /** change in credit notes / returns (signed: more credits = negative) */
  credits: number;
  /** purchases that cannot be decomposed (no quantity, unit or product, ambiguous code) */
  unassigned: number;
}

export interface VarianceRow {
  gk: string;
  pk: string;
  label: string;
  unit: string;
  identity: IdentityBasis;
  suppliers: { supplier: string; label: string; price: number; qty: number; lines: number }[];
  min: number;
  max: number;
  spreadPct: number;
  qty: number;
  /** Σ over the non-cheapest suppliers of (their price − cheapest price) × their quantity. A POTENTIAL saving: it assumes the cheapest supplier can supply that quantity on those terms. */
  potentialSavings: number;
}

export interface HistoricalPriceRow {
  gk: string;
  pk: string;
  label: string;
  unit: string;
  identity: IdentityBasis;
  currentPrice: number;
  minMonthlyPrice: number;
  minMonth: string;
  months: number;
  qty: number;
  /** (current − lowest earlier monthly price) × current quantity. HYPOTHETICAL: nothing shows that price is available now. */
  hypothetical: number;
}

export interface PriceAnalysis {
  excluded: ExcludedCounts;
  ambiguous: Map<string, string[]>;
  groups: GroupRow[];
  pairs: PairRow[];
  bridge: Bridge;
  variance: VarianceRow[];
  historical: HistoricalPriceRow[];
  /** Products bought in more than one comparison unit in the loaded data (their prices are never compared across units). */
  unitMismatch: { pk: string; label: string; units: string[] }[];
  /** Like-for-like price change over comparable item/supplier pairs, and how much of the spend they cover. */
  lfl: { pct: number; extra: number; pairs: number; coverage: number } | null;
}

function totals(rs: PurchaseRecord[]) {
  let spend = 0;
  let credits = 0;
  for (const r of rs) {
    spend += r.amount;
    if (r.amount < 0) credits += r.amount;
  }
  return { spend, credits };
}

/**
 * Price and cost analysis between the two comparison periods. Nothing is converted or assumed:
 * prices are compared only for the same product identity, the same comparison unit, and (for like-for-like) the same supplier.
 * Everything that cannot be compared goes to `unassigned`, so the bridge always adds up exactly.
 */
export function analyzePrices(records: PurchaseRecord[], periods: ResolvedPeriods, o: PriceOptions): PriceAnalysis {
  const { lines, excluded, ambiguous } = toPriceLines(records, o);
  const inR = (d: string, r: Range) => d >= r.from && d <= r.to;
  const cur = new Map<string, AQ>();
  const prev = new Map<string, AQ>();
  const curS = new Map<string, AQ>(); // key: gk\u0000supplier
  const prevS = new Map<string, AQ>();
  const meta = new Map<string, PriceLine>();
  for (const l of lines) {
    const c = inR(l.date, periods.current);
    const p = inR(l.date, periods.previous);
    if (!c && !p) continue;
    if (!meta.has(l.gk)) meta.set(l.gk, l);
    if (c) { addTo(cur, l.gk, l); if (l.supplier) addTo(curS, `${l.gk}\u0000${l.supplier}`, l); }
    if (p) { addTo(prev, l.gk, l); if (l.supplier) addTo(prevS, `${l.gk}\u0000${l.supplier}`, l); }
  }
  const supplierLabel = new Map<string, string>();
  for (const l of lines) if (l.supplier) supplierLabel.set(l.supplier, l.supplierLabel);

  const pairs: PairRow[] = [];
  const lflByGroup = new Map<string, number>();
  for (const [k, c] of curS) {
    const pv = prevS.get(k);
    if (!pv || c.Q <= 0 || pv.Q <= 0) continue;
    const [gk, supplier] = k.split('\u0000') as [string, string];
    const m = meta.get(gk)!;
    const p1 = c.A / c.Q;
    const p0 = pv.A / pv.Q;
    const effect = (p1 - p0) * c.Q;
    lflByGroup.set(gk, (lflByGroup.get(gk) ?? 0) + effect);
    pairs.push({ gk, pk: m.pk, label: m.productLabel, unit: m.unit, identity: m.identity, supplier, supplierLabel: supplierLabel.get(supplier) ?? supplier, p0, p1, q0: pv.Q, q1: c.Q, l0: pv.lines, l1: c.lines, changePct: p0 > 0 ? (p1 - p0) / p0 : 0, effect });
  }

  const supCount = new Map<string, number>();
  for (const k of curS.keys()) { const g = k.slice(0, k.indexOf('\u0000')); supCount.set(g, (supCount.get(g) ?? 0) + 1); }
  const groups: GroupRow[] = [];
  const bridge: Bridge = { total: 0, price: 0, supplierMix: 0, volume: 0, newItems: 0, lostItems: 0, credits: 0, unassigned: 0 };
  let comparableDelta = 0;
  for (const gk of new Set([...cur.keys(), ...prev.keys()])) {
    const c = cur.get(gk);
    const p = prev.get(gk);
    const m = meta.get(gk)!;
    const A1 = c?.A ?? 0, Q1 = c?.Q ?? 0, A0 = p?.A ?? 0, Q0 = p?.Q ?? 0;
    const both = Q1 > 0 && Q0 > 0;
    const P1 = Q1 > 0 ? A1 / Q1 : null;
    const P0 = Q0 > 0 ? A0 / Q0 : null;
    const priceEffect = both ? (P1! - P0!) * Q1 : 0;
    const volumeEffect = both ? (Q1 - Q0) * P0! : 0;
    const lfl = both ? (lflByGroup.get(gk) ?? 0) : 0;
    const row: GroupRow = {
      gk, pk: m.pk, label: m.productLabel, unit: m.unit, identity: m.identity,
      cur: { A: A1, Q: Q1, lines: c?.lines ?? 0, price: P1 }, prev: { A: A0, Q: Q0, lines: p?.lines ?? 0, price: P0 },
      kind: both ? 'both' : Q1 > 0 ? 'new' : 'lost', priceChangePct: both && P0! > 0 ? (P1! - P0!) / P0! : null,
      priceEffect, lflEffect: lfl, mixEffect: priceEffect - lfl, volumeEffect,
      suppliersCur: supCount.get(gk) ?? 0,
    };
    groups.push(row);
    comparableDelta += A1 - A0;
    if (both) { bridge.price += lfl; bridge.supplierMix += priceEffect - lfl; bridge.volume += volumeEffect; }
    else if (Q1 > 0) bridge.newItems += A1;
    else bridge.lostItems += -A0;
  }
  const tc = totals(records.filter((r) => inR(r.date, periods.current)));
  const tp = totals(records.filter((r) => inR(r.date, periods.previous)));
  bridge.total = tc.spend - tp.spend;
  bridge.credits = tc.credits - tp.credits;
  bridge.unassigned = bridge.total - comparableDelta - bridge.credits; // exact by construction

  // price variance across suppliers (current period only: prices actually paid in the same period)
  const variance: VarianceRow[] = [];
  const byGroup = new Map<string, VarianceRow['suppliers']>();
  for (const [k, c] of curS) {
    if (c.Q <= 0) continue;
    const [gk, supplier] = k.split('\u0000') as [string, string];
    (byGroup.get(gk) ?? byGroup.set(gk, []).get(gk)!).push({ supplier, label: supplierLabel.get(supplier) ?? supplier, price: c.A / c.Q, qty: c.Q, lines: c.lines });
  }
  for (const [gk, sup] of byGroup) {
    if (sup.length < 2) continue;
    sup.sort((a, b) => a.price - b.price);
    const min = sup[0]!.price;
    const max = sup[sup.length - 1]!.price;
    const m = meta.get(gk)!;
    variance.push({
      gk, pk: m.pk, label: m.productLabel, unit: m.unit, identity: m.identity, suppliers: sup, min, max, spreadPct: min > 0 ? (max - min) / min : 0,
      qty: sup.reduce((s, x) => s + x.qty, 0), potentialSavings: sup.slice(1).reduce((s, x) => s + (x.price - min) * x.qty, 0),
    });
  }
  variance.sort((a, b) => b.potentialSavings - a.potentialSavings);

  // hypothetical: lowest EARLIER monthly price per item
  const historical: HistoricalPriceRow[] = [];
  const monthly = new Map<string, Map<string, AQ>>();
  for (const l of lines) {
    if (l.date >= periods.current.from) continue;
    const mo = l.date.slice(0, 7);
    const gm = monthly.get(l.gk) ?? monthly.set(l.gk, new Map()).get(l.gk)!;
    addTo(gm, mo, l);
  }
  for (const [gk, c] of cur) {
    const hm = monthly.get(gk);
    if (!hm || c.Q <= 0) continue;
    let min = Infinity;
    let minMonth = '';
    for (const [mo, aq] of hm) {
      const pr = price(aq);
      if (pr !== null && pr < min) { min = pr; minMonth = mo; }
    }
    const cp = c.A / c.Q;
    if (!Number.isFinite(min) || cp <= min) continue;
    const m = meta.get(gk)!;
    historical.push({ gk, pk: m.pk, label: m.productLabel, unit: m.unit, identity: m.identity, currentPrice: cp, minMonthlyPrice: min, minMonth, months: hm.size, qty: c.Q, hypothetical: (cp - min) * c.Q });
  }
  historical.sort((a, b) => b.hypothetical - a.hypothetical);

  // products bought in more than one comparison unit
  const unitsByProduct = new Map<string, { label: string; units: Set<string> }>();
  for (const l of lines) {
    const e = unitsByProduct.get(l.pk) ?? { label: l.productLabel, units: new Set<string>() };
    e.units.add(l.unit);
    unitsByProduct.set(l.pk, e);
  }
  const unitMismatch = [...unitsByProduct.entries()].filter(([, e]) => e.units.size > 1).map(([pk, e]) => ({ pk, label: e.label, units: [...e.units].sort() }));

  // like-for-like change over pairs
  let lfl: PriceAnalysis['lfl'] = null;
  if (pairs.length >= 3) {
    const base = pairs.reduce((s, p) => s + p.p0 * p.q1, 0);
    const extra = pairs.reduce((s, p) => s + p.effect, 0);
    const spendCur = [...curS.values()].reduce((s, x) => s + x.A, 0) || 1;
    lfl = { pct: base > 0 ? extra / base : 0, extra, pairs: pairs.length, coverage: pairs.reduce((s, p) => s + p.p1 * p.q1, 0) / spendCur };
  }
  return { excluded, ambiguous, groups, pairs, bridge, variance, historical, unitMismatch, lfl };
}

// ───────── price trend (chart) ─────────
export interface PriceTrendPoint {
  start: string;
  overall: number | null;
  suppliers: Record<string, number | null>;
}

/** Quantity-weighted unit price per time bucket for ONE comparable item, overall and per supplier. */
export function priceTrend(lines: PriceLine[], gk: string, range: Range, g: Granularity = autoGranularity(lengthDays(range.from, range.to))): { points: PriceTrendPoint[]; suppliers: { key: string; label: string }[] } {
  const bucket = (d: string) => (g === 'day' ? d : g === 'week' ? weekStart(d) : monthStart(d));
  const starts: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) { const b = bucket(d); if (starts[starts.length - 1] !== b) starts.push(b); }
  const overall = new Map<string, AQ>();
  const per = new Map<string, Map<string, AQ>>();
  const labels = new Map<string, string>();
  for (const l of lines) {
    if (l.gk !== gk || l.date < range.from || l.date > range.to) continue;
    const b = bucket(l.date);
    addTo(overall, b, l);
    if (l.supplier) {
      labels.set(l.supplier, l.supplierLabel);
      addTo(per.get(l.supplier) ?? per.set(l.supplier, new Map()).get(l.supplier)!, b, l);
    }
  }
  const sup = [...labels.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  return {
    suppliers: sup,
    points: starts.map((s) => ({ start: s, overall: price(overall.get(s)), suppliers: Object.fromEntries(sup.map((x) => [x.key, price(per.get(x.key)?.get(s))])) })),
  };
}

// ───────── quantity comparison (chart) ─────────
export interface QuantityRow {
  gk: string;
  label: string;
  unit: string;
  current: number;
  previous: number;
  delta: number;
}

export function quantityComparison(groups: GroupRow[], limit = 10): QuantityRow[] {
  return groups
    .filter((g) => g.cur.Q > 0 || g.prev.Q > 0)
    .map((g) => ({ gk: g.gk, label: g.label, unit: g.unit, current: g.cur.Q, previous: g.prev.Q, delta: g.cur.Q - g.prev.Q }))
    .sort((a, b) => Math.abs(b.delta) / (b.previous || 1) - Math.abs(a.delta) / (a.previous || 1) || Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
}

export function medianMad(xs: number[]): { median: number; mad: number } {
  const s = [...xs].sort((a, b) => a - b);
  const med = (a: number[]) => (a.length % 2 ? a[(a.length - 1) / 2]! : (a[a.length / 2 - 1]! + a[a.length / 2]!) / 2);
  const median = med(s);
  const mad = med(s.map((x) => Math.abs(x - median)).sort((a, b) => a - b));
  return { median, mad };
}
