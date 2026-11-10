'use client';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLang } from '../LangProvider';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { ChartCard } from '../dashboard/Charts';
import type { FinanceView } from '@/engine/finance/dashboard';
import type { FinanceSide } from '@/engine/types';
import { dateRange } from '@/lib/dashFormat';
import { fmtDate, money, num, pct, type MessageKey } from '@/i18n';

const COLORS = { nd: '#4f46e5', d30: '#f59e0b', d60: '#f97316', d90: '#dc2626', d90p: '#7f1d1d', noDue: '#94a3b8', credits: '#059669', grid: '#94a3b855', prev: '#94a3b8', over: '#dc2626', up: '#4f46e5' } as const;

function useM(cur: string) {
  const { lang, t } = useLang();
  const loc = lang === 'en' ? 'en-GB' : lang === 'pl' ? 'pl-PL' : 'lt-LT';
  return { lang, t, m: (n: number) => money(n, { lang, currency: cur }), short: (n: number) => new Intl.NumberFormat(loc, { notation: 'compact', maximumFractionDigits: 1 }).format(n) };
}

// ───────── receivables and payables side by side ─────────
export function OverviewCard({ view }: { view: FinanceView }) {
  const { t, m, lang } = useM(view.series.currency);
  const o = view.overview;
  const side = (s: FinanceSide) => {
    const x = o[s];
    return (
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-testid={`overview-${s}`}>
        <div className="text-xs font-medium text-slate-500">{t(`fin.overview.${s}` as MessageKey)}</div>
        {x ? (
          <>
            <div className="mt-1 text-xl font-semibold tabular-nums" data-testid={`overview-${s}-amount`}>{m(x.outstanding)}</div>
            <div className="text-xs text-slate-500">{x.overdue !== null ? t('fin.overview.overdue', { amount: m(x.overdue) }) : ''} · {fmtDate(x.asOf, lang)} · {t(`fin.source.${x.source}` as MessageKey)}</div>
          </>
        ) : <div className="mt-1 text-sm text-slate-500">{t('fin.overview.none')}</div>}
      </div>
    );
  };
  return (
    <Card className="space-y-3" data-testid="fin-overview">
      <CardTitle>{t('fin.overview.title')}</CardTitle>
      <div className="grid gap-3 sm:grid-cols-3">
        {side('receivable')}
        {side('payable')}
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-testid="overview-net">
          <div className="text-xs font-medium text-slate-500">{t('fin.overview.net')}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums" data-testid="overview-net-amount">{o.net !== null ? m(o.net) : '–'}</div>
          <div className="text-xs text-slate-500">{t('fin.overview.netNote')}</div>
        </div>
      </div>
    </Card>
  );
}

