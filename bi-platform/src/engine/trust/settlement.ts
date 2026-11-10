import { daysBetween } from '../analytics/dates';
import { buildUniverse, listSnapshots, matchPayments, pickSnapshot, type InvoiceInfo, type PayInfo } from '../finance/ledger';
import { cpKey, cpLabel, norm } from '../finance/keys';
import type { FinanceRecord } from '../types';
import type { Described, EvidenceRecord, ExposureKind, PotentialValue, SettlementResult, TrustFinding } from './types';

const EPS = 0.01;
/** payments exceeding an invoice by no more than this are rounding, not an overpayment */
const ROUND_TOL = 0.05;
/** repeated lookalike payments at a regular (about monthly) rhythm are a recurring charge, not a duplicate */
const RECURRING_GAP = [25, 35] as const;
const LOOKALIKE_DAYS = 7;

const er = (r: FinanceRecord, role: EvidenceRecord['role']): EvidenceRecord => ({ key: r.key, kind: r.kind, role, date: r.date, documentId: r.invoiceNo ?? r.documentId, counterparty: cpLabel(r) || undefined, amount: r.kind === 'open_item' ? (r.outstanding ?? 0) : (r.rawAmount ?? r.amount ?? 0), importId: r.importId, sourceRow: r.sourceRow });
const d = (key: string, params?: Described['params']): Described => ({ key, params });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

interface Ctx { recs: FinanceRecord[]; side: 'receivable' | 'payable'; currency: string }
const base = (c: Ctx) => ({ currency: c.currency, amountBasis: 'as_stated' as const, side: c.side, dateDimension: 'document_payment' as const });
const LIM_BASIS = d('trust.lim.basis_as_stated');

/**
 * Settlement analysis of ONE side in ONE currency (the caller never mixes currencies). Everything is deterministic and conservative:
 *  – a credit is "unapplied" only on evidence that it is still open (a credit balance in an open-item report) or that it exceeds the invoice it references;
 *    a missing invoice is NOT evidence that the credit is unused;
 *  – reversals and refunds are netted before anything is called a duplicate or an excess;
 *  – recurring charges and instalments are not duplicates;
 *  – an amount is called possible excess / open credit only where the records support it, otherwise it is an amount to investigate.
 */
