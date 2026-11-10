import { describe, expect, it } from 'vitest';
import { financeData } from './fixtures/financeRecords';
import { buildFinanceDashboard } from '@/engine/finance/dashboard';
import { analyzeFinancePeriod } from '@/engine/finance/insights';
import { buildFinanceReport, buildFinanceSummaryDoc, financeExecutiveLines } from '@/lib/financeSummary';
import { renderManagementSummary } from '@/engine/report/summary';
import { renderReportCsv } from '@/engine/report/export';
import { translate } from '@/i18n';
import type { FinanceRecord } from '@/engine/types';

const data = financeData('receivable');
const model = (records: FinanceRecord[] = data.records) => buildFinanceDashboard(records, { series: { currency: 'EUR', basis: 'net' }, side: 'receivable', filters: {}, period: { preset: 'r30' } })!;
const rename = (name: string) => data.records.map((r) => (r.counterpartyId === 'C06' || r.counterpartyName?.includes('Žalioji') ? { ...r, counterpartyName: name } : r));

describe('local finance report', () => {
  it('is self-contained, escaped and script-free even with hostile counterparty names', () => {
    const m = model(rename('<script>alert(1)</script> & "x"'));
    const html = renderManagementSummary(buildFinanceSummaryDoc(m, analyzeFinancePeriod(m).insights, 'en', {}, {}));
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("default-src 'none'");
    for (const x of html.matchAll(/(?:src|href)="([^"]+)"/g)) expect(x[1]!.startsWith('#') || x[1]!.startsWith('data:'), x[1]).toBe(true);
  });

  it('CSV protects against spreadsheet formula injection', () => {
    const m = model(rename('=HYPERLINK("http://x","y")'));
    const csv = renderReportCsv(buildFinanceReport(m, analyzeFinancePeriod(m).insights, 'en'));
    expect(csv).not.toMatch(/(^|;|\r\n)"?[=+@\t]/);
  });

  it('executive lines are produced and carry certainty labels in the document', () => {
    const m = model();
    const a = analyzeFinancePeriod(m);
    const t = (k: never, p?: never) => translate('en', k, p);
    expect(financeExecutiveLines(m, a.insights, 'en', t as never).length).toBeGreaterThan(0);
    const doc = buildFinanceSummaryDoc(m, a.insights, 'en', {}, {});
    const dup = doc.insights.find((i) => /uplic|repeat|look/i.test(i.title));
    if (dup) expect(dup.sufficiency).toMatch(/possible|Possible/);
  });

  it('the three languages produce a complete document with no raw keys', () => {
    const m = model();
    const a = analyzeFinancePeriod(m);
    for (const l of ['lt', 'pl', 'en'] as const) {
      const html = renderManagementSummary(buildFinanceSummaryDoc(m, a.insights, l, {}, {}));
      expect(html, l).not.toMatch(/\b(finance|fin|fch|frule|funavail|cert|fan|frep|metric|explain|lim)\.[a-z_]+/);
    }
  });
});
