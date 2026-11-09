'use client';
import { useEffect, useState } from 'react';
import { getDb } from '@/db/db';
import { pendingHeldCount } from '@/db/store';
import { useLang } from './LangProvider';
import { ImportFlow } from './ImportFlow';
import { InsightsView } from './InsightsView';
import { HistoryView } from './HistoryView';
import { SettingsView } from './SettingsView';
import { cn } from '@/lib/cn';
import type { MessageKey } from '@/i18n';

type Tab = 'import' | 'insights' | 'history' | 'settings';
const TABS: Tab[] = ['import', 'insights', 'history', 'settings'];

export function Workspace() {
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>('import');
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const [held, setHeld] = useState(0);
  useEffect(() => {
    let alive = true;
    pendingHeldCount(getDb()).then((n) => alive && setHeld(n)).catch(() => undefined);
    return () => { alive = false; };
  }, [version]);
  return (
    <div className="space-y-6">
      <div role="tablist" className="no-print flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            data-testid={`tab-${k}`}
            onClick={() => setTab(k)}
            className={cn('whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium', tab === k ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300' : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200')}
          >
            {t(`nav.${k}` as MessageKey)}
            {k === 'history' && held > 0 && <span data-testid="held-badge" className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{held}</span>}
          </button>
        ))}
      </div>
      {tab === 'import' && <ImportFlow onImported={bump} goInsights={() => setTab('insights')} goReview={() => setTab('history')} />}
      {tab === 'insights' && <InsightsView version={version} goImport={() => setTab('import')} />}
      {tab === 'history' && <HistoryView version={version} onChanged={bump} />}
      {tab === 'settings' && <SettingsView version={version} onChanged={bump} />}
    </div>
  );
}
