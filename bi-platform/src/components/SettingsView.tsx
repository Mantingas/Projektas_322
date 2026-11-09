'use client';
import { useEffect, useRef, useState } from 'react';
import { useLang } from './LangProvider';
import { Button } from './ui/button';
import { Card, CardTitle } from './ui/card';
import { getDb } from '@/db/db';
import { exportBackup, restoreBackup, wipeAll, type Backup } from '@/db/store';
import { downloadText } from '@/lib/download';
import { LANGS } from '@/i18n';
import { cn } from '@/lib/cn';

export function SettingsView({ version, onChanged }: { version: number; onChanged: () => void }) {
  const { t, lang, setLang } = useLang();
  const [counts, setCounts] = useState({ imports: 0, lines: 0 });
  const [msg, setMsg] = useState('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const db = getDb();
      const [imports, lines] = await Promise.all([db.imports.count(), db.sales.count()]);
      if (alive) setCounts({ imports, lines });
      try {
        const p = await navigator.storage?.persisted?.();
        if (alive) setPersisted(p ?? null);
      } catch { /* ignore */ }
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [version]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t('set.title')}</h1>
      <Card className="space-y-3">
        <CardTitle>{t('set.language')}</CardTitle>
        <div className="flex gap-2">
          {LANGS.map((l) => (
            <button key={l.code} onClick={() => setLang(l.code)} aria-pressed={lang === l.code} className={cn('rounded-md border px-4 py-2 text-sm', lang === l.code ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 dark:border-slate-700')}>{l.label}</button>
          ))}
        </div>
      </Card>

      <Card className="space-y-3">
        <CardTitle>{t('set.data')}</CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-400">{t('set.storage')}</p>
        <p className="text-sm" data-testid="storage-stats">{t('set.stats', { imports: counts.imports, lines: counts.lines })}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={async () => downloadText('backup.json', 'application/json', JSON.stringify(await exportBackup(getDb())))}>{t('set.backup')}</Button>
          <Button variant="outline" onClick={() => file.current?.click()}>{t('set.restore')}</Button>
          <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              await restoreBackup(getDb(), JSON.parse(await f.text()) as Backup);
              setMsg(t('set.restored'));
              onChanged();
            } catch { setMsg(t('set.restoreFail')); }
            e.target.value = '';
          }} />
          <Button variant="outline" onClick={async () => { try { setPersisted(await navigator.storage.persist()); } catch { setPersisted(false); } }}>{t('set.persist')}</Button>
        </div>
        {persisted !== null && <p className="text-xs text-slate-500">{persisted ? t('set.persisted') : t('set.notPersisted')}</p>}
        <div>
          <Button
            variant="destructive"
            data-testid="delete-all"
            onClick={async () => {
              if (!window.confirm(t('set.deleteConfirm'))) return;
              await wipeAll(getDb());
              setMsg(t('set.deleted'));
              onChanged();
            }}
          >
            {t('set.deleteAll')}
          </Button>
        </div>
        {msg && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400" data-testid="settings-msg">{msg}</p>}
      </Card>
    </div>
  );
}
