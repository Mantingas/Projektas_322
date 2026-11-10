'use client';
import { useCallback, useRef, useState } from 'react';
import { useLang } from '../LangProvider';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { engine, EngineError } from '@/lib/engineClient';
import type { ParseResult, UniversalProfileResult } from '@/lib/engineSession';
import { UTYPES, type UType } from '@/engine/universal/types';
import { cn } from '@/lib/cn';
import type { MessageKey } from '@/i18n';

const MAX_BYTES = 50 * 1024 * 1024;

export function UniversalImport({ onImported, goView }: { onImported: () => void; goView: () => void }) {
  const { t, lang } = useLang();
  const input = useRef<HTMLInputElement>(null);
  const decimal = lang === 'en' ? '.' : ',';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [profile, setProfile] = useState<UniversalProfileResult | null>(null);
  const [decisions, setDecisions] = useState<Record<number, UType>>({});
  const [dupAccepted, setDupAccepted] = useState(false);
  const [done, setDone] = useState<{ rows: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const errText = useCallback((e: unknown) => {
    const code = e instanceof EngineError ? e.code : 'unknown';
    if (code === 'worker') return t('err.worker');
    return t((['file_too_large', 'unsupported_format', 'legacy_xls', 'corrupt_file', 'empty_file', 'password_protected', 'zip_limits', 'unsafe_archive', 'timeout', 'sheet_limits'].includes(code) ? `err.${code}` : 'err.unknown') as MessageKey);
  }, [t]);

  const reset = useCallback(() => {
    void engine().call('discard', []);
    setParsed(null); setProfile(null); setDecisions({}); setError(null); setDupAccepted(false); setDone(null); setSheetIdx(0);
    if (input.current) input.current.value = '';
  }, []);

  const load = useCallback(async (idx: number) => {
    const p = await engine().call('universalProfile', [idx, decimal]);
    setSheetIdx(idx); setDecisions({});
    if (!p) { setProfile(null); setError(t('uni.import.noTable')); return; }
    setError(null); setProfile(p);
  }, [decimal, t]);

  const handleFile = useCallback(async (file: File) => {
    reset(); setBusy(true);
    try {
      if (file.size > MAX_BYTES) throw new EngineError('file_too_large');
      const buf = await file.arrayBuffer();
      const p = await engine().call('parse', [buf, file.name], [buf]);
      setParsed(p);
      await load(Math.max(0, p.sheets.findIndex((s) => s.hasTable)));
    } catch (e) { setError(errText(e)); setParsed(null); } finally { setBusy(false); }
  }, [errText, load, reset]);

  const open = profile ? profile.columns.filter((c) => c.ambiguous && decisions[c.index] === undefined).length : 0;
  const blockedByDuplicate = Boolean(parsed?.duplicateOf) && !dupAccepted;

  const commit = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      const r = await engine().call('universalCommit', [{ sheetIdx, decimalHint: decimal, decisions, allowSameChecksum: dupAccepted }]);
      if (r.status === 'ok') { setDone({ rows: r.rows }); onImported(); } else if (r.status === 'duplicate_file') setDupAccepted(false);
      else setError(t('uni.import.confirmNeeded', { count: r.columns.length }));
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Card className="space-y-3" data-testid="u-import-result">
        <CardTitle>{t('uni.import.done', { rows: done.rows })}</CardTitle>
        <div className="flex gap-2"><Button onClick={goView} data-testid="u-open-view">{t('uni.import.openView')}</Button><Button variant="outline" onClick={reset}>{t('import.choose')}</Button></div>
      </Card>
    );
  }

  if (!parsed || !profile) {
    return (
      <div className="space-y-4" data-testid="universal-import">
        <h1 className="text-2xl font-bold">{t('uni.import.title')}</h1>
        <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-400">{t('uni.import.intro')}</p>
        <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void handleFile(f); }}
          className={cn('flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-10 text-center', dragging ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30' : 'border-slate-300 dark:border-slate-700')}>
          <p className="text-lg">{busy ? t('import.parsing') : t('import.drop')}</p>
          <Button onClick={() => input.current?.click()} disabled={busy}>{t('import.choose')}</Button>
          <input ref={input} data-testid="u-file-input" type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
          <p className="max-w-xl text-xs text-slate-500">{t('import.formats')}</p>
        </div>
        {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="universal-import">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{parsed.fileName}</h1>
        <Button variant="outline" size="sm" onClick={reset}>{t('import.choose')}</Button>
      </div>
      {parsed.sheets.length > 1 && (
        <label className="flex items-center gap-2 text-sm">{t('import.sheet')}
          <select value={sheetIdx} onChange={(e) => void load(Number(e.target.value))} className="rounded-md border border-slate-300 bg-transparent px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
            {parsed.sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
          </select>
        </label>
      )}
      {parsed.duplicateOf && (
        <div role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="u-duplicate">
          {t('uni.import.duplicate', { file: parsed.duplicateOf.fileName })} <button className="underline" onClick={() => setDupAccepted(true)}>{t('uni.import.again')}</button>
        </div>
      )}
      {profile.truncated && <p className="text-sm text-amber-700">{t('uni.import.truncated')}</p>}
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('uni.import.rows', { rows: profile.rowCount, cols: profile.columns.length })} · {t('uni.import.noSemantics')}</p>
      <p data-testid="u-unresolved" data-open={open} className={cn('text-sm font-medium', open ? 'text-amber-700' : 'text-emerald-700')}>{open ? t('uni.import.confirmNeeded', { count: open }) : t('uni.import.allSet')}</p>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm" data-testid="u-mapping-table">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900"><tr><th className="px-3 py-2">{t('uni.col.header')}</th><th className="px-3 py-2">{t('uni.col.type')}</th><th className="px-3 py-2">{t('uni.col.samples')}</th><th className="px-3 py-2">{t('uni.col.state')}</th></tr></thead>
          <tbody>
            {profile.columns.map((c) => {
              const undecided = c.ambiguous && decisions[c.index] === undefined;
              return (
                <tr key={c.index} className="border-t border-slate-100 align-top dark:border-slate-800" data-testid={`u-col-row-${c.index}`} data-undecided={undecided}>
                  <td className="px-3 py-2 font-medium">{c.header}</td>
                  <td className="px-3 py-2">
                    <select aria-label={`${c.header}: ${t('uni.col.type')}`} data-testid={`u-col-${c.index}`} value={undecided ? '' : (decisions[c.index] ?? c.type)} onChange={(e) => setDecisions((d) => ({ ...d, [c.index]: e.target.value as UType }))}
                      className={cn('rounded-md border bg-transparent px-2 py-1 dark:bg-slate-900', undecided ? 'border-amber-500' : 'border-slate-300 dark:border-slate-700')}>
                      {undecided && <option value="">{t('uni.import.choose')}</option>}
                      {UTYPES.map((u) => <option key={u} value={u}>{t(`utype.${u}` as MessageKey)}{u === c.suggested ? ` (${t('uni.import.suggested')})` : ''}</option>)}
                    </select>
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-xs text-slate-500">{c.samples.join(' · ')}</td>
                  <td className="px-3 py-2 text-xs">
                    {undecided ? <Badge tone="warn">{t('uni.import.unsure')}</Badge> : <Badge tone="opportunity">✓</Badge>}
                    <div className="mt-1 text-slate-500">{t(`utype.why.${c.reason}` as MessageKey)}</div>
                    {c.missing > 0 && <div className="text-slate-500">{t('uni.col.missing', { n: c.missing })}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
      <Button onClick={() => void commit()} disabled={busy || open > 0 || blockedByDuplicate} data-testid="u-confirm-import">{busy ? t('uni.import.importing') : t('uni.import.confirm')}</Button>
    </div>
  );
}
