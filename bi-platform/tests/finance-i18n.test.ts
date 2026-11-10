import { describe, expect, it } from 'vitest';
import { DICTS, type Lang } from '@/i18n';
import { FINANCE_FIELDS } from '@/engine/types';
import { FINANCE_KPI_ORDER } from '@/engine/finance/metrics';

const langs: Lang[] = ['lt', 'pl', 'en'];
const D = (l: Lang) => DICTS[l] as Record<string, string>;
const has = (k: string) => langs.every((l) => (D(l)[k] ?? '').length > 0);

const RULES = ['largest_overdue', 'overdue_growth', 'concentration', 'long_overdue', 'unmatched_credits', 'duplicate_payments', 'payment_delay', 'behaviour_change', 'due_soon', 'working_capital'];
const REASONS = ['no_data', 'no_position', 'no_previous_snapshot', 'needs_due_dates', 'due_dates_missing', 'needs_open_items', 'no_invoice_register', 'no_payment_register', 'no_credit_register', 'register_gap', 'few_matches', 'few_counterparties', 'no_invoices'];

const dynamic: string[] = [
  ...FINANCE_FIELDS.map((f) => `ffield.${f}`),
  ...[...FINANCE_KPI_ORDER.receivable, ...FINANCE_KPI_ORDER.payable].flatMap((id) => [`metric.${id}`, `explain.${id}`]),
  ...REASONS.map((r) => `mu.${r}`),
  ...['no_ledger', 'needs_open_items', 'needs_payments', 'needs_due_dates'].map((r) => `ch.reason.${r}`),
  ...RULES.flatMap((r) => [`finance.${r}.why`, `frule.${r}`]),
  'frep.title', 'mod.finance', 'ch.pareto80.debt',
];

describe('finance texts exist in LT, PL and EN', () => {
  it('every dynamically built key is defined in all three languages', () => {
    expect(dynamic.filter((k) => !has(k))).toEqual([]);
  });

  it('every rule has title, body and action, plain or per side', () => {
    for (const r of RULES) for (const p of ['title', 'body', 'action']) {
      const plain = has(`finance.${r}.${p}`);
      const split = has(`finance.${r}.${p}_r`) && has(`finance.${r}.${p}_p`);
      expect(plain || split, `${r}.${p}`).toBe(true);
    }
  });

  it('finance key sets are identical in all languages', () => {
    const re = /^(ffield\.|fin\.|fch\.|ag\.|od\.|ol\.|ot\.|dt\.|bh\.|cn\.|dp\.|pm\.|fk\.|cert\.|lim\.f_|frule\.|funavail\.|finance\.|fan\.)/;
    const keys = (l: Lang) => Object.keys(D(l)).filter((k) => re.test(k)).sort();
    expect(keys('en').length).toBeGreaterThan(150);
    expect(keys('lt')).toEqual(keys('en'));
    expect(keys('pl')).toEqual(keys('en'));
  });

  it('LT and PL are real translations', () => {
    const keys = Object.keys(D('en')).filter((k) => /^(fin\.|fch\.|ag\.|cn\.|dp\.|fk\.|cert\.|lim\.f_|frule\.|funavail\.|finance\.|metric\.f_|explain\.f_)/.test(k));
    for (const l of ['lt', 'pl'] as Lang[]) {
      const same = keys.filter((k) => D(l)[k] === D('en')[k]);
      expect(same.length / keys.length, `${l}: ${same.slice(0, 5).join(', ')}`).toBeLessThan(0.05);
    }
  });
});
