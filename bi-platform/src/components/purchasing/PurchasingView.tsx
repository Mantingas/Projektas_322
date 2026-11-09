'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from '../LangProvider';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { cn } from '@/lib/cn';
import { engine, EngineError } from '@/lib/engineClient';
import type { BuildPurchasingResult } from '@/lib/engineSession';
import type { Insight } from '@/engine/types';
import type { Dimension, FilterSpec } from '@/engine/analytics/filters';
import type { PeriodSelection } from '@/engine/analytics/periods';
import type { DrillSpec } from '@/engine/analytics/provenance';
import type { ChartModel } from '@/engine/analytics/view';
import type { EntityTable } from '@/engine/analytics/compare';
import type { UnitPolicy } from '@/engine/purchasing/units';
import type { PurchaseDimension } from '@/engine/analytics/filters';
import { renderManagementSummary } from '@/engine/report/summary';
import { renderReportCsv } from '@/engine/report/export';
import { buildPurchasingReport, buildPurchasingSummaryDoc, purchasingExecutiveLines } from '@/lib/purchasingSummary';
import { filtersText } from '@/lib/summary';
import { FILTER_FIELD } from '@/lib/dimMaps';
import { downloadText } from '@/lib/download';
import { limitationText, warningText, type T } from '@/lib/dashFormat';
import { KpiCards } from '../dashboard/KpiCards';
import { PeriodPicker } from '../dashboard/PeriodPicker';
import { FilterBar } from '../dashboard/FilterBar';
import { ComparisonChart, ParetoChart, RankingChart, TrendChart, WaterfallChart } from '../dashboard/Charts';
import { EntityTableView } from '../dashboard/EntityTable';
import { DrillDrawer, type DrillState } from '../dashboard/DrillDrawer';
import { InsightCard } from '../dashboard/InsightPanel';
import { BridgeChart, PriceChangeCard, PriceChangesTable, PriceTrendChart, PriceVarianceTable, QuantityChart, SavingsOverview } from './PurchasingCharts';
import type { MessageKey } from '@/i18n';

type Mode = 'manager' | 'analyst';
const DIMS: PurchaseDimension[] = ['supplier', 'product', 'warehouse'];
const CHART_TITLE: Record<string, MessageKey> = {
  trend: 'pch.trend', comparison: 'pch.comparison', pareto: 'pch.pareto', waterfall: 'pch.waterfall', topSuppliers: 'ch.topSuppliers', topProducts: 'pch.productRank',
  priceTrend: 'pch.priceTrend', priceVariance: 'pch.priceVariance', spendBridge: 'pch.bridge', quantityComparison: 'pch.quantity',
};

