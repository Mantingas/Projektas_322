'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from './LangProvider';
import { Button } from './ui/button';
import { Card, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { cn } from '@/lib/cn';
import { engine, EngineError } from '@/lib/engineClient';
import type { BuildResult } from '@/lib/engineSession';
import type { Insight } from '@/engine/types';
import { FILTER_FIELD } from '@/lib/dimMaps';
import { type Dimension, type FilterSpec, type SalesDimension } from '@/engine/analytics/filters';
import type { PeriodSelection } from '@/engine/analytics/periods';
import type { DrillSpec } from '@/engine/analytics/provenance';
import { renderManagementSummary } from '@/engine/report/summary';
import { renderReportCsv } from '@/engine/report/export';
import { buildReport, formatImpact, renderInsight } from '@/lib/report';
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
import type { EntityTable } from '@/engine/analytics/compare';
import type { MessageKey } from '@/i18n';

type Mode = 'manager' | 'analyst';
const FIELD = FILTER_FIELD;
const DIMS: SalesDimension[] = ['customer', 'product', 'salesperson', 'category'];

export function InsightsView({ version, goImport }: { version: number; goImport: () => void }) {
  const { t, lang } = useLang();
  const [res, setRes] = useState<BuildResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seriesKey, setSeriesKey] = useState('');
  const [mode, setMode] = useState<Mode>('manager');
  const [filters, setFilters] = useState<FilterSpec>({});
  const [period, setPeriod] = useState<PeriodSelection>({ preset: 'r30' });
  const [rolling, setRolling] = useState(false);
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const seq = useRef(0);

  // all heavy maths runs in the worker; the page keeps showing the previous result while the next one is computed
  useEffect(() => {
    const my = ++seq.current;
    setBusy(true);
    const timer = setTimeout(() => {
      engine().call('build', [{ version, seriesKey: seriesKey || undefined, filters, period, includeRolling: rolling }])
        .then((r) => { if (seq.current === my) { setRes(r); setError(null); } })
        .catch((e: unknown) => { if (seq.current === my) setError(t(e instanceof EngineError && e.code === 'timeout' ? 'err.workerTimeout' : 'err.worker')); })
        .finally(() => { if (seq.current === my) setBusy(false); });
    }, 120);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, seriesKey, filters, period, rolling]);

  const labels = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of DIMS) for (const o of res?.options[d] ?? []) m[`${d}:${o.key}`] = o.label;
    return m;
  }, [res]);
  const importNames = useMemo(() => Object.fromEntries((res?.imports ?? []).map((i) => [i.id, i.fileName])), [res]);
  // filter pickers list every entity of the series (both periods), not only the current window
  const options = useMemo(() => {
    const out: Partial<Record<Dimension, EntityTable['rows']>> = {};
    for (const d of DIMS) if (res?.options[d]) out[d] = res.options[d]!.map((o) => ({ key: o.key, label: o.label, current: o.value, previous: 0, change: 0, changePct: null, share: 0, lines: 0, quantity: null, orders: null, margin: null }));
    return out;
  }, [res]);

  if (res === null) return error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p> : <p>{t('dash.computing')}</p>;
  if (res.empty || !res.model || !res.series) {
    return (
      <Card className="space-y-3 text-center" data-testid="no-data">
        <p>{t('ins.empty')}</p>
        {res.pendingHeld > 0 && <p className="text-sm text-amber-800 dark:text-amber-300">{limitationText({ code: 'held_pending', lines: res.pendingHeld }, (k, p) => t(k, p))}</p>}
        <div><Button onClick={goImport}>{t('ins.goImport')}</Button></div>
      </Card>
    );
  }

  const model = res.model;
  const series = res.series;
  const cur = series.currency;
  const tt: T = (k, p) => t(k, p, cur);
  const insights = res.analysis?.insights ?? [];
  const addFilter = (dim: Dimension, key: string) => setFilters((f) => ({ ...f, [FIELD[dim]]: [...new Set([...((f[FIELD[dim]] as string[] | undefined) ?? []), key])] }));
  const openDrill = (title: string, spec: DrillSpec) => {
    const filter = { ...filters, ...spec.filter };
    setDrill({ title, spec: { ...spec, filter }, filterText: filtersText(spec.filter, labels) || undefined });
  };
  const risks = insights.filter((i) => i.severity === 'risk').slice(0, 3);
  const opps = insights.filter((i) => i.severity === 'opportunity').slice(0, 3);
  const actions = [...new Set(insights.slice(0, 5).map((i) => t(i.actionKey as MessageKey, i.params, cur)))];
  const basisLabel = (b: string) => t(`basis.${b}` as MessageKey);
  const chartAvail = (id: string) => model.charts.find((c) => c.id === id)?.available;
  const exec = executiveLines(model, insights, lang, tt);

  const exportSummary = () => downloadText('management-summary.html', 'text/html', renderManagementSummary(buildSummaryDoc(model, insights, lang, labels, filters)));
  const exportCsv = () => res.analysis && downloadText('insights-report.csv', 'text/csv', renderReportCsv(buildReport(res.analysis, lang)));
  const card = (i: Insight) => <InsightCard key={i.id} insight={i} model={model} expanded={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} onDrill={openDrill} onFilter={addFilter} />;

  return (
    <div className="space-y-6" aria-busy={busy} data-busy={busy}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t('dash.title')} {busy && <span className="text-xs font-normal text-slate-500" data-testid="computing">{t('dash.computing')}</span>}</h1>
        <div className="no-print flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t('dash.mode.label')} className="flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-700">
            {(['manager', 'analyst'] as Mode[]).map((m) => (
              <button key={m} data-testid={`mode-${m}`} aria-pressed={mode === m} onClick={() => setMode(m)} className={cn('px-3 py-1.5 text-sm font-medium', mode === m ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}>{t(`dash.mode.${m}` as MessageKey)}</button>
            ))}
          </div>
          {res.allSeries.length > 1 && (
            <select aria-label={t('ins.series')} data-testid="series-select" value={`${series.currency}|${series.basis}`} onChange={(e) => { setSeriesKey(e.target.value); setFilters({}); }} className="rounded-md border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900">
              {res.allSeries.map((s) => <option key={`${s.currency}|${s.basis}`} value={`${s.currency}|${s.basis}`}>{s.currency} · {basisLabel(s.basis)} ({s.lines})</option>)}
            </select>
          )}
          <Button variant="outline" size="sm" onClick={exportSummary} data-testid="export-html">{t('dash.exportSummary')}</Button>
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid="export-csv">{t('dash.exportCsv')}</Button>
          <Button variant="ghost" size="sm" onClick={() => window.print()}>{t('dash.print')}</Button>
        </div>
      </div>
      {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}

      <Card className="space-y-4">
        <PeriodPicker value={period} onChange={setPeriod} resolved={model.periods} dateMax={res.bounds!.dateMax} presets={res.presets} />
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

      <KpiCards model={model} filters={filters} onDrill={openDrill} showHidden />

      {mode === 'manager' ? (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {chartAvail('comparison') ? <ComparisonChart model={model} onFilter={addFilter} /> : chartAvail('trend') ? <TrendChart model={model} onFilter={addFilter} /> : null}
            {chartAvail('waterfall') && <WaterfallChart model={model} onFilter={addFilter} />}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ListCard title={t('mgr.risks')} empty={t('mgr.noRisks')} items={risks} tone="risk" currency={cur} />
            <ListCard title={t('mgr.opportunities')} empty={t('mgr.noOpps')} items={opps} tone="opportunity" currency={cur} />
          </div>
          <Card>
            <CardTitle className="mb-2">{t('mgr.actions')}</CardTitle>
            <ol className="list-decimal space-y-1 pl-5 text-sm" data-testid="actions">{actions.map((a, i) => <li key={i}>{a}</li>)}</ol>
          </Card>
          <h2 className="text-lg font-semibold">{t('mgr.topInsights')} ({Math.min(insights.length, 8)})</h2>
          <p className="text-xs text-slate-500" data-testid="insight-period">{t('ins.period', { from: { date: model.periods.current.from }, to: { date: model.periods.current.to }, pfrom: { date: model.periods.previous.from }, pto: { date: model.periods.previous.to } })}</p>
          <div className="space-y-3" data-testid="insight-list">{insights.slice(0, 8).map(card)}</div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
              <EntityTableView key={d} table={model.tables[d]!} currency={cur} onFilter={(k) => addFilter(d, k)} onDrill={(r) => openDrill(r.label, { filter: { [FIELD[d]]: [r.key] }, range: model.periods.current })} />
            ))}
          </div>
          <h2 className="text-lg font-semibold">{t('ins.top')} ({insights.length})</h2>
          <p className="text-xs text-slate-500" data-testid="insight-period">{t('ins.period', { from: { date: model.periods.current.from }, to: { date: model.periods.current.to }, pfrom: { date: model.periods.previous.from }, pto: { date: model.periods.previous.to } })}</p>
          <div className="space-y-3" data-testid="insight-list">{insights.map(card)}</div>
          {res.analysis && res.analysis.unavailable.length > 0 && (
            <details className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
              <summary className="cursor-pointer font-medium">{t('ins.unavailable')} ({res.analysis.unavailable.length})</summary>
              <ul className="mt-2 space-y-1">{res.analysis.unavailable.map((u, n) => <li key={n}><b>{t(`rule.${u.rule}` as MessageKey)}</b> – {t(`unavail.${u.reason}` as MessageKey)}</li>)}</ul>
            </details>
          )}
          <Card className="space-y-3" data-testid="rolling-section">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" data-testid="rolling-toggle" checked={rolling} onChange={(e) => setRolling(e.target.checked)} /> {t('rolling.toggle')}
            </label>
            {rolling && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500">{t('rolling.note')}</p>
                {(res.rolling?.insights ?? []).slice(0, 5).map((i) => (
                  <div key={i.id} className="rounded-lg border border-dashed border-slate-300 p-3 text-sm dark:border-slate-700" data-testid="rolling-insight">
                    <div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone="warn">{t('rolling.badge')}</Badge><Badge tone={i.severity}>{t(`sev.${i.severity}` as MessageKey)}</Badge><span className="text-xs text-slate-500">{formatImpact(i, lang, cur)}</span></div>
                    <div className="font-medium">{renderInsight(i, lang, cur).title}</div>
                    <div className="text-slate-600 dark:text-slate-400">{renderInsight(i, lang, cur).body}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card className="space-y-2" data-testid="methodology">
            <CardTitle>{t('an.method')}</CardTitle>
            <ul className="list-disc space-y-1 pl-5 text-sm">{(['an.m1', 'an.m2', 'an.m3', 'an.m4', 'an.m5'] as const).map((k) => <li key={k}>{t(k)}</li>)}</ul>
            <div className="text-xs text-slate-500"><b>{t('an.sources')}:</b> {res.imports.map((i) => `${i.fileName} (${i.added})`).join(', ')}</div>
            {model.warnings.length > 0 && <ul className="text-xs text-slate-500">{model.warnings.map((w, i) => <li key={i}>⚠ {warningText(w, tt)}</li>)}</ul>}
          </Card>
        </>
      )}
      {drill && <DrillDrawer drill={drill} currency={cur} version={version} seriesKey={`${series.currency}|${series.basis}`} importNames={importNames} onClose={() => setDrill(null)} />}
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
