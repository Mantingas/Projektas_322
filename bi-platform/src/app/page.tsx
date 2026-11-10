'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { clearDemoFlag } from '@/db/dbName';
import { PILOT_EMAIL, pilotSection } from '@/config/contact';
import { useLang } from '@/components/LangProvider';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { HeroFinding } from '@/components/home/HeroFinding';
import { cn } from '@/lib/cn';
import type { MessageKey } from '@/i18n';

/** Order follows docs/COMMERCIAL_VALUE_AUDIT.md: purchasing prices → debts / credits / payments → sales & margins → stock → any table. */
const AREAS = ['purchasing', 'debts', 'sales', 'inventory', 'universal'] as const;

const pilot = pilotSection(PILOT_EMAIL);

export default function Home() {
  const { t } = useLang();
  // the landing page is never demo mode: a visitor who comes back here and picks "own file" must land in their own workspace
  useEffect(() => { clearDemoFlag(); }, []);
  return (
    <div className="space-y-8 sm:space-y-12">
      <section className="grid items-start gap-6 py-2 sm:gap-8 sm:py-6 lg:grid-cols-2" data-testid="hero">
        <div className="space-y-4 sm:space-y-5">
          <h1 className="text-[1.65rem] font-bold leading-tight tracking-tight sm:text-4xl" data-testid="hero-title">{t('home.hero.title')}</h1>
          <p className="text-base text-slate-600 sm:text-lg dark:text-slate-400">{t('home.hero.sub')}</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/app/?demo=1" className={cn(buttonVariants({ size: 'lg' }))} data-testid="cta-demo">{t('home.hero.demo')}</Link>
            <Link href="/app/" className={cn(buttonVariants({ size: 'lg', variant: 'outline' }))} data-testid="cta">{t('home.hero.own')}</Link>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">{t('home.hero.note')}</p>
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">🔒 {t('home.hero.local')}</p>
        </div>
        <HeroFinding />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t('home.what.title')}</h2>
        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
          {AREAS.map((k) => (
            <Card key={k} className="p-3 sm:p-5" data-testid={`area-${k}`}>
              <h3 className="text-base font-semibold leading-snug">{t(`home.m.${k}` as MessageKey)}</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t(`home.m.${k}.d` as MessageKey)}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t('home.how.title')}</h2>
        <ol className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4" data-testid="how">
          {(['home.how.1', 'home.how.2', 'home.how.3', 'home.how.4'] as MessageKey[]).map((k, i) => (
            <li key={k} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white" aria-hidden>{i + 1}</span>
              <span className="text-sm">{t(k)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid items-start gap-3 lg:grid-cols-2">
        <Card className="border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40" data-testid="privacy">
          <h2 className="text-base font-semibold">🔒 {t('home.priv.title')}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {(['home.priv.f1', 'home.priv.f2', 'home.priv.f3'] as MessageKey[]).map((k) => <li key={k}>{t(k)}</li>)}
          </ul>
          <details className="mt-2 text-sm" data-testid="privacy-details">
            <summary className="cursor-pointer font-medium text-emerald-900 dark:text-emerald-200">{t('home.priv.more')}</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">
              {(['home.priv.d1', 'home.priv.d2', 'home.priv.d3'] as MessageKey[]).map((k) => <li key={k}>{t(k)}</li>)}
            </ul>
          </details>
        </Card>
        <Card className="border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30" data-testid="stage">
          <h2 className="text-base font-semibold">{t('home.stage.title')}</h2>
          <p className="mt-2 text-sm">{t('home.stage.body')}</p>
        </Card>
      </section>

      <section data-testid="pilot">
        <Card className="space-y-2 p-4">
          <h2 className="text-lg font-semibold">{t(pilot.mode === 'invite' ? 'home.pilot.title' : 'home.pilot.title.plan')}</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
            <li>{t('home.pilot.what')}</li>
            <li>{t('home.pilot.how')}</li>
          </ul>
          {pilot.mode === 'invite' && (
            <p className="text-sm" data-testid="pilot-contact">
              {t('home.pilot.contact.lead')} <a href={pilot.mailto} className="font-medium text-indigo-700 underline dark:text-indigo-300">{pilot.email}</a>. {t('home.pilot.contact.safe')}
            </p>
          )}
        </Card>
      </section>
    </div>
  );
}
