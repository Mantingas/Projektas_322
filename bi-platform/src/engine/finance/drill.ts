import type { FinanceRecord } from '../types';
import type { DrillSpec } from '../analytics/provenance';
import { applyFinanceFilters } from './dashboard';
import { bucketOf, daysPastDue, DUE_SOON_DAYS, listSnapshots, pickSnapshot } from './ledger';

export interface FinDrillItem { rec: FinanceRecord; /** what the drill-down total adds up: the outstanding balance (positions) or the amount (flows) */ amount: number; /** days past due as of the snapshot (open items) */ days?: number }

/**
 * The lines behind a finance number – built with the SAME side, counterparty filter, snapshot selection (one snapshot, never several) and date range
 * as the dashboard, so a drill-down total equals the KPI it explains.
 */
export function drillFinanceRecords(records: FinanceRecord[], spec: DrillSpec): FinDrillItem[] {
  const f = spec.fin;
  if (!f) return [];
  const rows = applyFinanceFilters(records.filter((r) => r.side === f.side), f.side, { ...spec.filter, dateFrom: undefined, dateTo: undefined });
  if (f.mode === 'flow') {
    let rs = rows.filter((r) => r.kind === 'invoice' || r.kind === 'payment' || r.kind === 'credit_note');
    if (f.kinds?.length) rs = rs.filter((r) => f.kinds!.includes(r.kind));
    if (spec.range) rs = rs.filter((r) => r.date >= spec.range!.from && r.date <= spec.range!.to);
    if (f.keys?.length) { const k = new Set(f.keys); rs = rs.filter((r) => k.has(r.key)); }
    return rs.map((rec) => ({ rec, amount: rec.amount ?? 0 }));
  }
  const snap = f.asOf ? pickSnapshot(listSnapshots(rows), f.asOf) : null;
  if (!snap) return [];
  const out: FinDrillItem[] = [];
  for (const rec of snap.records) {
    if (snap.kind === 'open_item') {
      const o = rec.outstanding ?? 0;
      const days = rec.dueDate ? daysPastDue(rec.dueDate, snap.date) : undefined;
      const pos = o > 0;
      const b = f.bucket;
      if (b === 'overdue' && !(pos && days !== undefined && days >= 1)) continue;
      if (b === 'nd' && !(pos && days !== undefined && days <= 0)) continue;
      if ((b === 'd30' || b === 'd60' || b === 'd90' || b === 'd90p') && !(pos && days !== undefined && bucketOf(days) === b)) continue;
      if (b === 'noDue' && !(pos && days === undefined)) continue;
      if (b === 'credits' && o >= 0) continue;
      if (b === 'dueSoon' && !(pos && days !== undefined && days <= 0 && days >= -DUE_SOON_DAYS)) continue;
      out.push({ rec, amount: o, days });
    } else if (snap.kind === 'aging') {
      const k = rec.buckets;
      const b = f.bucket;
      const amount = !b || !k ? (rec.outstanding ?? 0) : b === 'overdue' ? k.d30 + k.d60 + k.d90 + k.d90p : b === 'nd' ? k.nd : b === 'd30' || b === 'd60' || b === 'd90' || b === 'd90p' ? k[b] : 0;
      if (amount !== 0 || !b) out.push({ rec, amount });
    } else out.push({ rec, amount: rec.outstanding ?? 0 });
  }
  return out;
}
