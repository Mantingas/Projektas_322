'use client';
import { useMemo, useState } from 'react';
import { useLang } from '../LangProvider';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import type { EntityRow, EntityTable as Table } from '@/engine/analytics/compare';
import type { Dimension } from '@/engine/analytics/filters';
import { csvCell } from '@/engine/report/export';
import { downloadText } from '@/lib/download';
import { fmtUnit } from '@/lib/dashFormat';
import { num, pct, type MessageKey } from '@/i18n';
import { cn } from '@/lib/cn';

type ColId = 'current' | 'previous' | 'change' | 'changePct' | 'share' | 'lines' | 'quantity' | 'orders' | 'margin';
const ALL_COLS: ColId[] = ['current', 'previous', 'change', 'changePct', 'share', 'lines', 'quantity', 'orders', 'margin'];
const DEFAULT_COLS: ColId[] = ['current', 'previous', 'change', 'changePct', 'share'];
const COL_LABEL: Record<ColId, MessageKey> = { current: 'tbl.current', previous: 'tbl.previous', change: 'tbl.change', changePct: 'tbl.changePct', share: 'tbl.share', lines: 'tbl.lines', quantity: 'tbl.quantity', orders: 'tbl.orders', margin: 'tbl.margin' };

export function EntityTableView({ table, currency, onDrill, onFilter }: { table: Table; currency: string; onDrill: (row: EntityRow) => void; onFilter: (key: string) => void }) {
  const { t, lang } = useLang();
  const [q, setQ] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [sort, setSort] = useState<{ col: ColId | 'name'; dir: 1 | -1 }>({ col: 'current', dir: -1 });
  const [cols, setCols] = useState<ColId[]>(DEFAULT_COLS);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const dim: Dimension = table.dimension;
  // language-aware collation so Š, Ž, Ł, Ą … sort where an LT/PL reader expects them
  const collator = useMemo(() => new Intl.Collator(lang, { sensitivity: 'base', numeric: true }), [lang]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = table.rows.filter((x) => (!needle || x.label.toLowerCase().includes(needle)) && (!onlyChanged || Math.abs(x.change) > 1e-9));
    r = [...r].sort((a, b) => {
      if (sort.col === 'name') return collator.compare(a.label, b.label) * sort.dir;
      const va = (a[sort.col as keyof EntityRow] as number | null) ?? -Infinity;
      const vb = (b[sort.col as keyof EntityRow] as number | null) ?? -Infinity;
      return (va < vb ? -1 : va > vb ? 1 : collator.compare(a.label, b.label)) * sort.dir;
    });
    return r;
  }, [table, q, onlyChanged, sort, collator]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = rows.slice(cur * pageSize, cur * pageSize + pageSize);
  const toggle = (c: ColId) => setCols((p) => (p.includes(c) ? p.filter((x) => x !== c) : ALL_COLS.filter((x) => x === c || p.includes(x))));
  const cell = (r: EntityRow, c: ColId): string => {
    switch (c) {
      case 'current': return fmtUnit('money', r.current, lang, currency);
      case 'previous': return fmtUnit('money', r.previous, lang, currency);
      case 'change': return (r.change > 0 ? '+' : r.change < 0 ? '−' : '') + fmtUnit('money', Math.abs(r.change), lang, currency);
      case 'changePct': return r.changePct === null ? (r.previous === 0 && r.current !== 0 ? t('tbl.new') : '–') : (r.changePct > 0 ? '+' : r.changePct < 0 ? '−' : '') + pct(Math.abs(r.changePct), lang);
      case 'share': return pct(r.share, lang);
      case 'lines': return num(r.lines, lang);
      case 'quantity': return r.quantity === null ? '–' : num(r.quantity, lang);
      case 'orders': return r.orders === null ? '–' : num(r.orders, lang);
      case 'margin': return r.margin === null ? '–' : pct(r.margin, lang);
    }
  };
  const exportCsv = () => {
    const head = [t('tbl.name'), ...cols.map((c) => t(COL_LABEL[c]))];
    const raw = (r: EntityRow, c: ColId) => (c === 'share' || c === 'changePct' || c === 'margin' ? (r[c] ?? '') : (r[c] ?? ''));
    const lines = [head, ...rows.map((r) => [r.label, ...cols.map((c) => raw(r, c) as string | number)])].map((l) => l.map((x) => csvCell(typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : String(x))).join(';'));
    downloadText(`${dim}-analysis.csv`, 'text/csv', '﻿' + lines.join('\r\n') + '\r\n');
  };
  const th = 'px-3 py-2 text-xs font-semibold uppercase text-slate-500';
  const sortBtn = (id: ColId | 'name', label: string) => (
    <button onClick={() => { setSort((s) => ({ col: id, dir: s.col === id ? (-s.dir as 1 | -1) : -1 })); setPage(0); }} className="inline-flex items-center gap-1 uppercase" aria-label={`${label}`}>
      {label}{sort.col === id && <span aria-hidden>{sort.dir === 1 ? '▲' : '▼'}</span>}
    </button>
  );
  return (
    <Card className="space-y-3" data-testid={`table-${dim}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t(`dim.${dim}` as MessageKey)} <span className="text-xs font-normal text-slate-500">({t('tbl.count', { n: rows.length })})</span></CardTitle>
        <Button size="sm" variant="outline" onClick={exportCsv} data-testid={`table-export-${dim}`}>{t('tbl.exportCsv')}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input aria-label={t('tbl.search')} placeholder={t('tbl.search')} data-testid={`table-search-${dim}`} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} className="min-w-[10rem] flex-1 rounded-md border border-slate-300 bg-transparent px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900" />
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={onlyChanged} onChange={(e) => { setOnlyChanged(e.target.checked); setPage(0); }} />{t('tbl.onlyChanged')}</label>
        <details className="relative text-xs">
          <summary className="cursor-pointer rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-700">{t('tbl.columns')}</summary>
          <div className="absolute right-0 z-10 mt-1 space-y-1 rounded-md border border-slate-200 bg-white p-2 shadow dark:border-slate-700 dark:bg-slate-900">
            {ALL_COLS.map((c) => <label key={c} className="flex items-center gap-2 whitespace-nowrap"><input type="checkbox" checked={cols.includes(c)} onChange={() => toggle(c)} />{t(COL_LABEL[c])}</label>)}
          </div>
        </details>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900">
            <tr>
              <th className={th} aria-sort={sort.col === 'name' ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>{sortBtn('name', t('tbl.name'))}</th>
              {cols.map((c) => <th key={c} className={cn(th, 'text-right')} aria-sort={sort.col === c ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>{sortBtn(c, t(COL_LABEL[c]))}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.key} className="border-t border-slate-100 dark:border-slate-800" data-testid={`row-${dim}`}>
                <td className="max-w-[16rem] truncate px-3 py-2 font-medium" title={r.label}>{r.label}</td>
                {cols.map((c) => <td key={c} className={cn('px-3 py-2 text-right tabular-nums', c === 'change' || c === 'changePct' ? (r.change > 0 ? 'text-emerald-700 dark:text-emerald-400' : r.change < 0 ? 'text-red-700 dark:text-red-400' : '') : '')}>{cell(r, c)}</td>)}
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                  <button className="text-indigo-700 underline dark:text-indigo-300" data-testid={`row-drill-${dim}`} onClick={() => onDrill(r)}>{t('kpi.viewRecords')}</button>
                  {' · '}
                  <button className="text-indigo-700 underline dark:text-indigo-300" onClick={() => onFilter(r.key)}>{t('flt.title')}</button>
                </td>
              </tr>
            ))}
            {slice.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-500" colSpan={cols.length + 2}>{t('tbl.empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <label className="flex items-center gap-2">{t('tbl.rows')}
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} className="rounded-md border border-slate-300 bg-transparent px-1 py-1 dark:border-slate-700 dark:bg-slate-900">{[10, 25, 50, 100].map((n) => <option key={n}>{n}</option>)}</select>
        </label>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={cur === 0} onClick={() => setPage(cur - 1)}>{t('tbl.prev')}</Button>
          <span data-testid={`table-page-${dim}`}>{t('tbl.page', { page: cur + 1, pages })}</span>
          <Button size="sm" variant="outline" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>{t('tbl.next')}</Button>
        </div>
      </div>
    </Card>
  );
}
