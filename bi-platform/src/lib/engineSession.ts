import type { ColumnProfile, ExportMode, FieldId, FinanceRecord, FinanceSide, ImportStats, InventoryRecord, MappingEntry, ModuleId, ParsedFile, PurchaseRecord, SalesRecord } from '@/engine/types';
import { parseFile, ParseError } from '@/engine/parsing/parseFile';
import { analyzeSheet, confirmedFromEntries, type SheetAnalysis } from '@/engine/pipeline';
import { normalizeSales, MappingError } from '@/engine/validation/normalize';
import { sha256Hex } from '@/engine/import/hash';
import { buildDiagnostics, type ImportDiagnostics } from '@/engine/import/diagnostics';
import type { ImportPolicy } from '@/engine/import/merge';
import { detectModule, detectSide, mappingToSaved } from '@/engine/mapping/mapper';
import { normalizePurchases } from '@/engine/validation/normalizePurchases';
import { buildPurchasingDashboard, type PurchasingOptions, type PurchasingView } from '@/engine/purchasing/dashboard';
import { analyzePurchasingPeriod, type PurchasingAnalysis } from '@/engine/purchasing/insights';
import { drillPurchaseRecords } from '@/engine/purchasing/drill';
import { applyPurchaseFilters } from '@/engine/purchasing/entities';
import { groupPurchaseAggregates } from '@/engine/purchasing/aggregate';
import { predictPurchaseMetrics } from '@/engine/purchasing/metrics';
import { normalizeInventory } from '@/engine/validation/normalizeInventory';
import { buildInventoryDashboard, type InventoryView } from '@/engine/inventory/dashboard';
import { analyzeInventoryPeriod, type InventoryAnalysis } from '@/engine/inventory/insights';
import { drillInventoryRecords, inventoryLineAmount } from '@/engine/inventory/drill';
import { predictInventoryMetrics } from '@/engine/inventory/metrics';
import { groupInventoryOptions } from '@/engine/inventory/options';
import { normalizeFinance } from '@/engine/validation/normalizeFinance';
import { buildFinanceDashboard, type FinanceView } from '@/engine/finance/dashboard';
import { analyzeFinancePeriod, type FinanceAnalysis } from '@/engine/finance/insights';
import { drillFinanceRecords } from '@/engine/finance/drill';
import { predictFinanceMetrics } from '@/engine/finance/metrics';
import { cpKey, cpLabel } from '@/engine/finance/keys';
import { daysPastDue } from '@/engine/finance/ledger';
import { priceTrend, toPriceLines } from '@/engine/purchasing/prices';
import type { PeriodSelection as PeriodSel } from '@/engine/analytics/periods';
import type { UnitPolicy } from '@/engine/purchasing/units';
import { analyzeSales, type SalesAnalysis } from '@/engine/insights/engine';
import { buildDashboardWithInsights, type DashboardOptions, type DashboardView } from '@/engine/analytics/dashboard';
import { availablePresets, type PeriodPreset } from '@/engine/analytics/periods';
import { dimensionOf, type Dimension, type SalesDimension, type PurchaseDimension, type FilterSpec } from '@/engine/analytics/filters';
import { groupAggregates } from '@/engine/analytics/aggregate';
import { drillRecords, sourcesOf, type DrillSpec, type SourceSummary } from '@/engine/analytics/provenance';
import { csvCell } from '@/engine/report/export';
import { listSeries, type Series } from '@/engine/sales/kpi';
import { getDb, type AppDB, type ImportRow } from '@/db/db';
import { commitImport, getSavedMapping, loadAllFinance, loadAllInventory, loadAllPurchases, loadAllSales, pendingHeldCount, previewImport, saveMapping, type CommitResult, type MergePreview } from '@/db/store';
import { purchaseDimensionOf } from '@/engine/purchasing/entities';

// ───────── message shapes (plain data only: they cross the worker boundary) ─────────
export interface ParseResult {
  fileName: string;
  kind: 'xlsx' | 'csv';
  encoding?: string;
  delimiter?: string;
  checksum: string;
  sheets: { name: string; rows: number; columns: number; truncated: boolean; hasTable: boolean }[];
  duplicateOf?: { id: string; importedAt: number; fileName: string };
}

export interface AnalysisLite {
  sheetIdx: number;
  headers: string[];
  profiles: ColumnProfile[];
  proposal: SheetAnalysis['proposal'];
  signature: string;
  headerRow: number;
  headerConfidence: number;
  skippedTotalRows: number;
  rowCount: number;
  truncated: boolean;
  /** up to 3 short sample values per column, for the mapping table */
  samples: string[][];
  /** first rows as short strings, for the preview table */
  previewRows: string[][];
  usedSaved: boolean;
  savedCurrency?: string;
  structure: ImportDiagnostics['structure'];
  /** Which module this analysis was done for, and what the headers suggest. */
  module: ModuleId;
  detected: { module: ModuleId; purchasing: number; sales: number; inventory: number; finance: number; side: FinanceSide | null };
}

