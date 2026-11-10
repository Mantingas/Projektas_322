import { describe, expect, it } from 'vitest';
import { financeData } from './fixtures/financeRecords';
import { makeFinance } from './fixtures/finance';
import { analyseSettlement } from '@/engine/trust/settlement';
import { soundness } from './fixtures/soundness';

/**
 * Measured on the SYNTHETIC finance fixture whose planted cases are listed in tests/fixtures/finance.ts. Recall and precision here describe this
 * fixture only: they say nothing about the false-positive rate on real company data.
 */
describe('planted cases are found (recall) and clean counterparties are left alone (precision) on the synthetic ledgers', () => {
  const ar = financeData('receivable', 'en');
  const ap = financeData('payable', 'en');
  const rar = analyseSettlement(ar.records, 'receivable', 'EUR');
  const rap = analyseSettlement(ap.records, 'payable', 'EUR');
  const seen = (r: typeof rar, rule: string, cp: string) => r.findings.filter((f) => f.rule === rule && f.cp === cp.toLowerCase());

  it('receivables: every planted case is found with the amount the ledger simulation says', () => {
    const t = makeFinance('receivable', 'en');
    // C09 paid ONE invoice twice → duplicate/excess equal to what was paid in excess; the report shows the credit balance → verified
    const c09 = seen(rar, 'duplicate_payment', 'C09');
    expect(c09).toHaveLength(1);
    const inv9 = t.invoices.filter((i) => i.cp === 'C09').find((i) => t.payments.filter((p) => p.invoice === i.no && p.cp === 'C09').length === 2)!;
    const paid9 = t.payments.filter((p) => p.invoice === inv9.no).reduce((s, p) => s + p.amount, 0);
    expect(c09[0]!.exposure!.amount).toBeCloseTo(paid9 - inv9.amount, 2);
    expect(c09[0]!.status).toBe('verified');
    // C08 paid 110 % of one invoice → overpayment of 10 %
    const c08 = seen(rar, 'overpayment', 'C08');
    expect(c08).toHaveLength(1);
    const inv8 = t.invoices.find((i) => t.payments.some((p) => p.invoice === i.no && p.cp === 'C08' && p.amount > i.amount + 0.01))!;
    expect(c08[0]!.exposure!.amount).toBeCloseTo(t.payments.filter((p) => p.invoice === inv8.no).reduce((s, p) => s + p.amount, 0) - inv8.amount, 2);
    // C10: one payment line repeated in the register → one finding, with the possible-export-repeat assumption, never two
    const c10 = rar.findings.filter((f) => f.cp === 'c10');
    expect(c10).toHaveLength(1);
    expect(c10[0]!.assumptions.map((a) => a.key)).toContain('trust.asm.not_export_repeat');
    expect(c10[0]!.status).toBe('candidate');
    // C07: two look-alike payments of 1 234.56 without references → an amount to investigate, not a claim
    expect(seen(rar, 'duplicate_payment', 'C07').map((f) => [f.status, f.exposure])).toEqual([['candidate', { amount: 1234.56, kind: 'investigate' }]]);
    // KR-2 (reference to a missing invoice, 150) and KR-3 (no reference, 300) still stand open in the newest open-item report
    expect(seen(rar, 'unapplied_credit', 'C02').map((f) => [f.state, f.exposure!.amount])).toEqual([['open_in_report', 150]]);
    expect(seen(rar, 'unapplied_credit', 'C03').map((f) => [f.state, f.exposure!.amount])).toEqual([['open_in_report', 300]]);
    // KR-1 matches a C06 invoice: reconciled, not a finding
    expect(rar.findings.some((f) => f.cp === 'c06' && f.rule === 'unapplied_credit')).toBe(false);
    expect(rar.reconciled.some((x) => x.state === 'applied')).toBe(true);
  });

  it('payables: the repeated line, the look-alike pair and the credit that exceeds its payment are found', () => {
    expect(seen(rap, 'duplicate_payment', 'S04').map((f) => f.exposure!.kind)).toEqual(['investigate']);
    expect(seen(rap, 'duplicate_payment', 'S05')).toHaveLength(1);
    const s02 = seen(rap, 'overpayment', 'S02');
    expect(s02).toHaveLength(1);
    expect(s02[0]!.exposure!.amount).toBe(250);   // KR-P1 credit of 250 on an invoice that was paid in full
  });

  it('precision: the counterparties without a planted problem produce no duplicate, overpayment or credit finding', () => {
    const planted = new Set(['c02', 'c03', 'c07', 'c08', 'c09', 'c10', 's02', 's04', 's05']);
    for (const r of [rar, rap]) for (const f of r.findings) expect(planted.has(f.cp), `${f.rule} ${f.cp}`).toBe(true);
  });

  it('the potential total is exactly the verified and candidate excess amounts of the planted cases, once each', () => {
    const t = makeFinance('receivable', 'en');
    const inv9 = t.invoices.filter((i) => i.cp === 'C09').find((i) => t.payments.filter((p) => p.invoice === i.no && p.cp === 'C09').length === 2)!;
    const c09 = t.payments.filter((p) => p.invoice === inv9.no).reduce((s, p) => s + p.amount, 0) - inv9.amount;
    const inv8 = t.invoices.find((i) => t.payments.some((p) => p.invoice === i.no && p.cp === 'C08' && p.amount > i.amount + 0.01))!;
    const c08 = t.payments.filter((p) => p.invoice === inv8.no).reduce((s, p) => s + p.amount, 0) - inv8.amount;
    const key = (p: (typeof t.payments)[number]) => `${p.ref}|${p.date}|${p.amount}`;
    const c10 = t.payments.filter((p) => p.cp === 'C10' && t.payments.filter((q) => key(q) === key(p)).length === 2)[0]!.amount;   // the amount of the line the register repeats
    expect(rar.potential.total).toBeCloseTo(c09 + c08 + 150 + 300 + c10, 2);                           // the C07 look-alike pair (investigate only) is NOT in it
    expect(rar.potential.excluded.some((e) => e.reason === 'investigate_only')).toBe(true);
    expect(rap.potential.excluded.some((e) => e.reason === 'investigate_only')).toBe(true);
    for (const r of [rar, rap]) expect(soundness(r)).toEqual([]);
  });
});
