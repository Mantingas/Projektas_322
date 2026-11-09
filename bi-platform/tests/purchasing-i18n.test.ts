import { describe, expect, it } from 'vitest';
import { DICTS, type Lang } from '@/i18n';
import { PURCHASE_FIELDS } from '@/engine/types';
import { PURCHASE_KPI_ORDER } from '@/engine/purchasing/metrics';

const langs: Lang[] = ['lt', 'pl', 'en'];
const has = (k: string) => langs.every((l) => (DICTS[l] as Record<string, string>)[k]?.length ? true : false);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

/** Every key the purchasing UI builds dynamically. A missing one crashed the page once, so they are all listed here. */
const dynamic: string[] = [
  ...PURCHASE_FIELDS.map((f) => `field.${f}`),
  ...['missing_supplier', 'missing_unit', 'unknown_unit', 'invalid_unit_price', 'invalid_discount', 'credit_sign_normalised', 'discount_deducted', 'price_mismatch'].map((c) => `issue.${c}`),
  ...PURCHASE_KPI_ORDER.flatMap((id) => [id === 'p_spend' ? 'metric.p_spend.net' : `metric.${id}`, id === 'p_spend' ? 'metric.p_spend.gross' : '', id === 'p_spend' ? 'metric.p_spend.unknown' : '', `explain.${id}`].filter(Boolean)),
  ...['few_suppliers', 'mixed_units', 'needs_single_product', 'no_data', 'no_documents', 'no_quantity', 'no_suppliers', 'unit_missing'].map((r) => `mu.${r}`),
  ...['short_history', 'no_supplier', 'no_product', 'nothing_found', 'no_credit_history', 'too_little_history'].map((r) => `punavail.${r}`),
  ...['needs_dimension', 'too_few_points', 'no_comparison', 'too_few_entities', 'no_price_data'].map((r) => `ch.reason.${r}`),
  ...['p_basis_unknown', 'p_basis_gross', 'identity_content', 'identity_mixed', 'other_series_hidden', 'filtered', 'no_comparison', 'p_credit_lines', 'held_pending', 'p_units_not_provided', 'p_mixed_units', 'p_unit_mismatch', 'p_name_identity', 'p_code_ambiguity', 'p_price_coverage', 'p_discount_unverified', 'p_metric_units'].map((c) => `lim.${c}`),
  ...['spend_change', 'price_increase', 'price_decrease', 'supplier_price_gap', 'supplier_cost_increase', 'supplier_concentration', 'unusual_quantity', 'spend_anomaly', 'credit_notes_reduced', 'historical_price_scenario'].flatMap((r) => [`prule.${r}`, `purchasing.${r}.body`, `purchasing.${r}.why`, ...(r === 'spend_change' ? ['purchasing.spend_change.action_up', 'purchasing.spend_change.action_down'] : [`purchasing.${r}.action`]), ...(r === 'spend_change' ? ['purchasing.spend_change.title_up', 'purchasing.spend_change.title_down'] : [`purchasing.${r}.title`])]),
  ...['actual', 'potential', 'hypothetical'].flatMap((k) => [`sav.${k}`, `sav.${k}.d`]),
  ...['rel.nameIdentity', 'rel.noUnits', 'rel.creditHistory', 'rel.hypothetical', 'prep.title', 'ch.spend', 'drill.supplier', 'drill.unit', 'mod.sales', 'mod.purchasing', 'mod.view', 'mod.detected', 'import.needSupplier', 'import.discount.included', 'import.discount.deducted', 'import.discount.unverified'],
  ...['trend', 'comparison', 'pareto', 'waterfall', 'bridge', 'priceTrend', 'priceVariance', 'quantity', 'prices', 'productRank'].map((c) => `pch.${c}`),
  ...['start', 'price', 'mix', 'volume', 'new', 'lost', 'credits', 'unassigned', 'end', 'note'].map((c) => `br.${c}`),
  ...['dim.supplier', 'dim1.supplier', 'dim.warehouse', 'dim1.warehouse', 'flt.suppliers', 'flt.warehouses', 'ch.topSuppliers'],
  ...['pan.m1', 'pan.m2', 'pan.m3', 'pan.m4', 'pan.m5'],
];

describe('purchasing texts exist in LT, PL and EN', () => {
  it('every dynamically built key is defined in all three languages', () => {
    expect(dynamic.filter((k) => !has(k))).toEqual([]);
  });

  it('placeholders are identical in all three languages (no lost or renamed parameter)', () => {
    const bad: string[] = [];
    for (const k of Object.keys(DICTS.en)) {
      const sets = langs.map((l) => placeholders((DICTS[l] as Record<string, string>)[k] ?? ''));
      if (new Set(sets).size > 1) bad.push(`${k}: ${sets.join(' | ')}`);
    }
    expect(bad).toEqual([]);
  });

  it('LT and PL purchasing texts are real translations, not the English text', () => {
    const keys = Object.keys(DICTS.en).filter((k) => /^(pur|pch|pv|pp|pt|br|sav|prule|punavail|pan|purchasing|pc|lim\.p_)/.test(k));
    expect(keys.length).toBeGreaterThan(80);
    for (const l of ['lt', 'pl'] as Lang[]) {
      const same = keys.filter((k) => (DICTS[l] as Record<string, string>)[k] === (DICTS.en as Record<string, string>)[k]);
      expect(same.length / keys.length, `${l}: ${same.slice(0, 5).join(', ')}`).toBeLessThan(0.05);
    }
  });
});
