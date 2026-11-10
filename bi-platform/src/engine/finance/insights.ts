import type { EvidenceRow, Insight, Reliability } from '../types';
import { isComparisonBlocked } from '../analytics/periods';
import { reliabilityFor } from '../insights/helpers';
import { cpKey, cpLabel } from './keys';
import { daysPastDue, DUE_SOON_DAYS, LONG_OVERDUE_DAYS, MATCH_MIN, delayIn } from './ledger';
import type { FinanceModel } from './dashboard';
import type { FinanceUnavailable } from './metrics';

export type FinanceRuleUnavailable = FinanceUnavailable | 'nothing_found';
export interface FinanceAnalysis { insights: Insight[]; unavailable: { rule: string; reason: FinanceRuleUnavailable }[] }

type Draft = Omit<Insight, 'score' | 'module' | 'actionable'> & { actionable?: boolean };
const mk = (d: Draft): Insight => ({ ...d, module: 'debts', actionable: d.actionable ?? true, score: 0 });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const top = <T,>(xs: T[], n: number, by: (x: T) => number) => [...xs].sort((a, b) => by(b) - by(a)).slice(0, n);
const REL_W = { high: 1, medium: 0.7, low: 0.4 } as const;
const SEV_W = { risk: 1, opportunity: 0.9, info: 0.5 } as const;

function rank(all: Insight[], base: number): Insight[] {
  const scored = all.map((i) => {
    const rel = i.impact.unit === 'money' ? (base > 0 ? Math.min(1, i.impact.value / base) : 0.05) : Math.min(1, i.impact.value / 5) * 0.3;
    return { ...i, score: Math.round(Math.max(rel, i.certainty === 'possible' ? 0.02 : 0) * REL_W[i.reliability] * SEV_W[i.severity] * (i.actionable ? 1 : 0.6) * 10000) / 10000 };
  }).filter((i) => i.score > 0);
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const topics = new Set<string>();
  const out: Insight[] = [];
  for (const i of scored) { if (topics.has(i.topic)) continue; topics.add(i.topic); out.push(i); if (out.length >= 10) break; }
  return out;
}

