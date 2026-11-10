'use client';
import Link from 'next/link';
import demo from '@/generated/demoFinding.json';
import { useLang } from '../LangProvider';
import { Card } from '../ui/card';
import { buttonVariants } from '../ui/button';
import { EvidencePanel, StatusBadge } from '../trust/EvidencePanel';
import { tr, findingTitle } from '@/lib/evidence';
import { money } from '@/i18n';
import { cn } from '@/lib/cn';
import type { TrustFinding } from '@/engine/trust/types';

/**
 * The example finding on the first screen. It is NOT written for the page: `src/generated/demoFinding.json` is produced by running the real
 * engine over the synthetic sample files (`npm run demo:finding`), and a test fails if the file and the engine ever disagree.
 */
const finding = demo.finding as unknown as TrustFinding;

export function HeroFinding() {
  const { t, lang } = useLang();
  const amount = finding.exposure?.amount ?? 0;
  const cur = finding.currency ?? 'EUR';
  return (
    <Card className="mx-auto w-full max-w-xl space-y-2 p-4 text-left sm:space-y-3 sm:p-5" data-testid="hero-finding" data-status={finding.status} data-rule={finding.rule}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300" data-testid="hero-finding-label">{t('home.ex.label')}</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">{t('home.ex.kind')}</span>
      </div>
      <h2 className="text-lg font-semibold leading-snug">{findingTitle(finding, lang)}</h2>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums" data-testid="hero-finding-amount">{money(amount, { lang, currency: cur })}</span>
        <span className="text-sm text-slate-500">{t('home.ex.amount')}</span>
        <StatusBadge status={finding.status} />
      </div>
      <div className="text-sm">
        <div className="font-medium">{t('home.ex.why')}</div>
        <p className="text-slate-700 dark:text-slate-300">{tr(lang, finding.rationale, cur)}</p>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('home.ex.records', { n: finding.records.length })}</p>
      <details className="text-sm" data-testid="hero-finding-evidence">
        <summary className="cursor-pointer font-medium text-indigo-700 dark:text-indigo-300">{t('home.ex.show')}</summary>
        <div className="mt-2"><EvidencePanel dossier={finding} title={findingTitle(finding, lang)} fileNames={demo.fileNames} currency={cur} /></div>
      </details>
      <p className="text-xs text-slate-600 dark:text-slate-400" data-testid="hero-finding-caveat">{t('home.ex.caveat')}</p>
      <Link href="/app/?demo=1" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-auto whitespace-normal py-2 text-center')} data-testid="hero-finding-open">{t('home.ex.open')}</Link>
    </Card>
  );
}
