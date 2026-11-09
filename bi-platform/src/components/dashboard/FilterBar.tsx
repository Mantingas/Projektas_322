'use client';
import { useState } from 'react';
import { useLang } from '../LangProvider';
import { Button } from '../ui/button';
import type { Dimension, FilterSpec } from '@/engine/analytics/filters';
import type { EntityTable } from '@/engine/analytics/compare';

import { FILTER_FIELD as FIELD, FILTER_LABEL as LABEL } from '@/lib/dimMaps';

/** option sources: every entity seen in the series (both periods), so filters never depend on the current period */
export function FilterBar({ filters, onChange, options, labels }: {
  filters: FilterSpec;
  onChange: (f: FilterSpec) => void;
  options: Partial<Record<Dimension, EntityTable['rows']>>;
  labels: Record<string, string>;
}) {
  const { t } = useLang();
  const dims = (Object.keys(options) as Dimension[]).filter((d) => options[d] && options[d]!.length > 1);
  const active = dims.some((d) => (filters[FIELD[d]] as string[] | undefined)?.length) || Boolean(filters.text);
  return (
    <div className="space-y-3" data-testid="filter-bar">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[12rem] text-xs font-medium text-slate-500">
          {t('flt.search')}
          <input data-testid="filter-text" value={filters.text ?? ''} onChange={(e) => onChange({ ...filters, text: e.target.value })} className="mt-1 block w-full rounded-md border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" />
        </label>
        {dims.map((d) => <EntityPicker key={d} dim={d} options={options[d]!} selected={(filters[FIELD[d]] as string[] | undefined) ?? []} onChange={(v) => onChange({ ...filters, [FIELD[d]]: v })} labels={labels} />)}
        {active && <Button size="sm" variant="ghost" data-testid="filter-reset" onClick={() => onChange({})}>{t('flt.reset')}</Button>}
      </div>
    </div>
  );
}

function EntityPicker({ dim, options, selected, onChange, labels }: { dim: Dimension; options: EntityTable['rows']; selected: string[]; onChange: (v: string[]) => void; labels: Record<string, string> }) {
  const { t } = useLang();
  const [q, setQ] = useState('');
  const listId = `dl-${dim}`;
  const add = (text: string) => {
    const hit = options.find((o) => o.label.toLowerCase() === text.trim().toLowerCase());
    if (hit && !selected.includes(hit.key)) onChange([...selected, hit.key]);
    setQ('');
  };
  return (
    <div className="min-w-[11rem] text-xs font-medium text-slate-500">
      <label>
        {t(LABEL[dim])}
        <input
          list={listId} value={q} placeholder={t('flt.addHint')} data-testid={`filter-${dim}`}
          onChange={(e) => { setQ(e.target.value); if (options.some((o) => o.label === e.target.value)) add(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(q); } }}
          className="mt-1 block w-full rounded-md border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
      </label>
      <datalist id={listId}>{options.slice(0, 300).map((o) => <option key={o.key} value={o.label} />)}</datalist>
      {selected.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {selected.map((k) => (
            <li key={k}>
              <button type="button" aria-label={`${t('flt.remove')} ${labels[`${dim}:${k}`] ?? k}`} onClick={() => onChange(selected.filter((x) => x !== k))} className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800 hover:bg-indigo-200 dark:bg-indigo-950 dark:text-indigo-200">
                {labels[`${dim}:${k}`] ?? k} ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
