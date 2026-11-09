import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { discoverFixtures, loadVendors, renderCompatibilityDoc, runFixture, vendorStatuses, type FixtureResult } from './compat/runner';
import { validateManifest, type CompatManifest } from './compat/schema';
import { scanForPersonalData } from './compat/privacy';

const tmpRoot = path.join(process.cwd(), 'test-results', 'compat-' + Math.random().toString(36).slice(2));
fs.mkdirSync(tmpRoot, { recursive: true });
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const baseManifest = (o: Partial<CompatManifest> = {}): CompatManifest => ({
  id: 't', vendor: 'rivile', provenance: 'real-anonymized', status: 'ready', file: 'export.csv', decimalHint: ',',
  anonymization: { method: 'test', reviewedBy: 'tester', date: '2025-01-01' },
  expect: { headerRow: 1, fields: { document_date: 'Data', net_amount: 'Suma be PVM' }, basis: 'net', currency: 'EUR', rowsImported: 2 },
  controlTotals: { source: "ERP report 'sales summary' for January", netSales: 30, lines: 2 },
  ...o,
});
function writeFixture(root: string, vendor: string, name: string, manifest: CompatManifest, csv: string | Buffer) {
  const dir = path.join(root, vendor, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, manifest.file), csv);
}
const CSV = 'Data;Suma be PVM\r\n2025-01-02;10,00\r\n2025-01-03;20,00\r\n';

describe('repository fixtures and the generated status document', () => {
  const fixtures = discoverFixtures();
  it('every committed fixture has a valid manifest and passes', async () => {
    expect(fixtures.length).toBeGreaterThan(0);
    for (const f of fixtures) {
      expect(f.problems, f.manifest.id).toEqual([]);
      const r = await runFixture(f);
      expect(r.checks.filter((c) => !c.ok), f.manifest.id).toEqual([]);
      expect(r.passed).toBe(true);
    }
  });
  it('docs/COMPATIBILITY.md is up to date with the fixtures', async () => {
    const results: FixtureResult[] = [];
    for (const f of fixtures) results.push(await runFixture(f));
    const expected = renderCompatibilityDoc(vendorStatuses(loadVendors(), results), results);
    expect(fs.readFileSync('docs/COMPATIBILITY.md', 'utf8')).toBe(expected);
  });
  it('lists exactly the six target programs', () => {
    expect(loadVendors().map((v) => v.id)).toEqual(['rivile', 'finvalda', 'dynamics-nav-bc', 'comarch-optima', 'insert-subiekt', 'symfonia']);
  });
  it('a vendor is verified only through a passing REAL fixture – never through a synthetic one', async () => {
    const results: FixtureResult[] = [];
    for (const f of fixtures) results.push(await runFixture(f));
    for (const row of vendorStatuses(loadVendors(), results)) {
      if (row.status === 'verified') expect(row.realFixtures).toBeGreaterThan(0);
      if (row.realFixtures === 0) expect(row.status).not.toBe('verified');
    }
  });
});

describe('manifest validation', () => {
  it('accepts a minimal synthetic fixture and a complete real one', () => {
    expect(validateManifest(baseManifest({ provenance: 'synthetic' }))).toEqual([]);
    expect(validateManifest(baseManifest())).toEqual([]);
  });
  it('rejects a real fixture without anonymisation details, without the ERP report source, or without totals', () => {
    expect(validateManifest(baseManifest({ anonymization: undefined })).map((p) => p.field)).toContain('anonymization');
    expect(validateManifest(baseManifest({ controlTotals: { source: '', netSales: 1 } })).map((p) => p.field)).toContain('controlTotals.source');
    expect(validateManifest(baseManifest({ controlTotals: { source: "ERP report 'x' totals" } })).map((p) => p.field)).toContain('controlTotals');
    expect(validateManifest(baseManifest({ vendor: '_example' })).map((p) => p.field)).toContain('vendor');
  });
  it('rejects TODO placeholders, null control totals, bad basis and bad currency', () => {
    expect(validateManifest(baseManifest({ product: 'TODO: program name' })).map((p) => p.field)).toContain('manifest');
    expect(validateManifest(baseManifest({ controlTotals: { source: "ERP report 'x' totals", netSales: null, lines: 2 } })).map((p) => p.field)).toContain('controlTotals');
    expect(validateManifest(baseManifest({ controlTotals: { source: "ERP report 'x' totals", netSales: 5, lines: null } })).map((p) => p.field)).toContain('controlTotals.lines');
    expect(validateManifest(baseManifest({ expect: { ...baseManifest().expect, basis: 'maybe' as never } })).map((p) => p.field)).toContain('expect.basis');
    expect(validateManifest(baseManifest({ expect: { ...baseManifest().expect, currency: 'euro' } })).map((p) => p.field)).toContain('expect.currency');
  });
  it('rejects unknown provenance and missing expectations', () => {
    expect(validateManifest({ ...baseManifest(), provenance: 'looks-real' as never }).map((p) => p.field)).toContain('provenance');
    expect(validateManifest({ id: 'x', vendor: 'v' }).length).toBeGreaterThan(4);
  });
});

