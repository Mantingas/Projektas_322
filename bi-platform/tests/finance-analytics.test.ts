import { describe, expect, it } from 'vitest';
import { financeData, toFinanceRecords } from './fixtures/financeRecords';
import { AP_SNAPS, AR_SNAPS, CUR, END, PREV, diff, inRange, makeFinance, refBucket, refCredits, refDueSoon, refOutstanding, refOverdue, refOverdueCount, snapLines } from './fixtures/finance';
import { buildFinanceDashboard, type FinanceModel, type FinanceOptions } from '@/engine/finance/dashboard';
import { drillFinanceRecords } from '@/engine/finance/drill';
import type { FinanceRecord, FinanceSide } from '@/engine/types';

const EUR = { currency: 'EUR', basis: 'net' as const };
const ar = financeData('receivable');
const ap = financeData('payable', 'en');
const all = [...ar.records, ...ap.records];
const dash = (records: FinanceRecord[] = all, o: Partial<FinanceOptions> = {}): FinanceModel => buildFinanceDashboard(records, { series: EUR, side: 'receivable', filters: {}, period: { preset: 'r30' }, ...o })!;
const kpi = (d: FinanceModel, id: string) => d.kpis.find((k) => k.id === id)!;
const r2 = (n: number) => Math.round(n * 100) / 100;

