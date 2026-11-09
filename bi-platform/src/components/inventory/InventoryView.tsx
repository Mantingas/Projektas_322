'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from '../LangProvider';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/cn';
import { engine, EngineError } from '@/lib/engineClient';
import type { BuildInventoryResult } from '@/lib/engineSession';
import type { Insight } from '@/engine/types';
import type { Dimension, FilterSpec, InventoryDimension } from '@/engine/analytics/filters';
import type { PeriodSelection } from '@/engine/analytics/periods';
import type { DrillSpec } from '@/engine/analytics/provenance';
import type { ChartModel } from '@/engine/analytics/view';
import type { EntityTable } from '@/engine/analytics/compare';
import type { UnitPolicy } from '@/engine/purchasing/units';
import { renderManagementSummary } from '@/engine/report/summary';
import { renderReportCsv } from '@/engine/report/export';
import { buildInventoryReport, buildInventorySummaryDoc, inventoryExecutiveLines } from '@/lib/inventorySummary';
import { filtersText } from '@/lib/summary';
import { FILTER_FIELD } from '@/lib/dimMaps';
import { downloadText } from '@/lib/download';
import { limitationText, warningText, type T } from '@/lib/dashFormat';
import { KpiCards } from '../dashboard/KpiCards';
import { PeriodPicker } from '../dashboard/PeriodPicker';
import { FilterBar } from '../dashboard/FilterBar';
import { ParetoChart, RankingChart, TrendChart, WaterfallChart } from '../dashboard/Charts';
import { EntityTableView } from '../dashboard/EntityTable';
import { DrillDrawer, type DrillState } from '../dashboard/DrillDrawer';
import { InsightCard } from '../dashboard/InsightPanel';
import { AbcCard, FlowsCard, MovementChart, ReconTable, RiskTable, SlowTable, WarehouseChart } from './InventoryCharts';
import { fmtDate, type MessageKey } from '@/i18n';

type Mode = 'manager' | 'analyst';
const DIMS: InventoryDimension[] = ['product', 'warehouse', 'category'];
const CHART_TITLE: Record<string, MessageKey> = {
  trend: 'ich.trend', topProducts: 'ich.products', warehouseComparison: 'ich.warehouses', pareto: 'ich.pareto', abc: 'ich.abc', waterfall: 'ich.waterfall', slowMoving: 'ich.slow', stockoutRisk: 'ich.risk', movementTrend: 'ich.movements',
};

