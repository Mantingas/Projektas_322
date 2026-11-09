import type { Insight, SalesRecord } from '../types';
import {
  customerOf, groupBy, productOf, salespersonOf, sum, type Group, type Periods, type SalesKpis,
} from '../sales/kpi';
import { pctChange, reliabilityFor } from './helpers';

export interface RuleContext {
  records: SalesRecord[];
  kpis: SalesKpis;
  periods: Periods | null;
}

export type RuleResult = { insights: Insight[] } | { unavailable: UnavailableReason };
export type UnavailableReason = 'no_customer' | 'no_product' | 'no_salesperson' | 'no_cost' | 'short_history' | 'no_documents' | 'nothing_found';

type Draft = Omit<Insight, 'score' | 'module' | 'actionable'> & { actionable?: boolean };
const ok = (...d: Draft[]): RuleResult => ({ insights: d.map((x) => ({ ...x, module: 'sales', actionable: x.actionable ?? true, score: 0 })) });
const top = <T>(xs: T[], n: number, by: (x: T) => number) => [...xs].sort((a, b) => by(b) - by(a)).slice(0, n);

/** Shared: per-entity current/previous revenue. */
function compare(ctx: RuleContext, by: Parameters<typeof groupBy>[1]) {
  const p = ctx.periods!;
  const cur = groupBy(p.current, by);
  const prev = groupBy(p.previous, by);
  const keys = new Set([...cur.keys(), ...prev.keys()]);
  return [...keys].map((k) => {
    const c = cur.get(k);
    const o = prev.get(k);
    return { key: k, label: (c ?? o)!.label, current: c?.revenue ?? 0, previous: o?.revenue ?? 0, previousLines: o?.lines ?? 0, currentLines: c?.lines ?? 0 };
  });
}

// 1 ────────────────────────────────────────────────────────────────────────────
export function revenueChange(ctx: RuleContext): RuleResult {
  const p = ctx.periods;
  if (!p) return { unavailable: 'short_history' };
  const cur = sum(p.current.map((r) => r.amount));
  const prev = sum(p.previous.map((r) => r.amount));
  if (p.previous.length === 0 || prev <= 0) return { unavailable: 'short_history' };
  const change = pctChange(cur, prev);
  if (Math.abs(change) < 0.05) return { unavailable: 'nothing_found' };
  const rel = reliabilityFor(Math.min(p.current.length, p.previous.length), p.days);
  const down = change < 0;
  return ok({
    id: 'sales.revenue_change', whyKey: 'sales.revenue_change.why', chart: 'comparison',
    topic: 'revenue_trend',
    group: down ? 'decline' : 'growth',
    severity: down ? 'risk' : 'opportunity',
    titleKey: down ? 'sales.revenue_change.title_down' : 'sales.revenue_change.title_up',
    bodyKey: 'sales.revenue_change.body',
    actionKey: down ? 'sales.revenue_change.action_down' : 'sales.revenue_change.action_up',
    params: { pct: { pct: Math.abs(change) }, current: { money: cur }, previous: { money: prev }, delta: { money: Math.abs(cur - prev) }, days: p.days, from: { date: p.currentFrom }, to: { date: p.currentTo }, pfrom: { date: p.previousFrom }, pto: { date: p.previousTo } },
    reliability: rel.level,
    reliabilityReasonKey: rel.reasonKey,
    impact: { value: Math.abs(cur - prev), unit: 'money' },
    evidence: [{ label: 'period', current: cur, previous: prev, unit: 'money' }],
  });
}

// 2 ────────────────────────────────────────────────────────────────────────────
export function customersDeclined(ctx: RuleContext): RuleResult {
  if (!ctx.records.some((r) => customerOf(r))) return { unavailable: 'no_customer' };
  if (!ctx.periods) return { unavailable: 'short_history' };
  const prevTotal = sum(ctx.periods.previous.map((r) => r.amount));
  const minPrev = Math.max(prevTotal * 0.005, 1);
  const rows = compare(ctx, customerOf).filter((x) => x.previous >= minPrev && x.current <= x.previous * 0.7);
  if (rows.length === 0) return { unavailable: 'nothing_found' };
  const lost = rows.filter((x) => x.current === 0).length;
  const loss = sum(rows.map((x) => x.previous - x.current));
  const rel = reliabilityFor(sum(rows.map((x) => x.previousLines)), ctx.periods.days);
  return ok({
    id: 'sales.customers_declined', whyKey: 'sales.customers_declined.why', dimension: 'customer', chart: 'waterfall',
    topic: 'customers_declined',
    group: 'decline',
    severity: 'risk',
    titleKey: 'sales.customers_declined.title',
    bodyKey: 'sales.customers_declined.body',
    actionKey: 'sales.customers_declined.action',
    params: { count: rows.length, lost, loss: { money: loss }, days: ctx.periods.days },
    reliability: rel.level,
    reliabilityReasonKey: rel.reasonKey,
    impact: { value: loss, unit: 'money' },
    evidence: top(rows, 5, (x) => x.previous - x.current).map((x) => ({ key: x.key, label: x.label, current: x.current, previous: x.previous, unit: 'money' as const })),
  });
}

