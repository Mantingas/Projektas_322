import type { AgingBuckets, FinanceKind, FinanceRecord } from '../types';
import { addDays, daysBetween } from '../analytics/dates';
import type { Range } from '../analytics/periods';
import { cpKey, cpLabel, norm } from './keys';

/** Rules stated to the user. */
export const DUE_SOON_DAYS = 14;
export const LONG_OVERDUE_DAYS = 90;
export const DUP_WINDOW_DAYS = 7;
export const MATCH_MIN = 5;
export const DUE_KNOWN_MIN = 0.8;
const EPS = 0.01;

// ───────────────────────── positions (snapshots) ─────────────────────────
export interface FinSnapshot { kind: 'open_item' | 'aging' | 'balance'; date: string; records: FinanceRecord[] }
const PRIORITY = { open_item: 3, aging: 2, balance: 1 } as const;

export function listSnapshots(recs: FinanceRecord[]): FinSnapshot[] {
  const m = new Map<string, FinSnapshot>();
  for (const r of recs) {
    if (r.kind !== 'open_item' && r.kind !== 'aging' && r.kind !== 'balance') continue;
    const k = `${r.kind}|${r.date}`;
    let s = m.get(k);
    if (!s) m.set(k, (s = { kind: r.kind, date: r.date, records: [] }));
    s.records.push(r);
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || PRIORITY[a.kind] - PRIORITY[b.kind]);
}

/** The newest snapshot on or before D; at equal dates the one with the most detail (open items > aging > balance). Snapshots are NEVER added together. */
export function pickSnapshot(snaps: FinSnapshot[], d: string): FinSnapshot | null {
  let best: FinSnapshot | null = null;
  for (const s of snaps) {
    if (s.date > d) continue;
    if (!best || s.date > best.date || (s.date === best.date && PRIORITY[s.kind] > PRIORITY[best.kind])) best = s;
  }
  return best;
}

export interface Bucketed extends AgingBuckets { noDue: number; credits: number }
export interface CpPos { label: string; outstanding: number; overdue: number | null; over90: number | null; lines: number }
export interface FinPos {
  source: FinanceKind;
  /** the snapshot's own date: ageing is computed as of THIS date */
  asOf: string;
  at: string;
  lag: number;
  total: number;
  lines: number;
  buckets: Bucketed | null;
  overdue: number | null;
  overdueCount: number | null;
  over90: number | null;
  over90Count: number | null;
  dueSoon: number | null;
  dueSoonCount: number | null;
  /** share of positive outstanding that has a due date (open items) */
  dueKnown: number | null;
  noDueLines: number;
  byCp: Map<string, CpPos>;
  recs: FinanceRecord[];
  multiSource: boolean;
}

/** Days past due as of `asOf` (positive = overdue). A line due ON the as-of date is not overdue. */
export const daysPastDue = (due: string, asOf: string) => daysBetween(due, asOf);
export type BucketId = 'nd' | 'd30' | 'd60' | 'd90' | 'd90p';
export const bucketOf = (days: number): BucketId => (days <= 0 ? 'nd' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'd90p');

