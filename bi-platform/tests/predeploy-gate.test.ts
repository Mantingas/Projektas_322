import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DICTS } from '@/i18n';
import { PH, addDays, importAny, mkSession, type Cell } from './fixtures/salesCsv';
import { buildSummaryDoc } from '@/lib/summary';
import { buildReport } from '@/lib/report';
import { renderManagementSummary } from '@/engine/report/summary';
import { renderReportCsv } from '@/engine/report/export';
import { buildExecutiveSummaryDoc } from '@/lib/executiveSummary';
import { warningText, limitationText } from '@/lib/dashFormat';
import { translate } from '@/i18n';

const END = '2025-06-30';
const HT = ['Data', 'Dokumento Nr.', 'Dokumento tipas', 'Klientas', 'Prekė', 'Kiekis', 'Suma be PVM'];
const H = ['Data', 'Dokumento Nr.', 'Klientas', 'Prekė', 'Kiekis', 'Suma be PVM'];
const INV = 'Sąskaita faktūra', CRN = 'Kreditinė sąskaita';
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

/** 70 days of daily invoices (3 lines a day, so findings are "high" reliability), plus credit notes */
const ledger = (credits: Cell[][]): Cell[][] => {
  const rows: Cell[][] = [];
  for (let d = 0; d < 70; d++) for (let l = 0; l < 3; l++) rows.push([addDays(END, -(69 - d)), `S${d}-${l}`, INV, 'K' + ((d + l) % 5), 'P' + l, 1, 100]);
  return [...rows, ...credits];
};
const AMBIGUOUS: Cell[][] = [['2025-06-20', 'KR1', CRN, 'K1', 'P0', -1, -100], ['2025-06-21', 'KR2', CRN, 'K2', 'P0', 1, 150], ['2025-06-22', 'KR3', CRN, 'K3', 'P0', 1, 50]];
const CLEAN: Cell[][] = [['2025-06-20', 'KR1', CRN, 'K1', 'P0', -1, -100]];

describe('1 – withheld (ambiguous) credit notes: every figure that rests on the incomplete sales says so', () => {
  it('dashboard limitation, finding reliability, management summary (HTML), findings CSV, executive overview and executive report all carry the notice', async () => {
    const s = mkSession(); await importAny(s, 'sales', HT, ledger(AMBIGUOUS), 'x.csv');
    const b: any = await s.build({ version: 1, filters: {}, period: { preset: 'r30' } });
    expect(b.model.limitations.find((l: any) => l.code === 'credit_rows_excluded')).toMatchObject({ n: 2, amount: { money: 200 } });
    // findings: never "high" while sales may be overstated
    expect(b.analysis.insights.length).toBeGreaterThan(0);
    expect(b.analysis.insights.every((i: any) => i.reliability !== 'high')).toBe(true);
    expect(b.analysis.insights.some((i: any) => i.reliabilityReasonKey === 'rel.excludedCredits')).toBe(true);
    // management summary + findings CSV
    const t = (k: any, p?: any) => translate('en', k, p, 'EUR');
    const notes = [...b.model.warnings.map((w: any) => warningText(w, t)), ...b.model.limitations.map((l: any) => limitationText(l, t))];
    expect(renderManagementSummary(buildSummaryDoc(b.model, b.analysis.insights, 'en', {}, {}))).toContain('NOT imported');
    const csv = renderReportCsv(buildReport(b.analysis, 'en', notes));
    expect(csv).toContain('NOT imported');
    expect(csv.indexOf('NOT imported')).toBeLessThan(csv.indexOf('KPI'));                // before the figures
    // executive overview
    const ex: any = await s.buildExecutive({ version: 1 });
    expect(ex.model.coverage.find((c: any) => c.module === 'sales').flags).toContain('excluded_credits');
    const edoc = buildExecutiveSummaryDoc(ex.model, 'en');
    expect(edoc.executive.join(' ')).toMatch(/INCOMPLETE: credit-note rows were not imported/);
    expect(edoc.limitations.join(' ')).toMatch(/INCOMPLETE: credit-note rows were not imported/);
    expect(edoc.executive.findIndex((l) => /INCOMPLETE/.test(l))).toBeLessThan(edoc.executive.findIndex((l) => /Biggest risk/.test(l)));
  });
  it('control: a file with unambiguous credit notes carries no such notice and keeps its reliability', async () => {
    const s = mkSession(); await importAny(s, 'sales', HT, ledger(CLEAN), 'x.csv');
    const b: any = await s.build({ version: 1, filters: {}, period: { preset: 'r30' } });
    expect(codes(b.model.limitations)).not.toContain('credit_rows_excluded');
    expect(b.analysis.insights.some((i: any) => i.reliability === 'high')).toBe(true);
    const ex: any = await s.buildExecutive({ version: 1 });
    expect(ex.model.coverage.find((c: any) => c.module === 'sales').flags).not.toContain('excluded_credits');
  });
  it('the notice exists in LT / PL / EN with count and amount', () => {
    for (const l of ['lt', 'pl', 'en'] as const) { expect(DICTS[l]['exe.flag.excluded_credits']).toBeTruthy(); expect(DICTS[l]['rel.excludedCredits']).toBeTruthy(); }
  });
});

