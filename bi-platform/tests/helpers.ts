import { parseFile } from '@/engine/parsing/parseFile';
import { analyzeSheet, confirmedFromEntries } from '@/engine/pipeline';
import { normalizeSales } from '@/engine/validation/normalize';
import type { Fixture } from './fixtures/formats';

export async function runFixture(f: Fixture, opts: { today?: string } = {}) {
  const parsed = await parseFile(f.bytes, f.fileName);
  const sheet = (f.sheet ? parsed.sheets.find((s) => s.name === f.sheet) : parsed.sheets[0])!;
  const analysis = analyzeSheet(sheet, { decimalHint: ',' })!;
  const mapping = confirmedFromEntries(analysis.proposal.entries, analysis.proposal.detectedCurrency ?? f.defaultCurrency);
  const result = normalizeSales(analysis.table.dataRows, {
    profiles: analysis.profiles,
    mapping,
    rowNumbers: analysis.table.dataRowNumbers,
    skippedTotalRows: analysis.table.skippedTotalRows,
    today: opts.today ?? '2026-01-15',
  });
  return { parsed, sheet, analysis, mapping, ...result };
}

import { normalizePurchases } from '@/engine/validation/normalizePurchases';
import type { PFixture } from './fixtures/purchasingFormats';
import type { IFixture } from './fixtures/inventoryFormats';
import { normalizeInventory } from '@/engine/validation/normalizeInventory';
import type { FFixture } from './fixtures/financeFormats';
import { normalizeFinance } from '@/engine/validation/normalizeFinance';

export async function runPurchasingFixture(f: PFixture, opts: { today?: string } = {}) {
  const parsed = await parseFile(f.bytes, f.fileName);
  const sheet = (f.sheet ? parsed.sheets.find((s) => s.name === f.sheet) : parsed.sheets[0])!;
  const analysis = analyzeSheet(sheet, { decimalHint: ',', module: 'purchasing' })!;
  const mapping = confirmedFromEntries(analysis.proposal.entries, analysis.proposal.detectedCurrency ?? f.defaultCurrency);
  const result = normalizePurchases(analysis.table.dataRows, {
    profiles: analysis.profiles, mapping, rowNumbers: analysis.table.dataRowNumbers, skippedTotalRows: analysis.table.skippedTotalRows, today: opts.today ?? '2026-01-15',
  });
  return { parsed, sheet, analysis, mapping, ...result };
}

export async function runInventoryFixture(f: IFixture, opts: { today?: string } = {}) {
  const parsed = await parseFile(f.bytes, f.fileName);
  const sheet = parsed.sheets[0]!;
  const analysis = analyzeSheet(sheet, { decimalHint: ',', module: 'inventory' })!;
  const mapping = confirmedFromEntries(analysis.proposal.entries, analysis.proposal.detectedCurrency ?? f.defaultCurrency);
  const result = normalizeInventory(analysis.table.dataRows, {
    profiles: analysis.profiles, mapping, rowNumbers: analysis.table.dataRowNumbers, skippedTotalRows: analysis.table.skippedTotalRows, today: opts.today ?? '2026-01-15', asOfDate: f.asOfDate,
  });
  return { parsed, sheet, analysis, mapping, ...result };
}

export async function runFinanceFixture(f: FFixture, opts: { today?: string; mutate?: (rows: import('@/engine/types').CellValue[][]) => void } = {}) {
  const parsed = await parseFile(f.bytes, f.fileName);
  const sheet = parsed.sheets[0]!;
  const analysis = analyzeSheet(sheet, { decimalHint: ',', module: 'finance' })!;
  const mapping = confirmedFromEntries(analysis.proposal.entries, analysis.proposal.detectedCurrency ?? f.currency);
  opts.mutate?.(analysis.table.dataRows);
  const result = normalizeFinance(analysis.table.dataRows, {
    profiles: analysis.profiles, mapping, rowNumbers: analysis.table.dataRowNumbers, skippedTotalRows: analysis.table.skippedTotalRows, today: opts.today ?? '2026-01-15', asOfDate: f.asOfDate, side: f.side,
  });
  return { parsed, sheet, analysis, mapping, ...result };
}
