import { describe, expect, it } from 'vitest';
import { detectDelimiter } from '@/engine/parsing/csv';
import { parseFile } from '@/engine/parsing/parseFile';
import { analyzeSheet } from '@/engine/pipeline';

const rows = async (csv: string) => (await parseFile(new TextEncoder().encode(csv), 'x.csv')).sheets[0]!.rows;

describe('delimiter detection', () => {
  it('narrow semicolon file with decimal commas is NOT split on the comma (regression)', async () => {
    const csv = 'Data;Suma be PVM\r\n2025-01-02;10,00\r\n2025-01-03;20,00\r\n';
    expect(detectDelimiter(csv)).toBe(';');
    expect((await rows(csv)).slice(0, 3)).toEqual([['Data', 'Suma be PVM'], ['2025-01-02', '10,00'], ['2025-01-03', '20,00']]);
    expect(analyzeSheet((await parseFile(new TextEncoder().encode(csv), 'x.csv')).sheets[0]!)).not.toBeNull();
  });
  it.each([
    ['semicolon', 'a;b;c\r\n1;2,5;3\r\n4;5,5;6\r\n', ';'],
    ['comma with dot decimals', 'a,b,c\r\n1,2.5,3\r\n4,5.5,6\r\n', ','],
    ['tab', 'a\tb\tc\r\n1\t2,5\t3\r\n4\t5,5\t6\r\n', '\t'],
    ['pipe', 'a|b|c\r\n1|2,5|3\r\n4|5,5|6\r\n', '|'],
    ['quoted thousands with comma delimiter', 'a,b\r\n"1,234.50",x\r\n"2,000.00",y\r\n', ','],
    ['title rows above a semicolon table', 'Report title\r\nPeriod 2025-01\r\n\r\nData;Klientas;Suma\r\n2025-01-02;A;1,5\r\n2025-01-03;B;2,5\r\n2025-01-04;C;3,5\r\n', ';'],
  ])('%s', (_n, csv, d) => {
    expect(detectDelimiter(csv)).toBe(d);
  });
  it('quoted fields containing the delimiter keep their content', async () => {
    const r = await rows('Data;Klientas;Suma\r\n2025-01-02;"A; B";1,5\r\n2025-01-03;C;2,5\r\n');
    expect(r[1]).toEqual(['2025-01-02', 'A; B', '1,5']);
  });
  it('single-column and empty-ish input does not crash', async () => {
    expect(detectDelimiter('a\r\nb\r\n')).toBe(',');
    expect(detectDelimiter('')).toBe(',');
  });
});
