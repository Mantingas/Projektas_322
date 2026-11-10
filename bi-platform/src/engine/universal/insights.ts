import type { Insight } from '../types';
import { CHANGE_FLAG, CONCENTRATION_FLAG, MISSING_FLAG, type UniversalAnalysis } from './analyze';

/** Findings about the table itself. They describe numbers and quality; they never say whether a change is good or bad, because no meaning is assumed. */
export function universalInsights(a: UniversalAnalysis): Insight[] {
  const out: Insight[] = [];
  const base = { module: 'universal' as const, actionable: true, reliabilityReasonKey: 'rel.universal', score: 0 };
  const rel = (n: number) => (n >= 100 ? 'high' : n >= 30 ? 'medium' : 'low') as 'high' | 'medium' | 'low';
  const n = a.scope.rows;

  const worst = a.missing.filter((m) => m.share >= MISSING_FLAG);
  if (worst.length) {
    const w = worst[0]!;
    out.push({ ...base, id: 'universal.missing', topic: 'universal.quality', group: 'quality', severity: 'risk', titleKey: 'universal.missing.title', bodyKey: 'universal.missing.body', actionKey: 'universal.missing.action', whyKey: 'universal.missing.why', certainty: 'fact',
      params: { count: worst.length, column: w.header, share: { pct: w.share }, rows: n }, reliability: rel(n), impact: { value: w.share, unit: 'pct' },
      evidence: worst.slice(0, 5).map((m) => ({ key: String(m.col), label: m.header, current: m.share, unit: 'pct' as const })), score: 0.5 + w.share });
  }
  if (a.duplicates.exactRows > 0) {
    const d = a.duplicates;
    out.push({ ...base, id: 'universal.duplicates', topic: 'universal.quality', group: 'quality', severity: 'risk', titleKey: 'universal.duplicates.title', bodyKey: 'universal.duplicates.body', actionKey: 'universal.duplicates.action', whyKey: 'universal.duplicates.why', certainty: 'possible',
      params: { count: d.exactRows, groups: d.groups.length, rows: n }, reliability: 'high', impact: { value: d.exactRows, unit: 'qty' },
      evidence: d.groups.slice(0, 5).map((g) => ({ label: `#${g.rows.join(', #')}`, current: g.rows.length, unit: 'qty' as const })), score: 0.4 + Math.min(0.4, d.exactRows / Math.max(1, n)) });
  }
  const ol = a.outliers.filter((o) => o.share >= 0.005 || o.low + o.high >= 3).sort((x, y) => y.share - x.share);
  if (ol.length) {
    const o = ol[0]!;
    out.push({ ...base, id: 'universal.outliers', topic: 'universal.outliers', group: 'outliers', severity: 'info', titleKey: 'universal.outliers.title', bodyKey: 'universal.outliers.body', actionKey: 'universal.outliers.action', whyKey: 'universal.outliers.why', certainty: 'indicator',
      params: { column: o.header, count: o.low + o.high, share: { pct: o.share }, columns: ol.length, low: o.lowFence, high: o.highFence }, reliability: rel(o.n), impact: { value: o.share, unit: 'pct' },
      evidence: o.examples.map((e) => ({ label: `#${e.row}`, current: e.value, unit: 'qty' as const })), score: 0.3 + Math.min(0.3, o.share * 5) });
  }
  const ch = a.trends.filter((t) => t.latest?.flagged).sort((x, y) => Math.abs(y.latest!.pct ?? 0) - Math.abs(x.latest!.pct ?? 0));
  if (ch.length) {
    const t = ch[0]!;
    out.push({ ...base, id: 'universal.trend_change', topic: `universal.trend.${t.col}`, group: 'trend', severity: 'info', titleKey: 'universal.trend_change.title', bodyKey: 'universal.trend_change.body', actionKey: 'universal.trend_change.action', whyKey: 'universal.trend_change.why', certainty: 'fact',
      params: { column: t.header, pct: { pct: t.latest!.pct ?? 0 }, from: { date: t.latest!.from }, to: { date: t.latest!.to }, agg: t.agg, columns: ch.length }, reliability: rel(t.points.reduce((s, p) => s + p.rows, 0)), impact: { value: Math.abs(t.latest!.pct ?? 0), unit: 'pct' },
      evidence: t.points.slice(-4).map((p) => ({ label: p.bucket, current: p.value ?? 0, unit: 'qty' as const })), score: 0.5 + Math.min(0.4, Math.abs(t.latest!.pct ?? 0) / 2) });
  }
  const conc = a.ranks.filter((r) => r.topShare !== null && r.topShare >= CONCENTRATION_FLAG && r.groups >= 4).sort((x, y) => y.topShare! - x.topShare!);
  if (conc.length) {
    const r = conc[0]!;
    out.push({ ...base, id: 'universal.concentration', topic: `universal.conc.${r.dim}`, group: 'concentration', severity: 'info', titleKey: 'universal.concentration.title', bodyKey: 'universal.concentration.body', actionKey: 'universal.concentration.action', whyKey: 'universal.concentration.why', certainty: 'fact',
      params: { dim: r.dimHeader, measure: r.measureHeader, top: r.top[0]!.key, share: { pct: r.topShare! }, groups: r.groups }, reliability: rel(n), impact: { value: r.topShare!, unit: 'pct' },
      evidence: r.top.slice(0, 5).map((x) => ({ key: x.key, label: x.key, current: x.share ?? 0, unit: 'pct' as const })), score: 0.4 + r.topShare! * 0.3 });
  }
  const cr = a.correlations.filter((c) => c.meaningful && !c.redundant);
  if (cr.length) {
    const c = cr[0]!;
    out.push({ ...base, id: 'universal.correlation', topic: 'universal.corr', group: 'relationship', severity: 'info', titleKey: 'universal.correlation.title', bodyKey: 'universal.correlation.body', actionKey: 'universal.correlation.action', whyKey: 'universal.correlation.why', certainty: 'indicator',
      params: { a: c.aHeader, b: c.bHeader, r: Math.round(c.pearson * 100) / 100, rho: Math.round(c.spearman * 100) / 100, n: c.n, pairs: cr.length, sensitive: c.outlierSensitive ? 1 : 0 }, reliability: c.n >= 100 && !c.outlierSensitive ? 'high' : 'medium', impact: { value: Math.abs(c.spearman), unit: 'pct' },
      evidence: cr.slice(0, 4).map((x) => ({ label: `${x.aHeader} ~ ${x.bHeader}`, current: Math.round(x.spearman * 100) / 100, unit: 'qty' as const })), score: 0.3 + Math.abs(c.spearman) * 0.3 });
  }
  void CHANGE_FLAG;
  return out.sort((x, y) => y.score - x.score);
}
