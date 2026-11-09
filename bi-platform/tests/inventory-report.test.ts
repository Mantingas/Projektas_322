import { describe, expect, it } from 'vitest';
import { inventoryData, toRecords } from './fixtures/inventoryRecords';
import { buildInventoryDashboard } from '@/engine/inventory/dashboard';
import { analyzeInventoryPeriod } from '@/engine/inventory/insights';
import { buildInventoryReport, buildInventorySummaryDoc, inventoryExecutiveLines } from '@/lib/inventorySummary';
import { renderManagementSummary } from '@/engine/report/summary';
import { renderReportCsv } from '@/engine/report/export';
import { translate } from '@/i18n';

const data = inventoryData('lt');
const model = (records = data.records) => buildInventoryDashboard(records, { series: { currency: 'EUR', basis: 'net' }, filters: {}, period: { preset: 'r30' } })!;

describe('local inventory report', () => {
  it('is self-contained, escaped and script-free even with hostile product names', () => {
    const evil = data.records.map((r) => (r.productId === 'P04' ? { ...r, productName: '<script>alert(1)</script> & "x"' } : r));
    const m = model(evil);
    const a = analyzeInventoryPeriod(m);
    const html = renderManagementSummary(buildInventorySummaryDoc(m, a.insights, 'en', {}, {}));
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;');
    expect(html).toContain('Inventory management summary');
    expect(html).toContain("default-src 'none'");
    for (const m2 of html.matchAll(/(?:src|href)="([^"]+)"/g)) expect(m2[1]!.startsWith('#') || m2[1]!.startsWith('data:'), m2[1]).toBe(true);
  });

  it('CSV protects against spreadsheet formula injection', () => {
    const evil = data.records.map((r) => (r.productId === 'P04' ? { ...r, productName: '=HYPERLINK("http://x","y")' } : r));
    const m = model(evil);
    const csv = renderReportCsv(buildInventoryReport(m, analyzeInventoryPeriod(m).insights, 'en'));
    expect(csv).toContain('HYPERLINK'); // the text is kept …
    expect(csv).not.toMatch(/(^|;|\r\n)"?[=+@\t]/); // … but no cell can START like a formula
  });

  it('the executive summary and the report say only what the data supports', () => {
    const t = (k: never, p?: never) => translate('en', k, p);
    const full = model();
    const a = analyzeInventoryPeriod(full);
    const lines = inventoryExecutiveLines(full, a.insights, 'en', t as never);
    expect(lines.join(' ')).toContain('Non-moving stock value');
    // snapshots only → no turnover / slow-moving sentences, and the document lists the limitation
    const snapOnly = model(data.records.filter((r) => r.kind === 'snapshot'));
    const doc = buildInventorySummaryDoc(snapOnly, analyzeInventoryPeriod(snapOnly).insights, 'en', {}, {});
    expect(doc.executive.join(' ')).not.toMatch(/Slow-moving|Non-moving/);
    expect(doc.kpis.map((k) => k.label)).not.toContain('Inventory turnover (× per period)');
    expect(doc.limitations.join(' ')).toContain('No movement file is loaded');
  });

  it('the three languages produce a complete document with no raw keys', () => {
    const m = model();
    const a = analyzeInventoryPeriod(m);
    for (const l of ['lt', 'pl', 'en'] as const) {
      const html = renderManagementSummary(buildInventorySummaryDoc(m, a.insights, l, {}, {}));
      expect(html, l).not.toMatch(/\b(inventory|inv|ich|irule|lim|metric|explain|ian|irep)\.[a-z_]+/);
    }
  });
});
