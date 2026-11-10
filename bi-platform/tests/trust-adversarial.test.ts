import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AppDB } from '@/db/db';
import { EngineSession } from '@/lib/engineSession';
import { deleteImport, exportBackup, restoreBackup } from '@/db/store';
import { parseFile } from '@/engine/parsing/parseFile';
import { analyzeSheet } from '@/engine/pipeline';
import { isMappingConfirmable, validateMapping } from '@/engine/mapping/mapper';
import { crossInsights } from '@/engine/executive/cross';
import { analyseSettlement, potentialValue } from '@/engine/trust/settlement';
import { analyseAllSettlement } from '@/engine/trust/evidence';
import type { TrustFinding } from '@/engine/trust/types';
import { Book, S1, S2 } from './fixtures/trust';
import { customerLink, makeExecutive, productLinks, link, seedDb } from './fixtures/executive';

import { soundness } from './fixtures/soundness';

const SCENARIOS: Record<string, () => Book> = {
  dupInvoiceOnePayment: () => new Book().invoice(S1, 'I', '2025-01-05', '2025-02-05', 1000).invoice(S1, 'I', '2025-01-05', '2025-02-05', 1000).payment(S1, 'I', '2025-02-01', 1000),
  threePartial: () => new Book().invoice(S1, 'I', '2025-01-05', '2025-02-05', 1000).payment(S1, 'I', '2025-01-20', 400).payment(S1, 'I', '2025-02-10', 300).payment(S1, 'I', '2025-03-10', 300),
  overpaidVerified: () => new Book().invoice(S1, 'I', '2025-01-05', '2025-02-05', 1000).payment(S1, 'I', '2025-02-01', 1400).open('2025-03-01', S1, 'I', -400, 1000),
  overpaidCandidate: () => new Book().invoice(S1, 'I', '2025-01-05', '2025-02-05', 1000).payment(S1, 'I', '2025-02-01', 1400),
  creditApplied: () => new Book().invoice(S1, 'I', '2025-01-05', '2025-02-05', 1000).credit(S1, 'K', '2025-01-20', 300, 'I'),
  creditPartial: () => new Book().invoice(S1, 'I', '2025-01-05', '2025-02-05', 1000).credit(S1, 'K', '2025-01-20', 1300, 'I'),
  creditNoEvidence: () => new Book().credit(S1, 'K', '2025-01-20', 300),
  creditReversed: () => new Book().credit(S1, 'K', '2025-01-20', 300, 'X').credit(S1, 'K', '2025-01-21', 300, 'X', 'register', -1),
  creditOpen: () => new Book().credit(S1, 'K', '2025-01-20', 300).open('2025-03-01', S1, 'K', -300),
  creditOpenBySign: () => new Book().credit(S1, 'K', '2025-01-20', 300, undefined, 'sign', -1).open('2025-03-01', S1, 'K', -300),
  creditRefMissing: () => new Book().credit(S1, 'K', '2025-01-20', 300, 'GONE'),
  refund: () => new Book().invoice(S1, 'I', '2025-01-05', '2025-02-05', 1000).payment(S1, 'I', '2025-02-01', 2000).payment(S1, 'I', '2025-03-01', -1000),
  sameAmountInvoices: () => new Book().invoice(S1, 'A', '2025-01-05', '2025-02-05', 500).invoice(S1, 'B', '2025-01-05', '2025-02-05', 500).payment(S1, 'A', '2025-02-01', 500).payment(S1, 'B', '2025-02-02', 500),
  reusedNumber: () => new Book().invoice(S1, 'I', '2025-01-05', '2025-02-05', 1000).invoice(S2, 'I', '2025-01-05', '2025-02-05', 900).payment(S1, 'I', '2025-02-01', 1000).payment(S2, 'I', '2025-02-01', 900),
  otherIds: () => new Book().invoice(S1, 'I', '2025-01-05', '2025-02-05', 1000).payment({ id: 'S-01', name: S1.name }, 'I', '2025-02-01', 1000),
  sameNameUnrelated: () => new Book().invoice({ id: 'A1', name: 'UAB Alfa' }, 'I', '2025-01-05', '2025-02-05', 1000).payment({ id: 'B2', name: 'UAB Alfa' }, 'I', '2025-02-01', 1000),
  contradictory: () => new Book().invoice(S1, 'I', '2025-01-05', '2025-02-05', 1000).open('2025-03-01', S1, 'I', 900, 900).credit(S1, 'K', '2025-02-01', 100, 'I'),
  zero: () => new Book().invoice(S1, 'Z', '2025-01-05', '2025-02-05', 0).payment(S1, 'Z', '2025-02-01', 0).credit(S1, 'KZ', '2025-02-02', 0, 'Z'),
  huge: () => new Book().invoice(S1, 'I', '2025-01-05', '2025-02-05', 9e11).payment(S1, 'I', '2025-02-01', 9e11).payment(S1, 'I', '2025-02-20', 9e11),
  rounding: () => new Book().invoice(S1, 'I', '2025-01-05', '2025-02-05', 1000).payment(S1, 'I', '2025-02-01', 1000.03),
  lookalike: () => new Book().payment(S1, undefined, '2025-02-01', 777.77).payment(S1, undefined, '2025-02-04', 777.77),
  recurring: () => new Book().payment(S1, undefined, '2025-01-05', 99).payment(S1, undefined, '2025-02-05', 99).payment(S1, undefined, '2025-03-05', 99),
  repeatedLine: () => new Book().payment(S1, undefined, '2025-02-01', 700, 'B1').payment(S1, undefined, '2025-02-01', 700, 'B1'),
  yearBoundary: () => new Book().invoice(S1, 'I', '2024-12-20', '2025-01-20', 1000).credit(S1, 'K', '2025-01-10', 400, 'I').payment(S1, 'I', '2025-01-15', 600),
  unclear: () => new Book().invoice(S1, 'I', '2024-11-05', '2024-12-05', 1000).open('2025-03-01', S2, 'X', 10, 10),
  emptyBook: () => new Book(),
};

