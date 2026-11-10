import { describe, expect, it } from 'vitest';
import { financeData, toFinanceRecords } from './fixtures/financeRecords';
import { END, makeFinance, refOverdue, refOutstanding, snapLines } from './fixtures/finance';
import { buildFinanceDashboard, type FinanceOptions } from '@/engine/finance/dashboard';
import { analyzeFinancePeriod } from '@/engine/finance/insights';
import type { FinanceRecord } from '@/engine/types';

const ar = financeData('receivable');
const ap = financeData('payable', 'en');
const all = [...ar.records, ...ap.records];
const run = (records: FinanceRecord[] = all, o: Partial<FinanceOptions> = {}) => {
  const m = buildFinanceDashboard(records, { series: { currency: 'EUR', basis: 'net' }, side: 'receivable', filters: {}, period: { preset: 'r30' }, ...o })!;
  return { m, a: analyzeFinancePeriod(m) };
};
const by = (a: ReturnType<typeof run>['a'], id: string) => a.insights.find((i) => i.id === `finance.${id}`);
const money = (i: { params: Record<string, unknown> } | undefined, k: string) => (i!.params[k] as { money: number }).money;
const why = (a: ReturnType<typeof run>['a']) => Object.fromEntries(a.unavailable.map((u) => [u.rule, u.reason]));

