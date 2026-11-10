import { describe, expect, it } from 'vitest';
import { Book, S1, S2 } from './fixtures/trust';
import { analyseSettlement } from '@/engine/trust/settlement';
import type { TrustFinding } from '@/engine/trust/types';

const run = (b: Book) => analyseSettlement(b.records, b.side, b.currency);
const by = (r: ReturnType<typeof run>, rule: string) => r.findings.filter((f) => f.rule === rule);
const ids = (r: ReturnType<typeof run>) => r.findings.map((f) => `${f.rule}:${f.status}`);
const money = (f: TrustFinding) => f.exposure?.amount;

describe('payments: nothing is called a duplicate or an excess unless the records say so', () => {
  it('a duplicated invoice line with one payment is not a payment problem', () => {
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).payment(S1, 'INV-1', '2025-02-01', 1000);
    expect(ids(run(b))).toEqual([]);
  });
  it('one invoice, three partial payments that add up to it', () => {
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).payment(S1, 'INV-1', '2025-01-20', 400).payment(S1, 'INV-1', '2025-02-10', 300).payment(S1, 'INV-1', '2025-03-10', 300);
    expect(ids(run(b))).toEqual([]);
  });
  it('one payment document allocated to two invoices on two lines', () => {
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).invoice(S1, 'INV-2', '2025-01-06', '2025-02-06', 500).payment(S1, 'INV-1', '2025-02-01', 1000, 'BANK-9').payment(S1, 'INV-2', '2025-02-01', 500, 'BANK-9');
    expect(ids(run(b))).toEqual([]);
  });
  it('one payment of 1 500 for two invoices on ONE line with a list reference is unmatched money to investigate – not an overpayment', () => {
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).invoice(S1, 'INV-2', '2025-01-06', '2025-02-06', 500).payment(S1, 'INV-1;INV-2', '2025-02-01', 1500);
    const r = run(b);
    expect(by(r, 'overpayment')).toEqual([]);
    expect(by(r, 'unmatched_payment').map((f) => [f.status, f.exposure])).toEqual([['candidate', { amount: 1500, kind: 'investigate' }]]);
  });
  it('payments exceeding one invoice are a CANDIDATE with the possible excess, never verified from payments alone', () => {
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).payment(S1, 'INV-1', '2025-02-01', 1000).payment(S1, 'INV-1', '2025-02-20', 1000);
    const f = run(b).findings;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rule: 'duplicate_payment', status: 'candidate', exposure: { amount: 1000, kind: 'possible_excess' } });
    expect(f[0]!.missing.map((m) => m.key)).toContain('trust.miss.open_item_report');
    expect(f[0]!.records.map((x) => x.role).sort()).toEqual(['invoice', 'payment', 'payment']);
  });
  it('the same overpayment is VERIFIED when the open-item report itself shows the credit balance on that invoice', () => {
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).payment(S1, 'INV-1', '2025-02-01', 1000).payment(S1, 'INV-1', '2025-02-20', 400).open('2025-03-01', S1, 'INV-1', -400, 1000);
    const f = run(b).findings;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rule: 'overpayment', status: 'verified', exposure: { amount: 400, kind: 'open_credit_balance' } });
    expect(f[0]!.records.some((x) => x.role === 'open_balance')).toBe(true);
  });
  it('an open-item balance of a DIFFERENT size does not verify the excess', () => {
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).payment(S1, 'INV-1', '2025-02-01', 1400).open('2025-03-01', S1, 'INV-1', -250, 1000);
    expect(run(b).findings[0]).toMatchObject({ status: 'candidate' });
  });
  it('a refund booked separately is netted: paid 2 000, refunded 1 000 on a 1 000 invoice is fine', () => {
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).payment(S1, 'INV-1', '2025-02-01', 1000).payment(S1, 'INV-1', '2025-02-20', 1000).payment(S1, 'INV-1', '2025-03-10', -1000);
    expect(ids(run(b))).toEqual([]);
  });
  it('a payment and its reversal cancel; a re-payment afterwards is not a duplicate of it', () => {
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).payment(S1, 'INV-1', '2025-02-01', 1000, 'P-A').payment(S1, 'INV-1', '2025-02-02', -1000, 'P-A-REV').payment(S1, 'INV-1', '2025-02-03', 1000, 'P-B');
    expect(ids(run(b))).toEqual([]);
  });
  it('two different invoices of the same amount paid in the same week are not duplicates', () => {
    const b = new Book().invoice(S1, 'A', '2025-01-05', '2025-02-05', 500).invoice(S1, 'B', '2025-01-06', '2025-02-06', 500).payment(S1, 'A', '2025-02-01', 500).payment(S1, 'B', '2025-02-03', 500);
    expect(ids(run(b))).toEqual([]);
  });
  it('two equal payments without any reference within a week are only candidates to investigate – no excess is claimed', () => {
    const b = new Book().payment(S1, undefined, '2025-02-01', 1234.56).payment(S1, undefined, '2025-02-04', 1234.56);
    const f = run(b).findings.filter((x) => x.rule === 'duplicate_payment');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ status: 'candidate', exposure: { amount: 1234.56, kind: 'investigate' } });
  });
  it('a monthly recurring charge of the same amount is not a duplicate', () => {
    const b = new Book().payment(S1, undefined, '2025-01-05', 99).payment(S1, undefined, '2025-02-05', 99).payment(S1, undefined, '2025-03-05', 99).payment(S1, undefined, '2025-04-05', 99);
    expect(by(run(b), 'duplicate_payment')).toEqual([]);
  });
  it('one repeated payment LINE (same document number, date, amount) is a candidate repeat of that amount', () => {
    const b = new Book().payment(S1, undefined, '2025-02-01', 700, 'BANK-1').payment(S1, undefined, '2025-02-01', 700, 'BANK-1');
    expect(run(b).findings.find((f) => f.rule === 'duplicate_payment')).toMatchObject({ status: 'candidate', exposure: { amount: 700, kind: 'possible_excess' } });
  });
});

