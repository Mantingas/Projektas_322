import type { ColumnProfile, ImportStats, MappingEntry, SalesField, SalesRecord, AmountBasis } from '../types';
import { aggregate } from '../analytics/aggregate';
import { KPI_ORDER, METRICS, type MetricId, type Unavailable } from '../analytics/metrics';
import type { MappingProposal } from '../types';

/** Everything the import diagnostic screen shows. Contains structure and counts – never cell values. */
export interface ImportDiagnostics {
  structure: {
    kind: 'xlsx' | 'csv';
    sheet: string;
    sheets: number;
    encoding?: string;
    delimiter?: string;
    rows: number;
    columns: number;
    headerRow: number; // 1-based
    headerConfidence: number;
    skippedTotalRows: number;
    truncated: boolean;
  };
  columns: {
    index: number;
    header: string;
    type: ColumnProfile['type'];
    field?: SalesField;
    confidence?: number;
    source?: MappingEntry['source'];
    recognized: boolean;
  }[];
  unrecognized: string[];
  issues: { level: 'error' | 'warning'; code: string; count: number; rows: number[] }[];
  rows: { read: number; imported: number; skipped: number };
  metrics: { id: MetricId; available: boolean; reason?: Unavailable }[];
}

export interface DiagnosticInput {
  structure: ImportDiagnostics['structure'];
  profiles: ColumnProfile[];
  entries: Pick<MappingEntry, 'field' | 'columnIndex' | 'confidence' | 'source'>[];
  proposal?: MappingProposal;
  stats?: ImportStats;
  records?: SalesRecord[];
  basis?: AmountBasis;
}

/** Which metrics the normalised data can support, and why not – so a missing KPI is never a mystery. */
export function predictMetrics(records: SalesRecord[], basis: AmountBasis): ImportDiagnostics['metrics'] {
  if (records.length === 0) return KPI_ORDER.map((id) => ({ id, available: false, reason: 'no_data' as const }));
  const a = aggregate(records);
  return KPI_ORDER.map((id) => {
    const v = METRICS[id].evaluate(a, { basis, singleProduct: false });
    return v.value === null ? { id, available: false, reason: v.unavailable } : { id, available: true };
  });
}

export function buildDiagnostics(i: DiagnosticInput): ImportDiagnostics {
  const byCol = new Map(i.entries.map((e) => [e.columnIndex, e]));
  const columns = i.profiles.map((p) => {
    const e = byCol.get(p.index);
    return { index: p.index, header: p.header, type: p.type, field: e?.field, confidence: e?.confidence, source: e?.source, recognized: Boolean(e) };
  });
  const issues: ImportDiagnostics['issues'] = [];
  if (i.stats) {
    const rowsOf = (code: string) => i.stats!.examples.filter((x) => x.code === code).map((x) => x.row);
    for (const [code, count] of Object.entries(i.stats.errors)) issues.push({ level: 'error', code, count: count as number, rows: rowsOf(code) });
    for (const [code, count] of Object.entries(i.stats.warnings)) issues.push({ level: 'warning', code, count: count as number, rows: rowsOf(code) });
  }
  return {
    structure: i.structure,
    columns,
    unrecognized: columns.filter((c) => !c.recognized && c.type !== 'empty').map((c) => c.header),
    issues,
    rows: { read: i.stats?.rowsRead ?? 0, imported: i.stats?.rowsImported ?? 0, skipped: i.stats?.rowsSkipped ?? 0 },
    metrics: i.records && i.basis ? predictMetrics(i.records, i.basis) : [],
  };
}

/** Plain-text report for support / compatibility work. Never includes cell values, customer or product names. */
export function renderDiagnosticsText(d: ImportDiagnostics, extra: { app: string; generatedAt: string }): string {
  const s = d.structure;
  const lines = [
    `${extra.app} – import diagnostics (${extra.generatedAt})`,
    'No cell values are included. Header names are included: remove them before sharing if they are sensitive.',
    '',
    `file kind: ${s.kind}${s.encoding ? ` · encoding ${s.encoding}` : ''}${s.delimiter ? ` · delimiter ${JSON.stringify(s.delimiter)}` : ''}`,
    `sheet: ${s.sheet} (${s.sheets} sheet(s)) · ${s.rows} rows × ${s.columns} columns${s.truncated ? ' · TRUNCATED' : ''}`,
    `header row: ${s.headerRow} (confidence ${Math.round(s.headerConfidence * 100)} %) · totals rows skipped: ${s.skippedTotalRows}`,
    '',
    'columns:',
    ...d.columns.map((c) => `  [${c.index + 1}] ${c.header} · ${c.type} · ${c.field ? `${c.field} (${Math.round((c.confidence ?? 0) * 100)} %, ${c.source})` : 'unrecognised'}`),
    '',
    `unrecognised columns: ${d.unrecognized.length ? d.unrecognized.join(', ') : '–'}`,
    `rows: read ${d.rows.read} · imported ${d.rows.imported} · skipped ${d.rows.skipped}`,
    'issues:',
    ...(d.issues.length ? d.issues.map((x) => `  ${x.level} ${x.code} ×${x.count}${x.rows.length ? ` (e.g. rows ${x.rows.slice(0, 5).join(', ')})` : ''}`) : ['  –']),
    'metrics:',
    ...d.metrics.map((m) => `  ${m.id}: ${m.available ? 'available' : `unavailable (${m.reason})`}`),
  ];
  return lines.join('\n') + '\n';
}
