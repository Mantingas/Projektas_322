'use client';
import { useEffect, useState } from 'react';
import { getDb } from '@/db/db';
import { pendingHeldCount } from '@/db/store';
import { useLang } from './LangProvider';
import { ImportFlow } from './ImportFlow';
import { InsightsView } from './InsightsView';
import { PurchasingView } from './purchasing/PurchasingView';
import { InventoryView } from './inventory/InventoryView';
import { FinanceView } from './finance/FinanceView';
import { ExecutiveView } from './executive/ExecutiveView';
import { UniversalImport } from './universal/UniversalImport';
import { UniversalView } from './universal/UniversalView';
import type { FinanceSide, ModuleId } from '@/engine/types';
import { HistoryView } from './HistoryView';
import { SettingsView } from './SettingsView';
import { cn } from '@/lib/cn';
import type { MessageKey } from '@/i18n';

type Tab = 'import' | 'overview' | 'insights' | 'history' | 'settings';
const TABS: Tab[] = ['import', 'overview', 'insights', 'history', 'settings'];
type ViewId = ModuleId | 'universal';

export function Workspace() {
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>('import');
  const [module, setModule] = useState<ViewId>('sales');
  const [importMode, setImportMode] = useState<'standard' | 'universal'>('standard');
  const [finSide, setFinSide] = useState<FinanceSide>('receivable');
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
      {tab === 'import' && (
        <div className="space-y-4">
          <div role="group" aria-label={t('import.title')} className="no-print flex w-fit max-w-full overflow-hidden rounded-md border border-slate-300 text-sm dark:border-slate-700">
            {(['standard', 'universal'] as const).map((k) => (
              <button key={k} data-testid={`import-mode-${k}`} aria-pressed={importMode === k} onClick={() => setImportMode(k)} className={cn('px-3 py-1.5 font-medium', importMode === k ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}>{t(k === 'standard' ? 'uni.modeStandard' : 'uni.modeUniversal')}</button>
            ))}
          </div>
          {importMode === 'standard'
            ? <ImportFlow onImported={bump} goInsights={(m, s) => { setModule(m); if (s) setFinSide(s); setTab('insights'); }} goReview={() => setTab('history')} />
            : <UniversalImport onImported={bump} goView={() => { setModule('universal'); setTab('insights'); }} />}
        </div>
      )}
      {tab === 'overview' && <ExecutiveView version={version} goImport={() => setTab('import')} goModule={(m, s) => { setModule(m); if (s) setFinSide(s); setTab('insights'); }} onChanged={bump} />}
      {tab === 'insights' && (
        <div className="space-y-4">
          <div role="group" aria-label={t('mod.view')} className="no-print flex w-fit max-w-full overflow-hidden rounded-md border border-slate-300 text-sm dark:border-slate-700">
            {(['sales', 'purchasing', 'inventory', 'finance', 'universal'] as ViewId[]).map((m) => (
              <button key={m} data-testid={`module-view-${m}`} aria-pressed={module === m} onClick={() => setModule(m)} className={cn('px-2 py-1.5 font-medium sm:px-4', module === m ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}>{t(`mod.${m}` as MessageKey)}</button>
            ))}
          </div>
          {module === 'sales' ? <InsightsView version={version} goImport={() => setTab('import')} /> : module === 'purchasing' ? <PurchasingView version={version} goImport={() => setTab('import')} /> : module === 'inventory' ? <InventoryView version={version} goImport={() => setTab('import')} /> : module === 'universal' ? <UniversalView version={version} goImport={() => setTab('import')} onChanged={bump} /> : <FinanceView version={version} goImport={() => setTab('import')} initialSide={finSide} />}
        </div>
      )}
      {tab === 'history' && <HistoryView version={version} onChanged={bump} />}
      {tab === 'settings' && <SettingsView version={version} onChanged={bump} />}
    </div>
  );
}
