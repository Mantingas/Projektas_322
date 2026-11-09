import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseFile } from '@/engine/parsing/parseFile';
import { inspectZip } from '@/engine/parsing/zip';

async function workbook(build?: (ws: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  ws.addRow(['Data', 'Suma']);
  ws.addRow(['2025-01-01', 5]);
  ws.addRow(['2025-01-02', 6]);
  build?.(ws);
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
const rezip = async (bytes: Uint8Array, edit: (z: JSZip) => void | Promise<void>) => {
  const z = await JSZip.loadAsync(bytes);
  await edit(z);
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
};

/** Finds the central-directory record of an entry so header fields can be patched. */
function cdRecord(bytes: Uint8Array, name: string): number {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      let p = dv.getUint32(i + 16, true);
      for (let n = 0; n < dv.getUint16(i + 10, true); n++) {
        const nl = dv.getUint16(p + 28, true);
        if (new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nl)) === name) return p;
        p += 46 + nl + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
      }
    }
  }
  throw new Error('entry not found ' + name);
}
const patch16 = (b: Uint8Array, off: number, v: number) => new DataView(b.buffer, b.byteOffset).setUint16(off, v, true);
const patch32 = (b: Uint8Array, off: number, v: number) => new DataView(b.buffer, b.byteOffset).setUint32(off, v, true);

describe('legitimate workbooks are unaffected', () => {
  it('pass the deep inspection and parse', async () => {
    const b = await workbook();
    expect(() => inspectZip(b)).not.toThrow();
    expect((await parseFile(b, 'ok.xlsx')).sheets[0]!.rows).toHaveLength(3);
  });
});

describe('archives are validated by MEASURED decompression, not by declarations', () => {
  it('rejects an entry whose header declares 1 000 bytes but inflates to 150 MB – quickly and with bounded memory', async () => {
    const bytes = await rezip(await workbook(), (z) => { z.file('xl/junk.bin', new Uint8Array(150 * 1024 * 1024), { compression: 'DEFLATE' }); });
    patch32(bytes, cdRecord(bytes, 'xl/junk.bin') + 24, 1000); // the lie
    const before = process.memoryUsage().rss;
    const t = Date.now();
    await expect(parseFile(bytes, 'lie.xlsx')).rejects.toMatchObject({ code: 'zip_limits' });
    expect(Date.now() - t).toBeLessThan(5000);
    expect(process.memoryUsage().rss - before).toBeLessThan(120 * 1024 * 1024);
  });
  it('rejects a declared-honest but oversized entry and an oversized total', async () => {
    const big = await rezip(await workbook(), (z) => { z.file('xl/a.bin', new Uint8Array(90 * 1024 * 1024), { compression: 'DEFLATE' }); });
    await expect(parseFile(big, 'big.xlsx')).rejects.toMatchObject({ code: 'zip_limits' });
    const many = await rezip(await workbook(), (z) => { for (let i = 0; i < 3; i++) z.file(`xl/p${i}.bin`, new Uint8Array(60 * 1024 * 1024), { compression: 'DEFLATE' }); });
    await expect(parseFile(many, 'many.xlsx')).rejects.toMatchObject({ code: 'zip_limits' });
  });
  it('rejects when the declaration is SMALLER than the real data even by a little', async () => {
    const bytes = await rezip(await workbook(), (z) => { z.file('xl/x.txt', 'a'.repeat(50_000), { compression: 'DEFLATE' }); });
    patch32(bytes, cdRecord(bytes, 'xl/x.txt') + 24, 100);
    expect(() => inspectZip(bytes)).toThrowError(expect.objectContaining({ code: 'zip_limits' }));
  });
  it('enforces a processing-time budget', async () => {
    const b = await rezip(await workbook(), (z) => { z.file('xl/n.bin', new Uint8Array(2 * 1024 * 1024), { compression: 'DEFLATE' }); });
    expect(() => inspectZip(b, { maxMillis: -1 })).toThrowError(expect.objectContaining({ code: 'timeout' }));
  });
});

