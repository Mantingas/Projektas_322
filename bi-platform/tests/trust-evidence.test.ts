import { describe, expect, it } from 'vitest';
import { assessInsight } from '@/engine/trust/evidence';
import type { Insight } from '@/engine/types';

const ins = (id: string, o: Partial<Insight> = {}): Insight => ({ id, topic: id, group: id, module: 'purchasing', severity: 'risk', titleKey: `${id}.title`, bodyKey: `${id}.body`, actionKey: `${id}.action`, whyKey: `${id}.why`, params: {}, reliability: 'high', reliabilityReasonKey: 'rel.enoughLines', impact: { value: 100, unit: 'money' }, actionable: true, evidence: [{ key: 'sku:p1', label: 'x', current: 1, unit: 'money' }], score: 0.5, ...o });
const st = (id: string, o: Partial<Insight> = {}, ctx = {}) => assessInsight(ins(id, o), ctx).status;

describe('the date dimension of every finding is stated', () => {
  it('sales / purchasing use the mapped document date, finance overdue uses due dates, stock uses report and movement dates, cross-module compares both', () => {
    const dim = (id: string, module: Insight['module'] = 'sales') => assessInsight(ins(id, { module })).dateDimension;
    expect(dim('sales.revenue_change')).toBe('document');
    expect(dim('purchasing.price_increase', 'purchasing')).toBe('document');
    expect(dim('finance.largest_overdue', 'debts')).toBe('due');
    expect(dim('finance.duplicate_payments', 'debts')).toBe('document_payment');
    expect(dim('inventory.excess_stock', 'inventory')).toBe('snapshot_movement');
    expect(dim('cross.stock_cover_low', 'cross')).toBe('document_snapshot');
  });
});

describe('evidence status comes from the kind and quality of the evidence, never from the size of the amount', () => {
  it('arithmetic facts are verified; statistical patterns are candidates; threshold and scenario results are estimates', () => {
    expect(st('purchasing.spend_change')).toBe('verified');
    expect(st('sales.revenue_change', { module: 'sales' })).toBe('verified');
    expect(st('finance.largest_overdue', { module: 'debts' })).toBe('verified');
    expect(st('purchasing.spend_anomaly')).toBe('candidate');
    expect(st('finance.duplicate_payments', { module: 'debts' })).toBe('candidate');
    expect(st('inventory.excess_stock', { module: 'inventory' })).toBe('estimate');
    expect(st('purchasing.historical_price_scenario', { savings: { kind: 'hypothetical', amount: 5 } })).toBe('estimate');
    expect(st('purchasing.supplier_price_gap', { savings: { kind: 'potential', amount: 5 } })).toBe('estimate');
    expect(st('cross.margin_squeeze', { module: 'cross' })).toBe('estimate');
  });

  it('multiplying the amount by any factor never changes the status, the assumptions or the missing evidence', () => {
    const ids = ['purchasing.spend_change', 'purchasing.spend_anomaly', 'inventory.excess_stock', 'finance.duplicate_payments', 'finance.largest_overdue', 'cross.customer_exposure', 'purchasing.historical_price_scenario', 'sales.low_margin_products'];
    for (const id of ids) {
      const base = assessInsight(ins(id));
      for (const k of [0, 1e-6, 10, 1e6, 1e12]) {
        const a = assessInsight(ins(id, { impact: { value: 100 * k, unit: 'money' }, score: 0.5 + k, evidence: [{ key: 'sku:p1', label: 'x', current: 1e9 * k, unit: 'money' }] }));
        expect([a.status, a.assumptions, a.limitations, a.missing]).toEqual([base.status, base.assumptions, base.limitations, base.missing]);
      }
    }
  });

  it('weak evidence only ever lowers the status', () => {
    expect(st('purchasing.spend_change', { reliability: 'low' })).toBe('candidate');
    expect(st('sales.revenue_change', { module: 'sales' }, { basis: 'unknown' })).toBe('candidate');
    expect(assessInsight(ins('sales.revenue_change', { module: 'sales' }), { basis: 'unknown' }).missing.map((m) => m.key)).toContain('trust.miss.vat_basis');
    expect(st('purchasing.price_increase', { evidence: [{ key: 'name:widget', label: 'w', current: 1, unit: 'price' }] })).toBe('candidate');
    // and nothing raises it: an estimate stays an estimate whatever the reliability or basis
    expect(st('inventory.excess_stock', { module: 'inventory', reliability: 'high' }, { basis: 'net' })).toBe('estimate');
  });

  it('finance findings always disclose that the file states no VAT basis; cross findings carry their own limits', () => {
    const f = assessInsight(ins('finance.largest_overdue', { module: 'debts' }));
    expect(f.limitations.map((l) => l.key)).toContain('trust.lim.basis_as_stated');
    expect(f.amountBasis).toBe('as_stated');
    const c = assessInsight(ins('cross.customer_exposure', { module: 'cross', cross: { sources: [], links: [{ id: 'l', kind: 'counterparty', a: 'A', b: 'B', basis: 'user_confirmed' }], period: { from: '2025-01-01', to: '2025-03-31' }, methodKey: 'cross.m.customer_exposure', limits: ['cross.l.not_summed'], confidenceKey: 'cross.c.medium' } }));
    expect(c.limitations.map((l) => l.key)).toContain('cross.l.not_summed');
    expect(c.assumptions.map((l) => l.key)).toContain('trust.asm.name_confirmed');
    expect(c.period).toEqual({ from: '2025-01-01', to: '2025-03-31' });
  });
});
