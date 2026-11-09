'use client';
import { useCallback, useEffect, useState } from 'react';
import { useLang } from './LangProvider';
import { Button } from './ui/button';
import { Card, CardTitle } from './ui/card';
import { getDb } from '@/db/db';
import { listConflicts, resolveConflicts, type ConflictGroup, type ResolveAction } from '@/db/store';
import { fmtDate, money, type MessageKey } from '@/i18n';

const docLabel = (k: string) => k.split('|').slice(1).join('|');

export function ConflictReview({ version, onChanged }: { version: number; onChanged: () => void }) {
  const { t } = useLang();
  const [groups, setGroups] = useState<ConflictGroup[] | null>(null);
  const load = useCallback(() => listConflicts(getDb()).then(setGroups).catch(() => setGroups([])), []);
  useEffect(() => { void load(); }, [load, version]);
  if (groups === null) return null;

  const apply = async (items: ConflictGroup[], action: ResolveAction) => {
    await resolveConflicts(getDb(), items.map((g) => ({ importId: g.importId, docKey: g.docKey, module: g.module })), action);
    await load();
    onChanged();
  };

  return (
    <section className="space-y-3" data-testid="conflict-review">
      <h2 className="text-xl font-bold">{t('cr.title')} {groups.length > 0 && <span className="text-sm font-normal text-amber-700 dark:text-amber-300" data-testid="cr-count">({t('cr.pending', { n: groups.length })})</span>}</h2>
      {groups.length === 0 ? <Card className="text-sm text-slate-500">{t('cr.empty')}</Card> : (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-400">{t('cr.intro')}</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{t('cr.bulk')}:</span>
            <Button size="sm" variant="outline" data-testid="cr-bulk-use" onClick={() => apply(groups, 'use_new')}>{t('cr.useNew')}</Button>
            <Button size="sm" variant="outline" data-testid="cr-bulk-keep" onClick={() => apply(groups, 'keep_stored')}>{t('cr.keepStored')}</Button>
          </div>
          {groups.map((g) => {
            const cur = g.held[0]?.currency ?? 'EUR';
            return (
              <Card key={`${g.importId}|${g.docKey}`} className="space-y-3" data-testid="conflict-group">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle data-module={g.module}>{g.module !== 'sales' && <span className="mr-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300" data-testid="cr-module">{t(`mod.${g.module}` as MessageKey)}</span>}{g.docKey ? `${t('cr.doc')} ${g.held[0]?.documentId ?? docLabel(g.docKey)}` : t('cr.noDoc')}</CardTitle>
                  <span className="text-xs text-slate-500">{g.fileName}</span>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {g.docKey && <LinesTable title={t('cr.stored')} rows={g.stored} cur={cur} sumLabel={t('cr.sum')} testid="cr-stored" />}
                  <LinesTable title={t('cr.held', { file: g.fileName })} rows={g.held} cur={cur} sumLabel={t('cr.sum')} testid="cr-held" />
                </div>
                {g.docKey ? <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-500"><li>{t('cr.hintUseNew')}</li><li>{t('cr.hintKeepBoth')}</li></ul> : null}
                <div className="flex flex-wrap gap-2">
                  {g.docKey ? (
                    <>
                      <Button size="sm" data-testid="cr-use-new" onClick={() => apply([g], 'use_new')}>{t('cr.useNew')}</Button>
                      <Button size="sm" variant="outline" data-testid="cr-keep-stored" onClick={() => apply([g], 'keep_stored')}>{t('cr.keepStored')}</Button>
                      <Button size="sm" variant="outline" data-testid="cr-keep-both" onClick={() => apply([g], 'keep_both')}>{t('cr.keepBoth')}</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" data-testid="cr-add" onClick={() => apply([g], 'keep_both')}>{t('cr.add')}</Button>
                      <Button size="sm" data-testid="cr-discard" onClick={() => apply([g], 'keep_stored')}>{t('cr.discard')}</Button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </>
      )}
    </section>
  );
}

function LinesTable({ title, rows, cur, sumLabel, testid }: { title: string; rows: { key: string; date: string; productName?: string; productId?: string; supplierName?: string; supplierId?: string; warehouse?: string; unit?: string; quantity?: number; amount: number }[]; cur: string; sumLabel: string; testid: string }) {
  const { t, lang } = useLang();
  return (
    <div data-testid={testid}>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <table className="w-full text-left text-xs">
        <thead><tr><th className="px-2 py-1 text-slate-500">{t('cr.date')}</th><th className="px-2 py-1 text-slate-500">{t('cr.product')}</th><th className="px-2 py-1 text-right text-slate-500">{t('cr.amount')}</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.key} className="border-t border-slate-100 dark:border-slate-800"><td className="px-2 py-1">{fmtDate(r.date, lang)}</td><td className="px-2 py-1">{r.supplierName || r.supplierId ? `${r.supplierName ?? r.supplierId} · ` : r.warehouse ? `${r.warehouse} · ` : ''}{r.productName ?? r.productId ?? '–'}{r.quantity !== undefined && r.unit ? ` (${r.quantity} ${r.unit})` : ''}</td><td className="px-2 py-1 text-right tabular-nums">{money(r.amount, { lang, currency: cur })}</td></tr>)}
          <tr className="border-t border-slate-300 font-semibold dark:border-slate-700"><td className="px-2 py-1" colSpan={2}>{sumLabel}</td><td className="px-2 py-1 text-right tabular-nums">{money(rows.reduce((s, r) => s + r.amount, 0), { lang, currency: cur })}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
