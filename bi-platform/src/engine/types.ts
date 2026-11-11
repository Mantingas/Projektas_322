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
  /** A date column whose day/month order cannot be known from its values (every value could be read both ways). */
  dateOrderGuess?: boolean;
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
  /** Credit notes / returns are recognised from this column (the sign of the amount alone is not trusted). */
  'document_type',
  /** Unit of measure of `quantity`; without it quantities of different products cannot be added safely. */
  'unit',
] as const;
export type SalesField = (typeof SALES_FIELDS)[number];

export const PURCHASE_FIELDS = [
  'document_date',
  'document_id',
  'supplier_name',
  'supplier_id',
  'product_name',
  'product_id',
  'quantity',
  'unit',
  'unit_price',
  'discount_amount',
  'net_amount',
  'gross_amount',
  'amount_unknown_basis',
  'vat_amount',
  'currency',
  'warehouse',
  'document_type',
] as const;
export type PurchaseField = (typeof PURCHASE_FIELDS)[number];

export const INVENTORY_FIELDS = [
  'snapshot_date',
  'movement_date',
  'document_id',
  'product_id',
  'product_name',
  'product_category',
  'warehouse',
  'warehouse_to',
  'quantity',
  'unit',
  'unit_cost',
  'stock_value',
  'movement_type',
  'currency',
  'min_stock',
] as const;
export type InventoryField = (typeof INVENTORY_FIELDS)[number];

export const FINANCE_FIELDS = [
  'document_date',
  'snapshot_date',
  'due_date',
  'payment_date',
  'document_id',
  'counterparty_id',
  'counterparty_name',
  'original_amount',
  'outstanding_amount',
  'paid_amount',
  'currency',
  'document_type',
  'credit_reference',
  'invoice_reference',
  'payment_reference',
  'aging_current',
  'aging_1_30',
  'aging_31_60',
  'aging_61_90',
  'aging_90_plus',
] as const;
export type FinanceField = (typeof FINANCE_FIELDS)[number];

/** Any semantic field of any module. */
export type FieldId = SalesField | PurchaseField | InventoryField | FinanceField;
export type ModuleId = 'sales' | 'purchasing' | 'inventory' | 'finance';

export type AmountBasis = 'net' | 'gross' | 'unknown';

