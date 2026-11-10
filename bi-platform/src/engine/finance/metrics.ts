import type { GenericMetric } from '../analytics/compare';
import type { FinanceRecord, FinanceSide } from '../types';
import type { Range } from '../analytics/periods';
import { daysBetween } from '../analytics/dates';
import {
  covers, creditReview, delayIn, duplicatePayments, MATCH_MIN, DUE_KNOWN_MIN, pickSnapshot, positionOf, posSig,
  type Cov, type CreditRow, type Delay, type DupGroup, type FinPos, type FinSnapshot, type PayInfo, type Universe,
} from './ledger';

export type FinanceMetricId = 'f_outstanding' | 'f_overdue' | 'f_overdue_share' | 'f_overdue_count' | 'f_due_soon' | 'f_concentration' | 'f_invoiced' | 'f_paid' | 'f_delay' | 'f_dso' | 'f_dpo' | 'f_credits' | 'f_dup';
export const FINANCE_KPI_ORDER: Record<FinanceSide, FinanceMetricId[]> = {
  receivable: ['f_outstanding', 'f_overdue', 'f_overdue_share', 'f_overdue_count', 'f_due_soon', 'f_concentration', 'f_dso', 'f_delay', 'f_invoiced', 'f_paid', 'f_credits', 'f_dup'],
  payable: ['f_outstanding', 'f_overdue', 'f_overdue_share', 'f_overdue_count', 'f_due_soon', 'f_concentration', 'f_dpo', 'f_delay', 'f_invoiced', 'f_paid', 'f_credits', 'f_dup'],
};

export type FinanceUnavailable =
  | 'no_data' | 'no_position' | 'no_previous_snapshot' | 'needs_due_dates' | 'due_dates_missing' | 'needs_open_items' | 'no_invoice_register' | 'no_payment_register' | 'no_credit_register'
  | 'register_gap' | 'few_matches' | 'few_counterparties' | 'no_invoices';

export interface FinanceContext { side: FinanceSide }
export interface Flow { sum: number; count: number }

/** Everything the metrics need about ONE window. Computed once, then read by the metric registry, tables, charts and insights. */
export interface FinWindow {
  window: Range;
  position: FinPos | null;
  invoiced: Flow | null;
  invoicedWhy?: FinanceUnavailable;
  paid: Flow | null;
  paidWhy?: FinanceUnavailable;
  credited: Flow | null;
  delay: Delay;
  hasPayments: boolean;
  dso: number | null;
  dsoWhy?: FinanceUnavailable;
  /** credit notes dated up to the window end that are not matched to a loaded invoice (register-based) */
  unmatchedCredits: { amount: number; count: number } | null;
  dup: { groups: DupGroup[]; count: number; excess: number } | null;
}

export interface FinInput {
  records: FinanceRecord[];
  snaps: FinSnapshot[];
  universe: Universe;
  pays: PayInfo[];
  creditRows: CreditRow[];
  covInvoice: Cov | null;
  covPayment: Cov | null;
  covCredit: Cov | null;
  sameAs?: string;
}

const sumIn = (recs: FinanceRecord[], kind: FinanceRecord['kind'], w: Range, f: (r: FinanceRecord) => number): Flow => {
  let sum = 0, count = 0;
  for (const r of recs) if (r.kind === kind && r.date >= w.from && r.date <= w.to) { sum += f(r); count++; }
  return { sum, count };
};

