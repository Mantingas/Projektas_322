/**
 * Canonical data model shared by every layer of the engine.
 * Nothing in src/engine imports DOM, React or storage code.
 */

export type CellValue = string | number | boolean | null;

/** A sheet exactly as read from the file. Dates are already ISO strings; formulas are cached results only. */
export interface RawSheet {
  name: string;
  rows: CellValue[][];
  /** True when rows were cut at MAX_ROWS. */
  truncated: boolean;
}

export interface ParsedFile {
  fileName: string;
  kind: 'xlsx' | 'csv';
  sheets: RawSheet[];
  /** Detected text encoding (CSV only). */
  encoding?: string;
  /** Detected delimiter (CSV only). */
  delimiter?: string;
}

// ---------- Schema ----------

export type ColumnType = 'date' | 'number' | 'text' | 'empty';

export interface ColumnProfile {
  index: number;
  header: string;
  nonEmpty: number;
  dateRatio: number;
  /** Share of integers in the Excel serial-date range (a date column stored as plain numbers). */
  serialDateRatio: number;
  numberRatio: number;
  textRatio: number;
  distinctRatio: number;
  avgTextLength: number;
  negativeRatio: number;
  /** Currency codes seen in the values (e.g. "EUR" from "12,50 €"). */
  currencyHints: string[];
  type: ColumnType;
  /** Number format inferred from the column as a whole. */
  decimal: ',' | '.';
  dateOrder: 'dmy' | 'mdy' | 'ymd';
  /** Count of numbers whose format could not be determined from the column. */
  ambiguousNumbers: number;
}

export interface TableDetection {
  headerRow: number; // index into RawSheet.rows
  headers: string[];
  dataRows: CellValue[][];
  /** 1-based sheet row number of each entry in dataRows. */
  dataRowNumbers: number[];
  /** 0..1 – how sure we are about the header row. */
  confidence: number;
  skippedTotalRows: number;
}

// ---------- Sales canonical fields ----------

export const SALES_FIELDS = [
  'document_date',
  'document_id',
  'customer_name',
  'customer_id',
  'product_name',
  'product_id',
  'quantity',
  'unit_price',
  'net_amount',
  'gross_amount',
  'amount_unknown_basis',
  'vat_amount',
  'cost_amount',
  'unit_cost',
  'currency',
  'salesperson',
  'product_category',
] as const;
export type SalesField = (typeof SALES_FIELDS)[number];

export type AmountBasis = 'net' | 'gross' | 'unknown';

export interface MappingEntry {
  field: SalesField;
  columnIndex: number;
  /** 0..1 */
  confidence: number;
  source: 'saved' | 'template' | 'heuristic' | 'user';
}

export interface MappingProposal {
  entries: MappingEntry[];
  templateId?: string;
  /** Currency detected in values when there is no currency column. */
  detectedCurrency?: string;
  warnings: MappingWarning[];
}

export type MappingWarning =
  | { code: 'missing_date' }
  | { code: 'missing_amount' }
  | { code: 'amount_basis_unknown' }
  | { code: 'low_confidence'; field: SalesField }
  | { code: 'multiple_amounts' };

export interface ConfirmedMapping {
  /** field → column index */
  columns: Partial<Record<SalesField, number>>;
  /** Used when no currency column is mapped. The user must confirm it. */
  defaultCurrency?: string;
}

// ---------- Records ----------

export interface SalesRecord {
  /** Stable dedupe key: hash of canonical fields + occurrence index within its file. */
  key: string;
  /** ISO date YYYY-MM-DD */
  date: string;
  documentId?: string;
  customerName?: string;
  customerId?: string;
  productName?: string;
  productId?: string;
  quantity?: number;
  /** The revenue amount of this line. Which kind it is is stated in `basis`. */
  amount: number;
  basis: AmountBasis;
  vatAmount?: number;
  /** Total cost of the line, only when the source provides it. Never estimated. */
  cost?: number;
  currency: string;
  salesperson?: string;
  /** 1-based row number in the source sheet. */
  sourceRow: number;
  /** Product category / group, when the file has one. */
  category?: string;
  /** Which import brought this line in (provenance). Set when loaded from the store. */
  importId?: string;
}

export type IssueCode =
  | 'invalid_date'
  | 'date_out_of_range'
  | 'invalid_amount'
  | 'empty_amount'
  | 'total_row'
  | 'negative_amount'
  | 'invalid_quantity'
  | 'invalid_cost'
  | 'unknown_currency'
  | 'ambiguous_number_format'
  | 'missing_customer'
  | 'missing_product';

export interface ImportStats {
  rowsRead: number;
  rowsImported: number;
  rowsSkipped: number;
  errors: Partial<Record<IssueCode, number>>;
  warnings: Partial<Record<IssueCode, number>>;
  /** First few problems: row number + code only (never cell contents). */
  examples: { row: number; code: IssueCode }[];
  dateMin?: string;
  dateMax?: string;
  currencies: string[];
}

/**
 * What the user says the file contains:
 *  full        – a complete snapshot of the covered period (every document is present, with all its lines)
 *  incremental – only transactions that are new or changed since the previous export
 *  partial     – documents may be exported with only some of their lines
 *  unknown     – the user does not know
 */
export type ExportMode = 'full' | 'incremental' | 'partial' | 'unknown';

// ---------- Insights ----------

export type InsightModule = 'sales' | 'purchasing' | 'inventory' | 'debts' | 'universal';
export type Reliability = 'high' | 'medium' | 'low';

export type ParamValue =
  | string
  | number
  | { money: number }
  | { pct: number }
  | { qty: number }
  | { date: string };

export interface EvidenceRow {
  /** Entity key (matches the filter engine) so "View details" can drill into it. */
  key?: string;
  label: string;
  current: number;
  previous?: number;
  /** Unit of the numbers – money in the series currency or plain count */
  unit: 'money' | 'qty' | 'pct';
}

export interface Insight {
  id: string;
  /** Insights on the same topic are collapsed to the best one. */
  topic: string;
  /** Rules telling the same story (e.g. different angles on a decline) share a group; the ranker caps each group. */
  group: string;
  module: InsightModule;
  severity: 'risk' | 'opportunity' | 'info';
  titleKey: string;
  bodyKey: string;
  actionKey: string;
  /** Why the finding matters. Contributors are associations in the data, never proven causes. */
  whyKey: string;
  /** Dimension the evidence rows belong to, and the chart that best shows the finding. */
  dimension?: 'customer' | 'product' | 'salesperson' | 'category';
  chart?: 'trend' | 'comparison' | 'topCustomers' | 'topProducts' | 'salespeople' | 'category' | 'waterfall' | 'pareto';
  params: Record<string, ParamValue>;
  reliability: Reliability;
  reliabilityReasonKey: string;
  /** Absolute money/units/percent behind the finding – used for ranking. */
  impact: { value: number; unit: 'money' | 'qty' | 'pct' };
  actionable: boolean;
  evidence: EvidenceRow[];
  score: number;
}
