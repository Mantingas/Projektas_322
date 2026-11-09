import { escapeHtml as e } from './export';

/** Dependency-free static SVG charts for the printable report. All text is escaped. */
const C = { a: '#4f46e5', b: '#94a3b8', up: '#059669', down: '#dc2626', grid: '#e2e8f0', text: '#334155' };

const f = (n: number) => (Math.round(n * 10) / 10).toString();

export function lineChartSvg(o: {
  title: string;
  width?: number;
  height?: number;
  xLabels: string[];
  series: { name: string; color?: string; dashed?: boolean; values: number[] }[];
  yFormat: (n: number) => string;
}): string {
  const W = o.width ?? 640, H = o.height ?? 220, L = 64, R = 12, T = 12, B = 34;
  const all = o.series.flatMap((s) => s.values);
  const max = Math.max(1, ...all), min = Math.min(0, ...all);
  const n = Math.max(2, o.xLabels.length);
  const x = (i: number) => L + (i * (W - L - R)) / (n - 1);
  const y = (v: number) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  const grid = [0, 0.5, 1].map((t) => { const v = min + (max - min) * t; return `<line x1="${L}" x2="${W - R}" y1="${f(y(v))}" y2="${f(y(v))}" stroke="${C.grid}"/><text x="${L - 6}" y="${f(y(v) + 4)}" text-anchor="end" font-size="10" fill="${C.text}">${e(o.yFormat(v))}</text>`; }).join('');
  const lines = o.series.map((s, k) => `<polyline fill="none" stroke="${s.color ?? (k ? C.b : C.a)}" stroke-width="2" ${s.dashed ? 'stroke-dasharray="5 4"' : ''} points="${s.values.map((v, i) => `${f(x(i))},${f(y(v))}`).join(' ')}"/>`).join('');
  const step = Math.max(1, Math.ceil(o.xLabels.length / 6));
  const xl = o.xLabels.map((t, i) => (i % step === 0 ? `<text x="${f(x(i))}" y="${H - 14}" text-anchor="middle" font-size="10" fill="${C.text}">${e(t)}</text>` : '')).join('');
  const legend = o.series.map((s, k) => `<text x="${L + k * 150}" y="${H - 1}" font-size="10" fill="${s.color ?? (k ? C.b : C.a)}">■ ${e(s.name)}</text>`).join('');
  return `<svg role="img" aria-label="${e(o.title)}" viewBox="0 0 ${W} ${H}" width="100%">${grid}${lines}${xl}${legend}</svg>`;
}

export function hBarSvg(o: { title: string; width?: number; items: { label: string; value: number; display: string }[] }): string {
  const W = o.width ?? 640, rowH = 22, L = 190, R = 90, H = o.items.length * rowH + 8;
  const max = Math.max(1, ...o.items.map((i) => Math.abs(i.value)));
  const rows = o.items.map((it, i) => {
    const w = (Math.abs(it.value) / max) * (W - L - R);
    const yy = 4 + i * rowH;
    return `<text x="${L - 6}" y="${yy + 14}" text-anchor="end" font-size="11" fill="${C.text}">${e(it.label.length > 28 ? it.label.slice(0, 27) + '…' : it.label)}</text><rect x="${L}" y="${yy + 3}" width="${f(w)}" height="14" fill="${it.value < 0 ? C.down : C.a}" rx="2"/><text x="${f(L + w + 5)}" y="${yy + 14}" font-size="11" fill="${C.text}">${e(it.display)}</text>`;
  }).join('');
  return `<svg role="img" aria-label="${e(o.title)}" viewBox="0 0 ${W} ${H}" width="100%">${rows}</svg>`;
}

export function waterfallSvg(o: { title: string; width?: number; start: { label: string; value: number }; end: { label: string; value: number }; steps: { label: string; delta: number }[]; format: (n: number) => string }): string {
  const W = o.width ?? 640, H = 240, L = 8, R = 8, T = 22, B = 56;
  const bars: { label: string; from: number; to: number; kind: 'total' | 'up' | 'down'; text: string }[] = [{ label: o.start.label, from: 0, to: o.start.value, kind: 'total', text: o.format(o.start.value) }];
  let run = o.start.value;
  for (const s of o.steps) { bars.push({ label: s.label, from: run, to: run + s.delta, kind: s.delta >= 0 ? 'up' : 'down', text: (s.delta >= 0 ? '+' : '') + o.format(s.delta) }); run += s.delta; }
  bars.push({ label: o.end.label, from: 0, to: o.end.value, kind: 'total', text: o.format(o.end.value) });
  const vals = bars.flatMap((b) => [b.from, b.to]);
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const y = (v: number) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  const bw = (W - L - R) / bars.length;
  const out = bars.map((b, i) => {
    const x0 = L + i * bw + bw * 0.15, w = bw * 0.7;
    const top = y(Math.max(b.from, b.to)), h = Math.max(1, Math.abs(y(b.from) - y(b.to)));
    const col = b.kind === 'total' ? C.a : b.kind === 'up' ? C.up : C.down;
    const lab = b.label.length > 12 ? b.label.slice(0, 11) + '…' : b.label;
    return `<rect x="${f(x0)}" y="${f(top)}" width="${f(w)}" height="${f(h)}" fill="${col}" rx="2"/><text x="${f(x0 + w / 2)}" y="${f(top - 4)}" text-anchor="middle" font-size="9" fill="${C.text}">${e(b.text)}</text><text x="${f(x0 + w / 2)}" y="${H - 38}" text-anchor="middle" font-size="9" fill="${C.text}" transform="rotate(25 ${f(x0 + w / 2)} ${H - 38})">${e(lab)}</text>`;
  }).join('');
  return `<svg role="img" aria-label="${e(o.title)}" viewBox="0 0 ${W} ${H}" width="100%">${out}</svg>`;
}