describe('malformed and adversarial archives', () => {
  it('encrypted entries → password_protected', async () => {
    const b = await workbook();
    patch16(b, cdRecord(b, 'xl/workbook.xml') + 8, 1);
    await expect(parseFile(b, 'enc.xlsx')).rejects.toMatchObject({ code: 'password_protected' });
  });
  it('unsupported compression methods are refused', async () => {
    const b = await workbook();
    patch16(b, cdRecord(b, 'xl/workbook.xml') + 10, 99);
    await expect(parseFile(b, 'm.xlsx')).rejects.toMatchObject({ code: 'unsafe_archive' });
  });
  it('path traversal names are refused', async () => {
    const b = await rezip(await workbook(), (z) => { z.file('xl/ab.xml', '<x/>'); });
    const p = cdRecord(b, 'xl/ab.xml');
    b.set(new TextEncoder().encode('../ab.xml'), p + 46);
    await expect(parseFile(b, 'trav.xlsx')).rejects.toMatchObject({ code: 'unsafe_archive' });
  });
  it('duplicate entry names are refused', async () => {
    const b = await rezip(await workbook(), (z) => { z.file('xl/aa.xml', '<x/>'); z.file('xl/bb.xml', '<x/>'); });
    b.set(new TextEncoder().encode('xl/aa.xml'), cdRecord(b, 'xl/bb.xml') + 46);
    await expect(parseFile(b, 'dup.xlsx')).rejects.toMatchObject({ code: 'unsafe_archive' });
  });
  it('a zip that is not a workbook is refused', async () => {
    const z = new JSZip();
    z.file('hello.txt', 'hi');
    await expect(parseFile(await z.generateAsync({ type: 'uint8array' }), 'x.xlsx')).rejects.toMatchObject({ code: 'corrupt_file' });
  });
  it('truncated and garbage files are refused', async () => {
    const b = await workbook();
    await expect(parseFile(b.subarray(0, Math.floor(b.length / 2)), 't.xlsx')).rejects.toMatchObject({ code: 'corrupt_file' });
    await expect(parseFile(new Uint8Array([0x50, 0x4b, 3, 4, ...Array(200).fill(7)]), 'g.xlsx')).rejects.toMatchObject({ code: 'corrupt_file' });
  });
  it('corrupted deflate data is refused, not crashed on', async () => {
    const b = await workbook();
    const p = cdRecord(b, 'xl/worksheets/sheet1.xml');
    const dv = new DataView(b.buffer, b.byteOffset);
    const lo = dv.getUint32(p + 42, true);
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    for (let i = 0; i < 6; i++) b[start + i] = 0xff;
    await expect(parseFile(b, 'bad.xlsx')).rejects.toBeTruthy();
  });
  it('XML entity declarations (billion laughs / XXE) are refused before any parser sees them', async () => {
    const lol = '<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]><worksheet>&c;</worksheet>';
    const b = await rezip(await workbook(), (z) => { z.file('xl/worksheets/sheet1.xml', lol); });
    const t = Date.now();
    await expect(parseFile(b, 'lol.xlsx')).rejects.toMatchObject({ code: 'unsafe_archive' });
    expect(Date.now() - t).toBeLessThan(2000);
    const xxe = await rezip(await workbook(), (z) => { z.file('xl/sharedStrings.xml', '<!DOCTYPE s [<!ENTITY x SYSTEM "file:///etc/passwd">]><sst>&x;</sst>'); });
    await expect(parseFile(xxe, 'xxe.xlsx')).rejects.toMatchObject({ code: 'unsafe_archive' });
  });
});

describe('workbook dimensions are bounded', () => {
  it('a sheet that declares a row a million rows down does not allocate a million rows', async () => {
    const b = await workbook((ws) => { ws.getCell('A1000000').value = 'far away'; });
    const t = Date.now();
    const rss = process.memoryUsage().rss;
    const parsed = await parseFile(b, 'sparse.xlsx');
    expect(Date.now() - t).toBeLessThan(4000);
    expect(process.memoryUsage().rss - rss).toBeLessThan(200 * 1024 * 1024);
    expect(parsed.sheets[0]!.truncated).toBe(true);
    expect(parsed.sheets[0]!.rows.length).toBeLessThanOrEqual(10);
  });
  it('ordinary row counts are read in full and not flagged', async () => {
    const b = await workbook((ws) => { for (let i = 0; i < 1200; i++) ws.addRow(['2025-01-03', i]); });
    const parsed = await parseFile(b, 'rows.xlsx');
    expect(parsed.sheets[0]!.rows.length).toBe(1203);
    expect(parsed.sheets[0]!.truncated).toBe(false);
  });
  it('columns are capped at 200', async () => {
    const b = await workbook((ws) => { ws.addRow(Array.from({ length: 600 }, (_, i) => `c${i}`)); });
    const parsed = await parseFile(b, 'cols.xlsx');
    expect(Math.max(...parsed.sheets[0]!.rows.map((r) => r.length))).toBeLessThanOrEqual(200);
  });
  it('very long cell text is truncated and control characters stripped', async () => {
    const b = await workbook((ws) => { ws.addRow(['x'.repeat(50_000) + '\u0007', 1]); });
    const rows = (await parseFile(b, 'long.xlsx')).sheets[0]!.rows;
    const cell = rows[rows.length - 1]![0] as string;
    expect(cell.length).toBeLessThanOrEqual(2000);
    expect(cell).not.toContain('\u0007');
  });
  it('blank rows inside a sheet keep their original row numbers', async () => {
    const b = await workbook((ws) => { ws.getCell('A8').value = 'later'; });
    const rows = (await parseFile(b, 'gap.xlsx')).sheets[0]!.rows;
    expect(rows[7]![0]).toBe('later');
  });
});