describe('2 – "tolerated" coverage is an ASSUMPTION, never shown as a proven complete period', () => {
  /** the previous 30-day window starts on END−59; the first sale happens `k` days after that start */
  const sales = (k: number, window = 60): Cell[][] => {
    const rows: Cell[][] = [];
    for (let d = k; d < window; d++) for (let l = 0; l < 3; l++) rows.push([addDays(END, -(window - 1) + d), `S${d}-${l}`, 'K' + ((d + l) % 5), 'P' + l, 1, d >= window - 30 ? 130 : 100]);   // the current window sells 30 % more, so a revenue finding always exists
    return rows;
  };
  const run = async (rows: Cell[][], extra: Record<string, unknown> = {}, preset: any = 'r30') => {
    const s = mkSession(); await importAny(s, 'sales', H, rows, 'x.csv', extra);
    const b: any = await s.build({ version: 1, filters: {}, period: { preset } });
    return { s, b };
  };
  it('first sale on the first day of the previous window: covered – no assumption, high reliability', async () => {
    const { b } = await run(sales(0));
    expect(codes(b.model.warnings)).not.toContain('previous_tolerated');
    expect(codes(b.model.limitations)).not.toContain('previous_tolerated');
    expect(b.model.kpis.find((k: any) => k.id === 'sales').status).toBe('ok');
  });
  for (const k of [1, 2, 3]) {
    it(`first sale ${k} day(s) after the start: tolerated – comparison shown but flagged as assumed (warning, limitation, lower reliability, executive flag)`, async () => {
      const { s, b } = await run(sales(k));
      expect(b.model.warnings.find((w: any) => w.code === 'previous_tolerated')).toMatchObject({ days: k });
      expect(codes(b.model.warnings)).not.toContain('previous_unverified');
      expect(b.model.limitations.find((l: any) => l.code === 'previous_tolerated')).toMatchObject({ days: k });
      expect(b.model.kpis.find((x: any) => x.id === 'sales').status).toBe('ok');
      const cmp = b.analysis.insights.filter((i: any) => i.params.days !== undefined);
      expect(cmp.length).toBeGreaterThan(0);
      expect(cmp.every((i: any) => i.reliability !== 'high' && i.reliabilityReasonKey === 'rel.coverageAssumed')).toBe(true);
      const ex: any = await s.buildExecutive({ version: 1 });
      expect(ex.model.coverage.find((c: any) => c.module === 'sales').flags).toContain('comparison_assumed');
    });
  }
  it('first sale 4 days after the start: beyond the tolerance → UNKNOWN, change withheld (not "assumed")', async () => {
    const { s, b } = await run(sales(4));
    expect(codes(b.model.warnings)).toContain('previous_unverified');
    expect(codes(b.model.warnings)).not.toContain('previous_tolerated');
    expect(b.model.kpis.find((x: any) => x.id === 'sales').status).toBe('blocked');
    const ex: any = await s.buildExecutive({ version: 1 });
    expect(ex.model.coverage.find((c: any) => c.module === 'sales').flags).toContain('comparison_withheld');
    expect(buildExecutiveSummaryDoc(ex.model, 'en').executive.join(' ')).toMatch(/Changes are not shown/);
  });
  it('the same 3-day gap with a DECLARED export start at the window start: verified (no assumption at all)', async () => {
    const { b } = await run(sales(3), { coverage: { from: addDays(END, -59) } });
    expect(codes(b.model.warnings)).not.toContain('previous_tolerated');
    expect(codes(b.model.limitations)).not.toContain('previous_tolerated');
    expect(b.analysis.insights.some((i: any) => i.reliabilityReasonKey === 'rel.coverageAssumed')).toBe(false);
  });
  it('a 90-day window tolerates 9 days (10 %), not 10', async () => {
    const nine = await run(sales(9, 180), {}, 'r90');
    expect(codes(nine.b.model.warnings)).toContain('previous_tolerated');
    const ten = await run(sales(10, 180), {}, 'r90');
    expect(codes(ten.b.model.warnings)).toContain('previous_unverified');
  });
  it('purchasing follows the same boundary (3 days tolerated and flagged, 4 days unknown)', async () => {
    const buy = (k: number): Cell[][] => { const r: Cell[][] = []; for (let d = k; d < 60; d++) r.push([addDays(END, -(59 - d)), `T${d}`, 'S1', 'P1', 1, 'kg', 100]); return r; };
    const a = mkSession(); await importAny(a, 'purchasing', PH, buy(3), 'p.csv');
    const ba: any = await a.buildPurchasing({ version: 1, filters: {}, period: { preset: 'r30' } });
    expect(codes(ba.model.warnings)).toContain('previous_tolerated');
    expect(ba.model.kpis.find((k: any) => k.id === 'p_spend').status).toBe('ok');
    const ex: any = await a.buildExecutive({ version: 1 });
    expect(ex.model.coverage.find((c: any) => c.module === 'purchasing').flags).toContain('comparison_assumed');
    const b = mkSession(); await importAny(b, 'purchasing', PH, buy(4), 'p.csv');
    const bb: any = await b.buildPurchasing({ version: 1, filters: {}, period: { preset: 'r30' } });
    expect(codes(bb.model.warnings)).toContain('previous_unverified');
    expect(bb.model.kpis.find((k: any) => k.id === 'p_spend').status).toBe('blocked');
  });
});

