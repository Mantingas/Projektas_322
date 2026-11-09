import type { EvidenceRow, Insight, Reliability } from '../types';
import { isComparisonBlocked } from '../analytics/periods';
import { pctChange, reliabilityFor } from '../insights/helpers';
import { medianMad } from '../purchasing/prices';
import { VALUE_COVERAGE_MIN } from './position';
import { RISK_COVER_DAYS, SLOW_COVER_DAYS, TARGET_COVER_DAYS } from './flows';
import type { InventoryModel } from './dashboard';
import type { InventoryUnavailable } from './metrics';

export type InventoryRuleUnavailable = InventoryUnavailable | 'nothing_found' | 'too_little_history';

export interface InventoryAnalysis {
  insights: Insight[];
  unavailable: { rule: string; reason: InventoryRuleUnavailable }[];
}

type Draft = Omit<Insight, 'score' | 'module' | 'actionable'> & { actionable?: boolean };
const mk = (d: Draft): Insight => ({ ...d, module: 'inventory', actionable: d.actionable ?? true, score: 0 });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const top = <T,>(xs: T[], n: number, by: (x: T) => number) => [...xs].sort((a, b) => by(b) - by(a)).slice(0, n);

const REL_W = { high: 1, medium: 0.7, low: 0.4 } as const;
const SEV_W = { risk: 1, opportunity: 0.9, info: 0.5 } as const;
const MAX_PER_GROUP = 2;
const MAX = 10;

/** Reliability that respects how items were identified: name-only identity is never better than "low". */
function rel(lines: number, allSku: boolean, extra?: { days?: number }): { level: Reliability; reasonKey: string } {
  if (!allSku) return { level: 'low', reasonKey: 'rel.nameIdentity' };
  return reliabilityFor(lines, extra?.days);
}

/**
 * Ranking: money findings are scored by their share of stock value; count-based findings (stockout, negative stock …) by a fixed scale.
 * One insight per topic, bounded per story group, best first.
 */
function rank(all: Insight[], stockValue: number): Insight[] {
  const scored = all.map((i) => {
    let relImpact = i.impact.unit === 'money' ? (stockValue > 0 ? Math.min(1, i.impact.value / stockValue) : 0.05) : Math.min(1, i.impact.value / 5) * 0.3;
    // data-quality findings (negative stock, mismatches) are small in money but must not vanish: they say whether the numbers can be trusted
    if (['negative', 'reconciliation', 'valuation'].includes(i.group)) relImpact = Math.max(relImpact, 0.03);
    return { ...i, score: Math.round(relImpact * REL_W[i.reliability] * SEV_W[i.severity] * (i.actionable ? 1 : 0.6) * 10000) / 10000 };
  }).filter((i) => i.score > 0);
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const topics = new Set<string>();
  const groups = new Map<string, number>();
  const out: Insight[] = [];
  for (const i of scored) {
    if (topics.has(i.topic) || (groups.get(i.group) ?? 0) >= MAX_PER_GROUP) continue;
    topics.add(i.topic);
    groups.set(i.group, (groups.get(i.group) ?? 0) + 1);
    out.push(i);
    if (out.length >= MAX) break;
  }
  return out;
}

