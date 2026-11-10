import { describe, expect, it } from 'vitest';
import { DICTS, translate, type Lang, type MessageKey } from '@/i18n';
import { Book, S1 } from './fixtures/trust';
import { analyseSettlement } from '@/engine/trust/settlement';
import { assessInsight } from '@/engine/trust/evidence';
import type { Described } from '@/engine/trust/types';
import type { Insight } from '@/engine/types';
import { withheldText } from '@/lib/executiveSummary';

const langs: Lang[] = ['lt', 'pl', 'en'];
const D = (l: Lang) => DICTS[l] as Record<string, string>;
const has = (k: string) => langs.every((l) => (D(l)[k] ?? '').length > 0);

const ALL_FINDINGS = () => {
  const books = [
    new Book().invoice(S1, 'I', '2025-01-05', '2025-02-05', 1000).payment(S1, 'I', '2025-02-01', 1400).open('2025-03-01', S1, 'I', -400, 1000).credit(S1, 'K1', '2025-01-20', 450).open('2025-03-01', S1, 'K1', -450).credit(S1, 'K2', '2025-01-20', 300, 'GONE').credit(S1, 'K3', '2025-01-21', 1300, 'I').credit(S1, 'K4', '2025-01-22', 10, undefined, 'sign', -1),
    new Book().invoice(S1, 'I', '2025-01-05', '2025-02-05', 1000).open('2025-03-01', S1, 'I', 900, 900).credit(S1, 'K', '2025-02-01', 100, 'I').credit(S1, 'KX', '2025-02-01', 350).payment(S1, undefined, '2025-02-01', 700, 'B').payment(S1, undefined, '2025-02-01', 700, 'B').payment(S1, undefined, '2025-04-01', 5).payment(S1, undefined, '2025-04-03', 5).payment({ id: 'S2', name: 'X' }, 'I', '2025-02-01', 10).payment(S1, 'NOPE', '2025-02-01', 11),
    new Book().invoice(S1, 'U', '2024-11-05', '2024-12-05', 1000).open('2025-03-01', S1, 'Z', 10, 10).credit(S1, 'KP', '2025-01-20', 300, undefined),
  ];
  return books.flatMap((b) => analyseSettlement(b.records, 'payable', 'EUR').findings);
};
const keysOf = (xs: Described[]) => xs.map((x) => x.key);

