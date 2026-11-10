import type { FilterSpec } from '@/engine/analytics/filters';
import type { FinanceView } from '@/engine/finance/dashboard';
import type { Insight } from '@/engine/types';
import { topBottom } from '@/engine/analytics/compare';
import { hBarSvg, lineChartSvg } from '@/engine/report/svg';
import type { SummaryDoc } from '@/engine/report/summary';
import type { ReportInput } from '@/engine/report/export';
import { changeText, fmtUnit, limitationText, metricLabel, warningText, type T } from './dashFormat';
import { formatEvidence, formatImpact, renderInsight } from './report';
import { filtersText } from './summary';
import { fmtDate, money, translate, type Lang, type MessageKey } from '@/i18n';

export function financeExecutiveLines(view: FinanceView, insights: Insight[], lang: Lang, t: T): string[] {
  const cur = view.series.currency;
  const lines: string[] = [];
  const o = view.kpis.find((k) => k.id === 'f_outstanding');
  const label = t(`fin.overview.${view.side}` as MessageKey);
  if (o && o.current !== null) {
    const value = fmtUnit('money', o.current, lang, cur);
    if (o.abs !== null && o.status !== 'blocked' && o.status !== 'no_previous_value' && o.direction) {
      const key = o.direction === 'up' ? 'mgr.sum.up' : o.direction === 'down' ? 'mgr.sum.down' : 'mgr.sum.flat';
      lines.push(t(key as MessageKey, { label, value, pct: o.pct !== null ? { pct: Math.abs(o.pct) } : '–', abs: fmtUnit('money', Math.abs(o.abs), lang, cur) }));
    } else lines.push(t('mgr.sum.none', { label, value }));
  } else lines.push(t('fin.noPosition'));
  const k = (id: string) => view.kpis.find((x) => x.id === id)?.current ?? null;
  const od = k('f_overdue');
  const sh = k('f_overdue_share');
  if (od !== null) lines.push(`${metricLabel('f_overdue', view.series.basis, t)}: ${fmtUnit('money', od, lang, cur)}${sh !== null ? ` (${fmtUnit('pct', sh, lang, cur)})` : ''}`);
  const soon = k('f_due_soon');
  if (soon !== null && soon > 0) lines.push(`${metricLabel('f_due_soon', view.series.basis, t)}: ${fmtUnit('money', soon, lang, cur)}`);
  const net = view.overview.net;
  if (net !== null) lines.push(`${t('fin.overview.net')}: ${money(net, { lang, currency: cur })}`);
  const risk = insights.find((i) => i.severity === 'risk' && i.certainty === 'fact') ?? insights.find((i) => i.severity === 'risk');
  const opp = insights.find((i) => i.severity === 'opportunity');
  if (risk) lines.push(t('mgr.sum.risk', { title: renderInsight(risk, lang, cur).title }));
  if (opp) lines.push(t('mgr.sum.opp', { title: renderInsight(opp, lang, cur).title }));
  return lines;
}

const certLabel = (i: Insight, t: T) => (i.certainty ? t(`cert.${i.certainty}` as MessageKey) : '');
const insightRow = (i: Insight, lang: Lang, cur: string, t: T) => {
  const r = renderInsight(i, lang, cur);
  const cert = certLabel(i, t);
  return { r, impact: `${formatImpact(i, lang, cur)}${cert ? ` · ${cert}` : ''}`, sufficiency: `${cert ? `${cert} · ` : ''}${t(`rel.${i.reliability}` as MessageKey)} (${r.reliabilityReason})` };
};

