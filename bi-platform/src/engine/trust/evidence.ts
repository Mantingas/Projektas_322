import type { Insight } from '../types';
import type { Described, EvidenceDossier, EvidenceStatus } from './types';
import type { FinanceRecord } from '../types';
import { analyseSettlement } from './settlement';
import type { SettlementResult } from './types';

export interface AssessCtx {
  /** VAT basis of the series the finding was computed in (sales / purchasing) */
  basis?: 'net' | 'gross' | 'unknown';
  currency?: string;
}

type Family = 'arith' | 'stat' | 'threshold' | 'scenario' | 'proxy' | 'fact' | 'link_fact';
/** How each rule's evidence is built. The family fixes the status; NOTHING here looks at how big the amount is. */
const FAMILY: Record<string, Family> = {
  'sales.revenue_change': 'arith', 'sales.customer_concentration': 'arith', 'sales.new_customers': 'arith', 'sales.customers_declined': 'arith', 'sales.product_decline': 'arith', 'sales.product_growth': 'arith', 'sales.product_pareto': 'arith', 'sales.salesperson_decline': 'arith', 'sales.credit_notes': 'arith',
  'sales.margin_overview': 'proxy', 'sales.low_margin_products': 'proxy',
  'purchasing.spend_change': 'arith', 'purchasing.price_increase': 'arith', 'purchasing.price_decrease': 'arith', 'purchasing.supplier_cost_increase': 'arith', 'purchasing.supplier_concentration': 'arith', 'purchasing.credit_notes_reduced': 'arith',
  'purchasing.spend_anomaly': 'stat', 'purchasing.unusual_quantity': 'stat', 'purchasing.supplier_price_gap': 'scenario', 'purchasing.historical_price_scenario': 'scenario',
  'inventory.value_concentration': 'arith', 'inventory.value_increase': 'arith', 'inventory.negative_stock': 'fact', 'inventory.stock_inconsistent': 'fact', 'inventory.valuation_anomaly': 'fact',
  'inventory.excess_stock': 'threshold', 'inventory.slow_moving': 'threshold', 'inventory.stockout_risk': 'threshold', 'inventory.non_moving': 'stat', 'inventory.unusual_movements': 'stat',
  'finance.largest_overdue': 'arith', 'finance.long_overdue': 'arith', 'finance.overdue_growth': 'arith', 'finance.due_soon': 'arith', 'finance.concentration': 'arith',
  'finance.unmatched_credits': 'stat', 'finance.duplicate_payments': 'stat', 'finance.payment_delay': 'stat', 'finance.behaviour_change': 'stat', 'finance.working_capital': 'threshold',
  'cross.customer_exposure': 'link_fact', 'cross.stock_cover_low': 'stat', 'cross.stock_excess_vs_demand': 'threshold', 'cross.stock_vs_purchasing': 'threshold', 'cross.margin_squeeze': 'proxy',
};
const STATUS: Record<Family, EvidenceStatus> = { arith: 'verified', fact: 'verified', link_fact: 'verified', stat: 'candidate', threshold: 'estimate', scenario: 'estimate', proxy: 'estimate' };
const d = (key: string, params?: Described['params']): Described => ({ key, params });

const ASSUME: Record<Family, string[]> = { arith: [], fact: [], link_fact: ['trust.asm.confirmed_links'], stat: ['trust.asm.pattern'], threshold: ['trust.asm.threshold'], scenario: ['trust.asm.same_volume_terms'], proxy: ['trust.asm.margin_proxy'] };
const LIMIT: Record<Family, string[]> = { arith: ['trust.lim.not_audit'], fact: ['trust.lim.not_audit'], link_fact: ['trust.lim.not_audit', 'trust.lim.snapshot_dates'], stat: ['trust.lim.statistical', 'trust.lim.not_audit'], threshold: ['trust.lim.not_forecast', 'trust.lim.not_loss'], scenario: ['trust.lim.not_guaranteed'], proxy: ['trust.lim.not_accounting_margin'] };
const MISSING: Record<Family, string[]> = { arith: [], fact: [], link_fact: [], stat: ['trust.miss.business_check'], threshold: ['trust.miss.demand_context'], scenario: ['trust.miss.supplier_confirmation'], proxy: ['trust.miss.full_cost'] };

/**
 * The evidence dossier of a module finding. The status comes from the rule's evidence family and from the quality flags below; the AMOUNT of the
 * finding is never read, so a bigger number can never make a finding more certain.
 */
export function assessInsight(i: Insight, ctx: AssessCtx = {}): EvidenceDossier {
  const fam: Family = FAMILY[i.id] ?? (i.module === 'universal' ? (i.certainty === 'fact' ? 'arith' : 'stat') : i.certainty === 'fact' ? 'arith' : i.certainty === 'indicator' || i.certainty === 'possible' ? 'stat' : 'stat');
  let status = STATUS[fam];
  const limitations: Described[] = LIMIT[fam].map((k) => d(k));
  const missing: Described[] = MISSING[fam].map((k) => d(k));
  const assumptions: Described[] = ASSUME[fam].map((k) => d(k));
  const money = i.impact.unit === 'money';
  if (i.module === 'debts') limitations.unshift(d('trust.lim.basis_as_stated'));
  if (i.savings?.kind === 'hypothetical') status = 'estimate';
  // quality downgrades: weak evidence can only lower the status
  if (status === 'verified' && i.reliability === 'low') { status = 'candidate'; limitations.push(d('trust.lim.low_sample')); missing.push(d('trust.miss.more_data')); }
  if (money && ctx.basis === 'unknown' && status !== 'estimate') { status = status === 'verified' ? 'candidate' : status; limitations.push(d('trust.lim.basis_unknown')); missing.push(d('trust.miss.vat_basis')); }
  if (i.evidence.some((e) => e.key?.startsWith('name:'))) { if (status === 'verified') status = 'candidate'; limitations.push(d('trust.lim.name_identity')); missing.push(d('trust.miss.product_codes')); }
  if (i.cross) {
    for (const l of i.cross.limits) limitations.push(d(l));
    if (i.cross.links.some((x) => x.basis === 'user_confirmed')) assumptions.push(d('trust.asm.name_confirmed'));
    if (i.cross.confidenceKey === 'cross.c.low_lag' && status === 'verified') status = 'candidate';
  }
  const first = i.cross?.period;
  const dateDimension: EvidenceDossier['dateDimension'] = i.id.startsWith('cross.') ? 'document_snapshot' : i.id.startsWith('inventory.') ? 'snapshot_movement' : i.id.startsWith('finance.') ? (/overdue|due_soon/.test(i.id) ? 'due' : 'document_payment') : 'document';
  return {
    status, currency: ctx.currency, amountBasis: ctx.basis ?? (i.module === 'debts' ? 'as_stated' : 'none'), period: first, dateDimension, records: [],
    calculation: { key: i.whyKey, params: i.params }, assumptions, limitations: dedupe(limitations), missing: dedupe(missing), rationale: d(`trust.why.${status}`),
  };
}
const dedupe = (xs: Described[]) => [...new Map(xs.map((x) => [x.key, x])).values()];

/** Settlement findings for every side and currency of the stored finance records (currencies are never combined). */
export function analyseAllSettlement(records: FinanceRecord[]): SettlementResult[] {
  const out: SettlementResult[] = [];
  const cur = [...new Set(records.map((r) => r.currency))].sort();
  for (const c of cur) for (const side of ['receivable', 'payable'] as const) {
    const rs = records.filter((r) => r.currency === c && r.side === side);
    if (rs.length) out.push(analyseSettlement(rs, side, c));
  }
  return out;
}
