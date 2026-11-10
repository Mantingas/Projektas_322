import { escapeHtml as e, csvCell } from '@/engine/report/export';
import type { Missed, PilotMeta, Review } from '@/engine/pilot/types';
import { pilotMetrics, type PilotFinding, type PilotImport, type PilotMetrics } from '@/engine/pilot/metrics';
import type { SettlementResult } from '@/engine/trust/types';
import { money, num, translate, type Lang, type MessageKey } from '@/i18n';

export interface PilotData { findings: PilotFinding[]; potential: { side: 'receivable' | 'payable'; currency: string; total: number }[]; reviews: Review[]; missed: Missed[]; meta: PilotMeta; imports: PilotImport[]; withheldOther: number }

export function flatten(trust: SettlementResult[]): Pick<PilotData, 'findings' | 'potential'> {
  return {
    findings: trust.flatMap((r) => r.findings.map((f): PilotFinding => ({ id: f.id, rule: f.rule, status: f.status, side: r.side, currency: r.currency, label: f.label, exposure: f.exposure?.amount ?? null, exposureKind: f.exposure?.kind ?? null, records: f.records.length }))),
    potential: trust.filter((r) => r.potential.parts.length).map((r) => ({ side: r.side, currency: r.currency, total: r.potential.total })),
  };
}
export const metricsOf = (d: PilotData): PilotMetrics => pilotMetrics(d);

/** Stable, local, non-cryptographic mask for names in shared reports (the keyed pseudonymisation of the files is the real protection). */
export function mask(label: string): string {
  let h = 0x811c9dc5;
  for (const c of label.trim().toLowerCase()) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619) >>> 0; }
  return `Supplier-${h.toString(16).toUpperCase().padStart(8, '0').slice(0, 6)}`;
}

