'use client';
import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import { useLang } from '../LangProvider';
import { Card, CardTitle } from '../ui/card';
import type { ChartModel } from '@/engine/analytics/view';
import { composition, pareto, topBottom, waterfall, type EntityRow } from '@/engine/analytics/compare';
import type { ChartId } from '@/engine/analytics/charts';
import type { Dimension } from '@/engine/analytics/filters';
import { dateRange } from '@/lib/dashFormat';
import { fmtDate, money, num, pct, type MessageKey } from '@/i18n';

const COLORS = { cur: '#4f46e5', prev: '#94a3b8', up: '#059669', down: '#dc2626', total: '#4f46e5', grid: '#94a3b855' };

export interface ChartProps {
  model: ChartModel;
  onFilter: (dim: Dimension, key: string) => void;
}

interface Alt {
  headers: string[];
  rows: string[][];
}

export function ChartCard({ id, title, subtitle, unit, alt, children, note }: { id: string; title: string; subtitle?: string; unit?: string; alt: Alt; children: ReactNode; note?: string }) {
  const { t } = useLang();
  return (
    <Card className="space-y-2" data-testid={`chart-${id}`} id={`chart-${id}`}>
      <div>
        <CardTitle>{title}</CardTitle>
        <p className="text-xs text-slate-500">{[subtitle, unit].filter(Boolean).join(' · ')}</p>
      </div>
      <div className="h-64 w-full" role="img" aria-label={`${title}. ${subtitle ?? ''}`}>{children}</div>
      {note && <p className="text-xs text-slate-500">{note}</p>}
      <details className="text-xs">
        <summary className="cursor-pointer text-indigo-700 dark:text-indigo-300">{t('ch.showTable')}</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left">
            <thead><tr>{alt.headers.map((h, i) => <th key={i} className={`px-2 py-1 text-slate-500 ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
            <tbody>{alt.rows.map((r, i) => <tr key={i} className="border-t border-slate-100 dark:border-slate-800">{r.map((c, j) => <td key={j} className={`px-2 py-1 ${j ? 'text-right tabular-nums' : ''}`}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

function useFmt(model: ChartModel) {
  const { lang, t } = useLang();
  const cur = model.series.currency;
  const m = (n: number) => money(n, { lang, currency: cur });
  const short = (n: number) => new Intl.NumberFormat(lang === 'en' ? 'en-GB' : lang === 'pl' ? 'pl-PL' : 'lt-LT', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const purchasing = model.module === 'purchasing';
  /** the value series is called "Sales" or "Spend"; the main titles differ per module */
  const vl = t(purchasing ? 'ch.spend' : 'ch.sales');
  const ttl = (id: 'trend' | 'comparison' | 'waterfall' | 'pareto') => t((purchasing ? `pch.${id}` : `ch.${id}`) as MessageKey);
  return { lang, t, cur, m, short, vl, ttl, purchasing };
}

export function TrendChart({ model }: ChartProps) {
  const { lang, t, cur, m, short, vl, ttl } = useFmt(model);
  const data = model.trend.map((p) => ({ name: p.start, revenue: p.revenue }));
  return (
    <ChartCard id="trend" title={ttl('trend')} subtitle={dateRange(model.bounds.dateMin, model.bounds.dateMax, lang)} unit={t('ch.unit', { currency: cur })} alt={{ headers: [t('ch.date'), vl], rows: data.map((d) => [fmtDate(d.name, lang), m(d.revenue)]) }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="name" tickFormatter={(v: string) => fmtDate(v, lang).slice(0, 5)} tick={{ fontSize: 11 }} minTickGap={24} />
          <YAxis tickFormatter={short} width={52} tick={{ fontSize: 11 }} />
          <Tooltip labelFormatter={(v) => fmtDate(String(v), lang)} formatter={(v) => [m(Number(v)), vl]} />
          <Line type="linear" dataKey="revenue" stroke={COLORS.cur} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function ComparisonChart({ model }: ChartProps) {
  const { lang, t, cur, m, short, ttl } = useFmt(model);
  const { points, bucketDays } = model.aligned;
  const p = model.periods;
  const data = points.map((x) => ({ name: x.index + 1, current: x.current, previous: x.previous, cd: x.currentFrom, pd: x.previousFrom }));
  const unitLabel = bucketDays === 1 ? '' : ` (${bucketDays} d.)`;
  return (
    <ChartCard id="comparison" title={ttl('comparison')} subtitle={t('per.describe', { cfrom: fmtDate(p.current.from, lang), cto: fmtDate(p.current.to, lang), cdays: p.currentDays, pfrom: fmtDate(p.previous.from, lang), pto: fmtDate(p.previous.to, lang), pdays: p.previousDays })} unit={t('ch.unit', { currency: cur })}
      alt={{ headers: [t('ch.date'), t('per.current'), t('per.previous')], rows: data.map((d) => [`${fmtDate(d.cd, lang)} / ${fmtDate(d.pd, lang)}`, m(d.current), m(d.previous)]) }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}${unitLabel ? '' : ''}`} />
          <YAxis tickFormatter={short} width={52} tick={{ fontSize: 11 }} />
          <Tooltip labelFormatter={(v, pl) => { const row = pl?.[0]?.payload as { cd: string; pd: string } | undefined; return row ? `${fmtDate(row.cd, lang)} · ${fmtDate(row.pd, lang)}` : String(v); }} formatter={(v, n) => [m(Number(v)), n === 'current' ? t('per.current') : t('per.previous')]} />
          <Legend formatter={(v) => (v === 'current' ? t('per.current') : t('per.previous'))} />
          <Line type="linear" dataKey="current" stroke={COLORS.cur} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="linear" dataKey="previous" stroke={COLORS.prev} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function RankBars({ rows, dim, onFilter, color, model }: { rows: EntityRow[]; dim: Dimension; onFilter: ChartProps['onFilter']; color: string; model: ChartModel }) {
  const { m, short, vl } = useFmt(model);
  const h = Math.max(120, rows.length * 30 + 24);
  return (
    <div style={{ height: h }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows.map((r) => ({ key: r.key, name: r.label, value: r.current }))} layout="vertical" margin={{ left: 4, right: 16, top: 0, bottom: 0 }}>
          <CartesianGrid stroke={COLORS.grid} horizontal={false} />
          <XAxis type="number" tickFormatter={short} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} tickFormatter={(v: string) => (v.length > 20 ? v.slice(0, 19) + '…' : v)} />
          <Tooltip formatter={(v) => [m(Number(v)), vl]} />
          <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} isAnimationActive={false} cursor="pointer" onClick={(d) => onFilter(dim, (d as unknown as { key: string }).key)} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RankingChart({ model, dim, onFilter, n = 5 }: ChartProps & { dim: Dimension; n?: number }) {
  const { lang, t, cur, m, vl, purchasing } = useFmt(model);
  const table = model.tables[dim]!;
  const { top, bottom } = topBottom(table.rows, n);
  const id = dim === 'customer' ? 'topCustomers' : dim === 'supplier' ? 'topSuppliers' : dim === 'product' ? 'topProducts' : 'salespeople';
  const title = purchasing && dim === 'product' ? t('pch.productRank') : t(`ch.${id}` as MessageKey);
  const all = [...top, ...bottom];
  return (
    <Card className="space-y-3" data-testid={`chart-${id}`} id={`chart-${id}`}>
      <div><CardTitle>{title}</CardTitle><p className="text-xs text-slate-500">{dateRange(model.periods.current.from, model.periods.current.to, lang)} · {t('ch.unit', { currency: cur })} · {t('ch.clickHint')}</p></div>
      <div className="text-xs font-medium text-slate-500">{t('ch.top')}</div>
      <RankBars rows={top} dim={dim} onFilter={onFilter} color={COLORS.cur} model={model} />
      {bottom.length > 0 && (<><div className="text-xs font-medium text-slate-500">{t('ch.bottom')}</div><RankBars rows={bottom} dim={dim} onFilter={onFilter} color={COLORS.prev} model={model} /></>)}
      <details className="text-xs">
        <summary className="cursor-pointer text-indigo-700 dark:text-indigo-300">{t('ch.showTable')}</summary>
        <table className="mt-2 w-full text-left"><thead><tr><th className="px-2 py-1 text-slate-500">{t('ch.item')}</th><th className="px-2 py-1 text-right text-slate-500">{vl}</th></tr></thead>
          <tbody>{all.map((r) => <tr key={r.key} className="border-t border-slate-100 dark:border-slate-800"><td className="px-2 py-1">{r.label}</td><td className="px-2 py-1 text-right tabular-nums">{m(r.current)}</td></tr>)}</tbody></table>
      </details>
    </Card>
  );
}

export function CategoryChart({ model, onFilter }: ChartProps) {
  const { lang, t, cur, m } = useFmt(model);
  const table = model.tables.category!;
  const comp = composition(table);
  const keyOf = (label: string) => table.rows.find((r) => r.label === label)?.key;
  const data = comp.map((c) => ({ name: c.other ? t('ch.other') : c.label, value: c.value, share: c.share, other: c.other }));
  return (
    <ChartCard id="category" title={t('ch.category')} subtitle={dateRange(model.periods.current.from, model.periods.current.to, lang)} unit={t('ch.unit', { currency: cur })} note={t('ch.clickHint')}
      alt={{ headers: [t('ch.item'), t('ch.sales'), t('tbl.share')], rows: data.map((d) => [d.name, m(d.value), pct(d.share, lang)]) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 40, top: 0, bottom: 0 }}>
          <CartesianGrid stroke={COLORS.grid} horizontal={false} />
          <XAxis type="number" tickFormatter={(v: number) => pct(v, lang)} domain={[0, 1]} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v, _n, p) => [`${pct(Number(v), lang)} · ${m((p.payload as { value: number }).value)}`, t('tbl.share')]} />
          <Bar dataKey="share" fill={COLORS.cur} radius={[0, 4, 4, 0]} isAnimationActive={false} cursor="pointer" onClick={(d) => { const k = keyOf((d as unknown as { name: string }).name); if (k) onFilter('category', k); }} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function WaterfallChart({ model, dim, onFilter }: ChartProps & { dim?: Dimension }) {
  const { lang, t, cur, m, short, ttl } = useFmt(model);
  const d = dim ?? model.waterfall!.dimension;
  const table = model.tables[d]!;
  const w = dim ? waterfall(table) : model.waterfall!.data;
  let run = w.start;
  const rows: { name: string; key?: string; base: number; up: number; down: number; total: number; delta: number }[] = [{ name: t('ch.start'), base: 0, up: 0, down: 0, total: w.start, delta: w.start }];
  for (const s of w.steps) {
    const name = s.kind === 'other' ? t('ch.other') : s.kind === 'unassigned' ? t('ch.unassigned') : s.label;
    if (s.delta >= 0) rows.push({ name, key: s.kind === 'entity' ? s.key : undefined, base: run, up: s.delta, down: 0, total: 0, delta: s.delta });
    else rows.push({ name, key: s.kind === 'entity' ? s.key : undefined, base: run + s.delta, up: 0, down: -s.delta, total: 0, delta: s.delta });
    run += s.delta;
  }
  rows.push({ name: t('ch.end'), base: 0, up: 0, down: 0, total: w.end, delta: w.end });
  return (
    <ChartCard id="waterfall" title={`${ttl('waterfall')} – ${t(`dim.${d}` as MessageKey)}`} subtitle={t('per.describe', { cfrom: fmtDate(model.periods.current.from, lang), cto: fmtDate(model.periods.current.to, lang), cdays: model.periods.currentDays, pfrom: fmtDate(model.periods.previous.from, lang), pto: fmtDate(model.periods.previous.to, lang), pdays: model.periods.previousDays })}
      unit={t('ch.unit', { currency: cur })} note={t('ch.waterfallNote', { entity: t(`dim1.${d}` as MessageKey) })}
      alt={{ headers: [t('ch.item'), t('ch.delta')], rows: rows.map((r) => [r.name, m(r.delta)]) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 40 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="name" interval={0} angle={-30} textAnchor="end" height={60} tick={{ fontSize: 10 }} tickFormatter={(v: string) => (v.length > 14 ? v.slice(0, 13) + '…' : v)} />
          <YAxis tickFormatter={short} width={52} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(_v, _n, p) => [m((p.payload as { delta: number }).delta), t('ch.delta')]} />
          <Bar dataKey="base" stackId="a" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="total" stackId="a" fill={COLORS.total} isAnimationActive={false} />
          <Bar dataKey="up" stackId="a" fill={COLORS.up} isAnimationActive={false} cursor="pointer" onClick={(x) => { const k = (x as unknown as { key?: string }).key; if (k) onFilter(d, k); }}>
            {rows.map((_, i) => <Cell key={i} />)}
          </Bar>
          <Bar dataKey="down" stackId="a" fill={COLORS.down} isAnimationActive={false} cursor="pointer" onClick={(x) => { const k = (x as unknown as { key?: string }).key; if (k) onFilter(d, k); }} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function ParetoChart({ model, dim }: ChartProps & { dim?: Dimension }) {
  const { lang, t, cur, m, short, vl, ttl } = useFmt(model);
  const d = dim ?? model.pareto!.dimension;
  const p = dim ? { dimension: d, ...pareto(model.tables[d]!.rows) } : model.pareto!;
  const data = p.points.slice(0, 30).map((x, i) => ({ name: x.label, n: i + 1, value: x.value, cum: x.cumulativeShare }));
  return (
    <ChartCard id="pareto" title={`${ttl('pareto')} – ${t(`dim.${d}` as MessageKey)}`} subtitle={dateRange(model.periods.current.from, model.periods.current.to, lang)} unit={t('ch.unit', { currency: cur })}
      note={t('ch.pareto80', { n: p.countFor80, total: p.points.length, entity: t(`dim1.${d}` as MessageKey) })}
      alt={{ headers: [t('ch.item'), vl, t('ch.cumulative')], rows: p.points.map((x) => [x.label, m(x.value), pct(x.cumulativeShare, lang)]) }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="n" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="l" tickFormatter={short} width={52} tick={{ fontSize: 11 }} />
          <YAxis yAxisId="r" orientation="right" domain={[0, 1]} tickFormatter={(v: number) => pct(v, lang)} width={44} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v, n) => (n === 'cum' ? [pct(Number(v), lang), t('ch.cumulative')] : [m(Number(v)), vl])} labelFormatter={(_l, pl) => String((pl?.[0]?.payload as { name?: string } | undefined)?.name ?? '')} />
          <ReferenceLine yAxisId="r" y={0.8} stroke={COLORS.down} strokeDasharray="4 4" />
          <Bar yAxisId="l" dataKey="value" fill={COLORS.cur} isAnimationActive={false} />
          <Line yAxisId="r" type="linear" dataKey="cum" stroke={COLORS.down} dot={false} strokeWidth={2} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Renders the chart an insight points to, so "View details" shows the evidence visually. */
export function ChartById({ id, model, dim, onFilter }: ChartProps & { id: ChartId; dim?: Dimension }) {
  const plan = model.charts.find((c) => c.id === id);
  if (!plan?.available && !(id === 'waterfall' && dim && model.tables[dim])) return null;
  switch (id) {
    case 'trend': return <TrendChart model={model} onFilter={onFilter} />;
    case 'comparison': return <ComparisonChart model={model} onFilter={onFilter} />;
    case 'topCustomers': return model.tables.customer ? <RankingChart model={model} onFilter={onFilter} dim="customer" /> : null;
    case 'topProducts': return model.tables.product ? <RankingChart model={model} onFilter={onFilter} dim="product" /> : null;
    case 'topSuppliers': return model.tables.supplier ? <RankingChart model={model} onFilter={onFilter} dim="supplier" /> : null;
    case 'salespeople': return model.tables.salesperson ? <RankingChart model={model} onFilter={onFilter} dim="salesperson" n={10} /> : null;
    case 'category': return model.tables.category ? <CategoryChart model={model} onFilter={onFilter} /> : null;
    case 'waterfall': return dim && model.tables[dim] ? <WaterfallChart model={model} onFilter={onFilter} dim={dim} /> : model.waterfall ? <WaterfallChart model={model} onFilter={onFilter} /> : null;
    case 'pareto': return dim && model.tables[dim] ? <ParetoChart model={model} onFilter={onFilter} dim={dim} /> : model.pareto ? <ParetoChart model={model} onFilter={onFilter} /> : null;
  }
}

export { num };