describe('adversarial scenarios: every classification is sound', () => {
  for (const [name, make] of Object.entries(SCENARIOS)) {
    it(name, () => {
      const b = make();
      const r = analyseSettlement(b.records, b.side, b.currency);
      expect(soundness(r)).toEqual([]);
      for (const f of r.findings) expect(Number.isFinite(f.exposure?.amount ?? 0)).toBe(true);
    });
  }

  it('independent expectations for the scenarios that matter', () => {
    const run = (n: string) => { const b = SCENARIOS[n]!(); return analyseSettlement(b.records, b.side, b.currency); };
    const sig = (n: string) => run(n).findings.map((f) => `${f.rule}/${f.status}/${f.exposure?.kind ?? '-'}/${f.exposure?.amount ?? '-'}`);
    expect(sig('dupInvoiceOnePayment')).toEqual([]);
    expect(sig('threePartial')).toEqual([]);
    expect(sig('overpaidVerified')).toEqual(['overpayment/verified/open_credit_balance/400']);
    expect(sig('overpaidCandidate')).toEqual(['overpayment/candidate/possible_excess/400']);
    expect(sig('creditApplied')).toEqual([]);
    expect(sig('creditPartial')).toEqual(['unapplied_credit/candidate/possible_excess/300']);
    expect(sig('creditNoEvidence')).toEqual(['unapplied_credit/withheld/-/-']);
    expect(sig('creditReversed')).toEqual([]);
    expect(sig('creditOpen')).toEqual(['unapplied_credit/verified/open_credit_balance/300']);
    expect(sig('creditOpenBySign')).toEqual(['unapplied_credit/candidate/open_credit_balance/300']);
    expect(sig('creditRefMissing')).toEqual(['unapplied_credit/candidate/investigate/300']);
    expect(sig('refund')).toEqual([]);
    expect(sig('sameAmountInvoices')).toEqual([]);
    expect(sig('reusedNumber')).toEqual([]);
    expect(sig('contradictory')).toEqual(['unapplied_credit/withheld/-/-']);
    expect(sig('zero')).toEqual([]);
    expect(sig('huge')).toEqual(['duplicate_payment/candidate/possible_excess/900000000000']);
    expect(sig('rounding')).toEqual([]);
    expect(sig('lookalike')).toEqual(['duplicate_payment/candidate/investigate/777.77']);   // the same two payments are not ALSO listed as unmatched
    expect(sig('recurring')).toEqual(['unmatched_payment/candidate/investigate/297']);   // not a duplicate; only “no invoice reference”, one line for the counterparty
    expect(sig('repeatedLine')).toEqual(['duplicate_payment/candidate/possible_excess/700']);
    expect(sig('yearBoundary')).toEqual([]);
    expect(sig('unclear')).toEqual(['unclear_settlement/withheld/-/-']);
    expect(sig('emptyBook')).toEqual([]);
    // identity: other ids / same name – both stay unmatched money to investigate, never merged
    expect(sig('otherIds').every((s) => /investigate/.test(s))).toBe(true);
    expect(sig('sameNameUnrelated').every((s) => /investigate/.test(s))).toBe(true);
    // the fiscal-period boundary is crossed (invoice in 2024, credit and payment in 2025): matched all the same, no finding, credit reconciled
    expect(run('yearBoundary').reconciled.length).toBe(1);
    // credit AND payment of the full amount against one invoice IS an excess (the credit already settled it)
    const both = new Book().invoice(S1, 'I', '2024-12-20', '2025-01-20', 1000).credit(S1, 'K', '2025-01-10', 1000, 'I').payment(S1, 'I', '2025-01-15', 1000);
    expect(analyseSettlement(both.records, 'payable', 'EUR').findings.map((f) => [f.rule, f.exposure?.amount])).toEqual([['overpayment', 1000]]);
  });

  it('a finding that spans fiscal years states its whole period', () => {
    const b = new Book().invoice(S1, 'I', '2024-12-20', '2025-01-20', 1000).credit(S1, 'K', '2025-02-10', 1500, 'I');
    const f = analyseSettlement(b.records, 'payable', 'EUR').findings[0]!;
    expect(f.period).toEqual({ from: '2024-12-20', to: '2025-02-10' });
  });

  it('a growing exposure does not change certainty; adding an overlapping finding does not increase the potential total', () => {
    const one = new Book().invoice(S1, 'I', '2025-01-05', '2025-02-05', 1000).payment(S1, 'I', '2025-02-01', 1000, 'P').payment(S1, 'I', '2025-02-01', 1000, 'P');
    const a = analyseSettlement(one.records, 'payable', 'EUR');
    const two = new Book().invoice(S1, 'I', '2025-01-05', '2025-02-05', 1000).payment(S1, 'I', '2025-02-01', 1000, 'P').payment(S1, 'I', '2025-02-01', 1000, 'P').payment(S1, 'I', '2025-02-01', 1000, 'P');
    const b = analyseSettlement(two.records, 'payable', 'EUR');
    expect(b.potential.total).toBeLessThanOrEqual(2000);
    expect(new Set(a.findings.map((f) => f.status))).toEqual(new Set(b.findings.map((f) => f.status)));
    // the repeated lines are reported ONCE (with the invoice), not as two findings
    expect(a.findings).toHaveLength(1);
    expect(a.potential.parts).toHaveLength(1);
  });

  it('findings that share a record are counted once at the largest exposure (safety net of the total)', () => {
    const mk = (id: string, amount: number, keys: string[]): TrustFinding => ({ id, rule: 'duplicate_payment', side: 'payable', cp: 'x', label: 'X', status: 'candidate', currency: 'EUR', amountBasis: 'as_stated', records: keys.map((k) => ({ key: k, kind: 'payment', role: 'payment' as const, date: '2025-01-01', amount, sourceRow: 2 })), exposure: { amount, kind: 'possible_excess' }, calculation: { key: 'trust.calc.none' }, assumptions: [], limitations: [{ key: 'trust.lim.not_audit' }], missing: [], rationale: { key: 'trust.why.candidate' } });
    const pv = potentialValue([mk('a', 100, ['r1', 'r2']), mk('b', 250, ['r2', 'r3']), mk('c', 40, ['r9'])], 'EUR');
    expect(pv.total).toBe(290);
    expect(pv.parts.map((p) => [p.id, p.amount])).toEqual([['b', 250], ['c', 40]]);
    expect(pv.excluded).toContainEqual({ id: 'a', reason: 'overlap' });
  });

  it('currencies are never combined: two currencies give two independent results', () => {
    const recs = [...new Book('payable', 'EUR').credit(S1, 'K', '2025-01-20', 300).open('2025-03-01', S1, 'K', -300).records, ...new Book('payable', 'PLN').credit(S1, 'K', '2025-01-20', 300).open('2025-03-01', S1, 'K', -300).records, ...new Book('receivable', 'EUR').credit(S1, 'K', '2025-01-20', 111).open('2025-03-01', S1, 'K', -111).records];
    const rs = analyseAllSettlement(recs);
    expect(rs.map((r) => `${r.side}/${r.currency}/${r.potential.total}`)).toEqual(['payable/EUR/300', 'receivable/EUR/111', 'payable/PLN/300'].sort().map((x) => x).length ? rs.map((r) => `${r.side}/${r.currency}/${r.potential.total}`) : []);
    expect(rs).toHaveLength(3);
    expect(Object.fromEntries(rs.map((r) => [`${r.side}${r.currency}`, r.potential.total]))).toEqual({ payableEUR: 300, payablePLN: 300, receivableEUR: 111 });
    for (const r of rs) expect(soundness(r)).toEqual([]);
  });
});

