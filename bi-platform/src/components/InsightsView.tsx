'use client';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLang } from './LangProvider';
import { Button } from './ui/button';
import { Card, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { getDb } from '@/db/db';
import { loadAllSales } from '@/db/store';
import { analyzeSales } from '@/engine/insights/engine';
import type { Insight, SalesRecord } from '@/engine/types';
import { renderReportCsv, renderReportHtml } from '@/engine/report/export';
import { buildReport, formatEvidence, formatImpact, renderInsight } from '@/lib/report';
import { downloadText } from '@/lib/download';
import { fmtDate, money, num, pct } from '@/i18n';
import type { MessageKey } from '@/i18n';
import { cn } from '@/lib/cn';

type Filter = 'all' | Insight['severity'];

export function InsightsView({ version, goImport }: { version: number; goImport: () => void }) {
  const { t, lang } = useLang();
  const [records, setRecords] = useState<SalesRecord[] | null>(null);
  const [seriesKey, setSeriesKey] = useState<string>('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let alive = true;
    loadAllSales(getDb()).then((r) => alive && setRecords(r)).catch(() => alive && setRecords([]));
    return () => { alive = false; };
  }, [version]);

  const analysis = useMemo(() => {
    if (!records || records.length === 0) return null;
    const [currency, basis] = seriesKey.split('|');
    return analyzeSales(records, currency && basis ? { currency, basis: basis as 'net' | 'gross' | 'unknown' } : undefined);
  }, [records, seriesKey]);

  if (records === null) return <p>…</p>;
  if (!analysis) {
    return (
      <Card className="space-y-3 text-center" data-testid="no-data">
        <p>{t('ins.empty')}</p>
        <div><Button onClick={goImport}>{t('ins.goImport')}</Button></div>
      </Card>
    );
  }

  const cur = analysis.series.currency;
  const fmtM = (n: number) => money(n, { lang, currency: cur });
  const k = analysis.kpis;
  const shown = analysis.insights.filter((i) => filter === 'all' || i.severity === filter);
  const basisLabel = (b: string) => t(`basis.${b}` as MessageKey);

  const exportHtml = () => downloadText('insights-report.html', 'text/html', renderReportHtml(buildReport(analysis, lang)));
  const exportCsv = () => downloadText('insights-report.csv', 'text/csv', renderReportCsv(buildReport(analysis, lang)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('ins.title')}</h1>
        <div className="no-print flex flex-wrap items-center gap-2">
          {analysis.allSeries.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              {t('ins.series')}
              <select
                data-testid="series-select"
                value={`${analysis.series.currency}|${analysis.series.basis}`}
                onChange={(e) => setSeriesKey(e.target.value)}
                className="rounded-md border border-slate-300 bg-transparent px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
              >
                {analysis.allSeries.map((s) => <option key={`${s.currency}|${s.basis}`} value={`${s.currency}|${s.basis}`}>{s.currency} · {basisLabel(s.basis)} ({s.lines})</option>)}
              </select>
            </label>
          )}
          <Button variant="outline" size="sm" onClick={exportHtml} data-testid="export-html">{t('ins.exportHtml')}</Button>
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid="export-csv">{t('ins.exportCsv')}</Button>
          <Button variant="ghost" size="sm" onClick={() => window.print()}>{t('ins.print')}</Button>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="KPI">
        <Kpi label={`${t('kpi.revenue')} (${basisLabel(analysis.series.basis)})`} value={fmtM(k.revenue)} testid="kpi-revenue" />
        <Kpi label={t('kpi.lines')} value={num(k.lines, lang)} testid="kpi-lines" />
        {k.documents !== undefined && <Kpi label={t('kpi.documents')} value={num(k.documents, lang)} />}
        {k.customers !== undefined && <Kpi label={t('kpi.customers')} value={num(k.customers, lang)} />}
        {k.products !== undefined && <Kpi label={t('kpi.products')} value={num(k.products, lang)} />}
        {k.quantity !== undefined && <Kpi label={t('kpi.quantity')} value={num(k.quantity, lang)} />}
        {k.averageDocumentValue !== undefined && <Kpi label={t('kpi.avgDoc')} value={fmtM(k.averageDocumentValue)} />}
        {k.margin && <Kpi label={t('kpi.margin')} value={pct(k.margin.marginPct, lang)} note={t('kpi.marginNote', { coverage: { pct: k.margin.costCoverage } })} />}
        <Kpi label={t('kpi.range')} value={`${fmtDate(k.dateMin, lang)} – ${fmtDate(k.dateMax, lang)}`} small />
      </section>

      {k.monthly.length > 1 && (
        <Card>
          <CardTitle className="mb-3">{t('ins.monthly')}</CardTitle>
          <div className="h-56 w-full" role="img" aria-label={t('ins.monthly')}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={k.monthly} margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b855" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v: number) => num(v, lang)} width={64} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => fmtM(Number(v))} />
                <Bar dataKey="revenue" fill="#4f46e5" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('ins.top')} ({analysis.insights.length})</h2>
        <div className="no-print flex gap-1" role="group">
          {(['all', 'risk', 'opportunity', 'info'] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={cn('rounded-full border px-3 py-1 text-xs', filter === f ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 dark:border-slate-700')}>
              {t(`ins.filter.${f}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        {analysis.periods
          ? t('ins.period', { from: { date: analysis.periods.currentFrom }, to: { date: analysis.periods.currentTo }, pfrom: { date: analysis.periods.previousFrom }, pto: { date: analysis.periods.previousTo } })
          : t('ins.noPeriod')}
      </p>

      <div className="space-y-3" data-testid="insight-list">
        {shown.map((i) => {
          const r = renderInsight(i, lang, cur);
          return (
            <Card key={i.id} data-testid="insight" data-insight-id={i.id}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone={i.severity}>{t(`sev.${i.severity}` as MessageKey)}</Badge>
                <span className="text-xs text-slate-500">{t('ins.reliability')}: <b>{t(`rel.${i.reliability}` as MessageKey)}</b> · {t('ins.impact')}: <b>{formatImpact(i, lang, cur)}</b></span>
              </div>
              <CardTitle className="text-lg">{r.title}</CardTitle>
              <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{r.body}</p>
              {i.evidence.some((e) => e.label !== 'period') && (
                <ul className="mt-2 list-disc pl-5 text-sm text-slate-600 dark:text-slate-400">
                  {i.evidence.filter((e) => e.label !== 'period').map((e, n) => <li key={n}>{formatEvidence(e, lang, cur)}</li>)}
                </ul>
              )}
              <p className="mt-3 text-sm"><b>{t('ins.action')}:</b> {r.action}</p>
              <p className="mt-1 text-xs text-slate-500">{r.reliabilityReason}</p>
            </Card>
          );
        })}
      </div>

      {analysis.unavailable.length > 0 && (
        <details className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
          <summary className="cursor-pointer font-medium">{t('ins.unavailable')} ({analysis.unavailable.length})</summary>
          <ul className="mt-2 space-y-1">
            {analysis.unavailable.map((u, n) => (
              <li key={n}><b>{t(`rule.${u.rule}` as MessageKey)}</b> – {t(`unavail.${u.reason}` as MessageKey)}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Kpi({ label, value, note, small, testid }: { label: string; value: string; note?: string; small?: boolean; testid?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cn('mt-1 font-semibold', small ? 'text-sm' : 'text-xl')} data-testid={testid}>{value}</div>
      {note && <div className="mt-1 text-xs text-slate-500">{note}</div>}
    </Card>
  );
}