export function buildPilotHtml(d: PilotData, lang: Lang, redact = true): string {
  const t = (k: string, p?: Record<string, string | number>) => translate(lang, k as MessageKey, p ?? {});
  const m = metricsOf(d);
  const real = d.meta.realDataAttested;
  const cur = (c: string, n: number) => money(n, { lang, currency: c });
  const st = (s: string) => t(`trust.status.${s}`);
  const byStatus = Object.entries(m.findings.byStatus).map(([s, n]) => `${st(s)} ${n}`).join(', ') || '–';
  const byRule = new Map<string, number>();
  for (const f of d.findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  const list = (xs: string[]) => (xs.length ? `<ul>${xs.map((x) => `<li>${e(x)}</li>`).join('')}</ul>` : '<p>–</p>');
  const sideName = (s: string) => t(`trust.find.side.${s}`);
  const tierRows = m.tiers.map((x) => `<tr><th scope="row">${e(sideName(x.side))} ${e(x.currency)}</th><td class="n">${e(cur(x.currency, x.exposure))}</td><td class="n">${e(cur(x.currency, x.confirmedDiscrepancy))}</td><td class="n">${e(cur(x.currency, x.recoverable))}</td><td class="n">${e(cur(x.currency, x.recovered))}</td><td class="n">${e(cur(x.currency, x.prevented))}</td></tr>`).join('');
  const reasons = [...new Set(d.missed.filter((x) => !x.findingId && x.reason.trim()).map((x) => x.reason.trim()))].slice(0, 8);
  const lims = [!real ? t('pilot.rep.lim.synthetic') : '', m.precision.indicative ? t('pilot.rep.lim.indicative') : '', t('pilot.rep.lim.single'), m.recall.value === null ? t('pilot.rep.lim.noRecall') : '', t('pilot.rep.lim.basis'), t('pilot.rep.lim.notAudit'), ...m.warnings.map((w) => t(`pilot.warn.${w}`))].filter(Boolean);
  const need = [...m.checks.filter((c) => !c.ok).map((c) => t('pilot.rep.need.check', { check: t(`pilot.check.${c.id}`) })), m.findings.withheld + d.withheldOther > 0 ? t('pilot.rep.need.withheld', { n: m.findings.withheld + d.withheldOther }) : ''].filter(Boolean);
  const status = t(`pilot.status.${m.commercialStatus}`);
  const confirmedList = d.findings.filter((f) => d.reviews.find((r) => r.id === f.id)?.decision === 'confirmed').slice(0, 30).map((f) => `${redact ? mask(f.label) : f.label} – ${t(`trust.rule.${f.rule}`)} – ${f.exposure !== null ? cur(f.currency, f.exposure) : '–'}`);
  const body = `
<header><h1>${e(t('pilot.rep.title'))}</h1><p class="sub">${e(d.meta.organisation || '–')} · ${e(d.meta.periodFrom || '–')} – ${e(d.meta.periodTo || '–')} · ${e(t('pilot.statusLabel'))}: <b>${e(status)}</b></p>
<p class="banner ${real ? 'ok' : 'warn'}">${e(real ? t('pilot.rep.banner.real') : t('pilot.rep.banner.notreal'))}</p>${redact ? `<p class="sub">${e(t('pilot.rep.redacted'))}</p>` : ''}</header>
<h2>${e(t('pilot.rep.q1'))}</h2><p>${e(t('pilot.rep.found', { n: m.findings.total, byStatus }))}</p><p>${e(t('pilot.rep.byCategory', { list: [...byRule].map(([r, n]) => `${t(`trust.rule.${r}`)} ${n}`).join('; ') || '–' }))}</p>
<h2>${e(t('pilot.rep.q2'))}</h2><p>${e(t('pilot.rep.confirmed', { c: m.review.confirmed, fp: m.review.falsePositive, inc: m.review.inconclusive, aw: m.review.awaiting }))}</p>
<p>${e(m.precision.value === null ? t('pilot.res.precision.none') : t('pilot.res.precision.value', { confirmed: m.precision.confirmed, decided: m.precision.decided }))}${m.precision.indicative && m.precision.value !== null ? ' ' + e(t('pilot.res.precision.indicative')) : ''}${!real && m.precision.value !== null ? ' ' + e(t('pilot.res.precision.notreal')) : ''}</p>${list(confirmedList)}
<h2>${e(t('pilot.rep.q3'))}</h2><p>${e(t('pilot.rep.missed', { n: m.missed.total, f: m.missed.found, m: m.missed.notFound }))}</p><p>${e(m.recall.value === null ? t(`pilot.res.recall.${m.recall.reason}`) : t('pilot.res.recall.value', { found: m.recall.found, known: m.recall.known }))}</p>${reasons.length ? `<p>${e(t('pilot.rep.missedReasons', { list: reasons.join('; ') }))}</p>` : ''}
<h2>${e(t('pilot.rep.q4'))}</h2><p>${e(t('pilot.tier.never'))}</p>${m.tiers.length ? `<table><thead><tr><th></th><th class="n">${e(t('pilot.tier.exposure'))}</th><th class="n">${e(t('pilot.tier.confirmed'))}</th><th class="n">${e(t('pilot.tier.recoverable'))}</th><th class="n">${e(t('pilot.tier.recovered'))}</th><th class="n">${e(t('pilot.tier.prevented'))}</th></tr></thead><tbody>${tierRows}</tbody></table>` : `<p>${e(t('pilot.rep.noValue'))}</p>`}
${m.excluded.recoveredWithoutEvidence + m.excluded.preventedWithoutEvidence > 0 ? `<p class="m">${e(t('pilot.tier.excluded', { rec: num(m.excluded.recoveredWithoutEvidence, lang), prev: num(m.excluded.preventedWithoutEvidence, lang) }))}</p>` : ''}
<h3>${e(t('pilot.rep.defs'))}</h3><ul>${['exposure', 'confirmed', 'recoverable', 'recovered', 'prevented'].map((k) => `<li><b>${e(t(`pilot.tier.${k}`))}:</b> ${e(t(`pilot.tier.d.${k}`))}</li>`).join('')}</ul>
<h2>${e(t('pilot.rep.q5'))}</h2><p>${e(m.time.reviewed ? t('pilot.time.verification', { min: num(m.time.verificationMinutes, lang), n: m.time.reviewed, avg: m.time.avgMinutes !== null ? t('pilot.time.avg', { avg: num(Math.round(m.time.avgMinutes * 10) / 10, lang) }) : '' }) : t('pilot.time.none'))}</p>${m.time.baselineMinutes !== null ? `<p>${e(t('pilot.time.baseline', { min: num(m.time.baselineMinutes, lang), prep: m.time.prepMinutes === null ? '–' : num(m.time.prepMinutes, lang) }))}</p>` : ''}<p>${e(m.time.savedMinutes !== null ? t('pilot.time.saved', { min: num(m.time.savedMinutes, lang) }) : t(`pilot.time.saved.${m.time.savedReason}`))}</p>
<h2>${e(t('pilot.rep.q6'))}</h2>${list(lims)}
<h2>${e(t('pilot.rep.q7'))}</h2>${need.length ? list(need) : `<p>${e(t('pilot.rep.need.none'))}</p>`}`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(t('pilot.rep.title'))}</title><style>
body{font:14px/1.5 system-ui,sans-serif;color:#0f172a;max-width:860px;margin:24px auto;padding:0 16px}header{border-bottom:3px solid #4f46e5;margin-bottom:14px}h1{margin:0;font-size:26px}h2{font-size:17px;margin:24px 0 6px;color:#312e81;border-bottom:1px solid #e2e8f0}.sub{color:#475569}.banner{padding:8px 12px;border-radius:6px}.banner.ok{background:#ecfdf5}.banner.warn{background:#fef3c7;font-weight:600}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left}.n{text-align:right;font-variant-numeric:tabular-nums}.m{color:#64748b;font-size:12px}
</style></head><body>${body}</body></html>`;
}

export function pilotLedgerCsv(d: PilotData, lang: Lang, redact = true): string {
  const t = (k: string) => translate(lang, k as MessageKey);
  const head = ['ID', t('pilot.ledger.finding'), t('pilot.ledger.status'), 'Side', 'Currency', t('pilot.fi.exposure'), t('pilot.ledger.decision'), t('pilot.fi.recon'), t('pilot.fi.reason'), t('pilot.fi.confirmed'), t('pilot.fi.recoverable'), t('pilot.fi.recovered'), t('pilot.fi.recoveredEv'), t('pilot.fi.prevented'), t('pilot.fi.preventedEv'), t('pilot.fi.minutes'), 'Reviewer'];
  const rows = d.findings.map((f) => { const r = d.reviews.find((x) => x.id === f.id); return [f.id, `${t(`trust.rule.${f.rule}`)} – ${redact ? mask(f.label) : f.label}`, t(`trust.status.${f.status}`), f.side, f.currency, f.exposure === null ? '' : String(f.exposure), t(`pilot.decision.${r?.decision ?? 'not_reviewed'}`), r?.reconciliation ?? '', r?.reason ?? '', r?.confirmedDiscrepancy?.toString() ?? '', r?.recoverable?.toString() ?? '', r?.recovered?.toString() ?? '', r?.recoveredEvidence ?? '', r?.prevented?.toString() ?? '', r?.preventedEvidence ?? '', r?.minutes?.toString() ?? '', r?.reviewer ?? '']; });
  const missed = d.missed.map((x) => [x.id, `${t('pilot.ms.missed')}: ${x.description}`, x.category, '', x.currency, x.amount?.toString() ?? '', x.findingId ? t('pilot.ms.found') : t('pilot.ms.missed'), x.sourceRefs, x.reason, '', '', '', '', '', '', '', '']);
  return '﻿' + [head, ...rows, ...missed].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
