import type { AmountBasis } from '../types';
import type { Aggregate } from './aggregate';

export type MetricId = 'sales' | 'returns' | 'quantity' | 'orders' | 'aov' | 'customers' | 'asp' | 'margin';
export type MetricUnit = 'money' | 'qty' | 'count' | 'pct';

export interface MetricContext {
  basis: AmountBasis;
  /** Exactly one product is selected by the filters (makes an average price meaningful). */
  singleProduct: boolean;
}

export type Unavailable = 'no_quantity' | 'no_orders' | 'no_customers' | 'no_cost' | 'needs_single_product' | 'cost_needs_net' | 'no_data';

export interface MetricValue {
  id: MetricId;
  value: number | null;
  /** Why value is null. */
  unavailable?: Unavailable;
}

export interface MetricDef {
  id: MetricId;
  unit: MetricUnit;
  /** For "good" / "bad" colouring of changes. */
  higherIsBetter: boolean;
  evaluate(a: Aggregate, ctx: MetricContext): MetricValue;
}

export const MIN_COVERAGE = 0.8;
const ok = (id: MetricId, value: number): MetricValue => ({ id, value });
const no = (id: MetricId, unavailable: Unavailable): MetricValue => ({ id, value: null, unavailable });

/**
 * THE metric registry. A metric is a pure function of an Aggregate: the same formula feeds KPI cards, comparison tables,
 * rankings, drill-down headers and reports. Future modules register their own definitions here.
 */
export const METRICS: Record<MetricId, MetricDef> = {
  sales: { id: 'sales', unit: 'money', higherIsBetter: true, evaluate: (a) => (a.lines ? ok('sales', a.revenue) : no('sales', 'no_data')) },
  returns: { id: 'returns', unit: 'money', higherIsBetter: false, evaluate: (a) => (a.lines ? ok('returns', a.returns) : no('returns', 'no_data')) },
  quantity: {
    id: 'quantity', unit: 'qty', higherIsBetter: true,
    evaluate: (a) => (a.lines && a.qtyLines / a.lines >= MIN_COVERAGE ? ok('quantity', a.quantity) : no('quantity', 'no_quantity')),
  },
  orders: {
    id: 'orders', unit: 'count', higherIsBetter: true,
    evaluate: (a) => {
      if (!a.lines || a.linesWithDoc / a.lines < 0.95) return no('orders', 'no_orders');
      return ok('orders', [...a.docTotals.values()].filter((v) => v > 0).length); // credit notes are not orders
    },
  },
  aov: {
    id: 'aov', unit: 'money', higherIsBetter: true,
    evaluate: (a) => {
      if (!a.lines || a.linesWithDoc / a.lines < 0.95) return no('aov', 'no_orders');
      const pos = [...a.docTotals.values()].filter((v) => v > 0);
      return pos.length ? ok('aov', pos.reduce((x, y) => x + y, 0) / pos.length) : no('aov', 'no_orders');
    },
  },
  customers: {
    id: 'customers', unit: 'count', higherIsBetter: true,
    evaluate: (a) => (a.lines && a.customerLines / a.lines >= MIN_COVERAGE ? ok('customers', [...a.customerTotals.values()].filter((v) => v > 0).length) : no('customers', 'no_customers')),
  },
  asp: {
    id: 'asp', unit: 'money', higherIsBetter: true,
    evaluate: (a, ctx) => {
      if (!ctx.singleProduct) return no('asp', 'needs_single_product'); // averaging prices of different products is meaningless
      if (!a.lines || a.qtyLines / a.lines < MIN_COVERAGE) return no('asp', 'no_quantity');
      return a.quantity > 0 ? ok('asp', a.revenueWithQty / a.quantity) : no('asp', 'no_quantity');
    },
  },
  margin: {
    id: 'margin', unit: 'pct', higherIsBetter: true,
    evaluate: (a, ctx) => {
      if (ctx.basis !== 'net') return no('margin', 'cost_needs_net');
      if (!a.positiveLines || a.costLines / a.positiveLines < MIN_COVERAGE || a.revenueWithCost <= 0) return no('margin', 'no_cost');
      return ok('margin', (a.revenueWithCost - a.cost) / a.revenueWithCost);
    },
  },
};

export const KPI_ORDER: MetricId[] = ['sales', 'quantity', 'orders', 'aov', 'customers', 'asp', 'margin', 'returns'];

export const evaluate = (id: MetricId, a: Aggregate, ctx: MetricContext) => METRICS[id].evaluate(a, ctx);
