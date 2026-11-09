'use client';
import Link from 'next/link';
import { useLang } from './LangProvider';
import { LANGS } from '@/i18n';
import { cn } from '@/lib/cn';

export function Header() {
  const { lang, setLang, t } = useLang();
  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight">{t('app.name')}</Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/" className="hidden hover:underline sm:inline">{t('nav.home')}</Link>
          <Link href="/app/" className="hover:underline">{t('nav.import')}</Link>
          <div role="group" aria-label={t('lang.label')} className="ml-2 flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-700">
            {LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => setLang(l.code)}
                aria-pressed={lang === l.code}
                data-testid={`lang-${l.code}`}
                className={cn('px-2.5 py-1 text-xs font-medium', lang === l.code ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}
              >
                {l.label}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </header>
  );
}
