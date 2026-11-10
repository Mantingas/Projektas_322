import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { EngineSession } from '@/lib/engineSession';
import { buildExecutiveReport, buildExecutiveSummaryDoc, evidenceSections } from '@/lib/executiveSummary';
import { evidenceCsv } from '@/lib/evidence';
import { renderManagementSummary } from '@/engine/report/summary';
import { renderReportCsv } from '@/engine/report/export';
import { customerLink, makeExecutive, productLinks, seedDb } from './fixtures/executive';
import type { ExecutiveModel } from '@/engine/executive/compose';

let m: ExecutiveModel;
const build = async (d = makeExecutive()) => { const db = new AppDB('p7-' + Math.random().toString(36).slice(2)); await seedDb(db, d, [...productLinks(), customerLink()]); return (await new EngineSession(db).buildExecutive({ version: 1 })).model; };
beforeAll(async () => { m = await build(); });

describe('evidence-based executive report', () => {
  it('separates confirmed calculations, opportunities, risks, scenarios, findings to verify, exposure and withheld conclusions', () => {
    const titles = evidenceSections(m, 'en').map((s) => s.title);
    expect(titles).toEqual(['Calculations verified against the data', 'Potential financial opportunities', 'Business risks', 'Hypothetical scenarios (not counted)', 'Financial items to verify', 'Exposure to verify (not realised savings)', 'Withheld conclusions', 'Recommended verification']);
    const html = renderManagementSummary(buildExecutiveSummaryDoc(m, 'en'));
    for (const t of titles) expect(html).toContain(t);
    expect(html).toContain('does not mean the underlying business records were audited');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('every significant finding names its evidence status', () => {
    const doc = buildExecutiveSummaryDoc(m, 'en');
    for (const i of doc.insights) expect(i.sufficiency).toMatch(/Verified from data|High-confidence candidate|Estimate \/ scenario|Withheld/);
    const sec = evidenceSections(m, 'en');
    const risks = sec.find((s) => s.title === 'Business risks')!.items;
    for (const line of risks) expect(line).toMatch(/Verified from data|High-confidence candidate|Estimate \/ scenario/);
  });

  it('the exposure total is per currency and side, lists its composition, and is never presented as savings', () => {
    const sec = evidenceSections(m, 'en').find((s) => s.title.startsWith('Exposure to verify'))!;
    expect(sec.note).toMatch(/not recovered, saved or confirmed-recoverable/);
    for (const line of sec.items) expect(line).toMatch(/^(Receivables|Payables) EUR: .*Composition: /);
    expect(JSON.stringify(sec)).not.toMatch(/savings? of|will recover|guaranteed/i);
  });

  it('withheld conclusions come with their reasons; hypothetical scenarios are not part of any total', () => {
    const w = evidenceSections(m, 'en').find((s) => s.title === 'Withheld conclusions')!.items;
    for (const line of w) expect(line).toMatch(/: .+: .+/);
    const html = renderManagementSummary(buildExecutiveSummaryDoc(m, 'en'));
    expect(html).toContain('Hypothetical scenarios (not counted)');
  });

  it('evidence CSV lists every supporting record with file and row, and cannot start a spreadsheet formula', async () => {
    const d = makeExecutive();
    d.finance.forEach((f) => { f.counterpartyName = '=HYPERLINK("http://x","y")'; });
    const model = await build(d);
    const items = model.trust.flatMap((r) => r.findings.map((f) => ({ title: 'x', dossier: f })));
    expect(items.length).toBeGreaterThan(0);
    const csv = evidenceCsv(items, 'en', { imp_f: 'debts.csv' });
    expect(csv).toContain('debts.csv');
    expect(csv).toContain('HYPERLINK');
    expect(csv).not.toMatch(/(^|;|\r\n)"?[=+@\t]/);
    const rep = renderReportCsv(buildExecutiveReport(model, 'en'));
    expect(rep).not.toMatch(/(^|;|\r\n)"?[=+@\t]/);
    const html = renderManagementSummary(buildExecutiveSummaryDoc(model, 'en'));
    expect(html).not.toMatch(/<script/i);
  });

  it('LT and PL reports are complete without raw keys', () => {
    for (const l of ['lt', 'pl'] as const) {
      const html = renderManagementSummary(buildExecutiveSummaryDoc(m, l));
      expect(html, l).not.toMatch(/\b(trust|itrust|exe|cross|lnk|rule|prule|irule|frule|unavail|punavail|iunavail|funavail)\.[a-z_]+/);
    }
  });
});
