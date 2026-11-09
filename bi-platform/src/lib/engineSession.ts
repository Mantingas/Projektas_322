import type { ColumnProfile, ExportMode, ImportStats, MappingEntry, ParsedFile, SalesField, SalesRecord } from '@/engine/types';
import { parseFile, ParseError } from '@/engine/parsing/parseFile';
import { analyzeSheet, confirmedFromEntries, type SheetAnalysis } from '@/engine/pipeline';
import { normalizeSales, MappingError } from '@/engine/validation/normalize';
import { sha256Hex } from '@/engine/import/hash';
import { buildDiagnostics, type ImportDiagnostics } from '@/engine/import/diagnostics';
import type { ImportPolicy } from '@/engine/import/merge';
import { mappingToSaved } from '@/engine/mapping/mapper';
import { analyzeSales, type SalesAnalysis } from '@/engine/insights/engine';
import { buildDashboardWithInsights, type DashboardOptions, type DashboardView } from '@/engine/analytics/dashboard';
import { availablePresets, type PeriodPreset } from '@/engine/analytics/periods';
import { dimensionOf, type Dimension, type FilterSpec } from '@/engine/analytics/filters';
import { groupAggregates } from '@/engine/analytics/aggregate';
import { drillRecords, sourcesOf, type DrillSpec, type SourceSummary } from '@/engine/analytics/provenance';
import { csvCell } from '@/engine/report/export';
import { listSeries, type Series } from '@/engine/sales/kpi';
import { getDb, type AppDB, type ImportRow } from '@/db/db';
import { commitImport, getSavedMapping, loadAllSales, pendingHeldCount, previewImport, saveMapping, type CommitResult, type MergePreview } from '@/db/store';

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
}

