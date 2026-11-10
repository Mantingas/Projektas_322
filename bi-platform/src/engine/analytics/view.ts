import type { Series } from './aggregate';
import type { ChartPlan } from './charts';
import type { AlignedPoint, EntityTable, ParetoPoint, TrendPoint, Waterfall, MetricComparison } from './compare';
import type { Dimension } from './filters';
import type { ResolvedPeriods } from './periods';

/**
 * What the shared chart / KPI / table components need. Sales and purchasing dashboards both satisfy it,
 * so the same components render both modules and the same maths feeds them.
 */
export interface ChartModel {
  /** Purchasing dashboards say "spend" instead of "sales" in chart titles and tooltips. */
  module?: 'purchasing' | 'inventory' | 'finance';
  series: Series;
  bounds: { dateMin: string; dateMax: string };
  periods: ResolvedPeriods;
  kpis: MetricComparison[];
  trend: TrendPoint[];
  aligned: { bucketDays: number; points: AlignedPoint[] };
  tables: Partial<Record<Dimension, EntityTable | null>>;
  pareto: { dimension: Dimension; points: ParetoPoint[]; countFor80: number; total: number } | null;
  waterfall: { dimension: Dimension; data: Waterfall } | null;
  composition: { label: string; value: number; share: number; other?: boolean }[];
  charts: ChartPlan[];
  explain: Partial<Record<string, Record<string, number>>>;
}