describe('credit notes: unused only on evidence, never because something is missing', () => {
  it('already applied: the credit fits inside the invoice it references', () => {
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).credit(S1, 'KR-1', '2025-01-20', 300, 'INV-1');
    const r = run(b);
    expect(r.findings).toEqual([]);
    expect(r.reconciled.map((x) => x.state)).toEqual(['applied']);
  });
  it('partially applied: 1 200 credit against a 1 000 invoice leaves 200, as a candidate', () => {
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).credit(S1, 'KR-1', '2025-01-20', 1200, 'INV-1');
    expect(run(b).findings).toMatchObject([{ rule: 'unapplied_credit', state: 'partially_applied', status: 'candidate', exposure: { amount: 200, kind: 'possible_excess' } }]);
  });
  it('two credits on one invoice share its room: 600 + 600 against 1 000 leaves the second 200 unapplied', () => {
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).credit(S1, 'KR-1', '2025-01-20', 600, 'INV-1').credit(S1, 'KR-2', '2025-01-25', 600, 'INV-1');
    const f = run(b).findings;
    expect(f.map((x) => money(x)).sort()).toEqual([200, 200].slice(0, f.length).sort());
    expect(f.length).toBeGreaterThanOrEqual(1);
  });
  it('still open in the newest open-item report → verified unapplied credit with the report’s own balance', () => {
    const b = new Book().credit(S1, 'KR-7', '2025-01-20', 450).open('2025-03-01', S1, 'KR-7', -450);
    expect(run(b).findings).toMatchObject([{ rule: 'unapplied_credit', state: 'open_in_report', status: 'verified', exposure: { amount: 450, kind: 'open_credit_balance' } }]);
  });
  it('a credit whose invoice is not in the export is NOT called unused: it is an amount to investigate', () => {
    const b = new Book().credit(S1, 'KR-8', '2025-01-20', 800, 'INV-404');
    const f = run(b).findings;
    expect(f).toMatchObject([{ state: 'unmatched_review', status: 'candidate', exposure: { amount: 800, kind: 'investigate' } }]);
    expect(f[0]!.limitations.map((l) => l.key)).toContain('trust.lim.invoice_not_in_export');
    expect(f[0]!.missing.map((l) => l.key)).toContain('trust.miss.invoice_register');
  });
  it('without reference, report or possible match the conclusion is withheld, with the reason', () => {
    const f = run(new Book().credit(S1, 'KR-9', '2025-01-20', 350)).findings;
    expect(f).toMatchObject([{ status: 'withheld', exposure: null, state: 'insufficient' }]);
    expect(f[0]!.withheldReason!.key).toBe('trust.withheld.no_settlement_evidence');
  });
  it('without reference but a later open-item report that shows no open credit: reconciled, not a finding', () => {
    const b = new Book().credit(S1, 'KR-9', '2025-01-20', 350).open('2025-03-01', S2, 'X', 10, 10);
    const r = run(b);
    expect(r.findings).toEqual([]);
    expect(r.reconciled.map((x) => x.state)).toEqual(['settled_per_report']);
  });
  it('a same-amount invoice is only a possible match', () => {
    const b = new Book().invoice(S1, 'INV-5', '2025-01-05', '2025-02-05', 350).credit(S1, 'KR-9', '2025-01-20', 350);
    expect(run(b).findings).toMatchObject([{ state: 'unmatched_review', status: 'candidate', exposure: { kind: 'investigate' } }]);
  });
  it('a reversed credit note (credit and its reversal) is reconciled and produces no finding', () => {
    const b = new Book().credit(S1, 'KR-1', '2025-01-20', 300, 'INV-404').credit(S1, 'KR-1', '2025-01-25', 300, 'INV-404', 'register', -1);
    const r = run(b);
    expect(r.findings).toEqual([]);
    expect(r.reconciled.map((x) => x.state)).toEqual(['reversed', 'reversed']);
  });
  it('a credit created only from a NEGATIVE SIGN is qualified even when the report shows it open', () => {
    const b = new Book().credit(S1, 'KR-7', '2025-01-20', 450, undefined, 'sign', -1).open('2025-03-01', S1, 'KR-7', -450);
    const f = run(b).findings[0]!;
    expect(f.status).toBe('candidate');
    expect(f.assumptions.map((a) => a.key)).toContain('trust.asm.credit_by_sign');
  });
});