export function analyzeInventoryPeriod(m: InventoryModel): InventoryAnalysis {
  const out: Insight[] = [];
  const unavailable: InventoryAnalysis['unavailable'] = [];
  const skip = (rule: string, reason: InventoryRuleUnavailable) => unavailable.push({ rule, reason });
  const p = m.periods;
  const pos = m.cur.pos;
  const valueOk = Boolean(pos && pos.lines > 0 && pos.valued / pos.lines >= VALUE_COVERAGE_MIN);
  const stockValue = valueOk ? Math.max(pos!.value, 0) : 0;
  const lines = pos?.lines ?? 0;
  const prodTable = m.tables.product ?? null;
  const allSku = (pos ? [...pos.byProduct.values()] : []).every((x) => x.identity === 'sku');
  const asOf = m.cur.asOf;
  const period = { asof: { date: asOf }, from: { date: p.current.from }, to: { date: p.current.to } };
  const ev = (rows: { key: string; label: string; current: number; previous?: number }[], unit: EvidenceRow['unit']): EvidenceRow[] => rows.map((r) => ({ key: r.key, label: r.label, current: r.current, previous: r.previous, unit }));

  // 1 ── concentration of stock value ─────────────────────────────────────────────────────────────────────
  if (!pos) skip('value_concentration', 'no_snapshot');
  else if (!valueOk) skip('value_concentration', 'cost_missing');
  else {
    const rows = [...pos.byProduct.values()].filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
    const total = sum(rows.map((r) => r.value));
    if (rows.length < 5) skip('value_concentration', 'few_items');
    else {
      const s1 = rows[0]!.value / total;
      const s3 = sum(rows.slice(0, 3).map((r) => r.value)) / total;
      if (s1 < 0.2 && s3 < 0.5) skip('value_concentration', 'nothing_found');
      else {
        const r = rel(lines, allSku);
        out.push(mk({
          id: 'inventory.value_concentration', topic: 'value_concentration', group: 'structure', severity: s1 >= 0.4 ? 'risk' : 'info', titleKey: 'inventory.value_concentration.title', bodyKey: 'inventory.value_concentration.body',
          actionKey: 'inventory.value_concentration.action', whyKey: 'inventory.value_concentration.why', dimension: 'product', chart: 'abc',
          params: { name: rows[0]!.label, share1: { pct: s1 }, share3: { pct: s3 }, value3: { money: sum(rows.slice(0, 3).map((x) => x.value)) }, count: rows.length, ...period },
          reliability: r.level, reliabilityReasonKey: r.reasonKey, impact: { value: sum(rows.slice(0, 3).map((x) => x.value)), unit: 'money' },
          evidence: ev(rows.slice(0, 5).map((x) => ({ key: x.pk, label: x.label, current: x.value, previous: prodTable?.rows.find((t) => t.key === x.pk)?.previous })), 'money'),
        }));
      }
    }
  }

  // 2 ── significant increase of the total stock value ───────────────────────────────────────────────────────
  const prevPos = m.prev.pos;
  const prevOk = Boolean(prevPos && prevPos.lines > 0 && prevPos.valued / prevPos.lines >= VALUE_COVERAGE_MIN);
  if (!pos) skip('value_increase', 'no_snapshot');
  else if (!prevPos || isComparisonBlocked(p)) skip('value_increase', 'no_previous_snapshot');
  else if (!valueOk || !prevOk) skip('value_increase', 'cost_missing');
  else {
    const change = pctChange(pos.value, prevPos.value);
    const delta = pos.value - prevPos.value;
    if (change < 0.15 || delta < Math.max(1, 0.01 * Math.abs(prevPos.value))) skip('value_increase', 'nothing_found');
    else {
      const grew = (prodTable?.rows ?? []).filter((x) => x.change > 0).sort((a, b) => b.change - a.change).slice(0, 5);
      const f = m.flows;
      const flowsOk = Boolean(f && m.cov && f.issueValueCoverage >= VALUE_COVERAGE_MIN && f.receiptValueCoverage >= VALUE_COVERAGE_MIN && m.cur.turnover);
      const r = rel(lines, allSku);
      out.push(mk({
        id: 'inventory.value_increase', topic: 'value_increase', group: 'trend', severity: 'risk', titleKey: 'inventory.value_increase.title', bodyKey: flowsOk ? 'inventory.value_increase.body_flows' : 'inventory.value_increase.body',
        actionKey: 'inventory.value_increase.action', whyKey: 'inventory.value_increase.why', dimension: 'product', chart: 'waterfall',
        params: { pct: { pct: change }, current: { money: pos.value }, previous: { money: prevPos.value }, delta: { money: delta }, receipts: { money: f?.receiptValue ?? 0 }, issues: { money: f?.netIssueValue ?? 0 }, ...period, pasof: { date: prevPos.newest } },
        reliability: r.level, reliabilityReasonKey: r.reasonKey, impact: { value: delta, unit: 'money' },
        evidence: ev(grew.map((x) => ({ key: x.key, label: x.label, current: x.current, previous: x.previous })), 'money'),
      }));
    }
  }

  // 3 ── excess stock compared with observed demand ────────────────────────────────────────────────────────
  const st = m.cur.status;
  if (!st) skip('excess_stock', m.cur.statusWhy ?? 'no_movements');
  else if (!valueOk) skip('excess_stock', 'cost_missing');
  else {
    const items = st.items.filter((i) => i.excessValue !== null && i.state !== 'non_moving' && i.state !== 'ambiguous' && i.state !== 'unmatched' && i.excessValue > 0);
    const total = sum(items.map((i) => i.excessValue!));
    if (items.length === 0 || stockValue <= 0 || total < stockValue * 0.1) skip('excess_stock', 'nothing_found');
    else {
      const r = rel(sum(items.map((i) => i.demand > 0 ? 10 : 0)), items.every((i) => i.identity === 'sku'), { days: st.history.days });
      const lead = top(items, 1, (i) => i.excessValue!)[0]!;
      out.push(mk({
        id: 'inventory.excess_stock', topic: 'excess_stock', group: 'overstock', severity: 'opportunity', titleKey: 'inventory.excess_stock.title', bodyKey: 'inventory.excess_stock.body',
        actionKey: 'inventory.excess_stock.action', whyKey: 'inventory.excess_stock.why', dimension: 'product', chart: 'slowMoving',
        params: { amount: { money: total }, share: { pct: total / stockValue }, count: items.length, target: TARGET_COVER_DAYS, history: st.history.days, name: lead.label, ...period },
        reliability: r.level === 'high' ? 'medium' : r.level, reliabilityReasonKey: r.reasonKey, impact: { value: total, unit: 'money' },
        evidence: ev(top(items, 5, (i) => i.excessValue!).map((i) => ({ key: i.pk, label: `${i.label}${i.unit ? ` (${i.unit})` : ''}`, current: i.stockQty, previous: i.perDay * TARGET_COVER_DAYS })), 'qty'),
      }));
    }
  }

  // 4 + 5 ── slow-moving and non-moving ──────────────────────────────────────────────────────────────────────
  if (!st) { skip('slow_moving', m.cur.statusWhy ?? 'no_movements'); skip('non_moving', m.cur.statusWhy ?? 'no_movements'); }
  else if (!valueOk) { skip('slow_moving', 'cost_missing'); skip('non_moving', 'cost_missing'); }
  else {
    const slow = st.items.filter((i) => i.state === 'slow' && i.stockValue !== null && i.stockValue > 0);
    const dead = st.items.filter((i) => i.state === 'non_moving' && i.stockValue !== null && i.stockValue > 0);
    const rs = (xs: typeof slow) => rel(sum(xs.map(() => 10)), xs.every((i) => i.identity === 'sku'), { days: st.history.days });
    const sv = sum(slow.map((i) => i.stockValue!));
    if (slow.length && (slow.length >= 3 || sv >= stockValue * 0.02)) {
      const r = rs(slow);
      out.push(mk({
        id: 'inventory.slow_moving', topic: 'slow_moving', group: 'overstock', severity: 'risk', titleKey: 'inventory.slow_moving.title', bodyKey: 'inventory.slow_moving.body',
        actionKey: 'inventory.slow_moving.action', whyKey: 'inventory.slow_moving.why', dimension: 'product', chart: 'slowMoving',
        params: { count: slow.length, amount: { money: sv }, share: { pct: stockValue > 0 ? sv / stockValue : 0 }, cover: SLOW_COVER_DAYS, history: st.history.days, name: top(slow, 1, (i) => i.stockValue!)[0]!.label, ...period },
        reliability: r.level === 'high' ? 'medium' : r.level, reliabilityReasonKey: r.reasonKey, impact: { value: sv, unit: 'money' },
        evidence: ev(top(slow, 5, (i) => i.stockValue!).map((i) => ({ key: i.pk, label: `${i.label}${i.unit ? ` (${i.unit})` : ''}`, current: i.stockValue! })), 'money'),
      }));
    } else skip('slow_moving', 'nothing_found');
    const dv = sum(dead.map((i) => i.stockValue!));
    if (dead.length && (dead.length >= 2 || dv >= stockValue * 0.02)) {
      const r = rs(dead);
      out.push(mk({
        id: 'inventory.non_moving', topic: 'non_moving', group: 'dead', severity: 'risk', titleKey: 'inventory.non_moving.title', bodyKey: 'inventory.non_moving.body',
        actionKey: 'inventory.non_moving.action', whyKey: 'inventory.non_moving.why', dimension: 'product', chart: 'slowMoving',
        params: { count: dead.length, amount: { money: dv }, share: { pct: stockValue > 0 ? dv / stockValue : 0 }, history: st.history.days, name: top(dead, 1, (i) => i.stockValue!)[0]!.label, ...period },
        reliability: r.level === 'high' ? 'medium' : r.level, reliabilityReasonKey: r.reasonKey, impact: { value: dv, unit: 'money' },
        evidence: ev(top(dead, 5, (i) => i.stockValue!).map((i) => ({ key: i.pk, label: `${i.label}${i.unit ? ` (${i.unit})` : ''}`, current: i.stockValue! })), 'money'),
      }));
    } else skip('non_moving', 'nothing_found');
  }

  // 6 ── potential stockouts ───────────────────────────────────────────────────────────────────────────────
  const risk = m.cur.risk;
  if (!risk) skip('stockout_risk', m.cur.riskWhy ?? 'needs_history_or_min');
  else if (risk.rows.length === 0) skip('stockout_risk', 'nothing_found');
  else {
    const gks = new Set(risk.rows.map((r) => r.gk));
    const n = (k: string) => risk.rows.filter((r) => r.reason === k).length;
    const lead = risk.rows[0]!;
    const r = rel(risk.usedHistory ? 12 : 30, risk.rows.every((x) => x.identity === 'sku'), { days: st?.history.days });
    out.push(mk({
      id: 'inventory.stockout_risk', topic: 'stockout_risk', group: 'service', severity: 'risk', titleKey: 'inventory.stockout_risk.title', bodyKey: 'inventory.stockout_risk.body',
      actionKey: 'inventory.stockout_risk.action', whyKey: 'inventory.stockout_risk.why', dimension: 'product', chart: 'stockoutRisk',
      params: { count: gks.size, out: n('out_of_stock'), min: n('below_min'), cover: n('low_cover'), days: RISK_COVER_DAYS, name: lead.label, ...period },
      reliability: r.level === 'high' ? 'medium' : r.level, reliabilityReasonKey: risk.usedHistory ? r.reasonKey : 'rel.minStockOnly', impact: { value: gks.size, unit: 'qty' },
      evidence: ev(risk.rows.slice(0, 5).map((x) => ({ key: x.pk, label: `${x.label}${x.warehouse ? ` · ${x.warehouse}` : ''}${x.unit ? ` (${x.unit})` : ''}`, current: x.qty, previous: x.minStock ?? (x.perDay ?? 0) * RISK_COVER_DAYS })), 'qty'),
    }));
  }

  // 7 ── negative stock ─────────────────────────────────────────────────────────────────────────────────────
  if (!pos) skip('negative_stock', 'no_snapshot');
  else if (m.negatives.length === 0) skip('negative_stock', 'nothing_found');
  else {
    const neg = m.negatives;
    const value = sum(neg.map((l) => (l.value !== null ? Math.abs(l.value) : 0)));
    out.push(mk({
      id: 'inventory.negative_stock', topic: 'negative_stock', group: 'negative', severity: 'risk', titleKey: 'inventory.negative_stock.title', bodyKey: 'inventory.negative_stock.body',
      actionKey: 'inventory.negative_stock.action', whyKey: 'inventory.negative_stock.why', dimension: 'product', chart: 'abc',
      params: { count: neg.length, amount: { money: value }, name: top(neg, 1, (l) => -l.qty)[0]!.label, ...period },
      reliability: 'high', reliabilityReasonKey: 'rel.inData', impact: value > 0 ? { value, unit: 'money' } : { value: neg.length, unit: 'qty' },
      evidence: ev(top(neg, 5, (l) => -l.qty).map((l) => ({ key: l.pk, label: `${l.label}${l.whLabel ? ` · ${l.whLabel}` : ''}${l.unit ? ` (${l.unit})` : ''}`, current: l.qty })), 'qty'),
    }));
  }

  // 8 ── snapshots that do not agree with the movements between them ─────────────────────────────────────────
  if (m.recon.length === 0) skip('stock_inconsistent', m.snapshotDates.length < 2 || !m.cov ? 'too_little_history' : 'nothing_found');
  else {
    const value = sum(m.recon.map((x) => (x.unitValue !== null ? Math.abs(x.diff) * x.unitValue : 0)));
    out.push(mk({
      id: 'inventory.stock_inconsistent', topic: 'stock_inconsistent', group: 'reconciliation', severity: 'risk', titleKey: 'inventory.stock_inconsistent.title', bodyKey: 'inventory.stock_inconsistent.body',
      actionKey: 'inventory.stock_inconsistent.action', whyKey: 'inventory.stock_inconsistent.why', dimension: 'product', chart: 'movementTrend',
      params: { count: m.recon.length, amount: { money: value }, name: m.recon[0]!.label, ...period },
      reliability: 'medium', reliabilityReasonKey: 'rel.reconPartial', impact: value > 0 ? { value, unit: 'money' } : { value: m.recon.length, unit: 'qty' },
      evidence: m.recon.slice(0, 5).map((x) => ({ key: x.gk.split('|')[0], label: `${x.label}${x.warehouse ? ` · ${x.warehouse}` : ''}`, current: x.actual, previous: x.expected, unit: 'qty' as const })),
    }));
  }

  // 9 ── unusual stock movements: outlier quantities and large adjustments ─────────────────────────────────────
  const flow = m.moves.filter((x) => x.pk && (x.type === 'receipt' || x.type === 'issue'));
  if (flow.length === 0) skip('unusual_movements', 'no_movements');
  else {
    // history per item AND direction: a monthly receipt of 5 is not "unusual" next to daily issues of 1
    const hk = (l: (typeof flow)[number]) => `${l.gk}|${l.type}`;
    const hist = new Map<string, number[]>();
    for (const l of flow) (hist.get(hk(l)) ?? hist.set(hk(l), []).get(hk(l))!).push(Math.abs(l.qty));
    const odd = flow.filter((l) => {
      if (l.date < p.current.from || l.date > p.current.to) return false;
      const h = hist.get(hk(l))!;
      if (h.length < 8) return false;
      const { median, mad } = medianMad(h);
      if (median <= 0 || Math.abs(l.qty) < 3 * median) return false;
      return mad === 0 ? true : (0.6745 * (Math.abs(l.qty) - median)) / mad > 3.5;
    });
    const adj = m.moves.filter((l) => l.type === 'adjustment' && l.date >= p.current.from && l.date <= p.current.to);
    const adjValue = sum(adj.map((l) => (l.value !== null ? Math.abs(l.value) : 0)));
    const adjSignificant = valueOk && stockValue > 0 && adjValue >= stockValue * 0.02;
    if (odd.length === 0 && !adjSignificant) skip('unusual_movements', [...hist.values()].every((h) => h.length < 8) && !adj.length ? 'too_little_history' : 'nothing_found');
    else {
      const oddValue = sum(odd.map((l) => (l.value !== null ? Math.abs(l.value) : 0)));
      const r = rel(odd.length ? sum(odd.map((l) => hist.get(hk(l))!.length)) / odd.length : 12, odd.every((l) => !l.pk || l.pk.startsWith('sku:')));
      const evRows: EvidenceRow[] = top(odd, 4, (l) => Math.abs(l.value ?? l.qty)).map((l) => ({ key: l.pk!, label: `${l.rec.documentId ?? '–'} · ${l.label}`, current: Math.abs(l.qty), previous: medianMad(hist.get(hk(l))!).median, unit: 'qty' as const }));
      if (adjSignificant) evRows.push(...top(adj, 2, (l) => Math.abs(l.value ?? 0)).map((l) => ({ key: l.pk ?? undefined, label: `${l.rec.documentId ?? '–'} · ${l.label}`, current: Math.abs(l.value ?? 0), unit: 'money' as const })));
      out.push(mk({
        id: 'inventory.unusual_movements', topic: 'unusual_movements', group: 'anomaly', severity: 'risk', titleKey: 'inventory.unusual_movements.title', bodyKey: adjSignificant ? (odd.length ? 'inventory.unusual_movements.body_both' : 'inventory.unusual_movements.body_adj') : 'inventory.unusual_movements.body',
        actionKey: 'inventory.unusual_movements.action', whyKey: 'inventory.unusual_movements.why', dimension: 'product', chart: 'movementTrend',
        params: { count: odd.length, amount: { money: oddValue }, adjCount: adj.length, adj: { money: adjValue }, name: odd[0]?.label ?? '', ...period },
        reliability: r.level === 'high' ? 'medium' : r.level, reliabilityReasonKey: r.reasonKey, impact: oddValue + (adjSignificant ? adjValue : 0) > 0 ? { value: oddValue + (adjSignificant ? adjValue : 0), unit: 'money' } : { value: odd.length, unit: 'qty' },
        evidence: evRows,
      }));
    }
  }

  // 10 ── valuation anomalies: stated value ≠ quantity × cost, and unit costs that differ several-fold ───────────
  if (!pos) skip('valuation_anomaly', 'no_snapshot');
  else if (m.valueConflicts.length === 0 && m.costOutliers.length === 0) skip('valuation_anomaly', 'nothing_found');
  else {
    const gap = sum(m.valueConflicts.map((c) => Math.abs(c.stated - c.computed)));
    out.push(mk({
      id: 'inventory.valuation_anomaly', topic: 'valuation_anomaly', group: 'valuation', severity: 'risk', titleKey: 'inventory.valuation_anomaly.title', bodyKey: 'inventory.valuation_anomaly.body',
      actionKey: 'inventory.valuation_anomaly.action', whyKey: 'inventory.valuation_anomaly.why', dimension: 'product', chart: 'abc',
      params: { conflicts: m.valueConflicts.length, gap: { money: gap }, outliers: m.costOutliers.length, name: m.valueConflicts[0]?.label ?? m.costOutliers[0]?.label ?? '', ...period },
      reliability: 'high', reliabilityReasonKey: 'rel.inData', impact: gap > 0 ? { value: gap, unit: 'money' } : { value: m.costOutliers.length, unit: 'qty' },
      evidence: [
        ...top(m.valueConflicts, 3, (c) => Math.abs(c.stated - c.computed)).map((c) => ({ label: `${c.label}${c.warehouse ? ` · ${c.warehouse}` : ''}`, current: c.stated, previous: c.computed, unit: 'money' as const })),
        ...m.costOutliers.slice(0, 2).map((c) => ({ label: c.label, current: c.max, previous: c.min, unit: 'price' as const })),
      ],
    }));
  }

  return { insights: rank(out, stockValue), unavailable };
}