export function PurchasingView({ version, goImport }: { version: number; goImport: () => void }) {
  const { t, lang } = useLang();
  const [res, setRes] = useState<BuildPurchasingResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seriesKey, setSeriesKey] = useState('');
  const [mode, setMode] = useState<Mode>('manager');
  const [filters, setFilters] = useState<FilterSpec>({});
  const [period, setPeriod] = useState<PeriodSelection>({ preset: 'r30' });
  const [unitPolicy, setUnitPolicy] = useState<UnitPolicy>('strict');
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [focusPk, setFocusPk] = useState('');
  const seq = useRef(0);

  // all heavy maths runs in the worker; the page keeps showing the previous result while the next one is computed
  useEffect(() => {
    const my = ++seq.current;
    setBusy(true);
    const timer = setTimeout(() => {
      engine().call('buildPurchasing', [{ version, seriesKey: seriesKey || undefined, filters, period, unitPolicy }])
        .then((r) => { if (seq.current === my) { setRes(r); setError(null); } })
        .catch((e: unknown) => { if (seq.current === my) setError(t(e instanceof EngineError && e.code === 'timeout' ? 'err.workerTimeout' : 'err.worker')); })
        .finally(() => { if (seq.current === my) setBusy(false); });
    }, 120);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, seriesKey, filters, period, unitPolicy]);

  const labels = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of DIMS) for (const o of res?.options[d] ?? []) m[`${d}:${o.key}`] = o.label;
    return m;
  }, [res]);
  const importNames = useMemo(() => Object.fromEntries((res?.imports ?? []).map((i) => [i.id, i.fileName])), [res]);
  const options = useMemo(() => {
    const out: Partial<Record<Dimension, EntityTable['rows']>> = {};
    for (const d of DIMS) if (res?.options[d]) out[d] = res.options[d]!.map((o) => ({ key: o.key, label: o.label, current: o.value, previous: 0, change: 0, changePct: null, share: 0, lines: 0, quantity: null, orders: null, margin: null }));
    return out;
  }, [res]);

  const view = res?.model;
  const chartModel = useMemo<ChartModel | null>(() => (view ? ({ ...view, module: 'purchasing' } as ChartModel) : null), [view]);
  const insights: Insight[] = res?.analysis?.insights ?? [];

  if (res === null) return error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p> : <p>{t('dash.computing')}</p>;
  if (res.empty || !view || !chartModel || !res.series) {
    return (
      <Card className="space-y-3 text-center" data-testid="no-purchasing-data">
        <p>{t('pur.empty')}</p>
        {res.pendingHeld > 0 && <p className="text-sm text-amber-800 dark:text-amber-300">{limitationText({ code: 'held_pending', lines: res.pendingHeld }, (k, p) => t(k, p))}</p>}
        <div><Button onClick={goImport}>{t('pur.goImport')}</Button></div>
      </Card>
    );
  }

  const series = res.series;
  const cur = series.currency;
  const tt: T = (k, p) => t(k, p, cur);
  const addFilter = (dim: Dimension, key: string) => setFilters((f) => ({ ...f, [FILTER_FIELD[dim]]: [...new Set([...((f[FILTER_FIELD[dim]] as string[] | undefined) ?? []), key])] }));
  const openDrill = (title: string, spec: DrillSpec) => {
    const filter = { ...filters, ...spec.filter };
    setDrill({ title, spec: { ...spec, filter }, filterText: filtersText(spec.filter, labels) || undefined });
  };
  const drillProduct = (label: string, pk: string, supplier?: string) => openDrill(label, { filter: { products: [pk], ...(supplier ? { suppliers: [supplier] } : {}) }, range: view.periods.current });
  const chartAvail = (id: string) => view.charts.find((c) => c.id === id)?.available;
  const risks = insights.filter((i) => i.severity === 'risk').slice(0, 3);
  const opps = insights.filter((i) => i.severity === 'opportunity').slice(0, 3);
  const actions = [...new Set(insights.slice(0, 5).map((i) => t(i.actionKey as MessageKey, i.params, cur)))];
  const basisLabel = (b: string) => t(`basis.${b}` as MessageKey);
  const exec = purchasingExecutiveLines(view, insights, lang, tt);

  const exportSummary = () => downloadText('purchasing-summary.html', 'text/html', renderManagementSummary(buildPurchasingSummaryDoc(view, insights, lang, labels, filters)));
  const exportCsv = () => downloadText('purchasing-insights.csv', 'text/csv', renderReportCsv(buildPurchasingReport(view, insights, lang)));

  const extraChart = (i: Insight) => {
    switch (i.chart) {
      case 'priceTrend': return <PriceTrendChart view={view} cur={cur} version={version} seriesKey={`${series.currency}|${series.basis}`} filters={filters} unitPolicy={unitPolicy} initialPk={i.evidence.find((e) => e.key)?.key} />;
      case 'priceVariance': return <PriceVarianceTable view={view} cur={cur} onDrill={drillProduct} onPick={setFocusPk} />;
      case 'quantityComparison': return <QuantityChart view={view} />;
      case 'spendBridge': return <BridgeChart view={view} cur={cur} />;
      default: return undefined;
    }
  };
  const card = (i: Insight) => <InsightCard key={i.id} insight={i} model={chartModel} expanded={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} onDrill={openDrill} onFilter={addFilter} extraChart={extraChart} />;
  const priceTrend = <PriceTrendChart key={`pt-${focusPk}`} view={view} cur={cur} version={version} seriesKey={`${series.currency}|${series.basis}`} filters={filters} unitPolicy={unitPolicy} initialPk={focusPk || undefined} />;

  return (
    <div className="space-y-6" aria-busy={busy} data-busy={busy} data-testid="purchasing-view">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t('pur.title')} {busy && <span className="text-xs font-normal text-slate-500" data-testid="computing">{t('dash.computing')}</span>}</h1>
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
          <Button variant="outline" size="sm" onClick={exportSummary} data-testid="export-html">{t('pur.exportSummary')}</Button>
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid="export-csv">{t('pur.exportCsv')}</Button>
          <Button variant="ghost" size="sm" onClick={() => window.print()}>{t('dash.print')}</Button>
        </div>
      </div>
      {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}

      <Card className="space-y-4">
        <PeriodPicker value={period} onChange={setPeriod} resolved={view.periods} dateMax={res.bounds!.dateMax} presets={res.presets} />
        <hr className="border-slate-200 dark:border-slate-800" />
        <FilterBar filters={filters} onChange={setFilters} options={options} labels={labels} />
        <fieldset className="text-sm" data-testid="unit-policy">
          <legend className="mb-1 text-xs font-medium text-slate-500">{t('pur.unitPolicy')}</legend>
          {(['strict', 'metric'] as UnitPolicy[]).map((u) => (
            <label key={u} className="mr-4 inline-flex items-center gap-2"><input type="radio" name="unitpolicy" data-testid={`unit-${u}`} checked={unitPolicy === u} onChange={() => setUnitPolicy(u)} />{t(`pur.unit.${u}` as MessageKey)}</label>
          ))}
          <p className="text-xs text-slate-500">{t('pur.unit.note')}</p>
        </fieldset>
      </Card>

      {view.limitations.length > 0 && (
        <aside className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30" data-testid="limitations">
          <div className="mb-1 font-semibold">{t('lim.title')}</div>
          <ul className="list-disc space-y-1 pl-5">{view.limitations.map((l, i) => <li key={i} data-code={l.code}>{limitationText(l, tt)}</li>)}</ul>
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

      <KpiCards model={chartModel} filters={filters} onDrill={openDrill} showHidden />
      <PriceChangeCard view={view} cur={cur} />

      {mode === 'manager' ? (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {chartAvail('comparison') ? <ComparisonChart model={chartModel} onFilter={addFilter} /> : chartAvail('trend') ? <TrendChart model={chartModel} onFilter={addFilter} /> : null}
            {chartAvail('spendBridge') && <BridgeChart view={view} cur={cur} />}
          </div>
          <SavingsOverview insights={insights} cur={cur} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ListCard title={t('mgr.risks')} empty={t('mgr.noRisks')} items={risks} tone="risk" currency={cur} />
            <ListCard title={t('mgr.opportunities')} empty={t('mgr.noOpps')} items={opps} tone="opportunity" currency={cur} />
          </div>
          <Card>
            <CardTitle className="mb-2">{t('mgr.actions')}</CardTitle>
            <ol className="list-decimal space-y-1 pl-5 text-sm" data-testid="actions">{actions.map((a, i) => <li key={i}>{a}</li>)}</ol>
          </Card>
          <h2 className="text-lg font-semibold">{t('mgr.topInsights')} ({Math.min(insights.length, 8)})</h2>
          <p className="text-xs text-slate-500" data-testid="insight-period">{t('ins.period', { from: { date: view.periods.current.from }, to: { date: view.periods.current.to }, pfrom: { date: view.periods.previous.from }, pto: { date: view.periods.previous.to } })}</p>
          <div className="space-y-3" data-testid="insight-list">{insights.slice(0, 8).map(card)}</div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {chartAvail('trend') && <TrendChart model={chartModel} onFilter={addFilter} />}
            {chartAvail('comparison') && <ComparisonChart model={chartModel} onFilter={addFilter} />}
            {chartAvail('spendBridge') && <BridgeChart view={view} cur={cur} />}
            {chartAvail('waterfall') && <WaterfallChart model={chartModel} onFilter={addFilter} />}
            {chartAvail('topSuppliers') && <RankingChart model={chartModel} onFilter={addFilter} dim="supplier" />}
            {chartAvail('topProducts') && <RankingChart model={chartModel} onFilter={addFilter} dim="product" />}
            {chartAvail('pareto') && <ParetoChart model={chartModel} onFilter={addFilter} />}
            {chartAvail('priceTrend') && priceTrend}
            {chartAvail('quantityComparison') && <QuantityChart view={view} />}
          </div>
          {chartAvail('priceVariance') && <PriceVarianceTable view={view} cur={cur} onDrill={drillProduct} onPick={setFocusPk} />}
          <PriceChangesTable view={view} cur={cur} onDrill={drillProduct} />
          {view.charts.some((c) => !c.available) && (
            <details className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
              <summary className="cursor-pointer font-medium">{t('ch.hiddenTitle')} ({view.charts.filter((c) => !c.available).length})</summary>
              <ul className="mt-2 space-y-1 text-xs">{view.charts.filter((c) => !c.available).map((c) => <li key={c.id}><b>{t(CHART_TITLE[c.id] ?? ('ch.trend' as MessageKey))}</b> – {t(`ch.reason.${c.reason}` as MessageKey)}</li>)}</ul>
            </details>
          )}
          <div className="grid grid-cols-1 gap-4">
            {DIMS.map((d) => view.tables[d] && view.tables[d]!.rows.length > 1 && (
              <EntityTableView key={d} table={view.tables[d]!} currency={cur} onFilter={(k) => addFilter(d, k)} onDrill={(r) => openDrill(r.label, { filter: { [FILTER_FIELD[d]]: [r.key] }, range: view.periods.current })} />
            ))}
          </div>
          <SavingsOverview insights={insights} cur={cur} />
          <h2 className="text-lg font-semibold">{t('ins.top')} ({insights.length})</h2>
          <p className="text-xs text-slate-500" data-testid="insight-period">{t('ins.period', { from: { date: view.periods.current.from }, to: { date: view.periods.current.to }, pfrom: { date: view.periods.previous.from }, pto: { date: view.periods.previous.to } })}</p>
          <div className="space-y-3" data-testid="insight-list">{insights.map(card)}</div>
          {res.analysis && res.analysis.unavailable.length > 0 && (
            <details className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
              <summary className="cursor-pointer font-medium">{t('ins.unavailable')} ({res.analysis.unavailable.length})</summary>
              <ul className="mt-2 space-y-1">{res.analysis.unavailable.map((u, n) => <li key={n}><b>{t(`prule.${u.rule}` as MessageKey)}</b> – {t(`punavail.${u.reason}` as MessageKey)}</li>)}</ul>
            </details>
          )}
          <Card className="space-y-2" data-testid="methodology">
            <CardTitle>{t('an.method')}</CardTitle>
            <ul className="list-disc space-y-1 pl-5 text-sm">{(['pan.m1', 'pan.m2', 'pan.m3', 'pan.m4', 'pan.m5'] as const).map((k) => <li key={k}>{t(k)}</li>)}</ul>
            <div className="text-xs text-slate-500"><b>{t('an.sources')}:</b> {res.imports.map((i) => `${i.fileName} (${i.added})`).join(', ')}</div>
            {view.warnings.length > 0 && <ul className="text-xs text-slate-500">{view.warnings.map((w, i) => <li key={i}>⚠ {warningText(w, tt)}</li>)}</ul>}
          </Card>
        </>
      )}
      {drill && <DrillDrawer module="purchasing" drill={drill} currency={cur} version={version} seriesKey={`${series.currency}|${series.basis}`} importNames={importNames} onClose={() => setDrill(null)} />}
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
