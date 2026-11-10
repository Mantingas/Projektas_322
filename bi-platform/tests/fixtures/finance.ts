/**
 * Synthetic receivables / payables with PLANTED situations (no real data). The truth is a plain ledger simulation: every open-item snapshot is exactly
 * "invoice − referenced payments − matched credit notes" at that date, so nothing in the expected values comes from the engine.
 *
 *  Receivables (EUR): C01 pays on the due date · C02 +5 days · C03 +20 days · C04 pays late and gets LATER (+10 → +25 days from invoices of 1 September, a behaviour change)
 *    C05 pays 50 % on time and the rest 30 days later (partial payments) · C06 stops paying after 07-31 (growing, long-overdue balance)
 *    C07 on time, plus two look-alike payments without an invoice reference · C08 pays 110 % of one invoice (overpayment)
 *    C09 one invoice paid TWICE (second payment 3 days later) · C10 one payment line appears twice in the payment REGISTER (identical repeat)
 *  Credit notes: KR-1 → matched to a C06 invoice · KR-2 → references an invoice that does not exist · KR-3 → no reference (an invoice of exactly the same amount exists = possible match)
 *  Payables: five suppliers; S03 stops being paid after 10-15; amounts falling due within 14 days of the last snapshot; one matched credit note.
 */
export type FSide = 'receivable' | 'payable';
export type FLocale = 'lt' | 'pl' | 'en';

export interface FInv { no: string; date: string; due: string; cp: string; name: string; amount: number }
export interface FPay { date: string; ref: string; cp: string; name: string; invoice?: string; amount: number }
export interface FCn { no: string; date: string; cp: string; name: string; amount: number; ref?: string }
export interface FOpen { snapshot: string; cp: string; name: string; no: string; invDate: string; due: string; amount: number; paid: number; outstanding: number }
export interface FinTruth { side: FSide; currency: string; invoices: FInv[]; payments: FPay[]; credits: FCn[]; open: FOpen[]; snapshotDates: string[]; /** payments that are real bookings (the register repeats one of them) */ booked: FPay[] }

export const START = '2025-06-02';
export const END = '2025-12-15';
export const AR_SNAPS = ['2025-09-30', '2025-10-31', '2025-11-30', END];
export const AP_SNAPS = ['2025-10-31', '2025-11-30', END];
export const CUR = { from: '2025-11-16', to: '2025-12-15' };
export const PREV = { from: '2025-10-17', to: '2025-11-15' };

const NAMES: Record<FLocale, Record<FSide, string[]>> = {
  lt: { receivable: ['UAB Alfa prekyba', 'UAB Beta grupė', 'AB Gama pienas', 'MB Delta paslaugos', 'UAB Epsilon', 'UAB Žalioji dirbtuvė', 'UAB Eta logistika', 'UAB Teta statyba', 'AB Jota maistas', 'UAB Kapa transportas'], payable: ['UAB Tiekėjas Vienas', 'AB Tiekėjas Du', 'UAB Tiekėjas Trys', 'MB Tiekėjas Keturi', 'UAB Tiekėjas Penki'] },
  pl: { receivable: ['Alfa Handel Sp. z o.o.', 'Beta Grupa S.A.', 'Gamma Mleczarnia', 'Delta Usługi', 'Epsilon Sp. j.', 'Zielona Pracownia', 'Eta Logistyka', 'Teta Budownictwo', 'Jota Żywność', 'Kappa Transport'], payable: ['Dostawca Jeden Sp. z o.o.', 'Dostawca Dwa S.A.', 'Dostawca Trzy', 'Dostawca Cztery', 'Dostawca Pięć'] },
  en: { receivable: ['Alfa Trading Ltd', 'Beta Group', 'Gamma Dairy', 'Delta Services', 'Epsilon LLC', 'Green Workshop', 'Eta Logistics', 'Theta Construction', 'Iota Foods', 'Kappa Transport'], payable: ['Supplier One Ltd', 'Supplier Two', 'Supplier Three', 'Supplier Four', 'Supplier Five'] },
};