describe('open items: positions are read from ONE snapshot, aging is computed from due dates', () => {
  it('outstanding, overdue, overdue share and count equal the reference for the current AND the previous snapshot', () => {
    const d = dash();
    expect(d.periods.current).toEqual(CUR);
    expect(d.periods.previous).toEqual(PREV);
    expect(kpi(d, 'f_outstanding').current).toBeCloseTo(refOutstanding(ar, END), 2);
    expect(kpi(d, 'f_outstanding').previous).toBeCloseTo(refOutstanding(ar, '2025-10-31'), 2);
    expect(kpi(d, 'f_overdue').current).toBeCloseTo(refOverdue(ar, END), 2);
    expect(kpi(d, 'f_overdue').previous).toBeCloseTo(refOverdue(ar, '2025-10-31'), 2);
    expect(kpi(d, 'f_overdue_share').current).toBeCloseTo(refOverdue(ar, END) / refOutstanding(ar, END), 6);
    expect(kpi(d, 'f_overdue_count').current).toBe(refOverdueCount(ar, END));
    expect(kpi(d, 'f_due_soon').current).toBeCloseTo(refDueSoon(ar, END), 2);
    expect(d.asOf).toEqual({ current: END, previous: '2025-10-31', source: 'open_item' });
  });

  it('aging buckets add up to the total; each bucket equals the reference; unapplied credits are shown separately', () => {
    const d = dash();
    const a = d.aging!;
    const by = Object.fromEntries(a.rows.map((r) => [r.id, r.amount]));
    expect(by.nd).toBeCloseTo(refBucket(ar, END, -9999, 0), 2);
    expect(by.d30).toBeCloseTo(refBucket(ar, END, 1, 30), 2);
    expect(by.d60).toBeCloseTo(refBucket(ar, END, 31, 60), 2);
    expect(by.d90).toBeCloseTo(refBucket(ar, END, 61, 90), 2);
    expect(by.d90p).toBeCloseTo(refBucket(ar, END, 91, 99999), 2);
    expect(by.credits).toBeCloseTo(refCredits(ar, END), 2);
    expect(a.rows.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(a.total, 2);
    expect(a.total).toBeCloseTo(refOutstanding(ar, END), 2);
    expect(by.d90p).toBeGreaterThan(0); // C06 invoices from August are more than 90 days past due
  });

  it('several snapshots are NEVER added together: the position is the latest one, and the previous period uses its own snapshot', () => {
    const only = ar.records.filter((r) => r.kind === 'open_item');
    expect(new Set(only.map((r) => r.date)).size).toBe(4);
    const d = dash(only);
    expect(kpi(d, 'f_outstanding').current).toBeCloseTo(refOutstanding(ar, END), 2);
    const sumAll = AR_SNAPS.reduce((s, x) => s + refOutstanding(ar, x), 0);
    expect(kpi(d, 'f_outstanding').current).not.toBeCloseTo(sumAll, 0);
    // a single snapshot: no previous position, so no change is shown
    const one = dash(only.filter((r) => r.date === END));
    expect(kpi(one, 'f_outstanding').previous).toBeNull();
    expect(kpi(one, 'f_overdue').abs).toBeNull();
    expect(one.limitations.map((l) => l.code)).toContain('f_no_previous_snapshot');
    expect(one.waterfall).toBeNull();
  });

  it('date boundaries: due ON the as-of date is not overdue; due yesterday is 1 day overdue; 30 / 31 and 90 / 91 days fall in the right buckets', () => {
    const mk = (days: number, i: number): FinanceRecord => ({ key: `k${i}`, kind: 'open_item', side: 'receivable', date: '2025-12-15', documentId: 'open_item receivable 2025-12-15', invoiceNo: `X${i}`, counterpartyId: `Z${i}`, counterpartyName: `Z${i}`, dueDate: new Date(Date.parse('2025-12-15') - days * 86400000).toISOString().slice(0, 10), outstanding: 100, amount: 100, basis: 'net', currency: 'EUR', sourceRow: 2 });
    const recs = [0, 1, 30, 31, 60, 61, 90, 91, -14, -15].map(mk);
    const d = dash(recs);
    const b = Object.fromEntries(d.aging!.rows.map((r) => [r.id, r.amount]));
    expect(b).toMatchObject({ nd: 300, d30: 200, d60: 200, d90: 200, d90p: 100 }); // 0,-14,-15 | 1,30 | 31,60 | 61,90 | 91
    expect(kpi(d, 'f_overdue').current).toBe(700);
    expect(kpi(d, 'f_overdue_count').current).toBe(7);
    expect(kpi(d, 'f_due_soon').current).toBe(200); // due today (0) and in 14 days; 15 days ahead is not "soon"
  });

  it('partial payments, overpayments and matched credit notes change the open item exactly as the ledger says', () => {
    const lines = snapLines(ar, END);
    const c5 = ar.invoices.filter((x) => x.cp === 'C05' && x.due >= '2025-11-16' && x.due <= '2025-12-14')[0];
    const half = lines.find((o) => o.no === c5?.no);
    if (half) expect(half.outstanding).toBeCloseTo(half.amount * 0.5, 2); // 50 % paid at the due date, the rest not yet
    expect(lines.filter((o) => o.cp === 'C08' && o.outstanding < 0)).toHaveLength(1); // the 110 % payment leaves a credit balance
    expect(lines.filter((o) => o.cp === 'C09' && o.outstanding < 0)).toHaveLength(1); // the double payment as well
    const d = dash();
    const neg = d.records.filter((r) => r.kind === 'open_item' && r.date === END && (r.outstanding ?? 0) < 0);
    expect(neg.length).toBe(lines.filter((o) => o.outstanding < 0).length);
    expect(d.aging!.rows.find((r) => r.id === 'credits')!.amount).toBeCloseTo(refCredits(ar, END), 2);
    // the matched credit note KR-1 reduced its invoice's balance in the ledger
    const kr = ar.credits.find((c) => c.no === 'KR-1')!;
    expect(lines.find((o) => o.no === kr.ref)!.outstanding).toBeCloseTo(lines.find((o) => o.no === kr.ref)!.amount - kr.amount, 2);
  });

  it('counterparty table, Pareto and waterfall reconcile with the KPI', () => {
    const d = dash();
    const t = d.tables.customer!;
    expect(t.rows.reduce((s, r) => s + r.current, 0)).toBeCloseTo(refOutstanding(ar, END), 2);
    expect(t.totalPrevious).toBeCloseTo(refOutstanding(ar, '2025-10-31'), 2);
    const w = d.waterfall!.data;
    expect(w.start + w.steps.reduce((s, x) => s + x.delta, 0)).toBeCloseTo(w.end, 6);
    expect(w.end - w.start).toBeCloseTo(kpi(d, 'f_outstanding').abs!, 6);
    const top = [...snapLines(ar, END).reduce((m, o) => m.set(o.cp, (m.get(o.cp) ?? 0) + o.outstanding), new Map<string, number>()).values()].filter((v) => v > 0).sort((a, b) => b - a);
    expect(kpi(d, 'f_concentration').current).toBeCloseTo(top[0]! / top.reduce((s, v) => s + v, 0), 6);
    expect(d.overdueRank[0]!.label).toBe('UAB Žalioji dirbtuvė'); // C06 stopped paying
    const od = new Map<string, number>();
    for (const o of snapLines(ar, END).filter((x) => x.outstanding > 0 && x.due < END)) od.set(o.name, (od.get(o.name) ?? 0) + o.outstanding);
    expect(r2(d.overdueRank[0]!.overdue)).toBe(r2(od.get('UAB Žalioji dirbtuvė')!));
  });
});

describe('receivables versus payables, currencies, filters', () => {
  it('each side is its own dashboard; the overview shows both and the net position', () => {
    const r = dash(all, { side: 'receivable' });
    const p = dash(all, { side: 'payable' });
    expect(kpi(p, 'f_outstanding').current).toBeCloseTo(refOutstanding(ap, END), 2);
    expect(kpi(p, 'f_overdue').current).toBeCloseTo(refOverdue(ap, END), 2);
    expect(kpi(p, 'f_due_soon').current).toBeCloseTo(refDueSoon(ap, END), 2);
    expect(kpi(p, 'f_outstanding').previous).toBeCloseTo(refOutstanding(ap, '2025-10-31'), 2);
    expect(r.overview.receivable!.outstanding).toBeCloseTo(refOutstanding(ar, END), 2);
    expect(r.overview.payable!.outstanding).toBeCloseTo(refOutstanding(ap, END), 2);
    expect(r.overview.net).toBeCloseTo(refOutstanding(ar, END) - refOutstanding(ap, END), 2);
    expect(Object.keys(p.tables)).toEqual(['supplier']);
    expect(p.kpis.map((k) => k.id)).toContain('f_dpo');
    expect(r.kpis.map((k) => k.id)).toContain('f_dso');
    // receivables never leak into payables
    expect(p.records.every((x) => x.side === 'payable')).toBe(true);
  });

  it('currencies never mix: each currency is its own series', () => {
    const pl = financeData('receivable', 'pl');
    const both = [...ar.records, ...pl.records];
    const eur = dash(both);
    expect(kpi(eur, 'f_outstanding').current).toBeCloseTo(refOutstanding(ar, END), 2);
    expect(eur.limitations).toContainEqual({ code: 'other_series_hidden', count: 1 });
    const pln = buildFinanceDashboard(both, { series: { currency: 'PLN', basis: 'net' }, side: 'receivable', filters: {}, period: { preset: 'r30' } })!;
    expect(kpi(pln, 'f_outstanding').current).toBeCloseTo(refOutstanding(pl, END), 2);
  });

  it('a counterparty filter changes KPIs, tables and drill-down consistently', () => {
    const f = { customers: ['c06'] };
    const d = dash(all, { filters: f });
    const mine = snapLines(ar, END).filter((o) => o.cp === 'C06');
    expect(kpi(d, 'f_outstanding').current).toBeCloseTo(r2(mine.reduce((s, o) => s + o.outstanding, 0)), 2);
    expect(kpi(d, 'f_overdue_count').current).toBe(mine.filter((o) => o.outstanding > 0 && o.due < END).length);
    const rows = drillFinanceRecords(all, { filter: f, fin: { side: 'receivable', mode: 'position', asOf: END } });
    expect(rows.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(kpi(d, 'f_outstanding').current!, 6);
    expect(d.limitations.map((l) => l.code)).toContain('filtered');
  });

  it('drill-down of every position KPI reconciles: outstanding, overdue, each bucket, due soon', () => {
    const d = dash();
    const sum = (bucket?: 'overdue' | 'd30' | 'd60' | 'd90' | 'd90p' | 'nd' | 'dueSoon' | 'credits') => drillFinanceRecords(all, { filter: {}, fin: { side: 'receivable', mode: 'position', asOf: END, bucket } }).reduce((s, x) => s + x.amount, 0);
    expect(sum()).toBeCloseTo(kpi(d, 'f_outstanding').current!, 6);
    expect(sum('overdue')).toBeCloseTo(kpi(d, 'f_overdue').current!, 6);
    expect(sum('dueSoon')).toBeCloseTo(kpi(d, 'f_due_soon').current!, 6);
    for (const b of d.aging!.rows) if (b.id !== 'noDue') expect(sum(b.id as never), b.id).toBeCloseTo(b.amount, 6);
    expect(drillFinanceRecords(all, { filter: {}, fin: { side: 'receivable', mode: 'position', asOf: END, bucket: 'overdue' } }).length).toBe(kpi(d, 'f_overdue_count').current);
  });
});

describe('due dates, aging reports, balances and the sources that cannot support a metric', () => {
  it('missing due dates: the overdue amount is WITHHELD (never guessed) once too many open items lack one', () => {
    const noDue = ar.records.map((r) => (r.kind === 'open_item' ? { ...r, dueDate: undefined } : r));
    const d = dash(noDue);
    for (const id of ['f_overdue', 'f_overdue_share', 'f_overdue_count', 'f_due_soon']) expect(kpi(d, id).unavailable, id).toBe('due_dates_missing');
    expect(kpi(d, 'f_outstanding').current).toBeCloseTo(refOutstanding(ar, END), 2);
    expect(d.limitations.some((l) => l.code === 'f_due_missing')).toBe(true);
    expect(d.charts.find((c) => c.id === 'dueTimeline')!.available).toBe(false);
    // a few missing due dates (< 20 % of the amount) keep the metrics, and say how many were left out
    let n = 0;
    const few = ar.records.map((r) => (r.kind === 'open_item' && r.date === END && (r.outstanding ?? 0) > 0 && ++n <= 2 ? { ...r, dueDate: undefined } : r));
    const f = dash(few);
    expect(kpi(f, 'f_overdue').current).not.toBeNull();
    expect(f.limitations.find((l) => l.code === 'f_due_missing')).toMatchObject({ count: expect.any(Number) });
  });

  it('an aging report supplies totals, buckets and counterparty ranking – but no invoice counts, due soon or drill by invoice', () => {
    const buckets = new Map<string, { nd: number; d30: number; d60: number; d90: number; d90p: number; name: string }>();
    for (const o of snapLines(ar, END).filter((x) => x.outstanding > 0)) {
      const e = buckets.get(o.cp) ?? { nd: 0, d30: 0, d60: 0, d90: 0, d90p: 0, name: o.name };
      const days = diff(o.due, END);
      e[days <= 0 ? 'nd' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'd90p'] += o.outstanding;
      buckets.set(o.cp, e);
    }
    const recs: FinanceRecord[] = [...buckets.entries()].map(([cp, e]) => ({ key: cp, kind: 'aging', side: 'receivable', date: END, documentId: `aging receivable ${END}`, counterpartyId: cp, counterpartyName: e.name, outstanding: e.nd + e.d30 + e.d60 + e.d90 + e.d90p, buckets: { nd: e.nd, d30: e.d30, d60: e.d60, d90: e.d90, d90p: e.d90p }, basis: 'net', currency: 'EUR', sourceRow: 2 }));
    const d = dash(recs);
    expect(kpi(d, 'f_overdue').current).toBeCloseTo(r2(refOverdue(ar, END) + 0), 1);
    expect(kpi(d, 'f_overdue_count').unavailable).toBe('needs_open_items');
    expect(kpi(d, 'f_due_soon').unavailable).toBe('needs_open_items');
    expect(d.asOf.source).toBe('aging');
    expect(d.limitations.map((l) => l.code)).toContain('f_source_aging');
    expect(d.overdueLines).toEqual([]);
    expect(d.overdueRank[0]!.label).toBe('UAB Žalioji dirbtuvė');
  });

  it('a balance snapshot gives outstanding per counterparty only; overdue and aging are withheld', () => {
    const recs: FinanceRecord[] = [...snapLines(ar, END).reduce((m, o) => m.set(o.cp, { name: o.name, v: (m.get(o.cp)?.v ?? 0) + o.outstanding }), new Map<string, { name: string; v: number }>()).entries()].map(([cp, e]) => ({ key: cp, kind: 'balance', side: 'receivable', date: END, documentId: `balance receivable ${END}`, counterpartyId: cp, counterpartyName: e.name, outstanding: e.v, basis: 'net', currency: 'EUR', sourceRow: 2 }));
    const d = dash(recs);
    expect(kpi(d, 'f_outstanding').current).toBeCloseTo(refOutstanding(ar, END), 2);
    expect(kpi(d, 'f_overdue').unavailable).toBe('needs_due_dates');
    expect(d.aging).toBeNull();
    expect(d.limitations.map((l) => l.code)).toContain('f_source_balance');
  });

  it('on the same date the most detailed source wins and the others are reported, never added', () => {
    const bal: FinanceRecord = { key: 'b1', kind: 'balance', side: 'receivable', date: END, documentId: `balance receivable ${END}`, counterpartyId: 'C01', counterpartyName: 'x', outstanding: 99999, basis: 'net', currency: 'EUR', sourceRow: 2 };
    const d = dash([...ar.records, bal]);
    expect(kpi(d, 'f_outstanding').current).toBeCloseTo(refOutstanding(ar, END), 2);
    expect(d.limitations).toContainEqual({ code: 'f_unused_sources', count: 1 });
  });

  it('invoices and payments ALONE never produce an outstanding balance (it is not "invoiced − paid")', () => {
    const flows = ar.records.filter((r) => r.kind === 'invoice' || r.kind === 'payment' || r.kind === 'credit_note');
    const d = dash(flows);
    for (const id of ['f_outstanding', 'f_overdue', 'f_overdue_share', 'f_concentration']) expect([id, kpi(d, id).current]).toEqual([id, null]);
    expect(kpi(d, 'f_outstanding').unavailable).toBe('no_position');
    expect(d.limitations.map((l) => l.code)).toContain('f_no_position');
    expect(kpi(d, 'f_invoiced').current).not.toBeNull(); // the flows themselves are fine
    expect(kpi(d, 'f_dso').unavailable).toBe('no_position');
  });
});

describe('flows are separate from balances', () => {
  const sumInv = (w: { from: string; to: string }) => r2(ar.invoices.filter((i) => inRange(i.date, w)).reduce((s, i) => s + i.amount, 0));
  const sumPay = (w: { from: string; to: string }) => r2(ar.payments.filter((p) => inRange(p.date, w)).reduce((s, p) => s + p.amount, 0));

  it('invoiced, paid and credited in the period equal the reference (the repeated register line IS in "paid" – and flagged)', () => {
    const d = dash();
    expect(kpi(d, 'f_invoiced').current).toBeCloseTo(sumInv(CUR), 2);
    expect(kpi(d, 'f_invoiced').previous).toBeCloseTo(sumInv(PREV), 2);
    expect(kpi(d, 'f_paid').current).toBeCloseTo(sumPay(CUR), 2);
    expect(kpi(d, 'f_paid').previous).toBeCloseTo(sumPay(PREV), 2);
    expect(kpi(d, 'f_outstanding').current).not.toBeCloseTo(sumInv(CUR) - sumPay(CUR), 0);
  });

  it('DSO = outstanding ÷ invoiced in the period × days, only when an invoice register covers the period', () => {
    const d = dash();
    expect(kpi(d, 'f_dso').current).toBeCloseTo((refOutstanding(ar, END) / sumInv(CUR)) * 30, 6);
    const noReg = dash(ar.records.filter((r) => r.kind !== 'invoice'));
    expect(kpi(noReg, 'f_dso').unavailable).toBe('no_invoice_register');
    expect(kpi(noReg, 'f_dso').current).toBeNull();
    // a register that stops before the period cannot give a DSO either
    const stale = dash(ar.records.filter((r) => r.kind !== 'invoice' || r.date <= '2025-10-31'));
    expect(kpi(stale, 'f_dso').unavailable).toBe('register_gap');
    // and DPO for payables
    const p = dash(all, { side: 'payable' });
    const ap30 = r2(ap.invoices.filter((i) => inRange(i.date, CUR)).reduce((s, i) => s + i.amount, 0));
    if (kpi(p, 'f_dpo').current !== null) expect(kpi(p, 'f_dpo').current).toBeCloseTo((refOutstanding(ap, END) / ap30) * 30, 6);
    else expect(kpi(p, 'f_dpo').unavailable).toBe('no_invoices'); // fewer than 10 invoices in the period
  });

  it('payment delay uses ONLY payments matched to an invoice by exact reference; early payments count negatively; weighted by amount', () => {
    const d = dash();
    const m = ar.booked.filter((p) => inRange(p.date, CUR));
    const dueOf = new Map(ar.invoices.map((i) => [i.no, i.due]));
    let paid = 0, w = 0;
    for (const p of m) { paid += p.amount; w += diff(dueOf.get(p.invoice!)!, p.date) * p.amount; }
    // the register repeats one of these payment lines; the repeat is a payment line like any other for the delay (and is flagged as a possible duplicate)
    const rep = ar.payments.filter((p) => inRange(p.date, CUR) && p.invoice);
    paid = 0; w = 0;
    for (const p of rep) { paid += p.amount; w += diff(dueOf.get(p.invoice!)!, p.date) * p.amount; }
    expect(kpi(d, 'f_delay').current).toBeCloseTo(w / paid, 6);
    expect(d.matching.matched).toBe(ar.payments.filter((p) => p.invoice && p.date <= END).length);
    expect(d.matching.unreferenced).toBe(2); // the two look-alike payments carry no invoice reference
  });

  it('payments whose reference is wrong, missing or belongs to another counterparty are NOT matched', () => {
    const bad = ar.records.map((r) => {
      if (r.kind !== 'payment') return r;
      if (r.counterpartyId === 'C01') return { ...r, reference: 'NO-SUCH' };
      if (r.counterpartyId === 'C02') return { ...r, counterpartyId: 'C03', counterpartyName: 'x' };
      return r;
    });
    const d = dash(bad);
    expect(d.matching.notFound + d.matching.conflict).toBeGreaterThan(20);
    expect(d.limitations.map((l) => l.code)).toContain('f_unmatched_payments');
    const c1 = d.pays.filter((p) => p.cp === 'c01');
    expect(c1.every((p) => p.status === 'not_found' && p.delay === undefined)).toBe(true);
  });

  it('duplicate and corrected invoices: identical repeats count once, conflicting numbers are excluded and reported', () => {
    const dupe = ar.records.filter((r) => r.kind === 'invoice' && r.date >= '2025-11-16').slice(0, 3);
    const identical = dupe.map((r) => ({ ...r, key: r.key + '-dup' }));
    const conflicting = [{ ...dupe[0]!, key: 'conf', amount: (dupe[0]!.amount ?? 0) + 50 }];
    const base = dash();
    const a = dash([...ar.records, ...identical]);
    expect(kpi(a, 'f_invoiced').current).toBeCloseTo(kpi(base, 'f_invoiced').current!, 6);
    expect(a.limitations).toContainEqual({ code: 'f_duplicate_invoices', count: 3 });
    const b = dash([...ar.records, ...conflicting]);
    expect(kpi(b, 'f_invoiced').current).toBeCloseTo(kpi(base, 'f_invoiced').current! - (dupe[0]!.amount ?? 0), 6);
    expect(b.limitations).toContainEqual({ code: 'f_conflicting_invoices', count: 1 });
  });

  it('missing identifiers: lines without a counterparty are grouped as "—", payments without any reference stay unreferenced', () => {
    const noCp = ar.records.map((r) => (r.kind === 'open_item' && r.counterpartyId === 'C10' ? { ...r, counterpartyId: undefined, counterpartyName: undefined } : r));
    const d = dash(noCp);
    expect(d.tables.customer!.rows.find((r) => r.label === '—')!.current).toBeCloseTo(r2(snapLines(ar, END).filter((o) => o.cp === 'C10').reduce((s, o) => s + o.outstanding, 0)), 2);
    expect(kpi(d, 'f_outstanding').current).toBeCloseTo(refOutstanding(ar, END), 2);
    const noRef = ar.records.map((r) => (r.kind === 'payment' ? { ...r, reference: undefined } : r));
    const e = dash(noRef);
    expect(e.matching.matched).toBe(0);
    expect(kpi(e, 'f_delay').unavailable).toBe('few_matches');
  });
});

describe('credit notes and possible duplicate payments (risk indicators, never confirmed)', () => {
  it('credit notes: matched by exact reference only; the others are listed with their status and POSSIBLE matches', () => {
    const d = dash();
    const by = (no: string) => d.credits.find((c) => c.no === no)!;
    expect(by('KR-1').status).toBe('matched');
    expect(by('KR-2').status).toBe('reference_not_found');
    expect(by('KR-3').status).toBe('no_reference');
    expect(by('KR-3').possible).toHaveLength(1); // the invoice of exactly 300.00 – shown, never applied
    expect(by('KR-3').possible[0]!.amount).toBe(300);
    expect(by('KR-2').possible).toEqual([]);
    expect(kpi(d, 'f_credits').current).toBe(450); // 150 + 300
    expect(d.openCredits.map((c) => c.no).sort()).toEqual(expect.arrayContaining(['KR-2', 'KR-3']));
    // before the notes were issued nothing is unmatched
    expect(dash(all, { period: { preset: 'custom', custom: { current: { from: '2025-09-01', to: '2025-09-30' }, previous: { from: '2025-08-01', to: '2025-08-31' } } } as never }).kpis.find((k) => k.id === 'f_credits')!.current).toBe(0);
  });

  it('duplicate payments are classified as possible: identical repeat, same invoice twice, overpayment, look-alike – with the possible excess', () => {
    const d = dash();
    const tier = (t: string) => d.duplicates.filter((x) => x.tier === t);
    expect(tier('exact_repeat')).toHaveLength(1);
    expect(tier('exact_repeat')[0]!.label).toContain('Kapa');
    const dupPay = ar.payments.filter((p) => p.cp === 'C10').find((p, i, a) => a.filter((q) => q.ref === p.ref).length > 1)!;
    expect(tier('exact_repeat')[0]!.excess).toBeCloseTo(dupPay.amount, 2);
    expect(tier('same_invoice')).toHaveLength(1);
    expect(tier('same_invoice')[0]!.label).toContain('Jota'); // C09 paid one invoice twice
    const c9 = ar.booked.filter((p) => p.cp === 'C09' && p.invoice === tier('same_invoice')[0]!.invoiceNo);
    expect(tier('same_invoice')[0]!.excess).toBeCloseTo(c9[0]!.amount, 2);
    expect(tier('overpaid')).toHaveLength(1);
    expect(tier('overpaid')[0]!.label).toContain('Teta'); // C08 paid 110 %
    expect(tier('lookalike')).toHaveLength(1);
    expect(tier('lookalike')[0]!.excess).toBeCloseTo(1234.56, 2);
    expect(tier('lookalike')[0]!.label).toContain('Eta');
    // partial payments (C05) are NOT flagged, and neither are on-time full payments
    expect(d.duplicates.some((x) => x.label.includes('Epsilon'))).toBe(false);
    expect(kpi(d, 'f_dup').current).toBeGreaterThanOrEqual(0);
  });

  it('two different known invoices of the same amount are not a look-alike; far-apart payments are not either', () => {
    const base = ar.records.filter((r) => r.kind === 'invoice' || (r.kind === 'payment' && r.counterpartyId !== 'C07'));
    const inv = base.filter((r) => r.kind === 'invoice' && r.counterpartyId === 'C07').slice(0, 2).map((r) => ({ ...r, amount: 500 }));
    const others = base.filter((r) => !(r.kind === 'invoice' && r.counterpartyId === 'C07'));
    const mkPay = (i: number, ref: string, date: string, invoice?: string): FinanceRecord => ({ key: `p${i}`, kind: 'payment', side: 'receivable', date, documentId: ref, reference: invoice, counterpartyId: 'C07', counterpartyName: 'Eta', amount: 500, basis: 'net', currency: 'EUR', sourceRow: 2 });
    const two = dash([...others, ...inv, mkPay(1, 'A', '2025-12-01', inv[0]!.documentId), mkPay(2, 'B', '2025-12-03', inv[1]!.documentId)]);
    expect(two.duplicates.some((x) => x.cp === 'c07')).toBe(false);
    const far = dash([...others, ...inv, mkPay(1, 'A', '2025-11-20'), mkPay(2, 'B', '2025-12-10')]);
    expect(far.duplicates.some((x) => x.cp === 'c07')).toBe(false);
    const near = dash([...others, ...inv, mkPay(1, 'A', '2025-12-01'), mkPay(2, 'B', '2025-12-04')]);
    expect(near.duplicates.some((x) => x.cp === 'c07' && x.tier === 'lookalike')).toBe(true);
  });
});

describe('payment behaviour', () => {
  it('a customer who started paying later is found: C04 +10 days before 1 September, +25 days after', () => {
    const d = dash();
    const row = d.behaviour.find((b) => b.key === 'c04')!;
    expect(row.cur.avg).toBeCloseTo(25, 6);
    expect(row.prev.avg).toBeCloseTo(25, 6); // both default windows are after the change
    const wide = dash(all, { period: { preset: 'custom', custom: { current: { from: '2025-11-10', to: '2025-12-15' }, previous: { from: '2025-08-01', to: '2025-09-30' } } } as never });
    const c4 = wide.behaviour.find((b) => b.key === 'c04')!;
    expect(c4.prev.avg).toBeCloseTo(10, 6);
    expect(c4.cur.avg).toBeCloseTo(25, 6);
    expect(c4.change).toBeCloseTo(15, 6);
    const c1 = wide.behaviour.find((b) => b.key === 'c01')!;
    expect(c1.cur.avg).toBeCloseTo(0, 6); // pays exactly on the due date
  });
});
