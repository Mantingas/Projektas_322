'use client';
import { useState } from 'react';
import { useLang } from '../LangProvider';
import { Card } from '../ui/card';
import { cn } from '@/lib/cn';
import type { ChartModel } from '@/engine/analytics/view';
import { changeText, fmtUnit, metricLabel } from '@/lib/dashFormat';
import type { DrillSpec } from '@/engine/analytics/provenance';
import type { FilterSpec } from '@/engine/analytics/filters';
import type { MessageKey } from '@/i18n';

const TONE = { good: 'text-emerald-700 dark:text-emerald-400', bad: 'text-red-700 dark:text-red-400', flat: 'text-slate-500', na: 'text-slate-400' };

export function KpiCards({ model, filters, onDrill, showHidden }: { model: ChartModel; filters: FilterSpec; onDrill: (title: string, spec: DrillSpec) => void; showHidden: boolean }) {
  const { t, lang } = useLang();
  const cur = model.series.currency;
  const [open, setOpen] = useState<string | null>(null);
  const shown = model.kpis.filter((k) => k.current !== null && !((k.id === 'returns' || k.id === 'p_credits') && k.current === 0 && (k.previous ?? 0) === 0));
  const hidden = model.kpis.filter((k) => k.current === null);
  return (
    <section aria-label="KPI" className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((k) => {
          const label = metricLabel(k.id, model.series.basis, t);
          const ch = changeText(k, lang, cur, t);
          const inputs = model.explain[k.id] ?? {};
          return (
            <Card key={k.id} className="flex flex-col p-4" data-testid={`kpi-card-${k.id}`}>
              <div className="text-xs font-medium text-slate-500">{label}</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight" data-testid={k.id === 'sales' ? 'kpi-revenue' : `kpi-${k.id}`}>{fmtUnit(k.unit, k.current!, lang, cur)}</div>
              <div className="mt-1 text-xs text-slate-500">{t('kpi.previous')}: <span data-testid={`kpi-prev-${k.id}`}>{k.previous !== null ? fmtUnit(k.unit, k.previous, lang, cur) : '–'}</span></div>
              <div className={cn('mt-1 text-sm font-medium', TONE[ch.tone])} aria-label={`${t('kpi.change')}: ${ch.text}`} data-testid={`kpi-change-${k.id}`}>
                <span aria-hidden>{ch.arrow}</span> {ch.text}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                <button className="text-indigo-700 underline dark:text-indigo-300" onClick={() => setOpen(open === k.id ? null : k.id)} aria-expanded={open === k.id}>{t('kpi.howCalc')}</button>
                <button className="text-indigo-700 underline dark:text-indigo-300" data-testid={`drill-${k.id}`} onClick={() => onDrill(label, { filter: { ...filters }, range: model.periods.current, ...(k.id === 'returns' || k.id === 'p_credits' ? { sign: 'negative' as const } : {}) })}>{t('kpi.viewRecords')}</button>
              </div>
              {open === k.id && <p className="mt-2 rounded-md bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t(`explain.${k.id}` as MessageKey, { ...inputs, returns: { money: inputs.returns ?? 0 }, credits: { money: inputs.credits ?? 0 } })}</p>}
            </Card>
          );
        })}
      </div>
      {showHidden && hidden.length > 0 && (
        <details className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
          <summary className="cursor-pointer font-medium">{t('kpi.notShown')} ({hidden.length})</summary>
          <ul className="mt-2 space-y-1 text-xs">{hidden.map((k) => <li key={k.id}><b>{metricLabel(k.id, model.series.basis, t)}</b> – {t(`mu.${k.unavailable ?? 'no_data'}` as MessageKey)}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
