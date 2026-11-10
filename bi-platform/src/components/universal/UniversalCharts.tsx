'use client';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { useLang } from '../LangProvider';
import { ChartCard } from '../dashboard/Charts';
import type { UChart } from '@/engine/universal/charts';
import { fmtDate, num, type MessageKey } from '@/i18n';

const COLOR = '#4f46e5', MUTED = '#94a3b8', GRID = '#94a3b855', HOT = '#dc2626';

export function UChartCard({ chart }: { chart: UChart }) {
  const { t, lang } = useLang();
  const n = (v: number) => num(v, lang);
  const compact = (v: number) => new Intl.NumberFormat(lang === 'en' ? 'en-GB' : lang === 'pl' ? 'pl-PL' : 'lt-LT', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const dateLabel = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? fmtDate(iso, lang) : iso);
  const matrixCorr = chart.kind === 'heatmap' && chart.id === 'heat:corr';
  const title = t((matrixCorr ? 'uch.matrix.corr' : `uch.${chart.question}`) as MessageKey, { measure: chart.title.measure ?? '', dim: chart.title.dim ?? '', x: chart.title.x ?? '', y: chart.title.y ?? '' });
  const range = chart.scope.from && chart.scope.to ? ` · ${t('uni.scope.range', { from: { date: chart.scope.from }, to: { date: chart.scope.to } })}` : '';
  const subtitle = `${t('uch.scope', { rows: chart.scope.rows, total: chart.scope.totalRows })}${chart.scope.filters ? ` · ${t('uch.scope.filtered')}` : ''}${range}${chart.agg ? ` · ${t(`uch.agg.${chart.agg}` as MessageKey)}` : ''}`;
  const unit = chart.unit || t('uch.unit.none');
  const alt = { headers: chart.table.headers, rows: chart.table.rows.map((r) => r.map((c, i) => (typeof c === 'number' && i > 0 ? n(c) : String(c)))) };
  let note: string | undefined = t(`uch.why.${chart.reason}` as MessageKey);
  let body: React.ReactNode = null;

  if (chart.kind === 'line') {
    const pts = chart.data as { x: string; y: number | null; partial: boolean }[];
    if (pts.some((p) => p.partial)) note += ` ${t('uch.partial')}`;
    body = (
      <ResponsiveContainer width="100%" height="100%"><LineChart data={pts} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="x" tickFormatter={dateLabel} fontSize={11} minTickGap={24} /><YAxis tickFormatter={compact} fontSize={11} width={48} />
        <Tooltip formatter={(v) => n(Number(v))} labelFormatter={(l) => dateLabel(String(l))} />
        <Line type="monotone" dataKey="y" stroke={COLOR} strokeWidth={2} connectNulls dot={(p: { cx?: number; cy?: number; payload?: { partial: boolean }; index?: number }) => <circle key={p.index} cx={p.cx} cy={p.cy} r={p.payload?.partial ? 5 : 3} fill={p.payload?.partial ? '#fff' : COLOR} stroke={COLOR} strokeWidth={p.payload?.partial ? 2 : 0} />} />
      </LineChart></ResponsiveContainer>
    );
  } else if (chart.kind === 'bar') {
    const rows = (chart.data as { key: string; value: number }[]).map((r) => ({ key: r.key, value: r.value }));
    body = (
      <ResponsiveContainer width="100%" height="100%"><BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={GRID} horizontal={false} /><XAxis type="number" tickFormatter={compact} fontSize={11} /><YAxis type="category" dataKey="key" width={96} fontSize={11} />
        <Tooltip formatter={(v) => n(Number(v))} /><Bar dataKey="value" fill={COLOR} radius={[0, 3, 3, 0]} />
      </BarChart></ResponsiveContainer>
    );
  } else if (chart.kind === 'pareto') {
    const rows = (chart.data as { key: string; value: number; cum: number }[]).map((r) => ({ key: r.key, value: r.value, cum: Math.round(r.cum * 1000) / 10 }));
    body = (
      <ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="key" fontSize={10} interval={0} angle={-30} textAnchor="end" height={48} /><YAxis yAxisId="l" tickFormatter={compact} fontSize={11} width={48} /><YAxis yAxisId="r" orientation="right" unit="%" domain={[0, 100]} fontSize={11} width={40} />
        <Tooltip formatter={(v, name) => (name === 'cum' ? `${v}%` : n(Number(v)))} /><Legend formatter={(v) => (v === 'cum' ? t('uch.cumulative') : (chart.title.measure ?? ''))} />
        <Bar yAxisId="l" dataKey="value" fill={COLOR} /><Line yAxisId="r" dataKey="cum" stroke={HOT} strokeWidth={2} dot={false} />
      </ComposedChart></ResponsiveContainer>
    );
  } else if (chart.kind === 'histogram') {
    const bins = (chart.data as { from: number; to: number; count: number }[]).map((b) => ({ label: b.from === b.to ? n(b.from) : `${compact(b.from)}–${compact(b.to)}`, count: b.count }));
    body = (
      <ResponsiveContainer width="100%" height="100%"><BarChart data={bins} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="label" fontSize={10} interval="preserveStartEnd" minTickGap={16} /><YAxis fontSize={11} width={36} allowDecimals={false} />
        <Tooltip /><Bar dataKey="count" fill={COLOR} />
      </BarChart></ResponsiveContainer>
    );
  } else if (chart.kind === 'scatter') {
    const d = chart.data as { points: { x: number; y: number }[]; r: number; rho: number; n: number; sampled: boolean; outlierSensitive: boolean };
    note += ` ${t('uch.coef', { rho: Math.round(d.rho * 100) / 100, r: Math.round(d.r * 100) / 100, n: d.n })}`;
    if (d.outlierSensitive) note += ` ${t('uch.sensitive')}`;
    if (d.sampled) note += ` ${t('uch.sampled', { n: d.points.length })}`;
    body = (
      <ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 8, right: 12, bottom: 16, left: 0 }}>
        <CartesianGrid stroke={GRID} /><XAxis type="number" dataKey="x" name={chart.title.x} tickFormatter={compact} fontSize={11} label={{ value: chart.title.x, position: 'insideBottom', offset: -8, fontSize: 11 }} />
        <YAxis type="number" dataKey="y" name={chart.title.y} tickFormatter={compact} fontSize={11} width={48} />
        <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v) => n(Number(v))} /><Scatter data={d.points} fill={COLOR} fillOpacity={0.55} />
      </ScatterChart></ResponsiveContainer>
    );
  } else {
    const d = chart.data as { rows: string[]; cols: string[]; cells: (number | null)[][]; kind: 'count' | 'corr' };
    const flat = d.cells.flat().filter((v): v is number => v !== null);
    const max = Math.max(1, ...flat.map((v) => Math.abs(v)));
    body = (
      <div className="h-full overflow-auto" data-testid="heatmap">
        <table className="w-full border-collapse text-xs"><thead><tr><th /> {d.cols.map((c) => <th key={c} className="px-1 py-1 text-slate-500">{c}</th>)}</tr></thead>
          <tbody>{d.rows.map((r, i) => (
            <tr key={r}><th className="whitespace-nowrap pr-2 text-right font-normal text-slate-500">{r}</th>
              {d.cells[i]!.map((v, j) => <td key={j} className="border border-white p-1 text-center tabular-nums dark:border-slate-900" style={{ background: v === null ? 'transparent' : `rgba(${v < 0 ? '220,38,38' : '79,70,229'},${(Math.abs(v) / max) * 0.75})`, color: v !== null && Math.abs(v) / max > 0.5 ? '#fff' : undefined }}>{v === null ? '' : d.kind === 'corr' ? v.toFixed(2) : n(v)}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    );
  }
  void Cell;
  return <ChartCard id={chart.id} title={title} subtitle={subtitle} unit={unit} alt={alt} note={note}>{body}</ChartCard>;
}
