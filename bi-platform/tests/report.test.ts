import { describe, expect, it } from 'vitest';
import { csvCell, escapeHtml, renderReportCsv, renderReportHtml, type ReportInput } from '@/engine/report/export';
import { sanitizeText } from '@/engine/parsing/text';
import { cellToValue } from '@/engine/parsing/xlsx';
import { parseFile, ParseError } from '@/engine/parsing/parseFile';
import ExcelJS from 'exceljs';

describe('formula injection and HTML escaping in exports', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=1', '\r=1'])('neutralises %j', (s) => {
    expect(csvCell(s).replace(/^"/, '').startsWith("'")).toBe(true);
  });
  it('quotes delimiters, quotes and newlines', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
  it('keeps plain numbers numeric (even negative)', () => {
    expect(csvCell(-5)).toBe('-5');
  });
  const evil = '<img src=x onerror=alert(1)>=HYPERLINK("http://evil")';
  const input: ReportInput = {
    title: evil, subtitle: 's', generatedAt: 'now', lang: 'en',
    kpis: [{ label: evil, value: evil }],
    insights: [{ title: evil, body: evil, action: evil, reliability: 'high', impact: '1', evidence: [evil] }],
    labels: { insights: 'I', action: 'A', reliability: 'R', impact: 'M', footer: 'F', kpis: 'K' },
  };
  it('HTML report contains no unescaped markup from data', () => {
    const html = renderReportHtml(input);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain("default-src 'none'"); // report cannot load anything or run scripts
    expect(html).not.toMatch(/<script/i);
  });
  it('CSV report prefixes every dangerous cell', () => {
    const csv = renderReportCsv(input);
    for (const line of csv.split('\r\n')) for (const cell of line.split(';')) expect(/^"?[=+\-@]/.test(cell.replace(/^﻿/, ''))).toBe(false);
  });
  it('escapeHtml', () => expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;'));
});

describe('untrusted spreadsheet input', () => {
  it('strips control characters', () => expect(sanitizeText('a\u0000b\u0007c')).toBe('abc'));

  it('reads cached formula results and never evaluates formulas', () => {
    expect(cellToValue({ formula: 'SUM(A1:A2)', result: 42 } as ExcelJS.CellValue)).toBe(42);
    expect(cellToValue({ formula: 'HYPERLINK("http://x","y")' } as ExcelJS.CellValue)).toBeNull();
    expect(cellToValue({ error: '#DIV/0!' } as ExcelJS.CellValue)).toBeNull();
  });

  it('a workbook formula cell without a cached value yields no value (formula text is not exposed)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow(['Data', 'Suma']);
    ws.addRow(['2025-01-01', { formula: '1+1' }]);
    ws.addRow(['2025-01-02', 5]);
    const buf = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const parsed = await parseFile(buf, 'f.xlsx');
    const flat = JSON.stringify(parsed.sheets[0]!.rows);
    expect(flat).not.toContain('1+1');
  });

  it('rejects legacy .xls, wrong formats, empty and oversized files with clear codes', async () => {
    await expect(parseFile(new Uint8Array([1, 2, 3]), 'x.xls')).rejects.toMatchObject({ code: 'legacy_xls' });
    await expect(parseFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0]), 'x.xlsx')).rejects.toMatchObject({ code: 'legacy_xls' });
    await expect(parseFile(new Uint8Array([1, 2, 3]), 'x.pdf')).rejects.toMatchObject({ code: 'unsupported_format' });
    await expect(parseFile(new Uint8Array(0), 'x.csv')).rejects.toMatchObject({ code: 'empty_file' });
    await expect(parseFile(new Uint8Array([1, 2, 3]), 'x.xlsx')).rejects.toBeInstanceOf(ParseError);
    await expect(parseFile(new Uint8Array([0x50, 0x4b, 1, 2]), 'x.xlsx')).rejects.toMatchObject({ code: 'corrupt_file' });
  });
});
