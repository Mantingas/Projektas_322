import { describe, expect, it } from 'vitest';
import { makeUniversal, toDataset, universalCsv, type ULocale } from './fixtures/universal';
import { profileUniversal, unresolvedColumns } from '@/engine/universal/profile';

const truth = makeUniversal();

describe('universal tables: column types are detected, and ambiguity needs a decision', () => {
  for (const l of ['lt', 'pl', 'en'] as ULocale[]) {
    it(`${l}: dates, identifiers, categories, numbers, currency, percent, booleans and free text`, async () => {
      const { ds, columns } = await toDataset(universalCsv(truth, l), `u_${l}.csv`, 'accept', l === 'en' ? '.' : ',');
      const t = Object.fromEntries(columns.map((c) => [c.index, c.suggested]));
      expect(t).toMatchObject({ 0: 'date', 1: 'identifier', 2: 'category', 3: 'numeric', 4: 'currency', 5: 'numeric', 6: 'percent', 7: 'boolean', 8: 'numeric', 9: 'category' });
      expect(columns[4]!.currency).toBe(l === 'pl' ? 'PLN' : 'EUR');
      expect(ds.rowCount).toBe(truth.rows.length);
      // nothing in this file is given business meaning: no column is called revenue, margin or debt anywhere in the dataset
      expect(JSON.stringify(ds.columns.map((c) => c.type))).not.toMatch(/revenue|profit|debt/);
    });
  }

  it('values are converted exactly: numbers, percents, booleans and dates match the source rows', async () => {
    const { ds } = await toDataset(universalCsv(truth, 'lt'), 'u.csv');
    const i = 37;
    expect(ds.cols[0]![i]).toBe(truth.rows[i]!.date);
    expect(ds.cols[3]![i]).toBe(truth.rows[i]!.qty);
    expect(ds.cols[4]![i]).toBe(truth.rows[i]!.price);
    expect(ds.cols[5]![i]).toBe(truth.rows[i]!.total);
    expect(ds.cols[6]![i]).toBe(truth.rows[i]!.discountPct);
    expect(ds.cols[7]![i]).toBe(truth.rows[i]!.delivered ? 1 : 0);
  });

  it('missing values are counted per column and never invented', async () => {
    const { ds } = await toDataset(universalCsv(truth, 'lt'), 'u.csv');
    const miss = (c: number) => truth.rows.filter((r) => (c === 6 ? r.discountPct === null : r.note === null)).length;
    expect(ds.columns[6]!.missing).toBe(miss(6));
    expect(ds.columns[9]!.missing).toBe(miss(9));
    expect(ds.cols[6]!.filter((v) => v === null).length).toBe(miss(6));
  });

  it('ambiguous columns block the import until each one is decided', async () => {
    // a 0/1 column, a year column, a unique-integer column and day/month order without evidence
    const csv = ['Flag;Year;Seq;Day', ...Array.from({ length: 30 }, (_, i) => `${i % 2};${2020 + (i % 4)};${1000 + i};0${1 + (i % 9)}.0${1 + (i % 9)}.2025`)].join('\n');
    const bytes = new TextEncoder().encode(csv);
    const first = await toDataset(bytes, 'amb.csv', {});
    expect([...first.unresolved!].sort()).toEqual([0, 1, 2, 3]);
    const cols = first.columns;
    expect(cols.map((c) => c.ambiguous)).toEqual([true, true, true, true]);
    expect(cols[0]!.alternatives).toContain('numeric');
    expect(cols[3]!.reason).toBe('dateOrder');
    expect(unresolvedColumns(cols, { 0: 'boolean', 1: 'category', 2: 'identifier' })).toEqual([3]);
    const ok = await toDataset(bytes, 'amb.csv', { 0: 'numeric', 1: 'date', 2: 'identifier', 3: 'date' });
    expect(ok.unresolved).toBeUndefined();
    expect(ok.ds.columns[0]!.type).toBe('numeric');
  });

  it('identifiers keep leading zeros and are never treated as numbers to sum', async () => {
    const csv = ['Code;Amount', ...Array.from({ length: 25 }, (_, i) => `${String(i).padStart(6, '0')};${i * 3},5`)].join('\n');
    const { columns } = await toDataset(new TextEncoder().encode(csv), 'ids.csv', 'accept');
    expect(columns[0]!.suggested).toBe('identifier');
    expect(columns[1]!.suggested).toBe('numeric');
  });

  it('mixed numeric / text columns are flagged instead of silently coerced', () => {
    const rows = Array.from({ length: 40 }, (_, i) => [i % 4 === 0 ? 'n/a' : String(i)]);
    const { columns } = profileUniversal(['Mixed'], rows, ',');
    expect(columns[0]!.ambiguous).toBe(true);
    expect(columns[0]!.alternatives.length).toBeGreaterThan(0);
  });

  it('values that do not fit the chosen type are counted as invalid, not dropped silently', async () => {
    const csv = ['Value;Other', ...Array.from({ length: 30 }, (_, i) => `${i === 3 ? 'abc' : String(i)};x${i % 3}`)].join('\n');
    const { ds } = await toDataset(new TextEncoder().encode(csv), 'inv.csv', { 0: 'numeric' });
    expect(ds.columns[0]!.invalid).toBe(1);
    expect(ds.cols[0]![3]).toBeNull();
  });
});