describe('runner', () => {
  it('passes when mapping, row count and the ERP report totals agree', async () => {
    writeFixture(tmpRoot, 'rivile', 'ok', baseManifest(), CSV);
    const [f] = discoverFixtures(path.join(tmpRoot));
    const r = await runFixture(f!);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
  });
  it('FAILS when the totals differ from the accounting program’s report', async () => {
    const root = path.join(tmpRoot, 'bad-total');
    writeFixture(root, 'rivile', 'x', baseManifest({ controlTotals: { source: "ERP report 'sales summary'", netSales: 31, lines: 2 } }), CSV);
    const r = await runFixture(discoverFixtures(root)[0]!);
    expect(r.passed).toBe(false);
    expect(r.checks.find((c) => c.name.includes('net sales'))!.ok).toBe(false);
  });
  it('FAILS when the proposed mapping is not what the manifest expects (nothing is silently corrected)', async () => {
    const root = path.join(tmpRoot, 'bad-map');
    writeFixture(root, 'rivile', 'x', baseManifest({ expect: { ...baseManifest().expect, fields: { document_date: 'Data', net_amount: 'Suma be PVM', customer_name: 'Suma be PVM' } } }), CSV);
    const r = await runFixture(discoverFixtures(root)[0]!);
    expect(r.passed).toBe(false);
  });
  it('FAILS on obvious personal data inside a fixture', async () => {
    const root = path.join(tmpRoot, 'pii');
    writeFixture(root, 'rivile', 'x', baseManifest(), 'Data;Suma be PVM;Klientas\r\n2025-01-02;10,00;jonas@example.com\r\n2025-01-03;20,00;x\r\n');
    const r = await runFixture(discoverFixtures(root)[0]!);
    expect(r.privacy.map((x) => x.kind)).toContain('email');
    expect(r.passed).toBe(false);
  });
  it('an invalid manifest is reported and nothing is run', async () => {
    const root = path.join(tmpRoot, 'invalid');
    writeFixture(root, 'rivile', 'x', baseManifest({ anonymization: undefined }), CSV);
    const r = await runFixture(discoverFixtures(root)[0]!);
    expect(r.problems.length).toBeGreaterThan(0);
    expect(r.checks).toEqual([]);
  });
  it('a folder / vendor mismatch is a problem', () => {
    const root = path.join(tmpRoot, 'mismatch');
    writeFixture(root, 'symfonia', 'x', baseManifest({ vendor: 'rivile' }), CSV);
    expect(discoverFixtures(root)[0]!.problems.map((p) => p.field)).toContain('vendor');
  });
});

describe('vendor status computation', () => {
  const vendors = [{ id: 'a', name: 'A', country: 'LT' }];
  const res = (o: Partial<FixtureResult>): FixtureResult => ({ id: 'f', vendor: 'a', provenance: 'real-anonymized', status: 'ready', problems: [], privacy: [], checks: [], passed: true, ...o });
  it('untested without fixtures, or with synthetic ones only', () => {
    expect(vendorStatuses(vendors, [])[0]!.status).toBe('untested');
    expect(vendorStatuses(vendors, [res({ provenance: 'synthetic' })])[0]!.status).toBe('untested');
  });
  it('verified only with a ready, valid, passing real fixture', () => {
    expect(vendorStatuses(vendors, [res({})])[0]!.status).toBe('verified');
    expect(vendorStatuses(vendors, [res({ status: 'draft' })])[0]!.status).toBe('untested');
  });
  it('a failing real fixture makes the vendor "failing", even if another passes', () => {
    expect(vendorStatuses(vendors, [res({}), res({ id: 'g', passed: false })])[0]).toMatchObject({ status: 'failing', failing: ['g'] });
    expect(vendorStatuses(vendors, [res({ problems: [{ field: 'x', message: 'y' }] })])[0]!.status).toBe('failing');
  });
});

