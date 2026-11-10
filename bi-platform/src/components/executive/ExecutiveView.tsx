'use client';
import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLang } from '../LangProvider';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { SimpleInsight } from './SimpleInsight';
import { LinksPanel } from './LinksPanel';
import { TrustFindings } from '../trust/TrustFindings';
import { withheldText } from '@/lib/executiveSummary';
import { DrillDrawer, type DrillState } from '../dashboard/DrillDrawer';
import { engine } from '@/lib/engineClient';
import type { ExecutiveResult } from '@/lib/engineSession';
import type { ExecKpi, ModuleCoverage, RankedItem } from '@/engine/executive/compose';
import type { DrillSpec } from '@/engine/analytics/provenance';
import type { FinanceSide, ModuleId } from '@/engine/types';
import { changeText, fmtUnit } from '@/lib/dashFormat';
import { downloadText } from '@/lib/download';
import { buildExecutiveReport, buildExecutiveSummaryDoc, coverageLimitations, kpiLabel } from '@/lib/executiveSummary';
import { renderManagementSummary } from '@/engine/report/summary';
import { renderReportCsv } from '@/engine/report/export';
import { renderInsight } from '@/lib/report';
import { getDb } from '@/db/db';
import { fmtDate, translate, type MessageKey } from '@/i18n';
import { cn } from '@/lib/cn';

const TONE = { good: 'text-emerald-700 dark:text-emerald-400', bad: 'text-red-700 dark:text-red-400', flat: 'text-slate-600 dark:text-slate-400', na: 'text-slate-400' } as const;
const CLASS_TONE = { fact: 'info', risk: 'risk', opportunity: 'opportunity', scenario: 'neutral' } as const;

