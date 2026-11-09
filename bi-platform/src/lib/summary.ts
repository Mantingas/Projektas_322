import type { DashboardView } from '@/engine/analytics/dashboard';
import { topBottom } from '@/engine/analytics/compare';
import type { FilterSpec } from '@/engine/analytics/filters';
import type { Insight } from '@/engine/types';
import { hBarSvg, lineChartSvg, waterfallSvg } from '@/engine/report/svg';
import type { SummaryDoc } from '@/engine/report/summary';
import { changeText, dateRange, fmtUnit, limitationText, metricLabel, warningText, type T } from './dashFormat';
import { formatEvidence, formatImpact, renderInsight } from './report';
import { fmtDate, money, translate, type Lang, type MessageKey } from '@/i18n';

export function executiveLines(model: DashboardView, insights: Insight[], lang: Lang, t: T): string[] {
  const cur = model.series.currency;
  const s = model.kpis.find((k) => k.id === 'sales');
  const lines: string[] = [];
  if (s && s.current !== null) {
    const label = metricLabel('sales', model.series.basis, t);
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
  return lines;
}

export function filtersText(filters: FilterSpec, labels: Record<string, string>): string {
  const parts: string[] = [];
  for (const [k, field] of [['customer', 'customers'], ['product', 'products'], ['salesperson', 'salespeople'], ['category', 'categories'], ['supplier', 'suppliers'], ['warehouse', 'warehouses']] as const) {
    const keys = (filters[field] as string[] | undefined) ?? [];
    if (keys.length) parts.push(keys.map((x) => labels[`${k}:${x}`] ?? x).join(', '));
  }
  if (filters.text?.trim()) parts.push(`“${filters.text.trim()}”`);
  return parts.join(' · ');
}

export function buildSummaryDoc(model: DashboardView, insights: Insight[], lang: Lang, labels: Record<string, string>, filters: FilterSpec): SummaryDoc {
  const cur = model.series.currency;
  const t: T = (k, p) => translate(lang, k, p, cur);
  const m = (n: number) => money(n, { lang, currency: cur });
  const p = model.periods;
  const kpis = model.kpis.filter((k) => k.current !== null && !(k.id === 'returns' && k.current === 0 && !k.previous)).map((k) => {
    const ch = changeText(k, lang, cur, t);
    return { label: metricLabel(k.id, model.series.basis, t), current: fmtUnit(k.unit, k.current!, lang, cur), previous: k.previous !== null ? fmtUnit(k.unit, k.previous, lang, cur) : '–', change: ch.text, note: '', tone: ch.tone };
  });
  const charts: SummaryDoc['charts'] = [];
  const period = t('per.describe', { cfrom: fmtDate(p.current.from, lang), cto: fmtDate(p.current.to, lang), cdays: p.currentDays, pfrom: fmtDate(p.previous.from, lang), pto: fmtDate(p.previous.to, lang), pdays: p.previousDays });
  const unit = t('ch.unit', { currency: cur });
  if (model.comparable && model.aligned.points.length >= 3) {
    charts.push({ title: t('ch.comparison'), note: `${period} · ${unit}`, svg: lineChartSvg({ title: t('ch.comparison'), xLabels: model.aligned.points.map((x) => String(x.index + 1)), yFormat: (n) => new Intl.NumberFormat(lang, { notation: 'compact' }).format(n), series: [{ name: t('per.current'), values: model.aligned.points.map((x) => x.current) }, { name: t('per.previous'), values: model.aligned.points.map((x) => x.previous), dashed: true }] }) });
  } else if (model.trend.filter((x) => x.lines > 0).length >= 3) {
    charts.push({ title: t('ch.trend'), note: `${dateRange(model.bounds.dateMin, model.bounds.dateMax, lang)} · ${unit}`, svg: lineChartSvg({ title: t('ch.trend'), xLabels: model.trend.map((x) => fmtDate(x.start, lang).slice(0, 5)), yFormat: (n) => new Intl.NumberFormat(lang, { notation: 'compact' }).format(n), series: [{ name: t('ch.sales'), values: model.trend.map((x) => x.revenue) }] }) });
  }
  if (model.waterfall) {
    const w = model.waterfall.data;
    const d = model.waterfall.dimension;
    charts.push({ title: `${t('ch.waterfall')} – ${t(`dim.${d}` as MessageKey)}`, note: `${period} · ${unit}`, svg: waterfallSvg({ title: t('ch.waterfall'), start: { label: t('ch.start'), value: w.start }, end: { label: t('ch.end'), value: w.end }, steps: w.steps.map((s) => ({ label: s.kind === 'other' ? t('ch.other') : s.kind === 'unassigned' ? t('ch.unassigned') : s.label, delta: s.delta })), format: (n) => new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(n) }) });
  }
  if (model.tables.customer && model.charts.find((c) => c.id === 'topCustomers')?.available) {
    const { top } = topBottom(model.tables.customer.rows, 8);
    charts.push({ title: t('ch.topCustomers'), note: `${dateRange(p.current.from, p.current.to, lang)} · ${unit}`, svg: hBarSvg({ title: t('ch.topCustomers'), items: top.map((r) => ({ label: r.label, value: r.current, display: m(r.current) })) }) });
  }
  return {
    lang, title: t('rep.title'), subtitle: `${cur} · ${t(`basis.${model.series.basis}` as MessageKey)}`, generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    periodLine: period, filtersLine: filtersText(filters, labels) ? `${t('rep.filters')}: ${filtersText(filters, labels)}` : undefined,
    executive: executiveLines(model, insights, lang, t), kpis, charts,
    insights: insights.map((i) => {
      const r = renderInsight(i, lang, cur);
      return { title: r.title, body: r.body, impact: formatImpact(i, lang, cur), contributors: i.evidence.filter((e) => e.label !== 'period').map((e) => formatEvidence(e, lang, cur)), why: t(i.whyKey as MessageKey), action: r.action, sufficiency: `${t(`rel.${i.reliability}` as MessageKey)} (${r.reliabilityReason})` };
    }),
    limitations: [...model.warnings.map((w) => warningText(w, t)), ...model.limitations.map((l) => limitationText(l, t))].concat(model.limitations.length + model.warnings.length === 0 ? ['–'] : []),
    methodology: (['an.m1', 'an.m2', 'an.m3', 'an.m4', 'an.m5'] as const).map((k) => t(k)),
    labels: { executive: t('mgr.summary'), kpi: t('rep.kpiTable'), metric: t('rep.metric'), current: t('kpi.current'), previous: t('kpi.previous'), change: t('kpi.change'), charts: t('rep.charts'), insights: t('rep.insights'), contributors: t('ins.contributors'), why: t('ins.why'), action: t('ins.action'), sufficiency: t('ins.sufficiency'), impact: t('ins.impact'), limitations: t('rep.limitations'), methodology: t('rep.methodology'), association: t('ins.association'), footer: t('rep.local') },
  };
}