export function InventoryView({ version, goImport }: { version: number; goImport: () => void }) {
  const { t, lang } = useLang();
  const [res, setRes] = useState<BuildInventoryResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seriesKey, setSeriesKey] = useState('');
  const [mode, setMode] = useState<Mode>('manager');
  const [filters, setFilters] = useState<FilterSpec>({});
  const [period, setPeriod] = useState<PeriodSelection>({ preset: 'r30' });
  const [unitPolicy, setUnitPolicy] = useState<UnitPolicy>('strict');
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const seq = useRef(0);

  // all heavy maths runs in the worker; the page keeps showing the previous result while the next one is computed
  useEffect(() => {
    const my = ++seq.current;
    setBusy(true);
    const timer = setTimeout(() => {
      engine().call('buildInventory', [{ version, seriesKey: seriesKey || undefined, filters, period, unitPolicy }])
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
  const chartModel = useMemo<ChartModel | null>(() => (view ? ({ ...view, module: 'inventory' } as ChartModel) : null), [view]);
  const insights: Insight[] = res?.analysis?.insights ?? [];

  if (res === null) return error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p> : <p>{t('dash.computing')}</p>;
  if (res.empty || !view || !chartModel || !res.series) {
    return (
      <Card className="space-y-3 text-center" data-testid="no-inventory-data">
        <p>{t('inv.empty')}</p>
        {res.pendingHeld > 0 && <p className="text-sm text-amber-800 dark:text-amber-300">{limitationText({ code: 'held_pending', lines: res.pendingHeld }, (k, p) => t(k, p))}</p>}
        <div><Button onClick={goImport}>{t('inv.goImport')}</Button></div>
      </Card>
    );
  }

  const series = res.series;
  const cur = series.currency;
  const tt: T = (k, p) => t(k, p, cur);
  const asOf = view.asOf.current ?? view.periods.current.to;
  const addFilter = (dim: Dimension, key: string) => setFilters((f) => ({ ...f, [FILTER_FIELD[dim]]: [...new Set([...((f[FILTER_FIELD[dim]] as string[] | undefined) ?? []), key])] }));
  const openDrill = (title: string, spec: DrillSpec) => {
    const filter = { ...filters, ...spec.filter };
    setDrill({ title, spec: { ...spec, filter }, filterText: filtersText(spec.filter, labels) || undefined });
  };
  const position = (filter: FilterSpec = {}): DrillSpec => ({ filter, asOf });
  const movements = (types?: string[]): DrillSpec => ({ filter: {}, range: view.periods.current, movements: true, moveTypes: types });
  const kpiDrill = (id: string): DrillSpec | null => {
    switch (id) {
      case 'i_turnover': case 'i_doh': return movements(['issue', 'return']);
      case 'i_slow': return position({ products: view.keys.slow });
      case 'i_nonmoving': return position({ products: view.keys.nonMoving });
      case 'i_stockout': return position({ products: view.keys.risk });
      default: return position();
    }
  };
  const insightDrill = (i: Insight, key: string): DrillSpec => (i.id === 'inventory.unusual_movements' ? { filter: { products: [key] }, range: view.periods.current, movements: true } : position({ products: [key] }));
  const chartAvail = (id: string) => view.charts.find((c) => c.id === id)?.available;
  const kpi = (id: string) => view.kpis.find((k) => k.id === id);
  const risks = insights.filter((i) => i.severity === 'risk').slice(0, 3);
  const opps = insights.filter((i) => i.severity === 'opportunity').slice(0, 3);
  const actions = [...new Set(insights.slice(0, 5).map((i) => t(i.actionKey as MessageKey, i.params, cur)))];
  const exec = inventoryExecutiveLines(view, insights, lang, tt);
  const exportSummary = () => downloadText('inventory-summary.html', 'text/html', renderManagementSummary(buildInventorySummaryDoc(view, insights, lang, labels, filters)));
  const exportCsv = () => downloadText('inventory-insights.csv', 'text/csv', renderReportCsv(buildInventoryReport(view, insights, lang)));
  const reasonText = (r?: string) => (r ? t(`mu.${r}` as MessageKey) : '');

  const extraChart = (i: Insight) => {
    switch (i.chart) {
      case 'abc': return <AbcCard view={view} />;
      case 'slowMoving': return <SlowTable view={view} why={chartAvail('slowMoving') ? undefined : reasonText(kpi('i_nonmoving')?.unavailable)} onDrill={(l, pk) => openDrill(l, position({ products: [pk] }))} />;
      case 'stockoutRisk': return <RiskTable view={view} available={kpi('i_stockout')?.current !== null} onDrill={(l, pk) => openDrill(l, position({ products: [pk] }))} />;
      case 'movementTrend': return <MovementChart view={view} />;
      default: return undefined;
    }
  };
  const card = (i: Insight) => <InsightCard key={i.id} insight={i} model={chartModel} expanded={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} onDrill={openDrill} onFilter={addFilter} extraChart={extraChart} drillFor={insightDrill} />;

  return (
    <div className="space-y-6" aria-busy={busy} data-busy={busy} data-testid="inventory-view">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t('inv.title')} {busy && <span className="text-xs font-normal text-slate-500" data-testid="computing">{t('dash.computing')}</span>}</h1>
        <div className="no-print flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t('dash.mode.label')} className="flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-700">
            {(['manager', 'analyst'] as Mode[]).map((m) => (
              <button key={m} data-testid={`mode-${m}`} aria-pressed={mode === m} onClick={() => setMode(m)} className={cn('px-3 py-1.5 text-sm font-medium', mode === m ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}>{t(`dash.mode.${m}` as MessageKey)}</button>
            ))}
          </div>
          {res.allSeries.length > 1 && (
            <select aria-label={t('ins.series')} data-testid="series-select" value={`${series.currency}|${series.basis}`} onChange={(e) => { setSeriesKey(e.target.value); setFilters({}); }} className="rounded-md border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900">
              {res.allSeries.map((s) => <option key={`${s.currency}|${s.basis}`} value={`${s.currency}|${s.basis}`}>{s.currency}</option>)}
            </select>
          )}
          <Button variant="outline" size="sm" onClick={exportSummary} data-testid="export-html">{t('inv.exportSummary')}</Button>
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid="export-csv">{t('inv.exportCsv')}</Button>
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

      <Card className="space-y-1 text-sm" data-testid="inv-sources">
        <CardTitle>{t('inv.sources')}</CardTitle>
        <p data-testid="inv-asof">{view.asOf.current ? <>{t('inv.position', { date: fmtDate(view.asOf.current, lang) })}{view.asOf.previous && <span className="text-slate-500"> · {t('inv.positionPrev', { date: fmtDate(view.asOf.previous, lang) })}</span>}</> : t('inv.noPosition')}</p>
        <p className="text-xs text-slate-500">{view.snapshotDates.length ? t('inv.sourceSnapshots', { n: view.snapshotDates.length, from: fmtDate(view.snapshotDates[0]!, lang), to: fmtDate(view.snapshotDates[view.snapshotDates.length - 1]!, lang) }) : `${t('inv.sourceSnapshots', { n: 0, from: '–', to: '–' })}`}</p>
        <p className="text-xs text-slate-500">{view.movementSpan ? t('inv.sourceMovements', { n: view.movementSpan.lines, from: fmtDate(view.movementSpan.from, lang), to: fmtDate(view.movementSpan.to, lang) }) : `${t('inv.sourceMovements', { n: 0, from: '–', to: '–' })}`}</p>
        <p className="flex flex-wrap gap-1 pt-1">{res.imports.map((i) => <Badge key={i.id} tone="info">{i.kind ? t(`inv.kind.${i.kind}` as MessageKey) : ''} · {i.fileName}</Badge>)}</p>
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

      <KpiCards model={chartModel} filters={filters} onDrill={openDrill} showHidden drillFor={kpiDrill} />

      {mode === 'manager' ? (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {chartAvail('trend') && <TrendChart model={chartModel} onFilter={addFilter} />}
            {chartAvail('waterfall') ? <WaterfallChart model={chartModel} onFilter={addFilter} /> : <WarehouseChart view={view} onFilter={addFilter} />}
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
          <p className="text-xs text-slate-500" data-testid="insight-period">{t('ins.period', { from: { date: view.periods.current.from }, to: { date: view.periods.current.to }, pfrom: { date: view.periods.previous.from }, pto: { date: view.periods.previous.to } })}</p>
          <div className="space-y-3" data-testid="insight-list">{insights.slice(0, 8).map(card)}</div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {chartAvail('trend') && <TrendChart model={chartModel} onFilter={addFilter} />}
            {chartAvail('waterfall') && <WaterfallChart model={chartModel} onFilter={addFilter} />}
            {chartAvail('warehouseComparison') && <WarehouseChart view={view} onFilter={addFilter} />}
            {chartAvail('topProducts') && <RankingChart model={chartModel} onFilter={addFilter} dim="product" />}
            {chartAvail('pareto') && <ParetoChart model={chartModel} onFilter={addFilter} />}
            {chartAvail('abc') && <AbcCard view={view} />}
            {chartAvail('movementTrend') && <MovementChart view={view} />}
          </div>
          <SlowTable view={view} why={chartAvail('slowMoving') ? undefined : reasonText(kpi('i_nonmoving')?.unavailable)} onDrill={(l, pk) => openDrill(l, position({ products: [pk] }))} />
          <RiskTable view={view} available={kpi('i_stockout')?.current !== null} onDrill={(l, pk) => openDrill(l, position({ products: [pk] }))} />
          <FlowsCard view={view} onDrill={(title, types) => openDrill(title, movements(types))} />
          <ReconTable view={view} />
          {view.charts.some((c) => !c.available) && (
            <details className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
              <summary className="cursor-pointer font-medium">{t('ch.hiddenTitle')} ({view.charts.filter((c) => !c.available).length})</summary>
              <ul className="mt-2 space-y-1 text-xs">{view.charts.filter((c) => !c.available).map((c) => <li key={c.id}><b>{t(CHART_TITLE[c.id] ?? ('ich.trend' as MessageKey))}</b> – {t(`ch.reason.${c.reason}` as MessageKey)}</li>)}</ul>
            </details>
          )}
          <div className="grid grid-cols-1 gap-4">
            {DIMS.map((d) => view.tables[d] && view.tables[d]!.rows.length > 1 && (
              <EntityTableView key={d} table={view.tables[d]!} currency={cur} onFilter={(k) => addFilter(d, k)} onDrill={(r) => openDrill(r.label, position({ [FILTER_FIELD[d]]: [r.key] }))} />
            ))}
          </div>
          <h2 className="text-lg font-semibold">{t('ins.top')} ({insights.length})</h2>
          <p className="text-xs text-slate-500" data-testid="insight-period">{t('ins.period', { from: { date: view.periods.current.from }, to: { date: view.periods.current.to }, pfrom: { date: view.periods.previous.from }, pto: { date: view.periods.previous.to } })}</p>
          <div className="space-y-3" data-testid="insight-list">{insights.map(card)}</div>
          {res.analysis && res.analysis.unavailable.length > 0 && (
            <details className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
              <summary className="cursor-pointer font-medium">{t('ins.unavailable')} ({res.analysis.unavailable.length})</summary>
              <ul className="mt-2 space-y-1">{res.analysis.unavailable.map((u, n) => <li key={n}><b>{t(`irule.${u.rule}` as MessageKey)}</b> – {t(`iunavail.${u.reason}` as MessageKey)}</li>)}</ul>
            </details>
          )}
          <Card className="space-y-2" data-testid="methodology">
            <CardTitle>{t('an.method')}</CardTitle>
            <ul className="list-disc space-y-1 pl-5 text-sm">{(['ian.m1', 'ian.m2', 'ian.m3', 'ian.m4', 'ian.m5'] as const).map((k) => <li key={k}>{t(k)}</li>)}</ul>
            <p className="text-xs text-slate-500">{t('inv.thresholds', { slow: view.thresholds.slow, target: view.thresholds.target, risk: view.thresholds.risk })}</p>
            <div className="text-xs text-slate-500"><b>{t('an.sources')}:</b> {res.imports.map((i) => `${i.fileName} (${i.added})`).join(', ')}</div>
            {view.warnings.length > 0 && <ul className="text-xs text-slate-500">{view.warnings.map((w, i) => <li key={i}>⚠ {warningText(w, tt)}</li>)}</ul>}
          </Card>
        </>
      )}
      {drill && <DrillDrawer module="inventory" drill={drill} currency={cur} version={version} seriesKey={`${series.currency}|${series.basis}`} importNames={importNames} onClose={() => setDrill(null)} />}
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
