import type { MetricComparison } from '../analytics/compare';
import type { EntityLink } from '../entities/links';
import type { CrossReason } from './cross';
import type { FinanceSide, Insight } from '../types';

export type ExecModule = 'sales' | 'purchasing' | 'inventory' | 'finance';
export type ExecSource = ExecModule | 'cross';
/** fact = read from the data · risk = something may go wrong · opportunity = potential, never guaranteed · scenario = hypothetical what-if, never counted */
export type ExecClass = 'fact' | 'risk' | 'opportunity' | 'scenario';

export interface ModuleSnapshot {
  module: ExecModule;
  side?: FinanceSide;
  series: { currency: string; basis?: string };
  /** other currency / basis series that exist but are NOT shown (never converted or added) */
  otherSeries: string[];
  window?: { from: string; to: string; prevFrom?: string; prevTo?: string };
  asOf?: string;
  kpis: MetricComparison[];
  insights: Insight[];
  trend: { x: string; y: number }[];
  bounds: { dateMin: string; dateMax: string };
  lines: number;
  imports: { fileName: string; added: number; importedAt: number; kind?: string }[];
  /** the module's own base amount, used only to judge how material a money finding is (revenue, spend, stock value, outstanding) */
  base: number | null;
  pendingHeld: number;
  unknownBasis?: boolean;
}

export const WEIGHTS = { materiality: 0.35, confidence: 0.2, urgency: 0.2, actionability: 0.15, novelty: 0.1 } as const;
export const MAX_INSIGHTS = 10;
export const MAX_KPIS = 8;
const STALE_DAYS = 45;

const URGENT = new Set(['finance.long_overdue', 'finance.due_soon', 'finance.largest_overdue', 'finance.duplicate_payments', 'inventory.stockout_risk', 'inventory.negative_stock', 'cross.stock_cover_low', 'cross.customer_exposure']);
const INCREASE = new Set(['purchasing.price_decrease', 'purchasing.supplier_price_gap']);
const REDUCE = new Set(['inventory.excess_stock', 'inventory.slow_moving', 'inventory.non_moving', 'cross.stock_excess_vs_demand', 'cross.stock_vs_purchasing']);