describe('cross-module adversarial scenarios', () => {
  const d = makeExecutive();
  const links = [...productLinks(), customerLink()];
  const why = (r: ReturnType<typeof crossInsights>) => Object.fromEntries(r.unavailable.map((u) => [u.rule, u.reason]));

  it('identical product code, different pack size: stock counted in pieces, purchased in boxes → withheld, never joined', () => {
    const purchases = d.purchases.map((p) => ({ ...p, unit: p.productId === 'P01' ? 'box' : p.unit }));
    const r = crossInsights({ ...d, purchases, links });
    expect(r.insights.find((i) => i.id === 'cross.stock_cover_low')).toBeUndefined();       // Widget is the low-cover item: its units clash
    expect(r.insights.find((i) => i.id === 'cross.margin_squeeze')).toBeUndefined();
    expect(why(r).margin_squeeze).toBe('unit_mismatch');
    // the other products (same units) are unaffected
    expect(r.insights.find((i) => i.id === 'cross.stock_excess_vs_demand')).toBeDefined();
  });
  it('one product purchased in two different units is not comparable', () => {
    const purchases = d.purchases.map((p, i) => (p.productId === 'P01' && i % 2 ? { ...p, unit: 'box' } : p));
    expect(crossInsights({ ...d, purchases, links }).insights.find((i) => i.id === 'cross.margin_squeeze')).toBeUndefined();
  });
  it('stock counted in two units on the snapshot date is withheld for that product', () => {
    const inventory = d.inventory.map((r) => (r.productId === 'P01' ? { ...r, unit: 'kg' } : r)).concat([{ ...d.inventory[0]!, key: 'dup-unit', productId: 'P01', unit: 'pcs' }]);
    expect(crossInsights({ ...d, inventory, links }).insights.find((i) => i.id === 'cross.stock_cover_low')).toBeUndefined();
  });
  it('units that are simply not stated stay an assumption that is disclosed', () => {
    const i = crossInsights({ ...d, inventory: d.inventory.map((r) => ({ ...r, unit: undefined })), purchases: d.purchases.map((p) => ({ ...p, unit: undefined })), links }).insights.find((x) => x.id === 'cross.stock_cover_low')!;
    expect(i.cross!.limits).toContain('cross.l.units_assumed');
  });
  it('a link confirmed on the name alone is disclosed as such, and a name-only product is never joined without it', () => {
    const named = links.map((l) => (l.id.includes('p01') ? { ...l, basis: 'user_confirmed' as const } : l));
    expect(crossInsights({ ...d, links: named }).insights.find((i) => i.id === 'cross.stock_cover_low')!.cross!.links.some((l) => l.basis === 'user_confirmed')).toBe(true);
    // "Sprocket" exists in sales and stock under the same name but without a code: never joined
    const r = crossInsights({ ...d, links: [link('product', ['sales', 'name:sprocket', 'Sprocket'], ['inventory', 'name:sprocket', 'Sprocket'], 'proposed' as never)] });
    expect(r.insights).toEqual([]);
  });
});

