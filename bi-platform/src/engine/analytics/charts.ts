import type { Dimension } from './filters';

export type ChartId = 'trend' | 'comparison' | 'topCustomers' | 'topProducts' | 'salespeople' | 'category' | 'waterfall' | 'pareto';
export type HiddenReason = 'needs_dimension' | 'too_few_points' | 'no_comparison' | 'too_few_entities';

export interface ChartInputs {
  trendPoints: number;
  comparisonUsable: boolean;
  /** Number of entities with positive sales in the current period, per dimension (0 when the column is not mapped). */
  entities: Record<Dimension, number>;
  /** Entities whose value changed between the periods, per dimension. */
  movers: Record<Dimension, number>;
}

export interface ChartPlan {
  id: ChartId;
  dimension?: Dimension;
  available: boolean;
  reason?: HiddenReason;
}

const WATERFALL_ORDER: Dimension[] = ['customer', 'product', 'category', 'salesperson'];
const PARETO_ORDER: Dimension[] = ['customer', 'product'];

/**
 * Chart configuration layer: decides WHICH charts make sense for the data at hand. UI never shows an empty or meaningless chart;
 * hidden charts carry the reason so analysts can see why.
 */
export function planCharts(i: ChartInputs): ChartPlan[] {
  const dim = (id: ChartId, d: Dimension, min = 2): ChartPlan =>
    i.entities[d] === 0 ? { id, dimension: d, available: false, reason: 'needs_dimension' } : i.entities[d] < min ? { id, dimension: d, available: false, reason: 'too_few_entities' } : { id, dimension: d, available: true };
  const wDim = WATERFALL_ORDER.find((d) => i.movers[d] >= 2);
  const pDim = PARETO_ORDER.find((d) => i.entities[d] >= 5);
  return [
    i.trendPoints >= 3 ? { id: 'trend', available: true } : { id: 'trend', available: false, reason: 'too_few_points' },
    i.comparisonUsable ? { id: 'comparison', available: true } : { id: 'comparison', available: false, reason: 'no_comparison' },
    dim('topCustomers', 'customer'),
    dim('topProducts', 'product'),
    dim('salespeople', 'salesperson'),
    dim('category', 'category'),
    !i.comparisonUsable ? { id: 'waterfall', available: false, reason: 'no_comparison' } : wDim ? { id: 'waterfall', dimension: wDim, available: true } : { id: 'waterfall', available: false, reason: 'too_few_entities' },
    pDim ? { id: 'pareto', dimension: pDim, available: true } : { id: 'pareto', available: false, reason: 'too_few_entities' },
  ];
}