export interface ImportRequest {
  sheetIdx: number;
  entries: Pick<MappingEntry, 'field' | 'columnIndex' | 'confidence' | 'source'>[];
  currency?: string;
  mode: ExportMode;
  policy?: ImportPolicy;
}
export type PreviewResult = { ok: true; preview: MergePreview; stats: ImportStats; diagnostics: ImportDiagnostics } | { ok: false; error: 'missing_date' | 'missing_amount' | 'currency_required' };
export type CommitOutcome =
  | { status: 'duplicate_file'; existing: ImportRow }
  | { status: 'needs_confirmation'; preview: MergePreview }
  | { status: 'ok'; import: ImportRow; stats: ImportStats }
  | { status: 'error'; error: 'missing_date' | 'missing_amount' | 'currency_required' };

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
  version: number;
  seriesKey?: string;
  spec: DrillSpec;
  page: number;
  pageSize: number;
}
export interface DrillResult {
  lines: number;
  total: number;
  sources: SourceSummary[];
  rows: SalesRecord[];
}

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
  private norm: { key: string; records: SalesRecord[]; stats: ImportStats; basis: SalesRecord['basis'] } | null = null;
  private cache: { version: number; records: SalesRecord[] } | null = null;
  private drillCache: { key: string; rows: SalesRecord[] } | null = null;

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

  async analyze(sheetIdx: number, decimalHint: ',' | '.'): Promise<AnalysisLite | null> {
    if (!this.parsed) throw new Error('no_file');
    const sheet = this.parsed.file.sheets[sheetIdx];
    if (!sheet) return null;
    let a = analyzeSheet(sheet, { decimalHint });
    if (!a) return null;
    let usedSaved = false;
    let savedCurrency: string | undefined;
    const saved = await getSavedMapping(this.db, a.signature);
    if (saved) {
      a = analyzeSheet(sheet, { decimalHint, savedMapping: saved.fields }) ?? a;
      usedSaved = true;
      savedCurrency = saved.defaultCurrency;
    }
    const t = a.table;
    const lite: AnalysisLite = {
      sheetIdx, headers: t.headers, profiles: a.profiles, proposal: a.proposal, signature: a.signature, headerRow: t.headerRow, headerConfidence: t.confidence,
      skippedTotalRows: t.skippedTotalRows, rowCount: t.dataRows.length, truncated: sheet.truncated,
      samples: a.profiles.map((p) => t.dataRows.slice(0, 3).map((r) => short(r[p.index], 40)).filter(Boolean)),
      previewRows: t.dataRows.slice(0, 8).map((r) => t.headers.map((_, ci) => short(r[ci]))),
      usedSaved, savedCurrency,
      structure: {
        kind: this.parsed.file.kind, sheet: sheet.name, sheets: this.parsed.file.sheets.length, encoding: this.parsed.file.encoding, delimiter: this.parsed.file.delimiter,
        rows: t.dataRows.length, columns: t.headers.length, headerRow: t.headerRow + 1, headerConfidence: t.confidence, skippedTotalRows: t.skippedTotalRows, truncated: sheet.truncated,
      },
    };
    this.analyses.set(String(sheetIdx), { ...lite, raw: a });
    this.norm = null;
    return lite;
  }

  private normalise(req: ImportRequest): { ok: true; records: SalesRecord[]; stats: ImportStats; basis: SalesRecord['basis'] } | { ok: false; error: 'missing_date' | 'missing_amount' | 'currency_required' } {
    const cached = this.analyses.get(String(req.sheetIdx));
    if (!cached) throw new Error('no_analysis');
    const hasCurrencyCol = req.entries.some((e) => e.field === 'currency');
    const key = JSON.stringify([req.sheetIdx, req.entries.map((e) => [e.field, e.columnIndex]), hasCurrencyCol ? '' : req.currency ?? '']);
    if (this.norm?.key === key) return { ok: true, ...this.norm };
    try {
      const mapping = confirmedFromEntries(req.entries, hasCurrencyCol ? undefined : req.currency);
      const { records, stats } = normalizeSales(cached.raw.table.dataRows, {
        profiles: cached.raw.profiles, mapping, rowNumbers: cached.raw.table.dataRowNumbers, skippedTotalRows: cached.raw.table.skippedTotalRows,
      });
      const basis = records[0]?.basis ?? (mapping.columns.net_amount !== undefined ? 'net' : mapping.columns.gross_amount !== undefined ? 'gross' : 'unknown');
      this.norm = { key, records, stats, basis };
      return { ok: true, records, stats, basis };
    } catch (e) {
      if (e instanceof MappingError) return { ok: false, error: e.code };
      throw e;
    }
  }

  async preview(req: ImportRequest): Promise<PreviewResult> {
    const n = this.normalise(req);
    if (!n.ok) return n;
    const cached = this.analyses.get(String(req.sheetIdx))!;
    const preview = await previewImport(this.db, n.records, req.mode, req.policy);
    const diagnostics = buildDiagnostics({ structure: cached.structure, profiles: cached.profiles, entries: req.entries, stats: n.stats, records: n.records, basis: n.basis });
    return { ok: true, preview, stats: n.stats, diagnostics };
  }

  async commit(req: ImportRequest & { confirmed: boolean; allowSameChecksum: boolean; remember: boolean }): Promise<CommitOutcome> {
    if (!this.parsed) throw new Error('no_file');
    const n = this.normalise(req);
    if (!n.ok) return { status: 'error', error: n.error };
    const cached = this.analyses.get(String(req.sheetIdx))!;
    const hasCurrencyCol = req.entries.some((e) => e.field === 'currency');
    const mapping = confirmedFromEntries(req.entries, hasCurrencyCol ? undefined : req.currency);
    const res: CommitResult = await commitImport(this.db, {
      checksum: this.parsed.checksum, fileName: this.parsed.file.fileName, sheetName: this.parsed.file.sheets[req.sheetIdx]!.name, exportMode: req.mode,
      records: n.records, stats: n.stats, mapping, templateId: cached.proposal.templateId, allowSameChecksum: req.allowSameChecksum, policy: req.policy, confirmed: req.confirmed,
    });
    if (res.status !== 'ok') return res;
    if (req.remember) {
      await saveMapping(this.db, { signature: cached.signature, fields: mappingToSaved(req.entries, cached.headers), defaultCurrency: hasCurrencyCol ? undefined : req.currency, updatedAt: Date.now() });
    }
    this.cache = null; // stored data changed
    return { status: 'ok', import: res.import, stats: n.stats };
  }

  discard(): void {
    this.parsed = null;
    this.analyses.clear();
    this.norm = null;
  }

  // ───────── dashboard ─────────
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
    for (const d of ['customer', 'product', 'salesperson', 'category'] as Dimension[]) {
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

  private async drillRows(req: Pick<DrillRequest, 'version' | 'seriesKey' | 'spec'>): Promise<SalesRecord[]> {
    const all = await this.sales(req.version);
    const key = JSON.stringify([req.version, req.seriesKey, req.spec]);
    if (this.drillCache?.key === key) return this.drillCache.rows;
    const series = listSeries(all).find((s) => `${s.currency}|${s.basis}` === req.seriesKey) ?? listSeries(all)[0];
    const seriesRecords = series ? all.filter((r) => r.currency === series.currency && r.basis === series.basis) : [];
    const rows = drillRecords(seriesRecords, { ...req.spec, filter: { ...req.spec.filter, dateFrom: undefined, dateTo: undefined } })
      .sort((a, b) => b.date.localeCompare(a.date) || (a.documentId ?? '').localeCompare(b.documentId ?? '') || a.sourceRow - b.sourceRow);
    this.drillCache = { key, rows };
    return rows;
  }

  async drill(req: DrillRequest): Promise<DrillResult> {
    const rows = await this.drillRows(req);
    let total = 0;
    for (const r of rows) total += r.amount;
    return { lines: rows.length, total, sources: sourcesOf(rows), rows: rows.slice(req.page * req.pageSize, (req.page + 1) * req.pageSize) };
  }

  async drillCsv(req: Pick<DrillRequest, 'version' | 'seriesKey' | 'spec'> & { headers: string[]; fileNames: Record<string, string>; unknownFile: string }): Promise<string> {
    const rows = await this.drillRows(req);
    const lines = [req.headers, ...rows.map((r) => [r.date, r.documentId ?? '', r.customerName ?? r.customerId ?? '', r.productName ?? r.productId ?? '', r.quantity ?? '', r.amount, (r.importId && req.fileNames[r.importId]) || req.unknownFile, r.sourceRow])];
    return '﻿' + lines.map((l) => l.map((c) => csvCell(typeof c === 'number' ? c : String(c))).join(';')).join('\r\n') + '\r\n';
  }

  /** Test helper: the cached normalised records of the last preview. */
  lastNormalised(): SalesRecord[] | null {
    return this.norm?.records ?? null;
  }
}

export { ParseError };
export type { SalesField };