export interface ImportRequest {
  sheetIdx: number;
  module?: ModuleId;
  /** Inventory / finance: the snapshot date to use when the file has no date column. */
  asOfDate?: string;
  /** Finance: receivables or payables. */
  side?: FinanceSide;
  entries: Pick<MappingEntry, 'field' | 'columnIndex' | 'confidence' | 'source'>[];
  currency?: string;
  mode: ExportMode;
  policy?: ImportPolicy;
}
export type ImportError = 'missing_date' | 'missing_amount' | 'currency_required' | 'missing_product' | 'missing_quantity' | 'missing_counterparty';
export type PreviewResult = { ok: true; preview: MergePreview; stats: ImportStats; diagnostics: ImportDiagnostics; discountMode?: string; inventoryKind?: string; snapshotDates?: string[]; financeKind?: string; financeGrain?: string; financeSide?: string } | { ok: false; error: ImportError };
export type CommitOutcome =
  | { status: 'duplicate_file'; existing: ImportRow }
  | { status: 'needs_confirmation'; preview: MergePreview }
  | { status: 'ok'; import: ImportRow; stats: ImportStats }
  | { status: 'error'; error: ImportError };

export interface BuildRequest {
  version: number;
  seriesKey?: string;
  filters: FilterSpec;
  period: DashboardOptions['period'];
  includeRolling?: boolean;
}
export interface EntityOption {
  key: string;
  label: string;
  value: number;
}
export interface BuildResult {
  empty: boolean;
  series?: Series;
  allSeries: Series[];
  model?: DashboardView;
  analysis?: SalesAnalysis | null;
  rolling?: SalesAnalysis | null;
  options: Partial<Record<Dimension, EntityOption[]>>;
  bounds?: { dateMin: string; dateMax: string };
  presets: PeriodPreset[];
  imports: { id: string; fileName: string; added: number }[];
  pendingHeld: number;
  identity: 'document' | 'mixed' | 'content';
}
export interface DrillRequest {
  module?: ModuleId;
  version: number;
  seriesKey?: string;
  spec: DrillSpec;
  page: number;
  pageSize: number;
}
/** One underlying line, in the shape the drill-down table needs (both modules). */
export interface DrillRow {
  key: string;
  date: string;
  documentId?: string;
  /** customer (sales) or supplier (purchasing) */
  party?: string;
  product?: string;
  quantity?: number;
  unit?: string;
  /** Inventory: snapshot or the movement type. Finance: the line kind. */
  type?: string;
  /** Finance: due date, days past due (open items) and the outstanding balance of the line. */
  due?: string;
  days?: number;
  outstanding?: number;
  amount: number;
  importId?: string;
  sourceRow: number;
}

export interface DrillResult {
  lines: number;
  total: number;
  sources: SourceSummary[];
  rows: DrillRow[];
}

export interface BuildPurchasingRequest {
  version: number;
  seriesKey?: string;
  filters: FilterSpec;
  period: PeriodSel;
  unitPolicy?: UnitPolicy;
}
export interface BuildFinanceRequest {
  version: number;
  seriesKey?: string;
  side: FinanceSide;
  filters: FilterSpec;
  period: PeriodSel;
}
export interface BuildFinanceResult {
  empty: boolean;
  series?: Series;
  allSeries: Series[];
  model?: FinanceView;
  analysis?: FinanceAnalysis | null;
  options: Partial<Record<Dimension, EntityOption[]>>;
  bounds?: { dateMin: string; dateMax: string };
  presets: PeriodPreset[];
  imports: { id: string; fileName: string; added: number; kind?: string; side?: string }[];
  pendingHeld: number;
  identity: 'document' | 'mixed' | 'content';
  /** which sides have any data in this currency */
  sides: FinanceSide[];
}

export interface BuildInventoryRequest {
  version: number;
  seriesKey?: string;
  filters: FilterSpec;
  period: PeriodSel;
  unitPolicy?: UnitPolicy;
}
export interface BuildInventoryResult {
  empty: boolean;
  series?: Series;
  allSeries: Series[];
  model?: InventoryView;
  analysis?: InventoryAnalysis | null;
  options: Partial<Record<Dimension, EntityOption[]>>;
  bounds?: { dateMin: string; dateMax: string };
  presets: PeriodPreset[];
  imports: { id: string; fileName: string; added: number; kind?: string }[];
  pendingHeld: number;
  identity: 'document' | 'mixed' | 'content';
}

