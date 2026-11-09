'use client';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLang } from '../LangProvider';
import { Badge } from '../ui/badge';
import { Card, CardTitle } from '../ui/card';
import { ChartCard } from '../dashboard/Charts';
import { engine } from '@/lib/engineClient';
import type { FilterSpec } from '@/engine/analytics/filters';
import type { PurchasingView } from '@/engine/purchasing/dashboard';
import type { UnitPolicy } from '@/engine/purchasing/units';
import type { Insight } from '@/engine/types';
import type { PriceTrendPoint } from '@/engine/purchasing/prices';
import { fmtDate, money, num, pct, type MessageKey } from '@/i18n';

const COLORS = { cur: '#4f46e5', prev: '#94a3b8', up: '#dc2626', down: '#059669', total: '#4f46e5', grid: '#94a3b855' };
const SERIES = ['#0ea5e9', '#f59e0b', '#a855f7', '#14b8a6', '#ec4899', '#84cc16'];

function useM(cur: string) {
  const { lang, t } = useLang();
  const loc = lang === 'en' ? 'en-GB' : lang === 'pl' ? 'pl-PL' : 'lt-LT';
  const price = (n: number) => { try { return new Intl.NumberFormat(loc, { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n); } catch { return `${n.toFixed(4)} ${cur}`; } };
  return {
    lang, t,
    m: (n: number) => money(n, { lang, currency: cur }),
    price,
    short: (n: number) => new Intl.NumberFormat(lang === 'en' ? 'en-GB' : lang === 'pl' ? 'pl-PL' : 'lt-LT', { notation: 'compact', maximumFractionDigits: 1 }).format(n),
  };
}

// ───────── like-for-like price change (not a per-period KPI: it needs matched item/supplier pairs) ─────────
export function PriceChangeCard({ view, cur }: { view: PurchasingView; cur: string }) {
  const { t, m, lang } = useM(cur);
  const l = view.priceChange;
  return (
    <Card className="flex flex-col p-4" data-testid="price-change-card">
      <div className="text-xs font-medium text-slate-500">{t('pc.title')}</div>
      {l ? (
        <>
          <div className={`mt-1 text-2xl font-semibold tracking-tight ${l.pct > 0.0005 ? 'text-red-700 dark:text-red-400' : l.pct < -0.0005 ? 'text-emerald-700 dark:text-emerald-400' : ''}`} data-testid="kpi-price-change">{l.pct > 0 ? '+' : l.pct < 0 ? '−' : ''}{pct(Math.abs(l.pct), lang)}</div>
          <div className="mt-1 text-sm" data-testid="price-change-extra">{t('pc.extra', { extra: m(l.extra) })}</div>
          <div className="mt-1 text-xs text-slate-500">{t('pc.coverage', { pairs: l.pairs, pct: pct(l.coverage, lang) })}</div>
        </>
      ) : <div className="mt-1 text-sm text-slate-500">{t('pc.none')}</div>}
      <p className="mt-2 text-xs text-slate-500">{t('pc.explain')}</p>
    </Card>
  );
}

// ───────── spend bridge: price / supplier mix / volume / new / discontinued / credits / not comparable ─────────
export function BridgeChart({ view, cur }: { view: PurchasingView; cur: string }) {
  const { t, m, short, lang } = useM(cur);
  const b = view.bridge;
  const sp = view.kpis.find((k) => k.id === 'p_spend');
  if (!b || !sp || sp.current === null || sp.previous === null) return null;
  const steps: { name: string; delta: number; id: string }[] = [
    { id: 'price', name: t('br.price'), delta: b.price }, { id: 'mix', name: t('br.mix'), delta: b.supplierMix }, { id: 'volume', name: t('br.volume'), delta: b.volume },
    { id: 'new', name: t('br.new'), delta: b.newItems }, { id: 'lost', name: t('br.lost'), delta: b.lostItems }, { id: 'credits', name: t('br.credits'), delta: b.credits }, { id: 'unassigned', name: t('br.unassigned'), delta: b.unassigned },
  ];
  let run = sp.previous;
  const rows: { name: string; base: number; up: number; down: number; total: number; delta: number }[] = [{ name: t('br.start'), base: 0, up: 0, down: 0, total: sp.previous, delta: sp.previous }];
  for (const s of steps) {
    if (s.delta >= 0) rows.push({ name: s.name, base: run, up: s.delta, down: 0, total: 0, delta: s.delta });
    else rows.push({ name: s.name, base: run + s.delta, up: 0, down: -s.delta, total: 0, delta: s.delta });
    run += s.delta;
  }
  rows.push({ name: t('br.end'), base: 0, up: 0, down: 0, total: sp.current, delta: sp.current });
  return (
    <ChartCard id="bridge" title={t('pch.bridge')} subtitle={t('per.describe', { cfrom: fmtDate(view.periods.current.from, lang), cto: fmtDate(view.periods.current.to, lang), cdays: view.periods.currentDays, pfrom: fmtDate(view.periods.previous.from, lang), pto: fmtDate(view.periods.previous.to, lang), pdays: view.periods.previousDays })}
      unit={t('ch.unit', { currency: cur })} note={t('br.note')} alt={{ headers: [t('ch.item'), t('ch.delta')], rows: rows.map((r) => [r.name, m(r.delta)]) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 40 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="name" interval={0} angle={-30} textAnchor="end" height={70} tick={{ fontSize: 10 }} tickFormatter={(v: string) => (v.length > 16 ? v.slice(0, 15) + '…' : v)} />
          <YAxis tickFormatter={short} width={52} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(_v, _n, p) => [m((p.payload as { delta: number }).delta), t('ch.delta')]} />
          <Bar dataKey="base" stackId="a" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="total" stackId="a" fill={COLORS.total} isAnimationActive={false} />
          {/* for costs a rise is bad (red), a fall is good (green) */}
          <Bar dataKey="up" stackId="a" fill={COLORS.up} isAnimationActive={false} />
          <Bar dataKey="down" stackId="a" fill={COLORS.down} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ───────── price trend of one comparable item, overall and per supplier ─────────
export function PriceTrendChart({ view, cur, version, seriesKey, filters, unitPolicy, initialPk }: { view: PurchasingView; cur: string; version: number; seriesKey: string; filters: FilterSpec; unitPolicy: UnitPolicy; initialPk?: string }) {
  const { t, lang, price, short } = useM(cur);
  const items = view.priceItems;
  const start = (initialPk && items.find((i) => i.gk.startsWith(initialPk))?.gk) || items[0]?.gk || '';
  const [gk, setGk] = useState(start);
  const [data, setData] = useState<{ points: PriceTrendPoint[]; suppliers: { key: string; label: string }[] } | null>(null);
  useEffect(() => { if (!items.some((i) => i.gk === gk)) setGk(start); }, [items, gk, start]);
  useEffect(() => {
    if (!gk) { setData(null); return; }
    let alive = true;
    engine().call('priceTrendFor', [{ version, seriesKey, filters: { ...filters }, gk, unitPolicy }]).then((r) => alive && setData(r)).catch(() => alive && setData({ points: [], suppliers: [] }));
    return () => { alive = false; };
  }, [gk, version, seriesKey, filters, unitPolicy]);
  const item = items.find((i) => i.gk === gk);
  const rows = useMemo(() => (data?.points ?? []).map((p) => ({ name: p.start, overall: p.overall, ...Object.fromEntries((data?.suppliers ?? []).map((s) => [`s:${s.key}`, p.suppliers[s.key] ?? null])) })), [data]);
  if (!items.length) return null;
  const sups = data?.suppliers ?? [];
  return (
    <ChartCard id="priceTrend" title={t('pch.priceTrend')} subtitle={item ? `${item.label}${item.unit ? ` (${item.unit})` : ''}${item.identity === 'name' ? ` · ${t('pv.nameOnly')}` : ''}` : undefined} unit={cur} note={t('pur.priceTrendHint')}
      alt={{ headers: [t('ch.date'), t('pt.overall'), ...sups.map((s) => s.label)], rows: rows.map((r) => [fmtDate(r.name, lang), r.overall === null ? '–' : price(r.overall), ...sups.map((s) => { const v = (r as Record<string, unknown>)[`s:${s.key}`] as number | null; return v === null || v === undefined ? '–' : price(v); })]) }}>
      <div className="flex h-full flex-col gap-2">
        <label className="text-xs text-slate-500">{t('pur.item')}
          <select data-testid="price-item-select" value={gk} onChange={(e) => setGk(e.target.value)} className="ml-2 max-w-[70%] rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900">
            {items.map((i) => <option key={i.gk} value={i.gk}>{i.label}{i.unit ? ` (${i.unit})` : ''}{i.identity === 'name' ? ' *' : ''}</option>)}
          </select>
        </label>
        <div className="min-h-0 flex-1">
          {rows.every((r) => r.overall === null) ? <p className="text-sm text-slate-500">{t('pt.none')}</p> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="name" tickFormatter={(v: string) => fmtDate(v, lang).slice(0, 5)} tick={{ fontSize: 11 }} minTickGap={24} />
                <YAxis tickFormatter={short} width={52} tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip labelFormatter={(v) => fmtDate(String(v), lang)} formatter={(v, n) => [price(Number(v)), n === 'overall' ? t('pt.overall') : (sups.find((s) => `s:${s.key}` === n)?.label ?? String(n))]} />
                <Legend formatter={(v) => (v === 'overall' ? t('pt.overall') : (sups.find((s) => `s:${s.key}` === v)?.label ?? String(v)))} />
                <Line type="linear" dataKey="overall" stroke={COLORS.cur} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
                {sups.slice(0, 6).map((s, i) => <Line key={s.key} type="linear" dataKey={`s:${s.key}`} stroke={SERIES[i % SERIES.length]} strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2 }} connectNulls isAnimationActive={false} />)}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </ChartCard>
  );
}

// ───────── quantity comparison (percent change, so different units never share an axis) ─────────
export function QuantityChart({ view }: { view: PurchasingView }) {
  const { t, lang } = useM(view.series.currency);
  const rows = view.quantities.filter((q) => q.previous > 0).map((q) => ({ name: q.label, change: (q.current - q.previous) / q.previous, ...q }));
  if (rows.length < 2) return null;
  return (
    <ChartCard id="quantityComparison" title={t('pch.quantity')} subtitle={t('pur.coverageNote')}
      alt={{ headers: [t('pur.item'), t('pv.unit'), t('per.current'), t('per.previous'), t('ch.delta')], rows: view.quantities.map((q) => [q.label, q.unit || '–', num(q.current, lang), num(q.previous, lang), `${q.delta > 0 ? '+' : ''}${num(q.delta, lang)}`]) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 24, top: 0, bottom: 0 }}>
          <CartesianGrid stroke={COLORS.grid} horizontal={false} />
          <XAxis type="number" tickFormatter={(v: number) => pct(v, lang)} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} tickFormatter={(v: string) => (v.length > 20 ? v.slice(0, 19) + '…' : v)} />
          <Tooltip formatter={(v, _n, p) => { const r = p.payload as (typeof rows)[number]; return [`${pct(Number(v), lang)} (${num(r.previous, lang)} → ${num(r.current, lang)} ${r.unit})`, t('ch.delta')]; }} />
          <Bar dataKey="change" fill={COLORS.cur} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ───────── tables ─────────
export function PriceVarianceTable({ view, cur, onDrill, onPick }: { view: PurchasingView; cur: string; onDrill: (label: string, pk: string) => void; onPick: (pk: string) => void }) {
  const { t, price, m, lang } = useM(cur);
  const rows = view.variance.slice(0, 25);
  return (
    <Card className="space-y-2" data-testid="price-variance">
      <CardTitle>{t('pch.priceVariance')}</CardTitle>
      <p className="text-xs text-slate-500">{t('pv.note')}</p>
      {rows.length === 0 ? <p className="text-sm text-slate-500">{t('pt.none')}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="text-slate-500"><th className="px-2 py-1">{t('pv.item')}</th><th className="px-2 py-1">{t('pv.suppliers')}</th><th className="px-2 py-1 text-right">{t('pv.low')}</th><th className="px-2 py-1 text-right">{t('pv.high')}</th><th className="px-2 py-1 text-right">{t('pv.spread')}</th><th className="px-2 py-1 text-right">{t('pv.qty')}</th><th className="px-2 py-1 text-right">{t('pv.potential')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.gk} className="border-t border-slate-100 align-top dark:border-slate-800" data-testid="variance-row" data-gk={r.gk}>
                  <td className="px-2 py-1"><button className="text-left text-indigo-700 underline dark:text-indigo-300" onClick={() => onDrill(r.label, r.pk)}>{r.label}</button>{r.unit && <span className="text-slate-500"> ({r.unit})</span>}{r.identity === 'name' && <Badge tone="warn" className="ml-1">{t('pv.nameOnly')}</Badge>}</td>
                  <td className="px-2 py-1">{r.suppliers.map((s) => <div key={s.supplier}>{s.label}: <b className="tabular-nums">{price(s.price)}</b></div>)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{price(r.min)}</td><td className="px-2 py-1 text-right tabular-nums">{price(r.max)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{pct(r.spreadPct, lang)}</td><td className="px-2 py-1 text-right tabular-nums">{num(r.qty, lang)}</td>
                  <td className="px-2 py-1 text-right tabular-nums"><span>{m(r.potentialSavings)}</span> <button className="ml-1 text-indigo-700 underline dark:text-indigo-300" onClick={() => onPick(r.pk)}>{t('pch.priceTrend')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.variance.length > rows.length && <p className="text-xs text-slate-500">{t('pur.moreRows', { n: rows.length, total: view.variance.length })}</p>}
    </Card>
  );
}

export function PriceChangesTable({ view, cur, onDrill }: { view: PurchasingView; cur: string; onDrill: (label: string, pk: string, supplier: string) => void }) {
  const { t, price, m, lang } = useM(cur);
  return (
    <Card className="space-y-2" data-testid="price-changes">
      <CardTitle>{t('pch.prices')}</CardTitle>
      <p className="text-xs text-slate-500">{t('pur.coverageNote')}</p>
      {view.pairs.length === 0 ? <p className="text-sm text-slate-500">{t('pur.noPairs')}</p> : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white dark:bg-slate-950"><tr className="text-slate-500"><th className="px-2 py-1">{t('pp.item')}</th><th className="px-2 py-1 text-right">{t('pp.prev')}</th><th className="px-2 py-1 text-right">{t('pp.cur')}</th><th className="px-2 py-1 text-right">{t('pp.change')}</th><th className="px-2 py-1 text-right">{t('pp.effect')}</th><th className="px-2 py-1 text-right">{t('pp.lines')}</th></tr></thead>
            <tbody>
              {view.pairs.map((r) => (
                <tr key={`${r.gk}|${r.supplier}`} className="border-t border-slate-100 dark:border-slate-800" data-testid="pair-row">
                  <td className="px-2 py-1"><button className="text-left text-indigo-700 underline dark:text-indigo-300" onClick={() => onDrill(`${r.label} · ${r.supplierLabel}`, r.pk, r.supplier)}>{r.label}{r.supplierLabel ? ` · ${r.supplierLabel}` : ''}</button>{r.unit && <span className="text-slate-500"> ({r.unit})</span>}{r.identity === 'name' && <Badge tone="warn" className="ml-1">{t('pv.nameOnly')}</Badge>}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{price(r.p0)}</td><td className="px-2 py-1 text-right tabular-nums">{price(r.p1)}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${r.changePct > 0 ? 'text-red-700 dark:text-red-400' : r.changePct < 0 ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>{r.changePct > 0 ? '+' : r.changePct < 0 ? '−' : ''}{pct(Math.abs(r.changePct), lang)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{m(r.effect)}</td><td className="px-2 py-1 text-right tabular-nums">{r.l0 + r.l1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ───────── savings overview: three kinds, never summed together ─────────
export function SavingsOverview({ insights, cur }: { insights: Insight[]; cur: string }) {
  const { t, m } = useM(cur);
  const kinds = ['actual', 'potential', 'hypothetical'] as const;
  const by = Object.fromEntries(kinds.map((k) => [k, insights.filter((i) => i.savings?.kind === k)])) as Record<(typeof kinds)[number], Insight[]>;
  const any = kinds.some((k) => by[k].length);
  return (
    <Card className="space-y-3" data-testid="savings-overview">
      <CardTitle>{t('pur.savings')}</CardTitle>
      <p className="text-xs text-slate-500">{t('pur.savingsHelp')}</p>
      {!any ? <p className="text-sm text-slate-500">{t('pur.noSavings')}</p> : (
        <div className="grid gap-3 sm:grid-cols-3">
          {kinds.map((k) => (
            <div key={k} className={`rounded-lg border p-3 ${k === 'actual' ? 'border-emerald-300 dark:border-emerald-800' : k === 'potential' ? 'border-sky-300 dark:border-sky-800' : 'border-dashed border-slate-300 dark:border-slate-700'}`} data-testid={`savings-${k}`}>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t(`sav.${k}` as MessageKey)}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums" data-testid={`savings-${k}-amount`}>{by[k].length ? m(by[k].reduce((s, i) => s + (i.savings?.amount ?? 0), 0)) : '–'}</div>
              <p className="mt-1 text-xs text-slate-500">{t(`sav.${k}.d` as MessageKey)}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
