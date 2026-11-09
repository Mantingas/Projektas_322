import { describe, expect, it } from 'vitest';
import { inferColumnDecimal, interpretNumberString, parseNumber } from '@/engine/schema/numbers';
import { excelSerialToIso, inferDateOrder, parseDate } from '@/engine/schema/dates';
import { detectTable } from '@/engine/schema/header';
import { decodeCsv } from '@/engine/parsing/csv';
import iconv from 'iconv-lite';

describe('numbers', () => {
  it.each([
    ['1 234,56', 1234.56], ['1 234,56', 1234.56], ['1.234,56', 1234.56], ['1,234.56', 1234.56], ['1234.56', 1234.56], ['1234,5', 1234.5],
    ['-12,50', -12.5], ['(12,50)', -12.5], ['12,50-', -12.5], ['12,50 €', 12.5], ['1 234,56 zł', 1234.56], ['1.234.567', 1234567], ['0,5', 0.5], ['12', 12],
  ])('parses %s', (s, n) => {
    expect(parseNumber(s, ',')).toBe(n);
  });
  it('flags 1.234 as ambiguous instead of guessing', () => {
    expect(interpretNumberString('1.234')).toMatchObject({ ambiguous: true });
    expect(interpretNumberString('1,234')).toMatchObject({ ambiguous: true });
  });
  it('resolves ambiguity from the rest of the column', () => {
    expect(inferColumnDecimal(['1.234', '5,50', '7,25'], '.').decimal).toBe(',');
    expect(inferColumnDecimal(['1.234', '5.50'], ',').decimal).toBe('.');
    expect(parseNumber('1.234', ',')).toBe(1234); // comma-decimal column → dot is thousands
    expect(parseNumber('1.234', '.')).toBe(1.234);
  });
  it('rejects non-numbers', () => {
    expect(parseNumber('abc', ',')).toBeNull();
    expect(parseNumber('12abc', ',')).toBeNull();
    expect(parseNumber('', ',')).toBeNull();
    expect(parseNumber('1,2,3', ',')).toBeNull();
  });
});

describe('dates', () => {
  it('parses common LT/PL/EN formats', () => {
    expect(parseDate('2025-03-15')).toBe('2025-03-15');
    expect(parseDate('15.03.2025')).toBe('2025-03-15');
    expect(parseDate('15/03/2025')).toBe('2025-03-15');
    expect(parseDate('15-03-2025')).toBe('2025-03-15');
    expect(parseDate('2025.03.15')).toBe('2025-03-15');
    expect(parseDate('2025-03-15 10:30:00')).toBe('2025-03-15');
    expect(parseDate('15.03.25')).toBe('2025-03-15');
  });
  it('rejects impossible dates', () => {
    expect(parseDate('31.02.2025')).toBeNull();
    expect(parseDate('2025-13-01')).toBeNull();
    expect(parseDate('hello')).toBeNull();
  });
  it('resolves day/month order from the column', () => {
    expect(inferDateOrder(['03/04/2025', '25/04/2025'])).toBe('dmy');
    expect(inferDateOrder(['03/04/2025', '04/25/2025'])).toBe('mdy');
    expect(parseDate('03/04/2025', 'mdy')).toBe('2025-03-04');
    expect(parseDate('03/04/2025', 'dmy')).toBe('2025-04-03');
  });
  it('converts Excel serials', () => {
    expect(excelSerialToIso(45000)).toBe('2023-03-15');
    expect(excelSerialToIso(61)).toBe('1900-03-01');
  });
});

describe('header detection', () => {
  it('skips report titles above the table', () => {
    const rows = [
      ['Pardavimų ataskaita', null, null, null],
      ['Laikotarpis: 2025-01', null, null, null],
      [null, null, null, null],
      ['Data', 'Klientas', 'Kiekis', 'Suma be PVM'],
      ['2025-01-02', 'UAB A', 1, 10.5],
      ['2025-01-03', 'UAB B', 2, 20],
      ['Iš viso', null, 3, 30.5],
    ];
    const t = detectTable(rows)!;
    expect(t.headerRow).toBe(3);
    expect(t.headers).toEqual(['Data', 'Klientas', 'Kiekis', 'Suma be PVM']);
    expect(t.dataRows).toHaveLength(2);
    expect(t.skippedTotalRows).toBe(1);
    expect(t.dataRowNumbers).toEqual([5, 6]);
  });
  it('names blank and duplicate headers', () => {
    const t = detectTable([['Data', null, 'Suma', 'Suma'], ['2025-01-02', 'x', 1, 2], ['2025-01-03', 'y', 3, 4]])!;
    expect(t.headers).toEqual(['Data', 'Column 2', 'Suma', 'Suma (2)']);
  });
});

describe('csv encodings', () => {
  it('detects Windows-1257 (LT) and Windows-1250 (PL)', () => {
    expect(decodeCsv(new Uint8Array(iconv.encode('Pirkėjas;Žuvis;Šilas;Ąžuolas;Ūkis', 'win1257'))).text).toContain('Žuvis');
    const pl = decodeCsv(new Uint8Array(iconv.encode('Kontrahent;Łódź;Żółć;Źródło;Ćma', 'win1250')));
    expect(pl.encoding).toBe('windows-1250');
    expect(pl.text).toContain('Łódź');
  });
  it('prefers UTF-8 when valid', () => {
    expect(decodeCsv(new TextEncoder().encode('Šviesa')).encoding).toBe('utf-8');
  });
});
