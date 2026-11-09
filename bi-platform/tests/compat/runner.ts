import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { parseFile } from '@/engine/parsing/parseFile';
import { analyzeSheet, confirmedFromEntries } from '@/engine/pipeline';
import { normalizeSales } from '@/engine/validation/normalize';
import { computeKpis } from '@/engine/sales/kpi';
import { validateManifest, type CompatManifest, type ManifestProblem } from './schema';
import { scanForPersonalData, type Finding } from './privacy';

export const COMPAT_DIR = path.join(process.cwd(), 'tests/compat');
export const FIXTURES_DIR = path.join(COMPAT_DIR, 'fixtures');

export interface Fixture {
  dir: string;
  manifest: CompatManifest;
  problems: ManifestProblem[];
}

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}
export interface FixtureResult {
  id: string;
  vendor: string;
  provenance: CompatManifest['provenance'];
  status: CompatManifest['status'];
  problems: ManifestProblem[];
  privacy: Finding[];
  checks: Check[];
  passed: boolean;
}

/** Fixtures are folders `fixtures/<vendor>/<case>/manifest.json` + the export file. */
export function discoverFixtures(root = FIXTURES_DIR): Fixture[] {
  if (!fs.existsSync(root)) return [];
  const out: Fixture[] = [];
  for (const vendor of fs.readdirSync(root)) {
    const vdir = path.join(root, vendor);
    if (!fs.statSync(vdir).isDirectory()) continue;
    for (const c of fs.readdirSync(vdir)) {
      const dir = path.join(vdir, c);
      const mf = path.join(dir, 'manifest.json');
      if (!fs.existsSync(mf)) continue;
      let manifest: CompatManifest;
      try {
        manifest = JSON.parse(fs.readFileSync(mf, 'utf8')) as CompatManifest;
      } catch {
        out.push({ dir, manifest: { id: c, vendor, provenance: 'synthetic', status: 'draft', file: '', expect: { headerRow: 0, fields: {}, basis: 'net', currency: '', rowsImported: 0 }, controlTotals: { source: '' } }, problems: [{ field: 'manifest.json', message: 'not valid JSON' }] });
        continue;
      }
      const problems = validateManifest(manifest);
      if (manifest.vendor !== vendor) problems.push({ field: 'vendor', message: `folder "${vendor}" ≠ manifest vendor "${manifest.vendor}"` });
      out.push({ dir, manifest, problems });
    }
  }
  return out;
}

/** All text of the file, for the personal-data scan (CSV as text; XLSX: every string cell and sheet name). */
async function textOf(file: string, bytes: Uint8Array): Promise<string> {
  if (/\.xlsx$/i.test(file)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const parts: string[] = [];
    wb.eachSheet((ws) => { parts.push(ws.name); ws.eachRow((r) => r.eachCell((c) => { if (typeof c.value === 'string') parts.push(c.value); })); });
    return parts.join('\n');
  }
  return new TextDecoder('utf-8').decode(bytes) + '\n' + new TextDecoder('windows-1257').decode(bytes);
}

export async function runFixture(f: Fixture): Promise<FixtureResult> {
  const m = f.manifest;
  const res: FixtureResult = { id: m.id, vendor: m.vendor, provenance: m.provenance, status: m.status, problems: f.problems, privacy: [], checks: [], passed: false };
  const add = (name: string, ok: boolean, detail?: string) => res.checks.push({ name, ok, detail });
  if (f.problems.length) return res;
  const filePath = path.join(f.dir, m.file);
  if (!fs.existsSync(filePath)) { add('file exists', false, m.file); return res; }
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  res.privacy = scanForPersonalData(await textOf(m.file, bytes));
  add('no obvious personal data in the file', res.privacy.length === 0, res.privacy.map((x) => x.kind).join(', '));

  const parsed = await parseFile(bytes, m.file);
  const sheet = m.sheet ? parsed.sheets.find((s) => s.name === m.sheet) : parsed.sheets[0];
  add('sheet found', Boolean(sheet), m.sheet);
  if (!sheet) return res;
  const a = analyzeSheet(sheet, { decimalHint: m.decimalHint ?? ',' });
  add('a table is detected', Boolean(a));
  if (!a) return res;
  add('header row', a.table.headerRow + 1 === m.expect.headerRow, `expected ${m.expect.headerRow}, found ${a.table.headerRow + 1}`);

  // the proposed mapping must equal the expected one WITHOUT manual correction
  const proposed: Record<string, string> = {};
  for (const e of a.proposal.entries) proposed[e.field] = a.table.headers[e.columnIndex]!;
  for (const [field, header] of Object.entries(m.expect.fields)) add(`mapping ${field} ← "${header}"`, proposed[field] === header, `proposed: ${proposed[field] ?? '(none)'}`);
  const extra = Object.keys(proposed).filter((f2) => !(f2 in m.expect.fields));
  add('no unexpected extra mappings', extra.length === 0, extra.map((x) => `${x}←${proposed[x]}`).join(', '));

  const mapping = confirmedFromEntries(a.proposal.entries, a.proposal.detectedCurrency ?? m.expect.currency);
  const { records, stats } = normalizeSales(a.table.dataRows, { profiles: a.profiles, mapping, rowNumbers: a.table.dataRowNumbers, skippedTotalRows: a.table.skippedTotalRows, today: '2099-12-31' });
  add('rows imported', stats.rowsImported === m.expect.rowsImported, `expected ${m.expect.rowsImported}, got ${stats.rowsImported}`);
  add('amount basis', (records[0]?.basis ?? 'unknown') === m.expect.basis, records[0]?.basis);
  add('currency', stats.currencies.length === 1 && stats.currencies[0] === m.expect.currency, stats.currencies.join(','));
  if (m.expect.errors) add('validation errors', JSON.stringify(stats.errors) === JSON.stringify(m.expect.errors), JSON.stringify(stats.errors));

  const k = computeKpis(records, { currency: m.expect.currency, basis: m.expect.basis });
  const tol = m.controlTotals.tolerance ?? 0.01;
  const near = (a2: number | undefined, b: number | null | undefined) => a2 !== undefined && typeof b === 'number' && Math.abs(a2 - b) <= tol;
  if (typeof m.controlTotals.netSales === 'number') add("net sales = the accounting program's report", m.expect.basis === 'net' && near(k?.revenue, m.controlTotals.netSales), `got ${k?.revenue}`);
  if (typeof m.controlTotals.grossSales === 'number') add("gross sales = the accounting program's report", m.expect.basis === 'gross' && near(k?.revenue, m.controlTotals.grossSales), `got ${k?.revenue}`);
  if (typeof m.controlTotals.lines === 'number') add('line count', records.length === m.controlTotals.lines, `got ${records.length}`);
  if (typeof m.controlTotals.documents === 'number') add('document count', k?.documents === m.controlTotals.documents, `got ${k?.documents}`);
  res.passed = res.checks.every((c) => c.ok);
  return res;
}

