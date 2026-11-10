'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from '../LangProvider';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/cn';
import { engine, EngineError } from '@/lib/engineClient';
import type { BuildFinanceResult } from '@/lib/engineSession';
import type { FinanceSide, Insight } from '@/engine/types';
import type { Dimension, FilterSpec } from '@/engine/analytics/filters';
import type { PeriodSelection } from '@/engine/analytics/periods';
import type { DrillSpec } from '@/engine/analytics/provenance';
import type { ChartModel } from '@/engine/analytics/view';
import type { EntityTable } from '@/engine/analytics/compare';
import { renderManagementSummary } from '@/engine/report/summary';
import { renderReportCsv } from '@/engine/report/export';
import { buildFinanceReport, buildFinanceSummaryDoc, financeExecutiveLines } from '@/lib/financeSummary';
import { filtersText } from '@/lib/summary';
import { FILTER_FIELD } from '@/lib/dimMaps';
import { downloadText } from '@/lib/download';
import { limitationText, warningText, type T } from '@/lib/dashFormat';
import { KpiCards } from '../dashboard/KpiCards';
import { PeriodPicker } from '../dashboard/PeriodPicker';
import { FilterBar } from '../dashboard/FilterBar';
import { ParetoChart, RankingChart, WaterfallChart } from '../dashboard/Charts';
import { EntityTableView } from '../dashboard/EntityTable';
import { DrillDrawer, type DrillState } from '../dashboard/DrillDrawer';
import { InsightCard } from '../dashboard/InsightPanel';
import { AgingChart, BehaviourTable, CreditTable, DuplicatesTable, DueTimelineChart, MatchingCard, OverdueLinesTable, OverdueRankTable, OverdueTrendChart, OverviewCard } from './FinanceCharts';
import { fmtDate, type MessageKey } from '@/i18n';

type Mode = 'manager' | 'analyst';
const CHART_TITLE: Record<string, MessageKey> = { aging: 'fch.aging', overdueTrend: 'fch.overdueTrend', dueTimeline: 'fch.dueTimeline', behaviour: 'fch.behaviour', topCustomers: 'ch.topCustomers', topSuppliers: 'ch.topSuppliers', pareto: 'fch.pareto', waterfall: 'fch.waterfall' };
const FAR_PAST = '1990-01-01';

