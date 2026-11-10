'use client';
import Link from 'next/link';
import { useLang } from '@/components/LangProvider';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { MessageKey } from '@/i18n';

const MODULES: { k: 'sales' | 'purchasing' | 'inventory' | 'debts' | 'universal'; available: boolean }[] = [
  { k: 'sales', available: true },
  { k: 'purchasing', available: true },
  { k: 'inventory', available: true },
  { k: 'debts', available: true },
  { k: 'universal', available: false },
];

export default function Home() {
  const { t } = useLang();
  return (
    <div className="space-y-12">
      <section className="py-8 text-center">
        <h1 className="mx-auto max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">{t('hero.title')}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600 dark:text-slate-400">{t('hero.sub')}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/app/" className={cn(buttonVariants({ size: 'lg' }))} data-testid="cta">{t('hero.cta')}</Link>
          <a href="/samples/sample_lt_pardavimai.csv" download className={cn(buttonVariants({ size: 'lg', variant: 'outline' }))}>{t('hero.sample')}</a>
        </div>
      </section>

      <section>
        <Card className="border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40">
          <CardTitle>🔒 {t('privacy.title')}</CardTitle>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            <li>{t('privacy.1')}</li>
            <li>{t('privacy.2')}</li>
            <li>{t('privacy.3')}</li>
          </ul>
        </Card>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">{t('how.title')}</h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(['how.1', 'how.2', 'how.3', 'how.4'] as MessageKey[]).map((k, i) => (
            <li key={k}>
              <Card className="h-full">
                <div className="mb-2 text-2xl font-bold text-indigo-600">{i + 1}</div>
                <p className="text-sm">{t(k)}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">{t('modules.title')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <Card key={m.k}>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{t(`module.${m.k}` as MessageKey)}</CardTitle>
                <Badge tone={m.available ? 'opportunity' : 'neutral'}>{t(m.available ? 'module.available' : 'module.soon')}</Badge>
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{t(`module.${m.k}.d` as MessageKey)}</p>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">{t('pricing.title')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>{t('pricing.lt')}</Card>
          <Card>{t('pricing.pl')}</Card>
        </div>
      </section>
    </div>
  );
}
