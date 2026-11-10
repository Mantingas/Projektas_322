import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { execSync } from 'node:child_process';
import { ASOF, TRUTH, openItemsFile } from './fixtures/erpVariants';
import { pseudonymise } from '@/engine/pilot/pseudonymize';
import { parseFile } from '@/engine/parsing/parseFile';
import { analyzeSheet, confirmedFromEntries } from '@/engine/pipeline';
import { normalizeFinance } from '@/engine/validation/normalizeFinance';

const hmac = (s: string, m: string) => createHmac('sha256', s).update(m).digest('hex');
const SECRET = 'a-long-random-secret-123456';
const run = (bytes: Uint8Array, over: Partial<Parameters<typeof pseudonymise>[2]> = {}) => pseudonymise(bytes, 'x.csv', { secret: SECRET, hmac, ...over });
const original = openItemsFile({ id: 'o', title: true, footer: true });

describe('pilot pseudonymisation (local, deterministic, relationship-preserving)', () => {
  it('replaces identifiers and names, keeps amounts, dates and currency, and no original value survives', async () => {
    const r = await run(original);
    for (const l of TRUTH) for (const secret of [l.cp, l.cpId, l.no, l.note.split('\n')[0]!]) if (secret) expect(r.csv, secret).not.toContain(secret);
    expect(r.csv).not.toMatch(/Pavyzdys|Neapmokėtų|Iš viso/);                            // title and footer rows are dropped
    expect(r.csv).toContain('1740,5');                                                    // amounts untouched
    expect(r.csv).toContain('2025-09-19');                                                // dates untouched
    expect(r.csv).toContain('EUR');
    expect(r.pseudonymisedFields.sort()).toEqual(['counterparty_id', 'counterparty_name', 'document_id'].sort());
    expect(r.blankedColumns).toBeGreaterThanOrEqual(1);                                   // the free-text description column
    expect(r.control.rows).toBe(TRUTH.length);
    expect(r.control.sums.outstanding_amount).toBeCloseTo(TRUTH.reduce((s, l) => s + l.outstanding, 0), 2);
  });

  it('the pseudonymised copy still imports with the same totals, due dates and relationships', async () => {
    const r = await run(original);
    const parsed = await parseFile(new TextEncoder().encode(r.csv), 'p.csv');
    const a = analyzeSheet(parsed.sheets[0]!, { decimalHint: ',', module: 'finance' })!;
    const n = normalizeFinance(a.table.dataRows, { profiles: a.profiles, mapping: confirmedFromEntries(a.proposal.entries, 'EUR'), rowNumbers: a.table.dataRowNumbers, skippedTotalRows: 0, today: '2026-01-15', side: 'payable' });
    expect(n.records).toHaveLength(TRUTH.length);
    expect(n.records.reduce((s, x) => s + (x.outstanding ?? 0), 0)).toBeCloseTo(r.control.sums.outstanding_amount!, 2);
    expect(n.records.every((x) => x.date === ASOF && x.dueDate)).toBe(true);
    expect(new Set(n.records.map((x) => x.counterpartyId)).size).toBe(TRUTH.length);
  });

  it('is deterministic and consistent ACROSS files: the same supplier and invoice get the same pseudonym everywhere', async () => {
    const a = await run(original);
    const b = await run(openItemsFile({ id: 'o2', lang: 'en', delim: ',', decimal: '.', date: 'iso', encoding: 'utf8', shuffle: true }));   // another file, other layout
    const again = await run(original);
    expect(again.csv).toBe(a.csv);
    const inv = (r: typeof a) => Object.keys(r.reverse).filter((k) => k.startsWith('D-')).sort();
    expect(inv(b)).toEqual(inv(a));
    expect(Object.keys(a.reverse).filter((k) => k.startsWith('ID-')).sort()).toEqual(Object.keys(b.reverse).filter((k) => k.startsWith('ID-')).sort());
  });

  it('a different secret gives different pseudonyms; a short secret is refused', async () => {
    const a = await run(original);
    const c = await run(original, { secret: 'another-secret-value-98765' });
    expect(c.csv).not.toBe(a.csv);
    await expect(run(original, { secret: 'short' })).rejects.toThrow('secret_too_short');
  });

  it('document numbers can be kept when the owner needs them; the reverse map is the only place originals appear', async () => {
    const kept = await run(original, { keepDocumentNumbers: true });
    expect(kept.csv).toContain('SF-1001');
    expect(kept.csv).not.toContain('Gama pienas');
    const r = await run(original);
    expect(Object.values(r.reverse)).toContain('UAB Epsilon');
    expect(JSON.stringify({ csv: r.csv, control: r.control, kept: r.keptFields })).not.toContain('UAB Epsilon');
  });

  it('files without a recognisable table or without counterparties produce explicit warnings', async () => {
    expect((await run(new TextEncoder().encode('hello'))).warnings).toContain('no_table');
    const noCp = await run(new TextEncoder().encode('Data;Suma\n2025-01-01;10,00\n2025-01-02;12,00\n'));
    expect(noCp.warnings.some((w) => w === 'no_counterparty' || w === 'no_table')).toBe(true);
  });

  it('the CLI writes only inside pilot-data/, refuses elsewhere, never prints original values, and pilot-data is git-ignored', async () => {
    const fs = await import('node:fs');
    fs.mkdirSync('pilot-data/test-src', { recursive: true });
    fs.writeFileSync('pilot-data/test-src/a.csv', openItemsFile({ id: 'cli', encoding: 'utf8' }));
    const env = { ...process.env, PILOT_SECRET: SECRET };
    const log = execSync('npx tsx scripts/pilot-pseudonymize.ts pilot-data/test-src/a.csv --out pilot-data/test-out --write-key', { env, encoding: 'utf8' });
    for (const l of TRUTH) { expect(log).not.toContain(l.cp); expect(log).not.toContain(l.no); }
    expect(fs.existsSync('pilot-data/test-out/file-1.csv')).toBe(true);
    expect(fs.existsSync('pilot-data/test-out/control-totals.json')).toBe(true);
    expect(fs.readFileSync('pilot-data/test-out/file-1.csv', 'utf8')).not.toContain('UAB Epsilon');
    expect(() => execSync('npx tsx scripts/pilot-pseudonymize.ts pilot-data/test-src/a.csv --out /tmp/leak', { env, stdio: 'pipe' })).toThrow();
    expect(() => execSync('npx tsx scripts/pilot-pseudonymize.ts pilot-data/test-src/a.csv --out pilot-data/x', { env: { ...process.env, PILOT_SECRET: '' }, stdio: 'pipe' })).toThrow();
    const tracked = execSync('git ls-files pilot-data', { encoding: 'utf8' }).trim();
    expect(tracked).toBe('');
    expect(execSync('git check-ignore pilot-data/test-out/pseudonym-key.json', { encoding: 'utf8' })).toContain('pilot-data');
    fs.rmSync('pilot-data', { recursive: true, force: true });
  }, 60_000);
});

describe('confidential artefacts can never be committed by accident', () => {
  it('no tracked file looks like a pseudonym key, a pilot-data file or an unmasked export', () => {
    const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(files.filter((f) => /pseudonym-key|\.pilot-key\.json$|^pilot-data\//.test(f))).toEqual([]);
    const gi = execSync('git check-ignore pilot-data/x.csv pseudonym-key.json', { encoding: 'utf8' });
    expect(gi).toContain('pilot-data/x.csv');
  });
});