export function FinanceView({ version, goImport, initialSide = 'receivable' }: { version: number; goImport: () => void; initialSide?: FinanceSide }) {
  const { t, lang } = useLang();
  const [res, setRes] = useState<BuildFinanceResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seriesKey, setSeriesKey] = useState('');
  const [side, setSide] = useState<FinanceSide>(initialSide);
  const [mode, setMode] = useState<Mode>('manager');
  const [filters, setFilters] = useState<FilterSpec>({});
  const [period, setPeriod] = useState<PeriodSelection>({ preset: 'r30' });
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => setSide(initialSide), [initialSide]);

  // all heavy maths runs in the worker; the page keeps showing the previous result while the next one is computed
  useEffect(() => {
    const my = ++seq.current;
    setBusy(true);
    const timer = setTimeout(() => {
      engine().call('buildFinance', [{ version, seriesKey: seriesKey || undefined, side, filters, period }])
        .then((r) => { if (seq.current === my) { setRes(r); setError(null); if (r.model && r.model.side !== side) setSide(r.model.side); } })
        .catch((e: unknown) => { if (seq.current === my) setError(t(e instanceof EngineError && e.code === 'timeout' ? 'err.workerTimeout' : 'err.worker')); })
        .finally(() => { if (seq.current === my) setBusy(false); });
    }, 120);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, seriesKey, side, filters, period]);

  const dim: 'customer' | 'supplier' = side === 'receivable' ? 'customer' : 'supplier';
  const labels = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of res?.options[dim] ?? []) m[`${dim}:${o.key}`] = o.label;
    return m;
  }, [res, dim]);
  const importNames = useMemo(() => Object.fromEntries((res?.imports ?? []).map((i) => [i.id, i.fileName])), [res]);
  const options = useMemo(() => {
    const out: Partial<Record<Dimension, EntityTable['rows']>> = {};
    if (res?.options[dim]) out[dim] = res.options[dim]!.map((o) => ({ key: o.key, label: o.label, current: o.value, previous: 0, change: 0, changePct: null, share: 0, lines: 0, quantity: null, orders: null, margin: null }));
    return out;
  }, [res, dim]);

  const view = res?.model;
  const chartModel = useMemo<ChartModel | null>(() => (view ? ({ ...view, module: 'finance' } as unknown as ChartModel) : null), [view]);
  const insights: Insight[] = res?.analysis?.insights ?? [];

  if (res === null) return error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p> : <p>{t('dash.computing')}</p>;
  if (res.empty || !view || !chartModel || !res.series) {
    return (
      <Card className="space-y-3 text-center" data-testid="no-finance-data">
        <p>{t('fin.empty')}</p>
        {res.pendingHeld > 0 && <p className="text-sm text-amber-800 dark:text-amber-300">{limitationText({ code: 'held_pending', lines: res.pendingHeld }, (k, p) => t(k, p))}</p>}
        <div><Button onClick={goImport}>{t('fin.goImport')}</Button></div>
      </Card>
    );
  }

  const series = res.series;
  const cur = series.currency;
  const tt: T = (k, p) => t(k, p, cur);
  const asOf = view.asOf.current ?? view.periods.current.to;
  const cpField = FILTER_FIELD[dim];
  const addFilter = (d: Dimension, key: string) => setFilters((f) => ({ ...f, [FILTER_FIELD[d]]: [...new Set([...((f[FILTER_FIELD[d]] as string[] | undefined) ?? []), key])] }));
  const openDrill = (title: string, spec: DrillSpec) => {
    const filter = { ...filters, ...spec.filter };
    setDrill({ title, spec: { ...spec, filter }, filterText: filtersText(spec.filter, labels) || undefined });
  };
  const position = (bucket?: NonNullable<DrillSpec['fin']>['bucket'], filter: FilterSpec = {}): DrillSpec => ({ filter, fin: { side, mode: 'position', asOf, bucket } });
  const flow = (kinds: string[], filter: FilterSpec = {}, range = view.periods.current, keys?: string[]): DrillSpec => ({ filter, range, fin: { side, mode: 'flow', kinds, keys } });
  const cpOf = (key: string): FilterSpec => ({ [cpField]: [key] });
  const kpiDrill = (id: string): DrillSpec | null => {
    switch (id) {
      case 'f_overdue': case 'f_overdue_share': case 'f_overdue_count': return position('overdue');
      case 'f_due_soon': return position('dueSoon');
      case 'f_invoiced': case 'f_dso': case 'f_dpo': return flow(['invoice']);
      case 'f_paid': case 'f_delay': return flow(['payment']);
      case 'f_credits': return flow(['credit_note'], {}, { from: FAR_PAST, to: view.periods.current.to });
      case 'f_dup': return flow(['payment'], {}, { from: FAR_PAST, to: view.periods.current.to }, view.duplicates.filter((g) => g.inWindow).flatMap((g) => g.payments.map((p) => p.key)));
      default: return position();
    }
  };
  const insightDrill = (i: Insight, key: string): DrillSpec => {
    switch (i.id) {
      case 'finance.largest_overdue': case 'finance.long_overdue': case 'finance.overdue_growth': return position('overdue', cpOf(key));
      case 'finance.payment_delay': case 'finance.behaviour_change': case 'finance.duplicate_payments': return flow(['payment'], cpOf(key), { from: FAR_PAST, to: view.periods.current.to });
      case 'finance.unmatched_credits': return flow(['credit_note'], cpOf(key), { from: FAR_PAST, to: view.periods.current.to });
      case 'finance.due_soon': return position('dueSoon', cpOf(key));
      default: return position(undefined, cpOf(key));
    }
  };
  const chartAvail = (id: string) => view.charts.find((c) => c.id === id)?.available;
  const kpi = (id: string) => view.kpis.find((k) => k.id === id);
  const risks = insights.filter((i) => i.severity === 'risk').slice(0, 3);
  const opps = insights.filter((i) => i.severity === 'opportunity').slice(0, 3);
  const actions = [...new Set(insights.slice(0, 5).map((i) => t(i.actionKey as MessageKey, i.params, cur)))];
  const exec = financeExecutiveLines(view, insights, lang, tt);
  const exportSummary = () => downloadText('receivables-payables-summary.html', 'text/html', renderManagementSummary(buildFinanceSummaryDoc(view, insights, lang, labels, filters)));
  const exportCsv = () => downloadText('receivables-payables-insights.csv', 'text/csv', renderReportCsv(buildFinanceReport(view, insights, lang)));
  const overdueOk = kpi('f_overdue')?.current !== null && kpi('f_overdue')?.current !== undefined;
  const drillBucket = (id: string) => openDrill(t(`ag.${id}` as MessageKey), position(id as never));
  const drillCp = (label: string, key: string) => openDrill(label, position('overdue', cpOf(key)));
  const drillPay = (label: string, key: string) => openDrill(label, flow(['payment'], cpOf(key), { from: FAR_PAST, to: view.periods.current.to }));

  const rankChart = (view.charts.find((c) => c.id === (dim === 'customer' ? 'topCustomers' : 'topSuppliers'))?.available) ? <RankingChart model={chartModel} onFilter={addFilter} dim={dim} /> : null;
  const extraChart = (i: Insight) => {
    switch (i.chart) {
      case 'aging': return <AgingChart view={view} onBucket={drillBucket} />;
      case 'overdueTrend': return <OverdueTrendChart view={view} />;
      case 'dueTimeline': return <DueTimelineChart view={view} />;
      case 'behaviour': return <BehaviourTable view={view} onDrill={drillPay} />;
      case 'creditReview': return <CreditTable view={view} />;
      case 'duplicates': return <DuplicatesTable view={view} onDrill={(title, keys) => openDrill(title, flow(['payment'], {}, { from: FAR_PAST, to: view.periods.current.to }, keys))} />;
      case 'overdueRank': return <OverdueRankTable view={view} available={overdueOk} onDrill={drillCp} />;
      case 'topCustomers': case 'topSuppliers': return rankChart ?? undefined;
      default: return undefined;
    }
  };
  const card = (i: Insight) => <InsightCard key={i.id} insight={i} model={chartModel} expanded={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} onDrill={openDrill} onFilter={addFilter} extraChart={extraChart} drillFor={insightDrill} />;

  return (
    <div className="space-y-6" aria-busy={busy} data-busy={busy} data-testid="finance-view" data-side={side}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t('fin.title')} {busy && <span className="text-xs font-normal text-slate-500" data-testid="computing">{t('dash.computing')}</span>}</h1>
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
          <Button variant="outline" size="sm" onClick={exportSummary} data-testid="export-html">{t('fin.exportSummary')}</Button>
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid="export-csv">{t('fin.exportCsv')}</Button>
          <Button variant="ghost" size="sm" onClick={() => window.print()}>{t('dash.print')}</Button>
        </div>
      </div>
      {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}

      <div role="group" aria-label={t('fin.sideSwitch')} className="no-print flex w-fit overflow-hidden rounded-md border border-slate-300 text-sm dark:border-slate-700">
        {(['receivable', 'payable'] as FinanceSide[]).map((s) => (
          <button key={s} data-testid={`fin-side-${s}`} aria-pressed={side === s} disabled={!res.sides.includes(s)} onClick={() => { setSide(s); setFilters({}); }} className={cn('px-4 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-40', side === s ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}>{t(`fin.side.short.${s}` as MessageKey)}</button>
        ))}
      </div>

      <OverviewCard view={view} />

      <Card className="space-y-4">
        <PeriodPicker value={period} onChange={setPeriod} resolved={view.periods} dateMax={res.bounds!.dateMax} presets={res.presets} />
        <hr className="border-slate-200 dark:border-slate-800" />
        <FilterBar filters={filters} onChange={setFilters} options={options} labels={labels} />
      </Card>

      <Card className="space-y-1 text-sm" data-testid="fin-sources">
        <CardTitle>{t('fin.sources')}</CardTitle>
        <p data-testid="fin-asof">{view.asOf.current ? <>{t('fin.position', { date: fmtDate(view.asOf.current, lang) })} · {t(`fin.source.${view.asOf.source}` as MessageKey)}{view.asOf.previous && <span className="text-slate-500"> · {t('fin.positionPrev', { date: fmtDate(view.asOf.previous, lang) })}</span>}</> : t('fin.noPosition')}</p>
        <p className="text-xs text-slate-500">{t('fin.sourceSnapshots', { list: view.sources.snapshots.length ? view.sources.snapshots.map((s) => `${fmtDate(s.date, lang)} (${t(`fin.source.${s.kind}` as MessageKey).split(' (')[0]}, ${s.lines})`).join(' · ') : t('fin.none') })}</p>
        <p className="text-xs text-slate-500">{t('fin.sourceRegisters', { inv: view.sources.registers.invoice ? t('fin.regLine', { n: view.sources.registers.invoice.lines, from: fmtDate(view.sources.registers.invoice.min, lang), to: fmtDate(view.sources.registers.invoice.max, lang) }) : t('fin.none'), pay: view.sources.registers.payment ? t('fin.regLine', { n: view.sources.registers.payment.lines, from: fmtDate(view.sources.registers.payment.min, lang), to: fmtDate(view.sources.registers.payment.max, lang) }) : t('fin.none'), cn: view.sources.registers.credit_note ? t('fin.regLine', { n: view.sources.registers.credit_note.lines, from: fmtDate(view.sources.registers.credit_note.min, lang), to: fmtDate(view.sources.registers.credit_note.max, lang) }) : t('fin.none') })}</p>
        <p className="flex flex-wrap gap-1 pt-1">{res.imports.map((i) => <Badge key={i.id} tone="info">{i.kind ? t(`fin.kind.${i.kind}` as MessageKey) : ''}{i.side ? ` · ${t(`fin.side.short.${i.side as FinanceSide}` as MessageKey)}` : ''} · {i.fileName}</Badge>)}</p>
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
            {chartAvail('aging') && <AgingChart view={view} onBucket={drillBucket} />}
            {chartAvail('overdueTrend') ? <OverdueTrendChart view={view} /> : chartAvail('dueTimeline') ? <DueTimelineChart view={view} /> : null}
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
            {chartAvail('aging') && <AgingChart view={view} onBucket={drillBucket} />}
            {chartAvail('overdueTrend') && <OverdueTrendChart view={view} />}
            {chartAvail('dueTimeline') && <DueTimelineChart view={view} />}
            {rankChart}
            {chartAvail('waterfall') && <WaterfallChart model={chartModel} onFilter={addFilter} />}
            {chartAvail('pareto') && <ParetoChart model={chartModel} onFilter={addFilter} />}
          </div>
          <OverdueRankTable view={view} available={overdueOk} onDrill={drillCp} />
          <OverdueLinesTable view={view} />
          <BehaviourTable view={view} onDrill={drillPay} />
          <MatchingCard view={view} />
          <CreditTable view={view} />
          <DuplicatesTable view={view} onDrill={(title, keys) => openDrill(title, flow(['payment'], {}, { from: FAR_PAST, to: view.periods.current.to }, keys))} />
          {view.charts.some((c) => !c.available) && (
            <details className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
              <summary className="cursor-pointer font-medium">{t('ch.hiddenTitle')} ({view.charts.filter((c) => !c.available).length})</summary>
              <ul className="mt-2 space-y-1 text-xs">{view.charts.filter((c) => !c.available).map((c) => <li key={c.id}><b>{t(CHART_TITLE[c.id] ?? ('fch.aging' as MessageKey))}</b> – {t(`ch.reason.${c.reason}` as MessageKey)}</li>)}</ul>
            </details>
          )}
          {view.tables[dim] && view.tables[dim]!.rows.length > 1 && (
            <EntityTableView table={view.tables[dim]!} currency={cur} onFilter={(k) => addFilter(dim, k)} onDrill={(r) => openDrill(r.label, position(undefined, cpOf(r.key)))} />
          )}
          <h2 className="text-lg font-semibold">{t('ins.top')} ({insights.length})</h2>
          <p className="text-xs text-slate-500" data-testid="insight-period">{t('ins.period', { from: { date: view.periods.current.from }, to: { date: view.periods.current.to }, pfrom: { date: view.periods.previous.from }, pto: { date: view.periods.previous.to } })}</p>
          <div className="space-y-3" data-testid="insight-list">{insights.map(card)}</div>
          {res.analysis && res.analysis.unavailable.length > 0 && (
            <details className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
              <summary className="cursor-pointer font-medium">{t('ins.unavailable')} ({res.analysis.unavailable.length})</summary>
              <ul className="mt-2 space-y-1">{res.analysis.unavailable.map((u, n) => <li key={n}><b>{t(`frule.${u.rule}` as MessageKey)}</b> – {t(`funavail.${u.reason}` as MessageKey)}</li>)}</ul>
            </details>
          )}
          <Card className="space-y-2" data-testid="methodology">
            <CardTitle>{t('an.method')}</CardTitle>
            <ul className="list-disc space-y-1 pl-5 text-sm">{(['fan.m1', 'fan.m2', 'fan.m3', 'fan.m4', 'fan.m5'] as const).map((k) => <li key={k}>{t(k)}</li>)}</ul>
            <p className="text-xs text-slate-500">{t('fin.thresholds', { soon: view.thresholds.soon, long: view.thresholds.long, dup: view.thresholds.dup, min: view.thresholds.min })}</p>
            <div className="text-xs text-slate-500"><b>{t('an.sources')}:</b> {res.imports.map((i) => `${i.fileName} (${i.added})`).join(', ')}</div>
            {view.warnings.length > 0 && <ul className="text-xs text-slate-500">{view.warnings.map((w, i) => <li key={i}>⚠ {warningText(w, tt)}</li>)}</ul>}
          </Card>
        </>
      )}
      {drill && <DrillDrawer module="finance" drill={drill} currency={cur} version={version} seriesKey={`${series.currency}|${series.basis}`} importNames={importNames} onClose={() => setDrill(null)} />}
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