describe('phase 7 texts exist in LT, PL and EN', () => {
  it('every text key the trust engine can emit is defined in all three languages and renders without leftover placeholders', () => {
    const fs = ALL_FINDINGS();
    expect(fs.length).toBeGreaterThan(8);
    const keys = new Set<string>();
    for (const f of fs) {
      [f.calculation, f.rationale, ...(f.withheldReason ? [f.withheldReason] : []), ...f.assumptions, ...f.limitations, ...f.missing].forEach((d) => keys.add(d.key));
      keys.add(`trust.rule.${f.rule}`); keys.add(`trust.status.${f.status}`); keys.add(`trust.status.d.${f.status}`);
      if (f.state) keys.add(`trust.state.${f.state}`);
      if (f.exposure) keys.add(`trust.exposure.${f.exposure.kind}`);
      f.records.forEach((r) => keys.add(`trust.role.${r.role}`));
    }
    expect([...keys].filter((k) => !has(k))).toEqual([]);
    for (const l of langs) for (const f of fs) for (const d of [f.calculation, f.rationale, ...(f.withheldReason ? [f.withheldReason] : []), ...f.assumptions, ...f.limitations, ...f.missing]) {
      const out = translate(l, d.key as MessageKey, d.params ?? {}, 'EUR');
      expect(out, `${l} ${d.key}`).not.toMatch(/\{\w+\}/);
    }
  });

  it('every evidence family the module findings can use is covered (assumptions, limitations, missing, rationale)', () => {
    const ids = ['sales.revenue_change', 'sales.low_margin_products', 'purchasing.spend_anomaly', 'purchasing.supplier_price_gap', 'inventory.excess_stock', 'inventory.negative_stock', 'finance.largest_overdue', 'finance.duplicate_payments', 'cross.customer_exposure', 'cross.margin_squeeze', 'universal.missing'];
    const bad: string[] = [];
    for (const id of ids) for (const basis of ['net', 'unknown'] as const) for (const rel of ['high', 'low'] as const) {
      const i: Insight = { id, topic: id, group: id, module: id.startsWith('finance') ? 'debts' : id.startsWith('cross') ? 'cross' : id.startsWith('universal') ? 'universal' : 'sales', severity: 'risk', titleKey: 't', bodyKey: 'b', actionKey: 'a', whyKey: 'sales.revenue_change.why', params: {}, reliability: rel, reliabilityReasonKey: 'rel.enoughLines', impact: { value: 1, unit: 'money' }, actionable: true, evidence: [{ key: 'name:x', label: 'x', current: 1, unit: 'money' }], score: 1, ...(id.startsWith('cross') ? { cross: { sources: [], links: [{ id: 'l', kind: 'product' as const, a: 'a', b: 'b', basis: 'user_confirmed' as const }], period: { from: '2025-01-01', to: '2025-02-01' }, methodKey: 'cross.m.stock_cover', limits: ['cross.l.not_summed'], confidenceKey: 'cross.c.low_lag' } } : {}) };
      const d = assessInsight(i, { basis });
      for (const k of [...keysOf(d.assumptions), ...keysOf(d.limitations), ...keysOf(d.missing), d.rationale.key, `trust.status.${d.status}`, `trust.panel.basis.${d.amountBasis}`]) if (!has(k)) bad.push(k);
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it('import-trust, panel, report and withheld texts are complete', () => {
    const keys = [
      ...['title', 'allClear', 'level.ok', 'level.info', 'level.warn', 'level.confirm', 'currency.column', 'currency.chosen', 'currency.multi', 'vat.net', 'vat.gross', 'vat.unknown', 'vat.not_stated', 'date_order', 'order.dmy', 'order.mdy', 'order.ymd', 'order.label', 'dates.ok', 'dates.bad', 'identifiers', 'duplicates.stored', 'duplicates.invoice', 'credit_sign', 'amount_sign', 'coverage', 'compat_currency', 'compat_basis'].map((k) => `itrust.${k}`),
      ...['title', 'status', 'records', 'calculation', 'currency', 'period', 'assumptions', 'limitations', 'missing', 'rationale', 'withheld', 'export', 'sources', 'noRecords', 'basis.as_stated', 'basis.net', 'basis.gross', 'basis.unknown', 'basis.none'].map((k) => `trust.panel.${k}`),
      ...['confirmed', 'opps', 'risks', 'scenarios', 'withheld', 'potential', 'verify', 'verifyAction', 'composition'].map((k) => `trust.rep.${k}`), 'trust.disclaimer', 'trust.panel.date', ...['document', 'snapshot', 'due', 'document_payment', 'document_snapshot', 'snapshot_movement'].map((k) => `trust.date.${k}`), 'trust.find.potential.note', 'trust.find.title', 'trust.find.intro', 'trust.withheldModule',
    ];
    expect(keys.filter((k) => !has(k))).toEqual([]);
  });

  it('withheld module conclusions render for every module with real rule and reason keys', () => {
    const cases: [Parameters<typeof withheldText>[0]['source'], string, string][] = [['sales', 'margin', 'no_cost'], ['purchasing', 'price_increase', 'short_history'], ['inventory', 'stockout_risk', 'no_demand'], ['finance', 'payment_delay', 'few_matches'], ['cross', 'margin_squeeze', 'unit_mismatch']];
    for (const l of langs) for (const [source, rule, reason] of cases) {
      const t = withheldText({ source, rule, reason }, l);
      expect(t, `${l} ${source}.${rule}.${reason}`).not.toMatch(/\b(rule|prule|irule|frule|unavail|punavail|iunavail|funavail|cross|mod)\.[a-z_]+/);
    }
  });

  it('LT and PL are real translations; wording separates unapplied credit, overpayment, duplicate, verified, estimate and realised savings', () => {
    const keys = Object.keys(D('en')).filter((k) => /^(trust\.|itrust\.)/.test(k));
    expect(keys.length).toBeGreaterThan(180);
    for (const l of ['lt', 'pl'] as Lang[]) {
      const same = keys.filter((k) => D(l)[k] === D('en')[k]);
      expect(same.length / keys.length, `${l}: ${same.slice(0, 6).join(', ')}`).toBeLessThan(0.03);
    }
    for (const l of langs) {
      const names = ['trust.rule.unapplied_credit', 'trust.rule.overpayment', 'trust.rule.duplicate_payment', 'trust.status.verified', 'trust.status.estimate', 'trust.exposure.possible_excess', 'trust.rep.potential'].map((k) => D(l)[k]);
      expect(new Set(names).size).toBe(names.length);
    }
    for (const l of langs) for (const [k, v] of Object.entries(D(l))) {
      if (!/^trust\./.test(k)) continue;
      expect(v, `${l} ${k}`).not.toMatch(/guaranteed (saving|recover)|will recover|will save|recovered money is|realised saving of/i);
    }
    expect(D('en')['trust.find.potential.note']).toMatch(/not recovered, saved or confirmed-recoverable/);
  });
});