// 3 ────────────────────────────────────────────────────────────────────────────
export function customerConcentration(ctx: RuleContext): RuleResult {
  const groups = [...groupBy(ctx.records.filter((r) => r.amount > 0), customerOf).values()];
  if (groups.length === 0) return { unavailable: 'no_customer' };
  if (groups.length < 4) return { unavailable: 'nothing_found' };
  const total = sum(groups.map((g) => g.revenue));
  if (total <= 0) return { unavailable: 'nothing_found' };
  const sorted = top(groups, groups.length, (g) => g.revenue);
  const top1 = sorted[0]!.revenue / total;
  const top3 = sum(sorted.slice(0, 3).map((g) => g.revenue)) / total;
  if (top1 < 0.25 && top3 < 0.6) return { unavailable: 'nothing_found' };
  const rel = reliabilityFor(sum(sorted.map((g) => g.lines)));
  return ok({
    id: 'sales.customer_concentration', whyKey: 'sales.customer_concentration.why', dimension: 'customer', chart: 'pareto',
    topic: 'customer_concentration',
    group: 'concentration',
    severity: 'risk',
    titleKey: 'sales.customer_concentration.title',
    bodyKey: 'sales.customer_concentration.body',
    actionKey: 'sales.customer_concentration.action',
    params: { name: sorted[0]!.label, top1: { pct: top1 }, top3: { pct: top3 }, customers: groups.length },
    reliability: rel.level,
    reliabilityReasonKey: rel.reasonKey,
    impact: { value: sum(sorted.slice(0, 3).map((g) => g.revenue)), unit: 'money' },
    evidence: sorted.slice(0, 5).map((g) => ({ key: g.key, label: g.label, current: g.revenue, unit: 'money' as const })),
  });
}

// 4 ────────────────────────────────────────────────────────────────────────────
export function productConcentration(ctx: RuleContext): RuleResult {
  const groups = [...groupBy(ctx.records.filter((r) => r.amount > 0), productOf).values()];
  if (groups.length === 0) return { unavailable: 'no_product' };
  if (groups.length < 10) return { unavailable: 'nothing_found' };
  const sorted = top(groups, groups.length, (g) => g.revenue);
  const total = sum(sorted.map((g) => g.revenue));
  let acc = 0;
  let n = 0;
  for (const g of sorted) {
    acc += g.revenue;
    n++;
    if (acc >= total * 0.8) break;
  }
  const share = n / sorted.length;
  if (share > 0.3) return { unavailable: 'nothing_found' };
  const rel = reliabilityFor(sum(sorted.map((g) => g.lines)));
  return ok({
    id: 'sales.product_pareto', whyKey: 'sales.product_pareto.why', dimension: 'product', chart: 'pareto',
    topic: 'product_concentration',
    group: 'concentration',
    severity: 'info',
    titleKey: 'sales.product_pareto.title',
    bodyKey: 'sales.product_pareto.body',
    actionKey: 'sales.product_pareto.action',
    params: { n, total: sorted.length, share: { pct: share }, rest: { money: total - acc } },
    reliability: rel.level,
    reliabilityReasonKey: rel.reasonKey,
    impact: { value: total - acc, unit: 'money' },
    evidence: sorted.slice(0, 5).map((g) => ({ key: g.key, label: g.label, current: g.revenue, unit: 'money' as const })),
  });
}

