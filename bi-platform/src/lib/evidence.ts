import type { Described, EvidenceDossier, TrustFinding } from '@/engine/trust/types';
import { csvCell } from '@/engine/report/export';
import { fmtDate, money, translate, type Lang, type MessageKey } from '@/i18n';

export const tr = (lang: Lang, d: Described, currency = 'EUR') => translate(lang, d.key as MessageKey, d.params ?? {}, currency);

/** Evidence of one or several findings as CSV: what the finding says, how it was calculated, and every supporting record with its source file and row. Formula-safe. */
export function evidenceCsv(items: { title: string; dossier: EvidenceDossier; exposure?: string }[], lang: Lang, fileNames: Record<string, string>): string {
  const t = (k: string, p?: Record<string, never>) => translate(lang, k as MessageKey, p as never);
  const rows: string[][] = [[t('trust.panel.status'), 'Finding', t('trust.panel.currency'), t('trust.panel.calculation'), t('trust.panel.assumptions'), t('trust.panel.limitations'), t('trust.panel.missing'), t('trust.col.role'), t('trust.col.date'), t('trust.col.document'), t('trust.col.counterparty'), t('trust.col.amount'), t('trust.col.file'), t('trust.col.row')]];
  for (const it of items) {
    const d = it.dossier;
    const head = [t(`trust.status.${d.status}`), it.title, `${d.currency ?? ''} · ${t(`trust.panel.basis.${d.amountBasis}`)}`, tr(lang, d.calculation, d.currency), d.assumptions.map((x) => tr(lang, x)).join(' | '), d.limitations.map((x) => tr(lang, x)).join(' | '), d.missing.map((x) => tr(lang, x)).join(' | ')];
    if (!d.records.length) rows.push([...head, '', '', '', '', '', '', '']);
    for (const r of d.records) rows.push([...head, t(`trust.role.${r.role}`), fmtDate(r.date, lang), r.documentId ?? '', r.counterparty ?? '', money(r.amount, { lang, currency: d.currency ?? 'EUR' }), (r.importId && fileNames[r.importId]) || '', String(r.sourceRow)]);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export const findingTitle = (f: TrustFinding, lang: Lang) => `${translate(lang, `trust.rule.${f.rule}` as MessageKey)} – ${f.label}`;