export function ExecutiveView({ version, goImport, goModule, onChanged }: { version: number; goImport: () => void; goModule: (m: ModuleId, side?: FinanceSide) => void; onChanged: () => void }) {
  const { t, lang } = useLang();
  const [res, setRes] = useState<ExecutiveResult | null>(null);
  const [err, setErr] = useState(false);
  const [drill, setDrill] = useState<(DrillState & { module: ModuleId; currency: string; seriesKey: string }) | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    setErr(false);
    engine().call('buildExecutive', [{ version }]).then((r) => alive && setRes(r)).catch(() => alive && setErr(true));
    getDb().imports.toArray().then((rows) => alive && setNames(Object.fromEntries(rows.map((r) => [r.id, r.fileName])))).catch(() => undefined);
    return () => { alive = false; };
  }, [version]);
  const m = res?.model;
  const when = (ms?: number) => (ms ? new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : lang === 'pl' ? 'pl-PL' : 'lt-LT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)) : '');
  const labels = useMemo(() => ({}), []);
  void labels;

  if (err) return <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{t('err.unknown')}</p>;
  if (!m) return <p className="text-sm text-slate-500" data-testid="computing">{t('dash.computing')}</p>;
  if (m.empty) {
    return (
      <div className="space-y-4" data-testid="executive-view" data-empty="true">
        <h1 className="text-2xl font-bold tracking-tight">{t('exe.title')}</h1>
        <Card className="space-y-3 text-center" data-testid="no-exec-data"><CardTitle>{t('exe.empty.title')}</CardTitle><p className="text-sm text-slate-500">{t('exe.empty.body')}</p><div><Button onClick={goImport}>{t('exe.goImport')}</Button></div></Card>
        <LinksPanel version={version} onChanged={onChanged} />
      </div>
    );
  }

  const specFor = (k: ExecKpi): DrillSpec => {
    if (k.module === 'finance') return { filter: {}, fin: { side: k.side!, mode: 'position', asOf: k.asOf, ...(k.id === 'f_overdue' ? { bucket: 'overdue' as const } : {}) } };
    if (k.module === 'inventory') return { filter: {}, asOf: k.asOf };
    return { filter: {}, range: k.window ? { from: k.window.from, to: k.window.to } : undefined };
  };
  const openDrill = (k: ExecKpi) => setDrill({ title: kpiLabel(k, (key, p) => translate(lang, key, p)), spec: specFor(k), module: k.module, currency: k.currency, seriesKey: `${k.currency}|${k.basis ?? 'net'}` });
  const open = (r: { module: string; side?: FinanceSide }, ) => { if (r.module !== 'cross') goModule(r.module as ModuleId, r.side); };
  const exportHtml = () => downloadText('executive-report.html', 'text/html', renderManagementSummary(buildExecutiveSummaryDoc(m, lang)));
  const exportCsv = () => downloadText('executive-findings.csv', 'text/csv', renderReportCsv(buildExecutiveReport(m, lang)));
  const title = (r: RankedItem) => renderInsight(r.insight, lang, r.currency ?? 'EUR').title;
  const tt = (k: MessageKey, p?: Record<string, never>) => translate(lang, k, p as never);
  void tt;

  return (
    <div className="space-y-6" data-testid="executive-view">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('exe.title')}</h1>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-400">{t('exe.subtitle')}</p>
          <p className="mt-1 text-xs text-slate-500" data-testid="exec-last-import">{m.lastImportedAt ? t('exe.lastImport', { when: when(m.lastImportedAt) }) : t('exe.lastImport.none')}</p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportHtml} data-testid="exec-export-html">{t('exe.export.html')}</Button>
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid="exec-export-csv">{t('exe.export.csv')}</Button>
          <Button variant="ghost" size="sm" onClick={() => window.print()}>{t('exe.print')}</Button>
        </div>
      </div>
      <p className="rounded-md bg-slate-100 p-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-400" data-testid="exec-nomix">{t('exe.noMix')}</p>

      <section className="space-y-3" data-testid="exec-kpis">
        <h2 className="text-lg font-semibold">{t('exe.sec.kpis')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {m.kpis.map((k) => {
            const ch = changeText(k.metric, lang, k.currency, (key, p) => translate(lang, key, p, k.currency));
            return (
              <Card key={`${k.module}-${k.side ?? ''}-${k.id}`} className="space-y-1" data-testid={`exec-kpi-${k.module}${k.side ? `-${k.side}` : ''}-${k.id}`} data-module={k.module}>
                <div className="flex items-center gap-2"><Badge tone="neutral">{t(`mod.${k.module}` as MessageKey)}{k.side ? ` · ${t(`fin.side.short.${k.side}` as MessageKey)}` : ''}</Badge><span className="text-xs text-slate-500">{k.currency}{k.basis && k.basis !== 'net' ? ` · ${t(`basis.${k.basis}` as MessageKey)}` : ''}</span></div>
                <div className="text-xs font-medium text-slate-500">{kpiLabel(k, (key, p) => translate(lang, key, p)).split(': ').slice(1).join(': ')}</div>
                <div className="text-2xl font-semibold tabular-nums" data-testid="exec-kpi-value">{fmtUnit(k.metric.unit, k.metric.current!, lang, k.currency)}</div>
                <div className="text-xs text-slate-500">{k.asOf ? t('exe.kpi.asOf', { date: { date: k.asOf } }) : k.window ? t('exe.kpi.window', { from: { date: k.window.from }, to: { date: k.window.to } }) : ''}</div>
                {k.metric.previous !== null && <div className="text-xs text-slate-500">{t('exe.kpi.prev', { value: fmtUnit(k.metric.unit, k.metric.previous, lang, k.currency) })} <span className={cn('font-medium', TONE[ch.tone])}>{ch.arrow} {ch.text}</span></div>}
                <div className="flex gap-3 pt-1 text-xs"><button className="text-indigo-700 underline dark:text-indigo-300" onClick={() => openDrill(k)} data-testid="exec-kpi-drill">{t('exe.src.drill')}</button><button className="text-indigo-700 underline dark:text-indigo-300" onClick={() => goModule(k.module, k.side)}>{t('exe.kpi.open', { module: t(`mod.${k.module}` as MessageKey) })}</button></div>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-3" data-testid="exec-insights">
        <h2 className="text-lg font-semibold">{t('exe.sec.insights')} ({m.insights.length})</h2>
        {m.insights.length === 0 && <p className="text-sm text-slate-500">{t('exe.sum.none')}</p>}
        {m.insights.map((r, i) => (
          <SimpleInsight key={r.insight.id} insight={r.insight} currency={r.currency ?? 'EUR'} ctx={{ basis: r.basis }} fileNames={names} testid="exec-insight"
            badges={<><span className="text-sm font-bold text-slate-400">#{i + 1}</span><Badge tone={CLASS_TONE[r.class]} data-testid="exec-class" data-class={r.class} title={t(`exe.class.d.${r.class}` as MessageKey)}>{t(`exe.class.${r.class}` as MessageKey)}</Badge><Badge tone={r.module === 'cross' ? 'warn' : 'neutral'} data-testid="exec-source" data-source={r.module}>{t(`mod.${r.module}` as MessageKey)}{r.side ? ` · ${t(`fin.side.short.${r.side}` as MessageKey)}` : ''}</Badge></>}
            footer={<>
              {r.module !== 'cross' && <Button size="sm" variant="ghost" onClick={() => open(r)} data-testid="exec-open-module">{t('exe.src.open', { module: t(`mod.${r.module}` as MessageKey) })}</Button>}
              <details className="text-xs" data-testid="exec-rank"><summary className="cursor-pointer text-indigo-700 dark:text-indigo-300">{t('exe.rank.title')}: {r.score.toFixed(2)}</summary>
                <ul className="mt-1 grid grid-cols-2 gap-x-4">{(['materiality', 'confidence', 'urgency', 'actionability', 'novelty'] as const).map((p) => <li key={p}>{t(`exe.rank.${p}` as MessageKey)}: <b>{Math.round(r.parts[p] * 100)}%</b></li>)}</ul>
                {r.related.length > 0 && <p className="mt-1">{t('exe.rank.related', { n: r.related.length })}</p>}
                <p className="mt-1 text-slate-500">{t('exe.rank.explain')}</p></details>
            </>} />
        ))}
      </section>

      <TrustFindings results={m.trust} fileNames={names} testid="exec-trust" />
      {m.withheld.length > 0 && (
        <details className="text-sm" data-testid="exec-withheld"><summary className="cursor-pointer text-lg font-semibold">{t('trust.rep.withheld')} ({m.withheld.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-400">{m.withheld.map((w, i) => <li key={i}>{withheldText(w, lang)}</li>)}</ul></details>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {([['risks', m.risks, 'risk'], ['opportunities', m.opportunities, 'opportunity']] as const).map(([k, items, cls]) => (
          <Card key={k} className="space-y-2" data-testid={`exec-${k}`}><CardTitle>{t(`exe.sec.${k}` as MessageKey)}</CardTitle><p className="text-xs text-slate-500">{t(`exe.class.d.${cls}` as MessageKey)}</p>
            {items.length === 0 ? <p className="text-sm text-slate-500">–</p> : <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((r) => <li key={r.insight.id}>{title(r)} <span className="text-xs text-slate-500">({t(`mod.${r.module}` as MessageKey)})</span></li>)}</ul>}
          </Card>
        ))}
        <Card className="space-y-2" data-testid="exec-changes"><CardTitle>{t('exe.sec.changes')}</CardTitle>
          {m.changes.length === 0 ? <p className="text-sm text-slate-500">–</p> : <ul className="space-y-1 text-sm">{m.changes.map((k) => { const ch = changeText(k.metric, lang, k.currency, (key, p) => translate(lang, key, p, k.currency)); return <li key={`${k.module}${k.side}${k.id}`}>{kpiLabel(k, (key, p) => translate(lang, key, p))}: <span className={cn('font-medium', TONE[ch.tone])}>{ch.arrow} {ch.text}</span></li>; })}</ul>}
        </Card>
        {m.scenarios.length > 0 && (
          <Card className="space-y-2" data-testid="exec-scenarios"><CardTitle>{t('exe.sec.scenarios')}</CardTitle><p className="text-xs text-slate-500">{t('exe.class.d.scenario')}</p><ul className="list-disc space-y-1 pl-5 text-sm">{m.scenarios.map((r) => <li key={r.insight.id}>{title(r)}</li>)}</ul></Card>
        )}
      </div>

      <Card className="space-y-2" data-testid="exec-actions"><CardTitle>{t('exe.sec.actions')}</CardTitle>
        {m.actions.length === 0 ? <p className="text-sm text-slate-500">–</p> : <ol className="list-decimal space-y-1 pl-5 text-sm">{m.actions.map((a) => <li key={a.key}>{translate(lang, a.key as MessageKey, a.params)}</li>)}</ol>}
      </Card>

      {m.trends.length > 0 && (
        <section className="space-y-2" data-testid="exec-trends">
          <h2 className="text-lg font-semibold">{t('exe.sec.trends')}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {m.trends.map((tr) => {
              const ttl = t((tr.module === 'finance' ? `exe.trend.finance.${tr.side}` : `exe.trend.${tr.module}`) as MessageKey);
              const compact = (v: number) => new Intl.NumberFormat(lang === 'en' ? 'en-GB' : lang === 'pl' ? 'pl-PL' : 'lt-LT', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
              return (
                <Card key={`${tr.module}-${tr.side ?? ''}`} className="space-y-1" data-testid={`exec-trend-${tr.module}${tr.side ? `-${tr.side}` : ''}`}>
                  <CardTitle className="text-sm">{ttl}</CardTitle><p className="text-xs text-slate-500">{tr.currency}</p>
                  <div className="h-40" role="img" aria-label={ttl}><ResponsiveContainer width="100%" height="100%"><LineChart data={tr.points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}><CartesianGrid stroke="#94a3b855" vertical={false} /><XAxis dataKey="x" tickFormatter={(v) => fmtDate(String(v), lang).slice(0, 5)} fontSize={10} minTickGap={20} /><YAxis tickFormatter={compact} fontSize={10} width={44} /><Tooltip formatter={(v) => new Intl.NumberFormat(lang === 'en' ? 'en-GB' : lang === 'pl' ? 'pl-PL' : 'lt-LT', { style: 'currency', currency: tr.currency }).format(Number(v))} labelFormatter={(l) => fmtDate(String(l), lang)} /><Line type="monotone" dataKey="y" stroke="#4f46e5" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
                  <details className="text-xs"><summary className="cursor-pointer text-indigo-700 dark:text-indigo-300">{t('ch.showTable')}</summary><table className="mt-1 w-full text-left"><tbody>{tr.points.map((p) => <tr key={p.x} className="border-t border-slate-100 dark:border-slate-800"><td className="px-2 py-0.5">{fmtDate(p.x, lang)}</td><td className="px-2 py-0.5 text-right tabular-nums">{fmtUnit('money', p.y, lang, tr.currency)}</td></tr>)}</tbody></table></details>
                </Card>
              );
            })}
          </div>
          <p className="text-xs text-slate-500">{t('exe.trend.note')}</p>
        </section>
      )}

      <section className="space-y-2" data-testid="exec-coverage">
        <h2 className="text-lg font-semibold">{t('exe.sec.coverage')}</h2>
        <Card className="overflow-x-auto p-0"><table className="w-full text-left text-sm"><thead><tr className="text-xs text-slate-500"><th className="px-3 py-2">{t('exe.cov.module')}</th><th className="px-3 py-2">{t('exe.cov.files')}</th><th className="px-3 py-2">{t('exe.cov.lines')}</th><th className="px-3 py-2">{t('exe.cov.period')}</th><th className="px-3 py-2">{t('exe.cov.last')}</th><th className="px-3 py-2">{t('exe.cov.series')}</th><th className="px-3 py-2">{t('exe.cov.flags')}</th></tr></thead>
          <tbody>{m.coverage.map((c: ModuleCoverage) => (
            <tr key={c.module} className="border-t border-slate-100 align-top dark:border-slate-800" data-testid={`cov-${c.module}`} data-present={c.present}>
              <td className="px-3 py-2 font-medium">{t(`mod.${c.module}` as MessageKey)}</td>
              {c.present ? <>
                <td className="px-3 py-2">{c.files}</td><td className="px-3 py-2">{c.lines}</td><td className="px-3 py-2">{fmtDate(c.from!, lang)} – {fmtDate(c.to!, lang)}</td><td className="px-3 py-2">{when(c.lastImportedAt)}</td><td className="px-3 py-2">{c.series}{c.sides ? ` (${c.sides.map((s) => t(`fin.side.short.${s}` as MessageKey)).join(', ')})` : ''}</td>
                <td className="px-3 py-2 text-xs text-amber-800 dark:text-amber-300">{c.flags.map((f) => <div key={f}>{t(`exe.flag.${f}` as MessageKey, { list: c.otherSeries.join(', ') })}</div>)}</td>
              </> : <td className="px-3 py-2 text-slate-500" colSpan={6}>{t('exe.cov.none')}</td>}
            </tr>
          ))}</tbody></table></Card>
      </section>

      <LinksPanel version={version} onChanged={onChanged} />

      <details className="text-sm" data-testid="exec-notes"><summary className="cursor-pointer text-lg font-semibold">{t('exe.sec.notes')}</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-400">{coverageLimitations(m, (k, p) => translate(lang, k, p), lang).slice(1).map((x, i) => <li key={i}>{x}</li>)}</ul>
        {m.suppressed.length === 0 && <p className="text-xs text-slate-500">{t('exe.supp.none')}</p>}
      </details>
      {drill && <DrillDrawer module={drill.module} drill={drill} currency={drill.currency} version={version} seriesKey={drill.seriesKey} importNames={names} onClose={() => setDrill(null)} />}
    </div>
  );
}