// 5 ────────────────────────────────────────────────────────────────────────────
export function productMovers(ctx: RuleContext): RuleResult[] {
  if (!ctx.records.some((r) => productOf(r))) return [{ unavailable: 'no_product' }, { unavailable: 'no_product' }];
  if (!ctx.periods) return [{ unavailable: 'short_history' }, { unavailable: 'short_history' }];
  const prevTotal = sum(ctx.periods.previous.map((r) => r.amount));
  const rows = compare(ctx, productOf);
  const minPrev = Math.max(prevTotal * 0.01, 1);
  const down = rows.filter((x) => x.previous >= minPrev && x.current <= x.previous * 0.8);
  const up = rows.filter((x) => x.current - x.previous >= Math.max(prevTotal * 0.01, 1) && x.previous > 0 && x.current >= x.previous * 1.2);
  const days = ctx.periods.days;
  const out: RuleResult[] = [];
  if (down.length) {
    const rel = reliabilityFor(sum(down.map((x) => x.previousLines)), days);
    out.push(ok({
      id: 'sales.product_decline', whyKey: 'sales.product_decline.why', dimension: 'product', chart: 'waterfall', topic: 'product_decline', group: 'decline', severity: 'risk',
      titleKey: 'sales.product_decline.title', bodyKey: 'sales.product_decline.body', actionKey: 'sales.product_decline.action',
      params: { count: down.length, loss: { money: sum(down.map((x) => x.previous - x.current)) }, name: top(down, 1, (x) => x.previous - x.current)[0]!.label, days },
      reliability: rel.level, reliabilityReasonKey: rel.reasonKey,
      impact: { value: sum(down.map((x) => x.previous - x.current)), unit: 'money' },
      evidence: top(down, 5, (x) => x.previous - x.current).map((x) => ({ key: x.key, label: x.label, current: x.current, previous: x.previous, unit: 'money' as const })),
    }));
  } else out.push({ unavailable: 'nothing_found' });
  if (up.length) {
    const rel = reliabilityFor(sum(up.map((x) => x.currentLines)), days);
    out.push(ok({
      id: 'sales.product_growth', whyKey: 'sales.product_growth.why', dimension: 'product', chart: 'waterfall', topic: 'product_growth', group: 'growth', severity: 'opportunity',
      titleKey: 'sales.product_growth.title', bodyKey: 'sales.product_growth.body', actionKey: 'sales.product_growth.action',
      params: { count: up.length, gain: { money: sum(up.map((x) => x.current - x.previous)) }, name: top(up, 1, (x) => x.current - x.previous)[0]!.label, days },
      reliability: rel.level, reliabilityReasonKey: rel.reasonKey,
      impact: { value: sum(up.map((x) => x.current - x.previous)), unit: 'money' },
      evidence: top(up, 5, (x) => x.current - x.previous).map((x) => ({ key: x.key, label: x.label, current: x.current, previous: x.previous, unit: 'money' as const })),
    }));
  } else out.push({ unavailable: 'nothing_found' });
  return out;
}

// 6 ────────────────────────────────────────────────────────────────────────────
export function newCustomers(ctx: RuleContext): RuleResult {
  if (!ctx.records.some((r) => customerOf(r))) return { unavailable: 'no_customer' };
  const p = ctx.periods;
  if (!p) return { unavailable: 'short_history' };
  const before = new Set<string>();
  for (const r of ctx.records) {
    if (r.date < p.currentFrom) {
      const c = customerOf(r);
      if (c) before.add(c.key);
    }
  }
  if (before.size === 0) return { unavailable: 'short_history' };
  const cur = [...groupBy(p.current, customerOf).values()].filter((g) => !before.has(g.key) && g.revenue > 0);
  const total = sum(p.current.map((r) => r.amount));
  const rev = sum(cur.map((g) => g.revenue));
  if (cur.length === 0 || total <= 0 || rev / total < 0.05) return { unavailable: 'nothing_found' };
  const rel = reliabilityFor(sum(cur.map((g) => g.lines)), p.days);
  return ok({
    id: 'sales.new_customers', whyKey: 'sales.new_customers.why', dimension: 'customer', chart: 'topCustomers', topic: 'new_customers', group: 'growth', severity: 'opportunity',
    titleKey: 'sales.new_customers.title', bodyKey: 'sales.new_customers.body', actionKey: 'sales.new_customers.action',
    params: { count: cur.length, revenue: { money: rev }, share: { pct: rev / total }, since: { date: ctx.kpis.dateMin } },
    reliability: rel.level === 'high' ? 'medium' : rel.level, // "new" is only relative to the loaded history
    reliabilityReasonKey: 'rel.limitedHistory',
    impact: { value: rev, unit: 'money' },
    evidence: top(cur, 5, (g) => g.revenue).map((g) => ({ key: g.key, label: g.label, current: g.revenue, unit: 'money' as const })),
  });
}

// 7 ────────────────────────────────────────────────────────────────────────────
export function salespersonDecline(ctx: RuleContext): RuleResult {
  if (!ctx.records.some((r) => salespersonOf(r))) return { unavailable: 'no_salesperson' };
  if (!ctx.periods) return { unavailable: 'short_history' };
  const prevTotal = sum(ctx.periods.previous.map((r) => r.amount));
  const rows = compare(ctx, salespersonOf).filter((x) => x.previous >= Math.max(prevTotal * 0.05, 1) && x.current <= x.previous * 0.8);
  if (rows.length === 0) return { unavailable: 'nothing_found' };
  const worst = top(rows, 1, (x) => x.previous - x.current)[0]!;
  const rel = reliabilityFor(worst.previousLines, ctx.periods.days);
  return ok({
    id: 'sales.salesperson_decline', whyKey: 'sales.salesperson_decline.why', dimension: 'salesperson', chart: 'salespeople', topic: 'salesperson_decline', group: 'decline', severity: 'risk',
    titleKey: 'sales.salesperson_decline.title', bodyKey: 'sales.salesperson_decline.body', actionKey: 'sales.salesperson_decline.action',
    params: { count: rows.length, name: worst.label, pct: { pct: pctChange(worst.current, worst.previous) * -1 }, loss: { money: worst.previous - worst.current }, days: ctx.periods.days },
    reliability: rel.level, reliabilityReasonKey: rel.reasonKey,
    impact: { value: sum(rows.map((x) => x.previous - x.current)), unit: 'money' },
    evidence: top(rows, 5, (x) => x.previous - x.current).map((x) => ({ key: x.key, label: x.label, current: x.current, previous: x.previous, unit: 'money' as const })),
  });
}

