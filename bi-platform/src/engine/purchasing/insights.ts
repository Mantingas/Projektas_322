import type { Insight, PurchaseRecord, Reliability } from '../types';
import { docKey } from '../import/merge';
import { weekStart, addDays } from '../analytics/dates';
import { inRange } from '../analytics/compare';
import { isComparisonBlocked } from '../analytics/periods';
import { pctChange, reliabilityFor } from '../insights/helpers';
import { rankInsights } from '../insights/engine';
import { toPriceLines, medianMad } from './prices';
import type { PurchasingModel } from './dashboard';

export type PurchaseUnavailable = 'short_history' | 'no_supplier' | 'no_product' | 'nothing_found' | 'no_credit_history' | 'too_little_history';

export interface PurchasingAnalysis {
  insights: Insight[];
  unavailable: { rule: string; reason: PurchaseUnavailable }[];
}

type Draft = Omit<Insight, 'score' | 'module' | 'actionable'> & { actionable?: boolean };
const mk = (d: Draft): Insight => ({ ...d, module: 'purchasing', actionable: d.actionable ?? true, score: 0 });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const top = <T,>(xs: T[], n: number, by: (x: T) => number) => [...xs].sort((a, b) => by(b) - by(a)).slice(0, n);

/** Reliability that respects how the item was identified and whether units were provided. */
function rel(lines: number, days: number | undefined, o: { allSku: boolean; hasUnit: boolean }): { level: Reliability; reasonKey: string } {
  const base = reliabilityFor(lines, days);
  if (!o.allSku) return { level: 'low', reasonKey: 'rel.nameIdentity' };
  if (!o.hasUnit && base.level === 'high') return { level: 'medium', reasonKey: 'rel.noUnits' };
  return base;
}

const MIN_CHANGE = 0.05;

/**
 * Deterministic purchasing rules over the SAME model the dashboard shows (period, filters, series, unit policy).
 * Every figure is computed from stored lines; savings are labelled actual / potential / hypothetical and never mixed.
 */
