import { addDays, addMonths, addYears, lengthDays, max, min, monthEnd, monthStart, weekStart } from './dates';

export type PeriodPreset = 'dod' | 'wow' | 'mom' | 'yoy' | 'r7' | 'r30' | 'r90' | 'custom';
export interface Range {
  from: string;
  to: string;
}
export type PeriodWarning =
  | { code: 'partial_current'; elapsed: number; total: number } // calendar period not finished in the data
  | { code: 'previous_capped'; days: number } // like-for-like previous shorter than the calendar period
  | { code: 'previous_full_vs_partial'; elapsed: number; total: number } // user chose "full previous" while current is partial
  | { code: 'history_starts_late'; dataFrom: string } // previous starts before the first date in the data
  | { code: 'no_previous_data' }
  | { code: 'no_current_data' }
  | { code: 'length_mismatch'; current: number; previous: number }
  | { code: 'sparse_data'; which: 'current' | 'previous'; daysWithData: number; days: number };

export interface PeriodSelection {
  preset: PeriodPreset;
  /** For calendar presets: compare against the whole previous period instead of the same elapsed days (adds a warning). */
  fullPrevious?: boolean;
  custom?: { current: Range; previous: Range };
}

export interface ResolvedPeriods {
  preset: PeriodPreset;
  current: Range;
  previous: Range;
  currentDays: number;
  previousDays: number;
  /** True when both ranges have the same number of days. */
  equivalent: boolean;
  warnings: PeriodWarning[];
}

export interface DataBounds {
  dateMin: string;
  dateMax: string;
  /** Distinct dates that have at least one record. */
  dates?: ReadonlySet<string>;
}

const countDaysWithData = (r: Range, dates?: ReadonlySet<string>) => {
  if (!dates) return undefined;
  let n = 0;
  for (const d of dates) if (d >= r.from && d <= r.to) n++;
  return n;
};

/**
 * Resolves a comparison. Anchored to the LAST DATE IN THE DATA (not today): exports are often old.
 * Default is like-for-like: equal length. A partial current calendar period is compared with the same number of elapsed days
 * of the previous period and flagged; comparing it with the whole previous period requires `fullPrevious` and always warns.
 */
export function resolvePeriods(sel: PeriodSelection, data: DataBounds): ResolvedPeriods {
  const anchor = data.dateMax;
  const warnings: PeriodWarning[] = [];
  let current: Range;
  let previous: Range;

  const rolling = (n: number) => {
    current = { from: addDays(anchor, -(n - 1)), to: anchor };
    previous = { from: addDays(current.from, -n), to: addDays(current.from, -1) };
  };

  if (sel.preset === 'custom' && sel.custom) {
    current = sel.custom.current;
    previous = sel.custom.previous;
  } else if (sel.preset === 'dod') {
    current = { from: anchor, to: anchor };
    previous = { from: addDays(anchor, -1), to: addDays(anchor, -1) };
  } else if (sel.preset === 'r7') rolling(7);
  else if (sel.preset === 'r30') rolling(30);
  else if (sel.preset === 'r90') rolling(90);
  else {
    // calendar-based: wow (ISO week), mom (month), yoy (same month last year)
    let calFrom: string;
    let calTo: string;
    let prevFrom: string;
    let prevTo: string;
    if (sel.preset === 'wow') {
      calFrom = weekStart(anchor);
      calTo = addDays(calFrom, 6);
      prevFrom = addDays(calFrom, -7);
      prevTo = addDays(calFrom, -1);
    } else if (sel.preset === 'mom') {
      calFrom = monthStart(anchor);
      calTo = monthEnd(anchor);
      prevFrom = addMonths(calFrom, -1);
      prevTo = monthEnd(prevFrom);
    } else {
      calFrom = monthStart(anchor);
      calTo = monthEnd(anchor);
      prevFrom = addYears(calFrom, -1);
      prevTo = monthEnd(prevFrom);
    }
    const total = lengthDays(calFrom, calTo);
    current = { from: calFrom, to: min(calTo, anchor) };
    const elapsed = lengthDays(current.from, current.to);
    const partial = elapsed < total;
    if (partial) warnings.push({ code: 'partial_current', elapsed, total });
    if (partial && sel.fullPrevious) {
      previous = { from: prevFrom, to: prevTo };
      warnings.push({ code: 'previous_full_vs_partial', elapsed, total });
    } else {
      const prevTotal = lengthDays(prevFrom, prevTo);
      const days = Math.min(elapsed, prevTotal);
      previous = { from: prevFrom, to: addDays(prevFrom, days - 1) };
      if (days < elapsed) warnings.push({ code: 'previous_capped', days });
    }
  }
  current = current!;
  previous = previous!;
  const currentDays = lengthDays(current.from, current.to);
  const previousDays = lengthDays(previous.from, previous.to);
  const equivalent = currentDays === previousDays;
  if (!equivalent && !warnings.some((w) => w.code === 'previous_full_vs_partial')) warnings.push({ code: 'length_mismatch', current: currentDays, previous: previousDays });

  if (previous.from < data.dateMin) warnings.push({ code: 'history_starts_late', dataFrom: data.dateMin });
  if (previous.to < data.dateMin || previous.from > data.dateMax) warnings.push({ code: 'no_previous_data' });
  if (current.to < data.dateMin || current.from > data.dateMax) warnings.push({ code: 'no_current_data' });
  for (const [which, r, days] of [['current', current, currentDays], ['previous', previous, previousDays]] as const) {
    const withData = countDaysWithData({ from: max(r.from, data.dateMin), to: min(r.to, data.dateMax) }, data.dates);
    const span = lengthDays(max(r.from, data.dateMin) <= min(r.to, data.dateMax) ? max(r.from, data.dateMin) : r.from, max(r.from, data.dateMin) <= min(r.to, data.dateMax) ? min(r.to, data.dateMax) : r.from);
    if (withData !== undefined && days >= 14 && span >= 14 && withData / span < 0.5 && withData > 0) warnings.push({ code: 'sparse_data', which, daysWithData: withData, days: span });
  }
  return { preset: sel.preset, current, previous, currentDays, previousDays, equivalent, warnings };
}

/** True when the comparison cannot support a trustworthy change figure. */
export const isComparisonBlocked = (p: ResolvedPeriods) => p.warnings.some((w) => w.code === 'no_previous_data' || w.code === 'no_current_data');
export const isComparisonCaveated = (p: ResolvedPeriods) => p.warnings.length > 0;
