'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLang } from './LangProvider';
import { Button } from './ui/button';
import { Card, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import type { ImportRow } from '@/db/db';
import { engine, EngineError } from '@/lib/engineClient';
import type { AnalysisLite, ParseResult, PreviewResult } from '@/lib/engineSession';
import { isMappingConfirmable, LOW_CONFIDENCE, validateMapping } from '@/engine/mapping/mapper';
import { financeKindFromFields, SNAPSHOT_DATASETS } from '@/engine/finance/kind';
import { SALES_TEMPLATES } from '@/engine/mapping/templates';
import { renderDiagnosticsText } from '@/engine/import/diagnostics';
import type { ImportPolicy } from '@/engine/import/merge';
import { FINANCE_FIELDS, INVENTORY_FIELDS, PURCHASE_FIELDS, SALES_FIELDS, type ExportMode, type FieldId, type FinanceSide, type ImportStats, type MappingEntry, type ModuleId } from '@/engine/types';
import { downloadText } from '@/lib/download';
import { fmtDate, pct, type MessageKey } from '@/i18n';
import type { DateOrder } from '@/engine/schema/dates';
import type { TrustItem } from '@/engine/trust/importTrust';
import { cn } from '@/lib/cn';

const CURRENCIES = ['EUR', 'PLN', 'USD', 'GBP', 'CZK', 'SEK'];
const MAX_BYTES = 50 * 1024 * 1024;
const MODES: ExportMode[] = ['full', 'incremental', 'partial', 'unknown'];

type OkPreview = Extract<PreviewResult, { ok: true }>;

export function ImportFlow({ onImported, goInsights, goReview }: { onImported: () => void; goInsights: (m: ModuleId, side?: FinanceSide) => void; goReview: () => void }) {
  const { t, lang } = useLang();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisLite | null>(null);
  const [module, setModule] = useState<ModuleId>('sales');
  const [asOf, setAsOf] = useState('');
  const [dateOrders, setDateOrders] = useState<Record<number, DateOrder>>({});
  const [side, setSide] = useState<FinanceSide>('receivable');
  const [assign, setAssign] = useState<Record<number, FieldId | ''>>({});
  const [confs, setConfs] = useState<Record<number, number>>({});
  const [sources, setSources] = useState<Record<number, MappingEntry['source']>>({});
  const [currency, setCurrency] = useState('EUR');
  const [mode, setMode] = useState<ExportMode>('unknown');
  const [policy, setPolicy] = useState<ImportPolicy | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [remember, setRemember] = useState(true);
  const [dupAccepted, setDupAccepted] = useState(false);
  const [pv, setPv] = useState<OkPreview | null>(null);
  const [pvBusy, setPvBusy] = useState(false);
  const [result, setResult] = useState<{ row: ImportRow; stats: ImportStats; module: ModuleId; side: FinanceSide } | null>(null);
  const [dragging, setDragging] = useState(false);
  const seq = useRef(0);

  const errText = useCallback((e: unknown) => {
    const code = e instanceof EngineError ? e.code : 'unknown';
    if (code === 'worker') return t('err.worker');
    const key = `err.${code}` as MessageKey;
    return t(['file_too_large', 'unsupported_format', 'legacy_xls', 'corrupt_file', 'empty_file', 'password_protected', 'zip_limits', 'unsafe_archive', 'timeout', 'sheet_limits'].includes(code) ? key : 'err.unknown');
  }, [t]);

  const reset = useCallback(() => {
    void engine().call('discard', []);
    setParsed(null); setAnalysis(null); setAssign({}); setConfs({}); setSources({}); setError(null); setDupAccepted(false); setResult(null); setSheetIdx(0);
    setPv(null); setPolicy(null); setConfirmChecked(false); setMode('unknown'); setModule('sales'); setAsOf(''); setSide('receivable'); setDateOrders({});
    if (input.current) input.current.value = '';
  }, []);

  const analyse = useCallback(async (idx: number, requested: ModuleId = 'sales', auto = false) => {
    let a = await engine().call('analyze', [idx, lang === 'en' ? '.' : ',', requested]);
    let mod = requested;
    // the headers clearly describe purchases: start in the purchasing module (the user can switch back)
    if (auto && a && a.detected.module !== 'sales' && requested === 'sales') {
      mod = a.detected.module;
      a = await engine().call('analyze', [idx, lang === 'en' ? '.' : ',', mod]);
    }
    setModule(mod);
    if (a?.detected.side) setSide(a.detected.side);
    setAnalysis(a);
    setPv(null);
    if (a) {
      const asg: Record<number, FieldId | ''> = {};
      const cf: Record<number, number> = {};
      const src: Record<number, MappingEntry['source']> = {};
      a.profiles.forEach((p) => (asg[p.index] = ''));
      for (const e of a.proposal.entries) { asg[e.columnIndex] = e.field; cf[e.columnIndex] = e.confidence; src[e.columnIndex] = e.source; }
      setAssign(asg); setConfs(cf); setSources(src);
      setCurrency(a.savedCurrency ?? a.proposal.detectedCurrency ?? (lang === 'pl' ? 'PLN' : 'EUR'));
    }
  }, [lang]);

  const handleFile = useCallback(async (file: File) => {
    reset();
    setBusy(true);
    try {
      if (file.size > MAX_BYTES) throw new EngineError('file_too_large');
      const buf = await file.arrayBuffer();
      const p = await engine().call('parse', [buf, file.name], [buf]);
      setParsed(p);
      const idx = Math.max(0, p.sheets.findIndex((s) => s.hasTable));
      setSheetIdx(idx);
      await analyse(idx, 'sales', true);
    } catch (e) {
      setError(errText(e));
      setParsed(null);
    } finally {
      setBusy(false);
    }
  }, [analyse, errText, reset]);

  const setField = (col: number, field: FieldId | '') => {
    setAssign((prev) => {
      const next = { ...prev };
      if (field) for (const k of Object.keys(next)) if (next[Number(k)] === field) next[Number(k)] = '';
      next[col] = field;
      return next;
    });
    setConfs((c) => ({ ...c, [col]: 1 }));
    setSources((s) => ({ ...s, [col]: 'user' }));
    setPolicy(null);
    setConfirmChecked(false);
  };

  const entries = Object.entries(assign).filter(([, f]) => f).map(([c, f]) => ({ field: f as FieldId, columnIndex: Number(c), confidence: confs[Number(c)] ?? 1, source: sources[Number(c)] ?? ('user' as const) }));
  const finKind = module === 'finance' ? financeKindFromFields(entries.map((e) => e.field)) : null;
  // inventory needs a date; finance ledger reports (open items / aging / balance) are "as of" a date – the file's column or the date the user states
  const needsAsOf = (module === 'inventory' && !entries.some((e) => e.field === 'snapshot_date' || e.field === 'movement_date')) || (finKind !== null && SNAPSHOT_DATASETS.includes(finKind) && !entries.some((e) => e.field === 'snapshot_date'));
  const warnings = validateMapping(entries, module, { hasDefaultDate: needsAsOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) });
  const hasCurrencyCol = entries.some((e) => e.field === 'currency');

  // Dry run in the worker: normalisation + merge plan + diagnostics. Writes nothing.
  const entriesKey = JSON.stringify(entries.map((e) => [e.field, e.columnIndex]));
  useEffect(() => {
    if (!analysis || !isMappingConfirmable(warnings) || (!hasCurrencyCol && !currency)) { setPv(null); return; }
    const my = ++seq.current;
    setPvBusy(true);
    const timer = setTimeout(() => {
      engine().call('preview', [{ module, side, asOfDate: needsAsOf ? asOf : undefined, sheetIdx, entries, currency: hasCurrencyCol ? undefined : currency, mode, policy: policy ?? undefined, dateOrders }])
        .then((r) => { if (seq.current === my) setPv(r.ok ? r : null); })
        .catch((e: unknown) => { if (seq.current === my) { setPv(null); setError(errText(e)); } })
        .finally(() => { if (seq.current === my) setPvBusy(false); });
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, entriesKey, currency, mode, policy, module, asOf, side, dateOrders]);

  const needs = pv?.preview.needsConfirmation ?? [];
  const confirmable = Boolean(pv) && isMappingConfirmable(warnings) && (hasCurrencyCol || Boolean(currency)) && (!parsed?.duplicateOf || dupAccepted) && (needs.length === 0 || confirmChecked) && !pvBusy;

  const confirm = async () => {
    if (!parsed || !pv) return;
    setBusy(true);
    setError(null);
    try {
      const r = await engine().call('commit', [{ module, side, asOfDate: needsAsOf ? asOf : undefined, sheetIdx, entries, currency: hasCurrencyCol ? undefined : currency, mode, policy: pv.preview.policy, confirmed: confirmChecked, allowSameChecksum: dupAccepted, remember, dateOrders }]);
      if (r.status === 'ok') {
        setResult({ row: r.import, stats: r.stats, module, side });
        onImported();
      } else if (r.status === 'needs_confirmation') {
        setError(t('cf.needed'));
      } else if (r.status === 'duplicate_file') {
        setError(t('import.dupFile', { date: fmtDate(new Date(r.existing.importedAt).toISOString().slice(0, 10), lang) }));
      } else {
        setError(t(r.error === 'currency_required' ? 'err.currency_required' : r.error === 'missing_date' ? 'import.needDate' : 'import.needAmount'));
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const setPol = (patch: Partial<ImportPolicy>) => { setPolicy({ ...(pv?.preview.policy ?? { conflicts: 'hold', content: 'dedupe_exact' }), ...patch }); setConfirmChecked(false); };

  // ───────── result ─────────
  if (result) {
    const { row, stats } = result;
    const issueEntries = [...Object.entries(stats.errors), ...Object.entries(stats.warnings)] as [string, number][];
    return (
      <Card data-testid="import-result" className="space-y-4">
        <CardTitle className="text-lg">✅ {t('import.result.title')}</CardTitle>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label={t('import.result.read')} value={stats.rowsRead} />
          <Stat label={t('import.result.added')} value={row.added} testid="stat-added" />
          <Stat label={t('import.result.duplicates')} value={row.duplicates} testid="stat-dups" />
          <Stat label={t('import.result.skipped')} value={stats.rowsSkipped} />
          {(row.heldLines ?? 0) > 0 && <Stat label={t('import.result.held')} value={row.heldLines!} testid="stat-held" />}
          {row.revisedDocs > 0 && <Stat label={t('import.result.revised')} value={row.revisedDocs} testid="stat-revised" />}
          {(row.removedDocs ?? 0) > 0 && <Stat label={t('import.result.removed')} value={row.removedDocs!} />}
          {row.staleLines > 0 && <Stat label={t('import.result.stale')} value={row.staleLines} />}
          <Stat label={t('import.result.identity')} value={t(`identity.${row.identity}` as MessageKey)} />
          {stats.dateMin && stats.dateMax && <Stat label={t('import.result.period')} value={`${fmtDate(stats.dateMin, lang)} – ${fmtDate(stats.dateMax, lang)}`} />}
        </dl>
        {(row.heldLines ?? 0) > 0 && <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="held-notice">⚠ {t('mp.heldNote')}</p>}
        {issueEntries.length > 0 && (
          <div>
            <div className="mb-1 text-sm font-medium">{t('import.issues')}</div>
            <ul className="flex flex-wrap gap-2">{issueEntries.map(([code, n]) => <li key={code}><Badge tone={code in stats.errors ? 'risk' : 'warn'}>{t(`issue.${code}` as MessageKey)}: {n}</Badge></li>)}</ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => goInsights(result.module, result.side)} data-testid="view-insights">{t('import.viewInsights')}</Button>
          {(row.heldLines ?? 0) > 0 && <Button variant="outline" onClick={goReview} data-testid="review-conflicts">{t('import.result.reviewNow')}</Button>}
          <Button variant="outline" onClick={reset}>{t('import.choose')}</Button>
        </div>
      </Card>
    );
  }

  // ───────── upload ─────────
  if (!parsed) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{t('import.title')}</h1>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void handleFile(f); }}
          className={cn('flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-10 text-center', dragging ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30' : 'border-slate-300 dark:border-slate-700')}
        >
          <p className="text-lg">{busy ? t('import.parsing') : t('import.drop')}</p>
          <Button onClick={() => input.current?.click()} disabled={busy}>{t('import.choose')}</Button>
          <input ref={input} data-testid="file-input" type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
          <p className="max-w-xl text-xs text-slate-500">{t('import.formats')}</p>
        </div>
        {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
      </div>
    );
  }

  // ───────── diagnostics + mapping + preview ─────────
  const tpl = module === 'sales' && analysis?.proposal.templateId ? SALES_TEMPLATES.find((x) => x.id === analysis.proposal.templateId) : undefined;
  const p = pv?.preview;
  const d = pv?.diagnostics;
  const showConflicts = Boolean(p && (p.revisedDocs + p.heldDocs + p.additionsDocs + p.removedDocs + p.omittedDocs > 0 || (p.proposedPolicy.conflicts === 'replace' && p.identity === 'document' && p.absentDocs + p.duplicates > 0)));
  const showContent = Boolean(p && p.identity !== 'document' && p.overlapRisk);
  const downloadDiag = () => d && downloadText('import-diagnostics.txt', 'text/plain', renderDiagnosticsText(d, { app: t('app.name'), generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') }));

  return (
    <div className="space-y-5" data-testid="import-diagnostics">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('diag.title')}</h1>
        <Button variant="ghost" size="sm" onClick={reset}>{t('import.cancel')}</Button>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">📄 {parsed.fileName}</p>
      {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}

      {parsed.duplicateOf && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40" data-testid="dup-file">
          <p className="text-sm">{t('import.dupFile', { date: fmtDate(new Date(parsed.duplicateOf.importedAt).toISOString().slice(0, 10), lang) })}</p>
          {!dupAccepted && <Button className="mt-2" size="sm" variant="outline" onClick={() => setDupAccepted(true)} data-testid="import-anyway">{t('import.importAnyway')}</Button>}
        </Card>
      )}

      {parsed.sheets.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          {t('import.sheet')}
          <select className="rounded-md border border-slate-300 bg-transparent px-2 py-1 dark:border-slate-700 dark:bg-slate-900" value={sheetIdx} data-testid="sheet-select"
            onChange={async (e) => { const i = Number(e.target.value); setSheetIdx(i); setBusy(true); try { await analyse(i, module); } catch (er) { setError(errText(er)); } finally { setBusy(false); } }}>
            {parsed.sheets.map((s, i) => <option key={i} value={i}>{s.name}{s.hasTable ? '' : ' ∅'}</option>)}
          </select>
        </label>
      )}

      {!analysis ? (
        <p className="rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950/40">{t('import.noTable')}</p>
      ) : (
        <>
          <Card className="space-y-2" data-testid="module-card">
            <CardTitle>{t('mod.label')}</CardTitle>
            <div role="group" aria-label={t('mod.select')} className="flex overflow-hidden rounded-md border border-slate-300 text-sm dark:border-slate-700 sm:w-fit">
              {(['sales', 'purchasing', 'inventory', 'finance'] as ModuleId[]).map((m) => (
                <button key={m} type="button" data-testid={`module-${m}`} aria-pressed={module === m} disabled={busy}
                  onClick={async () => { if (m === module) return; setBusy(true); setPv(null); try { await analyse(sheetIdx, m); } catch (er) { setError(errText(er)); } finally { setBusy(false); } }}
                  className={cn('px-4 py-1.5 font-medium', module === m ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}>{t(`mod.${m}` as MessageKey)}</button>
              ))}
            </div>
            {analysis.detected.module !== module && Math.max(analysis.detected.purchasing, analysis.detected.sales, analysis.detected.inventory, analysis.detected.finance) > 0 && <p className="text-xs text-amber-800 dark:text-amber-300" data-testid="module-hint">{t('mod.detected', { module: t(`mod.${analysis.detected.module}` as MessageKey) })}</p>}
          </Card>

          {module === 'finance' && (
            <Card className="space-y-2" data-testid="side-card">
              <CardTitle>{t('fin.side.label')}</CardTitle>
              <div role="group" aria-label={t('fin.side.label')} className="flex overflow-hidden rounded-md border border-slate-300 text-sm dark:border-slate-700 sm:w-fit">
                {(['receivable', 'payable'] as FinanceSide[]).map((x) => (
                  <button key={x} type="button" data-testid={`side-${x}`} aria-pressed={side === x} onClick={() => { setSide(x); setPolicy(null); setConfirmChecked(false); }} className={cn('px-4 py-1.5 font-medium', side === x ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}>{t(`fin.side.${x}` as MessageKey)}</button>
                ))}
              </div>
              {analysis.detected.side && analysis.detected.side !== side && <p className="text-xs text-amber-800 dark:text-amber-300" data-testid="side-hint">{t('fin.side.hint', { side: t(`fin.side.short.${analysis.detected.side}` as MessageKey) })}</p>}
            </Card>
          )}

          <Card className="space-y-2" data-testid="diag-structure">
            <CardTitle>{t('diag.structure')}</CardTitle>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge>{t('diag.kind')}: {analysis.structure.kind}</Badge>
              {analysis.structure.encoding && <Badge>{t('diag.encoding')}: {analysis.structure.encoding}</Badge>}
              {analysis.structure.delimiter && <Badge>{t('diag.delimiter')}: {analysis.structure.delimiter === '\t' ? 'TAB' : analysis.structure.delimiter}</Badge>}
              <Badge>{t('diag.sheet')}: {analysis.structure.sheet} ({analysis.structure.sheets})</Badge>
              <Badge>{t('diag.size', { rows: analysis.structure.rows, cols: analysis.structure.columns })}</Badge>
              <Badge tone={analysis.headerConfidence >= 0.6 ? 'opportunity' : 'warn'}>{t('diag.headerRow', { row: analysis.structure.headerRow, pct: pct(analysis.headerConfidence, lang) })}</Badge>
              {analysis.skippedTotalRows > 0 && <Badge>{t('import.totalSkipped', { n: analysis.skippedTotalRows })}</Badge>}
              {analysis.truncated && <Badge tone="warn">{t('diag.truncated')}</Badge>}
              {tpl && <Badge tone="info">{t('import.template', { name: tpl.name })}</Badge>}
              {analysis.usedSaved && <Badge tone="info">{t('import.saved')}</Badge>}
            </div>
          </Card>

          <h2 className="text-lg font-semibold">{t('diag.columns')}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">{t('import.mappingHelp')}</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-sm" data-testid="mapping-table">
              <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900">
                <tr><th className="px-3 py-2">{t('import.column')}</th><th className="px-3 py-2">{t('import.sample')}</th><th className="px-3 py-2">{t('import.type')}</th><th className="px-3 py-2">{t('import.meaning')}</th><th className="px-3 py-2">{t('import.confidence')}</th></tr>
              </thead>
              <tbody>
                {analysis.profiles.map((col) => {
                  const f = assign[col.index] ?? '';
                  const c = confs[col.index];
                  return (
                    <tr key={col.index} className="border-t border-slate-200 dark:border-slate-800">
                      <td className="px-3 py-2 font-medium">{col.header}</td>
                      <td className="max-w-[16rem] truncate px-3 py-2 text-slate-500">{(analysis.samples[col.index] ?? []).join(' · ')}</td>
                      <td className="px-3 py-2"><Badge>{t(`type.${col.type}` as MessageKey)}</Badge></td>
                      <td className="px-3 py-2">
                        <select aria-label={col.header} data-testid={`map-${col.index}`} value={f} onChange={(e) => setField(col.index, e.target.value as FieldId | '')} className="w-full min-w-[12rem] rounded-md border border-slate-300 bg-transparent px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
                          <option value="">{t('import.ignore')}</option>
                          {(module === 'finance' ? FINANCE_FIELDS : module === 'inventory' ? INVENTORY_FIELDS : module === 'purchasing' ? PURCHASE_FIELDS : SALES_FIELDS).map((sf) => <option key={sf} value={sf}>{t(`${module === 'finance' ? 'ffield' : 'field'}.${sf}` as MessageKey)}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        {f && c !== undefined && <span className="inline-flex flex-wrap items-center gap-1"><Badge tone={c >= LOW_CONFIDENCE ? 'opportunity' : 'warn'}>{Math.round(c * 100)} %</Badge><span className="text-xs text-slate-500">{t(`diag.source.${sources[col.index] ?? 'user'}` as MessageKey)}</span></span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="space-y-1 text-sm" aria-live="polite">
            {warnings.map((w, i) => (
              <li key={i} className={cn('rounded-md px-3 py-2', w.code === 'missing_date' || w.code === 'missing_amount' || w.code === 'missing_product' || w.code === 'missing_quantity' || w.code === 'missing_counterparty' ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200')}>
                {w.code === 'missing_date' && t(module === 'inventory' ? 'inv.asOfNeeded' : needsAsOf ? 'fin.asOfNeeded' : 'import.needDate')}
                {w.code === 'missing_counterparty' && t('import.needCounterparty')}
                {w.code === 'missing_product' && t('import.needProduct')}
                {w.code === 'missing_quantity' && t('import.needQuantity')}
                {w.code === 'missing_amount' && t('import.needAmount')}
                {w.code === 'amount_basis_unknown' && t('import.basisUnknown')}
                {w.code === 'multiple_amounts' && t('import.multiAmount')}
                {w.code === 'missing_supplier' && t('import.needSupplier')}
                {w.code === 'low_confidence' && t('import.lowConf', { field: t(`field.${w.field}` as MessageKey) })}
              </li>
            ))}
          </ul>

          <Card className="space-y-2" data-testid="diag-unrecognized">
            <CardTitle>{t('diag.unrecognized')}</CardTitle>
            {(() => {
              const un = analysis.profiles.filter((c) => c.type !== 'empty' && !assign[c.index]).map((c) => c.header);
              return un.length ? <ul className="flex flex-wrap gap-2">{un.map((h) => <li key={h}><Badge tone="warn">{h}</Badge></li>)}</ul> : <p className="text-sm text-slate-500">{t('diag.noneUnrecognized')}</p>;
            })()}
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            {needsAsOf && (
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t(module === 'finance' ? 'fin.asOf' : 'inv.asOf')}</span>
                <input type="date" data-testid="asof-input" value={asOf} onChange={(e) => { setAsOf(e.target.value); setPolicy(null); setConfirmChecked(false); }} className="block w-full rounded-md border border-slate-300 bg-transparent px-2 py-2 dark:border-slate-700 dark:bg-slate-900" />
                <span className="block text-xs text-slate-500">{t(module === 'finance' ? 'fin.asOfHelp' : 'inv.asOfHelp')}</span>
              </label>
            )}
            {!hasCurrencyCol && (
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t('import.currency')}</span>
                <select data-testid="currency-select" value={currency} onChange={(e) => setCurrency(e.target.value)} className="block w-full rounded-md border border-slate-300 bg-transparent px-2 py-2 dark:border-slate-700 dark:bg-slate-900">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
                <span className="block text-xs text-slate-500">{analysis.proposal.detectedCurrency ? t('import.currencyDetected', { c: analysis.proposal.detectedCurrency }) : t('import.currencyHint')}</span>
              </label>
            )}
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t('import.exportMode')}</span>
              <select data-testid="mode-select" value={mode} onChange={(e) => { setMode(e.target.value as ExportMode); setPolicy(null); setConfirmChecked(false); }} className="block w-full rounded-md border border-slate-300 bg-transparent px-2 py-2 dark:border-slate-700 dark:bg-slate-900">
                {MODES.map((m) => <option key={m} value={m}>{t(`mode.${m}` as MessageKey)}</option>)}
              </select>
              <span className="block text-xs text-slate-500" data-testid="mode-help">{t(`mode.help.${mode}` as MessageKey)}</span>
            </label>
          </div>

          {d && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="space-y-2" data-testid="diag-validation">
                <CardTitle>{t('diag.validation')}</CardTitle>
                <p className="text-sm text-slate-600 dark:text-slate-400">{t('diag.rows', { read: d.rows.read, imported: d.rows.imported, skipped: d.rows.skipped })}</p>
                {d.issues.length === 0 ? <p className="text-sm text-slate-500">{t('diag.noIssues')}</p> : (
                  <ul className="space-y-1 text-sm">{d.issues.map((x) => <li key={x.level + x.code}><Badge tone={x.level === 'error' ? 'risk' : 'warn'}>{t(`issue.${x.code}` as MessageKey)}: {x.count}</Badge>{x.rows.length > 0 && <span className="ml-2 text-xs text-slate-500">{t('diag.examples', { rows: x.rows.slice(0, 5).join(', ') })}</span>}</li>)}</ul>
                )}
              </Card>
              {pv?.financeKind && (
                <Card className="border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/30 lg:col-span-2" data-testid="finance-kind" data-kind={pv.financeKind} data-side={pv.financeSide}>
                  <div className="text-xs font-medium text-slate-500">{t('fin.kind.label')}</div>
                  <div className="text-base font-semibold">{t(`fin.kind.${pv.financeKind}` as MessageKey)} · {t(`fin.side.short.${(pv.financeSide ?? 'receivable') as FinanceSide}` as MessageKey)}{pv.snapshotDates && pv.snapshotDates.length > 0 && <span className="ml-2 text-sm font-normal text-slate-600 dark:text-slate-300">· {t('inv.snapshotDates', { n: pv.snapshotDates.length })}</span>}</div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{t(`fin.kind.d.${pv.financeKind}` as MessageKey)}</p>
                  <p className="text-sm" data-testid="finance-grain"><b>{t('fin.grain.label')}</b> {t(`fin.grain.${pv.financeGrain}` as MessageKey)}</p>
                  {['open_items', 'aging', 'balance'].includes(pv.financeKind) && <p className="mt-1 text-xs text-slate-500">{t('fin.snapshot.note')}</p>}
                </Card>
              )}
              {pv?.inventoryKind && (
                <Card className="border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/30 lg:col-span-2" data-testid="inventory-kind" data-kind={pv.inventoryKind}>
                  <div className="text-xs font-medium text-slate-500">{t('inv.kind.label')}</div>
                  <div className="text-base font-semibold">{t(`inv.kind.${pv.inventoryKind}` as MessageKey)}{pv.snapshotDates && pv.snapshotDates.length > 0 && <span className="ml-2 text-sm font-normal text-slate-600 dark:text-slate-300">· {t('inv.snapshotDates', { n: pv.snapshotDates.length })}</span>}</div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{t(`inv.kind.d.${pv.inventoryKind}` as MessageKey)}</p>
                  {pv.inventoryKind === 'movements' && <p className="mt-1 text-xs text-slate-500">{t('inv.movementTypes')}</p>}
                </Card>
              )}
              {pv?.discountMode && pv.discountMode !== 'none' && <p className="rounded-md bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200 lg:col-span-2" data-testid="discount-note">ℹ {t(`import.discount.${pv.discountMode}` as MessageKey)}</p>}
              <Card className="space-y-2" data-testid="diag-metrics">
                <CardTitle>{t('diag.metrics')}</CardTitle>
                <ul className="space-y-1 text-sm">
                  {d.metrics.map((m) => (
                    <li key={m.id} data-testid={`diag-metric-${m.id}`} data-available={m.available}>
                      <span className={m.available ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500'}>{m.available ? '✓' : '✗'}</span> <b>{t((m.id === 'sales' || m.id === 'p_spend' ? `metric.${m.id}.${pv?.stats && d ? (entries.some((e) => e.field === 'net_amount') ? 'net' : entries.some((e) => e.field === 'gross_amount') ? 'gross' : 'unknown') : 'unknown'}` : `metric.${m.id}`) as MessageKey)}</b>
                      {!m.available && m.reason && <span className="text-xs text-slate-500"> – {t(`mu.${m.reason}` as MessageKey)}</span>}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-slate-500">{t('diag.aspNote')}</p>
              </Card>
            </div>
          )}

          {pv && analysis && <ImportTrustCard items={pv.trust} headers={analysis.headers} dateOrders={dateOrders} setOrder={(col, o) => setDateOrders((prev) => ({ ...prev, [col]: o }))} />}

          {p && (
            <Card className="space-y-3" data-testid="import-preview">
              <CardTitle>{t('import.previewTitle')}</CardTitle>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Stat label={t('import.preview.added')} value={p.added} testid="pv-added" />
                <Stat label={t('mp.newDocs')} value={p.newDocs} />
                {p.additionsDocs > 0 && <Stat label={t('mp.additions')} value={p.additionsDocs} testid="pv-additions" />}
                <Stat label={t('import.preview.duplicates')} value={p.duplicates} testid="pv-dups" />
                {p.revisedDocs > 0 && <Stat label={t('import.preview.revised')} value={`${p.revisedDocs} (${p.supersededLines})`} testid="pv-revised" />}
                {p.removedDocs > 0 && <Stat label={t('mp.removed')} value={p.removedDocs} testid="pv-removed" />}
                {p.heldLines > 0 && <Stat label={t('mp.held')} value={`${p.heldLines} (${p.heldDocs || '–'})`} testid="pv-held" />}
                {p.omittedDocs > 0 && <Stat label={t('mp.omitted')} value={p.omittedDocs} />}
                {p.absentDocs > 0 && <Stat label={t('mp.absent')} value={p.absentDocs} testid="pv-absent" />}
                {p.sharedNumberDocs > 0 && <Stat label={t('mp.sharedNumber')} value={p.sharedNumberDocs} testid="pv-shared" />}
                {p.stale > 0 && <Stat label={t('import.preview.stale')} value={p.stale} />}
                {p.skippedLines > 0 && <Stat label={t('mp.skipped')} value={p.skippedLines} />}
                <Stat label={t('import.result.identity')} value={t(`identity.${p.identity}` as MessageKey)} />
              </dl>
              {p.sharedNumberDocs > 0 && <p className="rounded-md bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200" data-testid="pv-shared-note">ℹ {t('mp.sharedNumberNote')}</p>}
              {p.heldLines > 0 && <p className="rounded-md bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">ℹ {t('mp.heldNote')}</p>}
              {p.overlapRisk && <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="overlap-risk">⚠ {t('import.preview.overlapRisk')}</p>}
              {p.identity === 'content' && !p.overlapRisk && <p className="text-xs text-slate-500">{t('import.preview.contentIdentity')}</p>}
              {p.heldLines + p.revisedDocs + p.removedDocs === 0 && needs.length === 0 && <p className="text-sm text-emerald-700 dark:text-emerald-400" data-testid="pv-safe">✓ {t('mp.safe')}</p>}

              {showConflicts && (
                <fieldset className="space-y-1 text-sm" data-testid="policy-conflicts">
                  <legend className="mb-1 font-medium">{t('pol.conflicts')}</legend>
                  {(['hold', 'replace', 'add_alongside'] as const).map((o) => (
                    <label key={o} className="flex items-start gap-2"><input type="radio" name="pc" value={o} checked={(policy ?? p.policy).conflicts === o} onChange={() => setPol({ conflicts: o })} data-testid={`pol-${o}`} />
                      <span>{t(`pol.${o}` as MessageKey)}{p.proposedPolicy.conflicts === o && <Badge className="ml-2" tone="info">{t('pol.proposed')}</Badge>}</span></label>
                  ))}
                </fieldset>
              )}
              {showContent && (
                <fieldset className="space-y-1 text-sm" data-testid="policy-content">
                  <legend className="mb-1 font-medium">{t('pol.content')}</legend>
                  {(['hold_overlap', 'only_new_dates', 'dedupe_exact'] as const).map((o) => (
                    <label key={o} className="flex items-start gap-2"><input type="radio" name="pk" value={o} checked={(policy ?? p.policy).content === o} onChange={() => setPol({ content: o })} data-testid={`pol-${o}`} />
                      <span>{t(`pol.${o}` as MessageKey)}{p.proposedPolicy.content === o && <Badge className="ml-2" tone="info">{t('pol.proposed')}</Badge>}</span></label>
                  ))}
                </fieldset>
              )}

              {needs.length > 0 && (
                <div className="space-y-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/30" data-testid="confirm-box" role="group" aria-label={t('cf.title')}>
                  <div className="font-semibold">{t('cf.title')}</div>
                  <ul className="list-disc space-y-1 pl-5">
                    {needs.map((r) => <li key={r}>{t(`cf.${r}` as MessageKey, { n: r === 'replacements' ? p.revisedDocs : p.removedDocs })}</li>)}
                  </ul>
                  <label className="flex items-center gap-2 font-medium"><input type="checkbox" data-testid="confirm-checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />{t('cf.checkbox')}</label>
                </div>
              )}
            </Card>
          )}

          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t('import.remember')}</label>

          <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <summary className="cursor-pointer text-sm font-medium">{t('import.preview')}</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr>{analysis.headers.map((h, i) => <th key={i} className="px-2 py-1 text-slate-500">{h}</th>)}</tr></thead>
                <tbody>{analysis.previewRows.map((r, ri) => <tr key={ri} className="border-t border-slate-100 dark:border-slate-800">{r.map((c, ci) => <td key={ci} className="max-w-[12rem] truncate px-2 py-1">{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={confirm} disabled={!confirmable || busy} data-testid="confirm-import">{t('import.confirm')}</Button>
            <Button variant="outline" onClick={reset}>{t('import.cancel')}</Button>
            {d && <Button variant="ghost" size="sm" onClick={downloadDiag} data-testid="download-diagnostics">{t('diag.download')}</Button>}
            {pvBusy && <span className="text-xs text-slate-500">{t('diag.working')}</span>}
          </div>
          {d && <p className="text-xs text-slate-500">{t('diag.privacy')}</p>}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, testid }: { label: string; value: number | string; testid?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold" data-testid={testid}>{value}</dd>
    </div>
  );
}

const LEVEL_TONE = { ok: 'opportunity', info: 'info', warn: 'warn', confirm: 'risk' } as const;

/** What a person should know before trusting this import: currency, VAT basis, date reading, missing identifiers, duplicates, coverage and clashes with other modules. */
function ImportTrustCard({ items, headers, dateOrders, setOrder }: { items: TrustItem[]; headers: string[]; dateOrders: Record<number, DateOrder>; setOrder: (col: number, o: DateOrder) => void }) {
  const { t, lang } = useLang();
  const text = (it: TrustItem): string => {
    const p = it.params;
    switch (it.code) {
      case 'currency': return t(p.source === 'chosen' ? 'itrust.currency.chosen' : it.level === 'warn' ? 'itrust.currency.multi' : 'itrust.currency.column', { list: String(p.list) });
      case 'vat_basis': return t(`itrust.vat.${p.basis}` as MessageKey);
      case 'date_order': return t('itrust.date_order', { n: Number(p.n), order: t(`itrust.order.${p.order}` as MessageKey) });
      case 'dates': return it.level === 'warn' ? t('itrust.dates.bad', { bad: Number(p.bad) }) : t('itrust.dates.ok', { order: t(`itrust.order.${p.order}` as MessageKey) });
      case 'identifiers': return t('itrust.identifiers', { n: Number(p.n) });
      case 'duplicates': return t(it.level === 'warn' ? 'itrust.duplicates.invoice' : 'itrust.duplicates.stored', { n: Number(p.n) });
      case 'vat_rates': return t('itrust.vat_rates', { list: String(p.list) }) + (p.mixed ? ' ' + t('itrust.vat_mixed') : '');
      case 'vat_inconsistent': return t('itrust.vat_inconsistent', { n: Number(p.n) });
      case 'credit_sign': return t('itrust.credit_sign', { n: Number(p.n) });
      case 'amount_sign': return t('itrust.amount_sign', { n: Number(p.n) });
      case 'coverage': return t('itrust.coverage', { from: fmtDate(String(p.from), lang), to: fmtDate(String(p.to), lang), rows: Number(p.rows) });
      case 'compat_currency': return t('itrust.compat_currency', { module: t(`mod.${p.module}` as MessageKey), other: String(p.other), mine: String(p.mine) });
      case 'compat_basis': return t('itrust.compat_basis', { module: t(`mod.${p.module}` as MessageKey), other: String(p.other), mine: String(p.mine) });
      default: return '';
    }
  };
  const attention = items.filter((i) => i.level === 'warn' || i.level === 'confirm');
  return (
    <Card className="space-y-2" data-testid="import-trust" data-attention={attention.length}>
      <CardTitle>{t('itrust.title')}</CardTitle>
      {attention.length === 0 && <p className="text-sm text-emerald-700 dark:text-emerald-400" data-testid="trust-allclear">{t('itrust.allClear')}</p>}
      <ul className="space-y-2 text-sm">
        {items.map((it, i) => (
          <li key={`${it.code}${i}`} className="flex flex-wrap items-start gap-2" data-testid={`trust-item-${it.code}`} data-level={it.level}>
            <Badge tone={LEVEL_TONE[it.level]}>{t(`itrust.level.${it.level}` as MessageKey)}</Badge>
            <span className="min-w-0 flex-1">{text(it)}</span>
            {it.choice === 'date_order' && it.columns?.map((c) => (
              <label key={c} className="flex items-center gap-1 text-xs">{headers[c]}: <select data-testid={`date-order-${c}`} value={dateOrders[c] ?? 'dmy'} onChange={(e) => setOrder(c, e.target.value as DateOrder)} className="rounded-md border border-slate-300 bg-transparent px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900">{(['dmy', 'mdy'] as DateOrder[]).map((o) => <option key={o} value={o}>{t(`itrust.order.${o}` as MessageKey)}</option>)}</select></label>
            ))}
          </li>
        ))}
      </ul>
    </Card>
  );
}
