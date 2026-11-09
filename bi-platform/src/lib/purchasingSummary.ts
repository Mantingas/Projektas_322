import type { FilterSpec } from '@/engine/analytics/filters';
import type { PurchasingView } from '@/engine/purchasing/dashboard';
import type { Insight } from '@/engine/types';
import { topBottom } from '@/engine/analytics/compare';
import { hBarSvg, lineChartSvg, waterfallSvg } from '@/engine/report/svg';
import type { SummaryDoc } from '@/engine/report/summary';
import type { ReportInput } from '@/engine/report/export';
import { changeText, dateRange, fmtUnit, limitationText, metricLabel, warningText, type T } from './dashFormat';
import { formatEvidence, formatImpact, renderInsight } from './report';
import { filtersText } from './summary';
import { fmtDate, money, translate, type Lang, type MessageKey } from '@/i18n';

const SAV = ['actual', 'potential', 'hypothetical'] as const;

/** One line per savings kind. The kinds are never added together. */
export function savingsLines(insights: Insight[], lang: Lang, cur: string, t: T): string[] {
  return SAV.flatMap((k) => {
    const xs = insights.filter((i) => i.savings?.kind === k);
    if (!xs.length) return [];
    const total = xs.reduce((s, i) => s + (i.savings?.amount ?? 0), 0);
    return [`${t(`sav.${k}` as MessageKey)}: ${money(total, { lang, currency: cur })} – ${t(`sav.${k}.d` as MessageKey)}`];
  });
}

export function purchasingExecutiveLines(view: PurchasingView, insights: Insight[], lang: Lang, t: T): string[] {
  const cur = view.series.currency;
  const s = view.kpis.find((k) => k.id === 'p_spend');
  const lines: string[] = [];
  if (s && s.current !== null) {
    const label = metricLabel('p_spend', view.series.basis, t);
    const value = fmtUnit('money', s.current, lang, cur);
    if (s.abs !== null && s.status !== 'blocked' && s.status !== 'no_previous_value' && s.direction) {
      const key = s.direction === 'up' ? 'mgr.sum.up' : s.direction === 'down' ? 'mgr.sum.down' : 'mgr.sum.flat';
      lines.push(t(key as MessageKey, { label, value, pct: s.pct !== null ? { pct: Math.abs(s.pct) } : '–', abs: fmtUnit('money', Math.abs(s.abs), lang, cur) }));
    } else lines.push(t('mgr.sum.none', { label, value }));
  }
  const risk = insights.find((i) => i.severity === 'risk');
  const opp = insights.find((i) => i.severity === 'opportunity');
  if (risk) lines.push(t('mgr.sum.risk', { title: renderInsight(risk, lang, cur).title }));
  if (opp) lines.push(t('mgr.sum.opp', { title: renderInsight(opp, lang, cur).title }));
  lines.push(...savingsLines(insights, lang, cur, t));
  return lines;
}

const insightRow = (i: Insight, lang: Lang, cur: string, t: T) => {
  const r = renderInsight(i, lang, cur);
  const kind = i.savings ? ` · ${t(`sav.${i.savings.kind}` as MessageKey)}` : '';
  return { r, kind, impact: `${formatImpact(i, lang, cur)}${kind}`, sufficiency: `${t(`rel.${i.reliability}` as MessageKey)} (${r.reliabilityReason})` };
};

