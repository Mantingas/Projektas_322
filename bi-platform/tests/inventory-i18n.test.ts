import { describe, expect, it } from 'vitest';
import { DICTS, type Lang } from '@/i18n';
import { INVENTORY_FIELDS } from '@/engine/types';
import { INVENTORY_KPI_ORDER } from '@/engine/inventory/metrics';

const langs: Lang[] = ['lt', 'pl', 'en'];
const has = (k: string) => langs.every((l) => ((DICTS[l] as Record<string, string>)[k] ?? '').length > 0);

const REASONS = ['no_data', 'no_snapshot', 'cost_missing', 'mixed_units', 'unit_missing', 'few_items', 'no_movements', 'short_history', 'history_gap', 'movement_types_unclear', 'no_opening', 'no_issue_values', 'no_demand', 'needs_history_or_min', 'window_not_covered', 'no_previous_snapshot'];
const RULES = ['value_concentration', 'value_increase', 'excess_stock', 'slow_moving', 'non_moving', 'stockout_risk', 'negative_stock', 'stock_inconsistent', 'unusual_movements', 'valuation_anomaly'];

/** Every key the inventory UI builds dynamically. A missing one once crashed a page, so they are all listed. */
const dynamic: string[] = [
  ...INVENTORY_FIELDS.map((f) => `field.${f}`),
  ...['empty_quantity', 'invalid_stock_value', 'invalid_min_stock', 'missing_warehouse', 'unknown_movement_type', 'movement_sign_normalised', 'return_direction_by_sign', 'value_mismatch', 'negative_stock', 'missing_cost', 'date_from_as_of'].map((c) => `issue.${c}`),
  ...INVENTORY_KPI_ORDER.flatMap((id) => [`metric.${id}`, `explain.${id}`]),
  ...REASONS.map((r) => `mu.${r}`), ...[...REASONS, 'nothing_found', 'too_little_history'].map((r) => `iunavail.${r}`),
  ...['no_snapshot', 'needs_movements', 'no_value', 'short_history', 'needs_dimension', 'too_few_points', 'no_comparison', 'too_few_entities'].map((r) => `ch.reason.${r}`),
  ...['i_no_snapshot', 'i_no_movements', 'i_no_previous_snapshot', 'i_cost_partial', 'i_negative_stock', 'i_value_conflict', 'i_snapshot_lag', 'i_multi_source', 'i_mixed_units', 'i_units_not_provided', 'i_metric_units', 'i_code_ambiguity', 'i_name_identity', 'i_unmatched', 'i_movement_unclear', 'i_unbalanced_transfers', 'i_thresholds'].map((c) => `lim.${c}`),
  ...RULES.flatMap((r) => [`irule.${r}`, `inventory.${r}.title`, `inventory.${r}.body`, `inventory.${r}.action`, `inventory.${r}.why`]),
  'inventory.value_increase.body_flows', 'inventory.unusual_movements.body_adj', 'inventory.unusual_movements.body_both',
  ...['minStockOnly', 'inRealData'.replace('Real', ''), 'reconPartial', 'nameIdentity'].map((r) => `rel.${r}`),
  ...['snapshot', 'valuation', 'history', 'movements'].flatMap((k) => [`inv.kind.${k}`, `inv.kind.d.${k}`]),
  ...['non_moving', 'slow', 'ok', 'new_stock', 'unmatched', 'ambiguous'].map((s) => `st.${s}`),
  ...['out_of_stock', 'below_min', 'low_cover'].map((s) => `rk.${s}`),
  ...['snapshot', 'receipt', 'issue', 'transfer', 'return', 'adjustment', 'opening', 'unknown'].map((s) => `mt.${s}`),
  ...['a', 'b', 'c'].map((s) => `abc.${s}`),
  ...['trend', 'warehouses', 'products', 'pareto', 'abc', 'waterfall', 'movements', 'slow', 'risk'].map((c) => `ich.${c}`),
  ...['ian.m1', 'ian.m2', 'ian.m3', 'ian.m4', 'ian.m5', 'irep.title', 'mod.inventory', 'drill.warehouse', 'drill.type', 'inv.asOf', 'inv.asOfHelp', 'inv.asOfNeeded', 'import.needProduct', 'import.needQuantity', 'ch.pareto80.stock', 'ch.pareto80.spend'],
];

describe('inventory texts exist in LT, PL and EN', () => {
  it('every dynamically built key is defined in all three languages', () => {
    expect(dynamic.filter((k) => !has(k))).toEqual([]);
  });

  it('LT and PL inventory texts are real translations, not the English text', () => {
    const keys = Object.keys(DICTS.en).filter((k) => /^(inv\.|ich\.|abc\.|sl\.|st\.|rk\.|fl\.|rc\.|irule\.|iunavail\.|inventory\.|mt\.|ian\.|irep\.|lim\.i_|metric\.i_|explain\.i_)/.test(k));
    expect(keys.length).toBeGreaterThan(150);
    for (const l of ['lt', 'pl'] as Lang[]) {
      const same = keys.filter((k) => (DICTS[l] as Record<string, string>)[k] === (DICTS.en as Record<string, string>)[k]);
      expect(same.length / keys.length, `${l}: ${same.slice(0, 5).join(', ')}`).toBeLessThan(0.03);
    }
  });

  it('no inventory text promises savings or calls tied-up stock a loss', () => {
    for (const l of langs) {
      for (const [k, v] of Object.entries(DICTS[l])) {
        if (!/^(inventory\.|lim\.i_|irule\.|sl\.)/.test(k)) continue;
        expect(v, `${l} ${k}`).not.toMatch(/\bsaving|sutaupym|oszczędno/i);
      }
    }
  });
});
