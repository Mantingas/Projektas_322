import type { Insight } from '../types';

/**
 * Insight explanation layer: one normalised structure that every surface (cards, details panel, report) renders,
 * so a finding reads the same everywhere.
 */
export interface InsightExplanation {
  id: string;
  whatKey: string;
  howMuch: Insight['impact'];
  contributors: Insight['evidence'];
  whyKey: string;
  actionKey: string;
  chart?: Insight['chart'];
  dimension?: Insight['dimension'];
  sufficiency: { level: Insight['reliability']; reasonKey: string };
  /** Always true: contributors are associations in the data, not proven causes. */
  associationOnly: true;
}

export function explainInsight(i: Insight): InsightExplanation {
  return {
    id: i.id, whatKey: i.titleKey, howMuch: i.impact, contributors: i.evidence.filter((e) => e.label !== 'period'), whyKey: i.whyKey, actionKey: i.actionKey,
    chart: i.chart, dimension: i.dimension, sufficiency: { level: i.reliability, reasonKey: i.reliabilityReasonKey }, associationOnly: true,
  };
}