export interface RankedItem {
  insight: Insight;
  module: ExecSource;
  side?: FinanceSide;
  currency?: string;
  class: ExecClass;
  parts: { materiality: number; confidence: number; urgency: number; actionability: number; novelty: number };
  score: number;
  /** other findings that told the same story and were folded into this one */
  related: string[];
}
export interface ExecKpi { id: string; module: ExecModule; side?: FinanceSide; metric: MetricComparison; currency: string; basis?: string; asOf?: string; window?: { from: string; to: string } }
export interface ModuleCoverage { module: ExecModule; present: boolean; files: number; lines: number; from?: string; to?: string; lastImportedAt?: number; series: string; otherSeries: string[]; flags: ('held' | 'unknown_basis' | 'other_series' | 'stale')[]; sides?: FinanceSide[] }
export interface ExecutiveModel {
  empty: boolean;
  kpis: ExecKpi[];
  insights: RankedItem[];
  risks: RankedItem[];
  opportunities: RankedItem[];
  scenarios: RankedItem[];
  facts: RankedItem[];
  changes: ExecKpi[];
  actions: { key: string; params: Insight['params']; from: string; module: ExecSource }[];
  trends: { module: ExecModule; side?: FinanceSide; currency: string; points: { x: string; y: number }[] }[];
  coverage: ModuleCoverage[];
  suppressed: { id: string; reason: 'duplicate' | 'contradiction'; by: string; title: { key: string; params: Insight['params']; currency?: string }; byTitle: { key: string; params: Insight['params']; currency?: string } }[];
  cross: { reasons: { rule: string; reason: CrossReason }[]; confirmedLinks: number; proposedLinks: number };
  lastImportedAt?: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const classOf = (i: Insight): ExecClass => (i.savings?.kind === 'hypothetical' ? 'scenario' : i.severity === 'opportunity' || i.savings?.kind === 'potential' ? 'opportunity' : i.severity === 'risk' ? 'risk' : 'fact');
const certaintyFactor = (i: Insight) => (i.savings?.kind === 'hypothetical' ? 0.5 : i.certainty === 'possible' ? 0.7 : i.certainty === 'indicator' ? 0.8 : 1);

function partsOf(item: { insight: Insight; module: ExecSource }, base: number | null) {
  const i = item.insight;
  const mat = i.impact.unit === 'money' && base && base > 0 ? clamp01(i.impact.value / base / 0.2) : i.impact.unit === 'pct' ? Math.min(0.5, Math.abs(i.impact.value)) : Math.min(0.4, 0.15 + i.score * 0.15);
  const conf = (i.reliability === 'high' ? 1 : i.reliability === 'medium' ? 0.7 : 0.4) * certaintyFactor(i);
  const urg = URGENT.has(i.id) ? 1 : i.severity === 'risk' ? 0.6 : i.severity === 'opportunity' ? 0.4 : 0.25;
  const act = i.actionable ? 1 : 0.4;
  const moved = i.evidence.filter((e) => e.previous !== undefined && e.previous !== 0);
  const nov = moved.some((e) => Math.abs((e.current - e.previous!) / Math.abs(e.previous!)) >= 0.2) ? 1 : moved.length ? 0.7 : 0.4;
  return { materiality: mat, confidence: conf, urgency: urg, actionability: act, novelty: nov };
}
const scoreOf = (p: RankedItem['parts']) => p.materiality * WEIGHTS.materiality + p.confidence * WEIGHTS.confidence + p.urgency * WEIGHTS.urgency + p.actionability * WEIGHTS.actionability + p.novelty * WEIGHTS.novelty;

/** Findings that tell one story share a cluster; only the best of a cluster is shown. */
export function clusterOf(i: Insight, module: ExecSource, side?: FinanceSide): string {
  const id = i.id;
  if (/^finance\.(largest_overdue|long_overdue|overdue_growth|due_soon)$/.test(id)) return `overdue:${side ?? ''}`;
  if (id === 'sales.customer_concentration' || id === 'cross.customer_exposure' || (id === 'finance.concentration' && side === 'receivable')) return 'customer_risk';
  if (id === 'purchasing.supplier_concentration' || (id === 'finance.concentration' && side === 'payable')) return 'supplier_risk';
  if (/^purchasing\.(price_increase|supplier_cost_increase|spend_change|spend_anomaly)$/.test(id) || id === 'cross.margin_squeeze') return 'cost_pressure';
  if (/^purchasing\.(price_decrease|supplier_price_gap)$/.test(id)) return 'purchase_savings';
  if (REDUCE.has(id)) return 'stock_overhang';
  if (id === 'inventory.stockout_risk' || id === 'cross.stock_cover_low') return 'stock_risk';
  if (/^sales\.(revenue_change|product_decline|customers_declined|salesperson_decline)$/.test(id)) return 'sales_decline';
  if (/^sales\.(product_growth|new_customers)$/.test(id)) return 'sales_growth';
  void module;
  return id;
}

/** Union of product identities that the user CONFIRMED to be the same item across modules. */
function productGroups(links: EntityLink[]) {
  const parent = new Map<string, string>();
  const find = (x: string): string => { let p = parent.get(x) ?? x; if (p !== x) { p = find(p); parent.set(x, p); } return p; };
  for (const l of links) {
    if (l.status !== 'confirmed' || l.kind !== 'product') continue;
    const a = `${l.a.module}|${l.a.key}`, b = `${l.b.module}|${l.b.key}`;
    parent.set(find(a), find(b));
  }
  return { of: (module: string, key: string) => find(`${module}|${key}`), linked: (module: string, key: string) => parent.has(`${module}|${key}`) || [...parent.values()].includes(`${module}|${key}`) };
}

function productIds(r: RankedItem, links: EntityLink[], g: ReturnType<typeof productGroups>): Set<string> {
  const out = new Set<string>();
  if (r.module === 'cross') {
    for (const d of r.insight.cross?.links ?? []) {
      const l = links.find((x) => x.id === d.id);
      if (l) { out.add(g.of(l.a.module, l.a.key)); out.add(g.of(l.b.module, l.b.key)); }
    }
    return out;
  }
  for (const e of r.insight.evidence) if (e.key && /^(sku|name):/.test(e.key)) out.add(g.of(r.module === 'finance' ? 'finance' : r.module, e.key));
  return out;
}

export interface ComposeInput { snapshots: ModuleSnapshot[]; cross: { insights: Insight[]; unavailable: { rule: string; reason: CrossReason }[] }; links: EntityLink[]; proposedLinks?: number; now?: number }

export function composeExecutive(inp: ComposeInput): ExecutiveModel {
  const snaps = inp.snapshots;
  const confirmed = inp.links.filter((l) => l.status === 'confirmed');
  const empty = snaps.length === 0;

  // ── KPI cards: only metrics the data supports, one per module/side, never added together
  const order: { module: ExecModule; side?: FinanceSide; id: string }[] = [
    { module: 'sales', id: 'sales' }, { module: 'purchasing', id: 'p_spend' }, { module: 'inventory', id: 'i_value' },
    { module: 'finance', side: 'receivable', id: 'f_outstanding' }, { module: 'finance', side: 'receivable', id: 'f_overdue' },
    { module: 'finance', side: 'payable', id: 'f_outstanding' }, { module: 'sales', id: 'margin' }, { module: 'finance', side: 'payable', id: 'f_overdue' },
  ];
  const kpis: ExecKpi[] = [];
  for (const o of order) {
    const s = snaps.find((x) => x.module === o.module && x.side === o.side);
    const m = s?.kpis.find((k) => k.id === o.id);
    if (!s || !m || m.current === null) continue;
    kpis.push({ id: o.id, module: o.module, side: o.side, metric: m, currency: s.series.currency, basis: s.series.basis, asOf: s.asOf, window: s.window && { from: s.window.from, to: s.window.to } });
  }
  const shownKpis = kpis.slice(0, MAX_KPIS);

  // ── ranking
  const baseOf = (m: ExecSource, side?: FinanceSide) => snaps.find((s) => s.module === m && s.side === side)?.base ?? null;
  const items: RankedItem[] = [];
  for (const s of snaps) {
    for (const i of s.insights) {
      const it = { insight: i, module: s.module as ExecSource };
      const parts = partsOf(it, s.base);
      items.push({ ...it, side: s.side, currency: s.series.currency, class: classOf(i), parts, score: scoreOf(parts), related: [] });
    }
  }
  for (const i of inp.cross.insights) {
    const money = i.impact.unit === 'money';
    const srcs = i.cross?.sources ?? [];
    const base = money ? Math.max(0, ...srcs.map((x) => (x.module === 'finance' ? baseOf('finance', 'receivable') : baseOf(x.module)) ?? 0)) : null;
    const it = { insight: i, module: 'cross' as ExecSource };
    const parts = partsOf(it, base || null);
    items.push({ ...it, currency: srcs.find((x) => x.currency)?.currency, class: classOf(i), parts, score: scoreOf(parts), related: [] });
  }
  items.sort((a, b) => b.score - a.score || a.insight.id.localeCompare(b.insight.id));

  // ── contradictions first (buying more of something that is piling up), then one finding per story
  const suppressed: ExecutiveModel['suppressed'] = [];
  const sup = (a: RankedItem, b: RankedItem, reason: 'duplicate' | 'contradiction'): ExecutiveModel['suppressed'][number] => ({ id: a.insight.id, reason, by: b.insight.id, title: { key: a.insight.titleKey, params: a.insight.params, currency: a.currency }, byTitle: { key: b.insight.titleKey, params: b.insight.params, currency: b.currency } });
  const g = productGroups(inp.links);
  const ids = new Map(items.map((r) => [r, productIds(r, inp.links, g)]));
  const dropped = new Set<RankedItem>();
  for (const a of items) {
    if (!INCREASE.has(a.insight.id)) continue;
    for (const b of items) {
      if (!REDUCE.has(b.insight.id) || dropped.has(b)) continue;
      const shared = [...ids.get(a)!].some((x) => ids.get(b)!.has(x) && g.linked(x.split('|')[0]!, x.split('|').slice(1).join('|')));
      if (shared) { dropped.add(a); suppressed.push(sup(a, b, 'contradiction')); break; }
    }
  }
  const kept = new Map<string, RankedItem>();
  for (const r of items) {
    if (dropped.has(r)) continue;
    const c = clusterOf(r.insight, r.module, r.side);
    const k = kept.get(c);
    if (!k) kept.set(c, r);
    else { k.related.push(r.insight.id); suppressed.push(sup(r, k, 'duplicate')); }
  }
  const ranked = [...kept.values()].sort((a, b) => b.score - a.score || a.insight.id.localeCompare(b.insight.id));
  const top = ranked.slice(0, MAX_INSIGHTS);

  // ── views
  const byClass = (c: ExecClass) => top.filter((r) => r.class === c);
  const actions: ExecutiveModel['actions'] = [];
  const seenAct = new Set<string>();
  for (const r of top) {
    if (!r.insight.actionable || seenAct.has(r.insight.actionKey)) continue;
    seenAct.add(r.insight.actionKey);
    actions.push({ key: r.insight.actionKey, params: r.insight.params, from: r.insight.id, module: r.module });
    if (actions.length >= 5) break;
  }
  const changes = [...kpis].filter((k) => k.metric.pct !== null).sort((a, b) => Math.abs(b.metric.pct!) - Math.abs(a.metric.pct!)).slice(0, 5);

  // ── coverage and quality
  const latest = snaps.reduce((m, s) => (s.bounds.dateMax > m ? s.bounds.dateMax : m), '');
  const mods: ExecModule[] = ['sales', 'purchasing', 'inventory', 'finance'];
  const coverage: ModuleCoverage[] = mods.map((m) => {
    const ss = snaps.filter((s) => s.module === m);
    if (!ss.length) return { module: m, present: false, files: 0, lines: 0, series: '', otherSeries: [], flags: [] };
    const s0 = ss[0]!;
    const imports = ss.flatMap((s) => s.imports);
    const uniq = [...new Map(imports.map((i) => [i.fileName + i.importedAt, i])).values()];
    const flags: ModuleCoverage['flags'] = [];
    if (ss.some((s) => s.pendingHeld > 0)) flags.push('held');
    if (ss.some((s) => s.unknownBasis)) flags.push('unknown_basis');
    if (ss.some((s) => s.otherSeries.length)) flags.push('other_series');
    const to = ss.reduce((a, s) => (s.bounds.dateMax > a ? s.bounds.dateMax : a), '');
    if (latest && (Date.parse(latest) - Date.parse(to)) / 86400000 > STALE_DAYS) flags.push('stale');
    return {
      module: m, present: true, files: uniq.length, lines: Math.max(...ss.map((s) => s.lines)), from: ss.reduce((a, s) => (a === '' || s.bounds.dateMin < a ? s.bounds.dateMin : a), ''), to,
      lastImportedAt: Math.max(...imports.map((i) => i.importedAt), 0) || undefined, series: s0.series.basis ? `${s0.series.currency} · ${s0.series.basis}` : s0.series.currency, otherSeries: [...new Set(ss.flatMap((s) => s.otherSeries))], flags,
      sides: m === 'finance' ? (ss.map((s) => s.side!).filter(Boolean)) : undefined,
    };
  });
  const lastImportedAt = Math.max(0, ...coverage.map((c) => c.lastImportedAt ?? 0)) || undefined;

  return {
    empty, kpis: shownKpis, insights: top, risks: byClass('risk'), opportunities: byClass('opportunity'), scenarios: byClass('scenario'), facts: byClass('fact'), changes, actions,
    trends: snaps.filter((s) => s.trend.length >= 3).map((s) => ({ module: s.module, side: s.side, currency: s.series.currency, points: s.trend })), coverage, suppressed,
    cross: { reasons: inp.cross.unavailable, confirmedLinks: confirmed.length, proposedLinks: inp.proposedLinks ?? 0 }, lastImportedAt,
  };
}
