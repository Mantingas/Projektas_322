'use client';
import { useEffect, useState } from 'react';
import { useLang } from '../LangProvider';
import { Button } from '../ui/button';
import { engine } from '@/lib/engineClient';
import type { DrillResult } from '@/lib/engineSession';
import type { DrillSpec } from '@/engine/analytics/provenance';
import { downloadText } from '@/lib/download';
import { dateRange } from '@/lib/dashFormat';
import { fmtDate, money, num } from '@/i18n';

export interface DrillState {
  title: string;
  spec: DrillSpec;
  filterText?: string;
}

const PAGE = 25;

/** Shows the exact lines behind a number. The lines stay in the worker; only the visible page is transferred. */
export function DrillDrawer({ drill, currency, version, seriesKey, importNames, onClose }: { drill: DrillState; currency: string; version: number; seriesKey?: string; importNames: Record<string, string>; onClose: () => void }) {
  const { t, lang } = useLang();
  const [page, setPage] = useState(0);
  const [data, setData] = useState<DrillResult | null>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  useEffect(() => {
    let alive = true;
    engine().call('drill', [{ version, seriesKey, spec: drill.spec, page, pageSize: PAGE }]).then((r) => alive && setData(r)).catch(() => alive && setData({ lines: 0, total: 0, sources: [], rows: [] }));
    return () => { alive = false; };
  }, [drill.spec, page, version, seriesKey]);
  const m = (n: number) => money(n, { lang, currency });
  const fileOf = (id?: string) => (id && importNames[id]) || t('drill.unknownSource');
  const pages = data ? Math.max(1, Math.ceil(data.lines / PAGE)) : 1;
  const exportCsv = async () => {
    const csv = await engine().call('drillCsv', [{ version, seriesKey, spec: drill.spec, headers: [t('drill.date'), t('drill.document'), t('drill.customer'), t('drill.product'), t('drill.qty'), t('drill.amount'), t('drill.source'), t('drill.row')], fileNames: importNames, unknownFile: t('drill.unknownSource') }]);
    downloadText('records.csv', 'text/csv', csv);
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label={t('drill.title')} data-testid="drill-drawer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-full w-full max-w-3xl flex-col gap-3 overflow-y-auto bg-white p-5 shadow-xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t('drill.title')}: {drill.title}</h2>
            {drill.spec.range && <p className="text-xs text-slate-500">{t('drill.period')}: {dateRange(drill.spec.range.from, drill.spec.range.to, lang)}</p>}
            {drill.filterText && <p className="text-xs text-slate-500">{t('drill.filters')}: {drill.filterText}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="drill-close">{t('common.close')} ✕</Button>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-slate-500">{t('drill.lines')}</dt><dd className="text-lg font-semibold" data-testid="drill-lines">{data ? num(data.lines, lang) : '…'}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('drill.total')}</dt><dd className="text-lg font-semibold" data-testid="drill-total">{data ? m(data.total) : '…'}</dd></div>
        </dl>
        {data && <div className="text-xs"><b>{t('drill.sources')}:</b> {data.sources.map((s) => `${fileOf(s.importId)} (${s.lines})`).join(', ')}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800"><tr>{(['drill.date', 'drill.document', 'drill.customer', 'drill.product', 'drill.qty', 'drill.amount', 'drill.source', 'drill.row'] as const).map((k, i) => <th key={k} className={`px-2 py-1.5 text-slate-500 ${i === 4 || i === 5 ? 'text-right' : ''}`}>{t(k)}</th>)}</tr></thead>
            <tbody>
              {(data?.rows ?? []).map((r) => (
                <tr key={r.key} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="whitespace-nowrap px-2 py-1">{fmtDate(r.date, lang)}</td><td className="px-2 py-1">{r.documentId ?? '–'}</td>
                  <td className="max-w-[10rem] truncate px-2 py-1">{r.customerName ?? r.customerId ?? '–'}</td><td className="max-w-[10rem] truncate px-2 py-1">{r.productName ?? r.productId ?? '–'}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.quantity ?? '–'}</td><td className="px-2 py-1 text-right tabular-nums">{m(r.amount)}</td>
                  <td className="max-w-[9rem] truncate px-2 py-1">{fileOf(r.importId)}</td><td className="px-2 py-1">{r.sourceRow}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>{data ? t('drill.showing', { from: Math.min(data.lines, page * PAGE + 1), to: Math.min(data.lines, page * PAGE + PAGE), total: data.lines }) : ''}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('tbl.prev')}</Button>
            <Button size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>{t('tbl.next')}</Button>
            <Button size="sm" variant="outline" onClick={exportCsv}>{t('drill.exportCsv')}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