// ───────── aging ─────────
export function AgingChart({ view, onBucket }: { view: FinanceView; onBucket: (id: string) => void }) {
  const { t, m, short, lang } = useM(view.series.currency);
  const a = view.aging;
  if (!a) return null;
  const hasPrev = a.rows.some((r) => r.previous !== null);
  const data = a.rows.map((r) => ({ id: r.id, name: t(`ag.${r.id}` as MessageKey), current: r.amount, previous: r.previous ?? 0 }));
  return (
    <ChartCard id="aging" title={t('fch.aging')} subtitle={`${fmtDate(a.asOf, lang)} · ${t(`fin.source.${a.source}` as MessageKey)}`} unit={t('ch.unit', { currency: view.series.currency })} note={`${t('ag.note')} ${t('ag.clickHint')}`}
      alt={{ headers: [t('ch.item'), t('ag.current'), ...(hasPrev ? [t('ag.previous')] : [])], rows: data.map((d) => [d.name, m(d.current), ...(hasPrev ? [m(d.previous)] : [])]) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 40 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="name" interval={0} angle={-25} textAnchor="end" height={60} tick={{ fontSize: 10 }} tickFormatter={(v: string) => (v.length > 16 ? v.slice(0, 15) + '…' : v)} />
          <YAxis tickFormatter={short} width={52} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v, n) => [m(Number(v)), n === 'current' ? t('ag.current') : t('ag.previous')]} />
          {hasPrev && <Legend formatter={(v) => (v === 'current' ? t('ag.current') : t('ag.previous'))} />}
          {hasPrev && <Bar dataKey="previous" fill={COLORS.prev} isAnimationActive={false} />}
          <Bar dataKey="current" isAnimationActive={false} cursor="pointer" onClick={(d) => onBucket((d as unknown as { id: string }).id)}>
            {data.map((d) => <Cell key={d.id} fill={COLORS[d.id as keyof typeof COLORS]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ───────── outstanding and overdue over time ─────────
export function OverdueTrendChart({ view }: { view: FinanceView }) {
  const { t, m, short, lang } = useM(view.series.currency);
  const data = view.overdueTrend;
  if (data.filter((p) => p.overdue !== null).length < 2) return null;
  return (
    <ChartCard id="overdueTrend" title={t('fch.overdueTrend')} subtitle={dateRange(data[0]!.date, data[data.length - 1]!.date, lang)} unit={t('ch.unit', { currency: view.series.currency })} note={t('ot.note')}
      alt={{ headers: [t('ch.date'), t('ot.outstanding'), t('ot.overdue')], rows: data.map((p) => [fmtDate(p.date, lang), m(p.outstanding), p.overdue !== null ? m(p.overdue) : '–']) }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(v: string) => fmtDate(v, lang).slice(0, 5)} tick={{ fontSize: 11 }} minTickGap={24} />
          <YAxis tickFormatter={short} width={52} tick={{ fontSize: 11 }} />
          <Tooltip labelFormatter={(v) => fmtDate(String(v), lang)} formatter={(v, n) => [m(Number(v)), n === 'outstanding' ? t('ot.outstanding') : t('ot.overdue')]} />
          <Legend formatter={(v) => (v === 'outstanding' ? t('ot.outstanding') : t('ot.overdue'))} />
          <Line type="linear" dataKey="outstanding" stroke={COLORS.up} strokeWidth={2} dot isAnimationActive={false} />
          <Line type="linear" dataKey="overdue" stroke={COLORS.over} strokeWidth={2} dot connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ───────── due-date timeline ─────────
export function DueTimelineChart({ view }: { view: FinanceView }) {
  const { t, m, short, lang } = useM(view.series.currency);
  const data = view.dueTimeline;
  if (data.length < 2) return null;
  return (
    <ChartCard id="dueTimeline" title={t('fch.dueTimeline')} subtitle={view.asOf.current ? t('fin.position', { date: fmtDate(view.asOf.current, lang) }) : undefined} unit={t('ch.unit', { currency: view.series.currency })} note={t('dt.note')}
      alt={{ headers: [t('dt.week'), t('ot.outstanding'), ''], rows: data.map((p) => [fmtDate(p.start, lang), m(p.amount), p.overdue ? t('dt.overdue') : t('dt.upcoming')]) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="start" tickFormatter={(v: string) => fmtDate(v, lang).slice(0, 5)} tick={{ fontSize: 11 }} minTickGap={16} />
          <YAxis tickFormatter={short} width={52} tick={{ fontSize: 11 }} />
          <Tooltip labelFormatter={(v) => `${t('dt.week')} ${fmtDate(String(v), lang)}`} formatter={(v) => [m(Number(v)), t('ot.outstanding')]} />
          <Bar dataKey="amount" isAnimationActive={false}>{data.map((p) => <Cell key={p.start} fill={p.overdue ? COLORS.over : COLORS.up} />)}</Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ───────── tables ─────────
export function OverdueRankTable({ view, available, onDrill }: { view: FinanceView; available: boolean; onDrill: (label: string, key: string) => void }) {
  const { t, m, lang } = useM(view.series.currency);
  return (
    <Card className="space-y-2" data-testid="overdue-rank">
      <CardTitle>{t('od.title')}</CardTitle>
      {!available ? <p className="text-sm text-slate-500" data-testid="overdue-unavailable">{t('od.unavailable')}</p> : view.overdueRank.length === 0 ? <p className="text-sm text-slate-500">{t('od.none')}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="text-slate-500"><th className="px-2 py-1">{t('od.cp')}</th><th className="px-2 py-1 text-right">{t('od.overdue')}</th><th className="px-2 py-1 text-right">{t('od.over90')}</th><th className="px-2 py-1 text-right">{t('od.outstanding')}</th><th className="px-2 py-1 text-right">{t('od.share')}</th><th className="px-2 py-1 text-right">{t('od.lines')}</th></tr></thead>
            <tbody>
              {view.overdueRank.map((r) => (
                <tr key={r.key} className="border-t border-slate-100 dark:border-slate-800" data-testid="overdue-row" data-key={r.key}>
                  <td className="px-2 py-1"><button className="text-left text-indigo-700 underline dark:text-indigo-300" onClick={() => onDrill(r.label, r.key)}>{r.label}</button></td>
                  <td className="px-2 py-1 text-right tabular-nums">{m(r.overdue)}</td><td className="px-2 py-1 text-right tabular-nums">{m(r.over90)}</td><td className="px-2 py-1 text-right tabular-nums">{m(r.outstanding)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{pct(r.share, lang)}</td><td className="px-2 py-1 text-right tabular-nums">{r.lines}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function OverdueLinesTable({ view }: { view: FinanceView }) {
  const { t, m, lang } = useM(view.series.currency);
  if (view.overdueLines.length === 0) return null;
  return (
    <Card className="space-y-2" data-testid="overdue-lines">
      <CardTitle>{t('ol.title')}</CardTitle>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-white dark:bg-slate-950"><tr className="text-slate-500"><th className="px-2 py-1">{t('ol.invoice')}</th><th className="px-2 py-1">{t('od.cp')}</th><th className="px-2 py-1">{t('ol.due')}</th><th className="px-2 py-1 text-right">{t('ol.days')}</th><th className="px-2 py-1 text-right">{t('ol.outstanding')}</th></tr></thead>
          <tbody>
            {view.overdueLines.map((l) => (
              <tr key={l.key} className="border-t border-slate-100 dark:border-slate-800" data-testid="overdue-line">
                <td className="px-2 py-1">{l.no}</td><td className="px-2 py-1">{l.label}</td><td className="px-2 py-1">{fmtDate(l.due, lang)}</td>
                <td className={`px-2 py-1 text-right tabular-nums ${l.days > view.thresholds.long ? 'font-semibold text-red-700 dark:text-red-400' : ''}`}>{l.days}</td><td className="px-2 py-1 text-right tabular-nums">{m(l.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.overdueLinesTotal > view.overdueLines.length && <p className="text-xs text-slate-500">{t('ol.more', { n: view.overdueLines.length, total: view.overdueLinesTotal })}</p>}
    </Card>
  );
}

export function BehaviourTable({ view, onDrill }: { view: FinanceView; onDrill: (label: string, key: string) => void }) {
  const { t, m, lang } = useM(view.series.currency);
  const f = (n: number | null) => (n === null ? '–' : num(Math.round(n * 10) / 10, lang));
  return (
    <Card className="space-y-2" data-testid="behaviour-table">
      <CardTitle>{t('fch.behaviour')}</CardTitle>
      <p className="text-xs text-slate-500">{t('bh.note', { min: view.thresholds.min })}</p>
      {view.behaviour.filter((b) => b.cur.n > 0 || b.prev.n > 0).length === 0 ? <p className="text-sm text-slate-500">{t('bh.none')}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="text-slate-500"><th className="px-2 py-1">{t('bh.cp')}</th><th className="px-2 py-1 text-right">{t('bh.delay')}</th><th className="px-2 py-1 text-right">{t('bh.n')}</th><th className="px-2 py-1 text-right">{t('bh.prev')}</th><th className="px-2 py-1 text-right">{t('bh.n')}</th><th className="px-2 py-1 text-right">{t('bh.change')}</th><th className="px-2 py-1 text-right">{t('bh.paid')}</th></tr></thead>
            <tbody>
              {view.behaviour.map((b) => (
                <tr key={b.key} className="border-t border-slate-100 dark:border-slate-800" data-testid="behaviour-row" data-key={b.key}>
                  <td className="px-2 py-1"><button className="text-left text-indigo-700 underline dark:text-indigo-300" onClick={() => onDrill(b.label, b.key)}>{b.label}</button></td>
                  <td className="px-2 py-1 text-right tabular-nums">{f(b.cur.avg)}</td><td className="px-2 py-1 text-right tabular-nums">{b.cur.n}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{f(b.prev.avg)}</td><td className="px-2 py-1 text-right tabular-nums">{b.prev.n}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${b.change !== null && b.change > 0 ? 'text-red-700 dark:text-red-400' : b.change !== null && b.change < 0 ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>{b.change === null ? '–' : `${b.change > 0 ? '+' : ''}${f(b.change)}`}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{m(b.cur.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function CreditTable({ view }: { view: FinanceView }) {
  const { t, m, lang } = useM(view.series.currency);
  return (
    <Card className="space-y-2" data-testid="credit-review">
      <CardTitle>{t('cn.title')}</CardTitle>
      <p className="text-xs text-slate-500">{t('cn.note')}</p>
      {view.credits.length === 0 ? <p className="text-sm text-slate-500">{t('cn.none')}</p> : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white dark:bg-slate-950"><tr className="text-slate-500"><th className="px-2 py-1">{t('cn.date')}</th><th className="px-2 py-1">{t('cn.no')}</th><th className="px-2 py-1">{t('cn.cp')}</th><th className="px-2 py-1 text-right">{t('cn.amount')}</th><th className="px-2 py-1">{t('cn.status')}</th><th className="px-2 py-1">{t('cn.ref')}</th><th className="px-2 py-1">{t('cn.possible')}</th></tr></thead>
            <tbody>
              {view.credits.map((c) => (
                <tr key={c.key} className="border-t border-slate-100 dark:border-slate-800" data-testid="credit-row" data-status={c.status}>
                  <td className="px-2 py-1">{fmtDate(c.date, lang)}</td><td className="px-2 py-1">{c.no}</td><td className="px-2 py-1">{c.label}</td><td className="px-2 py-1 text-right tabular-nums">{m(c.amount)}</td>
                  <td className="px-2 py-1"><Badge tone={c.status === 'matched' ? 'opportunity' : 'warn'}>{t(`cn.${c.status}` as MessageKey)}</Badge></td><td className="px-2 py-1">{c.reference ?? '–'}</td>
                  <td className="px-2 py-1" data-testid="credit-possible">{c.possible.length ? c.possible.map((p) => `${p.no} (${m(p.amount)})`).join(', ') : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.openCredits.length > 0 && (
        <div data-testid="open-credits">
          <div className="mt-2 text-xs font-semibold text-slate-600 dark:text-slate-300">{t('cn.open')}</div>
          <p className="text-xs text-slate-500">{t('cn.openNote')}</p>
          <ul className="mt-1 space-y-0.5 text-xs">{view.openCredits.map((c) => <li key={c.key}>{c.no} · {c.label}: <b className="tabular-nums">{m(c.amount)}</b></li>)}</ul>
        </div>
      )}
    </Card>
  );
}

export function DuplicatesTable({ view, onDrill }: { view: FinanceView; onDrill: (title: string, keys: string[]) => void }) {
  const { t, m, lang } = useM(view.series.currency);
  return (
    <Card className="space-y-2" data-testid="dup-review">
      <CardTitle>{t('dp.title')}</CardTitle>
      <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="dup-note">{t('dp.note')}</p>
      {view.duplicates.length === 0 ? <p className="text-sm text-slate-500">{t('dp.none')}</p> : (
        <div className="space-y-2">
          {view.duplicates.map((g) => (
            <div key={g.id} className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700" data-testid="dup-group" data-tier={g.tier}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warn">{t(`dp.tier.${g.tier}` as MessageKey)}</Badge>
                <b>{g.label}</b>
                {g.invoiceNo && <span className="text-slate-500">{t('dp.invoice')}: {g.invoiceNo}</span>}
                <span className="ml-auto tabular-nums">{t('dp.excess')}: <b>{m(g.excess)}</b></span>
              </div>
              <p className="mt-1 text-slate-500">{t(`dp.tierd.${g.tier}` as MessageKey)}</p>
              <ul className="mt-1 space-y-0.5">{g.payments.map((p) => <li key={p.key}>{fmtDate(p.date, lang)} · {p.ref ?? '–'} · {m(p.amount)}{p.invoice ? ` → ${p.invoice}` : ''}</li>)}</ul>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => onDrill(g.label, g.payments.map((p) => p.key))}>{t('kpi.viewRecords')}</Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function MatchingCard({ view }: { view: FinanceView }) {
  const { t } = useM(view.series.currency);
  const x = view.matching;
  if (x.matched + x.unreferenced + x.notFound + x.conflict === 0) return null;
  return (
    <Card className="space-y-2" data-testid="matching-card">
      <CardTitle>{t('pm.title')}</CardTitle>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-slate-500">{t('pm.matched')}</dt><dd className="text-lg font-semibold" data-testid="pm-matched">{x.matched}</dd></div>
        <div><dt className="text-xs text-slate-500">{t('pm.unreferenced')}</dt><dd className="text-lg font-semibold" data-testid="pm-unreferenced">{x.unreferenced}</dd></div>
        <div><dt className="text-xs text-slate-500">{t('pm.notFound')}</dt><dd className="text-lg font-semibold" data-testid="pm-notfound">{x.notFound}</dd></div>
        <div><dt className="text-xs text-slate-500">{t('pm.conflict')}</dt><dd className="text-lg font-semibold" data-testid="pm-conflict">{x.conflict}</dd></div>
      </dl>
      <p className="text-xs text-slate-500">{t('pm.note')}</p>
    </Card>
  );
}