// ───────── vendor status ─────────
export type VendorStatus = 'verified' | 'untested' | 'failing';
export interface VendorRow {
  id: string;
  name: string;
  country: string;
  status: VendorStatus;
  realFixtures: number;
  syntheticFixtures: number;
  failing: string[];
}

/** "verified" requires ≥ 1 READY, VALID, PASSING fixture with provenance real-anonymized. Nothing else ever counts. */
export function vendorStatuses(vendors: { id: string; name: string; country: string }[], results: FixtureResult[]): VendorRow[] {
  return vendors.map((v) => {
    const mine = results.filter((r) => r.vendor === v.id);
    const real = mine.filter((r) => r.provenance === 'real-anonymized' && r.status === 'ready');
    const failing = mine.filter((r) => r.status === 'ready' && (!r.passed || r.problems.length > 0)).map((r) => r.id);
    const status: VendorStatus = failing.length ? 'failing' : real.some((r) => r.passed && r.problems.length === 0) ? 'verified' : 'untested';
    return { id: v.id, name: v.name, country: v.country, status, realFixtures: real.length, syntheticFixtures: mine.filter((r) => r.provenance === 'synthetic').length, failing };
  });
}

export function loadVendors(): { id: string; name: string; country: string }[] {
  return (JSON.parse(fs.readFileSync(path.join(COMPAT_DIR, 'vendors.json'), 'utf8')) as { vendors: { id: string; name: string; country: string }[] }).vendors;
}

export function renderCompatibilityDoc(rows: VendorRow[], results: FixtureResult[]): string {
  const icon = { verified: '✅ verified', untested: '⬜ untested', failing: '❌ failing' } as const;
  return `# Accounting-program export compatibility

_This file is generated by \`npm run compat:report\` from \`tests/compat\`. Do not edit it by hand: a test fails when it is out of date._

**Rule:** a program is listed as *verified* only when at least one **real, anonymised** export of it passes every check in
\`tests/compat/runner.ts\` (header row, mapping without manual correction, amount basis, currency, row count and the totals of the
accounting program's own report). Synthetic fixtures exercise the framework but **never** count.

| Program | Country | Status | Real fixtures | Synthetic fixtures |
|---|---|---|---|---|
${rows.map((r) => `| ${r.name} | ${r.country} | ${icon[r.status]} | ${r.realFixtures} | ${r.syntheticFixtures} |`).join('\n')}

${rows.every((r) => r.status === 'untested') ? '> **No program has been verified yet.** The importer recognises generic LT / PL / EN header vocabulary; that is not the same as supporting a specific accounting program.\n' : ''}
## Fixtures in the repository

| Fixture | Program | Provenance | Status | Result |
|---|---|---|---|---|
${results.length ? results.map((r) => `| ${r.id} | ${r.vendor} | ${r.provenance} | ${r.status} | ${r.problems.length ? 'invalid manifest' : r.passed ? 'pass' : 'FAIL'} |`).join('\n') : '| – | – | – | – | – |'}

See [\`tests/compat/README.md\`](../tests/compat/README.md) for how to add an anonymised real export.
`;
}