export function analyseSettlement(recs: FinanceRecord[], side: 'receivable' | 'payable', currency: string): SettlementResult {
  const c: Ctx = { recs, side, currency };
  const findings: TrustFinding[] = [];
  const reconciled: SettlementResult['reconciled'] = [];
  const u = buildUniverse(recs);
  const snaps = listSnapshots(recs).filter((s) => s.kind === 'open_item');
  const latest = snaps.length ? snaps[snaps.length - 1]! : null;
  const dates = recs.map((r) => r.date).sort();
  const period = dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : undefined;

  // indexes: every lookup below is O(1), so the analysis stays linear on ledgers of 100 000+ lines
  const invByCp = new Map<string, InvoiceInfo[]>();
  for (const i of u.map.values()) (invByCp.get(i.cp) ?? invByCp.set(i.cp, []).get(i.cp)!).push(i);
  const recByInv = new Map<string, FinanceRecord>();
  for (const x of recs) { if (x.kind !== 'invoice' && x.kind !== 'open_item') continue; const no = x.kind === 'invoice' ? x.documentId : x.invoiceNo; if (!no) continue; const k = `${cpKey(x)}|${norm(no)}`; if (!recByInv.has(k) || x.kind === 'invoice') recByInv.set(k, x); }
  const invRec = (i: InvoiceInfo): EvidenceRecord[] => { const r = recByInv.get(i.key); return r ? [er(r, 'invoice')] : []; };
  // negative open-item lines of the newest open-item report = credit balances the report itself states
  const openCredits = latest ? latest.records.filter((r) => (r.outstanding ?? 0) < -EPS) : [];
  const usedOpen = new Set<string>();
  const openByNo = new Map<string, FinanceRecord[]>(), openByCp = new Map<string, FinanceRecord[]>();
  for (const r of openCredits) { (openByNo.get(`${cpKey(r)}|${norm(r.invoiceNo)}`) ?? openByNo.set(`${cpKey(r)}|${norm(r.invoiceNo)}`, []).get(`${cpKey(r)}|${norm(r.invoiceNo)}`)!).push(r); (openByCp.get(cpKey(r)) ?? openByCp.set(cpKey(r), []).get(cpKey(r))!).push(r); }
  const openFor = (cp: string, no: string | undefined, amount: number) => (no ? (openByNo.get(`${cp}|${norm(no)}`) ?? []).find((r) => !usedOpen.has(r.key)) : (openByCp.get(cp) ?? []).find((r) => !usedOpen.has(r.key) && Math.abs(Math.abs(r.outstanding!) - amount) <= EPS));

  // ── payments: net reversals and refunds first
  const pays = matchPayments(recs, u);
  const reversed = new Set<string>();
  const byCpAmount = new Map<string, PayInfo[]>();
  for (const p of pays) (byCpAmount.get(`${p.cp}|${Math.abs(p.amount).toFixed(2)}`) ?? byCpAmount.set(`${p.cp}|${Math.abs(p.amount).toFixed(2)}`, []).get(`${p.cp}|${Math.abs(p.amount).toFixed(2)}`)!).push(p);
  for (const ps of byCpAmount.values()) {
    const pos = ps.filter((p) => p.amount > 0).sort((a, b) => a.rec.date.localeCompare(b.rec.date));
    for (const neg of ps.filter((p) => p.amount < 0).sort((a, b) => a.rec.date.localeCompare(b.rec.date))) {
      const i = pos.findIndex((p) => !reversed.has(p.rec.key) && p.rec.date <= neg.rec.date && norm(p.rec.reference) === norm(neg.rec.reference));
      if (i >= 0) { reversed.add(pos[i]!.rec.key); reversed.add(neg.rec.key); }
    }
  }
  const livePays = pays.filter((p) => !reversed.has(p.rec.key));

  // ── credits ────────────────────────────────────────────────────────────────
  const credits = recs.filter((r) => r.kind === 'credit_note');
  const creditReversed = new Set<string>();
  for (const a of credits) {
    if ((a.rawAmount ?? a.amount ?? 0) >= 0 || creditReversed.has(a.key)) continue;
    const mate = credits.find((b) => b !== a && !creditReversed.has(b.key) && (b.rawAmount ?? 0) > 0 && cpKey(b) === cpKey(a) && Math.abs((b.amount ?? 0) - (a.amount ?? 0)) <= EPS && (norm(b.reference) === norm(a.reference) || norm(b.documentId) === norm(a.documentId)));
    if (mate) { creditReversed.add(a.key); creditReversed.add(mate.key); }
  }
  const credByRef = new Map<string, FinanceRecord[]>();
  for (const x of credits) if (!creditReversed.has(x.key) && x.reference) (credByRef.get(`${cpKey(x)}|${norm(x.reference)}`) ?? credByRef.set(`${cpKey(x)}|${norm(x.reference)}`, []).get(`${cpKey(x)}|${norm(x.reference)}`)!).push(x);
  for (const cr of credits) {
    const cp = cpKey(cr);
    const label = cpLabel(cr) || '—';
    const amount = cr.amount ?? 0;
    const id = `credit:${cr.key}`;
    const rec = [er(cr, 'credit')];
    const signNote = cr.creditEvidence === 'sign' ? [d('trust.asm.credit_by_sign')] : [];
    if (creditReversed.has(cr.key)) { reconciled.push({ id, state: 'reversed', label, amount, recordKey: cr.key }); continue; }
    // 1 — still open in the newest open-item report: a credit balance the report states itself
    const open = latest && latest.date >= cr.date ? openFor(cp, cr.documentId, amount) : undefined;
    if (open) {
      usedOpen.add(open.key);
      const bal = Math.abs(open.outstanding!);
      findings.push({ ...base(c), id, rule: 'unapplied_credit', cp, label, state: 'open_in_report', status: cr.creditEvidence === 'sign' ? 'candidate' : 'verified', period, records: [...rec, er(open, 'open_balance')],
        exposure: { amount: bal, kind: 'open_credit_balance' }, calculation: d('trust.calc.credit_open', { amount: { money: bal }, asof: { date: latest!.date } }), assumptions: signNote, limitations: [LIM_BASIS, d('trust.lim.not_audit')], missing: cr.creditEvidence === 'sign' ? [d('trust.miss.credit_type')] : [],
        rationale: d(cr.creditEvidence === 'sign' ? 'trust.why.credit_open_sign' : 'trust.why.credit_open') });
      continue;
    }
    // 2 — references an invoice
    if (cr.reference) {
      const inv = u.map.get(`${cp}|${norm(cr.reference)}`);
      if (inv && !inv.conflicting && inv.amount !== undefined) {
        const others = (credByRef.get(`${cp}|${norm(cr.reference)}`) ?? []).filter((x) => x !== cr).reduce((s, x) => s + (x.amount ?? 0), 0);
        const room = Math.max(0, inv.amount - others);
        if (amount <= room + EPS) { reconciled.push({ id, state: 'applied', label, amount, recordKey: cr.key }); continue; }
        const rest = amount - room;
        findings.push({ ...base(c), id, rule: 'unapplied_credit', cp, label, state: 'partially_applied', status: 'candidate', period, records: [...rec, ...invRec(inv)],
          exposure: { amount: rest, kind: 'possible_excess' }, calculation: d('trust.calc.credit_partial', { credit: { money: amount }, invoice: { money: inv.amount }, rest: { money: rest } }), assumptions: [d('trust.asm.no_other_settlement'), ...signNote], limitations: [LIM_BASIS, d('trust.lim.not_audit')],
          missing: [d('trust.miss.open_item_report')], rationale: d('trust.why.credit_partial') });
        continue;
      }
      if (inv && inv.conflicting) {
        findings.push({ ...base(c), id, rule: 'unapplied_credit', cp, label, state: 'insufficient', status: 'withheld', period, records: rec, exposure: null, calculation: d('trust.calc.none'), assumptions: [], limitations: [LIM_BASIS], missing: [d('trust.miss.unique_invoice')], rationale: d('trust.why.withheld'), withheldReason: d('trust.withheld.conflicting_invoice', { ref: cr.reference }) });
        continue;
      }
      // referenced invoice not in the export – NOT evidence that the credit is unused
      findings.push({ ...base(c), id, rule: 'unapplied_credit', cp, label, state: 'unmatched_review', status: 'candidate', period, records: rec, exposure: { amount, kind: 'investigate' },
        calculation: d('trust.calc.credit_ref_missing', { ref: cr.reference, amount: { money: amount } }), assumptions: signNote, limitations: [LIM_BASIS, d('trust.lim.invoice_not_in_export'), d('trust.lim.not_audit')], missing: [d('trust.miss.invoice_register'), d('trust.miss.open_item_report')], rationale: d('trust.why.credit_ref_missing') });
      continue;
    }
    // 3 — no reference: a same-amount invoice is only a possible match
    const possible = (invByCp.get(cp) ?? []).filter((i) => !i.conflicting && i.amount !== undefined && Math.abs(i.amount - amount) <= EPS);
    if (latest && latest.date >= cr.date) {
      reconciled.push({ id, state: 'settled_per_report', label, amount, recordKey: cr.key });   // the newest open-item report shows no open credit of this size for the counterparty
      continue;
    }
    if (possible.length) {
      findings.push({ ...base(c), id, rule: 'unapplied_credit', cp, label, state: 'unmatched_review', status: 'candidate', period, records: [...rec, ...possible.slice(0, 3).flatMap((i) => invRec(i))], exposure: { amount, kind: 'investigate' },
        calculation: d('trust.calc.credit_possible', { amount: { money: amount }, n: possible.length }), assumptions: signNote, limitations: [LIM_BASIS, d('trust.lim.possible_only'), d('trust.lim.not_audit')], missing: [d('trust.miss.credit_reference'), d('trust.miss.open_item_report')], rationale: d('trust.why.credit_possible') });
      continue;
    }
    findings.push({ ...base(c), id, rule: 'unapplied_credit', cp, label, state: 'insufficient', status: 'withheld', period, records: rec, exposure: null, calculation: d('trust.calc.none'), assumptions: [], limitations: [LIM_BASIS],
      missing: [d('trust.miss.credit_reference'), d('trust.miss.open_item_report')], rationale: d('trust.why.withheld'), withheldReason: d('trust.withheld.no_settlement_evidence', { no: cr.documentId ?? '—' }) });
  }

  // ── overpayments: net payments referencing one invoice against what it was worth ──
  const credBy = new Map<string, number>();
  for (const cr of credits) { if (creditReversed.has(cr.key) || !cr.reference) continue; const k = `${cpKey(cr)}|${norm(cr.reference)}`; credBy.set(k, (credBy.get(k) ?? 0) + (cr.amount ?? 0)); }
  const byInv = new Map<string, PayInfo[]>();
  for (const p of livePays) if (p.status === 'matched' && p.inv) (byInv.get(p.inv.key) ?? byInv.set(p.inv.key, []).get(p.inv.key)!).push(p);
  const inOverpay = new Set<string>();
  for (const [k, ps] of byInv) {
    const inv = ps[0]!.inv!;
    if (inv.amount === undefined) continue;
    const worth = inv.amount - (credBy.get(k) ?? 0);
    const net = sum(ps.map((p) => p.amount));
    if (net <= worth + ROUND_TOL) continue;
    const excess = net - worth;
    const open = latest ? (openByNo.get(`${inv.cp}|${norm(inv.no)}`) ?? []).find((r) => !usedOpen.has(r.key)) : undefined;
    if (open) usedOpen.add(open.key);
    const verified = Boolean(open && Math.abs(Math.abs(open.outstanding!) - excess) <= EPS);
    const repeated = ps.some((p, i) => ps.some((q, j) => i < j && p.rec.documentId && norm(p.rec.documentId) === norm(q.rec.documentId) && p.rec.date === q.rec.date && Math.abs(p.amount - q.amount) <= EPS));
    const split = ps.some((p, i) => ps.some((q, j) => i < j && p.amount > 0 && Math.abs(p.amount - q.amount) <= EPS));   // two equal payments for one invoice: a possible duplicate
    findings.push({ ...base(c), id: `over:${k}`, rule: split ? 'duplicate_payment' : 'overpayment', cp: inv.cp, label: inv.label, status: verified ? 'verified' : 'candidate', period, records: [...invRec(inv), ...ps.map((p) => er(p.rec, p.amount < 0 ? 'refund' : 'payment')), ...(open ? [er(open, 'open_balance')] : [])],
      exposure: { amount: excess, kind: verified ? 'open_credit_balance' : 'possible_excess' }, calculation: d('trust.calc.overpaid', { paid: { money: net }, worth: { money: worth }, excess: { money: excess }, n: ps.length }),
      assumptions: [d('trust.asm.no_advance'), d('trust.asm.all_credits_loaded'), ...(repeated ? [d('trust.asm.not_export_repeat')] : [])], limitations: [LIM_BASIS, d('trust.lim.not_audit'), ...(repeated ? [d('trust.lim.export_repeat')] : [])], missing: verified ? [] : [d('trust.miss.open_item_report'), d('trust.miss.bank_confirmation')], rationale: d(verified ? 'trust.why.overpaid_verified' : 'trust.why.overpaid_candidate') });
    ps.forEach((p) => inOverpay.add(p.rec.key));
  }

  // ── repeated lines and look-alike payments ──
  const ex = new Map<string, PayInfo[]>();
  for (const p of livePays) if (p.amount > 0 && p.rec.documentId) { const k = [p.cp, norm(p.rec.documentId), p.rec.date, p.amount.toFixed(2)].join('|'); (ex.get(k) ?? ex.set(k, []).get(k)!).push(p); }
  for (const [k, ps] of ex) {
    if (ps.length < 2) continue;
    if (ps.every((p) => inOverpay.has(p.rec.key))) continue;   // already reported, with its invoice, as an overpayment (which names the possible export repeat)
    findings.push({ ...base(c), id: `dup:${k}`, rule: 'duplicate_payment', cp: ps[0]!.cp, label: ps[0]!.label, status: 'candidate', period, records: ps.map((p) => er(p.rec, 'payment')), exposure: { amount: ps[0]!.amount * (ps.length - 1), kind: 'possible_excess' },
      calculation: d('trust.calc.repeat', { n: ps.length, amount: { money: ps[0]!.amount }, excess: { money: ps[0]!.amount * (ps.length - 1) } }), assumptions: [d('trust.asm.not_export_repeat')], limitations: [LIM_BASIS, d('trust.lim.export_repeat'), d('trust.lim.not_audit')],
      missing: [d('trust.miss.bank_confirmation')], rationale: d('trust.why.repeat') });
    ps.forEach((p) => inOverpay.add(p.rec.key));
  }
  // look-alike: same counterparty and amount within a week, no reference that explains them, and no regular rhythm
  const bySame = new Map<string, PayInfo[]>();
  for (const p of livePays) if (p.amount > 0 && !inOverpay.has(p.rec.key)) (bySame.get(`${p.cp}|${p.amount.toFixed(2)}`) ?? bySame.set(`${p.cp}|${p.amount.toFixed(2)}`, []).get(`${p.cp}|${p.amount.toFixed(2)}`)!).push(p);
  for (const [k, ps] of bySame) {
    ps.sort((a, b) => a.rec.date.localeCompare(b.rec.date));
    const recurring = ps.length >= 3 && ps.slice(1).every((p, i) => { const g = daysBetween(ps[i]!.rec.date, p.rec.date); return g >= RECURRING_GAP[0] && g <= RECURRING_GAP[1]; });
    if (recurring) continue;
    for (let i = 1; i < ps.length; i++) {
      const a = ps[i - 1]!, b = ps[i]!;
      if (daysBetween(a.rec.date, b.rec.date) > LOOKALIKE_DAYS || a.rec.date === b.rec.date && a.rec.key === b.rec.key) continue;
      const explained = a.inv && b.inv && a.inv.key !== b.inv.key;      // two different known invoices explain two equal payments
      if (explained) continue;
      findings.push({ ...base(c), id: `like:${k}:${a.rec.key}`, rule: 'duplicate_payment', cp: a.cp, label: a.label, status: 'candidate', period, records: [er(a.rec, 'payment'), er(b.rec, 'payment')], exposure: { amount: a.amount, kind: 'investigate' },
        calculation: d('trust.calc.lookalike', { amount: { money: a.amount }, days: daysBetween(a.rec.date, b.rec.date) }), assumptions: [d('trust.asm.no_recurring')], limitations: [LIM_BASIS, d('trust.lim.possible_only'), d('trust.lim.not_audit')], missing: [d('trust.miss.invoice_reference'), d('trust.miss.bank_confirmation')], rationale: d('trust.why.lookalike') });
    }
  }

  // ── unmatched payments / receipts (a payment already named in a duplicate / excess finding is not reported twice) ──
  const claimed = new Set(findings.flatMap((f) => (f.rule === 'duplicate_payment' || f.rule === 'overpayment' ? f.records.filter((r) => r.role === 'payment' || r.role === 'refund').map((r) => r.key) : [])));
  const unref = new Map<string, PayInfo[]>();
  for (const p of livePays) {
    if (p.amount <= 0 || p.status === 'matched' || claimed.has(p.rec.key)) continue;
    if (p.status === 'unreferenced') { (unref.get(p.cp) ?? unref.set(p.cp, []).get(p.cp)!).push(p); continue; }   // grouped below: one line per counterparty, not one per payment
    const conflict = p.status === 'counterparty_conflict';
    findings.push({ ...base(c), id: `pay:${p.rec.key}`, rule: conflict ? 'counterparty_conflict' : 'unmatched_payment', cp: p.cp, label: p.label, status: 'candidate', period, records: [er(p.rec, 'payment')], exposure: { amount: p.amount, kind: 'investigate' },
      calculation: d(conflict ? 'trust.calc.pay_conflict' : 'trust.calc.pay_not_found', { amount: { money: p.amount }, ref: p.rec.reference ?? '—' }),
      assumptions: [], limitations: [LIM_BASIS, d('trust.lim.not_audit')], missing: [d(conflict ? 'trust.miss.consistent_ids' : 'trust.miss.invoice_register')], rationale: d('trust.why.unmatched') });
  }
  for (const [cp, ps] of unref) {
    const total = sum(ps.map((p) => p.amount));
    findings.push({ ...base(c), id: `unref:${cp}`, rule: 'unmatched_payment', cp, label: ps[0]!.label, status: 'candidate', period, records: ps.slice(0, 25).map((p) => er(p.rec, 'payment')), exposure: { amount: total, kind: 'investigate' },
      calculation: d('trust.calc.pay_unref', { amount: { money: total }, n: ps.length }), assumptions: [], limitations: [LIM_BASIS, d('trust.lim.not_audit')], missing: [d('trust.miss.invoice_reference')], rationale: d('trust.why.unmatched') });
  }

  // ── invoices whose settlement cannot be judged ──
  if (latest) {
    const inSnap = new Set(latest.records.map((r) => `${cpKey(r)}|${norm(r.invoiceNo)}`));
    const paidKeys = new Set(livePays.filter((p) => p.inv).map((p) => p.inv!.key));
    const unclear = [...u.map.values()].filter((i) => i.source === 'invoice' && !i.conflicting && !inSnap.has(i.key) && !paidKeys.has(i.key) && (i.due ?? i.date ?? '9999') < latest.date && (i.date ?? '0') <= latest.date);
    if (unclear.length) {
      const recsU = unclear.slice(0, 20).flatMap((i) => invRec(i));
      findings.push({ ...base(c), id: 'unclear', rule: 'unclear_settlement', cp: '', label: '—', status: 'withheld', period, records: recsU, exposure: null, calculation: d('trust.calc.none'), assumptions: [], limitations: [LIM_BASIS],
        missing: [d('trust.miss.payment_register')], rationale: d('trust.why.withheld'), withheldReason: d('trust.withheld.unclear_settlement', { n: unclear.length, asof: { date: latest.date } }) });
    }
  }
  return { currency, side, findings: sortFindings(findings), reconciled, potential: potentialValue(findings, currency) };
}

