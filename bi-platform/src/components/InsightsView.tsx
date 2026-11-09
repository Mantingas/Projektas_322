'use client';
import { useEffect, useMemo, useState } from 'react';
import { useLang } from './LangProvider';
import { Button } from './ui/button';
import { Card, CardTitle } from './ui/card';
import { cn } from '@/lib/cn';
import { getDb, type ImportRow } from '@/db/db';
import { loadAllSales } from '@/db/store';
import { analyzeSales } from '@/engine/insights/engine';
import type { Insight, SalesRecord } from '@/engine/types';
import { buildDashboard } from '@/engine/analytics/dashboard';
import { listSeries } from '@/engine/sales/kpi';
import { dimensionOf, applyFilters, type Dimension, type FilterSpec } from '@/engine/analytics/filters';
import type { PeriodSelection } from '@/engine/analytics/periods';
import { drillRecords, type DrillSpec } from '@/engine/analytics/provenance';
import { entityTable } from '@/engine/analytics/compare';
import { resolvePeriods } from '@/engine/analytics/periods';
import { renderManagementSummary } from '@/engine/report/summary';
import { renderReportCsv } from '@/engine/report/export';
import { buildReport } from '@/lib/report';
import { buildSummaryDoc, executiveLines, filtersText } from '@/lib/summary';
import { downloadText } from '@/lib/download';
import { limitationText, warningText, type T } from '@/lib/dashFormat';
import { KpiCards } from './dashboard/KpiCards';
import { PeriodPicker } from './dashboard/PeriodPicker';
import { FilterBar } from './dashboard/FilterBar';
import { CategoryChart, ComparisonChart, ParetoChart, RankingChart, TrendChart, WaterfallChart } from './dashboard/Charts';
import { EntityTableView } from './dashboard/EntityTable';
import { DrillDrawer, type DrillState } from './dashboard/DrillDrawer';
import { InsightCard } from './dashboard/InsightPanel';
import type { MessageKey } from '@/i18n';

type Mode = 'manager' | 'analyst';
const FIELD: Record<Dimension, keyof FilterSpec> = { customer: 'customers', product: 'products', salesperson: 'salespeople', category: 'categories' };
const DIMS: Dimension[] = ['customer', 'product', 'salesperson', 'category'];