export interface MappingEntry {
  field: FieldId;
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
  | { code: 'missing_supplier' }
  | { code: 'missing_product' }
  | { code: 'missing_quantity' }
  | { code: 'missing_counterparty' }
  | { code: 'low_confidence'; field: FieldId }
  | { code: 'multiple_amounts' };

export interface ConfirmedMapping {
  /** field → column index */
  columns: Partial<Record<FieldId, number>>;
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
  /** Canonical unit code of `quantity` (e.g. kg, g, l, pcs, box) when the file states one. Never converted at import. */
  unit?: string;
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

/** One purchase-document line, normalised. Amounts are never converted between currencies, VAT bases or units. */
export interface PurchaseRecord {
  key: string;
  /** ISO date YYYY-MM-DD */
  date: string;
  documentId?: string;
  supplierName?: string;
  supplierId?: string;
  productName?: string;
  /** Product code / SKU – the only verified product identifier. */
  productId?: string;
  quantity?: number;
  /** Canonical unit code (kg, g, l, pcs, box …) as normalised from the file; undefined = not provided. */
  unit?: string;
  /** Listed unit price from the file, when mapped (kept as given; may include or exclude discounts). */
  unitPrice?: number;
  /** Discount / rebate on the line, when mapped. */
  discount?: number;
  /** Line amount: negative for credit notes and returns. */
  amount: number;
  basis: AmountBasis;
  vatAmount?: number;
  currency: string;
  warehouse?: string;
  /** True when a document-type column said "credit note / return" and the sign was normalised to negative. */
  creditByType?: boolean;
  sourceRow: number;
  importId?: string;
}

/** What a stock movement is. Transfers, adjustments and opening balances are never demand, purchases or sales. */
export type MovementType = 'receipt' | 'issue' | 'transfer' | 'return' | 'adjustment' | 'opening' | 'unknown';

/**
 * One inventory line. `snapshot` = stock on hand at `date` (balance, valuation or history report row);
 * `movement` = a stock change on `date`. Values are never converted between currencies or units.
 */
export interface InventoryRecord {
  key: string;
  kind: 'snapshot' | 'movement';
  /** ISO date: the snapshot (as-of) date or the movement date. */
  date: string;
  /** Movements: the document number. Snapshots: a synthetic id "snap <date> <warehouse>" – a snapshot is the document that a re-import can duplicate or contradict. */
  documentId?: string;
  productName?: string;
  /** Product code / SKU – the only verified product identifier. */
  productId?: string;
  category?: string;
  warehouse?: string;
  /** Transfers exported as ONE line: the receiving warehouse (the line's quantity leaves `warehouse`). */
  warehouseTo?: string;
  /** Snapshot: quantity on hand (may be negative = inconsistent). Movement: SIGNED change of stock in `warehouse` (+ in, − out). */
  quantity?: number;
  /** Canonical unit code (kg, g, l, pcs, box …); undefined = not provided. */
  unit?: string;
  unitCost?: number;
  /** Snapshot: stock value as stated. Movement: value of the movement, signed like the quantity. */
  value?: number;
  minStock?: number;
  movementType?: MovementType;
  /** Constant 'net': valuation at cost has no VAT basis. Kept so the shared series machinery works unchanged. */
  basis: AmountBasis;
  currency: string;
  sourceRow: number;
  importId?: string;
}

/** Receivables (customers owe us) or payables (we owe suppliers). The user states which one a file is. */
export type FinanceSide = 'receivable' | 'payable';
/**
 * What one finance line IS – never mixed:
 *  open_item  – an invoice still open in a ledger report AT a date (snapshot line)
 *  aging      – a counterparty's balance split into aging buckets AT a date (summary line)
 *  balance    – a counterparty's balance AT a date (summary line)
 *  invoice    – an invoice issued (flow)      payment – a payment made / received (flow)      credit_note – a credit note issued (flow)
 */
export type FinanceKind = 'open_item' | 'aging' | 'balance' | 'invoice' | 'payment' | 'credit_note';

export interface AgingBuckets {
  /** not yet due */
  nd: number;
  d30: number;
  d60: number;
  d90: number;
  d90p: number;
}

export interface FinanceRecord {
  key: string;
  kind: FinanceKind;
  side: FinanceSide;
  /** Snapshot kinds: the as-of date. Flows: the invoice / payment / credit-note date. */
  date: string;
  /** Identity for merging: snapshot kinds get "<kind> <side> <date>"; flows carry the real document / payment number. */
  documentId?: string;
  /** Open items: the invoice number. */
  invoiceNo?: string;
  /** Payments: the invoice paid. Credit notes: the invoice credited. */
  reference?: string;
  counterpartyId?: string;
  counterpartyName?: string;
  invoiceDate?: string;
  dueDate?: string;
  /** Original / invoiced / credited amount (magnitude); payments: the amount paid (negative = reversal). NEVER an outstanding balance. */
  amount?: number;
  /** Open items, balances, aging totals: what is still owed AT `date` (negative = credit balance / overpayment). */
  outstanding?: number;
  /** Open items: paid so far, when the report states it. */
  paid?: number;
  buckets?: AgingBuckets;
  /** Merge scope (see docKey): document numbers are only comparable within it. */
  scope?: string;
  /** The amount exactly as the file states it (signed). `amount` of invoices / credit notes is a magnitude; this keeps the original sign so reversals can be recognised. */
  rawAmount?: number;
  /** Why a register row became a credit note: the file says so (`register` = credit-note register, `type` = a document-type column) or ONLY its negative sign suggests it (`sign` – an assumption). */
  creditEvidence?: 'register' | 'type' | 'sign';
  basis: AmountBasis;
  currency: string;
  sourceRow: number;
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
  | 'missing_product'
  | 'missing_supplier'
  | 'missing_unit'
  | 'unknown_unit'
  | 'invalid_unit_price'
  | 'invalid_discount'
  | 'credit_sign_normalised'
  | 'discount_deducted'
  | 'price_mismatch'
  | 'empty_quantity'
  | 'invalid_stock_value'
  | 'invalid_min_stock'
  | 'missing_warehouse'
  | 'unknown_movement_type'
  | 'movement_sign_normalised'
  | 'return_direction_by_sign'
  | 'value_mismatch'
  | 'negative_stock'
  | 'missing_cost'
  | 'date_from_as_of'
  | 'missing_counterparty'
  | 'missing_due_date'
  | 'invalid_due_date'
  | 'invalid_payment_date'
  | 'missing_invoice_number'
  | 'outstanding_derived'
  | 'negative_outstanding'
  | 'duplicate_invoice_number'
  | 'payment_without_reference'
  | 'negative_assumed_credit'
  | 'vat_inconsistent'
  | 'aging_total_mismatch'
  | 'missing_outstanding'
  | 'credit_sign_ambiguous'
  | 'quantity_sign_normalised'
  | 'quantity_sign_ambiguous'
  | 'cost_suspect'
  | 'cost_zero';

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
  /** Sales: total (absolute) amount of the credit-note rows that were NOT imported because their sign was ambiguous (see `credit_sign_ambiguous`). */
  ambiguousCreditAmount?: number;
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

export type InsightModule = 'sales' | 'purchasing' | 'inventory' | 'debts' | 'universal' | 'cross';
export type Reliability = 'high' | 'medium' | 'low';

export type ParamValue =
  | string
  | number
  | { money: number }
  | { price: number }
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
  unit: 'money' | 'qty' | 'pct' | 'price';
}

/** What a cross-module finding must tell the reader: where the numbers come from, which confirmed links joined them, how they were calculated and what limits them. */
export interface CrossDisclosure {
  sources: { module: 'sales' | 'purchasing' | 'inventory' | 'finance'; currency?: string; from: string; to: string; lines: number; note?: string }[];
  links: { id: string; kind: 'product' | 'counterparty'; a: string; b: string; basis: 'identifier_equal' | 'user_confirmed' }[];
  period: { from: string; to: string };
  /** i18n key of the calculation description */
  methodKey: string;
  /** i18n keys of the limitations that apply */
  limits: string[];
  confidenceKey: string;
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
  dimension?: 'customer' | 'product' | 'salesperson' | 'category' | 'supplier' | 'warehouse';
  chart?: 'aging' | 'overdueTrend' | 'dueTimeline' | 'behaviour' | 'creditReview' | 'duplicates' | 'overdueRank' | 'stockTrend' | 'warehouseComparison' | 'slowMoving' | 'stockoutRisk' | 'movementTrend' | 'abc' | 'trend' | 'comparison' | 'topCustomers' | 'topProducts' | 'salespeople' | 'category' | 'waterfall' | 'pareto' | 'topSuppliers' | 'priceTrend' | 'priceVariance' | 'spendBridge' | 'quantityComparison';
  /** Finance: a confirmed fact in the data, a possible match that needs checking, or a risk indicator. Never mixed. */
  certainty?: 'fact' | 'possible' | 'indicator';
  /** Cross-module findings only: sources, confirmed links, period, method and limits. */
  cross?: CrossDisclosure;
  /** Purchasing: what kind of saving (if any) the finding describes. Never mixed: actual ≠ potential ≠ hypothetical. */
  savings?: { kind: 'actual' | 'potential' | 'hypothetical'; amount: number };
  params: Record<string, ParamValue>;
  reliability: Reliability;
  reliabilityReasonKey: string;
  /** Absolute money/units/percent behind the finding – used for ranking. */
  impact: { value: number; unit: 'money' | 'qty' | 'pct' };
  actionable: boolean;
  evidence: EvidenceRow[];
  score: number;
}