const RANK = { verified: 0, candidate: 1, estimate: 2, withheld: 3 } as const;
function sortFindings(fs: TrustFinding[]): TrustFinding[] {
  return [...fs].sort((a, b) => RANK[a.status] - RANK[b.status] || (b.exposure?.amount ?? 0) - (a.exposure?.amount ?? 0) || a.id.localeCompare(b.id));
}

/**
 * The only money total the product ever shows as "potential": verified open credit balances and candidate possible-excess amounts, per currency,
 * with overlapping findings (they share a record or an invoice) counted ONCE at their largest exposure. Investigate-only, estimates and withheld
 * findings are excluded and listed. It is exposure to verify – never recovered or saved money.
 */
export function potentialValue(findings: TrustFinding[], currency: string): PotentialValue {
  const excluded: PotentialValue['excluded'] = [];
  const el = findings.filter((f) => {
    if (f.status === 'withheld') { excluded.push({ id: f.id, reason: 'withheld' }); return false; }
    if (!f.exposure || f.exposure.kind === 'investigate' || f.exposure.amount <= 0 || f.status === 'estimate') { excluded.push({ id: f.id, reason: 'investigate_only' }); return false; }
    return true;
  });
  // union-find over shared records
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const f of el) for (const r of f.records) if (r.role !== 'invoice') union(`f:${f.id}`, `r:${r.key}`);
  const groups = new Map<string, TrustFinding[]>();
  for (const f of el) (groups.get(find(`f:${f.id}`)) ?? groups.set(find(`f:${f.id}`), []).get(find(`f:${f.id}`))!).push(f);
  const parts: PotentialValue['parts'] = [];
  for (const g of groups.values()) {
    const best = [...g].sort((a, b) => b.exposure!.amount - a.exposure!.amount || a.id.localeCompare(b.id))[0]!;
    parts.push({ id: best.id, label: best.label, rule: best.rule, status: best.status, amount: best.exposure!.amount, overlaps: g.filter((x) => x !== best).map((x) => x.id) });
    g.filter((x) => x !== best).forEach((x) => excluded.push({ id: x.id, reason: 'overlap' }));
  }
  parts.sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  return { currency, total: Math.round(sum(parts.map((p) => p.amount)) * 100) / 100, parts, excluded };
}

export type { ExposureKind };