export function InsightsView({ version, goImport }: { version: number; goImport: () => void }) {
  const { t, lang } = useLang();
  const [records, setRecords] = useState<SalesRecord[] | null>(null);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [seriesKey, setSeriesKey] = useState('');
  const [mode, setMode] = useState<Mode>('manager');
  const [filters, setFilters] = useState<FilterSpec>({});
  const [period, setPeriod] = useState<PeriodSelection>({ preset: 'r30' });
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([loadAllSales(getDb()), getDb().imports.toArray()])
      .then(([r, i]) => { if (alive) { setRecords(r); setImports(i); } })
      .catch(() => alive && setRecords([]));
    return () => { alive = false; };
  }, [version]);

  const allSeries = useMemo(() => (records ? listSeries(records) : []), [records]);
  const series = useMemo(() => allSeries.find((s) => `${s.currency}|${s.basis}` === seriesKey) ?? allSeries[0], [allSeries, seriesKey]);
  const identity = useMemo(() => (imports.some((i) => i.added > 0 && i.identity === 'content') ? 'content' : imports.some((i) => i.added > 0 && i.identity === 'mixed') ? 'mixed' : 'document') as 'document' | 'mixed' | 'content', [imports]);
  const model = useMemo(() => (records && series ? buildDashboard(records, { series, filters, period, identity }) : null), [records, series, filters, period, identity]);
  const insights = useMemo(() => (model && series ? analyzeSales(model.records, series) : null), [model, series]);
  const importNames = useMemo(() => Object.fromEntries(imports.map((i) => [i.id, i.fileName])), [imports]);

  // labels for filter chips + option lists come from the whole series (both periods), not just the current window
  const seriesRecords = useMemo(() => (records && series ? records.filter((r) => r.currency === series.currency && r.basis === series.basis) : []), [records, series]);
  const labels = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of seriesRecords) for (const d of DIMS) { const k = dimensionOf[d](r); if (k && !m[`${d}:${k.key}`]) m[`${d}:${k.key}`] = k.label; }
    return m;
  }, [seriesRecords]);
  const options = useMemo(() => {
    if (!seriesRecords.length || !model) return {};
    const out: Partial<Record<Dimension, ReturnType<typeof entityTable>['rows']>> = {};
    const whole = resolvePeriods({ preset: 'custom', custom: { current: { from: model.bounds.dateMin, to: model.bounds.dateMax }, previous: { from: '1900-01-01', to: '1900-01-02' } } }, { dateMin: model.bounds.dateMin, dateMax: model.bounds.dateMax });
    for (const d of DIMS) if (seriesRecords.some((r) => dimensionOf[d](r))) out[d] = entityTable(seriesRecords, d, whole, model.ctx).rows.sort((a, b) => b.current - a.current);
    return out;
  }, [seriesRecords, model]);

  if (records === null) return <p>…</p>;
  if (!model || !series) {
    return (
      <Card className="space-y-3 text-center" data-testid="no-data">
        <p>{t('ins.empty')}</p>
        <div><Button onClick={goImport}>{t('ins.goImport')}</Button></div>
      </Card>
    );
  }

  const cur = model.series.currency;
  const tt: T = (k, p) => t(k, p, cur);
  const addFilter = (dim: Dimension, key: string) => setFilters((f) => ({ ...f, [FIELD[dim]]: [...new Set([...((f[FIELD[dim]] as string[] | undefined) ?? []), key])] }));
  const openDrill = (title: string, spec: DrillSpec) => {
    const merged: DrillSpec = { ...spec, filter: { ...filters, ...spec.filter } };
    setDrill({ title, records: drillRecords(seriesRecords, { ...merged, filter: { ...merged.filter, dateFrom: undefined, dateTo: undefined } }), range: spec.range, filterText: filtersText(spec.filter, labels) || undefined });
  };
  const shownInsights = insights?.insights ?? [];
  const risks = shownInsights.filter((i) => i.severity === 'risk').slice(0, 3);
  const opps = shownInsights.filter((i) => i.severity === 'opportunity').slice(0, 3);
  const actions = [...new Set(shownInsights.slice(0, 5).map((i) => t(i.actionKey as MessageKey, i.params, cur)))];
  const basisLabel = (b: string) => t(`basis.${b}` as MessageKey);
  const chartAvail = (id: string) => model.charts.find((c) => c.id === id)?.available;
  const exec = executiveLines(model, shownInsights, lang, tt);

  const exportSummary = () => downloadText('management-summary.html', 'text/html', renderManagementSummary(buildSummaryDoc(model, shownInsights, lang, labels, filters)));
  const exportCsv = () => insights && downloadText('insights-report.csv', 'text/csv', renderReportCsv(buildReport(insights, lang)));
  const card = (i: Insight) => <InsightCard key={i.id} insight={i} model={model} expanded={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} onDrill={openDrill} onFilter={addFilter} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t('dash.title')}</h1>
        <div className="no-print flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t('dash.mode.label')} className="flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-700">
            {(['manager', 'analyst'] as Mode[]).map((m) => (
              <button key={m} data-testid={`mode-${m}`} aria-pressed={mode === m} onClick={() => setMode(m)} className={cn('px-3 py-1.5 text-sm font-medium', mode === m ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}>{t(`dash.mode.${m}` as MessageKey)}</button>
            ))}
          </div>
          {allSeries.length > 1 && (
            <select aria-label={t('ins.series')} data-testid="series-select" value={`${series.currency}|${series.basis}`} onChange={(e) => { setSeriesKey(e.target.value); setFilters({}); }} className="rounded-md border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900">
              {allSeries.map((s) => <option key={`${s.currency}|${s.basis}`} value={`${s.currency}|${s.basis}`}>{s.currency} · {basisLabel(s.basis)} ({s.lines})</option>)}
            </select>
          )}
          <Button variant="outline" size="sm" onClick={exportSummary} data-testid="export-html">{t('dash.exportSummary')}</Button>
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid="export-csv">{t('dash.exportCsv')}</Button>
          <Button variant="ghost" size="sm" onClick={() => window.print()}>{t('dash.print')}</Button>
        </div>
      </div>

      <Card className="space-y-4 no-print-border">
        <PeriodPicker value={period} onChange={setPeriod} resolved={model.periods} dateMax={model.bounds.dateMax} />
        <hr className="border-slate-200 dark:border-slate-800" />
        <FilterBar filters={filters} onChange={setFilters} options={options} labels={labels} />
      </Card>

      {model.limitations.length > 0 && (
        <aside className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30" data-testid="limitations">
          <div className="mb-1 font-semibold">{t('lim.title')}</div>
          <ul className="list-disc space-y-1 pl-5">{model.limitations.map((l, i) => <li key={i}>{limitationText(l, tt)}</li>)}</ul>
        </aside>
      )}

      {mode === 'manager' && (
        <section className="space-y-3" data-testid="manager-summary">
          <Card className="border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/30">
            <CardTitle className="mb-2">{t('mgr.summary')}</CardTitle>
            {exec.map((l, i) => <p key={i} className="text-sm">{l}</p>)}
          </Card>
        </section>
      )}

      <KpiCards model={model} filters={filters} onDrill={openDrill} showHidden={mode === 'analyst'} />

      {mode === 'manager' ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {chartAvail('comparison') ? <ComparisonChart model={model} onFilter={addFilter} /> : chartAvail('trend') ? <TrendChart model={model} onFilter={addFilter} /> : null}
            {chartAvail('waterfall') && <WaterfallChart model={model} onFilter={addFilter} />}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <ListCard title={t('mgr.risks')} empty={t('mgr.noRisks')} items={risks} tone="risk" currency={cur} />
            <ListCard title={t('mgr.opportunities')} empty={t('mgr.noOpps')} items={opps} tone="opportunity" currency={cur} />
          </div>
          <Card>
            <CardTitle className="mb-2">{t('mgr.actions')}</CardTitle>
            <ol className="list-decimal space-y-1 pl-5 text-sm" data-testid="actions">{actions.map((a, i) => <li key={i}>{a}</li>)}</ol>
          </Card>
          <h2 className="text-lg font-semibold">{t('mgr.topInsights')} ({Math.min(shownInsights.length, 8)})</h2>
          <p className="text-xs text-slate-500">{insights?.periods ? t('ins.windowNote', { days: insights.periods.days }) : t('ins.noPeriod')}</p>
          <div className="space-y-3" data-testid="insight-list">{shownInsights.slice(0, 8).map(card)}</div>
        </>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {chartAvail('trend') && <TrendChart model={model} onFilter={addFilter} />}
            {chartAvail('comparison') && <ComparisonChart model={model} onFilter={addFilter} />}
            {chartAvail('topCustomers') && <RankingChart model={model} onFilter={addFilter} dim="customer" />}
            {chartAvail('topProducts') && <RankingChart model={model} onFilter={addFilter} dim="product" />}
            {chartAvail('salespeople') && <RankingChart model={model} onFilter={addFilter} dim="salesperson" n={10} />}
            {chartAvail('category') && <CategoryChart model={model} onFilter={addFilter} />}
            {chartAvail('waterfall') && <WaterfallChart model={model} onFilter={addFilter} />}
            {chartAvail('pareto') && <ParetoChart model={model} onFilter={addFilter} />}
          </div>
          {model.charts.some((c) => !c.available) && (
            <details className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
              <summary className="cursor-pointer font-medium">{t('ch.hiddenTitle')} ({model.charts.filter((c) => !c.available).length})</summary>
              <ul className="mt-2 space-y-1 text-xs">{model.charts.filter((c) => !c.available).map((c) => <li key={c.id}><b>{t(`ch.${c.id}` as MessageKey)}</b> – {t(`ch.reason.${c.reason}` as MessageKey)}</li>)}</ul>
            </details>
          )}
          <div className="grid grid-cols-1 gap-4">
            {DIMS.map((d) => model.tables[d] && model.tables[d]!.rows.length > 1 && (
              <EntityTableView key={d} table={model.tables[d]!} currency={cur} onFilter={(k) => addFilter(d, k)}
                onDrill={(r) => openDrill(r.label, { filter: { [FIELD[d]]: [r.key] }, range: model.periods.current })} />
            ))}
          </div>
          <h2 className="text-lg font-semibold">{t('ins.top')} ({shownInsights.length})</h2>
          <div className="space-y-3" data-testid="insight-list">{shownInsights.map(card)}</div>
          {insights && insights.unavailable.length > 0 && (
            <details className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
              <summary className="cursor-pointer font-medium">{t('ins.unavailable')} ({insights.unavailable.length})</summary>
              <ul className="mt-2 space-y-1">{insights.unavailable.map((u, n) => <li key={n}><b>{t(`rule.${u.rule}` as MessageKey)}</b> – {t(`unavail.${u.reason}` as MessageKey)}</li>)}</ul>
            </details>
          )}
          <Card className="space-y-2" data-testid="methodology">
            <CardTitle>{t('an.method')}</CardTitle>
            <ul className="list-disc space-y-1 pl-5 text-sm">{(['an.m1', 'an.m2', 'an.m3', 'an.m4', 'an.m5'] as const).map((k) => <li key={k}>{t(k)}</li>)}</ul>
            <div className="text-xs text-slate-500"><b>{t('an.sources')}:</b> {imports.map((i) => `${i.fileName} (${i.added})`).join(', ')}</div>
            {model.warnings.length > 0 && <ul className="text-xs text-slate-500">{model.warnings.map((w, i) => <li key={i}>⚠ {warningText(w, tt)}</li>)}</ul>}
          </Card>
        </>
      )}
      {drill && <DrillDrawer drill={drill} currency={cur} importNames={importNames} onClose={() => setDrill(null)} />}
    </div>
  );
}

function ListCard({ title, items, empty, tone, currency }: { title: string; items: Insight[]; empty: string; tone: 'risk' | 'opportunity'; currency: string }) {
  const { t } = useLang();
  return (
    <Card data-testid={`list-${tone}`}>
      <CardTitle className="mb-2">{title}</CardTitle>
      {items.length === 0 ? <p className="text-sm text-slate-500">{empty}</p> : (
        <ul className="space-y-2 text-sm">{items.map((i) => <li key={i.id} className={cn('border-l-4 pl-3', tone === 'risk' ? 'border-red-500' : 'border-emerald-500')}>{t(i.titleKey as MessageKey, i.params, currency)}</li>)}</ul>
      )}
    </Card>
  );
}