describe('identity: invoice numbers and counterparties are never merged on weak evidence', () => {
  it('the same invoice number at two suppliers stays two invoices; each payment finds its own', () => {
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).invoice(S2, 'INV-1', '2025-01-05', '2025-02-05', 1000).payment(S1, 'INV-1', '2025-02-01', 1000).payment(S2, 'INV-1', '2025-02-02', 1000);
    expect(ids(run(b))).toEqual([]);
  });
  it('a payment naming another supplier’s invoice is a counterparty conflict to investigate', () => {
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).payment(S2, 'INV-1', '2025-02-01', 1000);
    expect(run(b).findings).toMatchObject([{ rule: 'counterparty_conflict', status: 'candidate', exposure: { amount: 1000, kind: 'investigate' } }]);
  });
  it('one supplier under two identifiers is NOT silently merged: the payment stays unmatched', () => {
    const S1b = { id: 'S-01', name: S1.name };
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).payment(S1b, 'INV-1', '2025-02-01', 1000);
    const f = run(b).findings;
    expect(f).toHaveLength(1);
    expect(f[0]!.rule).toMatch(/counterparty_conflict|unmatched_payment/);
    expect(f[0]!.exposure!.kind).toBe('investigate');
  });
  it('the register and the open-item report disagreeing about an invoice withhold every conclusion built on it', () => {
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).open('2025-03-01', S1, 'INV-1', 900, 900).credit(S1, 'KR-1', '2025-02-01', 100, 'INV-1');
    const f = run(b).findings.filter((x) => x.rule === 'unapplied_credit');
    expect(f).toMatchObject([{ status: 'withheld' }]);
    expect(f[0]!.withheldReason!.key).toBe('trust.withheld.conflicting_invoice');
  });
});

