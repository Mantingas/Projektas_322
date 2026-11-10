import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { EngineSession } from '@/lib/engineSession';
import { buildExecutiveReport, buildExecutiveSummaryDoc, executiveLines } from '@/lib/executiveSummary';
import { renderManagementSummary } from '@/engine/report/summary';
import { renderReportCsv } from '@/engine/report/export';
import { customerLink, makeExecutive, productLinks, seedDb } from './fixtures/executive';
import { translate } from '@/i18n';
import type { ExecutiveModel } from '@/engine/executive/compose';

let model: ExecutiveModel;
let noLinks: ExecutiveModel;
const build = async (links = [...productLinks(), customerLink()], d = makeExecutive()) => { const db = new AppDB('rep-' + Math.random().toString(36).slice(2)); await seedDb(db, d, links); return (await new EngineSession(db).buildExecutive({ version: 1 })).model; };
beforeAll(async () => { model = await build(); noLinks = await build([]); });

describe('local executive report', () => {
  it('contains every required part, and is self-contained: no scripts, no external requests', () => {
    const html = renderManagementSummary(buildExecutiveSummaryDoc(model, 'en'));
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("default-src 'none'");
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) expect(m[1]!.startsWith('#') || m[1]!.startsWith('data:'), m[1]).toBe(true);
    expect(html).not.toMatch(/https?:\/\//);
    for (const part of ['Executive summary', 'Key figures', 'Priority findings', 'Key trends', 'Data coverage and limitations', 'Executive management report']) expect(html, part).toContain(part);
    expect(html).toContain('<svg'); // supporting charts
    expect(html).toContain('Last import');
    // KPIs are listed per module with their own currency, never as one grand total
    expect(html).not.toMatch(/grand total|total of all/i);
  });

  it('cross-module findings carry their basis into the report', () => {
    const doc = buildExecutiveSummaryDoc(model, 'en');
    const crossIns = doc.insights.find((i) => /Cross-module|Across modules/.test(i.sufficiency) || /Data sources:/.test(i.why))!;
    expect(crossIns).toBeTruthy();
    expect(crossIns.why).toMatch(/Data sources:.*Confirmed relationships:.*Period:.*Calculation:.*Confidence:.*Limitations:/);
    expect(crossIns.sufficiency).toMatch(/Across modules/);
  });

  it('classes are labelled, and a hypothetical scenario or potential saving is never worded as certain', () => {
    const doc = buildExecutiveSummaryDoc(model, 'en');
    for (const i of doc.insights) expect(i.sufficiency).toMatch(/Fact|Risk|Potential opportunity|Hypothetical scenario/);
    expect(doc.insights.filter((i) => /Potential opportunity/.test(i.sufficiency)).length).toBeGreaterThan(0);
    const all = JSON.stringify(doc);
    expect(all).not.toMatch(/guaranteed saving|you will save|realized loss/i);
  });

  it('without confirmed links the summary says so instead of showing cross-module numbers', () => {
    const lines = executiveLines(noLinks, 'en', (k, p) => translate('en', k, p));
    expect(lines.join(' ')).toContain('No links between modules are confirmed');
    expect(noLinks.insights.some((r) => r.module === 'cross')).toBe(false);
  });

  it('HTML is escaped even with hostile names; CSV cannot start a spreadsheet formula', async () => {
    const d = makeExecutive();
    d.sales.forEach((s) => { if (s.customerId === 'C06') s.customerName = '<script>alert(1)</script> & "x"'; });
    d.finance.forEach((f) => { if (f.counterpartyId === 'C06') f.counterpartyName = '<script>alert(1)</script> & "x"'; });
    d.inventory.forEach((r) => { if (r.productId === 'P01') r.productName = '=HYPERLINK("http://x","y")'; });
    const hostile = productLinks().map((l) => ({ ...l, a: { ...l.a, label: '=HYPERLINK("http://x","y")' }, b: { ...l.b, label: '=HYPERLINK("http://x","y")' } }));
    const m = await build([...hostile, customerLink()], d);
    const html = renderManagementSummary(buildExecutiveSummaryDoc(m, 'en'));
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;');
    const csv = renderReportCsv(buildExecutiveReport(m, 'en'));
    expect(csv).toContain('HYPERLINK');
    expect(csv).not.toMatch(/(^|;|\r\n)"?[=+@\t]/);
  });

  it('LT, PL and EN produce complete documents without raw translation keys', () => {
    for (const l of ['lt', 'pl', 'en'] as const) {
      const html = renderManagementSummary(buildExecutiveSummaryDoc(model, l));
      expect(html, l).not.toMatch(/\b(exe|cross|lnk|metric|explain|finance|inventory|purchasing|sales|universal|fin|uni|cert|sev|mod)\.[a-z_]+/);
      const csv = renderReportCsv(buildExecutiveReport(model, l));
      expect(csv, l).not.toMatch(/\b(exe|cross|lnk)\.[a-z_]+/);
    }
  });
});
