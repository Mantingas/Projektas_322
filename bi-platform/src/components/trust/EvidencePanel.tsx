'use client';
import { useLang } from '../LangProvider';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { downloadText } from '@/lib/download';
import { evidenceCsv, tr } from '@/lib/evidence';
import type { EvidenceDossier, EvidenceStatus } from '@/engine/trust/types';
import { fmtDate, money, type MessageKey } from '@/i18n';

const TONE: Record<EvidenceStatus, 'opportunity' | 'info' | 'warn' | 'neutral'> = { verified: 'opportunity', candidate: 'info', estimate: 'warn', withheld: 'neutral' };

export function StatusBadge({ status }: { status: EvidenceStatus }) {
  const { t } = useLang();
  return <Badge tone={TONE[status]} data-testid="evidence-status" data-status={status} title={t(`trust.status.d.${status}` as MessageKey)}>{t(`trust.status.${status}` as MessageKey)}</Badge>;
}

const List = ({ items, empty }: { items: { key: string; params?: Record<string, never> }[]; empty: string }) => {
  const { lang } = useLang();
  return items.length ? <ul className="list-disc pl-5">{items.map((x, i) => <li key={`${x.key}${i}`}>{tr(lang, x as never)}</li>)}</ul> : <span className="text-slate-500">{empty}</span>;
};

/** Everything a finance manager needs to judge ONE finding: status, why, calculation, basis, period, records, assumptions, limits and what is missing. */
export function EvidencePanel({ dossier, title, fileNames = {}, currency }: { dossier: EvidenceDossier; title: string; fileNames?: Record<string, string>; currency?: string }) {
  const { t, lang } = useLang();
  const cur = dossier.currency ?? currency ?? 'EUR';
  const files = [...new Set(dossier.records.map((r) => (r.importId && fileNames[r.importId]) || '').filter(Boolean))];
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800" data-testid="evidence-panel" data-status={dossier.status}>
      <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{t('trust.panel.title')}</span><StatusBadge status={dossier.status} /></div>
      <p className="text-xs text-slate-500">{t(`trust.status.d.${dossier.status}` as MessageKey)}</p>
      <Row label={t('trust.panel.rationale')}>{tr(lang, dossier.rationale, cur)}</Row>
      {dossier.withheldReason && <Row label={t('trust.panel.withheld')}><span data-testid="withheld-reason">{tr(lang, dossier.withheldReason, cur)}</span></Row>}
      <Row label={t('trust.panel.calculation')}>{tr(lang, dossier.calculation, cur)}</Row>
      <Row label={t('trust.panel.currency')}>{dossier.currency ? `${dossier.currency} · ` : ''}{t(`trust.panel.basis.${dossier.amountBasis}` as MessageKey)}</Row>
      {dossier.period && <Row label={t('trust.panel.period')}>{fmtDate(dossier.period.from, lang)} – {fmtDate(dossier.period.to, lang)}</Row>}
      {dossier.dateDimension && <Row label={t('trust.panel.date')}><span data-testid="evidence-date">{t(`trust.date.${dossier.dateDimension}` as MessageKey)}</span></Row>}
      <Row label={t('trust.panel.assumptions')}><List items={dossier.assumptions as never} empty={t('trust.panel.none')} /></Row>
      <Row label={t('trust.panel.limitations')}><List items={dossier.limitations as never} empty={t('trust.panel.none')} /></Row>
      <Row label={t('trust.panel.missing')}><List items={dossier.missing as never} empty={t('trust.panel.none')} /></Row>
      {files.length > 0 && <Row label={t('trust.panel.sources')}>{files.join(', ')}</Row>}
      <div>
        <div className="font-medium">{t('trust.panel.records')}</div>
        {dossier.records.length === 0 ? <p className="text-xs text-slate-500">{t('trust.panel.noRecords')}</p> : (
          <div className="mt-1 overflow-x-auto"><table className="w-full text-left text-xs" data-testid="evidence-records"><thead><tr className="text-slate-500"><th className="px-2 py-1">{t('trust.col.role')}</th><th className="px-2 py-1">{t('trust.col.date')}</th><th className="px-2 py-1">{t('trust.col.document')}</th><th className="px-2 py-1">{t('trust.col.counterparty')}</th><th className="px-2 py-1 text-right">{t('trust.col.amount')}</th><th className="px-2 py-1">{t('trust.col.file')}</th><th className="px-2 py-1 text-right">{t('trust.col.row')}</th></tr></thead>
            <tbody>{dossier.records.map((r) => <tr key={r.key + r.role} className="border-t border-slate-100 dark:border-slate-800"><td className="px-2 py-1">{t(`trust.role.${r.role}` as MessageKey)}</td><td className="px-2 py-1">{fmtDate(r.date, lang)}</td><td className="px-2 py-1">{r.documentId ?? '–'}</td><td className="px-2 py-1">{r.counterparty ?? '–'}</td><td className="px-2 py-1 text-right tabular-nums">{money(r.amount, { lang, currency: cur })}</td><td className="px-2 py-1">{(r.importId && fileNames[r.importId]) || '–'}</td><td className="px-2 py-1 text-right">{r.sourceRow}</td></tr>)}</tbody></table></div>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={() => downloadText('evidence.csv', 'text/csv', evidenceCsv([{ title, dossier }], lang, fileNames))} data-testid="evidence-export">{t('trust.panel.export')}</Button>
      <p className="text-xs text-slate-500">{t('trust.disclaimer')}</p>
    </div>
  );
}
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => <div><div className="font-medium">{label}</div><div className="text-slate-700 dark:text-slate-300">{children}</div></div>;
