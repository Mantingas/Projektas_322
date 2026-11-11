/**
 * Locally generated report. Pure string builders: HTML is escaped, CSV is protected against spreadsheet formula injection.
 */

export interface ReportInsight {
  title: string;
  body: string;
  action: string;
  reliability: string;
  impact: string;
  evidence: string[];
}

export interface ReportInput {
  title: string;
  subtitle: string;
  generatedAt: string;
  lang: string;
  kpis: { label: string; value: string }[];
  insights: ReportInsight[];
  labels: { insights: string; action: string; reliability: string; impact: string; footer: string; kpis: string; notes?: string };
  /** Data limitations that qualify every figure below (e.g. rows that were not imported): printed before the figures, never dropped from an export. */
  notes?: string[];
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Cells that start with these characters are executed as formulas by Excel / LibreOffice / Sheets. */
const FORMULA_START = /^[=+\-@\t\r\n]/;

export function csvCell(value: string | number): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = value;
  if (FORMULA_START.test(s)) s = "'" + s;
  if (/[",;\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function renderReportCsv(r: ReportInput): string {
  const rows: (string | number)[][] = [
    [r.title],
    [r.subtitle],
    ...(r.notes?.length ? [[], [r.labels.notes ?? 'Data limitations'], ...r.notes.map((n) => [n])] : []),
    [],
    [r.labels.kpis],
    ...r.kpis.map((k) => [k.label, k.value]),
    [],
    [r.labels.insights, r.labels.impact, r.labels.reliability, r.labels.action],
    ...r.insights.map((i) => [i.title + ' — ' + i.body, i.impact, i.reliability, i.action]),
  ];
  return '﻿' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export function renderReportHtml(r: ReportInput): string {
  const e = escapeHtml;
  const kpis = r.kpis.map((k) => `<div class="k"><span>${e(k.label)}</span><b>${e(k.value)}</b></div>`).join('');
  const ins = r.insights
    .map(
      (i, n) => `<section><h3>${n + 1}. ${e(i.title)}</h3><p>${e(i.body)}</p>` +
        (i.evidence.length ? `<ul>${i.evidence.map((x) => `<li>${e(x)}</li>`).join('')}</ul>` : '') +
        `<p><b>${e(r.labels.action)}:</b> ${e(i.action)}</p><p class="m">${e(r.labels.reliability)}: ${e(i.reliability)} · ${e(r.labels.impact)}: ${e(i.impact)}</p></section>`,
    )
    .join('');
  return `<!doctype html><html lang="${e(r.lang)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(r.title)}</title><style>
body{font:15px/1.5 system-ui,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem;color:#111}h1{margin:0}h2{margin-top:2rem}.s{color:#555}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem;margin:1rem 0}.k{border:1px solid #ddd;border-radius:8px;padding:.6rem .8rem}.k span{display:block;color:#555;font-size:.8rem}.k b{font-size:1.15rem}
section{border:1px solid #ddd;border-radius:8px;padding:.2rem 1rem;margin:.8rem 0;break-inside:avoid}.m{color:#555;font-size:.85rem}footer{margin-top:2rem;color:#555;font-size:.8rem}
</style></head><body><h1>${e(r.title)}</h1><p class="s">${e(r.subtitle)} · ${e(r.generatedAt)}</p><h2>${e(r.labels.kpis)}</h2><div class="g">${kpis}</div><h2>${e(r.labels.insights)}</h2>${ins}<footer>${e(r.labels.footer)}</footer></body></html>`;
}