describe('financial insights: facts, possible matches and risk indicators are kept apart', () => {
  const { m, a } = run();

  it('receivables: the planted situations are found, each with evidence, reliability, action and a certainty label', () => {
    const ids = a.insights.map((i) => i.id.replace('finance.', '')).sort();
    expect(ids).toEqual(['concentration', 'due_soon', 'duplicate_payments', 'largest_overdue', 'long_overdue', 'overdue_growth', 'payment_delay', 'unmatched_credits', 'working_capital']);
    for (const i of a.insights) {
      expect(i.evidence.length, i.id).toBeGreaterThan(0);
      expect(['fact', 'possible', 'indicator']).toContain(i.certainty);
      expect(i.actionKey && i.whyKey && i.titleKey && i.bodyKey && i.reliabilityReasonKey, i.id).toBeTruthy();
      expect(i.score).toBeGreaterThan(0);
      expect((i.params.asof as { date: string }).date).toBe(END);
    }
    expect(why(a)).toMatchObject({ behaviour_change: 'nothing_found' });
  });

  it('certainty: overdue amounts are FACTS; duplicates and collection potential are POSSIBLE; concentration and delays are INDICATORS', () => {
    const c = (id: string) => by(a, id)!.certainty;
    expect([c('largest_overdue'), c('long_overdue'), c('overdue_growth'), c('unmatched_credits'), c('due_soon')]).toEqual(['fact', 'fact', 'fact', 'fact', 'fact']);
    expect([c('duplicate_payments'), c('working_capital')]).toEqual(['possible', 'possible']);
    expect([c('concentration'), c('payment_delay')]).toEqual(['indicator', 'indicator']);
  });

  it('largest overdue: the total and the lead counterparty come from the snapshot', () => {
    const i = by(a, 'largest_overdue')!;
    expect(money(i, 'amount')).toBeCloseTo(refOverdue(ar, END), 2);
    expect(i.params.name).toBe('UAB Žalioji dirbtuvė');
    expect(i.evidence[0]).toMatchObject({ key: 'c06', unit: 'money' });
    expect(i.evidence.reduce((s, e) => s + 0, 0)).toBe(0);
    expect(i.impact).toEqual({ value: expect.closeTo(refOverdue(ar, END), 2), unit: 'money' });
  });

  it('overdue growth compares with the PREVIOUS snapshot, and says which one', () => {
    const i = by(a, 'overdue_growth')!;
    expect(money(i, 'previous')).toBeCloseTo(refOverdue(ar, '2025-10-31'), 2);
    expect((i.params.pasof as { date: string }).date).toBe('2025-10-31');
    expect(money(i, 'delta')).toBeCloseTo(refOverdue(ar, END) - refOverdue(ar, '2025-10-31'), 2);
  });

  it('long overdue: more than 90 days past due as of the snapshot', () => {
    const i = by(a, 'long_overdue')!;
    const ref = snapLines(ar, END).filter((o) => o.outstanding > 0 && (Date.parse(END) - Date.parse(o.due)) / 86400000 > 90).reduce((s, o) => s + o.outstanding, 0);
    expect(money(i, 'amount')).toBeCloseTo(ref, 2);
    expect(i.evidence.every((e) => e.current > 0)).toBe(true);
  });

  it('unmatched credit notes: counts by status, possible matches counted – and open credit balances are separate', () => {
    const i = by(a, 'unmatched_credits')!;
    expect(i.params).toMatchObject({ count: 2, noRef: 1, notFound: 1, possible: 1 });
    expect(money(i, 'amount')).toBe(450);
    expect(i.reliability).toBe('high');
  });

  it('possible duplicate payments: never worded as a confirmed overpayment; the amount is the POSSIBLE excess', () => {
    // default period: only the look-alike pair (20 and 23 November) falls inside it; the review table lists all four groups
    const i = by(a, 'duplicate_payments')!;
    expect(i.params).toMatchObject({ exact: 0, invoice: 0, over: 0, like: 1, count: 1 });
    expect(m.duplicates).toHaveLength(4);
    const wide = run(all, { period: { preset: 'custom', custom: { current: { from: '2025-08-01', to: END }, previous: { from: '2025-06-01', to: '2025-07-31' } } } as never });
    const w = by(wide.a, 'duplicate_payments')!;
    expect(w.params).toMatchObject({ exact: 1, invoice: 1, over: 1, like: 1, count: 4 });
    const total = wide.m.duplicates.reduce((s, d) => s + d.excess, 0);
    expect(money(w, 'amount')).toBeCloseTo(total, 2);
    expect(w.reliabilityReasonKey).toBe('rel.possibleMatch');
    expect(w.reliability).not.toBe('high');
    expect(w.savings).toBeUndefined();
    expect(w.certainty).toBe('possible');
  });

  it('unusual delays name the customers that pay far later than the portfolio; working capital is a possibility, not a promise', () => {
    const d = by(a, 'payment_delay')!;
    expect(d.evidence.map((e) => e.key).sort()).toEqual(['c03', 'c04']);
    expect(d.evidence.every((e) => e.unit === 'qty' && e.current > (e.previous ?? 0))).toBe(true);
    const w = by(a, 'working_capital')!;
    const b = m.aging!.rows;
    expect(money(w, 'amount')).toBeCloseTo(b.filter((r) => ['d60', 'd90', 'd90p'].includes(r.id)).reduce((s, r) => s + r.amount, 0), 6);
    expect(w.bodyKey).toBe('finance.working_capital.body_net'); // payables exist: the net position is stated
    expect(w.certainty).toBe('possible');
  });

  it('payables: due soon, concentration, overdue and a matched credit note; nothing is claimed about receivables-only topics', () => {
    const p = run(all, { side: 'payable' });
    const ids = p.a.insights.map((i) => i.id.replace('finance.', '')).sort();
    expect(ids).toEqual(['concentration', 'due_soon', 'largest_overdue', 'overdue_growth', 'unmatched_credits'].sort());
    expect(by(p.a, 'due_soon')!.titleKey).toBe('finance.due_soon.title_p');
    expect(why(p.a).working_capital).toBe('nothing_found'); // payables get no "collect faster" advice
    expect(why(p.a).duplicate_payments).toBe('nothing_found'); // the repeated line / look-alikes are before this period…
    // … but they are found when the period covers them
    const wide = run(all, { side: 'payable', period: { preset: 'custom', custom: { current: { from: '2025-09-01', to: '2025-11-30' }, previous: { from: '2025-06-01', to: '2025-08-31' } } } as never });
    expect(by(wide.a, 'duplicate_payments')).toBeTruthy();
    expect(wide.m.duplicates.map((d) => d.tier).sort()).toEqual(['exact_repeat', 'lookalike', 'overpaid']); // the supplier credit note came AFTER the invoice was paid in full
  });
});

