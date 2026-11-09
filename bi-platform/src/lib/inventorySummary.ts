import type { FilterSpec } from '@/engine/analytics/filters';
import type { InventoryView } from '@/engine/inventory/dashboard';
import type { Insight } from '@/engine/types';
import { topBottom } from '@/engine/analytics/compare';
import { hBarSvg, lineChartSvg } from '@/engine/report/svg';
import type { SummaryDoc } from '@/engine/report/summary';
import type { ReportInput } from '@/engine/report/export';
import { changeText, dateRange, fmtUnit, limitationText, metricLabel, warningText, type T } from './dashFormat';
import { formatEvidence, formatImpact, renderInsight } from './report';
import { filtersText } from './summary';
import { fmtDate, money, translate, type Lang, type MessageKey } from '@/i18n';

export function inventoryExecutiveLines(view: InventoryView, insights: Insight[], lang: Lang, t: T): string[] {
  const cur = view.series.currency;
  const lines: string[] = [];
  const v = view.kpis.find((k) => k.id === 'i_value');
  if (v && v.current !== null) {
    const label = metricLabel('i_value', view.series.basis, t);
    const value = fmtUnit('money', v.current, lang, cur);
    if (v.abs !== null && v.status !== 'blocked' && v.status !== 'no_previous_value' && v.direction) {
      const key = v.direction === 'up' ? 'mgr.sum.up' : v.direction === 'down' ? 'mgr.sum.down' : 'mgr.sum.flat';
      lines.push(t(key as MessageKey, { label, value, pct: v.pct !== null ? { pct: Math.abs(v.pct) } : '–', abs: fmtUnit('money', Math.abs(v.abs), lang, cur) }));
    } else lines.push(t('mgr.sum.none', { label, value }));
  } else lines.push(t('inv.noPosition'));
  const num = (id: string) => view.kpis.find((k) => k.id === id)?.current ?? null;
  const slow = num('i_slow');
  const dead = num('i_nonmoving');
  if (slow !== null && slow > 0) lines.push(`${metricLabel('i_slow', view.series.basis, t)}: ${fmtUnit('money', slow, lang, cur)}`);
  if (dead !== null && dead > 0) lines.push(`${metricLabel('i_nonmoving', view.series.basis, t)}: ${fmtUnit('money', dead, lang, cur)}`);
  const so = num('i_stockout');
  if (so !== null && so > 0) lines.push(`${metricLabel('i_stockout', view.series.basis, t)}: ${so}`);
  const risk = insights.find((i) => i.severity === 'risk');
  const opp = insights.find((i) => i.severity === 'opportunity');
  if (risk) lines.push(t('mgr.sum.risk', { title: renderInsight(risk, lang, cur).title }));
  if (opp) lines.push(t('mgr.sum.opp', { title: renderInsight(opp, lang, cur).title }));
  return lines;
}

export function buildInventorySummaryDoc(view: InventoryView, insights: Insight[], lang: Lang, labels: Record<string, string>, filters: FilterSpec): SummaryDoc {
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
  if (view.trend.length >= 3) charts.push({ title: t('ich.trend'), note: `${dateRange(view.trend[0]!.start, view.trend[view.trend.length - 1]!.start, lang)} · ${unit}`, svg: lineChartSvg({ title: t('ich.trend'), xLabels: view.trend.map((x) => fmtDate(x.start, lang).slice(0, 5)), yFormat: compact, series: [{ name: t('ich.unitValue'), values: view.trend.map((x) => x.revenue) }] }) });
  if (view.tables.product && view.charts.find((c) => c.id === 'topProducts')?.available) {
    const { top } = topBottom(view.tables.product.rows, 8);
    charts.push({ title: t('ich.products'), note: unit, svg: hBarSvg({ title: t('ich.products'), items: top.map((r) => ({ label: r.label, value: r.current, display: m(r.current) })) }) });
  }
  if (view.tables.warehouse && view.charts.find((c) => c.id === 'warehouseComparison')?.available) {
    const { top } = topBottom(view.tables.warehouse.rows, 8);
    charts.push({ title: t('ich.warehouses'), note: unit, svg: hBarSvg({ title: t('ich.warehouses'), items: top.map((r) => ({ label: r.label, value: r.current, display: m(r.current) })) }) });
  }
  const f = filtersText(filters, labels);
  const limits = [...view.warnings.map((w) => warningText(w, t)), ...view.limitations.map((l) => limitationText(l, t))];
  return {
    lang, title: t('irep.title'), subtitle: view.asOf.current ? t('inv.position', { date: fmtDate(view.asOf.current, lang) }) : cur, generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    periodLine: period, filtersLine: f ? `${t('rep.filters')}: ${f}` : undefined, executive: inventoryExecutiveLines(view, insights, lang, t), kpis, charts,
    insights: insights.map((i) => {
      const r = renderInsight(i, lang, cur);
      return { title: r.title, body: r.body, impact: formatImpact(i, lang, cur), contributors: i.evidence.filter((e) => e.label !== 'period').map((e) => formatEvidence(e, lang, cur)), why: t(i.whyKey as MessageKey), action: r.action, sufficiency: `${t(`rel.${i.reliability}` as MessageKey)} (${r.reliabilityReason})` };
    }),
    limitations: limits.length ? limits : ['–'],
    methodology: (['ian.m1', 'ian.m2', 'ian.m3', 'ian.m4', 'ian.m5'] as const).map((k) => t(k)),
    labels: { executive: t('mgr.summary'), kpi: t('rep.kpiTable'), metric: t('rep.metric'), current: t('kpi.current'), previous: t('kpi.previous'), change: t('kpi.change'), charts: t('rep.charts'), insights: t('rep.insights'), contributors: t('ins.contributors'), why: t('ins.why'), action: t('ins.action'), sufficiency: t('ins.sufficiency'), impact: t('ins.impact'), limitations: t('rep.limitations'), methodology: t('rep.methodology'), association: t('ins.association'), footer: t('rep.local') },
  };
}

export function buildInventoryReport(view: InventoryView, insights: Insight[], lang: Lang): ReportInput {
  const cur = view.series.currency;
  const t: T = (k, p) => translate(lang, k, p, cur);
  const v = view.kpis.find((k) => k.id === 'i_value');
  return {
    title: t('irep.title'), subtitle: cur, generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '), lang,
    kpis: [...(v && v.current !== null ? [{ label: metricLabel('i_value', view.series.basis, t), value: fmtUnit('money', v.current, lang, cur) }] : []), { label: t('kpi.range'), value: `${fmtDate(view.bounds.dateMin, lang)} – ${fmtDate(view.bounds.dateMax, lang)}` }],
    insights: insights.map((i) => {
      const r = renderInsight(i, lang, cur);
      return { title: r.title, body: r.body, action: r.action, reliability: `${t(`rel.${i.reliability}` as MessageKey)} (${r.reliabilityReason})`, impact: formatImpact(i, lang, cur), evidence: i.evidence.filter((e) => e.label !== 'period').map((e) => formatEvidence(e, lang, cur)) };
    }),
    labels: { insights: t('ins.top'), action: t('ins.action'), reliability: t('ins.reliability'), impact: t('ins.impact'), footer: t('report.footer'), kpis: 'KPI' },
  };
}
