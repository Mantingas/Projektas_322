'use client';
import { useEffect, useRef, useState } from 'react';
import { getDb } from '@/db/db';
import { wipeAll } from '@/db/store';
import { isDemoMode, leaveDemo } from '@/db/dbName';
import { loadDemoData } from '@/lib/demo';
import { useLang } from './LangProvider';
import { Button } from './ui/button';

type State = { phase: 'off' } | { phase: 'loading'; done: number; total: number } | { phase: 'ready' } | { phase: 'failed' };

/**
 * Demo mode: the workspace runs on a separate database filled with the synthetic sample files, so the visitor's own data is never touched.
 * `onReady` fires once the sample data is in place (and after a restart) so the views refresh and can jump to the example.
 */
export function DemoBanner({ onReady }: { onReady: () => void }) {
  const { t } = useLang();
  const [st, setSt] = useState<State>({ phase: 'off' });
  const started = useRef(false);

  const run = async (fresh: boolean) => {
    setSt({ phase: 'loading', done: 0, total: 1 });
    try {
      const db = getDb();
      if (fresh) await wipeAll(db);
      if ((await db.imports.count()) === 0) {
        const ok = await loadDemoData((done, total) => setSt({ phase: 'loading', done, total }));
        if (!ok) { setSt({ phase: 'failed' }); return; }
      }
      setSt({ phase: 'ready' });
      onReady();
    } catch {
      setSt({ phase: 'failed' });
    }
  };

  useEffect(() => {
    if (started.current || !isDemoMode()) return;
    started.current = true;
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (st.phase === 'off') return null;
  return (
    <div className="no-print space-y-1 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm dark:border-indigo-900 dark:bg-indigo-950/40" data-testid="demo-banner" data-phase={st.phase} role="status">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{st.phase === 'loading' ? t('demo.loading', { done: st.done, total: st.total }) : st.phase === 'failed' ? t('demo.failed') : t('demo.banner')}</span>
        <span className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button size="sm" variant="outline" className="h-auto whitespace-normal py-1.5 text-center" disabled={st.phase === 'loading'} onClick={() => void run(true)} data-testid="demo-restart">{t('demo.restart')}</Button>
          <Button size="sm" className="h-auto whitespace-normal py-1.5 text-center" onClick={leaveDemo} data-testid="demo-exit">{t('demo.exit')}</Button>
        </span>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400">{t('demo.note')}</p>
    </div>
  );
}