export function positionOf(snap: FinSnapshot, at: string): FinPos {
  const recs = snap.records;
  const pos: FinPos = {
    source: snap.kind, asOf: snap.date, at, lag: daysBetween(snap.date, at), total: 0, lines: recs.length, buckets: null, overdue: null, overdueCount: null, over90: null, over90Count: null, dueSoon: null, dueSoonCount: null,
    dueKnown: null, noDueLines: 0, byCp: new Map(), recs, multiSource: new Set(recs.map((r) => r.importId ?? '')).size > 1,
  };
  const cp = (r: FinanceRecord) => {
    const k = cpKey(r);
    let e = pos.byCp.get(k);
    if (!e) pos.byCp.set(k, (e = { label: cpLabel(r) || '—', outstanding: 0, overdue: snap.kind === 'balance' ? null : 0, over90: snap.kind === 'balance' ? null : 0, lines: 0 }));
    return e;
  };
  if (snap.kind === 'balance') {
    for (const r of recs) { const o = r.outstanding ?? 0; pos.total += o; const e = cp(r); e.outstanding += o; e.lines++; }
    return pos;
  }
  const b: Bucketed = { nd: 0, d30: 0, d60: 0, d90: 0, d90p: 0, noDue: 0, credits: 0 };
  if (snap.kind === 'aging') {
    for (const r of recs) {
      const k = r.buckets ?? { nd: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
      b.nd += k.nd; b.d30 += k.d30; b.d60 += k.d60; b.d90 += k.d90; b.d90p += k.d90p;
      const o = r.outstanding ?? k.nd + k.d30 + k.d60 + k.d90 + k.d90p;
      pos.total += o;
      const e = cp(r);
      e.outstanding += o; e.overdue = (e.overdue ?? 0) + k.d30 + k.d60 + k.d90 + k.d90p; e.over90 = (e.over90 ?? 0) + k.d90p; e.lines++;
    }
    pos.buckets = b;
    pos.overdue = b.d30 + b.d60 + b.d90 + b.d90p;
    pos.over90 = b.d90p;
    return pos;
  }
  // open items: line level, ageing computed from due dates as of the snapshot date
  let overdueCount = 0, over90Count = 0, dueSoon = 0, dueSoonCount = 0, positive = 0, positiveDue = 0;
  for (const r of recs) {
    const o = r.outstanding ?? 0;
    pos.total += o;
    const e = cp(r);
    e.outstanding += o; e.lines++;
    if (o <= 0) { b.credits += o; continue; }
    positive += o;
    if (!r.dueDate) { b.noDue += o; pos.noDueLines++; continue; }
    positiveDue += o;
    const d = daysPastDue(r.dueDate, snap.date);
    const id = bucketOf(d);
    b[id] += o;
    if (d >= 1) { overdueCount++; e.overdue = (e.overdue ?? 0) + o; if (d > LONG_OVERDUE_DAYS) { over90Count++; e.over90 = (e.over90 ?? 0) + o; } }
    else if (d >= -DUE_SOON_DAYS) { dueSoon += o; dueSoonCount++; }
  }
  pos.buckets = b;
  pos.overdue = b.d30 + b.d60 + b.d90 + b.d90p;
  pos.overdueCount = overdueCount;
  pos.over90 = b.d90p;
  pos.over90Count = over90Count;
  pos.dueSoon = dueSoon;
  pos.dueSoonCount = dueSoonCount;
  pos.dueKnown = positive > 0 ? positiveDue / positive : 1;
  return pos;
}

/** Which snapshots a position is made of – a previous position that is the SAME snapshot as the current one is not a previous position. */
export const posSig = (p: FinPos | null) => (p ? `${p.source}|${p.asOf}` : '');

// ───────────────────────── invoices, payments, credit notes ─────────────────────────
export interface InvoiceInfo {
  key: string;
  cp: string;
  label: string;
  no: string;
  date?: string;
  due?: string;
  amount?: number;
  source: 'invoice' | 'open_item';
  /** the same invoice number appears with different amounts / dates inside the register: it is not used for matching or totals */
  conflicting: boolean;
}
export interface Universe { map: Map<string, InvoiceInfo>; byNo: Map<string, InvoiceInfo[]>; identicalDuplicates: number; conflicts: number }

/** Every invoice we know a number for: the invoice register first, open-item lines for the rest. Identical repeats count once; conflicting repeats are excluded. */
export function buildUniverse(recs: FinanceRecord[]): Universe {
  const map = new Map<string, InvoiceInfo>();
  const byNo = new Map<string, InvoiceInfo[]>();
  let identicalDuplicates = 0;
  let conflicts = 0;
  const add = (i: InvoiceInfo) => { map.set(i.key, i); (byNo.get(norm(i.no)) ?? byNo.set(norm(i.no), []).get(norm(i.no))!).push(i); };
  const reg = new Map<string, FinanceRecord[]>();
  for (const r of recs) if (r.kind === 'invoice' && r.documentId) { const k = `${cpKey(r)}|${norm(r.documentId)}`; (reg.get(k) ?? reg.set(k, []).get(k)!).push(r); }
  for (const [k, rs] of reg) {
    const first = rs[0]!;
    const same = rs.every((x) => x.amount === first.amount && x.date === first.date && x.dueDate === first.dueDate);
    if (rs.length > 1) { if (same) identicalDuplicates += rs.length - 1; else conflicts++; }
    add({ key: k, cp: cpKey(first), label: cpLabel(first), no: first.documentId!, date: first.date, due: first.dueDate, amount: first.amount, source: 'invoice', conflicting: !same });
  }
  for (const r of recs) {
    if (r.kind !== 'open_item' || !r.invoiceNo) continue;
    const k = `${cpKey(r)}|${norm(r.invoiceNo)}`;
    const have = map.get(k);
    if (have) {
      if (!have.due && r.dueDate) have.due = r.dueDate;
      if (have.amount === undefined && r.amount !== undefined) have.amount = r.amount;
      // the register and the open-item report disagree about what the invoice was worth: neither is trusted for matching or totals
      else if (have.source === 'invoice' && r.amount !== undefined && have.amount !== undefined && Math.abs(r.amount - have.amount) > EPS) { have.conflicting = true; conflicts++; }
      continue;
    }
    add({ key: k, cp: cpKey(r), label: cpLabel(r), no: r.invoiceNo, date: r.invoiceDate, due: r.dueDate, amount: r.amount, source: 'open_item', conflicting: false });
  }
  return { map, byNo, identicalDuplicates, conflicts };
}

export type PayStatus = 'matched' | 'unreferenced' | 'not_found' | 'counterparty_conflict';
export interface PayInfo {
  rec: FinanceRecord;
  cp: string;
  label: string;
  amount: number;
  status: PayStatus;
  inv?: InvoiceInfo;
  /** days after the due date (negative = early); only for matched payments whose invoice has a due date */
  delay?: number;
}

/** A payment is linked to an invoice ONLY by an exact reference under the same counterparty. Everything else stays unmatched. */
export function matchPayments(recs: FinanceRecord[], u: Universe): PayInfo[] {
  const out: PayInfo[] = [];
  for (const r of recs) {
    if (r.kind !== 'payment') continue;
    const cp = cpKey(r);
    const info: PayInfo = { rec: r, cp, label: cpLabel(r) || '—', amount: r.amount ?? 0, status: 'unreferenced' };
    if (r.reference) {
      const inv = cp ? u.map.get(`${cp}|${norm(r.reference)}`) : undefined;
      if (inv && !inv.conflicting) { info.status = 'matched'; info.inv = inv; if (inv.due && info.amount > 0) info.delay = daysBetween(inv.due, r.date); }
      else if (inv) info.status = 'not_found';
      else info.status = (u.byNo.get(norm(r.reference)) ?? []).some((x) => x.cp !== cp) ? 'counterparty_conflict' : 'not_found';
    }
    out.push(info);
  }
  return out;
}

export interface Delay { n: number; avg: number | null; paid: number }
export function delayIn(pays: PayInfo[], w: Range): Delay {
  let n = 0, paid = 0, wsum = 0;
  for (const p of pays) {
    if (p.delay === undefined || p.rec.date < w.from || p.rec.date > w.to) continue;
    n++; paid += p.amount; wsum += p.delay * p.amount;
  }
  return { n, paid, avg: n > 0 && paid > 0 ? wsum / paid : null };
}

export interface BehaviourRow { key: string; label: string; cur: Delay; prev: Delay; change: number | null }
export function behaviour(pays: PayInfo[], cur: Range, prev: Range): BehaviourRow[] {
  const by = new Map<string, { label: string; ps: PayInfo[] }>();
  for (const p of pays) if (p.delay !== undefined && p.cp) (by.get(p.cp) ?? by.set(p.cp, { label: p.label, ps: [] }).get(p.cp)!).ps.push(p);
  const rows: BehaviourRow[] = [];
  for (const [key, e] of by) {
    const c = delayIn(e.ps, cur);
    const p = delayIn(e.ps, prev);
    if (c.n === 0 && p.n === 0) continue;
    rows.push({ key, label: e.label, cur: c, prev: p, change: c.avg !== null && p.avg !== null && c.n >= 3 && p.n >= 3 ? c.avg - p.avg : null });
  }
  return rows.sort((a, b) => b.cur.paid - a.cur.paid || a.label.localeCompare(b.label));
}

// ───────────────────────── credit notes ─────────────────────────
export type CreditStatus = 'matched' | 'reference_not_found' | 'no_reference';
export interface CreditRow { rec: FinanceRecord; cp: string; label: string; amount: number; status: CreditStatus; inv?: InvoiceInfo; possible: InvoiceInfo[] }

export function creditReview(recs: FinanceRecord[], u: Universe, upTo: string): CreditRow[] {
  const rows: CreditRow[] = [];
  for (const r of recs) {
    if (r.kind !== 'credit_note' || r.date > upTo) continue;
    const cp = cpKey(r);
    const amount = r.amount ?? 0;
    let status: CreditStatus = 'no_reference';
    let inv: InvoiceInfo | undefined;
    if (r.reference) { inv = cp ? u.map.get(`${cp}|${norm(r.reference)}`) : undefined; status = inv && !inv.conflicting ? 'matched' : 'reference_not_found'; if (status !== 'matched') inv = undefined; }
    // possible matches: same counterparty and the very same amount – shown for the user to confirm, never applied
    const possible = status === 'matched' ? [] : [...u.map.values()].filter((i) => i.cp === cp && cp && !i.conflicting && i.amount !== undefined && Math.abs(i.amount - amount) <= EPS && (i.date ?? '0') <= r.date).slice(0, 3);
    rows.push({ rec: r, cp, label: cpLabel(r) || '—', amount, status, inv, possible });
  }
  return rows.sort((a, b) => b.rec.date.localeCompare(a.rec.date) || b.amount - a.amount);
}

// ───────────────────────── possible duplicate payments ─────────────────────────
export type DupTier = 'exact_repeat' | 'same_invoice' | 'overpaid' | 'lookalike';
export interface DupGroup { id: string; tier: DupTier; cp: string; label: string; payments: PayInfo[]; /** what MAY have been paid twice / in excess – a possibility, never a confirmed overpayment */ excess: number; inv?: InvoiceInfo; latest: string }

/**
 * Risk indicators over the payment register. NOTHING here is a confirmed overpayment: a repeated line may be a repeated export row, two similar payments
 * may both be right, and an "excess" over an invoice may be an advance payment or a credit note that is not loaded.
 */
export function duplicatePayments(pays: PayInfo[], credits: CreditRow[]): DupGroup[] {
  const groups: DupGroup[] = [];
  const usedInGroup = new Set<string>();
  const live = pays.filter((p) => p.amount > 0);
  // 1 — identical lines (same payment reference, date, counterparty and amount)
  const ex = new Map<string, PayInfo[]>();
  for (const p of live) if (p.rec.documentId) { const k = [p.cp, norm(p.rec.documentId), p.rec.date, p.amount.toFixed(2), p.rec.currency].join('|'); (ex.get(k) ?? ex.set(k, []).get(k)!).push(p); }
  for (const [k, ps] of ex) if (ps.length > 1) { groups.push({ id: `x:${k}`, tier: 'exact_repeat', cp: ps[0]!.cp, label: ps[0]!.label, payments: ps, excess: ps[0]!.amount * (ps.length - 1), inv: ps[0]!.inv, latest: ps[0]!.rec.date }); ps.forEach((p) => usedInGroup.add(p.rec.key)); }
  // 2 + 3 — more paid against one invoice than it was worth (after the credit notes that reference it)
  const creditBy = new Map<string, number>();
  for (const c of credits) if (c.status === 'matched' && c.inv) creditBy.set(c.inv.key, (creditBy.get(c.inv.key) ?? 0) + c.amount);
  const byInv = new Map<string, PayInfo[]>();
  for (const p of live) if (p.inv) (byInv.get(p.inv.key) ?? byInv.set(p.inv.key, []).get(p.inv.key)!).push(p);
  for (const [k, ps] of byInv) {
    const inv = ps[0]!.inv!;
    if (inv.amount === undefined) continue;
    const worth = inv.amount - (creditBy.get(k) ?? 0);
    const sum = ps.reduce((s, p) => s + p.amount, 0);
    const distinct = ps.filter((p) => !usedInGroup.has(p.rec.key));
    if (sum <= worth + EPS || (distinct.length === 0 && ps.length > 0 && ps.every((p) => usedInGroup.has(p.rec.key)))) continue;
    groups.push({ id: `i:${k}`, tier: ps.length > 1 ? 'same_invoice' : 'overpaid', cp: inv.cp, label: inv.label, payments: ps, excess: sum - worth, inv, latest: ps.reduce((m, p) => (p.rec.date > m ? p.rec.date : m), '') });
    ps.forEach((p) => usedInGroup.add(p.rec.key));
  }
  // 4 — look-alikes: same counterparty and amount a few days apart, not explained by two different invoices
  const la = new Map<string, PayInfo[]>();
  for (const p of live) if (p.cp && !usedInGroup.has(p.rec.key)) { const k = `${p.cp}|${p.amount.toFixed(2)}|${p.rec.currency}`; (la.get(k) ?? la.set(k, []).get(k)!).push(p); }
  for (const [k, ps] of la) {
    const s = [...ps].sort((a, b) => a.rec.date.localeCompare(b.rec.date));
    let chain: PayInfo[] = [];
    const flush = () => { if (chain.length > 1) groups.push({ id: `l:${k}:${chain[0]!.rec.date}`, tier: 'lookalike', cp: chain[0]!.cp, label: chain[0]!.label, payments: chain, excess: chain[0]!.amount * (chain.length - 1), latest: chain[chain.length - 1]!.rec.date }); chain = []; };
    for (const p of s) {
      const last = chain[chain.length - 1];
      const explained = last && last.inv && p.inv && last.inv.key !== p.inv.key; // two different, known invoices of the same amount
      if (last && (daysBetween(last.rec.date, p.rec.date) > DUP_WINDOW_DAYS || explained)) flush();
      chain.push(p);
    }
    flush();
  }
  return groups.sort((a, b) => b.excess - a.excess || b.latest.localeCompare(a.latest));
}

// ───────────────────────── coverage ─────────────────────────
export interface Cov { min: string; max: string; lines: number }
export function coverageOf(recs: FinanceRecord[], kinds: FinanceKind[]): Cov | null {
  let min = '', max = '', n = 0;
  for (const r of recs) { if (!kinds.includes(r.kind)) continue; n++; if (!min || r.date < min) min = r.date; if (!max || r.date > max) max = r.date; }
  return n ? { min, max, lines: n } : null;
}
/** The register starts and ends near the window (so an invoiced / paid total of that window is complete). */
export function covers(cov: Cov | null, w: Range): boolean {
  if (!cov) return false;
  const days = daysBetween(w.from, w.to) + 1;
  const tol = Math.max(3, Math.ceil(days * 0.1));
  return cov.min <= addDays(w.from, tol) && cov.max >= addDays(w.to, -tol);
}
