'use client';
import { useLang } from '../LangProvider';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { ChartById } from './Charts';
import type { ChartModel } from '@/engine/analytics/view';
import type { Dimension } from '@/engine/analytics/filters';
import type { DrillSpec } from '@/engine/analytics/provenance';
import { explainInsight } from '@/engine/insights/explain';
import type { Insight } from '@/engine/types';
import { formatEvidence, formatImpact, renderInsight } from '@/lib/report';
import type { MessageKey } from '@/i18n';

import { FILTER_FIELD as FIELD } from '@/lib/dimMaps';

export function InsightCard({ insight, model, expanded, onToggle, onDrill, onFilter, extraChart, drillFor }: {
  /** module-specific records behind one evidence row (inventory: stock lines at the closing date, or movements) */
  drillFor?: (insight: Insight, key: string) => DrillSpec;
  /** purchasing renders its own charts for price / bridge / variance findings */
  extraChart?: (insight: Insight) => React.ReactNode;
  insight: Insight;
  model: ChartModel;
  expanded: boolean;
  onToggle: () => void;
  onDrill: (title: string, spec: DrillSpec) => void;
  onFilter: (dim: Dimension, key: string) => void;
}) {
  const { t, lang } = useLang();
  const cur = model.series.currency;
  const r = renderInsight(insight, lang, cur);
  const ex = explainInsight(insight);
  const contributors = ex.contributors;
  return (
    <Card data-testid="insight" data-insight-id={insight.id} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={insight.severity}>{t(`sev.${insight.severity}` as MessageKey)}</Badge>
        {insight.certainty && <Badge tone={insight.certainty === 'fact' ? 'opportunity' : insight.certainty === 'possible' ? 'warn' : 'info'} data-testid="certainty-badge" data-certainty={insight.certainty} title={t(`cert.${insight.certainty}.d` as MessageKey)}>{t(`cert.${insight.certainty}` as MessageKey)}</Badge>}
        {insight.savings && <Badge tone={insight.savings.kind === 'actual' ? 'opportunity' : insight.savings.kind === 'potential' ? 'info' : 'neutral'} data-testid="savings-badge" data-kind={insight.savings.kind} title={t(`sav.${insight.savings.kind}.d` as MessageKey)}>{t(`sav.${insight.savings.kind}` as MessageKey)}</Badge>}
        <span className="text-xs text-slate-500">{t('ins.sufficiency')}: <b>{t(`rel.${insight.reliability}` as MessageKey)}</b> · {t('ins.impact')}: <b>{formatImpact(insight, lang, cur)}</b></span>
      </div>
      <CardTitle className="text-lg">{r.title}</CardTitle>
      <p className="text-sm text-slate-700 dark:text-slate-300">{r.body}</p>
      {!expanded && contributors.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-slate-600 dark:text-slate-400">{contributors.slice(0, 3).map((e, n) => <li key={n}>{formatEvidence(e, lang, cur)}</li>)}</ul>
      )}
      <p className="text-sm"><b>{t('ins.action')}:</b> {r.action}</p>
      <Button size="sm" variant="outline" onClick={onToggle} aria-expanded={expanded} data-testid="insight-details-btn">{expanded ? t('ins.hideDetails') : t('ins.viewDetails')}</Button>
      {expanded && (
        <div className="mt-2 space-y-4 border-t border-slate-200 pt-3 text-sm dark:border-slate-800" data-testid="insight-details">
          <Section title={t('ins.what')}>{r.title}</Section>
          <Section title={t('ins.howMuch')}>{formatImpact(insight, lang, cur)} – {r.body}</Section>
          {contributors.length > 0 && (
            <Section title={t('ins.contributors')}>
              <ul className="space-y-1">
                {contributors.map((e, n) => (
                  <li key={n} className="flex flex-wrap items-center gap-2">
                    <span>{formatEvidence(e, lang, cur)}</span>
                    {e.key && insight.dimension && (
                      <>
                        <button className="text-xs text-indigo-700 underline dark:text-indigo-300" onClick={() => onDrill(e.label, drillFor ? drillFor(insight, e.key!) : { filter: { [FIELD[insight.dimension!]]: [e.key!] }, range: insight.params.days !== undefined ? model.periods.current : undefined })}>{t('kpi.viewRecords')}</button>
                        <button className="text-xs text-indigo-700 underline dark:text-indigo-300" onClick={() => onFilter(insight.dimension!, e.key!)}>{t('flt.title')}</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{t('ins.association')}</p>
            </Section>
          )}
          {insight.certainty && <Section title={t(`cert.${insight.certainty}` as MessageKey)}>{t(`cert.${insight.certainty}.d` as MessageKey)}</Section>}
          {insight.savings && <Section title={t(`sav.${insight.savings.kind}` as MessageKey)}>{t(`sav.${insight.savings.kind}.d` as MessageKey)}</Section>}
          <Section title={t('ins.why')}>{t(insight.whyKey as MessageKey, insight.params, cur)}</Section>
          <Section title={t('ins.action')}>{r.action}</Section>
          <Section title={t('ins.sufficiency')}>{t(`rel.${insight.reliability}` as MessageKey)} – {r.reliabilityReason}</Section>
          {insight.chart && <Section title={t('ins.chart')}>{extraChart?.(insight) ?? <ChartById id={insight.chart} model={model} dim={insight.dimension} onFilter={onFilter} />}</Section>}
        </div>
      )}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div>{children}</div>
    </div>
  );
}
