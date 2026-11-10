import type { Missed, PilotMeta, Review } from './types';

export interface PilotFinding { id: string; rule: string; status: 'verified' | 'candidate' | 'estimate' | 'withheld'; side: 'receivable' | 'payable'; currency: string; label: string; exposure: number | null; exposureKind: string | null; records: number }
export interface PilotImport { fileName: string; financeKind?: string; financeSide?: string; dateMin?: string; dateMax?: string; added: number; importedAt: number; warnings: number; errors: number }
export type CheckId = 'invoices' | 'credits' | 'payments' | 'open_items' | 'snapshot' | 'period' | 'real_data' | 'baseline' | 'findings_reviewed' | 'missed_list' | 'reviewer';
export interface Check { id: CheckId; ok: boolean; /** i18n params for the detail text */ params?: Record<string, string | number> }

/** Value tiers are kept apart on purpose: they mean different things, are never added to each other, and never across currencies or sides. */
export interface Tiers {
  side: 'receivable' | 'payable';
  currency: string;
  /** potential exposure: what the app flagged (verified open credit balances + candidate possible excess, de-overlapped) – not a finding of fact */
  exposure: number;
  /** accounting discrepancy the reviewer confirmed */
  confirmedDiscrepancy: number;
  /** the customer's statement of what is recoverable */
  recoverable: number;
  /** money actually recovered, counted only with evidence */
  recovered: number;
  /** loss prevented, counted only with evidence */
  prevented: number;
}

export interface PilotMetrics {
  findings: { total: number; reviewable: number; byStatus: Record<string, number>; withheld: number };
  review: { awaiting: number; confirmed: number; falsePositive: number; inconclusive: number; orphaned: number };
  /** precision over DECIDED findings only; a count of decisions, not a rate, until enough exist and the data are attested real */
  precision: { value: number | null; confirmed: number; decided: number; indicative: boolean; reason?: 'no_decisions' };
  /** recall needs an independent reference list that the reviewer attests to be complete */
  recall: { value: number | null; found: number; known: number; reason?: 'list_not_attested' | 'no_known_problems' };
  missed: { total: number; found: number; notFound: number };
  tiers: Tiers[];
  /** amounts left out of the tiers, with the reason */
  excluded: { recoveredWithoutEvidence: number; preventedWithoutEvidence: number };
  time: { verificationMinutes: number; reviewed: number; avgMinutes: number | null; baselineMinutes: number | null; prepMinutes: number | null; savedMinutes: number | null; savedReason?: 'no_baseline' | 'no_prep' | 'reviews_pending' };
  checks: Check[];
  completeness: number;
  /** warnings about the quality of the pilot's own evidence (i18n `pilot.warn.<code>`) */
  warnings: string[];
  /** NOT STARTED until attested real data and at least one decision exist; never "validated" */
  commercialStatus: 'not_started' | 'in_progress' | 'evidence_complete';
}

