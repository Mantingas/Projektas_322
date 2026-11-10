import { escapeHtml as e } from './export';

export interface SummaryDoc {
  lang: string;
  title: string;
  subtitle: string;
  generatedAt: string;
  periodLine: string;
  filtersLine?: string;
  executive: string[];
  kpis: { label: string; current: string; previous: string; change: string; note: string; tone: 'good' | 'bad' | 'flat' | 'na' }[];
  charts: { title: string; note: string; svg: string }[];
  insights: { title: string; body: string; impact: string; contributors: string[]; why: string; action: string; sufficiency: string }[];
  /** extra bullet sections (e.g. confirmed calculations, opportunities, risks, scenarios, withheld conclusions) */
  sections?: { title: string; items: string[]; note?: string }[];
  limitations: string[];
  methodology: string[];
  labels: { executive: string; kpi: string; metric: string; current: string; previous: string; change: string; charts: string; insights: string; contributors: string; why: string; action: string; sufficiency: string; impact: string; limitations: string; methodology: string; association: string; footer: string };
}

/** Professional, print-ready management summary. Self-contained: no scripts, no external resources (CSP default-src 'none'). */
export function renderManagementSummary(d: SummaryDoc): string {
  const L = d.labels;
  const tone = { good: '#047857', bad: '#b91c1c', flat: '#475569', na: '#94a3b8' };
  const kpiRows = d.kpis.map((k) => `<tr><th scope="row">${e(k.label)}</th><td class="n">${e(k.current)}</td><td class="n">${e(k.previous)}</td><td class="n" style="color:${tone[k.tone]};font-weight:600">${e(k.change)}</td><td class="note">${e(k.note)}</td></tr>`).join('');
  const charts = d.charts.map((c) => `<figure><figcaption><b>${e(c.title)}</b><span>${e(c.note)}</span></figcaption>${c.svg}</figure>`).join('');
  const ins = d.insights.map((i, n) => `<section class="ins"><h3>${n + 1}. ${e(i.title)}</h3><p>${e(i.body)}</p>${i.contributors.length ? `<p class="k">${e(L.contributors)}</p><ul>${i.contributors.map((c) => `<li>${e(c)}</li>`).join('')}</ul>` : ''}<p><span class="k">${e(L.why)}:</span> ${e(i.why)}</p><p><span class="k">${e(L.action)}:</span> ${e(i.action)}</p><p class="m">${e(L.impact)}: ${e(i.impact)} · ${e(L.sufficiency)}: ${e(i.sufficiency)}</p></section>`).join('');
  return `<!doctype html><html lang="${e(d.lang)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(d.title)}</title><style>
@page{size:A4;margin:16mm 14mm}
*{box-sizing:border-box}body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;max-width:860px;margin:24px auto;padding:0 16px}
header{border-bottom:3px solid #4f46e5;padding-bottom:10px;margin-bottom:14px}h1{margin:0;font-size:26px}h2{font-size:17px;margin:26px 0 8px;color:#312e81;border-bottom:1px solid #e2e8f0;padding-bottom:4px}h3{font-size:15px;margin:0 0 4px}
.sub{color:#475569;margin:2px 0}.exec{background:#eef2ff;border-left:4px solid #4f46e5;padding:10px 14px;border-radius:4px}.exec p{margin:4px 0}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}thead th{background:#f1f5f9;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#475569}.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.note{color:#64748b;font-size:12px}
figure{margin:12px 0;break-inside:avoid}figcaption{display:flex;justify-content:space-between;gap:12px;font-size:13px;margin-bottom:4px}figcaption span{color:#64748b;font-size:12px}
.ins{border:1px solid #e2e8f0;border-radius:8px;padding:6px 14px;margin:10px 0;break-inside:avoid}.ins p{margin:6px 0}.k{font-weight:600;color:#334155}.m{color:#64748b;font-size:12px}
.lim li,.meth li{margin:3px 0}.lim{background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 8px 8px 28px}
footer{margin-top:28px;padding-top:8px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px}
@media print{body{margin:0;max-width:none;padding:0}h2{break-after:avoid}}
</style></head><body>
<header><h1>${e(d.title)}</h1><p class="sub">${e(d.subtitle)} · ${e(d.generatedAt)}</p><p class="sub">${e(d.periodLine)}</p>${d.filtersLine ? `<p class="sub">${e(d.filtersLine)}</p>` : ''}</header>
<h2>${e(L.executive)}</h2><div class="exec">${d.executive.map((x) => `<p>${e(x)}</p>`).join('')}</div>
<h2>${e(L.kpi)}</h2><table><thead><tr><th>${e(L.metric)}</th><th class="n">${e(L.current)}</th><th class="n">${e(L.previous)}</th><th class="n">${e(L.change)}</th><th></th></tr></thead><tbody>${kpiRows}</tbody></table>
${d.charts.length ? `<h2>${e(L.charts)}</h2>${charts}` : ''}
<h2>${e(L.insights)}</h2>${ins}<p class="m">${e(L.association)}</p>
${(d.sections ?? []).map((x) => `<h2>${e(x.title)}</h2>${x.note ? `<p class="m">${e(x.note)}</p>` : ''}${x.items.length ? `<ul class="sec">${x.items.map((i) => `<li>${e(i)}</li>`).join('')}</ul>` : '<p class="m">–</p>'}`).join('')}
<h2>${e(L.limitations)}</h2><ul class="lim">${d.limitations.map((x) => `<li>${e(x)}</li>`).join('')}</ul>
<h2>${e(L.methodology)}</h2><ul class="meth">${d.methodology.map((x) => `<li>${e(x)}</li>`).join('')}</ul>
<footer>${e(L.footer)}</footer></body></html>`;
}
