'use client';
import { useState } from 'react';
import { useLang } from '../LangProvider';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { EvidencePanel, StatusBadge } from './EvidencePanel';
import { downloadText } from '@/lib/download';
import { evidenceCsv, findingTitle } from '@/lib/evidence';
import type { SettlementResult, TrustFinding } from '@/engine/trust/types';
import { money, type MessageKey } from '@/i18n';

const LIMIT = 40;

/** Settlement findings (unapplied credits, possible duplicate / over-payments, unmatched payments), classified by evidence, with a non-overlapping exposure total per currency. */
export function TrustFindings({ results, fileNames = {}, testid = 'trust-findings' }: { results: SettlementResult[]; fileNames?: Record<string, string>; testid?: string }) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const shown = results.filter((r) => r.findings.length || r.reconciled.length);
  const all = results.flatMap((r) => r.findings.map((f) => ({ f, r })));
  const live = all.filter(({ f }) => f.status !== 'withheld');
  const withheld = all.filter(({ f }) => f.status === 'withheld');
  const exportAll = () => downloadText('evidence-all.csv', 'text/csv', evidenceCsv(all.map(({ f }) => ({ title: findingTitle(f, lang), dossier: f })), lang, fileNames));

  const card = (f: TrustFinding, r: SettlementResult) => (
    <li key={f.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800" data-testid="trust-finding" data-rule={f.rule} data-status={f.status} data-state={f.state ?? ''} data-currency={r.currency}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={f.status} />
        <Badge tone="neutral">{t(`trust.find.side.${f.side}` as MessageKey)} · {r.currency}</Badge>
        <b>{t(`trust.rule.${f.rule}` as MessageKey)}</b>{f.label !== '—' && <span>– {f.label}</span>}
        {f.state && <span className="text-xs text-slate-500">({t(`trust.state.${f.state}` as MessageKey)})</span>}
      </div>
      {f.exposure ? <div className="mt-1 text-sm"><span className="font-semibold tabular-nums" data-testid="trust-amount">{money(f.exposure.amount, { lang, currency: r.currency })}</span> <span className="text-slate-500">{t(`trust.exposure.${f.exposure.kind}` as MessageKey)}</span></div> : null}
      <Button size="sm" variant="ghost" className="mt-1" onClick={() => setOpen(open === f.id ? null : f.id)} aria-expanded={open === f.id} data-testid="trust-open">{t('trust.find.openEvidence')} ({t('trust.find.records', { n: f.records.length })})</Button>
      {open === f.id && <div className="mt-2"><EvidencePanel dossier={f} title={findingTitle(f, lang)} fileNames={fileNames} currency={r.currency} /></div>}
    </li>
  );
  return (
    <section className="space-y-3" data-testid={testid}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{t('trust.find.title')}</h2>{all.length > 0 && <Button size="sm" variant="outline" onClick={exportAll} data-testid="trust-export-all">{t('trust.panel.export')}</Button>}</div>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('trust.find.intro')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {results.filter((r) => r.potential.parts.length > 0 || r.findings.length > 0).map((r) => (
          <Card key={`${r.side}-${r.currency}`} className="space-y-1" data-testid="trust-potential" data-currency={r.currency} data-side={r.side}>
            <div className="text-xs font-medium text-slate-500">{t('trust.find.potential')} · {t(`trust.find.side.${r.side}` as MessageKey)} · {r.currency}</div>
            <div className="text-xl font-semibold tabular-nums" data-testid="trust-potential-total">{r.potential.parts.length ? money(r.potential.total, { lang, currency: r.currency }) : '–'}</div>
            {r.potential.parts.length === 0 && <div className="text-xs text-slate-500">{t('trust.find.potential.none')}</div>}
            <ul className="text-xs text-slate-600 dark:text-slate-400">{r.potential.parts.map((p) => <li key={p.id}>{money(p.amount, { lang, currency: r.currency })} · {t(`trust.rule.${p.rule}` as MessageKey)} · {t(`trust.status.${p.status}` as MessageKey)}{p.overlaps.length ? ` · ${t('trust.find.overlaps', { n: p.overlaps.length })}` : ''}</li>)}</ul>
            {r.potential.excluded.length > 0 && <div className="text-xs text-slate-500">{t('trust.find.excluded', { n: r.potential.excluded.length })}</div>}
          </Card>
        ))}
      </div>
      <p className="text-xs text-slate-500">{t('trust.find.potential.note')}</p>
      {live.length === 0 ? <p className="text-sm text-slate-500" data-testid="trust-none">{t('trust.find.none')}</p> : <><ul className="space-y-2">{(showAll ? live : live.slice(0, LIMIT)).map(({ f, r }) => card(f, r))}</ul>{live.length > LIMIT && !showAll && <Button size="sm" variant="outline" onClick={() => setShowAll(true)} data-testid="trust-show-all">{t('trust.find.showAll', { n: live.length })}</Button>}</>}
      {withheld.length > 0 && (
        <details data-testid="trust-withheld" open><summary className="cursor-pointer font-medium">{t('trust.find.withheld')} ({withheld.length})</summary><ul className="mt-2 space-y-2">{withheld.map(({ f, r }) => card(f, r))}</ul></details>
      )}
      {shown.some((r) => r.reconciled.length > 0) && <p className="text-xs text-slate-500" data-testid="trust-reconciled">{t('trust.find.reconciled', { n: shown.reduce((s, r) => s + r.reconciled.length, 0) })}</p>}
    </section>
  );
}
