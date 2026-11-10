'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLang } from '../LangProvider';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { EvidencePanel, StatusBadge } from '../trust/EvidencePanel';
import { engine } from '@/lib/engineClient';
import type { ExecutiveResult } from '@/lib/engineSession';
import { getDb } from '@/db/db';
import { clearReview, deleteMissed, saveMissed, savePilotMeta, saveReview } from '@/db/store';
import { DECISIONS, emptyMeta, type Decision, type Missed, type PilotMeta, type Review } from '@/engine/pilot/types';
import type { PilotImport } from '@/engine/pilot/metrics';
import { buildPilotHtml, flatten, mask, metricsOf, pilotLedgerCsv, type PilotData } from '@/lib/pilotReport';
import { downloadText } from '@/lib/download';
import { findingTitle } from '@/lib/evidence';
import { withheldText } from '@/lib/executiveSummary';
import { money, num, type MessageKey } from '@/i18n';
import type { TrustFinding } from '@/engine/trust/types';

const field = 'mt-1 w-full rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900';
const numOrNull = (s: string) => (s.trim() === '' || Number.isNaN(Number(s.replace(',', '.'))) ? null : Number(s.replace(',', '.')));
const newId = () => `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The minimal interface to conduct and review the pilot: coverage, warnings, findings awaiting verification, decisions, known misses, withheld conclusions, completeness and qualified results. */
export function PilotView({ version, goImport, onChanged }: { version: number; goImport: () => void; onChanged: () => void }) {
  const { t, lang } = useLang();
  const [exec, setExec] = useState<ExecutiveResult | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [missed, setMissed] = useState<Missed[]>([]);
  const [meta, setMeta] = useState<PilotMeta>(emptyMeta());
  const [imports, setImports] = useState<PilotImport[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [filterAll, setFilterAll] = useState(false);
  const [redact, setRedact] = useState(true);
  const [saved, setSaved] = useState(false);
  const reload = useCallback(() => { setTick((x) => x + 1); onChanged(); }, [onChanged]);

  useEffect(() => {
    let alive = true;
    engine().call('buildExecutive', [{ version }]).then((r) => alive && setExec(r)).catch(() => undefined);
    const db = getDb();
    void Promise.all([db.reviews.toArray(), db.missed.toArray(), db.pilot.get('meta'), db.imports.toArray()]).then(([r, m, pm, im]) => {
      if (!alive) return;
      setReviews(r); setMissed(m); setMeta(pm ?? emptyMeta());
      setNames(Object.fromEntries(im.map((x) => [x.id, x.fileName])));
      setImports(im.filter((x) => x.module === 'finance').map((x): PilotImport => ({ fileName: x.fileName, financeKind: x.financeKind, financeSide: x.financeSide, dateMin: x.stats.dateMin, dateMax: x.stats.dateMax, added: x.added, importedAt: x.importedAt, warnings: Object.values(x.stats.warnings).reduce((s, n) => s + (n ?? 0), 0), errors: Object.values(x.stats.errors).reduce((s, n) => s + (n ?? 0), 0) })));
    });
    return () => { alive = false; };
  }, [version, tick]);

  // the pilot is a SUPPLIER-side validation: receivable findings are out of scope
  const trust = (exec?.model.trust ?? []).filter((r) => r.side === 'payable');
  const data: PilotData = useMemo(() => ({ ...flatten(trust), reviews, missed, meta, imports, withheldOther: exec?.model.withheld.length ?? 0 }), [trust, reviews, missed, meta, imports, exec]);
  const m = useMemo(() => metricsOf(data), [data]);
  const all = useMemo(() => trust.flatMap((r) => r.findings.map((f) => ({ f, r }))), [trust]);
  const reviewOf = (id: string) => reviews.find((x) => x.id === id);
  const shown = all.filter(({ f }) => f.status !== 'withheld' && (filterAll || (reviewOf(f.id)?.decision ?? 'not_reviewed') === 'not_reviewed'));
  const label = (s: string) => (redact ? mask(s) : s);
  const cur = (c: string, n: number) => money(n, { lang, currency: c });
  const setM = (p: Partial<PilotMeta>) => { setMeta((x) => ({ ...x, ...p })); setSaved(false); };

  if (!exec) return <p className="text-sm text-slate-500" data-testid="computing">{t('dash.computing')}</p>;
  const supplierKinds = ['invoices', 'credit_notes', 'payments', 'open_items'];

  return (
    <div className="space-y-6" data-testid="pilot-view" data-status={m.commercialStatus}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('pilot.title')}</h1>
        <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-400">{t('pilot.subtitle')}</p>
      </div>

      <Card className={m.commercialStatus === 'not_started' ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/30' : ''} data-testid="pilot-status">
        <div className="text-xs font-medium text-slate-500">{t('pilot.statusLabel')}</div>
        <div className="text-xl font-bold" data-testid="pilot-status-value">{t(`pilot.status.${m.commercialStatus}` as MessageKey)}</div>
        <p className="text-sm text-slate-600 dark:text-slate-400">{t(`pilot.status.d.${m.commercialStatus}` as MessageKey)}</p>
        {!meta.realDataAttested && <p className="mt-1 text-sm font-medium text-amber-800 dark:text-amber-300">{t('pilot.warn.not_real_data')}</p>}
      </Card>

      <section className="space-y-2" data-testid="pilot-datasets">
        <h2 className="text-lg font-semibold">{t('pilot.sec.datasets')}</h2>
        <Card className="space-y-2">
          <ul className="space-y-1 text-sm">
            {supplierKinds.map((k) => {
              const xs = imports.filter((i) => i.financeKind === k && i.financeSide === 'payable' && i.added > 0);
              return <li key={k} className="flex flex-wrap items-center gap-2" data-testid={`pilot-ds-${k}`} data-present={xs.length > 0}>
                <Badge tone={xs.length ? 'opportunity' : 'risk'}>{xs.length ? '✓' : t('pilot.ds.missing')}</Badge><b>{t(`pilot.ds.kind.${k}` as MessageKey)}</b>
                {xs.map((x, i) => <span key={i} className="text-xs text-slate-500">{t('pilot.ds.rows', { n: x.added })} · {x.dateMin && x.dateMax ? t('pilot.ds.period', { from: { date: x.dateMin }, to: { date: x.dateMax } }) : ''} · {t('pilot.ds.warn', { w: x.warnings, e: x.errors })}</span>)}
              </li>;
            })}
            {imports.some((i) => i.financeSide === 'receivable') && <li className="text-xs text-slate-500">{t('pilot.ds.receivable')}</li>}
          </ul>
          {imports.length === 0 && <div><p className="text-sm text-slate-500">{t('pilot.ds.none')}</p><Button size="sm" onClick={goImport}>{t('exe.goImport')}</Button></div>}
        </Card>
        <Card data-testid="pilot-warnings"><div className="text-sm font-medium">{t('pilot.sec.warnings')}</div>
          {imports.reduce((s, i) => s + i.warnings + i.errors, 0) === 0 ? <p className="text-sm text-slate-500">{t('pilot.warn.none')}</p> : <p className="text-sm text-amber-800 dark:text-amber-300">{t('pilot.warn.imports')} ({imports.reduce((s, i) => s + i.warnings, 0)} / {imports.reduce((s, i) => s + i.errors, 0)})</p>}
          {m.warnings.length > 0 && <ul className="mt-1 list-disc pl-5 text-sm text-amber-800 dark:text-amber-300">{m.warnings.map((w) => <li key={w}>{t(`pilot.warn.${w}` as MessageKey)}</li>)}</ul>}
        </Card>
      </section>

      <section className="space-y-2" data-testid="pilot-facts">
        <h2 className="text-lg font-semibold">{t('pilot.sec.facts')}</h2>
        <Card className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">{t('pilot.f.org')}<input data-testid="pf-org" className={field} value={meta.organisation} onChange={(e) => setM({ organisation: e.target.value })} /></label>
          <label className="text-sm">{t('pilot.f.reviewer')}<input data-testid="pf-reviewer" className={field} value={meta.reviewer} onChange={(e) => setM({ reviewer: e.target.value })} /></label>
          <label className="text-sm">{t('pilot.f.from')}<input type="date" data-testid="pf-from" className={field} value={meta.periodFrom} onChange={(e) => setM({ periodFrom: e.target.value })} /></label>
          <label className="text-sm">{t('pilot.f.to')}<input type="date" data-testid="pf-to" className={field} value={meta.periodTo} onChange={(e) => setM({ periodTo: e.target.value })} /></label>
          <label className="text-sm">{t('pilot.f.snapDate')}<input type="date" data-testid="pf-snapdate" className={field} value={meta.snapshotDate} onChange={(e) => setM({ snapshotDate: e.target.value })} /></label>
          <label className="text-sm">{t('pilot.f.snapSource')}<input data-testid="pf-snapsrc" className={field} value={meta.snapshotSource} onChange={(e) => setM({ snapshotSource: e.target.value })} /></label>
          <label className="text-sm">{t('pilot.f.baseline')}<input data-testid="pf-baseline" inputMode="decimal" className={field} value={meta.baselineMinutes ?? ''} onChange={(e) => setM({ baselineMinutes: numOrNull(e.target.value) })} /></label>
          <label className="text-sm">{t('pilot.f.prep')}<input data-testid="pf-prep" inputMode="decimal" className={field} value={meta.prepMinutes ?? ''} onChange={(e) => setM({ prepMinutes: numOrNull(e.target.value) })} /></label>
          <label className="text-sm sm:col-span-2">{t('pilot.f.baselineNote')}<input data-testid="pf-bnote" className={field} value={meta.baselineNote} onChange={(e) => setM({ baselineNote: e.target.value })} /></label>
          <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" data-testid="pf-real" className="mt-1" checked={meta.realDataAttested} onChange={(e) => setM({ realDataAttested: e.target.checked })} />{t('pilot.f.real')}</label>
          <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" data-testid="pf-complete" className="mt-1" checked={meta.missedListComplete} onChange={(e) => setM({ missedListComplete: e.target.checked })} />{t('pilot.f.complete')}</label>
          <div className="flex items-center gap-3 sm:col-span-2"><Button size="sm" data-testid="pf-save" onClick={async () => { await savePilotMeta(getDb(), meta); setSaved(true); reload(); }}>{t('pilot.f.save')}</Button>{saved && <span className="text-sm text-emerald-700" data-testid="pf-saved">{t('pilot.f.saved')}</span>}</div>
        </Card>
      </section>

      <section className="space-y-2" data-testid="pilot-findings">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{t('pilot.sec.findings')}</h2>
          <div className="flex gap-1 text-sm">{[false, true].map((a) => <button key={String(a)} onClick={() => setFilterAll(a)} aria-pressed={filterAll === a} data-testid={`pf-filter-${a ? 'all' : 'awaiting'}`} className={`rounded-md border px-2 py-1 ${filterAll === a ? 'bg-indigo-600 text-white' : 'border-slate-300 dark:border-slate-700'}`}>{t(a ? 'pilot.fi.filter.all' : 'pilot.fi.filter.awaiting')}</button>)}</div></div>
        <p className="text-xs text-slate-500">{t('pilot.fi.showing', { n: Math.min(shown.length, 50), total: shown.length })}</p>
        {shown.length === 0 ? <p className="text-sm text-slate-500" data-testid="pf-none">{t('pilot.fi.none')}</p> : (
          <ul className="space-y-2">{shown.slice(0, 50).map(({ f, r }) => <FindingRow key={f.id} f={f} currency={r.currency} review={reviewOf(f.id)} open={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)} label={label(f.label)} names={names} reviewer={meta.reviewer} side={r.side} onSaved={reload} />)}</ul>
        )}
      </section>

      <section className="space-y-2" data-testid="pilot-missed">
        <h2 className="text-lg font-semibold">{t('pilot.sec.missed')}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{t('pilot.ms.intro')}</p>
        <MissedForm findings={all.map((x) => x.f)} onAdd={async (x) => { await saveMissed(getDb(), x); reload(); }} />
        {missed.length === 0 ? <p className="text-sm text-slate-500">{t('pilot.ms.empty')}</p> : (
          <ul className="space-y-1 text-sm" data-testid="pilot-missed-list">{missed.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2" data-found={Boolean(x.findingId)}><Badge tone={x.findingId ? 'opportunity' : 'risk'}>{t(x.findingId ? 'pilot.ms.found' : 'pilot.ms.missed')}</Badge>{x.description}{x.amount !== null && ` – ${cur(x.currency || 'EUR', x.amount)}`}{x.reason && <span className="text-xs text-slate-500">({x.reason})</span>}<button className="text-xs text-indigo-700 underline" onClick={async () => { await deleteMissed(getDb(), x.id); reload(); }}>{t('pilot.ms.remove')}</button></li>)}</ul>
        )}
      </section>

      <section className="space-y-2" data-testid="pilot-withheld">
        <h2 className="text-lg font-semibold">{t('pilot.sec.withheld')} ({exec.model.withheld.length + all.filter(({ f }) => f.status === 'withheld').length})</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-400">
          {all.filter(({ f }) => f.status === 'withheld').slice(0, 20).map(({ f, r }) => <li key={f.id}>{findingTitle(f, lang)}</li>)}
          {exec.model.withheld.slice(0, 20).map((w, i) => <li key={i}>{withheldText(w, lang)}</li>)}
        </ul>
      </section>

      <section className="space-y-2" data-testid="pilot-results">
        <h2 className="text-lg font-semibold">{t('pilot.sec.results')}</h2>
        <Card className="space-y-2 text-sm">
          <p data-testid="pr-counts">{t('pilot.res.counts', { total: m.findings.total, reviewable: m.findings.reviewable, withheld: m.findings.withheld, confirmed: m.review.confirmed, fp: m.review.falsePositive, inc: m.review.inconclusive, awaiting: m.review.awaiting })}</p>
          <div><b>{t('pilot.res.precision')}:</b> <span data-testid="pr-precision">{m.precision.value === null ? t('pilot.res.precision.none') : t('pilot.res.precision.value', { confirmed: m.precision.confirmed, decided: m.precision.decided })}</span>{m.precision.indicative && m.precision.value !== null && <div className="text-xs text-amber-800 dark:text-amber-300">{t('pilot.res.precision.indicative')}</div>}{!meta.realDataAttested && m.precision.value !== null && <div className="text-xs text-amber-800 dark:text-amber-300">{t('pilot.res.precision.notreal')}</div>}</div>
          <div><b>{t('pilot.res.recall')}:</b> <span data-testid="pr-recall">{m.recall.value === null ? t(`pilot.res.recall.${m.recall.reason}` as MessageKey) : t('pilot.res.recall.value', { found: m.recall.found, known: m.recall.known })}</span></div>
        </Card>
        <Card className="space-y-2" data-testid="pilot-tiers"><CardTitle className="text-base">{t('pilot.tier.title')}</CardTitle><p className="text-xs text-slate-500">{t('pilot.tier.never')}</p>
          {m.tiers.length === 0 ? <p className="text-sm text-slate-500">{t('pilot.rep.noValue')}</p> : m.tiers.map((x) => (
            <div key={`${x.side}${x.currency}`} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800" data-testid="pilot-tier" data-currency={x.currency} data-side={x.side}>
              <div className="mb-1 text-xs font-semibold text-slate-500">{t(`trust.find.side.${x.side}` as MessageKey)} · {x.currency}</div>
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">{(['exposure', 'confirmed', 'recoverable', 'recovered', 'prevented'] as const).map((k) => { const v = { exposure: x.exposure, confirmed: x.confirmedDiscrepancy, recoverable: x.recoverable, recovered: x.recovered, prevented: x.prevented }[k]; return <div key={k}><dt className="text-xs text-slate-500" title={t(`pilot.tier.d.${k}` as MessageKey)}>{t(`pilot.tier.${k}` as MessageKey)}</dt><dd className="font-semibold tabular-nums" data-testid={`tier-${k}`}>{cur(x.currency, v)}</dd></div>; })}</dl>
            </div>
          ))}
          {(m.excluded.recoveredWithoutEvidence > 0 || m.excluded.preventedWithoutEvidence > 0) && <p className="text-xs text-amber-800 dark:text-amber-300">{t('pilot.tier.excluded', { rec: num(m.excluded.recoveredWithoutEvidence, lang), prev: num(m.excluded.preventedWithoutEvidence, lang) })}</p>}
        </Card>
        <Card className="space-y-1 text-sm" data-testid="pilot-time"><CardTitle className="text-base">{t('pilot.time.title')}</CardTitle>
          <p>{m.time.reviewed ? t('pilot.time.verification', { min: num(m.time.verificationMinutes, lang), n: m.time.reviewed, avg: m.time.avgMinutes !== null ? t('pilot.time.avg', { avg: num(Math.round(m.time.avgMinutes * 10) / 10, lang) }) : '' }) : t('pilot.time.none')}</p>
          {m.time.baselineMinutes !== null && <p>{t('pilot.time.baseline', { min: num(m.time.baselineMinutes, lang), prep: m.time.prepMinutes === null ? '–' : num(m.time.prepMinutes, lang) })}</p>}
          <p data-testid="pilot-saved">{m.time.savedMinutes !== null ? t('pilot.time.saved', { min: num(m.time.savedMinutes, lang) }) : t(`pilot.time.saved.${m.time.savedReason}` as MessageKey)}</p>
        </Card>
      </section>

      <section className="space-y-2" data-testid="pilot-completeness">
        <h2 className="text-lg font-semibold">{t('pilot.sec.completeness')} – <span data-testid="pilot-pct">{Math.round(m.completeness * 100)}%</span></h2>
        <Card><ul className="space-y-1 text-sm">{m.checks.map((c) => <li key={c.id} data-testid={`check-${c.id}`} data-ok={c.ok} className="flex flex-wrap gap-2"><Badge tone={c.ok ? 'opportunity' : 'warn'}>{c.ok ? '✓' : '–'}</Badge>{t(`pilot.check.${c.id}` as MessageKey)}{c.params && ['snapshot', 'period', 'findings_reviewed'].includes(c.id) && <span className="text-xs text-slate-500">{t(`pilot.check.${c.id}.d` as MessageKey, c.params)}</span>}</li>)}</ul></Card>
      </section>

      <section className="space-y-2" data-testid="pilot-export">
        <h2 className="text-lg font-semibold">{t('pilot.sec.export')}</h2>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={redact} onChange={(e) => setRedact(e.target.checked)} data-testid="pilot-redact" />{t('pilot.export.redact')}</label>
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" data-testid="pilot-export-html" onClick={() => downloadText('pilot-report.html', 'text/html', buildPilotHtml(data, lang, redact))}>{t('pilot.export.html')}</Button><Button variant="outline" size="sm" data-testid="pilot-export-csv" onClick={() => downloadText('pilot-review-ledger.csv', 'text/csv', pilotLedgerCsv(data, lang, redact))}>{t('pilot.export.csv')}</Button></div>
      </section>
    </div>
  );
}

function FindingRow({ f, currency, side, review, open, onToggle, label, names, reviewer, onSaved }: { f: TrustFinding; currency: string; side: 'receivable' | 'payable'; review?: Review; open: boolean; onToggle: () => void; label: string; names: Record<string, string>; reviewer: string; onSaved: () => void }) {
  const { t, lang } = useLang();
  const [d, setD] = useState<Decision>(review?.decision ?? 'confirmed');
  const [v, setV] = useState({ recon: review?.reconciliation ?? '', reason: review?.reason ?? '', conf: review?.confirmedDiscrepancy?.toString() ?? '', recble: review?.recoverable?.toString() ?? '', recd: review?.recovered?.toString() ?? '', recdEv: review?.recoveredEvidence ?? '', prev: review?.prevented?.toString() ?? '', prevEv: review?.preventedEvidence ?? '', min: review?.minutes?.toString() ?? '' });
  const set = (k: keyof typeof v, x: string) => setV((p) => ({ ...p, [k]: x }));
  const save = async () => {
    const r: Review = { id: f.id, decision: d, category: f.rule, side, evidenceStatus: f.status, calculatedAmount: f.exposure?.amount ?? null, currency, reconciliation: v.recon, reason: v.reason, confirmedDiscrepancy: numOrNull(v.conf), recoverable: numOrNull(v.recble), recovered: numOrNull(v.recd), recoveredEvidence: v.recdEv, prevented: numOrNull(v.prev), preventedEvidence: v.prevEv, minutes: numOrNull(v.min), reviewer, reviewedAt: Date.now() };
    await saveReview(getDb(), r); onSaved();
  };
  const dec = review?.decision ?? 'not_reviewed';
  return (
    <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-800" data-testid="pilot-finding" data-decision={dec} data-id={f.id}>
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={f.status} /><b>{t(`trust.rule.${f.rule}` as MessageKey)}</b><span>{label}</span>{f.exposure && <span className="tabular-nums">{t('pilot.fi.exposure')}: {money(f.exposure.amount, { lang, currency })}</span>}<Badge tone={dec === 'confirmed' ? 'opportunity' : dec === 'false_positive' ? 'risk' : dec === 'inconclusive' ? 'warn' : 'neutral'} data-testid="pf-decision">{t(`pilot.decision.${dec}` as MessageKey)}</Badge>
        <Button size="sm" variant="ghost" onClick={onToggle} data-testid="pf-open">{open ? t('pilot.fi.close') : t('pilot.fi.open')}</Button></div>
      {open && (
        <div className="mt-3 space-y-3">
          <EvidencePanel dossier={f} title={findingTitle(f, lang)} fileNames={names} currency={currency} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">{t('pilot.fi.decision')}<select data-testid="pf-dec" className={field} value={d} onChange={(e) => setD(e.target.value as Decision)}>{DECISIONS.map((x) => <option key={x} value={x}>{t(`pilot.decision.${x}` as MessageKey)}</option>)}</select></label>
            <label className="text-sm">{t('pilot.fi.minutes')}<input data-testid="pf-min" inputMode="decimal" className={field} value={v.min} onChange={(e) => set('min', e.target.value)} /></label>
            <label className="text-sm sm:col-span-2">{t('pilot.fi.recon')}<textarea data-testid="pf-recon" className={field} rows={2} value={v.recon} onChange={(e) => set('recon', e.target.value)} /></label>
            <label className="text-sm sm:col-span-2">{t('pilot.fi.reason')}<textarea data-testid="pf-reason" className={field} rows={2} value={v.reason} onChange={(e) => set('reason', e.target.value)} /></label>
            <label className="text-sm">{t('pilot.fi.confirmed')}<input data-testid="pf-conf" inputMode="decimal" className={field} value={v.conf} onChange={(e) => set('conf', e.target.value)} /></label>
            <label className="text-sm">{t('pilot.fi.recoverable')}<input data-testid="pf-recble" inputMode="decimal" className={field} value={v.recble} onChange={(e) => set('recble', e.target.value)} /></label>
            <label className="text-sm">{t('pilot.fi.recovered')}<input data-testid="pf-recd" inputMode="decimal" className={field} value={v.recd} onChange={(e) => set('recd', e.target.value)} /></label>
            <label className="text-sm">{t('pilot.fi.recoveredEv')}<input data-testid="pf-recdev" className={field} value={v.recdEv} onChange={(e) => set('recdEv', e.target.value)} /></label>
            <label className="text-sm">{t('pilot.fi.prevented')}<input data-testid="pf-prev" inputMode="decimal" className={field} value={v.prev} onChange={(e) => set('prev', e.target.value)} /></label>
            <label className="text-sm">{t('pilot.fi.preventedEv')}<input data-testid="pf-prevev" className={field} value={v.prevEv} onChange={(e) => set('prevEv', e.target.value)} /></label>
          </div>
          <div className="flex gap-2"><Button size="sm" data-testid="pf-savereview" onClick={() => void save()}>{t('pilot.fi.save')}</Button>{review && <Button size="sm" variant="outline" onClick={async () => { await clearReview(getDb(), f.id); onSaved(); }}>{t('pilot.fi.clear')}</Button>}</div>
        </div>
      )}
    </li>
  );
}

function MissedForm({ findings, onAdd }: { findings: TrustFinding[]; onAdd: (m: Missed) => Promise<void> }) {
  const { t, lang } = useLang();
  const [v, setV] = useState({ desc: '', cat: 'duplicate_payment', amount: '', cur: 'EUR', refs: '', finding: '', reason: '' });
  const set = (k: keyof typeof v, x: string) => setV((p) => ({ ...p, [k]: x }));
  return (
    <Card className="grid gap-3 sm:grid-cols-2" data-testid="missed-form">
      <label className="text-sm sm:col-span-2">{t('pilot.ms.desc')}<input data-testid="ms-desc" className={field} value={v.desc} onChange={(e) => set('desc', e.target.value)} /></label>
      <label className="text-sm">{t('pilot.ms.category')}<select data-testid="ms-cat" className={field} value={v.cat} onChange={(e) => set('cat', e.target.value)}>{['unapplied_credit', 'duplicate_payment', 'overpayment', 'unmatched_payment'].map((c) => <option key={c} value={c}>{t(`trust.rule.${c}` as MessageKey)}</option>)}</select></label>
      <label className="text-sm">{t('pilot.ms.amount')}<input data-testid="ms-amount" inputMode="decimal" className={field} value={v.amount} onChange={(e) => set('amount', e.target.value)} /></label>
      <label className="text-sm">{t('pilot.ms.currency')}<input data-testid="ms-cur" className={field} value={v.cur} onChange={(e) => set('cur', e.target.value.toUpperCase())} /></label>
      <label className="text-sm">{t('pilot.ms.refs')}<input data-testid="ms-refs" className={field} value={v.refs} onChange={(e) => set('refs', e.target.value)} /></label>
      <label className="text-sm">{t('pilot.ms.finding')}<select data-testid="ms-finding" className={field} value={v.finding} onChange={(e) => set('finding', e.target.value)}><option value="">{t('pilot.ms.none')}</option>{findings.filter((f) => f.status !== 'withheld').slice(0, 200).map((f) => <option key={f.id} value={f.id}>{t(`trust.rule.${f.rule}` as MessageKey)} · {f.exposure ? num(f.exposure.amount, lang) : ''}</option>)}</select></label>
      <label className="text-sm">{t('pilot.ms.reason')}<input data-testid="ms-reason" className={field} value={v.reason} onChange={(e) => set('reason', e.target.value)} /></label>
      <div className="sm:col-span-2"><Button size="sm" data-testid="ms-add" disabled={!v.desc.trim()} onClick={async () => { await onAdd({ id: newId(), description: v.desc.trim(), category: v.cat, amount: numOrNull(v.amount), currency: v.cur, sourceRefs: v.refs, findingId: v.finding, reason: v.reason, addedAt: Date.now() }); setV({ desc: '', cat: v.cat, amount: '', cur: v.cur, refs: '', finding: '', reason: '' }); }}>{t('pilot.ms.add')}</Button></div>
    </Card>
  );
}
