import iconv from 'iconv-lite';
import type { FinanceField } from '@/engine/types';
import { END, makeFinance, snapLines, type FinTruth, type FSide } from './finance';

const csv = (rows: string[][], delim: string) => rows.map((r) => r.map((c) => (/["\n\r]/.test(c) || c.includes(delim) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(delim)).join('\r\n') + '\r\n';
const num = (v: number | undefined, dec: ',' | '.') => (v === undefined ? '' : v.toFixed(2).replace('.', dec));

export interface FFixture {
  id: string;
  label: string;
  fileName: string;
  bytes: Uint8Array;
  kind: 'open_items' | 'aging' | 'balance' | 'invoices' | 'payments' | 'credit_notes';
  side: FSide;
  expectFields: FinanceField[];
  currency: string;
  /** the file has no date column for the ledger date: the as-of date the user types */
  asOfDate?: string;
  truth: FinTruth;
  /** number of records the importer should produce */
  rows: number;
}

export async function buildFinanceFixtures(): Promise<FFixture[]> {
  const ar = makeFinance('receivable', 'lt');
  const ap = makeFinance('payable', 'en');
  const apPl = makeFinance('payable', 'pl');
  const out: FFixture[] = [];
  const enc = (rows: string[][], d: string, bom = true) => new TextEncoder().encode((bom ? '﻿' : '') + csv(rows, d));

  // 1. LT CSV: open items at FOUR dates (a history of ledger snapshots)
  out.push({
    id: 'ar-open-items-history', label: 'LT CSV – receivable open items, 4 dates', fileName: 'gautinos_atviros.csv', kind: 'open_items', side: 'receivable', currency: 'EUR', truth: ar, rows: ar.open.length,
    bytes: enc([['Ataskaitos data', 'Kliento kodas', 'Klientas', 'Sąskaitos Nr.', 'Sąskaitos data', 'Apmokėjimo terminas', 'Sąskaitos suma', 'Sumokėta suma', 'Neapmokėta suma', 'Valiuta'],
      ...ar.open.map((o) => [o.snapshot, o.cp, o.name, o.no, o.invDate, o.due, num(o.amount, ','), num(o.paid, ','), num(o.outstanding, ','), 'EUR'])], ';'),
    expectFields: ['snapshot_date', 'counterparty_id', 'counterparty_name', 'document_id', 'document_date', 'due_date', 'original_amount', 'paid_amount', 'outstanding_amount', 'currency'],
  });

  // 2. LT CSV: ONE open-item report WITHOUT a date column (the user types the as-of date)
  const last = snapLines(ar, END);
  out.push({
    id: 'ar-open-items-nodate', label: 'LT CSV – open items without a report date', fileName: 'skolininku_skolos.csv', kind: 'open_items', side: 'receivable', currency: 'EUR', asOfDate: END, truth: ar, rows: last.length,
    bytes: enc([['Kliento kodas', 'Klientas', 'Sąskaitos Nr.', 'Sąskaitos data', 'Apmokėjimo terminas', 'Neapmokėta suma'], ...last.map((o) => [o.cp, o.name, o.no, o.invDate, o.due, num(o.outstanding, ',')])], ';'),
    expectFields: ['counterparty_id', 'counterparty_name', 'document_id', 'document_date', 'due_date', 'outstanding_amount'],
  });

  // 3. LT CSV: invoice register (credit notes are rows of type "Kreditinė sąskaita")
  const invRows = [...ar.invoices.map((i) => [i.date, i.no, i.cp, i.name, num(i.amount, ','), i.due, 'Sąskaita faktūra']), ...ar.credits.map((c) => [c.date, c.no, c.cp, c.name, num(c.amount, ','), '', 'Kreditinė sąskaita'])];
  invRows.sort((a, b) => a[0]!.localeCompare(b[0]!));
  out.push({
    id: 'ar-invoices', label: 'LT CSV – invoice register', fileName: 'israsytos_saskaitos.csv', kind: 'invoices', side: 'receivable', currency: 'EUR', truth: ar, rows: invRows.length,
    bytes: enc([['Data', 'Sąskaitos Nr.', 'Kliento kodas', 'Klientas', 'Sąskaitos suma', 'Apmokėjimo terminas', 'Dokumento tipas'], ...invRows], ';'),
    expectFields: ['document_date', 'document_id', 'counterparty_id', 'counterparty_name', 'original_amount', 'due_date', 'document_type'],
  });

  // 4. LT CSV: credit-note register WITH the credited invoice
  out.push({
    id: 'ar-credit-notes', label: 'LT CSV – credit-note register', fileName: 'kreditines.csv', kind: 'credit_notes', side: 'receivable', currency: 'EUR', truth: ar, rows: ar.credits.length,
    bytes: enc([['Data', 'Kreditinės Nr.', 'Kliento kodas', 'Klientas', 'Suma', 'Pagrindinė sąskaita'], ...ar.credits.map((c) => [c.date, c.no, c.cp, c.name, num(c.amount, ','), c.ref ?? ''])], ';'),
    expectFields: ['document_date', 'document_id', 'counterparty_id', 'counterparty_name', 'original_amount', 'credit_reference'],
  });

  // 5. LT CSV: payment register (the identical repeated line is in it)
  out.push({
    id: 'ar-payments', label: 'LT CSV – payment register', fileName: 'gauti_mokejimai.csv', kind: 'payments', side: 'receivable', currency: 'EUR', truth: ar, rows: ar.payments.length,
    bytes: enc([['Mokėjimo data', 'Mokėjimo nr.', 'Kliento kodas', 'Klientas', 'Apmokėta sąskaita', 'Sumokėta suma'], ...ar.payments.map((p) => [p.date, p.ref, p.cp, p.name, p.invoice ?? '', num(p.amount, ',')])], ';'),
    expectFields: ['payment_date', 'payment_reference', 'counterparty_id', 'counterparty_name', 'invoice_reference', 'paid_amount'],
  });

  // 6–8. EN CSV (payables): open items at 3 dates, invoice register, payment register
  out.push({
    id: 'ap-open-items', label: 'EN CSV – payable open items', fileName: 'ap_open_items.csv', kind: 'open_items', side: 'payable', currency: 'EUR', truth: ap, rows: ap.open.length,
    bytes: enc([['As of date', 'Supplier code', 'Supplier', 'Invoice no', 'Invoice date', 'Due date', 'Invoice amount', 'Paid amount', 'Outstanding amount', 'Currency'],
      ...ap.open.map((o) => [o.snapshot, o.cp, o.name, o.no, o.invDate, o.due, num(o.amount, '.'), num(o.paid, '.'), num(o.outstanding, '.'), 'EUR'])], ',', false),
    expectFields: ['snapshot_date', 'counterparty_id', 'counterparty_name', 'document_id', 'document_date', 'due_date', 'original_amount', 'paid_amount', 'outstanding_amount', 'currency'],
  });
  out.push({
    id: 'ap-invoices', label: 'EN CSV – supplier invoice register', fileName: 'ap_invoices.csv', kind: 'invoices', side: 'payable', currency: 'EUR', truth: ap, rows: ap.invoices.length + ap.credits.length,
    bytes: enc([['Invoice date', 'Invoice no', 'Supplier code', 'Supplier', 'Amount', 'Due date', 'Document type'], ...ap.invoices.map((i) => [i.date, i.no, i.cp, i.name, num(i.amount, '.'), i.due, 'Invoice']), ...ap.credits.map((c) => [c.date, c.no, c.cp, c.name, num(c.amount, '.'), '', 'Credit note'])], ',', false),
    expectFields: ['document_date', 'document_id', 'counterparty_id', 'counterparty_name', 'original_amount', 'due_date', 'document_type'],
  });
  out.push({
    id: 'ap-payments', label: 'EN CSV – supplier payment register', fileName: 'ap_payments.csv', kind: 'payments', side: 'payable', currency: 'EUR', truth: ap, rows: ap.payments.length,
    bytes: enc([['Payment date', 'Payment reference', 'Supplier code', 'Supplier', 'Invoice reference', 'Paid amount'], ...ap.payments.map((p) => [p.date, p.ref, p.cp, p.name, p.invoice ?? '', num(p.amount, '.')])], ',', false),
    expectFields: ['payment_date', 'payment_reference', 'counterparty_id', 'counterparty_name', 'invoice_reference', 'paid_amount'],
  });

  // 9. PL CSV Windows-1250: payables AGING summary (PLN), one line per supplier
  const bySup = new Map<string, { name: string; nd: number; d30: number; d60: number; d90: number; d90p: number }>();
  for (const o of snapLines(apPl, END)) {
    if (o.outstanding <= 0) continue;
    const e = bySup.get(o.cp) ?? { name: o.name, nd: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
    const d = Math.round((Date.parse(END) - Date.parse(o.due)) / 86400000);
    const k = d <= 0 ? 'nd' : d <= 30 ? 'd30' : d <= 60 ? 'd60' : d <= 90 ? 'd90' : 'd90p';
    e[k] += o.outstanding;
    bySup.set(o.cp, e);
  }
  const agingRows = [...bySup.entries()].map(([cp, e]) => [e.name, cp, num(e.nd, ','), num(e.d30, ','), num(e.d60, ','), num(e.d90, ','), num(e.d90p, ','), num(e.nd + e.d30 + e.d60 + e.d90 + e.d90p, ','), END.split('-').reverse().join('.')]);
  out.push({
    id: 'pl-aging-ap', label: 'PL CSV 1250 – payables aging report', fileName: 'wiekowanie_zobowiazan.csv', kind: 'aging', side: 'payable', currency: 'PLN', truth: apPl, rows: agingRows.length,
    bytes: new Uint8Array(iconv.encode(csv([['Dostawca', 'Kod dostawcy', 'Nieprzeterminowane', '1-30', '31-60', '61-90', '>90', 'Razem', 'Stan na dzień'], ...agingRows], ';'), 'win1250')),
    expectFields: ['counterparty_name', 'counterparty_id', 'aging_current', 'aging_1_30', 'aging_31_60', 'aging_61_90', 'aging_90_plus', 'snapshot_date'],
  });
  return out;
}
