import { describe, expect, it } from 'vitest';
import { ASOF, TOTAL_OUTSTANDING, TRUTH, openItemsFile, type Variant } from './fixtures/erpVariants';
import { parseFile } from '@/engine/parsing/parseFile';
import { analyzeSheet, confirmedFromEntries } from '@/engine/pipeline';
import { normalizeFinance } from '@/engine/validation/normalizeFinance';
import { isMappingConfirmable, validateMapping } from '@/engine/mapping/mapper';

async function run(v: Variant, name = 'export.csv') {
  const parsed = await parseFile(openItemsFile(v), name);
  const sheet = parsed.sheets[0]!;
  const a = analyzeSheet(sheet, { decimalHint: v.decimal === '.' ? '.' : ',', module: 'finance' });
  if (!a) return { a: null as never, r: null as never, warnings: [] };
  const warnings = validateMapping(a.proposal.entries, 'finance', { hasDefaultDate: false });
  const mapping = confirmedFromEntries(a.proposal.entries, a.proposal.detectedCurrency ?? 'EUR');
  const r = normalizeFinance(a.table.dataRows, { profiles: a.profiles, mapping, rowNumbers: a.table.dataRowNumbers, skippedTotalRows: a.table.skippedTotalRows, today: '2026-01-15', side: 'receivable' });
  return { a, r, warnings };
}
const sumOut = (r: Awaited<ReturnType<typeof run>>['r']) => Math.round(r.records.reduce((s, x) => s + (x.outstanding ?? 0), 0) * 100) / 100;

const VARIANTS: Variant[] = [
  { id: 'lt utf8-bom ; dmy-dot comma' },
  { id: 'lt utf8 no BOM', encoding: 'utf8' },
  { id: 'lt windows-1257', encoding: 'cp1257' },
  { id: 'pl windows-1250', encoding: 'cp1250', lang: 'pl', date: 'dmy_dot' },
  { id: 'en utf8 comma-delim dot-decimal iso', lang: 'en', delim: ',', decimal: '.', date: 'iso', encoding: 'utf8' },
  { id: 'en tab-delim thousands comma', lang: 'en', delim: '\t', decimal: '.', thousands: ',', date: 'iso' },
  { id: 'lt thousands space dmy-slash', thousands: ' ', date: 'dmy_slash' },
  { id: 'pl thousands dot decimal comma', lang: 'pl', thousands: '.', date: 'dmy_dot' },
  { id: 'export title lines and a totals footer', title: true, footer: true },
  { id: 'empty extra column and a blank row', emptyColumn: true, junkRows: true },
  { id: 'columns in reverse order', shuffle: true },
  { id: 'mixed LT / EN / PL headings', lang: 'mixed' },
  { id: 'multiline + quoted descriptions (always present in the truth)', title: true },
];

