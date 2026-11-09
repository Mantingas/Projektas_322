'use client';
import { useEffect, useState } from 'react';
import { useLang } from './LangProvider';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { getDb, type ImportRow } from '@/db/db';
import { deleteImport } from '@/db/store';
import { fmtDate } from '@/i18n';
import type { MessageKey } from '@/i18n';

export function HistoryView({ version, onChanged }: { version: number; onChanged: () => void }) {
  const { t, lang } = useLang();
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    getDb().imports.orderBy('importedAt').reverse().toArray().then((r) => alive && setRows(r)).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [version]);

  if (rows === null) return <p>…</p>;
  if (rows.length === 0) return <Card data-testid="no-history">{t('hist.empty')}</Card>;
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">{t('hist.title')}</h1>
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-sm" data-testid="history-table">
          <thead className="bg-slate-100 text-xs uppercase text-slate-500 dark:bg-slate-900">
            <tr>
              {(['hist.file', 'hist.date', 'hist.period', 'hist.rows', 'hist.added', 'hist.dups', 'hist.revised', 'hist.stale', 'hist.identity', 'hist.mode'] as MessageKey[]).map((k) => <th key={k} className="px-3 py-2">{t(k)}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-200 dark:border-slate-800">
                <td className="px-3 py-2 font-medium">{r.fileName}</td>
                <td className="px-3 py-2">{fmtDate(new Date(r.importedAt).toISOString().slice(0, 10), lang)}</td>
                <td className="px-3 py-2">{r.stats.dateMin && r.stats.dateMax ? `${fmtDate(r.stats.dateMin, lang)} – ${fmtDate(r.stats.dateMax, lang)}` : '—'}</td>
                <td className="px-3 py-2">{r.stats.rowsRead}</td>
                <td className="px-3 py-2">{r.added}</td>
                <td className="px-3 py-2">{r.duplicates}</td>
                <td className="px-3 py-2">{r.revisedDocs ?? 0}</td>
                <td className="px-3 py-2">{r.staleLines ?? 0}</td>
                <td className="px-3 py-2">{r.identity ? t(`identity.${r.identity}` as MessageKey) : '–'}</td>
                <td className="px-3 py-2">{t(`mode.${r.exportMode}` as MessageKey)}</td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="ghost" onClick={async () => { if (window.confirm(t('hist.confirmDelete'))) { await deleteImport(getDb(), r.id); onChanged(); } }}>{t('hist.delete')}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">{t('hist.note')}</p>
    </div>
  );
}
