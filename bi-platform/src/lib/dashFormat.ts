import type { MetricComparison } from '@/engine/analytics/compare';
import type { MetricUnit } from '@/engine/analytics/metrics';
import type { PeriodWarning } from '@/engine/analytics/periods';
import type { Limitation } from '@/engine/analytics/dashboard';
import type { PurchaseLimitation } from '@/engine/purchasing/dashboard';
import type { InventoryLimitation } from '@/engine/inventory/dashboard';
import type { AmountBasis, ParamValue } from '@/engine/types';
import { fmtDate, money, num, pct, type Lang, type MessageKey } from '@/i18n';

export type T = (key: MessageKey, params?: Record<string, ParamValue>) => string;

export function fmtUnit(unit: MetricUnit, v: number, lang: Lang, currency: string): string {
  return unit === 'money' ? money(v, { lang, currency }) : unit === 'pct' ? pct(v, lang) : num(v, lang);
}

export const metricLabel = (id: string, basis: AmountBasis, t: T): string => t((id === 'sales' || id === 'p_spend' ? `metric.${id}.${basis}` : `metric.${id}`) as MessageKey);

export function changeText(c: MetricComparison, lang: Lang, currency: string, t: T): { text: string; tone: 'good' | 'bad' | 'flat' | 'na'; arrow: string } {
  if (c.status === 'blocked') return { text: t('kpi.blocked'), tone: 'na', arrow: '–' };
  if (c.status === 'no_previous_value') return { text: t('kpi.noPrev'), tone: 'na', arrow: '–' };
  if (c.abs === null) return { text: '–', tone: 'na', arrow: '–' };
  const sign = c.abs > 0 ? '+' : c.abs < 0 ? '−' : '';
  const absTxt = c.unit === 'pct' ? `${sign}${num(Math.abs(c.abs) * 100, lang)} ${t('kpi.pp')}` : `${sign}${fmtUnit(c.unit, Math.abs(c.abs), lang, currency)}`;
  const pctTxt = c.pct !== null ? ` (${sign}${pct(Math.abs(c.pct), lang)})` : c.status === 'zero_base' ? ` (${t('kpi.zeroBase')})` : '';
  const tone = c.good === null ? 'flat' : c.good ? 'good' : 'bad';
  return { text: absTxt + pctTxt, tone, arrow: c.direction === 'up' ? '▲' : c.direction === 'down' ? '▼' : '■' };
}

export function warningText(w: PeriodWarning, t: T): string {
  switch (w.code) {
    case 'partial_current': return t('pw.partial_current', { elapsed: w.elapsed, total: w.total });
    case 'previous_capped': return t('pw.previous_capped', { days: w.days });
    case 'previous_full_vs_partial': return t('pw.previous_full_vs_partial', { elapsed: w.elapsed, total: w.total });
    case 'history_starts_late': return t('pw.history_starts_late', { dataFrom: w.dataFrom });
    case 'ytd_coverage': return t('pw.ytd_coverage', { dataFrom: w.dataFrom });
    case 'no_previous_data': return t('pw.no_previous_data');
    case 'no_current_data': return t('pw.no_current_data');
    case 'length_mismatch': return t('pw.length_mismatch', { current: w.current, previous: w.previous });
    case 'sparse_data': return t('pw.sparse_data', { daysWithData: w.daysWithData, days: w.days, which: t(`pw.which.${w.which}` as MessageKey) });
  }
}

export function limitationText(l: Limitation | PurchaseLimitation | InventoryLimitation, t: T): string {
  const { code, ...params } = l as { code: string } & Record<string, ParamValue>;
  if (typeof params.pct === 'number') params.pct = { pct: params.pct };
  return t(`lim.${code}` as MessageKey, Object.keys(params).length ? params : undefined);
}

export const dateRange = (from: string, to: string, lang: Lang) => (from === to ? fmtDate(from, lang) : `${fmtDate(from, lang)} – ${fmtDate(to, lang)}`);