describe('personal-data scanner', () => {
  it.each([
    ['email', 'contact: a.b@firma.lt'], ['url', 'see https://firma.lt/x'], ['iban', 'LT12 3456 7890 1234 5678'], ['phone', '+370 612 34567'],
    ['PL NIP', '525-000-12-34'], ['long digit run (company / personal id)', 'kodas 123456789'],
  ])('detects %s', (kind, text) => {
    expect(scanForPersonalData(text).map((f) => f.kind)).toContain(kind);
  });
  it('does not flag ordinary export content and never echoes a full match', () => {
    expect(scanForPersonalData('Data;Klientas;Suma\r\n2025-01-02;Customer 0001;1 234,56\r\n')).toEqual([]);
    expect(scanForPersonalData('a.b@firma.lt')[0]!.sample.length).toBeLessThanOrEqual(5);
  });
});

describe('scripts/compat-new.ts – the whole procedure on a disposable "real-looking" file', () => {
  const original = [
    'UAB Pavyzdys – pardavimų ataskaita', 'Laikotarpis: 2025-02-01 – 2025-02-28',
    'Data;Dokumento Nr.;Klientas;Prekė;Kiekis;Suma be PVM;Pastabos',
    '2025-02-03;SF-77001;UAB Tikroji Įmonė;Obuoliai Jonagold;10;1 234,50;skambinti jonas@tikra.lt',
    '2025-02-03;SF-77001;UAB Tikroji Įmonė;Kriaušės;4;200,00;',
    '2025-02-04;SF-77002;Antra Bendrovė;Obuoliai Jonagold;2;99,90;pastaba',
    'Iš viso;;;;16;1 534,40;',
  ].join('\r\n') + '\r\n';
  const SECRETS = ['Tikroji', 'Antra Bendrovė', 'Obuoliai', 'Kriaušės', 'SF-77001', 'jonas', 'pastaba', 'skambinti', 'Pavyzdys'];

  it('anonymises, preserves formats, and the finished fixture passes the runner and verifies a vendor (in a temp root only)', async () => {
    const input = path.join(tmpRoot, 'real.csv');
    fs.writeFileSync(input, iconv.encode(original, 'win1257'));
    const out = path.join(tmpRoot, 'out');
    execFileSync('npx', ['tsx', 'scripts/compat-new.ts', input, '--vendor', 'rivile', '--id', 'rivile-test-001', '--scale', '0.5', '--shift-days', '10', '--out', out], { cwd: process.cwd(), stdio: 'pipe' });
    const dir = path.join(out, 'rivile', 'rivile-test-001');
    const raw = fs.readFileSync(path.join(dir, 'export.csv'));
    const text = iconv.decode(raw, 'win1257');
    for (const s of SECRETS) expect(text, s).not.toContain(s);
    const lines = text.split('\r\n');
    expect(lines[2]).toBe('Data;Dokumento Nr.;Klientas;Prekė;Kiekis;Suma be PVM;Pastabos'); // header untouched, encoding kept
    expect(lines[3]).toMatch(/^2025-02-13;DOC 0001;Customer 0001;Product 0001;10;617,25;$/); // +10 days, amount ×0.5 in the SAME number format
    expect(lines[5]).toMatch(/^2025-02-14;DOC 0002;Customer 0002;Product 0001;2;49,95;$/); // same product → same pseudonym
    expect(lines[6]).toContain('767,20'); // totals row is scaled too
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as CompatManifest;
    expect(manifest.status).toBe('draft');
    expect(manifest.controlTotals.netSales).toBeNull(); // the tool never invents control totals

    // a draft is not verification
    let r = await runFixture(discoverFixtures(out)[0]!);
    expect(r.problems.length).toBeGreaterThan(0);
    expect(vendorStatuses([{ id: 'rivile', name: 'R', country: 'LT' }], [r])[0]!.status).not.toBe('verified');

    // the human completes it: ERP-report totals (× the same scale), basis, currency, status
    manifest.status = 'ready';
    manifest.product = 'Test program'; manifest.version = '1';
    // the draft still carries TODO placeholders until a person finishes it
    expect(JSON.stringify(manifest)).toContain('TODO');
    manifest.anonymization = { ...manifest.anonymization!, reviewedBy: 'tester' };
    manifest.controlTotals.source = '';
    manifest.expect = { ...manifest.expect, basis: 'net', currency: 'EUR' };
    manifest.controlTotals = { source: "ERP report 'sales summary' Feb 2025 (× 0.5)", netSales: (1234.5 + 200 + 99.9) * 0.5, lines: 3, documents: 2, tolerance: 0.01 };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    r = await runFixture(discoverFixtures(out)[0]!);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.passed).toBe(true);
    expect(vendorStatuses([{ id: 'rivile', name: 'R', country: 'LT' }], [r])[0]!.status).toBe('verified');
  }, 60_000);
});
