import type { ExecKpi, ExecutiveModel, RankedItem } from '@/engine/executive/compose';
import { lineChartSvg } from '@/engine/report/svg';
import type { SummaryDoc } from '@/engine/report/summary';
import type { ReportInput } from '@/engine/report/export';
import type { Insight } from '@/engine/types';
import { changeText, fmtUnit, metricLabel, type T } from './dashFormat';
import { formatEvidence, formatImpact, renderInsight } from './report';
import { fmtDate, translate, type Lang, type MessageKey } from '@/i18n';

const MODULE_ORDER = ['sales', 'purchasing', 'inventory', 'finance'] as const;
export const kpiLabel = (k: ExecKpi, t: T) => `${t(`mod.${k.module}` as MessageKey)}${k.side ? ` – ${t(`fin.side.short.${k.side}` as MessageKey)}` : ''}: ${metricLabel(k.id, (k.basis ?? 'net') as 'net' | 'gross' | 'unknown', t)}`;
const cur = (r: RankedItem) => r.currency ?? 'EUR';
const when = (ms: number | undefined, lang: Lang) => (ms ? new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : lang === 'pl' ? 'pl-PL' : 'lt-LT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)) : '');

/** The text version of a cross-module disclosure: sources, confirmed links, period, method, confidence, limits. */
export function disclosureText(i: Insight, lang: Lang, t: T): string {
  const c = i.cross;
  if (!c) return '';
  const src = c.sources.map((s) => `${t(`mod.${s.module}` as MessageKey)}${s.currency ? ` (${s.currency}${s.note ? `, ${s.note}` : ''})` : s.note ? ` (${s.note})` : ''} ${fmtDate(s.from, lang)}–${fmtDate(s.to, lang)}`).join('; ');
  const links = c.links.map((l) => `${l.a} ↔ ${l.b} (${t(`lnk.basis.${l.basis}` as MessageKey)})`).join('; ');
  return `${t('cross.disc.sources')}: ${src}. ${t('cross.disc.links')}: ${links || '–'}. ${t('cross.disc.period')}: ${fmtDate(c.period.from, lang)} – ${fmtDate(c.period.to, lang)}. ${t('cross.disc.method')}: ${t(c.methodKey as MessageKey)} ${t('cross.disc.confidence')}: ${t(c.confidenceKey as MessageKey)} ${t('cross.disc.limits')}: ${c.limits.map((l) => t(l as MessageKey)).join(' ')}`;
}

const itemRow = (r: RankedItem, lang: Lang, t: T) => {
  const c = cur(r);
  const x = renderInsight(r.insight, lang, c);
  const cert = r.insight.certainty ? t(`cert.${r.insight.certainty}` as MessageKey) : '';
  const label = `${t(`exe.class.${r.class}` as MessageKey)}${cert ? ` · ${cert}` : ''} · ${t(`mod.${r.module}` as MessageKey)}`;
  const why = [translate(lang, r.insight.whyKey as MessageKey, r.insight.params, c), disclosureText(r.insight, lang, t)].filter(Boolean).join(' ');
  return { x, label, c, why };
};

export function executiveLines(m: ExecutiveModel, lang: Lang, t: T): string[] {
  const lines: string[] = [];
  if (m.empty) return [t('exe.sum.none')];
  for (const k of m.kpis.slice(0, 4)) {
    const ch = changeText(k.metric, lang, k.currency, t);
    lines.push(t('exe.sum.kpi', { label: kpiLabel(k, t), value: fmtUnit(k.metric.unit, k.metric.current!, lang, k.currency), change: ch.text !== '–' ? ` (${ch.text})` : '' }));
  }
  const risk = m.risks[0], opp = m.opportunities[0];
  if (risk) lines.push(t('exe.sum.risk', { title: renderInsight(risk.insight, lang, cur(risk)).title }));
  if (opp) lines.push(t('exe.sum.opp', { title: renderInsight(opp.insight, lang, cur(opp)).title }));
  const nCross = m.insights.filter((i) => i.module === 'cross').length;
  lines.push(nCross ? t('exe.sum.cross', { n: nCross }) : m.cross.confirmedLinks === 0 ? t('exe.sum.nolinks') : t('exe.sum.cross', { n: 0 }));
  if (m.lastImportedAt) lines.push(t('exe.sum.imports', { when: when(m.lastImportedAt, lang) }));
  return lines;
}

/** the note about a finding that was folded into another or withheld – with readable titles, never internal ids */
export const suppressedText = (s: ExecutiveModel['suppressed'][number], lang: Lang = 'en'): string => translate(lang, `exe.supp.${s.reason}` as MessageKey, { id: translate(lang, s.title.key as MessageKey, s.title.params, s.title.currency), by: translate(lang, s.byTitle.key as MessageKey, s.byTitle.params, s.byTitle.currency) });

export function coverageLimitations(m: ExecutiveModel, t: T, lang: Lang = 'en'): string[] {
  const out: string[] = [t('exe.noMix')];
  for (const c of m.coverage) {
    if (!c.present) { out.push(`${t(`mod.${c.module}` as MessageKey)}: ${t('exe.cov.none')}`); continue; }
    for (const f of c.flags) out.push(`${t(`mod.${c.module}` as MessageKey)}: ${t(`exe.flag.${f}` as MessageKey, { list: c.otherSeries.join(', ') })}`);
  }
  for (const u of m.cross.reasons) out.push(`${t(`cross.rule.${u.rule}` as MessageKey)}: ${t(`cross.unavail.${u.reason}` as MessageKey)}`);
  for (const s of m.suppressed) out.push(suppressedText(s, lang));
  return out;
}

export function buildExecutiveSummaryDoc(m: ExecutiveModel, lang: Lang): SummaryDoc {
  const t: T = (k, p) => translate(lang, k, p);
  const kpis = m.kpis.map((k) => {
    const ch = changeText(k.metric, lang, k.currency, t);
    const where = k.asOf ? t('exe.kpi.asOf', { date: { date: k.asOf } }) : k.window ? t('exe.kpi.window', { from: { date: k.window.from }, to: { date: k.window.to } }) : '';
    return { label: kpiLabel(k, t), current: fmtUnit(k.metric.unit, k.metric.current!, lang, k.currency), previous: k.metric.previous !== null ? fmtUnit(k.metric.unit, k.metric.previous, lang, k.currency) : '–', change: ch.text, note: `${k.currency}${where ? ` · ${where}` : ''}`, tone: ch.tone };
  });
  const compact = (n: number) => new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const charts: SummaryDoc['charts'] = m.trends.slice().sort((a, b) => MODULE_ORDER.indexOf(a.module) - MODULE_ORDER.indexOf(b.module)).map((tr) => {
    const title = t((tr.module === 'finance' ? `exe.trend.finance.${tr.side}` : `exe.trend.${tr.module}`) as MessageKey);
    return { title, note: tr.currency, svg: lineChartSvg({ title, xLabels: tr.points.map((p) => fmtDate(p.x, lang).slice(0, 5)), yFormat: compact, series: [{ name: title, values: tr.points.map((p) => p.y) }] }) };
  });
  const insights = m.insights.map((r) => {
    const { x, label, c, why } = itemRow(r, lang, t);
    return { title: x.title, body: x.body, impact: formatImpact(r.insight, lang, c), contributors: r.insight.evidence.filter((e) => e.label !== 'period').map((e) => formatEvidence(e, lang, c)), why, action: x.action, sufficiency: `${label} · ${t(`rel.${r.insight.reliability}` as MessageKey)} (${x.reliabilityReason})` };
  });
  const dates = m.coverage.filter((c) => c.present);
  const periodLine = dates.length ? dates.map((c) => `${t(`mod.${c.module}` as MessageKey)}: ${fmtDate(c.from!, lang)} – ${fmtDate(c.to!, lang)}`).join(' · ') : t('exe.lastImport.none');
  return {
    lang, title: t('exe.rep.title'), subtitle: `${t('exe.title')}${m.lastImportedAt ? ` · ${t('exe.lastImport', { when: when(m.lastImportedAt, lang) })}` : ''}`, generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '), periodLine,
    executive: executiveLines(m, lang, t), kpis, charts, insights, limitations: coverageLimitations(m, t, lang), methodology: (['exe.an.m1', 'exe.an.m2', 'exe.an.m3', 'exe.an.m4', 'exe.an.m5'] as const).map((k) => t(k)),
    labels: { executive: t('exe.rep.exec'), kpi: t('exe.rep.kpis'), metric: t('rep.metric'), current: t('kpi.current'), previous: t('kpi.previous'), change: t('kpi.change'), charts: t('exe.sec.trends'), insights: t('exe.sec.insights'), contributors: t('ins.contributors'), why: t('ins.why'), action: t('ins.action'), sufficiency: t('ins.sufficiency'), impact: t('ins.impact'), limitations: t('exe.rep.coverage'), methodology: t('rep.methodology'), association: t('ins.association'), footer: t('rep.local') },
  };
}

export function buildExecutiveReport(m: ExecutiveModel, lang: Lang): ReportInput {
  const t: T = (k, p) => translate(lang, k, p);
  return {
    title: t('exe.rep.title'), subtitle: t('exe.title'), generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '), lang,
    kpis: m.kpis.map((k) => ({ label: kpiLabel(k, t), value: `${fmtUnit(k.metric.unit, k.metric.current!, lang, k.currency)} (${k.currency})` })),
    insights: m.insights.map((r) => {
      const { x, label, c, why } = itemRow(r, lang, t);
      return { title: x.title, body: x.body, action: x.action, reliability: `${label} · ${t(`rel.${r.insight.reliability}` as MessageKey)}`, impact: formatImpact(r.insight, lang, c), evidence: [...r.insight.evidence.filter((e) => e.label !== 'period').map((e) => formatEvidence(e, lang, c)), ...(r.insight.cross ? [why] : [])] };
    }),
    labels: { insights: t('exe.sec.insights'), action: t('ins.action'), reliability: t('ins.reliability'), impact: t('ins.impact'), footer: t('report.footer'), kpis: 'KPI' },
  };
}
