'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { clearDemoFlag } from '@/db/dbName';
import { useLang } from '@/components/LangProvider';
import { Card, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { HeroFinding } from '@/components/home/HeroFinding';
import { cn } from '@/lib/cn';
import type { MessageKey } from '@/i18n';

/** Order follows docs/COMMERCIAL_VALUE_AUDIT.md: purchasing prices → debts / credits / payments → sales & margins → stock → any table. */
const AREAS = ['purchasing', 'debts', 'sales', 'inventory', 'universal'] as const;

export default function Home() {
  const { t } = useLang();
  // the landing page is never demo mode: a visitor who comes back here and picks "own file" must land in their own workspace
  useEffect(() => { clearDemoFlag(); }, []);
  return (
    <div className="space-y-12">
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

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">{t('home.what.title')}</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('home.what.sub')}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {AREAS.map((k) => (
            <Card key={k} data-testid={`area-${k}`}>
              <CardTitle>{t(`home.m.${k}` as MessageKey)}</CardTitle>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{t(`home.m.${k}.d` as MessageKey)}</p>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">{t('home.how.title')}</h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(['home.how.1', 'home.how.2', 'home.how.3', 'home.how.4'] as MessageKey[]).map((k, i) => (
            <li key={k}>
              <Card className="h-full">
                <div className="mb-2 text-2xl font-bold text-indigo-600">{i + 1}</div>
                <p className="text-sm">{t(k)}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40" data-testid="privacy">
          <CardTitle>🔒 {t('home.priv.title')}</CardTitle>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {(['home.priv.1', 'home.priv.2', 'home.priv.3', 'home.priv.4'] as MessageKey[]).map((k) => <li key={k}>{t(k)}</li>)}
          </ul>
        </Card>
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30" data-testid="stage">
          <CardTitle>{t('home.stage.title')}</CardTitle>
          <p className="mt-3 text-sm">{t('home.stage.body')}</p>
        </Card>
      </section>

      <section className="space-y-4" data-testid="pilot">
        <h2 className="text-xl font-semibold">{t('home.pilot.title')}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {(['what', 'how', 'fb'] as const).map((k) => (
            <Card key={k}>
              <CardTitle>{t(`home.pilot.${k}.t` as MessageKey)}</CardTitle>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{t(`home.pilot.${k}.d` as MessageKey)}</p>
            </Card>
          ))}
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400" data-testid="pilot-note">{t('home.pilot.note')}</p>
      </section>
    </div>
  );
}