const ms = (iso: string) => Date.parse(iso + 'T00:00:00Z');
export const add = (iso: string, n: number) => new Date(ms(iso) + n * 86400000).toISOString().slice(0, 10);
export const diff = (a: string, b: string) => Math.round((ms(b) - ms(a)) / 86400000);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function makeFinance(side: FSide, locale: FLocale = 'lt'): FinTruth {
  const names = NAMES[locale][side];
  const ar = side === 'receivable';
  const currency = locale === 'pl' ? 'PLN' : 'EUR';
  const n = names.length;
  const terms = ar ? [14, 30, 45, 30, 30, 30, 14, 30, 30, 45] : [30, 30, 14, 45, 30];
  const prefix = ar ? (locale === 'lt' ? 'SF' : locale === 'pl' ? 'FV' : 'INV') : 'TS';
  const step = ar ? 7 : 21;
  const last = END;
  const invoices: FInv[] = [];
  const idx = new Map<string, number>(); // cp → invoice sequence number
  for (let c = 0; c < n; c++) {
    const cp = `${ar ? 'C' : 'S'}${String(c + 1).padStart(2, '0')}`;
    let k = 0;
    for (let d = add(START, ar ? c : c * 3); d <= last; d = add(d, step), k++) {
      let amount = r2(((ar ? 400 : 1000) + (ar ? 150 : 400) * c) * (1 + (k % 3) * 0.1));
      if (ar && c === 2 && k === 3) amount = 300; // an invoice of exactly the amount of credit note KR-3 (a POSSIBLE match, never applied)
      invoices.push({ no: '', date: d, due: add(d, terms[c]!), cp, name: names[c]!, amount });
      idx.set(`${cp}|${d}`, k);
    }
  }
  invoices.sort((a, b) => a.date.localeCompare(b.date) || a.cp.localeCompare(b.cp));
  invoices.forEach((x, i) => (x.no = `${prefix}-${1000 + i}`));
  const seq = (x: FInv) => idx.get(`${x.cp}|${x.date}`)!;

  const booked: FPay[] = [];
  let pn = 5000;
  const pay = (x: FInv, date: string, amount: number, extra: Partial<FPay> = {}) => { if (date <= END) booked.push({ date, ref: `MK-${++pn}`, cp: x.cp, name: x.name, invoice: x.no, amount: r2(amount), ...extra }); };
  for (const x of invoices) {
    const c = Number(x.cp.slice(1)) - 1;
    const k = seq(x);
    if (ar) {
      switch (c) {
        case 0: pay(x, x.due, x.amount); break;
        case 1: pay(x, add(x.due, 5), x.amount); break;
        case 2: pay(x, add(x.due, 20), x.amount); break;
        case 3: pay(x, add(x.due, x.date < '2025-09-01' ? 10 : 25), x.amount); break;
        case 4: pay(x, x.due, x.amount * 0.5); pay(x, add(x.due, 30), x.amount * 0.5); break;
        case 5: if (x.date <= '2025-07-31') pay(x, add(x.due, 3), x.amount); break;
        case 6: pay(x, add(x.due, -1), x.amount); break;
        case 7: pay(x, x.due, k === 5 ? x.amount * 1.1 : x.amount); break;
        case 8: pay(x, x.due, x.amount); if (k === 6) pay(x, add(x.due, 3), x.amount); break;
        case 9: pay(x, x.due, x.amount); break;
      }
    } else {
      switch (c) {
        case 0: pay(x, x.due, x.amount); break;
        case 1: pay(x, add(x.due, 10), x.amount); break;
        case 2: if (x.date <= '2025-10-15') pay(x, x.due, x.amount); break;
        case 3: pay(x, add(x.due, -2), x.amount); break;
        case 4: pay(x, x.due, x.amount); break;
      }
    }
  }
  // the credit notes
  const credits: FCn[] = [];
  if (ar) {
    const c6 = invoices.filter((x) => x.cp === 'C06' && x.date > '2025-07-31');
    const target = c6[1]!;
    credits.push({ no: 'KR-1', date: '2025-11-05', cp: 'C06', name: names[5]!, amount: 200, ref: target.no }); // matched
    credits.push({ no: 'KR-2', date: '2025-11-12', cp: 'C02', name: names[1]!, amount: 150, ref: `${prefix}-9999` }); // reference not found
    credits.push({ no: 'KR-3', date: '2025-11-18', cp: 'C03', name: names[2]!, amount: 300 }); // no reference
  } else {
    const s2 = invoices.filter((x) => x.cp === 'S02')[2]!;
    credits.push({ no: 'KR-P1', date: '2025-11-20', cp: 'S02', name: names[1]!, amount: 250, ref: s2.no });
  }
  // payments that are NOT tied to any invoice (and must therefore never reduce an outstanding balance)
  const loose: FPay[] = ar
    ? [{ date: '2025-11-20', ref: 'MK-X1', cp: 'C07', name: names[6]!, amount: 1234.56 }, { date: '2025-11-23', ref: 'MK-X2', cp: 'C07', name: names[6]!, amount: 1234.56 }]
    : [{ date: '2025-11-10', ref: 'MK-P1', cp: 'S04', name: names[3]!, amount: 777.77 }, { date: '2025-11-15', ref: 'MK-P2', cp: 'S04', name: names[3]!, amount: 777.77 }];
  // the REGISTER repeats one payment line (C10 / S05): identical reference, date, amount
  const dupSrc = booked.find((p) => p.cp === (ar ? 'C10' : 'S05') && p.date >= '2025-09-01')!;
  const payments = [...booked, ...loose, { ...dupSrc }].sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));

  // open-item snapshots: invoice − referenced payments − matched credit notes − (nothing else)
  const snapshotDates = ar ? AR_SNAPS : AP_SNAPS;
  const open: FOpen[] = [];
  for (const S of snapshotDates) {
    for (const x of invoices) {
      if (x.date > S) continue;
      const paid = booked.filter((p) => p.invoice === x.no && p.date <= S).reduce((s, p) => s + p.amount, 0);
      const cn = credits.filter((c) => c.ref === x.no && c.date <= S).reduce((s, c) => s + c.amount, 0);
      const out = r2(x.amount - paid - cn);
      if (Math.abs(out) > 0.005) open.push({ snapshot: S, cp: x.cp, name: x.name, no: x.no, invDate: x.date, due: x.due, amount: x.amount, paid: r2(paid), outstanding: out });
    }
    for (const c of credits) if (c.date <= S && !invoices.some((x) => x.no === c.ref)) open.push({ snapshot: S, cp: c.cp, name: c.name, no: c.no, invDate: c.date, due: c.date, amount: -c.amount, paid: 0, outstanding: -c.amount }); // unapplied credit
  }
  return { side, currency, invoices, payments, credits, open, snapshotDates, booked };
}