describe('insights stay silent when the data cannot support them', () => {
  it('open items only: no payment- or credit-based findings, and each says why', () => {
    const { a } = run(ar.records.filter((r) => r.kind === 'open_item'));
    const ids = a.insights.map((i) => i.id);
    expect(ids).not.toContain('finance.duplicate_payments');
    expect(ids).not.toContain('finance.payment_delay');
    expect(why(a)).toMatchObject({ duplicate_payments: 'no_payment_register', payment_delay: 'no_payment_register', behaviour_change: 'no_payment_register' });
    expect(ids).toContain('finance.largest_overdue');
    // credit balances in the ledger are still shown even without a credit register
    expect(by(a, 'unmatched_credits')).toBeTruthy();
  });

  it('a single snapshot: no growth claim; a balance snapshot: no overdue claim at all', () => {
    const one = run(ar.records.filter((r) => r.kind === 'open_item' && r.date === END));
    expect(by(one.a, 'overdue_growth')).toBeUndefined();
    expect(why(one.a).overdue_growth).toBe('no_previous_snapshot');
    const recs: FinanceRecord[] = [...snapLines(ar, END).reduce((mm, o) => mm.set(o.cp, { name: o.name, v: (mm.get(o.cp)?.v ?? 0) + o.outstanding }), new Map<string, { name: string; v: number }>()).entries()].map(([cp, e]) => ({ key: cp, kind: 'balance' as const, side: 'receivable' as const, date: END, documentId: `balance receivable ${END}`, counterpartyId: cp, counterpartyName: e.name, outstanding: e.v, basis: 'net' as const, currency: 'EUR', sourceRow: 2 }));
    const bal = run(recs);
    const ids = bal.a.insights.map((i) => i.id);
    for (const x of ['largest_overdue', 'long_overdue', 'due_soon', 'working_capital']) expect(ids, x).not.toContain(`finance.${x}`);
    expect(why(bal.a)).toMatchObject({ largest_overdue: 'needs_due_dates', long_overdue: 'needs_due_dates' });
    expect(ids).toContain('finance.concentration'); // the balance per counterparty is all it needs
  });

  it('an aging report supports overdue findings (confidence medium, "no invoice-level evidence") but not due-soon', () => {
    const agingRecs: FinanceRecord[] = [{ key: 'a1', kind: 'aging', side: 'receivable', date: END, documentId: `aging receivable ${END}`, counterpartyId: 'X', counterpartyName: 'X', outstanding: 1000, buckets: { nd: 100, d30: 200, d60: 300, d90: 100, d90p: 300 }, basis: 'net', currency: 'EUR', sourceRow: 2 }, { key: 'a2', kind: 'aging', side: 'receivable', date: END, documentId: `aging receivable ${END}`, counterpartyId: 'Y', counterpartyName: 'Y', outstanding: 500, buckets: { nd: 500, d30: 0, d60: 0, d90: 0, d90p: 0 }, basis: 'net', currency: 'EUR', sourceRow: 2 }];
    const { a } = run(agingRecs);
    const l = by(a, 'largest_overdue')!;
    expect(l.reliability).toBe('medium');
    expect(l.reliabilityReasonKey).toBe('rel.agingSource');
    expect(money(l, 'amount')).toBe(900);
    expect(money(by(a, 'long_overdue'), 'amount')).toBe(300);
    expect(why(a).due_soon).toBe('needs_open_items');
  });

  it('too few matched payments: no delay or behaviour claim', () => {
    const few = ar.records.filter((r) => r.kind !== 'payment' || r.counterpartyId === 'C01').filter((r) => r.kind !== 'payment' || r.date < '2025-11-25');
    const { a } = run(few);
    expect(why(a)).toMatchObject({ payment_delay: 'few_matches', behaviour_change: 'few_matches' });
  });

  it('behaviour change is reported when a customer pays much later than before (and only with ≥ 3 matched payments in both windows)', () => {
    const { a, m } = run(all, { period: { preset: 'custom', custom: { current: { from: '2025-11-10', to: '2025-12-15' }, previous: { from: '2025-08-01', to: '2025-09-30' } } } as never });
    const i = by(a, 'behaviour_change')!;
    expect(i).toBeTruthy();
    expect(i.evidence[0]).toMatchObject({ key: 'c04', current: 25, previous: 10 });
    expect(i.severity).toBe('risk');
    expect(m.behaviour.find((b) => b.key === 'c04')!.change).toBeCloseTo(15, 6);
  });
});

describe('financial reconciliation with the independent truth', () => {
  it('the outstanding total used by the insights is the KPI is the ledger', () => {
    const { m } = run();
    expect(m.cur.position!.total).toBeCloseTo(refOutstanding(ar, END), 2);
    expect(toFinanceRecords(makeFinance('receivable'), { open: false }).every((r) => r.kind !== 'open_item')).toBe(true);
  });
});
