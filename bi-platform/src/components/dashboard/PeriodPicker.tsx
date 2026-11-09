'use client';
import { useLang } from '../LangProvider';
import type { PeriodPreset, PeriodSelection, ResolvedPeriods } from '@/engine/analytics/periods';
import { addDays } from '@/engine/analytics/dates';
import { dateRange, warningText } from '@/lib/dashFormat';
import type { MessageKey } from '@/i18n';

const PRESETS: PeriodPreset[] = ['r30', 'mom', 'wow', 'dod', 'yoy', 'r7', 'r90', 'custom'];

export function PeriodPicker({ value, onChange, resolved, dateMax }: { value: PeriodSelection; onChange: (v: PeriodSelection) => void; resolved: ResolvedPeriods; dateMax: string }) {
  const { t, lang } = useLang();
  const hasPartial = resolved.warnings.some((w) => w.code === 'partial_current' || w.code === 'previous_full_vs_partial');
  const custom = value.custom ?? { current: resolved.current, previous: resolved.previous };
  const setCustom = (k: 'current' | 'previous', f: 'from' | 'to', v: string) => onChange({ ...value, preset: 'custom', custom: { ...custom, [k]: { ...custom[k], [f]: v } } });
  const input = 'rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900';
  return (
    <div className="space-y-3" data-testid="period-picker">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          {t('per.label')}
          <select data-testid="period-preset" value={value.preset} onChange={(e) => onChange({ preset: e.target.value as PeriodPreset, custom: e.target.value === 'custom' ? { current: resolved.current, previous: resolved.previous } : undefined })} className={input}>
            {PRESETS.map((p) => <option key={p} value={p}>{t(`per.${p}` as MessageKey)}</option>)}
          </select>
        </label>
        {(hasPartial || value.fullPrevious) && ['mom', 'wow', 'yoy'].includes(value.preset) && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" data-testid="full-previous" checked={Boolean(value.fullPrevious)} onChange={(e) => onChange({ ...value, fullPrevious: e.target.checked })} />
            {t('per.fullPrevious')}
          </label>
        )}
      </div>
      {value.preset === 'custom' && (
        <div className="grid gap-2 sm:grid-cols-2">
          {(['current', 'previous'] as const).map((k) => (
            <fieldset key={k} className="flex flex-wrap items-center gap-2 text-sm">
              <legend className="mb-1 text-xs font-medium text-slate-500">{t(`per.${k}` as MessageKey)}</legend>
              <input aria-label={`${t(`per.${k}` as MessageKey)} ${t('per.from')}`} type="date" className={input} value={custom[k].from} max={custom[k].to} onChange={(e) => setCustom(k, 'from', e.target.value)} />
              <span>–</span>
              <input aria-label={`${t(`per.${k}` as MessageKey)} ${t('per.to')}`} type="date" className={input} value={custom[k].to} min={custom[k].from} max={addDays(dateMax, 366)} onChange={(e) => setCustom(k, 'to', e.target.value)} />
            </fieldset>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-600 dark:text-slate-400" data-testid="period-describe">
        {t('per.describe', { cfrom: dateRange(resolved.current.from, resolved.current.from, lang), cto: dateRange(resolved.current.to, resolved.current.to, lang), cdays: resolved.currentDays, pfrom: dateRange(resolved.previous.from, resolved.previous.from, lang), pto: dateRange(resolved.previous.to, resolved.previous.to, lang), pdays: resolved.previousDays })}
        {' · '}{t('per.anchor', { date: dateRange(dateMax, dateMax, lang) })}
      </p>
      {resolved.warnings.length > 0 && (
        <ul className="space-y-1" data-testid="period-warnings">
          {resolved.warnings.map((w, i) => (
            <li key={i} className={`rounded-md px-3 py-2 text-xs ${w.code === 'previous_full_vs_partial' || w.code === 'no_previous_data' ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'}`}>⚠ {warningText(w, t)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
