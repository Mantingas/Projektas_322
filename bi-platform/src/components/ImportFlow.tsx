'use client';
import { useCallback, useRef, useState } from 'react';
import { useLang } from './LangProvider';
import { Button } from './ui/button';
import { Card, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { getDb } from '@/db/db';
import type { ImportRow } from '@/db/db';
import { commitImport, findByChecksum, getSavedMapping, saveMapping } from '@/db/store';
import { analyzeSheet, confirmedFromEntries, type SheetAnalysis } from '@/engine/pipeline';
import { isMappingConfirmable, mappingToSaved, validateMapping, LOW_CONFIDENCE } from '@/engine/mapping/mapper';
import { SALES_TEMPLATES } from '@/engine/mapping/templates';
import { MappingError, normalizeSales } from '@/engine/validation/normalize';
import { sha256Hex } from '@/engine/import/hash';
import { SALES_FIELDS, type ExportMode, type ImportStats, type MappingEntry, type ParsedFile, type SalesField } from '@/engine/types';
import { ClientParseError, parseInWorker } from '@/lib/parseClient';
import { fmtDate } from '@/i18n';
import type { MessageKey } from '@/i18n';
import { cn } from '@/lib/cn';

const CURRENCIES = ['EUR', 'PLN', 'USD', 'GBP', 'CZK', 'SEK'];
const MAX_BYTES = 50 * 1024 * 1024;

interface Loaded {
  fileName: string;
  checksum: string;
  parsed: ParsedFile;
}

export function ImportFlow({ onImported, goInsights }: { onImported: () => void; goInsights: () => void }) {
  const { t, lang } = useLang();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [analysis, setAnalysis] = useState<SheetAnalysis | null>(null);
  const [usedSaved, setUsedSaved] = useState(false);
  const [assign, setAssign] = useState<Record<number, SalesField | ''>>({});
  const [confs, setConfs] = useState<Record<number, number>>({});
  const [currency, setCurrency] = useState('EUR');
  const [mode, setMode] = useState<ExportMode>('unknown');
  const [remember, setRemember] = useState(true);
  const [dup, setDup] = useState<ImportRow | null>(null);
  const [dupAccepted, setDupAccepted] = useState(false);
  const [result, setResult] = useState<{ row: ImportRow; stats: ImportStats } | null>(null);
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    setLoaded(null); setAnalysis(null); setAssign({}); setConfs({}); setError(null); setDup(null); setDupAccepted(false); setResult(null); setSheetIdx(0); setUsedSaved(false);
    if (input.current) input.current.value = '';
  };

  const analyse = useCallback(async (parsed: ParsedFile, idx: number) => {
    const sheet = parsed.sheets[idx];
    if (!sheet) return;
    const hint = lang === 'en' ? '.' : ',';
    let a = analyzeSheet(sheet, { decimalHint: hint });
    let saved = false;
    let savedCurrency: string | undefined;
    if (a) {
      const s = await getSavedMapping(getDb(), a.signature);
      if (s) {
        a = analyzeSheet(sheet, { decimalHint: hint, savedMapping: s.fields }) ?? a;
        saved = true;
        savedCurrency = s.defaultCurrency;
      }
    }
    setAnalysis(a);
    setUsedSaved(saved);
    if (a) {
      const asg: Record<number, SalesField | ''> = {};
      const cf: Record<number, number> = {};
      a.profiles.forEach((p) => (asg[p.index] = ''));
      for (const e of a.proposal.entries) {
        asg[e.columnIndex] = e.field;
        cf[e.columnIndex] = e.confidence;
      }
      setAssign(asg);
      setConfs(cf);
      setCurrency(savedCurrency ?? a.proposal.detectedCurrency ?? (lang === 'pl' ? 'PLN' : 'EUR'));
    }
  }, [lang]);

  const handleFile = useCallback(async (file: File) => {
    reset();
    setBusy(true);
    try {
      if (file.size > MAX_BYTES) throw new ClientParseError('file_too_large');
      const buf = await file.arrayBuffer();
      const checksum = await sha256Hex(new Uint8Array(buf));
      const parsed = await parseInWorker(buf, file.name);
      const existing = await findByChecksum(getDb(), checksum);
      setDup(existing ?? null);
      setLoaded({ fileName: file.name, checksum, parsed });
      // first sheet that contains a table
      let idx = 0;
      for (let i = 0; i < parsed.sheets.length; i++) {
        if (analyzeSheet(parsed.sheets[i]!)) { idx = i; break; }
      }
      setSheetIdx(idx);
      await analyse(parsed, idx);
    } catch (e) {
      setError(e instanceof ClientParseError ? t(`err.${e.code}` as MessageKey) : t('err.unknown'));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyse, t]);

  const setField = (col: number, field: SalesField | '') => {
    setAssign((prev) => {
      const next = { ...prev };
      if (field) for (const k of Object.keys(next)) if (next[Number(k)] === field) next[Number(k)] = '';
      next[col] = field;
      return next;
    });
    setConfs((c) => ({ ...c, [col]: 1 }));
  };

  const entries: MappingEntry[] = Object.entries(assign)
    .filter(([, f]) => f)
    .map(([c, f]) => ({ field: f as SalesField, columnIndex: Number(c), confidence: confs[Number(c)] ?? 1, source: 'user' as const }));
  const warnings = validateMapping(entries);
  const hasCurrencyCol = entries.some((e) => e.field === 'currency');
  const confirmable = isMappingConfirmable(warnings) && (hasCurrencyCol || Boolean(currency)) && (!dup || dupAccepted);

  const confirm = async () => {
    if (!loaded || !analysis) return;
    setBusy(true);
    setError(null);
    try {
      const mapping = confirmedFromEntries(entries, hasCurrencyCol ? undefined : currency);
      const { records, stats } = normalizeSales(analysis.table.dataRows, {
        profiles: analysis.profiles, mapping, rowNumbers: analysis.table.dataRowNumbers, skippedTotalRows: analysis.table.skippedTotalRows,
      });
      const res = await commitImport(getDb(), {
        checksum: loaded.checksum, fileName: loaded.fileName, sheetName: loaded.parsed.sheets[sheetIdx]!.name, exportMode: mode,
        records, stats, mapping, templateId: analysis.proposal.templateId, allowSameChecksum: dupAccepted,
      });
      if (res.status === 'duplicate_file') {
        setDup(res.existing);
        return;
      }
      if (remember) {
        await saveMapping(getDb(), {
          signature: analysis.signature, fields: mappingToSaved(entries, analysis.table.headers), defaultCurrency: hasCurrencyCol ? undefined : currency, updatedAt: Date.now(),
        });
      }
      setResult({ row: res.import, stats });
      onImported();
    } catch (e) {
      setError(e instanceof MappingError ? t(e.code === 'currency_required' ? 'err.currency_required' : e.code === 'missing_date' ? 'import.needDate' : 'import.needAmount') : t('err.unknown'));
    } finally {
      setBusy(false);
    }
  };

  // ---------- result screen ----------
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
          {row.conflicts > 0 && <Stat label={t('import.result.conflicts')} value={row.conflicts} />}
          {stats.dateMin && stats.dateMax && <Stat label={t('import.result.period')} value={`${fmtDate(stats.dateMin, lang)} – ${fmtDate(stats.dateMax, lang)}`} />}
        </dl>
        {issueEntries.length > 0 && (
          <div>
            <div className="mb-1 text-sm font-medium">{t('import.issues')}</div>
            <ul className="flex flex-wrap gap-2">
              {issueEntries.map(([code, n]) => (
                <li key={code}><Badge tone={code in stats.errors ? 'risk' : 'warn'}>{t(`issue.${code}` as MessageKey)}: {n}</Badge></li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-2">
          <Button onClick={goInsights} data-testid="view-insights">{t('import.viewInsights')}</Button>
          <Button variant="outline" onClick={reset}>{t('import.choose')}</Button>
        </div>
      </Card>
    );
  }

  // ---------- upload screen ----------
  if (!loaded) {
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

  // ---------- mapping screen ----------
  const sheet = loaded.parsed.sheets[sheetIdx]!;
  const tpl = analysis?.proposal.templateId ? SALES_TEMPLATES.find((x) => x.id === analysis.proposal.templateId) : undefined;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('import.mappingTitle')}</h1>
        <Button variant="ghost" size="sm" onClick={reset}>{t('import.cancel')}</Button>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">📄 {loaded.fileName}</p>
      {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}

      {dup && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40" data-testid="dup-file">
          <p className="text-sm">{t('import.dupFile', { date: fmtDate(new Date(dup.importedAt).toISOString().slice(0, 10), lang) })}</p>
          {!dupAccepted && <Button className="mt-2" size="sm" variant="outline" onClick={() => setDupAccepted(true)} data-testid="import-anyway">{t('import.importAnyway')}</Button>}
        </Card>
      )}

      {loaded.parsed.sheets.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          {t('import.sheet')}
          <select
            className="rounded-md border border-slate-300 bg-transparent px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
            value={sheetIdx}
            data-testid="sheet-select"
            onChange={async (e) => { const i = Number(e.target.value); setSheetIdx(i); await analyse(loaded.parsed, i); }}
          >
            {loaded.parsed.sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
          </select>
        </label>
      )}

      {!analysis ? (
        <p className="rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950/40">{t('import.noTable')}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge>{t('import.headerRow', { row: analysis.table.headerRow + 1 })}</Badge>
            {analysis.table.skippedTotalRows > 0 && <Badge>{t('import.totalSkipped', { n: analysis.table.skippedTotalRows })}</Badge>}
            {sheet.truncated && <Badge tone="warn">{t('import.truncated', { n: sheet.rows.length })}</Badge>}
            {tpl && <Badge tone="info">{t('import.template', { name: tpl.name })}</Badge>}
            {usedSaved && <Badge tone="info">{t('import.saved')}</Badge>}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">{t('import.mappingHelp')}</p>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-sm" data-testid="mapping-table">
              <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900">
                <tr>
                  <th className="px-3 py-2">{t('import.column')}</th>
                  <th className="px-3 py-2">{t('import.sample')}</th>
                  <th className="px-3 py-2">{t('import.type')}</th>
                  <th className="px-3 py-2">{t('import.meaning')}</th>
                  <th className="px-3 py-2">{t('import.confidence')}</th>
                </tr>
              </thead>
              <tbody>
                {analysis.profiles.map((p) => {
                  const f = assign[p.index] ?? '';
                  const c = confs[p.index];
                  const samples = analysis.table.dataRows.slice(0, 3).map((r) => String(r[p.index] ?? '')).filter(Boolean);
                  return (
                    <tr key={p.index} className="border-t border-slate-200 dark:border-slate-800">
                      <td className="px-3 py-2 font-medium">{p.header}</td>
                      <td className="max-w-[16rem] truncate px-3 py-2 text-slate-500">{samples.join(' · ')}</td>
                      <td className="px-3 py-2"><Badge>{t(`type.${p.type}` as MessageKey)}</Badge></td>
                      <td className="px-3 py-2">
                        <select
                          aria-label={p.header}
                          data-testid={`map-${p.index}`}
                          value={f}
                          onChange={(e) => setField(p.index, e.target.value as SalesField | '')}
                          className="w-full min-w-[12rem] rounded-md border border-slate-300 bg-transparent px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                        >
                          <option value="">{t('import.ignore')}</option>
                          {SALES_FIELDS.map((sf) => <option key={sf} value={sf}>{t(`field.${sf}` as MessageKey)}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        {f && c !== undefined && <Badge tone={c >= LOW_CONFIDENCE ? 'opportunity' : 'warn'}>{Math.round(c * 100)} %</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="space-y-1 text-sm" aria-live="polite">
            {warnings.map((w, i) => (
              <li key={i} className={cn('rounded-md px-3 py-2', w.code === 'missing_date' || w.code === 'missing_amount' ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200')}>
                {w.code === 'missing_date' && t('import.needDate')}
                {w.code === 'missing_amount' && t('import.needAmount')}
                {w.code === 'amount_basis_unknown' && t('import.basisUnknown')}
                {w.code === 'multiple_amounts' && t('import.multiAmount')}
                {w.code === 'low_confidence' && t('import.lowConf', { field: t(`field.${w.field}` as MessageKey) })}
              </li>
            ))}
          </ul>

          <div className="grid gap-4 sm:grid-cols-2">
            {!hasCurrencyCol && (
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t('import.currency')}</span>
                <select data-testid="currency-select" value={currency} onChange={(e) => setCurrency(e.target.value)} className="block w-full rounded-md border border-slate-300 bg-transparent px-2 py-2 dark:border-slate-700 dark:bg-slate-900">
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <span className="block text-xs text-slate-500">{analysis.proposal.detectedCurrency ? t('import.currencyDetected', { c: analysis.proposal.detectedCurrency }) : t('import.currencyHint')}</span>
              </label>
            )}
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t('import.exportMode')}</span>
              <select data-testid="mode-select" value={mode} onChange={(e) => setMode(e.target.value as ExportMode)} className="block w-full rounded-md border border-slate-300 bg-transparent px-2 py-2 dark:border-slate-700 dark:bg-slate-900">
                {(['full', 'incremental', 'unknown'] as const).map((m) => <option key={m} value={m}>{t(`mode.${m}` as MessageKey)}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t('import.remember')}
          </label>

          <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-800" open>
            <summary className="cursor-pointer text-sm font-medium">{t('import.preview')}</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr>{analysis.table.headers.map((h, i) => <th key={i} className="px-2 py-1 text-slate-500">{h}</th>)}</tr></thead>
                <tbody>
                  {analysis.table.dataRows.slice(0, 8).map((r, ri) => (
                    <tr key={ri} className="border-t border-slate-100 dark:border-slate-800">
                      {analysis.table.headers.map((_, ci) => <td key={ci} className="max-w-[12rem] truncate px-2 py-1">{String(r[ci] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className="flex gap-2">
            <Button onClick={confirm} disabled={!confirmable || busy} data-testid="confirm-import">{t('import.confirm')}</Button>
            <Button variant="outline" onClick={reset}>{t('import.cancel')}</Button>
          </div>
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