describe('export variants: the same ground truth survives every shape of file', () => {
  for (const v of VARIANTS) {
    it(v.id, async () => {
      const { r, warnings, a } = await run(v);
      expect(a).toBeTruthy();
      expect(isMappingConfirmable(warnings)).toBe(true);
      expect(r.kind).toBe('open_items');
      expect(r.records).toHaveLength(TRUTH.length);
      expect(sumOut(r)).toBeCloseTo(TOTAL_OUTSTANDING, 2);                                   // totals / footer rows are never counted
      expect(r.records.map((x) => x.invoiceNo).sort()).toEqual(TRUTH.map((x) => x.no).sort());
      const big = r.records.find((x) => x.invoiceNo === 'SF-1004')!;
      expect(big.outstanding).toBe(15999.99);
      expect(big.dueDate).toBe('2025-09-19');
      expect(r.records.every((x) => x.date === ASOF)).toBe(true);
      expect(r.records.every((x) => x.currency === 'EUR')).toBe(true);
      expect(r.stats.errors).toEqual({});
    });
  }

  it('month-first dates (m/d/yyyy) are recognised from the values and read correctly', async () => {
    const { r } = await run({ id: 'x', lang: 'en', delim: ',', decimal: '.', date: 'mdy_slash', encoding: 'utf8' });
    expect(r.records.find((x) => x.invoiceNo === 'SF-1004')!.dueDate).toBe('2025-09-19');
    expect(r.records.find((x) => x.invoiceNo === 'SF-1002')!.invoiceDate).toBe('2025-07-30');
  });

  it('a file without customer codes still imports; the missing identifiers are reported, not invented', async () => {
    const { r, a } = await run({ id: 'x', noIds: true });
    expect(r.records).toHaveLength(TRUTH.length);
    expect(r.records.every((x) => x.counterpartyId === undefined && x.counterpartyName)).toBe(true);
    expect(a.profiles.length).toBeGreaterThan(5);
  });

  it('negative amounts in parentheses are read as negative balances (credit balances) and reported', async () => {
    const lines = TRUTH.map((l, i) => (i === 2 ? { ...l, outstanding: -234.56 } : l));
    const parsed = await parseFile(openItemsFile({ id: 'p', parenNegative: true }, lines), 'neg.csv');
    const a = analyzeSheet(parsed.sheets[0]!, { decimalHint: ',', module: 'finance' })!;
    const mapping = confirmedFromEntries(a.proposal.entries, 'EUR');
    const r = normalizeFinance(a.table.dataRows, { profiles: a.profiles, mapping, rowNumbers: a.table.dataRowNumbers, skippedTotalRows: 0, today: '2026-01-15', side: 'payable' });
    expect(r.records.find((x) => x.invoiceNo === 'SF-1003')!.outstanding).toBe(-234.56);
    expect(r.stats.warnings.negative_outstanding).toBe(1);
  });

  it('a very large file (60 000 lines) imports with the same totals', async () => {
    const lines = Array.from({ length: 60_000 }, (_, i) => ({ ...TRUTH[i % TRUTH.length]!, no: `SF-${i}` }));
    const parsed = await parseFile(openItemsFile({ id: 'big' }, lines), 'big.csv');
    const a = analyzeSheet(parsed.sheets[0]!, { decimalHint: ',', module: 'finance' })!;
    const mapping = confirmedFromEntries(a.proposal.entries, 'EUR');
    const r = normalizeFinance(a.table.dataRows, { profiles: a.profiles, mapping, rowNumbers: a.table.dataRowNumbers, skippedTotalRows: 0, today: '2026-01-15', side: 'receivable' });
    expect(r.records).toHaveLength(60_000);
    expect(Math.round(sumOut(r) * 100)).toBe(Math.round(lines.reduce((s, l) => s + l.outstanding, 0) * 100));
  }, 60_000);
});

describe('damaged and partial exports are qualified, never silently repaired', () => {
  const textOf = (v: Variant) => new TextDecoder().decode(openItemsFile(v)).replace(/^﻿/, '');
  const load = async (text: string) => {
    const parsed = await parseFile(new TextEncoder().encode(text), 'x.csv');
    const a = analyzeSheet(parsed.sheets[0]!, { decimalHint: ',', module: 'finance' })!;
    const mapping = confirmedFromEntries(a.proposal.entries, 'EUR');
    return normalizeFinance(a.table.dataRows, { profiles: a.profiles, mapping, rowNumbers: a.table.dataRowNumbers, skippedTotalRows: a.table.skippedTotalRows, today: '2026-01-15', side: 'receivable' });
  };
  it('duplicate column headings do not break the mapping or the totals', async () => {
    const t = textOf({ id: 'd' }).replace('Aprašymas', 'Valiuta');   // two columns called "Valiuta"
    const r = await load(t);
    expect(r.records).toHaveLength(TRUTH.length);
    expect(sumOut(r as never)).toBeCloseTo(TOTAL_OUTSTANDING, 2);
  });
  it('a row without an invoice number is imported but counted as missing an identifier', async () => {
    const t = textOf({ id: 'd' }).replace(';SF-1002;', ';;');
    const r = await load(t);
    expect(r.stats.warnings.missing_invoice_number).toBe(1);
    expect(r.records).toHaveLength(TRUTH.length);
  });
  it('a non-numeric amount ("n/a") is reported as an error and the row is not counted as zero', async () => {
    const t = textOf({ id: 'd' }).replace('15999,99;15999,99', '15999,99;n/a');
    const r = await load(t);
    expect(r.stats.errors.invalid_amount ?? r.stats.errors.empty_amount).toBeGreaterThanOrEqual(1);
    expect(r.records.some((x) => x.invoiceNo === 'SF-1004')).toBe(false);
    expect(sumOut(r as never)).toBeCloseTo(TOTAL_OUTSTANDING - 15999.99, 2);
    expect(r.stats.rowsSkipped).toBe(1);
  });
  it('an impossible due date is reported; the line is kept but without an invented due date', async () => {
    const r = await load(textOf({ id: 'd', date: 'iso' }).replace('2025-09-13', '2025-13-45'));
    const rec = r.records.find((x) => x.invoiceNo === 'SF-1002')!;
    expect(rec.dueDate).toBeUndefined();
    expect(Object.values({ ...r.stats.warnings, ...r.stats.errors }).reduce((s, n) => s + (n ?? 0), 0)).toBeGreaterThanOrEqual(1);
    expect(sumOut(r as never)).toBeCloseTo(TOTAL_OUTSTANDING, 2);
  });
});
