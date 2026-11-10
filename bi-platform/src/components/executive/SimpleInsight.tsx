'use client';
import { useState, type ReactNode } from 'react';
import { useLang } from '../LangProvider';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { explainInsight } from '@/engine/insights/explain';
import { formatEvidence, formatImpact, renderInsight } from '@/lib/report';
import type { Insight } from '@/engine/types';
import type { MessageKey } from '@/i18n';

/** One finding with its numbers, certainty and (when it has them) its cross-module disclosure. Used where no dashboard model exists (any-table analysis, executive overview). */
export function SimpleInsight({ insight, currency, badges, footer, testid = 'insight' }: { insight: Insight; currency: string; badges?: ReactNode; footer?: ReactNode; testid?: string }) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const r = renderInsight(insight, lang, currency);
  const ex = explainInsight(insight);
  return (
    <Card data-testid={testid} data-insight-id={insight.id} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {badges}
        <Badge tone={insight.severity}>{t(`sev.${insight.severity}` as MessageKey)}</Badge>
        {insight.certainty && <Badge tone={insight.certainty === 'fact' ? 'opportunity' : insight.certainty === 'possible' ? 'warn' : 'info'} data-testid="certainty-badge" data-certainty={insight.certainty} title={t(`cert.${insight.certainty}.d` as MessageKey)}>{t(`cert.${insight.certainty}` as MessageKey)}</Badge>}
        <span className="text-xs text-slate-500">{t('ins.sufficiency')}: <b>{t(`rel.${insight.reliability}` as MessageKey)}</b> · {t('ins.impact')}: <b>{formatImpact(insight, lang, currency)}</b></span>
      </div>
      <CardTitle className="text-base">{r.title}</CardTitle>
      <p className="text-sm text-slate-700 dark:text-slate-300">{r.body}</p>
      <p className="text-sm"><b>{t('ins.action')}:</b> {r.action}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="insight-details-btn">{open ? t('ins.hideDetails') : t('ins.viewDetails')}</Button>
        {footer}
      </div>
      {open && (
        <div className="space-y-3 border-t border-slate-200 pt-3 text-sm dark:border-slate-800" data-testid="insight-details">
          {ex.contributors.length > 0 && (
            <div><div className="font-medium">{t('ins.contributors')}</div><ul className="list-disc pl-5 text-slate-600 dark:text-slate-400">{ex.contributors.map((e, n) => <li key={n}>{formatEvidence(e, lang, currency)}</li>)}</ul></div>
          )}
          {insight.certainty && <div><div className="font-medium">{t(`cert.${insight.certainty}` as MessageKey)}</div><p className="text-slate-600 dark:text-slate-400">{t(`cert.${insight.certainty}.d` as MessageKey)}</p></div>}
          <div><div className="font-medium">{t('ins.why')}</div><p className="text-slate-600 dark:text-slate-400">{t(insight.whyKey as MessageKey, insight.params, currency)}</p></div>
          <div><div className="font-medium">{t('ins.sufficiency')}</div><p className="text-slate-600 dark:text-slate-400">{t(`rel.${insight.reliability}` as MessageKey)} – {r.reliabilityReason}</p></div>
          {insight.cross && <CrossDisclosureView insight={insight} />}
        </div>
      )}
    </Card>
  );
}

export function CrossDisclosureView({ insight }: { insight: Insight }) {
  const { t, lang } = useLang();
  const c = insight.cross!;
  const d = (iso: string) => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : lang === 'pl' ? 'pl-PL' : 'lt-LT', { timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));
  return (
    <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs dark:border-sky-900 dark:bg-sky-950/30" data-testid="cross-disclosure">
      <div className="text-sm font-semibold">{t('cross.disc.title')}</div>
      <div><b>{t('cross.disc.sources')}:</b> {c.sources.map((s, i) => <span key={i} className="mr-2">{t(`mod.${s.module}` as MessageKey)}{s.currency ? ` (${s.currency}${s.note ? `, ${s.note}` : ''})` : s.note ? ` (${s.note})` : ''} {d(s.from)}–{d(s.to)}, {s.lines} {t('cross.disc.lines')};</span>)}</div>
      <div><b>{t('cross.disc.links')}:</b> {c.links.length ? c.links.map((l, i) => <span key={i} className="mr-2" data-testid="cross-link">{l.a} ↔ {l.b} ({t(`lnk.basis.${l.basis}` as MessageKey)});</span>) : '–'}</div>
      <div><b>{t('cross.disc.period')}:</b> {d(c.period.from)} – {d(c.period.to)}</div>
      <div><b>{t('cross.disc.method')}:</b> {t(c.methodKey as MessageKey)}</div>
      <div><b>{t('cross.disc.confidence')}:</b> {t(c.confidenceKey as MessageKey)}</div>
      <div><b>{t('cross.disc.limits')}:</b><ul className="list-disc pl-5">{c.limits.map((l) => <li key={l}>{t(l as MessageKey)}</li>)}</ul></div>
    </div>
  );
}