export interface BuildPurchasingResult {
  empty: boolean;
  series?: Series;
  allSeries: Series[];
  model?: PurchasingView;
  analysis?: PurchasingAnalysis | null;
  options: Partial<Record<Dimension, EntityOption[]>>;
  bounds?: { dateMin: string; dateMax: string };
  presets: PeriodPreset[];
  imports: { id: string; fileName: string; added: number }[];
  pendingHeld: number;
  identity: 'document' | 'mixed' | 'content';
}

const toRow = (r: SalesRecord): DrillRow => ({ key: r.key, date: r.date, documentId: r.documentId, party: r.customerName ?? r.customerId, product: r.productName ?? r.productId, quantity: r.quantity, amount: r.amount, importId: r.importId, sourceRow: r.sourceRow });
const toPurchaseRow = (r: PurchaseRecord): DrillRow => ({ key: r.key, date: r.date, documentId: r.documentId, party: r.supplierName ?? r.supplierId, product: r.productName ?? r.productId, quantity: r.quantity, unit: r.unit, amount: r.amount, importId: r.importId, sourceRow: r.sourceRow });

const toInventoryRow = (r: InventoryRecord): DrillRow => ({ key: r.key, date: r.date, documentId: r.documentId, party: r.warehouseTo ? `${r.warehouse ?? ''} → ${r.warehouseTo}` : r.warehouse, product: r.productName ?? r.productId, quantity: r.quantity, unit: r.unit, type: r.kind === 'snapshot' ? 'snapshot' : r.movementType, amount: inventoryLineAmount(r), importId: r.importId, sourceRow: r.sourceRow });

const toFinanceRow = (x: { rec: FinanceRecord; amount: number; days?: number }): DrillRow => ({ key: x.rec.key, date: x.rec.date, documentId: x.rec.invoiceNo ?? x.rec.documentId, party: cpLabel(x.rec) || undefined, product: x.rec.reference, type: x.rec.kind, due: x.rec.dueDate, days: x.days, outstanding: x.rec.outstanding, amount: x.amount, importId: x.rec.importId, sourceRow: x.rec.sourceRow });

