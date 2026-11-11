import { addDays, addMonths, addYears, daysBetween, lengthDays, max, min, monthEnd, monthStart, weekStart } from './dates';

const yearStart = (iso: string) => iso.slice(0, 4) + '-01-01';

/** Presets that make sense for this data. Year-to-date needs the data to reach back to 1 January of the latest year. */
export function availablePresets(data: { dateMin: string; dateMax: string }): PeriodPreset[] {
  const all: PeriodPreset[] = ['r30', 'mom', 'wow', 'dod', 'ytd', 'yoy', 'r7', 'r90', 'custom'];
  return all.filter((p) => p !== 'ytd' || data.dateMin <= yearStart(data.dateMax));
}

export type PeriodPreset = 'dod' | 'wow' | 'mom' | 'yoy' | 'ytd' | 'r7' | 'r30' | 'r90' | 'custom';
export interface Range {
  from: string;
  to: string;
}
export type PeriodWarning =
  | { code: 'partial_current'; elapsed: number; total: number } // calendar period not finished in the data
  | { code: 'previous_capped'; days: number } // like-for-like previous shorter than the calendar period
  | { code: 'previous_full_vs_partial'; elapsed: number; total: number } // user chose "full previous" while current is partial
  | { code: 'history_starts_late'; dataFrom: string } // previous starts before the first date in the data
  | { code: 'ytd_coverage'; dataFrom: string } // year-to-date requested but the data does not reach back to 1 January
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

/** Completeness of the CURRENT period, shown as an explicit indicator next to every comparison. */
export type PeriodStatus =
  | { kind: 'complete'; days: number }
  | { kind: 'partial'; elapsed: number; total: number }
  | { kind: 'to_date'; elapsed: number; total: number };

export interface ResolvedPeriods {
  preset: PeriodPreset;
  status: PeriodStatus;
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
  let status: PeriodStatus | undefined;

  const rolling = (n: number) => {
    current = { from: addDays(anchor, -(n - 1)), to: anchor };
    previous = { from: addDays(current.from, -n), to: addDays(current.from, -1) };
  };

  if (sel.preset === 'custom' && sel.custom) {
    current = sel.custom.current;
    previous = sel.custom.previous;
  } else if (sel.preset === 'ytd') {
    const ys = yearStart(anchor);
    current = { from: ys, to: anchor };
    // same number of elapsed days as the current year-to-date (a leap year would otherwise differ by one day)
    const pf = addYears(ys, -1);
    previous = { from: pf, to: addDays(pf, lengthDays(ys, anchor) - 1) };
    status = { kind: 'to_date', elapsed: lengthDays(ys, anchor), total: lengthDays(ys, anchor.slice(0, 4) + '-12-31') };
    if (data.dateMin > ys) warnings.push({ code: 'ytd_coverage', dataFrom: data.dateMin });
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
    status = partial ? { kind: 'partial', elapsed, total } : { kind: 'complete', days: elapsed };
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
  status = status ?? { kind: 'complete', days: currentDays };
  if (!equivalent && !warnings.some((w) => w.code === 'previous_full_vs_partial')) warnings.push({ code: 'length_mismatch', current: currentDays, previous: previousDays });

  if (previous.from < data.dateMin) warnings.push({ code: 'history_starts_late', dataFrom: data.dateMin });
  if (previous.to < data.dateMin || previous.from > data.dateMax) warnings.push({ code: 'no_previous_data' });
  if (current.to < data.dateMin || current.from > data.dateMax) warnings.push({ code: 'no_current_data' });
  for (const [which, r, days] of [['current', current, currentDays], ['previous', previous, previousDays]] as const) {
    const withData = countDaysWithData({ from: max(r.from, data.dateMin), to: min(r.to, data.dateMax) }, data.dates);
    const span = lengthDays(max(r.from, data.dateMin) <= min(r.to, data.dateMax) ? max(r.from, data.dateMin) : r.from, max(r.from, data.dateMin) <= min(r.to, data.dateMax) ? min(r.to, data.dateMax) : r.from);
    if (withData !== undefined && days >= 14 && span >= 14 && withData / span < 0.5 && withData > 0) warnings.push({ code: 'sparse_data', which, daysWithData: withData, days: span });
  }
  return { preset: sel.preset, status, current, previous, currentDays, previousDays, equivalent, warnings };
}

/** True when the comparison cannot support a trustworthy change figure. */
export const isComparisonBlocked = (p: ResolvedPeriods) => p.warnings.some((w) => w.code === 'no_previous_data' || w.code === 'no_current_data');
export const isComparisonCaveated = (p: ResolvedPeriods) => p.warnings.length > 0;

/**
 * Is the PREVIOUS window only partly covered by the loaded data? Judged from the data's first date against the window – NOT from how many
 * days happen to have transactions (a quiet business has many empty days). A few leading days without data are tolerated
 * (max(3 days, 10 % of the window)); more than that and a "change" would compare a full period with a partial one.
 */
export function previousIncomplete(p: ResolvedPeriods, dataMin: string): { missingDays: number; previousFrom: string; dataFrom: string } | null {
  if (p.previous.from >= dataMin) return null;
  if (p.previous.to < dataMin) return null; // no previous data at all: already blocked as `no_previous_data`
  const missingDays = daysBetween(p.previous.from, dataMin);
  return missingDays > Math.max(3, Math.ceil(0.1 * p.previousDays)) ? { missingDays, previousFrom: p.previous.from, dataFrom: dataMin } : null;
}