// ───────────── independent reference calculations (plain loops, no engine code) ─────────────
export const snapLines = (t: FinTruth, date: string) => t.open.filter((o) => o.snapshot === date);
export const refOutstanding = (t: FinTruth, date: string) => r2(snapLines(t, date).reduce((s, o) => s + o.outstanding, 0));
/** overdue = positive balances whose due date is BEFORE the snapshot date */
export const refOverdue = (t: FinTruth, date: string) => r2(snapLines(t, date).filter((o) => o.outstanding > 0 && o.due < date).reduce((s, o) => s + o.outstanding, 0));
export const refOverdueCount = (t: FinTruth, date: string) => snapLines(t, date).filter((o) => o.outstanding > 0 && o.due < date).length;
export const refBucket = (t: FinTruth, date: string, lo: number, hi: number) => r2(snapLines(t, date).filter((o) => o.outstanding > 0 && diff(o.due, date) >= lo && diff(o.due, date) <= hi).reduce((s, o) => s + o.outstanding, 0));
export const refCredits = (t: FinTruth, date: string) => r2(snapLines(t, date).filter((o) => o.outstanding < 0).reduce((s, o) => s + o.outstanding, 0));
export const refDueSoon = (t: FinTruth, date: string, days = 14) => r2(snapLines(t, date).filter((o) => o.outstanding > 0 && diff(date, o.due) >= 0 && diff(date, o.due) <= days).reduce((s, o) => s + o.outstanding, 0));
export const inRange = (d: string, w: { from: string; to: string }) => d >= w.from && d <= w.to;
