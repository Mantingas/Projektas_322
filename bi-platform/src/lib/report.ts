import type { SalesAnalysis } from '@/engine/insights/engine';
import type { ReportInput } from '@/engine/report/export';
import type { Insight } from '@/engine/types';
import { fmtDate, money, num, pct, translate, type Lang, type MessageKey } from '@/i18n';

export function renderInsight(i: Insight, lang: Lang, currency: string) {
  return {
    title: translate(lang, i.titleKey as MessageKey, i.params, currency),
    body: translate(lang, i.bodyKey as MessageKey, i.params, currency),
    action: translate(lang, i.actionKey as MessageKey, i.params, currency),
    reliabilityReason: translate(lang, i.reliabilityReasonKey as MessageKey, i.params, currency),
  };
}

export function formatImpact(i: Insight, lang: Lang, currency: string): string {
  return i.impact.unit === 'money' ? money(i.impact.value, { lang, currency }) : i.impact.unit === 'pct' ? pct(i.impact.value, lang) : num(i.impact.value, lang);
}

/** Unit prices keep up to 4 decimals (0.0325 EUR per piece is not 0.03). */
export function priceText(n: number, lang: Lang, currency: string): string {
  try { return new Intl.NumberFormat(lang === 'en' ? 'en-GB' : lang === 'pl' ? 'pl-PL' : 'lt-LT', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n); } catch { return `${n.toFixed(4)} ${currency}`; }
}

export function formatEvidence(e: Insight['evidence'][number], lang: Lang, currency: string): string {
  const f = (n: number) => (e.unit === 'price' ? priceText(n, lang, currency) : e.unit === 'money' ? money(n, { lang, currency }) : e.unit === 'pct' ? pct(n, lang) : num(n, lang));
  return e.previous === undefined ? `${e.label}: ${f(e.current)}` : `${e.label}: ${f(e.previous)} → ${f(e.current)}`;
}

export function buildReport(a: SalesAnalysis, lang: Lang, notes?: string[]): ReportInput {
  const cur = a.series.currency;
  const t = (k: MessageKey, p: Record<string, string> = {}) => translate(lang, k, p, cur);
  const k = a.kpis;
  const kpis = [
    { label: t('kpi.revenue') + ` (${t(`basis.${a.series.basis}` as MessageKey)})`, value: money(k.revenue, { lang, currency: cur }) },
    { label: t('kpi.lines'), value: num(k.lines, lang) },
    ...(k.documents ? [{ label: t('kpi.documents'), value: num(k.documents, lang) }] : []),
    ...(k.customers ? [{ label: t('kpi.customers'), value: num(k.customers, lang) }] : []),
    ...(k.products ? [{ label: t('kpi.products'), value: num(k.products, lang) }] : []),
    ...(k.margin ? [{ label: t('kpi.margin'), value: pct(k.margin.marginPct, lang) }] : []),
    { label: t('kpi.range'), value: `${fmtDate(k.dateMin, lang)} – ${fmtDate(k.dateMax, lang)}` },
  ];
  return {
    title: t('report.title'),
    subtitle: `${cur}, ${t(`basis.${a.series.basis}` as MessageKey)}`,
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    lang,
    notes,
    kpis,
    insights: a.insights.map((i) => {
      const r = renderInsight(i, lang, cur);
      return {
        title: r.title, body: r.body, action: r.action,
        reliability: `${t(`rel.${i.reliability}` as MessageKey)} (${r.reliabilityReason})`,
        impact: formatImpact(i, lang, cur),
        evidence: i.evidence.filter((e) => e.label !== 'period').map((e) => formatEvidence(e, lang, cur)),
      };
    }),
    labels: {
      insights: t('ins.top'), action: t('ins.action'), reliability: t('ins.reliability'), impact: t('ins.impact'), footer: t('report.footer'), kpis: 'KPI', notes: t('rep.limitations'),
    },
  };
}