export function analyzePurchasingPeriod(m: PurchasingModel): PurchasingAnalysis {
  const out: Insight[] = [];
  const unavailable: PurchasingAnalysis['unavailable'] = [];
  const skip = (rule: string, reason: PurchaseUnavailable) => unavailable.push({ rule, reason });
  const p = m.periods;
  const days = p.currentDays;
  const blocked = isComparisonBlocked(p);
  const hasUnit = m.ctx.hasUnitColumn;
  const spend = m.kpis.find((k) => k.id === 'p_spend')!;
  const curSpend = spend.current ?? 0;
  const prevSpend = spend.previous ?? 0;
  const cur = inRange(m.records, p.current);
  const prev = inRange(m.records, p.previous);
  const periodParams = { days, from: { date: p.current.from }, to: { date: p.current.to }, pfrom: { date: p.previous.from }, pto: { date: p.previous.to } };

  // 1 ── spend change (with the price / volume / mix split from the bridge) ─────────────────────────────
  if (blocked || prevSpend <= 0 || spend.current === null || !m.bridge) skip('spend_change', 'short_history');
  else {
    const change = pctChange(curSpend, prevSpend);
    if (Math.abs(change) < MIN_CHANGE) skip('spend_change', 'nothing_found');
    else {
      const b = m.bridge;
      const r = reliabilityFor(Math.min(cur.length, prev.length), days);
      const up = change > 0;
      out.push(mk({
        id: 'purchasing.spend_change', topic: 'spend_trend', group: up ? 'cost' : 'savings', severity: up ? 'risk' : 'opportunity',
        titleKey: up ? 'purchasing.spend_change.title_up' : 'purchasing.spend_change.title_down', bodyKey: 'purchasing.spend_change.body',
        actionKey: up ? 'purchasing.spend_change.action_up' : 'purchasing.spend_change.action_down', whyKey: 'purchasing.spend_change.why', chart: 'spendBridge',
        params: { pct: { pct: Math.abs(change) }, current: { money: curSpend }, previous: { money: prevSpend }, delta: { money: Math.abs(curSpend - prevSpend) }, price: { money: b.price + b.supplierMix }, volume: { money: b.volume }, other: { money: b.newItems + b.lostItems + b.credits + b.unassigned }, ...periodParams },
        reliability: r.level, reliabilityReasonKey: r.reasonKey, impact: { value: Math.abs(curSpend - prevSpend), unit: 'money' },
        evidence: [{ label: 'period', current: curSpend, previous: prevSpend, unit: 'money' }],
      }));
    }
  }

  // 2 + 3 ── price increases / decreases for the SAME item from the SAME supplier ───────────────────────────
  const pairs = m.analysis.pairs.filter((x) => x.l0 >= 2 && x.l1 >= 2);
  if (blocked) { skip('price_increase', 'short_history'); skip('price_decrease', 'short_history'); }
  else if (!m.records.some((r) => r.productId || r.productName)) { skip('price_increase', 'no_product'); skip('price_decrease', 'no_product'); }
  else {
    const ups = pairs.filter((x) => x.changePct >= MIN_CHANGE && x.effect > 0);
    const downs = pairs.filter((x) => x.changePct <= -MIN_CHANGE && x.effect < 0);
    const ev = (xs: typeof pairs) => top(xs, 5, (x) => Math.abs(x.effect)).map((x) => ({ key: x.pk, label: `${x.label}${x.supplierLabel ? ` · ${x.supplierLabel}` : ''}${x.unit ? ` (${x.unit})` : ''}`, current: x.p1, previous: x.p0, unit: 'price' as const }));
    if (ups.length) {
      const extra = sum(ups.map((x) => x.effect));
      const lead = top(ups, 1, (x) => x.effect)[0]!;
      const r = rel(sum(ups.map((x) => x.l0 + x.l1)), days, { allSku: ups.every((x) => x.identity === 'sku'), hasUnit });
      out.push(mk({
        id: 'purchasing.price_increase', topic: 'price_increase', group: 'cost', severity: 'risk', titleKey: 'purchasing.price_increase.title', bodyKey: 'purchasing.price_increase.body',
        actionKey: 'purchasing.price_increase.action', whyKey: 'purchasing.price_increase.why', dimension: 'product', chart: 'priceTrend',
        params: { count: ups.length, extra: { money: extra }, name: lead.label, supplier: lead.supplierLabel || '–', pct: { pct: lead.changePct }, ...periodParams },
        reliability: r.level, reliabilityReasonKey: r.reasonKey, impact: { value: extra, unit: 'money' }, evidence: ev(ups),
      }));
    } else skip('price_increase', 'nothing_found');
    if (downs.length) {
      const saved = -sum(downs.map((x) => x.effect));
      const lead = top(downs, 1, (x) => -x.effect)[0]!;
      const r = rel(sum(downs.map((x) => x.l0 + x.l1)), days, { allSku: downs.every((x) => x.identity === 'sku'), hasUnit });
      out.push(mk({
        id: 'purchasing.price_decrease', topic: 'price_decrease', group: 'savings', severity: 'opportunity', titleKey: 'purchasing.price_decrease.title', bodyKey: 'purchasing.price_decrease.body',
        actionKey: 'purchasing.price_decrease.action', whyKey: 'purchasing.price_decrease.why', dimension: 'product', chart: 'priceTrend',
        params: { count: downs.length, saved: { money: saved }, name: lead.label, supplier: lead.supplierLabel || '–', pct: { pct: Math.abs(lead.changePct) }, ...periodParams },
        reliability: r.level, reliabilityReasonKey: r.reasonKey, impact: { value: saved, unit: 'money' }, evidence: ev(downs), savings: { kind: 'actual', amount: saved },
      }));
    } else skip('price_decrease', 'nothing_found');
  }

  // 4 ── same item, different suppliers, same period → POTENTIAL savings ──────────────────────────────────
  const gaps = m.variance.filter((v) => v.spreadPct >= 0.1 && v.potentialSavings > 0 && v.suppliers.every((s) => s.lines >= 1));
  if (!m.records.some((r) => r.supplierId || r.supplierName)) skip('supplier_price_gap', 'no_supplier');
  else if (gaps.length === 0) skip('supplier_price_gap', 'nothing_found');
  else {
    const potential = sum(gaps.map((g) => g.potentialSavings));
    const lead = top(gaps, 1, (g) => g.potentialSavings)[0]!;
    const r = rel(Math.min(...gaps.flatMap((g) => g.suppliers.map((s) => s.lines))) * 5, undefined, { allSku: gaps.every((g) => g.identity === 'sku'), hasUnit });
    out.push(mk({
      id: 'purchasing.supplier_price_gap', topic: 'supplier_price_gap', group: 'savings', severity: 'opportunity', titleKey: 'purchasing.supplier_price_gap.title', bodyKey: 'purchasing.supplier_price_gap.body',
      actionKey: 'purchasing.supplier_price_gap.action', whyKey: 'purchasing.supplier_price_gap.why', dimension: 'product', chart: 'priceVariance',
      params: { count: gaps.length, potential: { money: potential }, name: lead.label, spread: { pct: lead.spreadPct }, low: lead.suppliers[0]!.label, high: lead.suppliers[lead.suppliers.length - 1]!.label },
      reliability: r.level, reliabilityReasonKey: r.reasonKey, impact: { value: potential, unit: 'money' }, savings: { kind: 'potential', amount: potential },
      evidence: top(gaps, 5, (g) => g.potentialSavings).map((g) => ({ key: g.pk, label: `${g.label}${g.unit ? ` (${g.unit})` : ''} — ${g.suppliers[0]!.label} / ${g.suppliers[g.suppliers.length - 1]!.label}`, current: g.max, previous: g.min, unit: 'price' as const })),
    }));
  }

  // 5 ── suppliers behind the largest cost increases ────────────────────────────────────────────────────
  const sup = m.tables.supplier;
  if (!sup) skip('supplier_cost_increase', 'no_supplier');
  else if (blocked || prevSpend <= 0) skip('supplier_cost_increase', 'short_history');
  else {
    const rows = sup.rows.filter((x) => x.change >= Math.max(prevSpend * 0.005, 1) && x.previous > 0 && x.change / x.previous >= MIN_CHANGE);
    if (rows.length === 0) skip('supplier_cost_increase', 'nothing_found');
    else {
      const lead = top(rows, 1, (x) => x.change)[0]!;
      const leadPrice = sum(m.analysis.pairs.filter((x) => x.supplier === lead.key).map((x) => x.effect));
      const r = reliabilityFor(sum(rows.map((x) => x.lines)), days);
      out.push(mk({
        id: 'purchasing.supplier_cost_increase', topic: 'supplier_cost_increase', group: 'cost', severity: 'risk', titleKey: 'purchasing.supplier_cost_increase.title', bodyKey: 'purchasing.supplier_cost_increase.body',
        actionKey: 'purchasing.supplier_cost_increase.action', whyKey: 'purchasing.supplier_cost_increase.why', dimension: 'supplier', chart: 'waterfall',
        params: { count: rows.length, increase: { money: sum(rows.map((x) => x.change)) }, name: lead.label, lead: { money: lead.change }, priceEffect: { money: leadPrice }, ...periodParams },
        reliability: r.level, reliabilityReasonKey: r.reasonKey, impact: { value: sum(rows.map((x) => x.change)), unit: 'money' },
        evidence: top(rows, 5, (x) => x.change).map((x) => ({ key: x.key, label: x.label, current: x.current, previous: x.previous, unit: 'money' as const })),
      }));
    }
  }

  // 6 ── supplier concentration (current period) ─────────────────────────────────────────────────────────
  if (!sup) skip('supplier_concentration', 'no_supplier');
  else {
    const pos = sup.rows.filter((x) => x.current > 0).sort((a, b) => b.current - a.current);
    const total = sum(pos.map((x) => x.current));
    if (pos.length < 3 || total <= 0) skip('supplier_concentration', 'nothing_found');
    else {
      const t1 = pos[0]!.current / total;
      const t3 = sum(pos.slice(0, 3).map((x) => x.current)) / total;
      if (t1 < 0.4 && t3 < 0.75) skip('supplier_concentration', 'nothing_found');
      else {
        const r = reliabilityFor(sum(pos.map((x) => x.lines)));
        out.push(mk({
          id: 'purchasing.supplier_concentration', topic: 'supplier_concentration', group: 'concentration', severity: 'risk', titleKey: 'purchasing.supplier_concentration.title', bodyKey: 'purchasing.supplier_concentration.body',
          actionKey: 'purchasing.supplier_concentration.action', whyKey: 'purchasing.supplier_concentration.why', dimension: 'supplier', chart: 'pareto',
          params: { name: pos[0]!.label, top1: { pct: t1 }, top3: { pct: t3 }, suppliers: pos.length },
          reliability: r.level, reliabilityReasonKey: r.reasonKey, impact: { value: sum(pos.slice(0, 3).map((x) => x.current)), unit: 'money' },
          evidence: pos.slice(0, 5).map((x) => ({ key: x.key, label: x.label, current: x.current, unit: 'money' as const })),
        }));
      }
    }
  }

  // 7 ── unusual purchase quantities (against the same item's own history) ───────────────────────────────
  const { lines: pl } = toPriceLines(m.records, { policy: m.unitPolicy, hasUnitColumn: hasUnit });
  const hist = new Map<string, number[]>();
  for (const l of pl) if (l.date < p.current.from) (hist.get(l.gk) ?? hist.set(l.gk, []).get(l.gk)!).push(l.qty);
  const odd = pl.filter((l) => {
    if (l.date < p.current.from || l.date > p.current.to) return false;
    const h = hist.get(l.gk);
    if (!h || h.length < 8) return false;
    const { median, mad } = medianMad(h);
    if (median <= 0 || l.qty < 3 * median) return false;
    return mad === 0 ? true : (0.6745 * (l.qty - median)) / mad > 3.5;
  });
  if (pl.length === 0) skip('unusual_quantity', 'no_product');
  else if (odd.length === 0) skip('unusual_quantity', hist.size === 0 || [...hist.values()].every((h) => h.length < 8) ? 'too_little_history' : 'nothing_found');
  else {
    const r = rel(sum(odd.map((l) => hist.get(l.gk)!.length)) / odd.length, undefined, { allSku: odd.every((l) => l.identity === 'sku'), hasUnit });
    out.push(mk({
      id: 'purchasing.unusual_quantity', topic: 'unusual_quantity', group: 'anomaly', severity: 'risk', titleKey: 'purchasing.unusual_quantity.title', bodyKey: 'purchasing.unusual_quantity.body',
      actionKey: 'purchasing.unusual_quantity.action', whyKey: 'purchasing.unusual_quantity.why', dimension: 'product', chart: 'quantityComparison',
      params: { count: odd.length, amount: { money: sum(odd.map((l) => l.amount)) }, name: odd[0]!.productLabel },
      reliability: r.level, reliabilityReasonKey: r.reasonKey, impact: { value: sum(odd.map((l) => l.amount)), unit: 'money' },
      evidence: top(odd, 5, (l) => l.amount).map((l) => ({ key: l.pk, label: `${l.documentId ?? '–'} · ${l.productLabel}${l.unit ? ` (${l.unit})` : ''}`, current: l.qty, previous: medianMad(hist.get(l.gk)!).median, unit: 'qty' as const })),
    }));
  }

  // 8 ── spending anomalies: whole weeks inside the period vs the weekly history before it ───────────────
  const weeks = new Map<string, number>();
  for (const r of m.records) if (r.amount > 0) weeks.set(weekStart(r.date), (weeks.get(weekStart(r.date)) ?? 0) + r.amount);
  const histW = [...weeks.entries()].filter(([w]) => addDays(w, 6) < p.current.from).map(([, v]) => v);
  if (histW.length < 8) skip('spend_anomaly', 'too_little_history');
  else {
    const { median, mad } = medianMad(histW);
    const flagged = [...weeks.entries()].filter(([w, v]) => w >= p.current.from && addDays(w, 6) <= p.current.to && median > 0 && v >= 1.5 * median && (mad === 0 || v > median + 3.5 * 1.4826 * mad));
    if (flagged.length === 0) skip('spend_anomaly', 'nothing_found');
    else {
      const excess = sum(flagged.map(([, v]) => v - median));
      const r = reliabilityFor(histW.length * 2);
      out.push(mk({
        id: 'purchasing.spend_anomaly', topic: 'spend_anomaly', group: 'anomaly', severity: 'risk', titleKey: 'purchasing.spend_anomaly.title', bodyKey: 'purchasing.spend_anomaly.body',
        actionKey: 'purchasing.spend_anomaly.action', whyKey: 'purchasing.spend_anomaly.why', chart: 'trend',
        params: { count: flagged.length, excess: { money: excess }, median: { money: median }, weeks: histW.length },
        reliability: r.level === 'high' ? 'medium' : r.level, reliabilityReasonKey: r.reasonKey, impact: { value: excess, unit: 'money' },
        evidence: flagged.slice(0, 5).map(([w, v]) => ({ label: w, current: v, previous: median, unit: 'money' as const })),
      }));
    }
  }

  // 9 ── credit notes fell – a factual change, never a claim that credits are "missing" ───────────────────
  const credStats = (rs: PurchaseRecord[]) => {
    const docs = new Map<string, number>();
    let credits = 0;
    let gross = 0;
    for (const r of rs) {
      if (r.amount > 0) gross += r.amount; else credits += -r.amount;
      const k = docKey(r) ?? `row:${r.key}`;
      docs.set(k, (docs.get(k) ?? 0) + r.amount);
    }
    return { credits, gross, docs: [...docs.values()].filter((v) => v < 0).length };
  };
  const cp = credStats(prev);
  const cc = credStats(cur);
  if (blocked) skip('credit_notes_reduced', 'short_history');
  else if (cp.docs < 3 || cp.gross <= 0 || cp.credits / cp.gross < 0.02) skip('credit_notes_reduced', 'no_credit_history');
  else {
    const prevShare = cp.credits / cp.gross;
    const curShare = cc.gross > 0 ? cc.credits / cc.gross : 0;
    // both the amount AND the share of purchases must have fallen by half: a purchasing surge alone is not "fewer credits"
    if (curShare >= prevShare * 0.5 || cc.credits >= cp.credits * 0.5) skip('credit_notes_reduced', 'nothing_found');
    else {
      const gap = Math.max(0, prevShare * cc.gross - cc.credits);
      out.push(mk({
        id: 'purchasing.credit_notes_reduced', topic: 'credit_notes', group: 'credits', severity: 'info', titleKey: 'purchasing.credit_notes_reduced.title', bodyKey: 'purchasing.credit_notes_reduced.body',
        actionKey: 'purchasing.credit_notes_reduced.action', whyKey: 'purchasing.credit_notes_reduced.why', chart: 'trend',
        params: { prev: { money: cp.credits }, cur: { money: cc.credits }, prevDocs: cp.docs, curDocs: cc.docs, prevShare: { pct: prevShare }, curShare: { pct: curShare }, gap: { money: gap }, ...periodParams },
        reliability: 'medium', reliabilityReasonKey: 'rel.creditHistory', impact: { value: gap, unit: 'money' }, evidence: [{ label: 'period', current: cc.credits, previous: cp.credits, unit: 'money' }],
      }));
    }
  }

  // 10 ── HYPOTHETICAL: back to the lowest earlier monthly price ─────────────────────────────────────────
  const hy = m.historical.filter((h) => h.identity === 'sku' && h.months >= 3 && h.currentPrice >= h.minMonthlyPrice * 1.05);
  if (hy.length === 0) skip('historical_price_scenario', m.historical.length ? 'nothing_found' : 'too_little_history');
  else {
    const total = sum(hy.map((h) => h.hypothetical));
    out.push(mk({
      id: 'purchasing.historical_price_scenario', topic: 'historical_scenario', group: 'savings', severity: 'info', actionable: false, titleKey: 'purchasing.historical_price_scenario.title', bodyKey: 'purchasing.historical_price_scenario.body',
      actionKey: 'purchasing.historical_price_scenario.action', whyKey: 'purchasing.historical_price_scenario.why', dimension: 'product', chart: 'priceTrend',
      params: { count: hy.length, amount: { money: total }, name: hy[0]!.label },
      reliability: 'low', reliabilityReasonKey: 'rel.hypothetical', impact: { value: total, unit: 'money' }, savings: { kind: 'hypothetical', amount: total },
      evidence: top(hy, 5, (h) => h.hypothetical).map((h) => ({ key: h.pk, label: `${h.label}${h.unit ? ` (${h.unit})` : ''} · ${h.minMonth}`, current: h.currentPrice, previous: h.minMonthlyPrice, unit: 'price' as const })),
    }));
  }

  let drafts = out;
  if (!p.equivalent) drafts = drafts.map((i) => (i.params.days !== undefined ? { ...i, reliability: 'low' as const, reliabilityReasonKey: 'rel.unequalPeriods' } : i));
  const window = (curSpend + prevSpend) / 2;
  return { insights: rankInsights(drafts, { total: Math.max(curSpend, 0) || window, window }), unavailable };
}
