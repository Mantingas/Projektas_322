import { beforeAll, describe, expect, it } from 'vitest';
import { buildFinanceFixtures, type FFixture } from './fixtures/financeFormats';
import { runFinanceFixture } from './helpers';
import { detectModule, detectSide, isMappingConfirmable, validateMapping } from '@/engine/mapping/mapper';
import { financeKindFromFields, FINANCE_GRAIN } from '@/engine/finance/kind';
import { normalizeFinance } from '@/engine/validation/normalizeFinance';
import { END } from './fixtures/finance';

let fx: FFixture[] = [];
beforeAll(async () => { fx = await buildFinanceFixtures(); });
const get = (id: string) => fx.find((f) => f.id === id)!;

describe('financial dataset recognition: LT / PL / EN columns, dataset type and grain', () => {
  it('every format maps to the expected fields, is read as the expected dataset kind and gives every row', async () => {
    for (const f of fx) {
      const r = await runFinanceFixture(f);
      const got = new Set(r.analysis.proposal.entries.map((e) => e.field));
      for (const field of f.expectFields) expect(got.has(field), `${f.id}: ${field} (got ${[...got].join(',')})`).toBe(true);
      expect(r.kind, f.id).toBe(f.kind);
      expect(r.grain, f.id).toBe(FINANCE_GRAIN[f.kind]);
      expect(r.records, f.id).toHaveLength(f.rows);
      expect(r.side).toBe(f.side);
    }
  });

  it('the module is proposed from the headers where the words decide; the side from customer / supplier words', async () => {
    const m = async (id: string) => detectModule((await runFinanceFixture(get(id))).analysis.table.headers).module;
    for (const id of ['ar-open-items-history', 'ar-open-items-nodate', 'ar-credit-notes', 'ar-payments', 'ap-open-items', 'pl-aging-ap']) expect(await m(id), id).toBe('finance');
    expect(detectSide((await runFinanceFixture(get('ar-open-items-history'))).analysis.table.headers)).toBe('receivable');
    expect(detectSide((await runFinanceFixture(get('pl-aging-ap'))).analysis.table.headers)).toBe('payable');
    expect(detectSide(['Data', 'Suma'])).toBeNull();
  });

  it('open items: each line is an invoice AT a date – the as-of date, due date, paid and outstanding are kept apart; credit balances are flagged', async () => {
    const f = get('ar-open-items-history');
    const r = await runFinanceFixture(f);
    expect(r.snapshotDates).toEqual(['2025-09-30', '2025-10-31', '2025-11-30', END]);
    expect(r.records.every((x) => x.kind === 'open_item' && x.documentId === `open_item receivable ${x.date}` && x.scope === 'open_item:receivable')).toBe(true);
    const neg = r.records.filter((x) => (x.outstanding ?? 0) < 0);
    expect(neg.length).toBe(f.truth.open.filter((o) => o.outstanding < 0).length);
    expect(r.stats.warnings.negative_outstanding).toBe(neg.length);
    const o = f.truth.open.find((x) => x.snapshot === END && x.outstanding > 0)!;
    const rec = r.records.find((x) => x.date === END && x.invoiceNo === o.no)!;
    expect(rec).toMatchObject({ amount: o.amount, paid: o.paid, outstanding: o.outstanding, dueDate: o.due, invoiceDate: o.invDate, counterpartyId: o.cp, currency: 'EUR', side: 'receivable' });
  });

  it('a report without a date column needs the as-of date the user states; without it the import is refused', async () => {
    const f = get('ar-open-items-nodate');
    const r = await runFinanceFixture(f);
    expect(r.dateFromAsOf).toBe(true);
    expect(r.records.every((x) => x.date === END)).toBe(true);
    expect(r.stats.warnings.date_from_as_of).toBe(r.records.length);
    await expect(runFinanceFixture({ ...f, asOfDate: undefined })).rejects.toMatchObject({ code: 'missing_date' });
  });

  it('the invoice register is an invoice FLOW: credit-note rows are split off, never added to invoiced amounts', async () => {
    const r = await runFinanceFixture(get('ar-invoices'));
    expect(r.records.filter((x) => x.kind === 'invoice')).toHaveLength(get('ar-invoices').truth.invoices.length);
    expect(r.records.filter((x) => x.kind === 'credit_note').map((x) => x.documentId).sort()).toEqual(['KR-1', 'KR-2', 'KR-3']);
    expect(r.records.filter((x) => x.kind === 'credit_note').every((x) => (x.amount ?? 0) > 0)).toBe(true); // credit notes are stored as positive magnitudes of their own kind
    expect(r.records.every((x) => x.kind !== 'invoice' || x.dueDate)).toBe(true);
    // invoice numbers of receivables are one series; of payables they are per supplier
    expect(r.records.find((x) => x.kind === 'invoice')!.scope).toBe('invoice:receivable');
    const p = await runFinanceFixture(get('ap-invoices'));
    expect(p.records.find((x) => x.kind === 'invoice')!.scope).toMatch(/^invoice:payable:s0/);
  });

  it('credit-note register keeps the credited invoice; payment register separates the payment number from the invoice it pays', async () => {
    const c = await runFinanceFixture(get('ar-credit-notes'));
    expect(c.records.map((x) => [x.documentId, x.reference ?? null])).toEqual(expect.arrayContaining([['KR-1', expect.stringMatching(/^SF-/)], ['KR-2', 'SF-9999'], ['KR-3', null]]));
    const p = await runFinanceFixture(get('ar-payments'));
    const pay = p.records.find((x) => x.documentId?.startsWith('MK-5001'))!;
    expect(pay.kind).toBe('payment');
    expect(pay.reference).toMatch(/^SF-/);
    expect(p.records.filter((x) => !x.reference)).toHaveLength(2); // the two payments on account
    expect(p.stats.warnings.payment_without_reference).toBe(2);
    // identical lines in one file get occurrence numbers: re-importing the same file yields the same keys
    const keys = p.records.map((x) => x.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k.endsWith('#1'))).toHaveLength(1);
  });

  it('an aging report: one line per counterparty with its buckets; the total column is checked against the buckets', async () => {
    const f = get('pl-aging-ap');
    const r = await runFinanceFixture(f);
    expect(r.records.every((x) => x.kind === 'aging' && x.buckets && x.currency === 'PLN' && x.date === END)).toBe(true);
    for (const x of r.records) expect(x.outstanding).toBeCloseTo(Object.values(x.buckets!).reduce((s, v) => s + v, 0), 2);
    expect(r.stats.warnings.aging_total_mismatch).toBeUndefined();
    const bad = await runFinanceFixture(f, { mutate: (rows) => { rows[0]![7] = '999,00'; } });
    expect(bad.stats.warnings.aging_total_mismatch).toBe(1);
  });

  it('a balance snapshot has no document numbers: one line per counterparty', () => {
    const profiles = ['Customer', 'Balance', 'As of'].map((h, i) => ({ index: i, header: h, nonEmpty: 2, dateRatio: i === 2 ? 1 : 0, serialDateRatio: 0, numberRatio: i === 1 ? 1 : 0, textRatio: i === 0 ? 1 : 0, distinctRatio: 1, avgTextLength: 4, negativeRatio: 0, currencyHints: [], type: 'text', decimal: '.', dateOrder: 'ymd', ambiguousNumbers: 0 })) as never;
    const r = normalizeFinance([['Acme', '100.5', '2025-12-15'], ['Beta', '-20', '2025-12-15']], { profiles, mapping: { columns: { counterparty_name: 0, outstanding_amount: 1, snapshot_date: 2 }, defaultCurrency: 'EUR' }, rowNumbers: [2, 3], today: '2026-01-01', side: 'payable' });
    expect(r.kind).toBe('balance');
    expect(r.grain).toBe('counterparty_at_date');
    expect(r.records.map((x) => [x.outstanding, x.side])).toEqual([[100.5, 'payable'], [-20, 'payable']]);
    expect(r.stats.warnings.negative_outstanding).toBe(1);
  });

  it('an outstanding amount is only DERIVED from the same line (original − paid), and the import says so', () => {
    const headers = ['Customer', 'Invoice no', 'Invoice date', 'As of', 'Invoice amount', 'Paid amount'];
    const profiles = headers.map((h, i) => ({ index: i, header: h, nonEmpty: 1, dateRatio: i === 2 || i === 3 ? 1 : 0, serialDateRatio: 0, numberRatio: i >= 4 ? 1 : 0, textRatio: i < 2 ? 1 : 0, distinctRatio: 1, avgTextLength: 4, negativeRatio: 0, currencyHints: [], type: 'text', decimal: '.', dateOrder: 'ymd', ambiguousNumbers: 0 })) as never;
    // no outstanding column ⇒ this is an invoice register that also shows a paid column, NOT a ledger: no balance is derived from "paid"
    const reg = normalizeFinance([['Acme', 'A1', '2025-12-01', '2025-12-15', '100', '40']], { profiles, mapping: { columns: { counterparty_name: 0, document_id: 1, document_date: 2, snapshot_date: 3, original_amount: 4, paid_amount: 5 }, defaultCurrency: 'EUR' }, rowNumbers: [2], today: '2026-01-01', side: 'receivable' });
    expect(reg.kind).toBe('invoices');
    expect(reg.records[0]).toMatchObject({ kind: 'invoice', amount: 100 });
    expect(reg.records[0]!.outstanding).toBeUndefined();
    const open = normalizeFinance([['Acme', 'A1', '2025-12-01', '2025-12-15', '100', '40', '']], { profiles: [...profiles, { ...(profiles as unknown as object[])[5], index: 6, header: 'Outstanding amount' }] as never, mapping: { columns: { counterparty_name: 0, document_id: 1, document_date: 2, snapshot_date: 3, original_amount: 4, paid_amount: 5, outstanding_amount: 6 }, defaultCurrency: 'EUR' }, rowNumbers: [2], today: '2026-01-01', side: 'receivable' });
    expect(open.records[0]).toMatchObject({ outstanding: 60, paid: 40, amount: 100 });
    expect(open.stats.warnings.outstanding_derived).toBe(1);
  });

  it('dataset kind comes from the confirmed mapping alone', () => {
    const k = (...f: string[]) => financeKindFromFields(f as never);
    expect(k('aging_current', 'aging_1_30', 'counterparty_name')).toBe('aging');
    expect(k('payment_date', 'paid_amount', 'counterparty_name')).toBe('payments');
    expect(k('payment_reference', 'paid_amount')).toBe('payments');
    expect(k('credit_reference', 'original_amount')).toBe('credit_notes');
    expect(k('outstanding_amount', 'document_id', 'due_date')).toBe('open_items');
    expect(k('outstanding_amount', 'counterparty_name')).toBe('balance');
    expect(k('original_amount', 'document_id', 'document_date')).toBe('invoices');
  });

  it('mapping confirmation: counterparty + an amount (or buckets) + a date; nothing is guessed', () => {
    const w = (fields: string[], ctx = {}) => validateMapping(fields.map((f) => ({ field: f as never, confidence: 1 })), 'finance', ctx).map((x) => x.code);
    expect(w(['counterparty_name', 'outstanding_amount', 'snapshot_date'])).toEqual([]);
    expect(w(['counterparty_id', 'aging_current', 'snapshot_date'])).toEqual([]);
    expect(w(['counterparty_name', 'outstanding_amount'])).toEqual(['missing_date']);
    expect(w(['counterparty_name', 'outstanding_amount'], { hasDefaultDate: true })).toEqual([]);
    expect(w(['outstanding_amount', 'snapshot_date'])).toEqual(['missing_counterparty']);
    expect(w(['counterparty_name', 'snapshot_date'])).toEqual(['missing_amount']);
    expect(isMappingConfirmable(validateMapping([{ field: 'outstanding_amount', confidence: 1 }], 'finance'))).toBe(false);
  });

  it('missing counterparty column is refused; blank counterparty cells are warned per row', async () => {
    const f = get('ar-payments');
    const r = await runFinanceFixture(f, { mutate: (rows) => { rows[0]![2] = ''; rows[0]![3] = ''; } });
    expect(r.stats.warnings.missing_counterparty).toBe(1);
    expect(() => normalizeFinance([['x']], { profiles: [], mapping: { columns: { paid_amount: 0, payment_date: 0 }, defaultCurrency: 'EUR' }, rowNumbers: [2], today: '2026-01-01' })).toThrow(/missing_counterparty/);
  });
});