// 8 ────────────────────────────────────────────────────────────────────────────
export function lowMargin(ctx: RuleContext): RuleResult {
  const m = ctx.kpis.margin;
  if (!m) return { unavailable: 'no_cost' }; // no cost column, VAT basis not net, or <80 % coverage → no margin claims
  const products = [...groupBy(ctx.records.filter((r) => r.amount > 0 && r.cost !== undefined), productOf).values()];
  const rel = reliabilityFor(ctx.kpis.lines);
  const low = products.filter((g: Group) => g.revenueWithCost >= ctx.kpis.revenue * 0.01 && (g.revenueWithCost - g.cost) / g.revenueWithCost < Math.min(0.1, m.marginPct / 2));
  if (low.length === 0) {
    return ok({
      id: 'sales.margin_overview', whyKey: 'sales.margin_overview.why', dimension: 'product', chart: 'topProducts', topic: 'margin', group: 'margin', severity: 'info', actionable: false,
      titleKey: 'sales.margin_overview.title', bodyKey: 'sales.margin_overview.body', actionKey: 'sales.margin_overview.action',
      params: { margin: { pct: m.marginPct }, profit: { money: m.profit }, coverage: { pct: m.costCoverage } },
      reliability: m.costCoverage >= 0.95 ? rel.level : 'medium', reliabilityReasonKey: m.costCoverage >= 0.95 ? rel.reasonKey : 'rel.partialCost',
      impact: { value: Math.abs(m.profit), unit: 'money' }, evidence: [],
    });
  }
  const lowRev = sum(low.map((g) => g.revenueWithCost));
  return ok({
    id: 'sales.low_margin_products', whyKey: 'sales.low_margin_products.why', dimension: 'product', chart: 'topProducts', topic: 'margin', group: 'margin', severity: 'risk',
    titleKey: 'sales.low_margin_products.title', bodyKey: 'sales.low_margin_products.body', actionKey: 'sales.low_margin_products.action',
    params: { count: low.length, revenue: { money: lowRev }, margin: { pct: m.marginPct }, coverage: { pct: m.costCoverage } },
    reliability: m.costCoverage >= 0.95 ? rel.level : 'medium', reliabilityReasonKey: m.costCoverage >= 0.95 ? rel.reasonKey : 'rel.partialCost',
    impact: { value: lowRev, unit: 'money' },
    evidence: top(low, 5, (g) => g.revenueWithCost).map((g) => ({ key: g.key, label: g.label, current: (g.revenueWithCost - g.cost) / g.revenueWithCost, unit: 'pct' as const })),
  });
}

// 9 ────────────────────────────────────────────────────────────────────────────
export function creditNotes(ctx: RuleContext): RuleResult {
  const neg = ctx.records.filter((r) => r.amount < 0);
  const pos = sum(ctx.records.filter((r) => r.amount > 0).map((r) => r.amount));
  const negSum = Math.abs(sum(neg.map((r) => r.amount)));
  if (neg.length === 0 || pos <= 0 || negSum / pos < 0.02) return { unavailable: 'nothing_found' };
  const rel = reliabilityFor(neg.length);
  const byCustomer = [...groupBy(neg, customerOf).values()];
  return ok({
    id: 'sales.credit_notes', whyKey: 'sales.credit_notes.why', dimension: 'customer', chart: 'trend', topic: 'credit_notes', group: 'quality', severity: 'risk',
    titleKey: 'sales.credit_notes.title', bodyKey: 'sales.credit_notes.body', actionKey: 'sales.credit_notes.action',
    params: { lines: neg.length, amount: { money: negSum }, share: { pct: negSum / pos } },
    reliability: rel.level, reliabilityReasonKey: rel.reasonKey,
    impact: { value: negSum, unit: 'money' },
    evidence: top(byCustomer, 5, (g) => Math.abs(g.revenue)).map((g) => ({ key: g.key, label: g.label, current: Math.abs(g.revenue), unit: 'money' as const })),
  });
}
