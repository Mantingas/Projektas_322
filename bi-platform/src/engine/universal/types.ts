/** Universal spreadsheet analytics: arbitrary tables, typed columns, no business semantics. */
export type UType = 'numeric' | 'percent' | 'currency' | 'date' | 'datetime' | 'category' | 'identifier' | 'boolean' | 'text' | 'empty';

export const UTYPES: UType[] = ['numeric', 'percent', 'currency', 'date', 'datetime', 'category', 'identifier', 'boolean', 'text', 'empty'];
export const NUMERIC_TYPES: UType[] = ['numeric', 'percent', 'currency'];
export const DATE_TYPES: UType[] = ['date', 'datetime'];

export interface UColumn {
  index: number;
  header: string;
  /** the type that is used (confirmed by the user when the suggestion was ambiguous) */
  type: UType;
  suggested: UType;
  /** 0..1 */
  confidence: number;
  /** The user must confirm this column's type before analysis. */
  ambiguous: boolean;
  alternatives: UType[];
  /** i18n key suffix explaining the suggestion (`utype.why.<reason>`) */
  reason: string;
  currency?: string;
  nonEmpty: number;
  missing: number;
  /** values that are present but do not fit the chosen type */
  invalid: number;
  distinct: number;
  samples: string[];
}

export type UCell = number | string | null;

/** Typed, columnar copy of the table: numbers for numeric / percent / currency / boolean (1/0), ISO strings for dates, text otherwise. */
export interface UDataset {
  id: string;
  fileName: string;
  sheetName: string;
  importedAt: number;
  rowCount: number;
  columns: UColumn[];
  cols: UCell[][];
  /** 1-based sheet row of each data row */
  rowNumbers: number[];
}

export interface UFilter {
  col: number;
  /** category / identifier / boolean values to keep */
  values?: string[];
  /** numeric range */
  min?: number;
  max?: number;
}

export interface UConfig {
  dateCol?: number;
  measures?: number[];
  dims?: number[];
  /** aggregation per measure; default: sum for numeric and currency, mean for percent */
  agg?: Record<number, 'sum' | 'mean'>;
  filters?: UFilter[];
  range?: { from?: string; to?: string };
}
