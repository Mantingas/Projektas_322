import type { Insight, SalesRecord } from '../types';
import { computeKpis, inSeries, listSeries, splitPeriods, type Periods, type Series, type SalesKpis } from '../sales/kpi';
import * as R from './rules';
import type { RuleContext, UnavailableReason } from './rules';

export const MAX_INSIGHTS = 10;
const MAX_PER_GROUP = 3;

const REL_W = { high: 1, medium: 0.7, low: 0.4 } as const;
const SEV_W = { risk: 1, opportunity: 0.9, info: 0.5 } as const;

export interface Normalizers {
  /** Revenue of the whole loaded history. */
  total: number;
  /** Average revenue of one comparison window (for insights about period-over-period change). */
  window: number;
}

/** Ranks by impact relative to revenue × reliability × severity × actionability. */
export function scoreInsight(i: Insight, n: Normalizers): number {
  const base = i.params.days !== undefined ? n.window : n.total;
  const rel = base > 0 ? Math.min(1, i.impact.value / base) : 0;
  return Math.round(rel * REL_W[i.reliability] * SEV_W[i.severity] * (i.actionable ? 1 : 0.6) * 10000) / 10000;
}

/** One insight per topic, bounded per story group, best first. */
export function rankInsights(all: Insight[], n: Normalizers, max = MAX_INSIGHTS): Insight[] {
  const scored = all.map((i) => ({ ...i, score: scoreInsight(i, n) })).filter((i) => i.score > 0);
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const topics = new Set<string>();
  const groups = new Map<string, number>();
  const out: Insight[] = [];
  for (const i of scored) {
    if (topics.has(i.topic)) continue;
    if ((groups.get(i.group) ?? 0) >= MAX_PER_GROUP) continue;
    topics.add(i.topic);
    groups.set(i.group, (groups.get(i.group) ?? 0) + 1);
    out.push(i);
    if (out.length >= max) break;
  }
  return out;
}

export interface SalesAnalysis {
  series: Series;
  allSeries: Series[];
  kpis: SalesKpis;
  periods: Omit<Periods, 'current' | 'previous'> | null;
  insights: Insight[];
  /** Rules that produced nothing, and why (missing data vs. nothing notable). */
  unavailable: { rule: string; reason: UnavailableReason }[];
}

export function analyzeSales(all: SalesRecord[], seriesChoice?: Pick<Series, 'currency' | 'basis'>): SalesAnalysis | null {
  const allSeries = listSeries(all);
  if (allSeries.length === 0) return null;
  const series = (seriesChoice && allSeries.find((s) => s.currency === seriesChoice.currency && s.basis === seriesChoice.basis)) || allSeries[0]!;
  const records = inSeries(all, series);
  const kpis = computeKpis(records, series)!;
  const periods = splitPeriods(records, kpis.dateMin, kpis.dateMax);
  const ctx: RuleContext = { records, kpis, periods };

  const drafts: Insight[] = [];
  const unavailable: SalesAnalysis['unavailable'] = [];
  const take = (rule: string, r: R.RuleResult) => {
    if ('insights' in r) drafts.push(...r.insights);
    else unavailable.push({ rule, reason: r.unavailable });
  };
  take('revenue_change', R.revenueChange(ctx));
  take('customers_declined', R.customersDeclined(ctx));
  take('customer_concentration', R.customerConcentration(ctx));
  take('product_pareto', R.productConcentration(ctx));
  const movers = R.productMovers(ctx);
  take('product_decline', movers[0]!);
  take('product_growth', movers[1]!);
  take('new_customers', R.newCustomers(ctx));
  take('salesperson_decline', R.salespersonDecline(ctx));
  take('margin', R.lowMargin(ctx));
  take('credit_notes', R.creditNotes(ctx));

  const sumAmt = (rs: SalesRecord[]) => rs.reduce((acc, r) => acc + r.amount, 0);
  const window = periods ? (sumAmt(periods.current) + sumAmt(periods.previous)) / 2 : kpis.revenue;
  const insights = rankInsights(drafts, { total: kpis.revenue, window });
  const periodInfo = periods
    ? { days: periods.days, currentFrom: periods.currentFrom, currentTo: periods.currentTo, previousFrom: periods.previousFrom, previousTo: periods.previousTo }
    : null;
  return { series, allSeries, kpis, periods: periodInfo, insights, unavailable };
}