export function buildFinanceSummaryDoc(view: FinanceView, insights: Insight[], lang: Lang, labels: Record<string, string>, filters: FilterSpec): SummaryDoc {
  const cur = view.series.currency;
  const t: T = (k, p) => translate(lang, k, p, cur);
  const m = (n: number) => money(n, { lang, currency: cur });
  const p = view.periods;
  const compact = (n: number) => new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const kpis = view.kpis.filter((k) => k.current !== null).map((k) => {
    const ch = changeText(k, lang, cur, t);
    return { label: metricLabel(k.id, view.series.basis, t), current: fmtUnit(k.unit, k.current!, lang, cur), previous: k.previous !== null ? fmtUnit(k.unit, k.previous, lang, cur) : '–', change: ch.text, note: '', tone: ch.tone };
  });
  const period = t('per.describe', { cfrom: fmtDate(p.current.from, lang), cto: fmtDate(p.current.to, lang), cdays: p.currentDays, pfrom: fmtDate(p.previous.from, lang), pto: fmtDate(p.previous.to, lang), pdays: p.previousDays });
  const unit = t('ch.unit', { currency: cur });
  const charts: SummaryDoc['charts'] = [];
  if (view.aging) charts.push({ title: t('fch.aging'), note: `${fmtDate(view.aging.asOf, lang)} · ${unit}`, svg: hBarSvg({ title: t('fch.aging'), items: view.aging.rows.filter((r) => r.amount > 0).map((r) => ({ label: t(`ag.${r.id}` as MessageKey), value: r.amount, display: m(r.amount) })) }) });
  const pts = view.overdueTrend.filter((x) => x.overdue !== null);
  if (pts.length >= 3) charts.push({ title: t('fch.overdueTrend'), note: unit, svg: lineChartSvg({ title: t('fch.overdueTrend'), xLabels: pts.map((x) => fmtDate(x.date, lang).slice(0, 5)), yFormat: compact, series: [{ name: t('ot.outstanding'), values: pts.map((x) => x.outstanding) }, { name: t('ot.overdue'), values: pts.map((x) => x.overdue!), dashed: true }] }) });
  const tbl = view.tables.customer ?? view.tables.supplier;
  if (tbl) { const { top } = topBottom(tbl.rows, 8); if (top.length) charts.push({ title: t(view.side === 'receivable' ? 'ch.topCustomers' : 'ch.topSuppliers'), note: unit, svg: hBarSvg({ title: t('od.title'), items: top.map((r) => ({ label: r.label, value: r.current, display: m(r.current) })) }) }); }
  const f = filtersText(filters, labels);
  const limits = [...view.warnings.map((w) => warningText(w, t)), ...view.limitations.map((l) => limitationText(l, t))];
  return {
    lang, title: t('frep.title'), subtitle: `${t(`fin.side.short.${view.side}` as MessageKey)} · ${cur}${view.asOf.current ? ` · ${t('fin.position', { date: fmtDate(view.asOf.current, lang) })}` : ''}`, generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    periodLine: period, filtersLine: f ? `${t('rep.filters')}: ${f}` : undefined, executive: financeExecutiveLines(view, insights, lang, t), kpis, charts,
    insights: insights.map((i) => {
      const x = insightRow(i, lang, cur, t);
      return { title: x.r.title, body: x.r.body, impact: x.impact, contributors: i.evidence.filter((e) => e.label !== 'period').map((e) => formatEvidence(e, lang, cur)), why: t(i.whyKey as MessageKey, i.params), action: x.r.action, sufficiency: x.sufficiency };
    }),
    limitations: limits.length ? limits : ['–'],
    methodology: (['fan.m1', 'fan.m2', 'fan.m3', 'fan.m4', 'fan.m5'] as const).map((k) => t(k)),
    labels: { executive: t('mgr.summary'), kpi: t('rep.kpiTable'), metric: t('rep.metric'), current: t('kpi.current'), previous: t('kpi.previous'), change: t('kpi.change'), charts: t('rep.charts'), insights: t('rep.insights'), contributors: t('ins.contributors'), why: t('ins.why'), action: t('ins.action'), sufficiency: t('ins.sufficiency'), impact: t('ins.impact'), limitations: t('rep.limitations'), methodology: t('rep.methodology'), association: t('ins.association'), footer: t('rep.local') },
  };
}

export function buildFinanceReport(view: FinanceView, insights: Insight[], lang: Lang): ReportInput {
  const cur = view.series.currency;
  const t: T = (k, p) => translate(lang, k, p, cur);
  const o = view.kpis.find((k) => k.id === 'f_outstanding');
  return {
    title: t('frep.title'), subtitle: `${t(`fin.side.short.${view.side}` as MessageKey)}, ${cur}`, generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '), lang,
    kpis: [...(o && o.current !== null ? [{ label: metricLabel('f_outstanding', view.series.basis, t), value: fmtUnit('money', o.current, lang, cur) }] : []), { label: t('kpi.range'), value: `${fmtDate(view.bounds.dateMin, lang)} – ${fmtDate(view.bounds.dateMax, lang)}` }],
    insights: insights.map((i) => {
      const x = insightRow(i, lang, cur, t);
      return { title: x.r.title, body: x.r.body, action: x.r.action, reliability: x.sufficiency, impact: x.impact, evidence: i.evidence.filter((e) => e.label !== 'period').map((e) => formatEvidence(e, lang, cur)) };
    }),
    labels: { insights: t('ins.top'), action: t('ins.action'), reliability: t('ins.reliability'), impact: t('ins.impact'), footer: t('report.footer'), kpis: 'KPI' },
  };
}