export function buildPurchasingSummaryDoc(view: PurchasingView, insights: Insight[], lang: Lang, labels: Record<string, string>, filters: FilterSpec): SummaryDoc {
  const cur = view.series.currency;
  const t: T = (k, p) => translate(lang, k, p, cur);
  const m = (n: number) => money(n, { lang, currency: cur });
  const p = view.periods;
  const compact = (n: number) => new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const kpis = view.kpis.filter((k) => k.current !== null).map((k) => {
    const ch = changeText(k, lang, cur, t);
    return { label: metricLabel(k.id, view.series.basis, t), current: fmtUnit(k.unit, k.current!, lang, cur), previous: k.previous !== null ? fmtUnit(k.unit, k.previous, lang, cur) : '–', change: ch.text, note: '', tone: ch.tone };
  });
  if (view.priceChange) {
    const l = view.priceChange;
    kpis.push({ label: t('pc.title'), current: `${l.pct > 0 ? '+' : l.pct < 0 ? '−' : ''}${new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 1 }).format(Math.abs(l.pct))}`, previous: '–', change: t('pc.extra', { extra: m(l.extra) }), note: t('pc.coverage', { pairs: l.pairs, pct: { pct: l.coverage } }), tone: l.pct > 0 ? 'bad' : l.pct < 0 ? 'good' : 'flat' });
  }
  const period = t('per.describe', { cfrom: fmtDate(p.current.from, lang), cto: fmtDate(p.current.to, lang), cdays: p.currentDays, pfrom: fmtDate(p.previous.from, lang), pto: fmtDate(p.previous.to, lang), pdays: p.previousDays });
  const unit = t('ch.unit', { currency: cur });
  const charts: SummaryDoc['charts'] = [];
  if (view.comparable && view.aligned.points.length >= 3) {
    charts.push({ title: t('pch.comparison'), note: `${period} · ${unit}`, svg: lineChartSvg({ title: t('pch.comparison'), xLabels: view.aligned.points.map((x) => String(x.index + 1)), yFormat: compact, series: [{ name: t('per.current'), values: view.aligned.points.map((x) => x.current) }, { name: t('per.previous'), values: view.aligned.points.map((x) => x.previous), dashed: true }] }) });
  } else if (view.trend.filter((x) => x.lines > 0).length >= 3) {
    charts.push({ title: t('pch.trend'), note: `${dateRange(view.bounds.dateMin, view.bounds.dateMax, lang)} · ${unit}`, svg: lineChartSvg({ title: t('pch.trend'), xLabels: view.trend.map((x) => fmtDate(x.start, lang).slice(0, 5)), yFormat: compact, series: [{ name: t('ch.spend'), values: view.trend.map((x) => x.revenue) }] }) });
  }
  const sp = view.kpis.find((k) => k.id === 'p_spend');
  if (view.bridge && sp && sp.current !== null && sp.previous !== null) {
    const b = view.bridge;
    const steps = [[t('br.price'), b.price], [t('br.mix'), b.supplierMix], [t('br.volume'), b.volume], [t('br.new'), b.newItems], [t('br.lost'), b.lostItems], [t('br.credits'), b.credits], [t('br.unassigned'), b.unassigned]] as const;
    charts.push({ title: t('pch.bridge'), note: `${period} · ${unit}`, svg: waterfallSvg({ title: t('pch.bridge'), start: { label: t('br.start'), value: sp.previous }, end: { label: t('br.end'), value: sp.current }, steps: steps.filter(([, d]) => d !== 0).map(([label, delta]) => ({ label, delta })), format: compact }) });
  }
  if (view.tables.supplier && view.charts.find((c) => c.id === 'topSuppliers')?.available) {
    const { top } = topBottom(view.tables.supplier.rows, 8);
    charts.push({ title: t('ch.topSuppliers'), note: `${dateRange(p.current.from, p.current.to, lang)} · ${unit}`, svg: hBarSvg({ title: t('ch.topSuppliers'), items: top.map((r) => ({ label: r.label, value: r.current, display: m(r.current) })) }) });
  }
  const f = filtersText(filters, labels);
  const limits = [...view.warnings.map((w) => warningText(w, t)), ...view.limitations.map((l) => limitationText(l, t))];
  return {
    lang, title: t('prep.title'), subtitle: `${cur} · ${t(`basis.${view.series.basis}` as MessageKey)}`, generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    periodLine: period, filtersLine: f ? `${t('rep.filters')}: ${f}` : undefined,
    executive: purchasingExecutiveLines(view, insights, lang, t), kpis, charts,
    insights: insights.map((i) => {
      const x = insightRow(i, lang, cur, t);
      return { title: x.r.title, body: x.r.body, impact: x.impact, contributors: i.evidence.filter((e) => e.label !== 'period').map((e) => formatEvidence(e, lang, cur)), why: t(i.whyKey as MessageKey), action: x.r.action, sufficiency: x.sufficiency };
    }),
    limitations: limits.length ? limits : ['–'],
    methodology: (['pan.m1', 'pan.m2', 'pan.m3', 'pan.m4', 'pan.m5'] as const).map((k) => t(k)),
    labels: { executive: t('mgr.summary'), kpi: t('rep.kpiTable'), metric: t('rep.metric'), current: t('kpi.current'), previous: t('kpi.previous'), change: t('kpi.change'), charts: t('rep.charts'), insights: t('rep.insights'), contributors: t('ins.contributors'), why: t('ins.why'), action: t('ins.action'), sufficiency: t('ins.sufficiency'), impact: t('ins.impact'), limitations: t('rep.limitations'), methodology: t('rep.methodology'), association: t('ins.association'), footer: t('rep.local') },
  };
}

/** Insights CSV (same builder as sales). The savings kind is part of the impact cell so it cannot be separated from the amount. */
export function buildPurchasingReport(view: PurchasingView, insights: Insight[], lang: Lang): ReportInput {
  const cur = view.series.currency;
  const t: T = (k, p) => translate(lang, k, p, cur);
  const sp = view.kpis.find((k) => k.id === 'p_spend');
  return {
    title: t('prep.title'), subtitle: `${cur}, ${t(`basis.${view.series.basis}` as MessageKey)}`, generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '), lang,
    kpis: [...(sp && sp.current !== null ? [{ label: metricLabel('p_spend', view.series.basis, t), value: fmtUnit('money', sp.current, lang, cur) }] : []), { label: t('kpi.range'), value: `${fmtDate(view.bounds.dateMin, lang)} – ${fmtDate(view.bounds.dateMax, lang)}` }],
    insights: insights.map((i) => {
      const x = insightRow(i, lang, cur, t);
      return { title: x.r.title, body: x.r.body, action: x.r.action, reliability: x.sufficiency, impact: x.impact, evidence: i.evidence.filter((e) => e.label !== 'period').map((e) => formatEvidence(e, lang, cur)) };
    }),
    labels: { insights: t('ins.top'), action: t('ins.action'), reliability: t('ins.reliability'), impact: t('ins.impact'), footer: t('report.footer'), kpis: 'KPI' },
  };
}