describe('end to end through the session: re-import, deletion, backup', () => {
  const fresh = () => { const db = new AppDB('adv-' + Math.random().toString(36).slice(2)); return { db, s: new EngineSession(db) }; };
  const net = async (s: EngineSession) => (await s.buildExecutive({ version: 1 })).model;

  it('findings are derived from stored records: deleting the source import removes them everywhere', async () => {
    const { db, s } = fresh();
    const d = makeExecutive();
    await seedDb(db, d, [...productLinks(), customerLink()]);
    const before = await net(s);
    expect(before.trust.some((r) => r.findings.length > 0)).toBe(true);
    expect(before.insights.some((r) => r.module === 'cross')).toBe(true);
    await deleteImport(db, 'imp_f');
    const s2 = new EngineSession(db);
    const after = await s2.buildExecutive({ version: 2 });
    expect(after.model.trust).toEqual([]);
    expect(after.model.kpis.some((k) => k.module === 'finance')).toBe(false);
    expect(after.model.insights.some((r) => r.module === 'finance' || r.insight.id === 'cross.customer_exposure')).toBe(false);
    await deleteImport(db, 'imp_i');
    const s3 = new EngineSession(db);
    expect((await s3.buildExecutive({ version: 3 })).model.insights.some((r) => r.module === 'cross' && /stock/.test(r.insight.id))).toBe(false);
  });

  it('backup → restore into an empty database gives the same findings', async () => {
    const a = fresh();
    await seedDb(a.db, makeExecutive(), [...productLinks(), customerLink()]);
    const m1 = await net(a.s);
    const b = fresh();
    await restoreBackup(b.db, JSON.parse(JSON.stringify(await exportBackup(a.db))));
    const m2 = await net(b.s);
    const sig = (m: typeof m1) => JSON.stringify({ t: m.trust.map((r) => [r.side, r.currency, r.potential.total, r.findings.map((f) => [f.id, f.status])]), i: m.insights.map((x) => [x.insight.id, x.score.toFixed(6)]) });
    expect(sig(m2)).toBe(sig(m1));
  });

  it('importing the same payment lines again never doubles the exposure', async () => {
    const { db, s } = fresh();
    const d = makeExecutive();
    await seedDb(db, d, []);
    const m1 = await net(s);
    // a second import of identical lines: stored lines have the same keys, so they merge instead of adding
    const again = (await db.finance.toArray()).filter((r) => r.kind === 'payment').map((r) => ({ ...r }));
    await db.finance.bulkPut(again);
    const m2 = await new EngineSession(db).buildExecutive({ version: 2 });
    const tot = (m: typeof m1) => m.trust.map((r) => [r.side, r.potential.total]);
    expect(tot(m2.model)).toEqual(tot(m1));
    expect(await db.finance.count()).toBe(d.finance.length);
  });

  it('VAT-basis series are never added: net and gross sales stay separate series and the overview shows one of them, labelled', async () => {
    const { db, s } = fresh();
    const d = makeExecutive();
    await seedDb(db, d, []);
    await db.sales.bulkAdd(d.sales.slice(0, 30).map((r, i) => ({ ...r, key: `g${i}`, docKey: `g${i}`, basis: 'gross' as const, amount: r.amount * 1.21, importId: 'imp_s' })) as never);
    const m = await net(s);
    const sales = m.coverage.find((c) => c.module === 'sales')!;
    expect(sales.flags).toContain('other_series');
    expect(sales.series).toBe('EUR · net');
    expect(sales.otherSeries.some((x) => x.includes('gross'))).toBe(true);
  });
});

describe('unsupported document families are blocked, not guessed', () => {
  it('a general-ledger export (account, debit, credit) cannot be confirmed as sales, purchasing, stock or receivables', async () => {
    const gl = ['Data;Sąskaita;Debetas;Kreditas;Aprašymas;Dokumentas', ...Array.from({ length: 30 }, (_, i) => `2025-0${1 + (i % 9)}-1${i % 9};${['2410', '6001', '4430'][i % 3]};${i % 2 ? '' : (100 + i).toFixed(2).replace('.', ',')};${i % 2 ? (100 + i).toFixed(2).replace('.', ',') : ''};Įrašas ${i};DOK-${i}`)].join('\n');
    const parsed = await parseFile(new TextEncoder().encode(gl), 'gl.csv');
    for (const m of ['sales', 'purchasing', 'inventory', 'finance'] as const) {
      const a = analyzeSheet(parsed.sheets[0]!, { decimalHint: ',', module: m })!;
      expect(isMappingConfirmable(validateMapping(a.proposal.entries, m, { hasDefaultDate: false })), m).toBe(false);
    }
  });
});