describe('3 – re-import advice never pushes the user into destroying the only copy of their data', () => {
  for (const l of ['en', 'lt', 'pl'] as const) {
    it(`${l}: the old-import notice says deletion cannot be undone, that files are not kept, to delete only with the original file or a backup, and to keep the old import otherwise`, () => {
      const t = DICTS[l]['lim.legacy_import'];
      expect(t).toMatch(l === 'en' ? /cannot be undone/ : l === 'lt' ? /negrįžtamas/ : /nie można cofnąć/);
      expect(t).toMatch(l === 'en' ? /original file/ : l === 'lt' ? /originalų failą/ : /oryginalny plik/);
      expect(t).toMatch(l === 'en' ? /keep the old import/ : l === 'lt' ? /palikite seną importą/ : /zachowaj stary import/);
      expect(t).toMatch(l === 'en' ? /NOT changed/ : l === 'lt' ? /NEpasikeitė/ : /NIE zmieniły/);
      expect(t).not.toMatch(/Re-import them: delete the old import/);
    });
    it(`${l}: every delete confirmation (one import, all data, legacy import) warns that it is irreversible and points to the backup`, () => {
      for (const k of ['hist.confirmDelete', 'hist.confirmDeleteLegacy', 'set.deleteConfirm'] as const) {
        expect(DICTS[l][k], `${l}:${k}`).toMatch(l === 'en' ? /cannot be undone|CANNOT be undone/ : l === 'lt' ? /negrįžtam|NEGRĮŽTAMA/i : /nie można (tego )?cofnąć/i);
      }
      expect(DICTS[l]['hist.confirmDelete']).toMatch(/\(Settings|\(Nustatymai|\(Ustawienia/);
      expect(DICTS[l]['hist.confirmDeleteLegacy']).toMatch(l === 'en' ? /only stored copy/ : l === 'lt' ? /vienintelę/ : /jedyną/);
    });
  }
  it('the history view asks the stronger question for an import made under the old rules', () => {
    const src = fs.readFileSync('src/components/HistoryView.tsx', 'utf8');
    expect(src).toMatch(/hist\.confirmDeleteLegacy/);
    expect(src).toMatch(/window\.confirm/);
  });
});
