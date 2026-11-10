'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLang } from '../LangProvider';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { SimpleInsight } from '../executive/SimpleInsight';
import { UChartCard } from './UniversalCharts';
import { engine } from '@/lib/engineClient';
import type { UniversalBuildResult, UniversalListItem } from '@/lib/engineSession';
import type { UConfig, UFilter } from '@/engine/universal/types';
import { getDb } from '@/db/db';
import { deleteImport } from '@/db/store';
import { fmtDate, num, type MessageKey } from '@/i18n';

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => <th className={`px-2 py-1 font-medium text-slate-500 ${right ? 'text-right' : ''}`}>{children}</th>;
const Td = ({ children, right }: { children: React.ReactNode; right?: boolean }) => <td className={`px-2 py-1 ${right ? 'text-right tabular-nums' : ''}`}>{children}</td>;

export function UniversalView({ version, goImport, onChanged }: { version: number; goImport: () => void; onChanged: () => void }) {
  const { t, lang } = useLang();
  const [list, setList] = useState<UniversalListItem[] | null>(null);
  const [id, setId] = useState<string>('');
  const [cfg, setCfg] = useState<UConfig>({});
  const [res, setRes] = useState<UniversalBuildResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [fcol, setFcol] = useState<number | ''>('');
  const [fval, setFval] = useState('');

  useEffect(() => {
    let alive = true;
    void engine().call('universalList', []).then((l) => { if (!alive) return; setList(l); setId((cur) => (l.some((x) => x.id === cur) ? cur : (l[0]?.id ?? ''))); });
    return () => { alive = false; };
  }, [version]);

  useEffect(() => {
    if (!id) { setRes(null); return; }
    let alive = true;
    setBusy(true);
    void engine().call('universalBuild', [{ id, cfg }]).then((r) => { if (alive) { setRes(r); setBusy(false); } }).catch(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [id, cfg, version]);

  const n = (v: number) => num(v, lang);
  const pctText = (v: number) => new Intl.NumberFormat(lang === 'en' ? 'en-GB' : lang === 'pl' ? 'pl-PL' : 'lt-LT', { style: 'percent', maximumFractionDigits: 1 }).format(v);
  const cols = res?.dataset.columns ?? [];
  const head = (i: number) => cols[i]?.header ?? String(i);
  const filters = cfg.filters ?? [];
  const addFilter = () => {
    if (fcol === '' || !fval) return;
    const cur = filters.find((f) => f.col === fcol);
    const next: UFilter[] = cur ? filters.map((f) => (f.col === fcol ? { ...f, values: [...new Set([...(f.values ?? []), fval])] } : f)) : [...filters, { col: fcol, values: [fval] }];
    setCfg({ ...cfg, filters: next }); setFval('');
  };
  const removeFilter = (col: number, v: string) => setCfg({ ...cfg, filters: filters.map((f) => (f.col === col ? { ...f, values: f.values?.filter((x) => x !== v) } : f)).filter((f) => f.values?.length) });
  const remove = useCallback(async () => { if (!id) return; await deleteImport(getDb(), id); setCfg({}); onChanged(); }, [id, onChanged]);
  const filterable = useMemo(() => Object.keys(res?.options ?? {}).map(Number), [res]);

  if (list && list.length === 0) {
    return (
      <Card className="space-y-3 text-center" data-testid="no-universal-data">
        <CardTitle>{t('uni.noData')}</CardTitle><p className="text-sm text-slate-500">{t('uni.noData.hint')}</p>
        <div><Button onClick={goImport}>{t('uni.goImport')}</Button></div>
      </Card>
    );
  }
  if (!res || !list) return <p className="text-sm text-slate-500" data-testid="computing">{t('dash.computing')}</p>;
  const a = res.analysis;
  const dateCols = cols.filter((c) => c.type === 'date' || c.type === 'datetime');
  const range = a.scope.from && a.scope.to ? ` · ${t('uni.scope.range', { from: { date: a.scope.from }, to: { date: a.scope.to } })}` : '';

  return (
    <div className="space-y-6" data-testid="universal-view" aria-busy={busy}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('uni.title')}</h1>
          <p className="text-sm text-slate-500" data-testid="u-scope">{t('uni.scope', { rows: a.scope.rows, total: a.scope.totalRows })}{range}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {list.length > 1 && <select aria-label={t('uni.pick')} data-testid="u-dataset-select" value={id} onChange={(e) => { setId(e.target.value); setCfg({}); }} className="rounded-md border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900">{list.map((l) => <option key={l.id} value={l.id}>{l.fileName}</option>)}</select>}
          <Button variant="ghost" size="sm" onClick={() => void remove()} data-testid="u-delete">{t('uni.delete')}</Button>
        </div>
      </div>
      <Card className="space-y-3" data-testid="u-controls">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">{t('uni.dateCol')}<br />
            <select data-testid="u-date-col" value={cfg.dateCol ?? a.config.dateCol ?? ''} onChange={(e) => setCfg({ ...cfg, dateCol: e.target.value === '' ? undefined : Number(e.target.value), range: undefined })} className="mt-1 rounded-md border border-slate-300 bg-transparent px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
              {dateCols.length === 0 && <option value="">{t('uni.dateCol.none')}</option>}
              {dateCols.map((c) => <option key={c.index} value={c.index}>{c.header}</option>)}
            </select>
          </label>
          {a.config.dateCol !== undefined && (
            <>
              <label className="text-sm">{t('uni.range.from')}<br /><input type="date" data-testid="u-range-from" value={cfg.range?.from ?? ''} onChange={(e) => setCfg({ ...cfg, range: { ...cfg.range, from: e.target.value || undefined } })} className="mt-1 rounded-md border border-slate-300 bg-transparent px-2 py-1 dark:border-slate-700" /></label>
              <label className="text-sm">{t('uni.range.to')}<br /><input type="date" data-testid="u-range-to" value={cfg.range?.to ?? ''} onChange={(e) => setCfg({ ...cfg, range: { ...cfg.range, to: e.target.value || undefined } })} className="mt-1 rounded-md border border-slate-300 bg-transparent px-2 py-1 dark:border-slate-700" /></label>
            </>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">{t('uni.filter.col')}<br />
              <select data-testid="u-filter-col" value={fcol} onChange={(e) => { setFcol(e.target.value === '' ? '' : Number(e.target.value)); setFval(''); }} className="mt-1 rounded-md border border-slate-300 bg-transparent px-2 py-1 dark:border-slate-700 dark:bg-slate-900"><option value="" />{filterable.map((c) => <option key={c} value={c}>{head(c)}</option>)}</select>
            </label>
            <label className="text-sm">{t('uni.filter.values')}<br />
              <select data-testid="u-filter-val" value={fval} onChange={(e) => setFval(e.target.value)} disabled={fcol === ''} className="mt-1 max-w-48 rounded-md border border-slate-300 bg-transparent px-2 py-1 dark:border-slate-700 dark:bg-slate-900"><option value="" />{(fcol === '' ? [] : res.options[fcol] ?? []).map((o) => <option key={o.value} value={o.value}>{o.value} ({o.count})</option>)}</select>
            </label>
            <Button size="sm" variant="outline" onClick={addFilter} disabled={fcol === '' || !fval} data-testid="u-filter-add">{t('uni.filter.add')}</Button>
          </div>
        </div>
        {filters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" data-testid="u-filter-chips">
            {filters.flatMap((f) => (f.values ?? []).map((v) => <button key={`${f.col}-${v}`} onClick={() => removeFilter(f.col, v)} className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200" aria-label={`${head(f.col)} = ${v} ×`}>{head(f.col)} = {v} ×</button>))}
            <Button size="sm" variant="ghost" onClick={() => setCfg({ ...cfg, filters: [] })}>{t('uni.filter.clear')}</Button>
          </div>
        )}
        {a.config.measures.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="u-aggs"><span className="text-slate-500">{t('uni.agg')}:</span>
            {a.config.measures.map((m) => (
              <label key={m} className="flex items-center gap-1">{head(m)}
                <select data-testid={`u-agg-${m}`} value={a.config.agg[m]} onChange={(e) => setCfg({ ...cfg, agg: { ...cfg.agg, [m]: e.target.value as 'sum' | 'mean' } })} className="rounded-md border border-slate-300 bg-transparent px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900"><option value="sum">{t('uni.agg.sum')}</option><option value="mean">{t('uni.agg.mean')}</option></select>
              </label>
            ))}
          </div>
        )}
      </Card>

      <section className="space-y-2" data-testid="u-overview">
        <h2 className="text-lg font-semibold">{t('uni.sec.overview')}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([['uni.ov.rows', n(a.overview.rows), 'rows'], ['uni.ov.cols', n(a.overview.columns), 'cols'], ['uni.ov.missing', `${n(a.overview.missingCells)} (${pctText(a.overview.missingShare)})`, 'missing'], ['uni.ov.dups', n(a.overview.duplicateRows), 'dups']] as const).map(([k, v, tid]) => (
            <Card key={k}><div className="text-xs text-slate-500">{t(k as MessageKey)}</div><div className="text-xl font-semibold tabular-nums" data-testid={`u-ov-${tid}`}>{v}</div></Card>
          ))}
        </div>
        <p className="text-xs text-slate-500">{t('uni.ov.types')}: {Object.entries(a.overview.types).map(([k, v]) => `${t(`utype.${k}` as MessageKey)} ${v}`).join(' · ')}</p>
      </section>

      {res.insights.length > 0 && (
        <section className="space-y-3" data-testid="u-insights">
          <h2 className="text-lg font-semibold">{t('uni.sec.insights')}</h2>
          {res.insights.map((i) => <SimpleInsight key={i.id} insight={i} currency="EUR" testid="u-insight" />)}
        </section>
      )}

      <section className="space-y-3" data-testid="u-charts">
        <h2 className="text-lg font-semibold">{t('uni.sec.charts')}</h2>
        <div className="grid gap-4 lg:grid-cols-2">{res.charts.map((c) => <UChartCard key={c.id} chart={c} />)}</div>
        {res.skipped.length > 0 && (
          <details className="text-sm text-slate-500"><summary className="cursor-pointer">{t('uni.sec.skipped')} ({res.skipped.length})</summary>
            <ul className="mt-1 list-disc pl-5" data-testid="u-skipped">{res.skipped.map((s, i) => <li key={i}>{t(`uch.q.${s.question}` as MessageKey)}: {t(`uch.skip.${s.reason}` as MessageKey)}</li>)}</ul>
          </details>
        )}
      </section>

      <section className="space-y-2" data-testid="u-compare">
        <h2 className="text-lg font-semibold">{t('uni.sec.compare')}</h2>
        {a.compare.length === 0 ? <p className="text-sm text-slate-500">{a.compareBlocked ? t(`uni.cmp.blocked.${a.compareBlocked}` as MessageKey) : '–'}</p> : (
          <Card className="overflow-x-auto p-0"><table className="w-full text-left text-sm"><thead><tr><Th>{t('uni.col.header')}</Th><Th right>{t('uni.cmp.cur', { from: { date: a.compare[0]!.current.from }, to: { date: a.compare[0]!.current.to } })}</Th><Th right>{t('uni.cmp.prev', { from: { date: a.compare[0]!.previous.from }, to: { date: a.compare[0]!.previous.to } })}</Th><Th right>{t('uni.cmp.change')}</Th></tr></thead>
            <tbody>{a.compare.map((c) => <tr key={c.col} className="border-t border-slate-100 dark:border-slate-800" data-testid="u-compare-row"><Td>{c.header} ({t(`uch.agg.${c.agg}` as MessageKey)})</Td><Td right>{c.current.value === null ? '–' : n(c.current.value)}</Td><Td right>{c.previous.value === null ? '–' : n(c.previous.value)}</Td><Td right>{c.change === null ? '–' : `${c.change >= 0 ? '+' : ''}${n(c.change)}${c.pct !== null ? ` (${c.pct >= 0 ? '+' : ''}${pctText(c.pct)})` : ''}`}</Td></tr>)}</tbody></table></Card>
        )}
        <p className="text-xs text-slate-500">{t('uni.cmp.note')}</p>
      </section>

      <section className="space-y-2" data-testid="u-ranks">
        <h2 className="text-lg font-semibold">{t('uni.sec.ranks')}</h2>
        {a.ranks.length === 0 && <p className="text-sm text-slate-500">–</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          {a.ranks.slice(0, 4).map((r) => (
            <Card key={`${r.dim}-${r.measure}`} className="space-y-1 overflow-x-auto"><CardTitle className="text-sm">{t('uni.rank.pair', { measure: r.measureHeader, dim: r.dimHeader, agg: t(`uch.agg.${r.agg}` as MessageKey), groups: r.groups })}</CardTitle>
              <table className="w-full text-left text-sm"><thead><tr><Th>{t('uni.rank.group')}</Th><Th right>{t('uni.rank.value')}</Th><Th right>{t('uni.rank.rows')}</Th><Th right>{t('uni.rank.share')}</Th></tr></thead>
                <tbody>{r.top.slice(0, 5).map((x) => <tr key={x.key} className="border-t border-slate-100 dark:border-slate-800"><Td>{x.key}</Td><Td right>{n(x.value)}</Td><Td right>{x.rows}</Td><Td right>{x.share === null ? '–' : pctText(x.share)}</Td></tr>)}</tbody></table>
            </Card>
          ))}
        </div>
      </section>

      <details className="space-y-2" data-testid="u-details" open>
        <summary className="cursor-pointer text-lg font-semibold">{t('uni.sec.stats')}</summary>
        <Card className="overflow-x-auto p-0"><table className="w-full text-left text-xs" data-testid="u-stats"><thead><tr><Th>{t('uni.col.header')}</Th><Th>{t('uni.st.type')}</Th><Th right>{t('uni.st.n')}</Th><Th right>{t('uni.st.missing')}</Th><Th right>{t('uni.st.min')}</Th><Th right>{t('uni.st.median')}</Th><Th right>{t('uni.st.mean')}</Th><Th right>{t('uni.st.max')}</Th><Th right>{t('uni.st.sum')}</Th></tr></thead>
          <tbody>{a.stats.map((s) => <tr key={s.col} className="border-t border-slate-100 dark:border-slate-800"><Td>{s.header}</Td><Td>{t(`utype.${s.type}` as MessageKey)}</Td><Td right>{s.n}</Td><Td right>{s.missing}</Td>
            <Td right>{s.desc ? n(s.desc.min) : s.min ? fmtDate(s.min, lang) : ''}</Td><Td right>{s.desc ? n(s.desc.median) : s.top ? s.top.map((x) => `${x.value} (${x.count})`).slice(0, 2).join(', ') : ''}</Td><Td right>{s.desc ? n(s.desc.mean) : s.trueShare !== undefined ? pctText(s.trueShare) : ''}</Td><Td right>{s.desc ? n(s.desc.max) : s.max ? fmtDate(s.max, lang) : ''}</Td><Td right>{s.desc && s.type !== 'percent' ? n(s.desc.sum) : ''}</Td></tr>)}</tbody></table></Card>
      </details>

      <section className="space-y-2" data-testid="u-missing">
        <h2 className="text-lg font-semibold">{t('uni.sec.missing')}</h2>
        {a.missing.length === 0 ? <p className="text-sm text-slate-500">{t('uni.miss.none')}</p> : (
          <Card className="overflow-x-auto p-0"><table className="w-full text-left text-sm"><thead><tr><Th>{t('uni.miss.col')}</Th><Th right>{t('uni.miss.count')}</Th><Th right>{t('uni.miss.share')}</Th><Th right>{t('uni.miss.invalid')}</Th><Th right>{t('uni.miss.shift')}</Th></tr></thead>
            <tbody>{a.missing.map((m) => <tr key={m.col} className="border-t border-slate-100 dark:border-slate-800"><Td>{m.header}</Td><Td right>{m.missing}</Td><Td right>{pctText(m.share)}</Td><Td right>{m.invalid}</Td><Td right>{m.firstHalf !== undefined ? <span className={m.shifts ? 'font-semibold text-amber-700' : ''}>{pctText(m.firstHalf)} → {pctText(m.secondHalf!)}</span> : ''}</Td></tr>)}</tbody></table></Card>
        )}
      </section>

      <section className="space-y-2" data-testid="u-outliers">
        <h2 className="text-lg font-semibold">{t('uni.sec.outliers')}</h2>
        {a.outliers.length === 0 ? <p className="text-sm text-slate-500">–</p> : (
          <Card className="overflow-x-auto p-0"><table className="w-full text-left text-sm"><thead><tr><Th>{t('uni.out.col')}</Th><Th right>{t('uni.out.count')}</Th><Th right>{t('uni.out.fence')}</Th><Th>{t('uni.out.rows')}</Th></tr></thead>
            <tbody>{a.outliers.map((o) => <tr key={o.col} className="border-t border-slate-100 dark:border-slate-800"><Td>{o.header}</Td><Td right>{o.low + o.high} ({pctText(o.share)})</Td><Td right>{n(o.lowFence)} – {n(o.highFence)}</Td><Td>{o.examples.map((e) => `#${e.row}: ${n(e.value)}`).join(' · ')}</Td></tr>)}</tbody></table></Card>
        )}
        <p className="text-xs text-slate-500">{t('uni.out.note')}</p>
      </section>

      <section className="space-y-2" data-testid="u-duplicates">
        <h2 className="text-lg font-semibold">{t('uni.sec.duplicates')}</h2>
        {a.duplicates.exactRows === 0 && a.duplicates.idColumns.length === 0 ? <p className="text-sm text-slate-500">{t('uni.dup.none')}</p> : (
          <Card className="space-y-1 text-sm">
            {a.duplicates.groups.length > 0 && <ul className="list-disc pl-5">{a.duplicates.groups.map((g, i) => <li key={i}>{t('uni.dup.rows')}: {g.rows.map((r) => `#${r}`).join(', ')}</li>)}</ul>}
            {a.duplicates.idColumns.map((c) => <p key={c.col}>{t('uni.dup.id', { header: c.header, n: c.duplicated, c: c.conflicting })}</p>)}
          </Card>
        )}
        <p className="text-xs text-slate-500">{t('uni.dup.note')}</p>
      </section>

      <section className="space-y-2" data-testid="u-correlations">
        <h2 className="text-lg font-semibold">{t('uni.sec.correlations')}</h2>
        {a.correlations.filter((c) => c.meaningful || c.redundant).length === 0 ? <p className="text-sm text-slate-500">{t('uni.corr.none')}</p> : (
          <Card className="overflow-x-auto p-0"><table className="w-full text-left text-sm"><thead><tr><Th>{t('uni.corr.a')}</Th><Th>{t('uni.corr.b')}</Th><Th right>Spearman ρ</Th><Th right>Pearson r</Th><Th right>{t('uni.corr.n')}</Th><Th>{' '}</Th></tr></thead>
            <tbody>{a.correlations.filter((c) => c.meaningful || c.redundant).map((c) => <tr key={`${c.a}-${c.b}`} className="border-t border-slate-100 dark:border-slate-800"><Td>{c.aHeader}</Td><Td>{c.bHeader}</Td><Td right>{c.spearman.toFixed(2)}</Td><Td right>{c.pearson.toFixed(2)}</Td><Td right>{c.n}</Td><Td>{c.redundant ? t('uni.corr.redundant') : c.outlierSensitive ? t('uni.corr.sensitive') : ''}</Td></tr>)}</tbody></table></Card>
        )}
        <p className="text-xs text-slate-500">{t('uni.corr.note')}</p>
      </section>
    </div>
  );
}
