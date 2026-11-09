import type { SalesField } from '@/engine/types';

export type Provenance = 'real-anonymized' | 'synthetic';

export interface CompatManifest {
  id: string;
  /** vendor id from vendors.json, or "_example" */
  vendor: string;
  product?: string;
  /** version / edition of the accounting program, as written by whoever exported the file */
  version?: string;
  provenance: Provenance;
  /** "draft" fixtures are ignored for verification */
  status: 'draft' | 'ready';
  /** file name inside the fixture folder (.csv / .tsv / .txt / .xlsx) */
  file: string;
  sheet?: string;
  anonymization?: { method: string; reviewedBy: string; date: string };
  /** the user's UI language when the export is imported (decides the decimal-separator hint) */
  decimalHint?: ',' | '.';
  expect: {
    /** 1-based row of the header */
    headerRow: number;
    /** field → header text exactly as in the file. The proposed mapping must equal this without manual correction. */
    fields: Partial<Record<SalesField, string>>;
    basis: 'net' | 'gross' | 'unknown';
    /** currency of the amounts (from the file or what the user would confirm) */
    currency: string;
    rowsImported: number;
    /** Optional: expected counts of validation issues */
    errors?: Record<string, number>;
  };
  /**
   * Totals taken from the ACCOUNTING PROGRAM'S OWN report for the same period (not from this tool).
   * Without `source` a real fixture is invalid.
   */
  controlTotals: {
    source: string;
    netSales?: number | null;
    grossSales?: number | null;
    lines?: number | null;
    documents?: number | null;
    tolerance?: number;
  };
}

export interface ManifestProblem {
  field: string;
  message: string;
}

export function validateManifest(m: Partial<CompatManifest>): ManifestProblem[] {
  const p: ManifestProblem[] = [];
  const need = (cond: unknown, field: string, message: string) => { if (!cond) p.push({ field, message }); };
  need(m.id, 'id', 'required');
  need(m.vendor, 'vendor', 'required');
  need(m.provenance === 'real-anonymized' || m.provenance === 'synthetic', 'provenance', "must be 'real-anonymized' or 'synthetic'");
  need(m.status === 'draft' || m.status === 'ready', 'status', "must be 'draft' or 'ready'");
  need(m.file, 'file', 'required');
  need(m.expect && m.expect.fields && Object.keys(m.expect.fields).length >= 2, 'expect.fields', 'at least the date and an amount column');
  need(m.expect?.basis, 'expect.basis', 'required');
  need(m.expect?.currency, 'expect.currency', 'required');
  need(typeof m.expect?.rowsImported === 'number', 'expect.rowsImported', 'required');
  need(typeof m.expect?.headerRow === 'number', 'expect.headerRow', 'required');
  need(!JSON.stringify(m).includes('TODO'), 'manifest', 'still contains TODO placeholders – complete every field');
  need(!m.expect?.basis || ['net', 'gross', 'unknown'].includes(m.expect.basis), 'expect.basis', "must be 'net', 'gross' or 'unknown'");
  need(!m.expect?.currency || /^[A-Z]{3}$/.test(m.expect.currency), 'expect.currency', 'must be an ISO code such as EUR or PLN');
  if (m.provenance === 'real-anonymized') {
    need(m.anonymization?.method && m.anonymization?.reviewedBy && m.anonymization?.date, 'anonymization', 'a real fixture must record how it was anonymised, by whom and when');
    need(m.controlTotals?.source && m.controlTotals.source.length >= 10, 'controlTotals.source', "must name the accounting program's own report the totals come from");
    need(typeof m.controlTotals?.netSales === 'number' || typeof m.controlTotals?.grossSales === 'number', 'controlTotals', 'netSales or grossSales (a number from the ERP report) is required');
    need(typeof m.controlTotals?.lines === 'number', 'controlTotals.lines', 'the line count from the ERP report is required');
    need(m.vendor !== '_example', 'vendor', 'a real fixture must name a vendor');
  }
  return p;
}