export function analyzeFinancePeriod(m: FinanceModel): FinanceAnalysis {
  const out: Insight[] = [];
  const unavailable: FinanceAnalysis['unavailable'] = [];
  const skip = (rule: string, reason: FinanceRuleUnavailable) => unavailable.push({ rule, reason });
  const r = m.side === 'receivable' ? 'r' : 'p';
  const pos = m.cur.position;
  const prev = m.prev.position;
  const asOf = pos?.asOf ?? m.periods.current.to;
  const period = { asof: { date: asOf }, from: { date: m.periods.current.from }, to: { date: m.periods.current.to } };
  const total = Math.max(pos?.total ?? 0, 0);
  const dueOk = Boolean(pos && pos.source !== 'balance' && (pos.dueKnown === null || pos.dueKnown >= 0.8));
  const lineRel = (): { level: Reliability; reasonKey: string } => (pos?.source === 'open_item' ? reliabilityFor(pos.lines) : { level: 'medium', reasonKey: 'rel.agingSource' });
  const dim = m.side === 'receivable' ? 'customer' : 'supplier';
  const ev = (rows: { key?: string; label: string; current: number; previous?: number }[], unit: EvidenceRow['unit'] = 'money'): EvidenceRow[] => rows.map((x) => ({ key: x.key, label: x.label, current: x.current, previous: x.previous, unit }));

  // 1 ── largest overdue counterparties ─────────────────────────────────────────────────────────────────────
  if (!pos) skip('largest_overdue', 'no_position');
  else if (!dueOk) skip('largest_overdue', pos.source === 'balance' ? 'needs_due_dates' : 'due_dates_missing');
  else if (!pos.overdue || m.overdueRank.length === 0) skip('largest_overdue', 'nothing_found');
  else {
    const rel = lineRel();
    const rows = m.overdueRank;
    out.push(mk({
      id: 'finance.largest_overdue', topic: 'largest_overdue', group: 'overdue', severity: 'risk', certainty: 'fact', titleKey: `finance.largest_overdue.title_${r}`, bodyKey: `finance.largest_overdue.body_${r}`,
      actionKey: `finance.largest_overdue.action_${r}`, whyKey: 'finance.largest_overdue.why', dimension: dim, chart: 'overdueRank',
      params: { amount: { money: pos.overdue }, share: { pct: total > 0 ? pos.overdue / total : 0 }, name: rows[0]!.label, top: { money: rows[0]!.overdue }, top3: { pct: sum(rows.slice(0, 3).map((x) => x.overdue)) / pos.overdue }, count: pos.overdueCount ?? 0, ...period },
      reliability: rel.level, reliabilityReasonKey: rel.reasonKey, impact: { value: pos.overdue, unit: 'money' },
      evidence: ev(rows.slice(0, 5).map((x) => ({ key: x.key, label: x.label, current: x.overdue, previous: prev?.byCp.get(x.key)?.overdue ?? undefined }))),
    }));
  }

  // 2 ── rapidly growing overdue balance ─────────────────────────────────────────────────────────────────────
  const pOk = Boolean(prev && prev.source !== 'balance' && (prev.dueKnown === null || prev.dueKnown >= 0.8));
  if (!pos) skip('overdue_growth', 'no_position');
  else if (!prev || isComparisonBlocked(m.periods)) skip('overdue_growth', 'no_previous_snapshot');
  else if (!dueOk || !pOk) skip('overdue_growth', 'due_dates_missing');
  else {
    const cur = pos.overdue ?? 0, was = prev.overdue ?? 0;
    const delta = cur - was;
    if (delta < Math.max(1, 0.02 * Math.max(pos.total, 0)) || (was > 0 && delta / was < 0.25)) skip('overdue_growth', 'nothing_found');
    else {
      const grew = [...pos.byCp.entries()].map(([k, c]) => ({ key: k, label: c.label, cur: c.overdue ?? 0, prev: prev.byCp.get(k)?.overdue ?? 0 })).filter((x) => x.cur > x.prev).sort((a, b) => (b.cur - b.prev) - (a.cur - a.prev));
      const rel = lineRel();
      out.push(mk({
        id: 'finance.overdue_growth', topic: 'overdue_growth', group: 'overdue', severity: 'risk', certainty: 'fact', titleKey: 'finance.overdue_growth.title', bodyKey: `finance.overdue_growth.body_${r}`,
        actionKey: 'finance.overdue_growth.action', whyKey: 'finance.overdue_growth.why', dimension: dim, chart: 'overdueTrend',
        params: { pct: { pct: was > 0 ? delta / was : 1 }, current: { money: cur }, previous: { money: was }, delta: { money: delta }, name: grew[0]?.label ?? '', pasof: { date: prev.asOf }, ...period },
        reliability: rel.level, reliabilityReasonKey: rel.reasonKey, impact: { value: delta, unit: 'money' },
        evidence: ev(grew.slice(0, 5).map((x) => ({ key: x.key, label: x.label, current: x.cur, previous: x.prev }))),
      }));
    }
  }

  // 3 ── concentration ───────────────────────────────────────────────────────────────────────────────────────
  if (!pos) skip('concentration', 'no_position');
  else {
    const rows = [...pos.byCp.entries()].filter(([, c]) => c.outstanding > 0).sort((a, b) => b[1].outstanding - a[1].outstanding);
    const tot = sum(rows.map(([, c]) => c.outstanding));
    if (rows.length < 5 || tot <= 0) skip('concentration', 'few_counterparties');
    else {
      const s1 = rows[0]![1].outstanding / tot, s3 = sum(rows.slice(0, 3).map(([, c]) => c.outstanding)) / tot;
      if (s1 < 0.25 && s3 < 0.6) skip('concentration', 'nothing_found');
      else {
        const rel = lineRel();
        out.push(mk({
          id: 'finance.concentration', topic: 'concentration', group: 'structure', severity: s1 >= 0.4 ? 'risk' : 'info', certainty: 'indicator', titleKey: `finance.concentration.title_${r}`, bodyKey: `finance.concentration.body_${r}`,
          actionKey: `finance.concentration.action_${r}`, whyKey: 'finance.concentration.why', dimension: dim, chart: 'topCustomers',
          params: { name: rows[0]![1].label, share1: { pct: s1 }, share3: { pct: s3 }, value3: { money: sum(rows.slice(0, 3).map(([, c]) => c.outstanding)) }, count: rows.length, ...period },
          reliability: rel.level, reliabilityReasonKey: rel.reasonKey, impact: { value: sum(rows.slice(0, 3).map(([, c]) => c.outstanding)), unit: 'money' },
          evidence: ev(rows.slice(0, 5).map(([k, c]) => ({ key: k, label: c.label, current: c.outstanding, previous: prev?.byCp.get(k)?.outstanding }))),
        }));
      }
    }
  }

  // 4 ── long-overdue invoices ───────────────────────────────────────────────────────────────────────────────
  if (!pos) skip('long_overdue', 'no_position');
  else if (!dueOk) skip('long_overdue', pos.source === 'balance' ? 'needs_due_dates' : 'due_dates_missing');
  else if (!pos.over90) skip('long_overdue', 'nothing_found');
  else {
    const lines = pos.source === 'open_item' ? pos.recs.filter((x) => (x.outstanding ?? 0) > 0 && x.dueDate && daysPastDue(x.dueDate, pos.asOf) > LONG_OVERDUE_DAYS) : [];
    const rel = lineRel();
    out.push(mk({
      id: 'finance.long_overdue', topic: 'long_overdue', group: 'overdue', severity: 'risk', certainty: 'fact', titleKey: `finance.long_overdue.title_${r}`, bodyKey: `finance.long_overdue.body_${r}`,
      actionKey: `finance.long_overdue.action_${r}`, whyKey: 'finance.long_overdue.why', dimension: dim, chart: 'aging',
      params: { amount: { money: pos.over90 }, count: pos.over90Count ?? lines.length, share: { pct: total > 0 ? pos.over90 / total : 0 }, days: LONG_OVERDUE_DAYS, name: top(lines, 1, (x) => x.outstanding ?? 0)[0] ? cpLabel(top(lines, 1, (x) => x.outstanding ?? 0)[0]!) : '', ...period },
      reliability: rel.level, reliabilityReasonKey: rel.reasonKey, impact: { value: pos.over90, unit: 'money' },
      evidence: lines.length ? ev(top(lines, 5, (x) => x.outstanding ?? 0).map((x) => ({ key: cpKey(x), label: `${x.invoiceNo ?? '–'} · ${cpLabel(x)}`, current: x.outstanding! }))) : ev([...pos.byCp.entries()].filter(([, c]) => (c.over90 ?? 0) > 0).sort((a, b) => b[1].over90! - a[1].over90!).slice(0, 5).map(([k, c]) => ({ key: k, label: c.label, current: c.over90! }))),
    }));
  }

  // 5 ── credit notes that are not matched to a loaded invoice ───────────────────────────────────────────────
  const un = m.creditRows.filter((c) => c.status !== 'matched');
  const open = m.openCredits;
  if (m.creditRows.length === 0 && open.length === 0) skip('unmatched_credits', m.cur.unmatchedCredits ? 'nothing_found' : 'no_credit_register');
  else if (un.length === 0 && open.length === 0) skip('unmatched_credits', 'nothing_found');
  else {
    const amount = sum(un.map((c) => c.amount)) + sum(open.map((c) => -c.amount));
    const withCand = un.filter((c) => c.possible.length).length;
    out.push(mk({
      id: 'finance.unmatched_credits', topic: 'unmatched_credits', group: 'credits', severity: 'risk', certainty: 'fact', titleKey: 'finance.unmatched_credits.title', bodyKey: 'finance.unmatched_credits.body',
      actionKey: `finance.unmatched_credits.action_${r}`, whyKey: 'finance.unmatched_credits.why', dimension: dim, chart: 'creditReview',
      params: { count: un.length, amount: { money: sum(un.map((c) => c.amount)) }, noRef: un.filter((c) => c.status === 'no_reference').length, notFound: un.filter((c) => c.status === 'reference_not_found').length, possible: withCand, open: open.length, openAmount: { money: sum(open.map((c) => -c.amount)) }, ...period },
      reliability: 'high', reliabilityReasonKey: 'rel.inData', impact: { value: amount, unit: 'money' },
      evidence: [...ev(top(un, 4, (c) => c.amount).map((c) => ({ key: c.cp, label: `${c.rec.documentId ?? '–'} · ${c.label}`, current: c.amount }))), ...ev(open.slice(0, 2).map((c) => ({ label: `${c.no} · ${c.label}`, current: -c.amount })))],
    }));
  }

  // 6 ── possible duplicate payments (never a confirmed overpayment) ──────────────────────────────────────────
  if (!m.cur.dup) skip('duplicate_payments', 'no_payment_register');
  else {
    const g = m.dupAll.filter((x) => x.latest >= m.periods.current.from);
    if (g.length === 0) skip('duplicate_payments', 'nothing_found');
    else {
      const n = (t: string) => g.filter((x) => x.tier === t).length;
      const lines = sum(g.map((x) => x.payments.length));
      const rel = reliabilityFor(lines);
      out.push(mk({
        id: 'finance.duplicate_payments', topic: 'duplicate_payments', group: 'payments', severity: 'risk', certainty: 'possible', titleKey: 'finance.duplicate_payments.title', bodyKey: 'finance.duplicate_payments.body',
        actionKey: 'finance.duplicate_payments.action', whyKey: 'finance.duplicate_payments.why', dimension: dim, chart: 'duplicates',
        params: { count: g.length, amount: { money: sum(g.map((x) => x.excess)) }, exact: n('exact_repeat'), invoice: n('same_invoice'), over: n('overpaid'), like: n('lookalike'), name: g[0]!.label, ...period },
        reliability: rel.level === 'high' ? 'medium' : rel.level, reliabilityReasonKey: 'rel.possibleMatch', impact: { value: sum(g.map((x) => x.excess)), unit: 'money' },
        evidence: ev(g.slice(0, 5).map((x) => ({ key: x.cp, label: `${x.label} · ${x.payments.map((p) => p.rec.date).join(' / ')}`, current: x.excess }))),
      }));
    }
  }

  // 7 ── unusual payment delays ────────────────────────────────────────────────────────────────────────────
  const all = m.cur.delay;
  if (!m.cur.hasPayments) { skip('payment_delay', 'no_payment_register'); skip('behaviour_change', 'no_payment_register'); }
  else if (all.n < MATCH_MIN || all.avg === null) { skip('payment_delay', 'few_matches'); skip('behaviour_change', 'few_matches'); }
  else {
    const flagged = m.behaviour.filter((b) => b.cur.n >= 3 && b.cur.avg !== null && b.cur.avg >= Math.max(10, all.avg! + 10));
    if (flagged.length === 0) skip('payment_delay', 'nothing_found');
    else {
      const rel = reliabilityFor(sum(flagged.map((b) => b.cur.n)) * 2);
      const atRisk = sum(flagged.map((b) => pos?.byCp.get(b.key)?.outstanding ?? 0));
      out.push(mk({
        id: 'finance.payment_delay', topic: 'payment_delay', group: 'behaviour', severity: 'risk', certainty: 'indicator', titleKey: `finance.payment_delay.title_${r}`, bodyKey: `finance.payment_delay.body_${r}`,
        actionKey: `finance.payment_delay.action_${r}`, whyKey: 'finance.payment_delay.why', dimension: dim, chart: 'behaviour',
        params: { count: flagged.length, avg: { qty: all.avg }, name: flagged[0]!.label, worst: { qty: flagged[0]!.cur.avg! }, min: MATCH_MIN, ...period },
        reliability: rel.level === 'high' ? 'medium' : rel.level, reliabilityReasonKey: 'rel.matchedPayments', impact: atRisk > 0 ? { value: atRisk, unit: 'money' } : { value: flagged.length, unit: 'qty' },
        evidence: ev(flagged.slice(0, 5).map((b) => ({ key: b.key, label: b.label, current: b.cur.avg!, previous: all.avg! })), 'qty'),
      }));
    }
    // 9 ── changes in payment behaviour ──
    const changed = m.behaviour.filter((b) => b.change !== null && Math.abs(b.change) >= 7).sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!));
    if (changed.length === 0) skip('behaviour_change', 'nothing_found');
    else {
      const worse = changed.filter((b) => b.change! > 0);
      const atRisk = sum(worse.map((b) => pos?.byCp.get(b.key)?.outstanding ?? 0));
      out.push(mk({
        id: 'finance.behaviour_change', topic: 'behaviour_change', group: 'behaviour', severity: worse.length ? 'risk' : 'info', certainty: 'indicator', titleKey: `finance.behaviour_change.title_${r}`, bodyKey: `finance.behaviour_change.body_${r}`,
        actionKey: `finance.behaviour_change.action_${r}`, whyKey: 'finance.behaviour_change.why', dimension: dim, chart: 'behaviour',
        params: { count: changed.length, worse: worse.length, name: changed[0]!.label, change: { qty: Math.abs(changed[0]!.change!) }, prevAvg: { qty: changed[0]!.prev.avg! }, curAvg: { qty: changed[0]!.cur.avg! }, ...period },
        reliability: 'medium', reliabilityReasonKey: 'rel.matchedPayments', impact: atRisk > 0 ? { value: atRisk, unit: 'money' } : { value: changed.length, unit: 'qty' },
        evidence: ev(changed.slice(0, 5).map((b) => ({ key: b.key, label: b.label, current: b.cur.avg!, previous: b.prev.avg! })), 'qty'),
      }));
    }
  }

  // 8 ── amounts approaching their due date ────────────────────────────────────────────────────────────────
  if (!pos) skip('due_soon', 'no_position');
  else if (pos.source !== 'open_item') skip('due_soon', 'needs_open_items');
  else if (!dueOk) skip('due_soon', 'due_dates_missing');
  else if (!pos.dueSoon) skip('due_soon', 'nothing_found');
  else {
    const by = new Map<string, { label: string; amount: number }>();
    for (const x of pos.recs) {
      if ((x.outstanding ?? 0) <= 0 || !x.dueDate) continue;
      const d = daysPastDue(x.dueDate, pos.asOf);
      if (d > 0 || d < -DUE_SOON_DAYS) continue;
      const e = by.get(cpKey(x)) ?? { label: cpLabel(x) || '—', amount: 0 };
      e.amount += x.outstanding!;
      by.set(cpKey(x), e);
    }
    const rows = [...by.entries()].sort((a, b) => b[1].amount - a[1].amount);
    const rel = lineRel();
    out.push(mk({
      id: 'finance.due_soon', topic: 'due_soon', group: 'cash', severity: m.side === 'payable' ? 'risk' : 'info', certainty: 'fact', titleKey: `finance.due_soon.title_${r}`, bodyKey: `finance.due_soon.body_${r}`,
      actionKey: `finance.due_soon.action_${r}`, whyKey: 'finance.due_soon.why', dimension: dim, chart: 'dueTimeline',
      params: { amount: { money: pos.dueSoon }, count: pos.dueSoonCount ?? 0, days: DUE_SOON_DAYS, name: rows[0]?.[1].label ?? '', overdue: { money: pos.overdue ?? 0 }, ...period },
      reliability: rel.level, reliabilityReasonKey: rel.reasonKey, impact: { value: pos.dueSoon, unit: 'money' },
      evidence: ev(rows.slice(0, 5).map(([k, e]) => ({ key: k, label: e.label, current: e.amount }))),
    }));
  }

  // 10 ── working capital: cash that is already due (possible, not guaranteed) ─────────────────────────────────
  if (m.side !== 'receivable') skip('working_capital', 'nothing_found');
  else if (!pos) skip('working_capital', 'no_position');
  else if (!dueOk || !pos.buckets) skip('working_capital', pos.source === 'balance' ? 'needs_due_dates' : 'due_dates_missing');
  else {
    const late = pos.buckets.d60 + pos.buckets.d90 + pos.buckets.d90p;
    if (late <= 0) skip('working_capital', 'nothing_found');
    else {
      const rel = lineRel();
      const pay = m.overview.payable;
      out.push(mk({
        id: 'finance.working_capital', topic: 'working_capital', group: 'cash', severity: 'opportunity', certainty: 'possible', titleKey: 'finance.working_capital.title', bodyKey: pay ? 'finance.working_capital.body_net' : 'finance.working_capital.body',
        actionKey: 'finance.working_capital.action', whyKey: 'finance.working_capital.why', dimension: dim, chart: 'aging',
        params: { amount: { money: late }, share: { pct: total > 0 ? late / total : 0 }, payables: { money: pay?.outstanding ?? 0 }, net: { money: m.overview.net ?? 0 }, ...period },
        reliability: rel.level === 'high' ? 'medium' : rel.level, reliabilityReasonKey: 'rel.possibleCollection', impact: { value: late, unit: 'money' },
        evidence: ev([{ label: '31–60', current: pos.buckets.d60 }, { label: '61–90', current: pos.buckets.d90 }, { label: '90+', current: pos.buckets.d90p }]),
      }));
    }
  }
  void delayIn;
  return { insights: rank(out, total), unavailable };
}