const short = (v: unknown, n = 60) => {
  const s = v === null || v === undefined ? '' : String(v);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

/**
 * All heavy work of the app (parsing, profiling, normalising, merge planning, dashboard maths, drill-down) lives here so it can run
 * inside a Web Worker. The class itself has no DOM dependency: it is also used directly by the tests.
 */
export class EngineSession {
  private parsed: { file: ParsedFile; checksum: string } | null = null;
  private analyses = new Map<string, AnalysisLite & { raw: SheetAnalysis }>();
  private norm: { key: string; module: ModuleId; records: (SalesRecord | PurchaseRecord | InventoryRecord | FinanceRecord)[]; stats: ImportStats; basis: SalesRecord['basis']; discountMode?: string; inventoryKind?: string; snapshotDates?: string[]; financeKind?: string; financeGrain?: string; financeSide?: string } | null = null;
  private cache: { version: number; records: SalesRecord[] } | null = null;
  private pcache: { version: number; records: PurchaseRecord[] } | null = null;
  private icache: { version: number; records: InventoryRecord[] } | null = null;
  private fcache: { version: number; records: FinanceRecord[] } | null = null;
  private drillCache: { key: string; rows: DrillRow[] } | null = null;

  constructor(private db: AppDB = getDb()) {}

  // ───────── import ─────────
  async parse(bytes: ArrayBuffer, fileName: string): Promise<ParseResult> {
    this.parsed = null;
    this.analyses.clear();
    this.norm = null;
    const file = await parseFile(new Uint8Array(bytes), fileName);
    const checksum = await sha256Hex(new Uint8Array(bytes));
    this.parsed = { file, checksum };
    const existing = await this.db.imports.where('checksum').equals(checksum).first();
    return {
      fileName, kind: file.kind, encoding: file.encoding, delimiter: file.delimiter, checksum,
      sheets: file.sheets.map((s) => ({
        name: s.name, rows: s.rows.length, columns: Math.max(0, ...s.rows.slice(0, 200).map((r) => r.length)), truncated: s.truncated, hasTable: analyzeSheet(s) !== null,
      })),
      duplicateOf: existing ? { id: existing.id, importedAt: existing.importedAt, fileName: existing.fileName } : undefined,
    };
  }

  async analyze(sheetIdx: number, decimalHint: ',' | '.', module: ModuleId = 'sales'): Promise<AnalysisLite | null> {
    if (!this.parsed) throw new Error('no_file');
    const sheet = this.parsed.file.sheets[sheetIdx];
    if (!sheet) return null;
    let a = analyzeSheet(sheet, { decimalHint, module });
    if (!a) return null;
    let usedSaved = false;
    let savedCurrency: string | undefined;
    const saved = await getSavedMapping(this.db, a.signature);
    if (saved) {
      a = analyzeSheet(sheet, { decimalHint, savedMapping: saved.fields, module }) ?? a;
      usedSaved = true;
      savedCurrency = saved.defaultCurrency;
    }
    const t = a.table;
    const lite: AnalysisLite = {
      sheetIdx, headers: t.headers, profiles: a.profiles, proposal: a.proposal, signature: a.signature, headerRow: t.headerRow, headerConfidence: t.confidence,
      skippedTotalRows: t.skippedTotalRows, rowCount: t.dataRows.length, truncated: sheet.truncated,
      samples: a.profiles.map((p) => t.dataRows.slice(0, 3).map((r) => short(r[p.index], 40)).filter(Boolean)),
      previewRows: t.dataRows.slice(0, 8).map((r) => t.headers.map((_, ci) => short(r[ci]))),
      usedSaved, savedCurrency, module, detected: { ...detectModule(t.headers), side: detectSide(t.headers) },
      structure: {
        kind: this.parsed.file.kind, sheet: sheet.name, sheets: this.parsed.file.sheets.length, encoding: this.parsed.file.encoding, delimiter: this.parsed.file.delimiter,
        rows: t.dataRows.length, columns: t.headers.length, headerRow: t.headerRow + 1, headerConfidence: t.confidence, skippedTotalRows: t.skippedTotalRows, truncated: sheet.truncated,
      },
    };
    this.analyses.set(`${module}:${sheetIdx}`, { ...lite, raw: a });
    this.analyses.set(String(sheetIdx), { ...lite, raw: a }); // latest analysis of this sheet
    this.norm = null;
    return lite;
  }

  private normalise(req: ImportRequest): { ok: true; module: ModuleId; records: (SalesRecord | PurchaseRecord | InventoryRecord | FinanceRecord)[]; stats: ImportStats; basis: SalesRecord['basis']; discountMode?: string; inventoryKind?: string; snapshotDates?: string[]; financeKind?: string; financeGrain?: string; financeSide?: string } | { ok: false; error: ImportError } {
    const module = req.module ?? 'sales';
    const cached = this.analyses.get(`${module}:${req.sheetIdx}`);
    if (!cached) throw new Error('no_analysis');
    const hasCurrencyCol = req.entries.some((e) => e.field === 'currency');
    const key = JSON.stringify([module, req.sheetIdx, req.entries.map((e) => [e.field, e.columnIndex]), hasCurrencyCol ? '' : req.currency ?? '', req.asOfDate ?? '', req.side ?? '']);
    if (this.norm?.key === key) return { ok: true, ...this.norm };
    try {
      const mapping = confirmedFromEntries(req.entries, hasCurrencyCol ? undefined : req.currency);
      const opts = { profiles: cached.raw.profiles, mapping, rowNumbers: cached.raw.table.dataRowNumbers, skippedTotalRows: cached.raw.table.skippedTotalRows };
      const amountBasis = mapping.columns.net_amount !== undefined ? 'net' : mapping.columns.gross_amount !== undefined ? 'gross' : 'unknown';
      let res: { key: string; module: ModuleId; records: (SalesRecord | PurchaseRecord | InventoryRecord | FinanceRecord)[]; stats: ImportStats; basis: SalesRecord['basis']; discountMode?: string; inventoryKind?: string; snapshotDates?: string[]; financeKind?: string; financeGrain?: string; financeSide?: string };
      if (module === 'finance') {
        const r = normalizeFinance(cached.raw.table.dataRows, { ...opts, asOfDate: req.asOfDate, side: req.side });
        res = { key, module, records: r.records, stats: r.stats, basis: 'net', financeKind: r.kind, financeGrain: r.grain, financeSide: r.side, snapshotDates: r.snapshotDates };
      } else if (module === 'inventory') {
        const r = normalizeInventory(cached.raw.table.dataRows, { ...opts, asOfDate: req.asOfDate });
        res = { key, module, records: r.records, stats: r.stats, basis: 'net', inventoryKind: r.kind, snapshotDates: r.snapshotDates };
      } else if (module === 'purchasing') {
        const r = normalizePurchases(cached.raw.table.dataRows, opts);
        res = { key, module, records: r.records, stats: r.stats, basis: r.records[0]?.basis ?? amountBasis, discountMode: r.discountMode };
      } else {
        const r = normalizeSales(cached.raw.table.dataRows, opts);
        res = { key, module, records: r.records, stats: r.stats, basis: r.records[0]?.basis ?? amountBasis };
      }
      this.norm = res;
      return { ok: true, ...res };
    } catch (e) {
      if (e instanceof MappingError) return { ok: false, error: e.code };
      throw e;
    }
  }

  async preview(req: ImportRequest): Promise<PreviewResult> {
    const n = this.normalise(req);
    if (!n.ok) return n;
    const cached = this.analyses.get(`${n.module}:${req.sheetIdx}`)!;
    const preview = await previewImport(this.db, n.records, req.mode, req.policy, n.module);
    const diagnostics = buildDiagnostics({
      structure: cached.structure, profiles: cached.profiles, entries: req.entries, stats: n.stats,
      ...(n.module === 'finance' ? { metrics: predictFinanceMetrics(n.records as FinanceRecord[], req.side ?? 'receivable') } : n.module === 'inventory' ? { metrics: predictInventoryMetrics(n.records as InventoryRecord[]) } : n.module === 'purchasing' ? { metrics: predictPurchaseMetrics(n.records as PurchaseRecord[], n.basis) } : { records: n.records as SalesRecord[], basis: n.basis }),
    });
    return { ok: true, preview, stats: n.stats, diagnostics, discountMode: n.discountMode, inventoryKind: n.inventoryKind, snapshotDates: n.snapshotDates, financeKind: n.financeKind, financeGrain: n.financeGrain, financeSide: n.financeSide };
  }

  async commit(req: ImportRequest & { confirmed: boolean; allowSameChecksum: boolean; remember: boolean }): Promise<CommitOutcome> {
    if (!this.parsed) throw new Error('no_file');
    const n = this.normalise(req);
    if (!n.ok) return { status: 'error', error: n.error };
    const cached = this.analyses.get(`${n.module}:${req.sheetIdx}`)!;
    const hasCurrencyCol = req.entries.some((e) => e.field === 'currency');
    const mapping = confirmedFromEntries(req.entries, hasCurrencyCol ? undefined : req.currency);
    const res: CommitResult = await commitImport(this.db, {
      module: n.module, extra: n.discountMode ? { discountMode: n.discountMode } : n.inventoryKind ? { inventoryKind: n.inventoryKind } : n.financeKind ? { financeKind: n.financeKind, financeSide: n.financeSide } : undefined,
      checksum: this.parsed.checksum, fileName: this.parsed.file.fileName, sheetName: this.parsed.file.sheets[req.sheetIdx]!.name, exportMode: req.mode,
      records: n.records, stats: n.stats, mapping, templateId: cached.proposal.templateId, allowSameChecksum: req.allowSameChecksum, policy: req.policy, confirmed: req.confirmed,
    });
    if (res.status !== 'ok') return res;
    if (req.remember) {
      await saveMapping(this.db, { signature: cached.signature, fields: mappingToSaved(req.entries, cached.headers), defaultCurrency: hasCurrencyCol ? undefined : req.currency, updatedAt: Date.now() });
    }
    this.cache = null; // stored data changed
    this.pcache = null;
    this.icache = null;
    this.fcache = null;
    this.drillCache = null;
    return { status: 'ok', import: res.import, stats: n.stats };
  }

  discard(): void {
    this.parsed = null;
    this.analyses.clear();
    this.norm = null;
  }

  // ───────── dashboard ─────────
  private async purchases(version: number): Promise<PurchaseRecord[]> {
    if (!this.pcache || this.pcache.version !== version) {
      this.pcache = { version, records: await loadAllPurchases(this.db) };
      this.drillCache = null;
    }
    return this.pcache.records;
  }

  private async finance(version: number): Promise<FinanceRecord[]> {
    if (!this.fcache || this.fcache.version !== version) {
      this.fcache = { version, records: await loadAllFinance(this.db) };
      this.drillCache = null;
    }
    return this.fcache.records;
  }

  private async inventory(version: number): Promise<InventoryRecord[]> {
    if (!this.icache || this.icache.version !== version) {
      this.icache = { version, records: await loadAllInventory(this.db) };
      this.drillCache = null;
    }
    return this.icache.records;
  }

  private async sales(version: number): Promise<SalesRecord[]> {
    if (!this.cache || this.cache.version !== version) {
      this.cache = { version, records: await loadAllSales(this.db) };
      this.drillCache = null;
    }
    return this.cache.records;
  }

  async build(req: BuildRequest): Promise<BuildResult> {
    const records = await this.sales(req.version);
    const imports = await this.db.imports.toArray();
    const pendingHeld = await pendingHeldCount(this.db);
    const identity = imports.some((i) => i.added > 0 && i.identity === 'content') ? 'content' : imports.some((i) => i.added > 0 && i.identity === 'mixed') ? 'mixed' : 'document';
    const importsLite = imports.map((i) => ({ id: i.id, fileName: i.fileName, added: i.added }));
    const allSeries = listSeries(records);
    if (allSeries.length === 0) return { empty: true, allSeries, options: {}, presets: [], imports: importsLite, pendingHeld, identity };
    const series = allSeries.find((s) => `${s.currency}|${s.basis}` === req.seriesKey) ?? allSeries[0]!;
    const seriesRecords = records.filter((r) => r.currency === series.currency && r.basis === series.basis);
    const built = buildDashboardWithInsights(records, { series, filters: req.filters, period: req.period, identity, heldPending: pendingHeld })!;
    const { records: modelRecords, ...view } = built.model;
    let dmin = seriesRecords[0]!.date;
    let dmax = dmin;
    for (const r of seriesRecords) {
      if (r.date < dmin) dmin = r.date;
      if (r.date > dmax) dmax = r.date;
    }
    const options: BuildResult['options'] = {};
    for (const d of ['customer', 'product', 'salesperson', 'category'] as SalesDimension[]) {
      if (!seriesRecords.some((r) => dimensionOf[d](r))) continue;
      const { groups } = groupAggregates(seriesRecords, d);
      options[d] = [...groups.values()].map((g) => ({ key: g.key, label: g.label, value: g.agg.revenue })).sort((a, b) => b.value - a.value).slice(0, 2000);
    }
    return {
      empty: false, series, allSeries, model: view, analysis: built.analysis,
      rolling: req.includeRolling ? analyzeSales(modelRecords, series) : null,
      options, bounds: { dateMin: dmin, dateMax: dmax }, presets: availablePresets({ dateMin: dmin, dateMax: dmax }), imports: importsLite, pendingHeld, identity,
    };
  }

  private async drillRows(req: Pick<DrillRequest, 'module' | 'version' | 'seriesKey' | 'spec'>): Promise<DrillRow[]> {
    const key = JSON.stringify([req.module ?? 'sales', req.version, req.seriesKey, req.spec]);
    if (this.drillCache?.key === key) return this.drillCache.rows;
    const spec = { ...req.spec, filter: { ...req.spec.filter, dateFrom: undefined, dateTo: undefined } };
    const order = (a: DrillRow, b: DrillRow) => b.date.localeCompare(a.date) || (a.documentId ?? '').localeCompare(b.documentId ?? '') || a.sourceRow - b.sourceRow;
    let rows: DrillRow[];
    if (req.module === 'finance') {
      const all = await this.finance(req.version);
      const cur = req.seriesKey?.split('|')[0] ?? all[0]?.currency;
      rows = drillFinanceRecords(all.filter((r) => r.currency === cur), spec).map(toFinanceRow);
    } else if (req.module === 'inventory') {
      const all = await this.inventory(req.version);
      const cur = req.seriesKey?.split('|')[0] ?? all[0]?.currency;
      rows = drillInventoryRecords(all.filter((r) => r.currency === cur), spec).map(toInventoryRow);
    } else if (req.module === 'purchasing') {
      const all = await this.purchases(req.version);
      const series = listSeries(all as never).find((x) => `${x.currency}|${x.basis}` === req.seriesKey) ?? listSeries(all as never)[0];
      rows = drillPurchaseRecords(series ? (all.filter((r) => r.currency === series.currency && r.basis === series.basis)) : [], spec).map(toPurchaseRow);
    } else {
      const all = await this.sales(req.version);
      const series = listSeries(all).find((x) => `${x.currency}|${x.basis}` === req.seriesKey) ?? listSeries(all)[0];
      rows = drillRecords(series ? all.filter((r) => r.currency === series.currency && r.basis === series.basis) : [], spec).map(toRow);
    }
    rows.sort(order);
    this.drillCache = { key, rows };
    return rows;
  }

  async drill(req: DrillRequest): Promise<DrillResult> {
    const rows = await this.drillRows(req);
    let total = 0;
    for (const r of rows) total += r.amount;
    return { lines: rows.length, total, sources: sourcesOf(rows), rows: rows.slice(req.page * req.pageSize, (req.page + 1) * req.pageSize) };
  }

  async drillCsv(req: Pick<DrillRequest, 'module' | 'version' | 'seriesKey' | 'spec'> & { headers: string[]; fileNames: Record<string, string>; unknownFile: string }): Promise<string> {
    const rows = await this.drillRows(req);
    const purchasing = req.module === 'purchasing';
    const inventory = req.module === 'inventory';
    const finance = req.module === 'finance';
    const lines = finance
      ? [req.headers, ...rows.map((r) => [r.date, r.documentId ?? '', r.party ?? '', r.type ?? '', r.product ?? '', r.due ?? '', r.days ?? '', r.outstanding ?? '', r.amount, (r.importId && req.fileNames[r.importId]) || req.unknownFile, r.sourceRow])]
      : [req.headers, ...rows.map((r) => [r.date, r.documentId ?? '', r.party ?? '', r.product ?? '', r.quantity ?? '', ...(purchasing || inventory ? [r.unit ?? ''] : []), ...(inventory ? [r.type ?? ''] : []), r.amount, (r.importId && req.fileNames[r.importId]) || req.unknownFile, r.sourceRow])];
    return '\ufeff' + lines.map((l) => l.map((c) => csvCell(typeof c === 'number' ? c : String(c))).join(';')).join('\r\n') + '\r\n';
  }

  // ───────── purchasing dashboard ─────────
  async buildPurchasing(req: BuildPurchasingRequest): Promise<BuildPurchasingResult> {
    const records = await this.purchases(req.version);
    const imports = await this.db.imports.toArray();
    const pendingHeld = await pendingHeldCount(this.db, 'purchasing');
    const mine = imports.filter((i) => i.module === 'purchasing');
    const identity = mine.some((i) => i.added > 0 && i.identity === 'content') ? 'content' : mine.some((i) => i.added > 0 && i.identity === 'mixed') ? 'mixed' : 'document';
    const importsLite = mine.map((i) => ({ id: i.id, fileName: i.fileName, added: i.added }));
    const allSeries = listSeries(records as never);
    if (allSeries.length === 0) return { empty: true, allSeries, options: {}, presets: [], imports: importsLite, pendingHeld, identity };
    const series = allSeries.find((x) => `${x.currency}|${x.basis}` === req.seriesKey) ?? allSeries[0]!;
    const seriesRecords = records.filter((r) => r.currency === series.currency && r.basis === series.basis);
    const opts: PurchasingOptions = { series, filters: req.filters, period: req.period, unitPolicy: req.unitPolicy, identity, heldPending: pendingHeld, discountUnverified: mine.some((i) => i.discountMode === 'unverified') };
    const model = buildPurchasingDashboard(records, opts)!;
    const analysis = analyzePurchasingPeriod(model);
    const { records: _r, analysis: _a, ...view } = model;
    void _r; void _a;
    let dmin = seriesRecords[0]!.date;
    let dmax = dmin;
    for (const r of seriesRecords) { if (r.date < dmin) dmin = r.date; if (r.date > dmax) dmax = r.date; }
    const options: BuildPurchasingResult['options'] = {};
    for (const d of ['supplier', 'product', 'warehouse'] as PurchaseDimension[]) {
      if (!seriesRecords.some((r) => purchaseDimensionOf[d](r))) continue;
      const { groups } = groupPurchaseAggregates(seriesRecords, d);
      options[d] = [...groups.values()].map((g) => ({ key: g.key, label: g.label, value: g.agg.spend })).sort((x, y) => y.value - x.value).slice(0, 2000);
    }
    return { empty: false, series, allSeries, model: view, analysis, options, bounds: { dateMin: dmin, dateMax: dmax }, presets: availablePresets({ dateMin: dmin, dateMax: dmax }), imports: importsLite, pendingHeld, identity };
  }

  /** Quantity-weighted unit price per bucket for one comparable item (price-trend chart), overall and per supplier. */
  async priceTrendFor(req: { version: number; seriesKey?: string; filters: FilterSpec; gk: string; unitPolicy?: UnitPolicy }) {
    const records = await this.purchases(req.version);
    const series = listSeries(records as never).find((x) => `${x.currency}|${x.basis}` === req.seriesKey) ?? listSeries(records as never)[0];
    if (!series) return { points: [], suppliers: [] };
    const seriesRecords = applyPurchaseFilters(records.filter((r) => r.currency === series.currency && r.basis === series.basis), { ...req.filters, dateFrom: undefined, dateTo: undefined });
    const { lines } = toPriceLines(seriesRecords, { policy: req.unitPolicy ?? 'strict', hasUnitColumn: seriesRecords.some((r) => r.unit !== undefined) });
    const dates = lines.filter((l) => l.gk === req.gk).map((l) => l.date).sort();
    if (!dates.length) return { points: [], suppliers: [] };
    return priceTrend(lines, req.gk, { from: dates[0]!, to: dates[dates.length - 1]! });
  }

  // ───────── inventory dashboard ─────────
  async buildInventory(req: BuildInventoryRequest): Promise<BuildInventoryResult> {
    const records = await this.inventory(req.version);
    const imports = await this.db.imports.toArray();
    const pendingHeld = await pendingHeldCount(this.db, 'inventory');
    const mine = imports.filter((i) => i.module === 'inventory');
    const identity = mine.some((i) => i.added > 0 && i.identity === 'content') ? 'content' : mine.some((i) => i.added > 0 && i.identity === 'mixed') ? 'mixed' : 'document';
    const importsLite = mine.map((i) => ({ id: i.id, fileName: i.fileName, added: i.added, kind: i.inventoryKind }));
    const allSeries = listSeries(records as never);
    if (allSeries.length === 0) return { empty: true, allSeries, options: {}, presets: [], imports: importsLite, pendingHeld, identity };
    const series = allSeries.find((x) => `${x.currency}|${x.basis}` === req.seriesKey) ?? allSeries[0]!;
    const seriesRecords = records.filter((r) => r.currency === series.currency);
    const model = buildInventoryDashboard(records, { series, filters: req.filters, period: req.period, unitPolicy: req.unitPolicy, identity, heldPending: pendingHeld })!;
    const analysis = analyzeInventoryPeriod(model);
    const { records: _r, cur: _c, prev: _p, moves: _m, cov: _v, curTable: _t, valueConflicts: _vc, costOutliers: _co, negatives: _n, ...view } = model;
    void _r; void _c; void _p; void _m; void _v; void _t; void _vc; void _co; void _n;
    let dmin = seriesRecords[0]!.date;
    let dmax = dmin;
    for (const r of seriesRecords) { if (r.date < dmin) dmin = r.date; if (r.date > dmax) dmax = r.date; }
    const options: BuildInventoryResult['options'] = {};
    for (const d of ['product', 'warehouse', 'category'] as const) {
      const o = groupInventoryOptions(seriesRecords, d);
      if (o.length) options[d] = o;
    }
    return { empty: false, series, allSeries, model: view, analysis, options, bounds: { dateMin: dmin, dateMax: dmax }, presets: availablePresets({ dateMin: dmin, dateMax: dmax }), imports: importsLite, pendingHeld, identity };
  }

  // ───────── receivables / payables dashboard ─────────
  async buildFinance(req: BuildFinanceRequest): Promise<BuildFinanceResult> {
    const records = await this.finance(req.version);
    const imports = await this.db.imports.toArray();
    const pendingHeld = await pendingHeldCount(this.db, 'finance');
    const mine = imports.filter((i) => i.module === 'finance');
    const identity = mine.some((i) => i.added > 0 && i.identity === 'content') ? 'content' : mine.some((i) => i.added > 0 && i.identity === 'mixed') ? 'mixed' : 'document';
    const importsLite = mine.map((i) => ({ id: i.id, fileName: i.fileName, added: i.added, kind: i.financeKind, side: i.financeSide }));
    const allSeries = listSeries(records as never);
    if (allSeries.length === 0) return { empty: true, allSeries, options: {}, presets: [], imports: importsLite, pendingHeld, identity, sides: [] };
    const series = allSeries.find((x) => `${x.currency}|${x.basis}` === req.seriesKey) ?? allSeries[0]!;
    const seriesRecords = records.filter((r) => r.currency === series.currency);
    const sides = (['receivable', 'payable'] as FinanceSide[]).filter((s) => seriesRecords.some((r) => r.side === s));
    const side = sides.includes(req.side) ? req.side : (sides[0] ?? req.side);
    const model = buildFinanceDashboard(records, { series, side, filters: req.filters, period: req.period, identity, heldPending: pendingHeld })!;
    const analysis = analyzeFinancePeriod(model);
    const { records: _r, cur: _c, prev: _p, universe: _u, pays: _y, creditRows: _cr, dupAll: _d, ...view } = model;
    void _r; void _c; void _p; void _u; void _y; void _cr; void _d;
    let dmin = seriesRecords[0]!.date;
    let dmax = dmin;
    for (const r of seriesRecords) { if (r.date < dmin) dmin = r.date; if (r.date > dmax) dmax = r.date; }
    const dim = side === 'receivable' ? 'customer' : 'supplier';
    const by = new Map<string, EntityOption>();
    for (const r of seriesRecords) {
      if (r.side !== side) continue;
      const k = cpKey(r);
      if (!k) continue;
      const e = by.get(k) ?? { key: k, label: cpLabel(r), value: 0 };
      e.value++;
      by.set(k, e);
    }
    const options: BuildFinanceResult['options'] = { [dim]: [...by.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)).slice(0, 2000) };
    return { empty: false, series, allSeries, model: view, analysis, options, bounds: { dateMin: dmin, dateMax: dmax }, presets: availablePresets({ dateMin: dmin, dateMax: dmax }), imports: importsLite, pendingHeld, identity, sides };
  }

  /** Test helper: the cached normalised records of the last preview. */
  lastNormalised(): SalesRecord[] | null {
    return (this.norm?.records ?? null) as SalesRecord[] | null;
  }
}

export { ParseError };
export type { FieldId };