describe('numbers: zero, rounding and very large values', () => {
  it('zero-value documents produce no findings and no NaN', () => {
    const b = new Book().invoice(S1, 'Z', '2025-01-05', '2025-02-05', 0).payment(S1, 'Z', '2025-02-01', 0).credit(S1, 'KZ', '2025-02-02', 0, 'Z');
    const r = run(b);
    expect(r.findings).toEqual([]);
    expect(Number.isFinite(r.potential.total)).toBe(true);
  });
  it('a two-cent rounding difference is not an overpayment; a real excess is', () => {
    const ok = new Book().invoice(S1, 'R', '2025-01-05', '2025-02-05', 1000).payment(S1, 'R', '2025-02-01', 1000.02);
    expect(ids(run(ok))).toEqual([]);
    const bad = new Book().invoice(S1, 'R', '2025-01-05', '2025-02-05', 1000).payment(S1, 'R', '2025-02-01', 1000.5);
    expect(run(bad).findings[0]).toMatchObject({ rule: 'overpayment', exposure: { kind: 'possible_excess' } });
    expect(run(bad).findings[0]!.exposure!.amount).toBeCloseTo(0.5, 9);
  });
  it('very large legitimate values keep exactly the same classification as small ones', () => {
    const mk = (k: number) => new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000 * k).payment(S1, 'INV-1', '2025-02-01', 1000 * k).payment(S1, 'INV-1', '2025-02-20', 400 * k).open('2025-03-01', S1, 'INV-1', -400 * k, 1000 * k).credit(S1, 'KR-8', '2025-01-20', 800 * k, 'NOPE');
    const small = run(mk(1)), huge = run(mk(1e9));
    expect(huge.findings.map((f) => [f.rule, f.status, f.state])).toEqual(small.findings.map((f) => [f.rule, f.status, f.state]));
    expect(huge.findings[0]!.exposure!.amount).toBeCloseTo(400e9, 0);
  });
});

describe('potential value: only eligible, non-overlapping exposure, per currency', () => {
  it('overlapping findings about the same payments are counted once, at the largest exposure', () => {
    const b = new Book().invoice(S1, 'INV-1', '2025-01-05', '2025-02-05', 1000).payment(S1, 'INV-1', '2025-02-01', 1000, 'P-A').payment(S1, 'INV-1', '2025-02-01', 1000, 'P-A').credit(S1, 'KR-7', '2025-01-20', 450).open('2025-03-01', S1, 'KR-7', -450);
    const r = run(b);
    expect(r.findings.length).toBeGreaterThanOrEqual(2);
    const dupAmount = 1000, credit = 450;
    expect(r.potential.total).toBeCloseTo(dupAmount + credit, 6);
    for (const p of r.potential.parts) expect(p.overlaps).toBeDefined();
  });
  it('investigate-only and withheld amounts are never added to the value', () => {
    const b = new Book().credit(S1, 'KR-8', '2025-01-20', 800, 'INV-404').credit(S1, 'KR-9', '2025-01-21', 350).payment(S1, undefined, '2025-02-01', 1234.56).payment(S1, undefined, '2025-02-04', 1234.56);
    const r = run(b);
    expect(r.potential.total).toBe(0);
    expect(r.potential.parts).toEqual([]);
    expect(r.potential.excluded.length).toBe(r.findings.length);
  });
  it('currencies are never combined: each currency is analysed on its own', () => {
    const eur = new Book('payable', 'EUR').credit(S1, 'K', '2025-01-20', 450).open('2025-03-01', S1, 'K', -450);
    const pln = new Book('payable', 'PLN').credit(S1, 'K', '2025-01-20', 450).open('2025-03-01', S1, 'K', -450);
    expect(run(eur).potential).toMatchObject({ currency: 'EUR', total: 450 });
    expect(run(pln).potential).toMatchObject({ currency: 'PLN', total: 450 });
  });
});