export function evaluateWindow(inp: FinInput, window: Range): FinWindow {
  let snap = pickSnapshot(inp.snaps, window.to);
  let position = snap ? positionOf(snap, window.to) : null;
  if (position && inp.sameAs !== undefined && posSig(position) === inp.sameAs) position = null;
  const days = daysBetween(window.from, window.to) + 1;
  const ev: FinWindow = { window, position, invoiced: null, paid: null, credited: null, delay: delayIn(inp.pays, window), hasPayments: inp.covPayment !== null, dso: null, unmatchedCredits: null, dup: null };
  void snap;

  // flows: always separate from outstanding – an invoiced or paid total is never turned into a balance
  if (!inp.covInvoice) ev.invoicedWhy = 'no_invoice_register';
  else if (!covers(inp.covInvoice, window)) ev.invoicedWhy = 'register_gap';
  else {
    let sum = 0, count = 0;
    for (const i of inp.universe.map.values()) if (i.source === 'invoice' && !i.conflicting && i.amount !== undefined && i.date && i.date >= window.from && i.date <= window.to) { sum += i.amount; count++; }
    ev.invoiced = { sum, count };
  }
  if (!inp.covPayment) ev.paidWhy = 'no_payment_register';
  else if (!covers(inp.covPayment, window)) ev.paidWhy = 'register_gap';
  else ev.paid = sumIn(inp.records, 'payment', window, (r) => r.amount ?? 0);
  if (inp.covCredit && covers(inp.covCredit, window)) ev.credited = sumIn(inp.records, 'credit_note', window, (r) => r.amount ?? 0);

  // DSO / DPO: outstanding at the end ÷ invoiced in the window × days – only with a position AND an invoice register that covers the window
  if (!position) ev.dsoWhy = 'no_position';
  else if (!ev.invoiced) ev.dsoWhy = ev.invoicedWhy;
  else if (ev.invoiced.count < 10 || ev.invoiced.sum <= 0) ev.dsoWhy = 'no_invoices';
  else ev.dso = (position.total / ev.invoiced.sum) * days;

  if (inp.covCredit) {
    const un = creditReviewUpTo(inp.creditRows, window.to).filter((c) => c.status !== 'matched');
    ev.unmatchedCredits = { amount: un.reduce((s, c) => s + c.amount, 0), count: un.length };
  }
  if (inp.covPayment) {
    const groups = duplicatePayments(inp.pays.filter((p) => p.rec.date <= window.to), inp.creditRows).filter((g) => g.latest >= window.from);
    ev.dup = { groups, count: groups.length, excess: groups.reduce((s, g) => s + g.excess, 0) };
  }
  return ev;
}
const creditReviewUpTo = (rows: CreditRow[], to: string) => rows.filter((r) => r.rec.date <= to);

const ok = (value: number) => ({ value });
const no = (unavailable: FinanceUnavailable) => ({ value: null as number | null, unavailable });
const positive = (p: FinPos) => [...p.byCp.values()].map((c) => c.outstanding).filter((v) => v > 0);

export const FINANCE_METRICS: Record<FinanceMetricId, GenericMetric<FinWindow, FinanceContext>> = {
  f_outstanding: { id: 'f_outstanding', unit: 'money', higherIsBetter: false, neutral: true, evaluate: (a) => (a.position ? ok(a.position.total) : no('no_position')) },
  f_overdue: {
    id: 'f_overdue', unit: 'money', higherIsBetter: false,
    evaluate: (a) => (!a.position ? no('no_position') : a.position.source === 'balance' ? no('needs_due_dates') : a.position.dueKnown !== null && a.position.dueKnown < DUE_KNOWN_MIN ? no('due_dates_missing') : ok(a.position.overdue ?? 0)),
  },
  f_overdue_share: {
    id: 'f_overdue_share', unit: 'pct', higherIsBetter: false,
    evaluate: (a) => (!a.position ? no('no_position') : a.position.source === 'balance' ? no('needs_due_dates') : a.position.dueKnown !== null && a.position.dueKnown < DUE_KNOWN_MIN ? no('due_dates_missing') : a.position.total <= 0 ? no('no_data') : ok((a.position.overdue ?? 0) / a.position.total)),
  },
  f_overdue_count: {
    id: 'f_overdue_count', unit: 'count', higherIsBetter: false,
    evaluate: (a) => (!a.position ? no('no_position') : a.position.source !== 'open_item' ? no('needs_open_items') : a.position.dueKnown! < DUE_KNOWN_MIN ? no('due_dates_missing') : ok(a.position.overdueCount ?? 0)),
  },
  f_due_soon: {
    id: 'f_due_soon', unit: 'money', higherIsBetter: false, neutral: true,
    evaluate: (a) => (!a.position ? no('no_position') : a.position.source !== 'open_item' ? no('needs_open_items') : a.position.dueKnown! < DUE_KNOWN_MIN ? no('due_dates_missing') : ok(a.position.dueSoon ?? 0)),
  },
  f_concentration: {
    id: 'f_concentration', unit: 'pct', higherIsBetter: false,
    evaluate: (a) => {
      if (!a.position) return no('no_position');
      const v = positive(a.position);
      const total = v.reduce((s, x) => s + x, 0);
      return v.length < 3 || total <= 0 ? no('few_counterparties') : ok(Math.max(...v) / total);
    },
  },
  f_invoiced: { id: 'f_invoiced', unit: 'money', higherIsBetter: true, neutral: true, evaluate: (a) => (a.invoiced ? ok(a.invoiced.sum) : no(a.invoicedWhy ?? 'no_invoice_register')) },
  f_paid: { id: 'f_paid', unit: 'money', higherIsBetter: true, neutral: true, evaluate: (a) => (a.paid ? ok(a.paid.sum) : no(a.paidWhy ?? 'no_payment_register')) },
  f_delay: {
    id: 'f_delay', unit: 'qty', higherIsBetter: false,
    evaluate: (a) => (!a.hasPayments ? no('no_payment_register') : a.delay.n < MATCH_MIN || a.delay.avg === null ? no('few_matches') : ok(a.delay.avg)),
  },
  f_dso: { id: 'f_dso', unit: 'qty', higherIsBetter: false, evaluate: (a) => (a.dso !== null ? ok(a.dso) : no(a.dsoWhy ?? 'no_data')) },
  f_dpo: { id: 'f_dpo', unit: 'qty', higherIsBetter: true, neutral: true, evaluate: (a) => (a.dso !== null ? ok(a.dso) : no(a.dsoWhy ?? 'no_data')) },
  f_credits: { id: 'f_credits', unit: 'money', higherIsBetter: false, evaluate: (a) => (a.unmatchedCredits ? ok(a.unmatchedCredits.amount) : no('no_credit_register')) },
  f_dup: { id: 'f_dup', unit: 'count', higherIsBetter: false, evaluate: (a) => (a.dup ? ok(a.dup.count) : no('no_payment_register')) },
};

