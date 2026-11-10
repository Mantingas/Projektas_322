'use client';
import { useCallback, useEffect, useState } from 'react';
import { useLang } from '../LangProvider';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { engine } from '@/lib/engineClient';
import type { LinkWorkflow } from '@/engine/executive/linking';
import type { EntityEnd, EntityLink } from '@/engine/entities/links';
import { getDb } from '@/db/db';
import { clearLink, decideLink } from '@/db/store';
import type { MessageKey } from '@/i18n';

const ModuleChip = ({ m }: { m: string }) => { const { t } = useLang(); return <Badge tone="neutral">{t(`mod.${m === 'payables' ? 'finance' : m}` as MessageKey)}</Badge>; };

/** The workflow where the user decides which products and customers / suppliers are the same across modules. Nothing is joined without a decision. */
export function LinksPanel({ version, onChanged }: { version: number; onChanged: () => void }) {
  const { t } = useLang();
  const [wf, setWf] = useState<LinkWorkflow | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; void engine().call('linkWorkflow', [{ version }]).then((w) => alive && setWf(w)); return () => { alive = false; }; }, [version]);

  const decide = useCallback(async (l: Pick<EntityLink, 'id' | 'kind' | 'a' | 'b' | 'basis' | 'evidence'>, status: 'confirmed' | 'rejected') => {
    setBusy(true);
    try { await decideLink(getDb(), l, status); onChanged(); } finally { setBusy(false); }
  }, [onChanged]);
  const undo = async (id: string) => { setBusy(true); try { await clearLink(getDb(), id); onChanged(); } finally { setBusy(false); } };
  if (!wf) return null;
  const agree = wf.proposed.filter((p) => !p.namesDiffer);
  const none = wf.proposed.length === 0 && wf.nameOnly.length === 0 && wf.decided.length === 0 && wf.ambiguous.length === 0;
  const pair = (a: EntityEnd, b: EntityEnd) => (
    <span className="inline-flex flex-wrap items-center gap-1"><ModuleChip m={a.module} /><b>{a.label}</b> ↔ <ModuleChip m={b.module} /><b>{b.label}</b></span>
  );
  return (
    <Card className="space-y-4" data-testid="links-panel">
      <div>
        <CardTitle>{t('lnk.title')}</CardTitle>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('lnk.intro')}</p>
        <p className="mt-1 text-xs text-slate-500">{t('lnk.enables')} {t('lnk.saved')}</p>
      </div>
      {none && <p className="text-sm text-slate-500" data-testid="links-none">{t('lnk.none')}</p>}

      {wf.proposed.length > 0 && (
        <div className="space-y-2" data-testid="links-proposed">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{t('lnk.proposed')} ({wf.proposed.length})</h3>
            {agree.length > 1 && <Button size="sm" variant="outline" disabled={busy} data-testid="link-confirm-all" onClick={async () => { setBusy(true); try { for (const l of agree) await decideLink(getDb(), l, 'confirmed'); onChanged(); } finally { setBusy(false); } }}>{t('lnk.confirmAll')} ({agree.length})</Button>}
          </div>
          <ul className="space-y-2">
            {wf.proposed.map((l) => (
              <li key={l.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800" data-testid="link-proposed" data-link-id={l.id} data-kind={l.kind}>
                <div className="flex flex-wrap items-center gap-2"><Badge tone="info">{t(`lnk.kind.${l.kind}` as MessageKey)}</Badge>{pair(l.a, l.b)}</div>
                <p className="mt-1 text-xs text-slate-500">{t('lnk.evidence')}: {l.evidence}. <span className={l.namesDiffer ? 'font-semibold text-amber-700' : ''}>{l.namesDiffer ? t('lnk.namesDiffer') : t('lnk.namesAgree')}</span></p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void decide(l, 'confirmed')} data-testid="link-confirm">{t('lnk.confirm')}</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide(l, 'rejected')} data-testid="link-reject">{t('lnk.reject')}</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {wf.nameOnly.length > 0 && (
        <div className="space-y-2" data-testid="links-nameonly">
          <h3 className="font-semibold">{t('lnk.nameOnly')} ({wf.nameOnly.length})</h3>
          <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{t('lnk.nameOnlyWarn')}</p>
          <ul className="space-y-2">
            {wf.nameOnly.slice(0, 30).map((c) => (
              <li key={c.id} className="rounded-lg border border-dashed border-slate-300 p-3 text-sm dark:border-slate-700" data-testid="link-nameonly" data-link-id={c.id}>
                <div className="flex flex-wrap items-center gap-2"><Badge tone="info">{t(`lnk.kind.${c.kind}` as MessageKey)}</Badge>{pair(c.a, c.b)}</div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" disabled={busy} data-testid="link-confirm-name" onClick={() => void decide({ id: c.id, kind: c.kind, a: c.a, b: c.b, basis: 'user_confirmed', evidence: 'same name only, confirmed by the user' }, 'confirmed')}>{t('lnk.confirmName')}</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide({ id: c.id, kind: c.kind, a: c.a, b: c.b, basis: 'user_confirmed', evidence: 'same name only' }, 'rejected')}>{t('lnk.reject')}</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {wf.ambiguous.length > 0 && (
        <div className="space-y-1 text-sm" data-testid="links-ambiguous"><h3 className="font-semibold">{t('lnk.ambiguous')}</h3>
          <ul className="list-disc pl-5 text-slate-600 dark:text-slate-400">{wf.ambiguous.map((a, i) => <li key={i}><ModuleChip m={a.module} /> {t('lnk.ambiguous.names', { code: a.code, names: a.names.join(' / ') })}</li>)}</ul>
        </div>
      )}

      {wf.decided.length > 0 && (
        <div className="space-y-2" data-testid="links-decided"><h3 className="font-semibold">{t('lnk.decided')} ({wf.decided.length})</h3>
          <ul className="space-y-1">
            {wf.decided.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="link-decided" data-status={l.status} data-link-id={l.id}>
                <Badge tone={l.status === 'confirmed' ? 'opportunity' : 'neutral'}>{t(`lnk.status.${l.status}` as MessageKey)}</Badge>{pair(l.a, l.b)}
                <span className="text-xs text-slate-500">({t(`lnk.basis.${l.basis}` as MessageKey)})</span>
                <button className="text-xs text-indigo-700 underline dark:text-indigo-300" onClick={() => void undo(l.id)} disabled={busy} data-testid="link-undo">{t('lnk.undo')}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
