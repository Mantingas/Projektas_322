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