/** Numbers behind "How is this calculated?". Keys ending in "Value" are rendered as money by the UI. */
export function explainFinanceInputs(id: FinanceMetricId, a: FinWindow): Record<string, number> {
  const p = a.position;
  const days = daysBetween(a.window.from, a.window.to) + 1;
  switch (id) {
    case 'f_outstanding': return { lines: p?.lines ?? 0, creditsValue: p?.buckets?.credits ?? 0 };
    case 'f_overdue': case 'f_overdue_share': return { lines: p?.lines ?? 0, overdueValue: p?.overdue ?? 0, outstandingValue: p?.total ?? 0 };
    case 'f_overdue_count': return { count: p?.overdueCount ?? 0, lines: p?.lines ?? 0 };
    case 'f_due_soon': return { count: p?.dueSoonCount ?? 0, soonValue: p?.dueSoon ?? 0 };
    case 'f_concentration': return { counterparties: p ? positive(p).length : 0 };
    case 'f_invoiced': return { count: a.invoiced?.count ?? 0 };
    case 'f_paid': return { count: a.paid?.count ?? 0 };
    case 'f_delay': return { n: a.delay.n, paidValue: a.delay.paid, min: MATCH_MIN };
    case 'f_dso': case 'f_dpo': return { outstandingValue: p?.total ?? 0, invoicedValue: a.invoiced?.sum ?? 0, days, count: a.invoiced?.count ?? 0 };
    case 'f_credits': return { count: a.unmatchedCredits?.count ?? 0 };
    case 'f_dup': return { count: a.dup?.count ?? 0, excessValue: a.dup?.excess ?? 0 };
  }
}

/** Which metrics a freshly normalised file can support (import diagnostics) – judged from the file alone. */
export function predictFinanceMetrics(records: FinanceRecord[], side: FinanceSide): { id: string; available: boolean; reason?: string }[] {
  const has = (k: FinanceRecord['kind']) => records.some((r) => r.kind === k);
  const open = has('open_item');
  const snap = open || has('aging') || has('balance');
  const dueKnown = open && records.filter((r) => r.kind === 'open_item' && (r.outstanding ?? 0) > 0).every((r) => r.dueDate) ;
  const inv = has('invoice');
  const pay = has('payment');
  const cn = has('credit_note');
  const row = (id: string, okay: boolean, reason: string) => ({ id, available: okay, reason: okay ? undefined : reason });
  const needsSnap = (okay: boolean, reason: string) => (snap ? row('', okay, reason) : row('', false, 'no_position'));
  return FINANCE_KPI_ORDER[side].map((id) => {
    switch (id) {
      case 'f_outstanding': case 'f_concentration': return { ...needsSnap(true, ''), id };
      case 'f_overdue': case 'f_overdue_share': return { ...needsSnap(has('aging') || dueKnown, has('balance') ? 'needs_due_dates' : 'due_dates_missing'), id };
      case 'f_overdue_count': case 'f_due_soon': return { ...needsSnap(open && dueKnown, open ? 'due_dates_missing' : 'needs_open_items'), id };
      case 'f_invoiced': return row(id, inv, 'no_invoice_register');
      case 'f_paid': return row(id, pay, 'no_payment_register');
      case 'f_delay': return row(id, pay && (inv || open), pay ? 'no_invoice_register' : 'no_payment_register');
      case 'f_dso': case 'f_dpo': return row(id, snap && inv, snap ? 'no_invoice_register' : 'no_position');
      case 'f_credits': return row(id, cn, 'no_credit_register');
      case 'f_dup': return row(id, pay, 'no_payment_register');
    }
  });
}

export { creditReview };