const MIN_DECIDED = 30;
const YEAR_DAYS = 330;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function pilotMetrics(i: { findings: PilotFinding[]; potential: { side: 'receivable' | 'payable'; currency: string; total: number }[]; reviews: Review[]; missed: Missed[]; meta: PilotMeta; imports: PilotImport[] }): PilotMetrics {
  const { findings, reviews, missed, meta } = i;
  const ids = new Set(findings.map((f) => f.id));
  const rev = new Map(reviews.filter((r) => ids.has(r.id)).map((r) => [r.id, r]));
  const orphaned = reviews.filter((r) => !ids.has(r.id)).length;
  const reviewable = findings.filter((f) => f.status !== 'withheld');
  const decisionOf = (f: PilotFinding) => rev.get(f.id)?.decision ?? 'not_reviewed';
  const count = (d: string) => reviewable.filter((f) => decisionOf(f) === d).length;
  const confirmed = count('confirmed'), fp = count('false_positive'), inconclusive = count('inconclusive');
  const awaiting = reviewable.length - confirmed - fp - inconclusive;
  const decided = confirmed + fp;
  const byStatus: Record<string, number> = {};
  for (const f of findings) byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;

  // recall
  const known = missed.length;
  const foundList = missed.filter((m) => m.findingId && ids.has(m.findingId)).length;
  const recall: PilotMetrics['recall'] = !meta.missedListComplete ? { value: null, found: foundList, known, reason: 'list_not_attested' } : known === 0 ? { value: null, found: 0, known: 0, reason: 'no_known_problems' } : { value: foundList / known, found: foundList, known };

  // tiers, per side and currency – never added together
  const tiers = new Map<string, Tiers>();
  const tier = (side: 'receivable' | 'payable', currency: string) => { const k = `${side}|${currency}`; return tiers.get(k) ?? (tiers.set(k, { side, currency, exposure: 0, confirmedDiscrepancy: 0, recoverable: 0, recovered: 0, prevented: 0 }), tiers.get(k)!); };
  for (const p of i.potential) if (p.total > 0) tier(p.side, p.currency).exposure = p.total;
  const excluded = { recoveredWithoutEvidence: 0, preventedWithoutEvidence: 0 };
  const warnings: string[] = [];
  for (const f of reviewable) {
    const r = rev.get(f.id);
    if (!r || r.decision !== 'confirmed') continue;
    const t = tier(f.side, f.currency);
    t.confirmedDiscrepancy = r2(t.confirmedDiscrepancy + (r.confirmedDiscrepancy ?? 0));
    t.recoverable = r2(t.recoverable + (r.recoverable ?? 0));
    if (r.recovered) { if (r.recoveredEvidence.trim()) t.recovered = r2(t.recovered + r.recovered); else excluded.recoveredWithoutEvidence = r2(excluded.recoveredWithoutEvidence + r.recovered); }
    if (r.prevented) { if (r.preventedEvidence.trim()) t.prevented = r2(t.prevented + r.prevented); else excluded.preventedWithoutEvidence = r2(excluded.preventedWithoutEvidence + r.prevented); }
    if ((r.recovered ?? 0) > (r.recoverable ?? 0) + 0.005) warnings.push('recovered_exceeds_recoverable');
    if (r.confirmedDiscrepancy === null) warnings.push('confirmed_without_amount');
    if (!r.reconciliation.trim()) warnings.push('confirmed_without_reconciliation');
  }
  for (const f of reviewable) { const r = rev.get(f.id); if (r && (r.decision === 'false_positive' || r.decision === 'inconclusive') && !r.reason.trim()) warnings.push('rejected_without_reason'); }
  if (excluded.recoveredWithoutEvidence > 0 || excluded.preventedWithoutEvidence > 0) warnings.push('amounts_without_evidence');
  if (orphaned > 0) warnings.push('orphaned_reviews');
  // a VERIFIED finding the reviewer rejected is a defect of the product, not a data issue
  if (reviewable.some((f) => f.status === 'verified' && decisionOf(f) === 'false_positive')) warnings.push('verified_rejected');

  // time
  const vMin = reviews.filter((r) => ids.has(r.id)).reduce((s, r) => s + (r.minutes ?? 0), 0);
  const reviewedN = reviews.filter((r) => ids.has(r.id) && r.decision !== 'not_reviewed' && r.minutes !== null).length;
  const time: PilotMetrics['time'] = { verificationMinutes: vMin, reviewed: reviewedN, avgMinutes: reviewedN ? vMin / reviewedN : null, baselineMinutes: meta.baselineMinutes, prepMinutes: meta.prepMinutes, savedMinutes: null };
  if (meta.baselineMinutes === null) time.savedReason = 'no_baseline'; else if (meta.prepMinutes === null) time.savedReason = 'no_prep'; else if (awaiting > 0) time.savedReason = 'reviews_pending'; else time.savedMinutes = meta.baselineMinutes - (meta.prepMinutes + vMin);

  // completeness
  const has = (kind: string) => i.imports.filter((x) => x.financeKind === kind && x.financeSide === 'payable' && x.added > 0);
  const span = (xs: PilotImport[]) => { const a = xs.map((x) => x.dateMin).filter(Boolean).sort(); const b = xs.map((x) => x.dateMax).filter(Boolean).sort(); return a.length && b.length ? { from: a[0]!, to: b[b.length - 1]! } : null; };
  const reg = span([...has('invoices'), ...has('payments')]);
  const open = has('open_items');
  const openDate = open.map((x) => x.dateMax).filter(Boolean).sort().pop();
  const snapshotOk = Boolean(meta.snapshotDate && meta.snapshotSource.trim() && openDate && openDate === meta.snapshotDate);
  const periodOk = Boolean(reg && days(reg.from, reg.to) >= YEAR_DAYS);
  const checks: Check[] = [
    { id: 'invoices', ok: has('invoices').length > 0 }, { id: 'credits', ok: has('credit_notes').length > 0 }, { id: 'payments', ok: has('payments').length > 0 }, { id: 'open_items', ok: open.length > 0 },
    { id: 'snapshot', ok: snapshotOk, params: { documented: meta.snapshotDate || '–', found: openDate ?? '–' } },
    { id: 'period', ok: periodOk, params: { from: reg?.from ?? '–', to: reg?.to ?? '–', days: reg ? days(reg.from, reg.to) : 0 } },
    { id: 'real_data', ok: meta.realDataAttested }, { id: 'baseline', ok: meta.baselineMinutes !== null && meta.prepMinutes !== null },
    { id: 'findings_reviewed', ok: reviewable.length > 0 && awaiting === 0, params: { awaiting, total: reviewable.length } },
    { id: 'missed_list', ok: meta.missedListComplete }, { id: 'reviewer', ok: Boolean(meta.reviewer.trim()) },
  ];
  const completeness = checks.filter((c) => c.ok).length / checks.length;
  const commercialStatus: PilotMetrics['commercialStatus'] = !meta.realDataAttested || decided + inconclusive === 0 ? 'not_started' : completeness === 1 ? 'evidence_complete' : 'in_progress';
  if (!meta.realDataAttested) warnings.push('not_real_data');

  return {
    findings: { total: findings.length, reviewable: reviewable.length, byStatus, withheld: findings.length - reviewable.length },
    review: { awaiting, confirmed, falsePositive: fp, inconclusive, orphaned },
    precision: decided === 0 ? { value: null, confirmed, decided, indicative: true, reason: 'no_decisions' } : { value: confirmed / decided, confirmed, decided, indicative: decided < MIN_DECIDED },
    recall, missed: { total: known, found: foundList, notFound: known - foundList }, tiers: [...tiers.values()].sort((a, b) => `${a.side}${a.currency}`.localeCompare(`${b.side}${b.currency}`)), excluded, time, checks, completeness, warnings: [...new Set(warnings)], commercialStatus,
  };
}
