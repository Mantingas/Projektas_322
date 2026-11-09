'use client';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLang } from '../LangProvider';
import { Badge } from '../ui/badge';
import { Card, CardTitle } from '../ui/card';
import { ChartCard } from '../dashboard/Charts';
import type { InventoryView } from '@/engine/inventory/dashboard';
import type { Dimension } from '@/engine/analytics/filters';
import { dateRange } from '@/lib/dashFormat';
import { fmtDate, money, num, pct, type MessageKey } from '@/i18n';

const COLORS = { cur: '#4f46e5', prev: '#94a3b8', up: '#059669', down: '#dc2626', grid: '#94a3b855', a: '#4f46e5', b: '#0ea5e9', c: '#94a3b8' };

function useM(cur: string) {
  const { lang, t } = useLang();
  const loc = lang === 'en' ? 'en-GB' : lang === 'pl' ? 'pl-PL' : 'lt-LT';
  return { lang, t, m: (n: number) => money(n, { lang, currency: cur }), short: (n: number) => new Intl.NumberFormat(loc, { notation: 'compact', maximumFractionDigits: 1 }).format(n) };
}

// ───────── warehouse comparison: current vs previous stock value ─────────
export function WarehouseChart({ view, onFilter }: { view: InventoryView; onFilter: (dim: Dimension, key: string) => void }) {
  const { t, m, short, lang } = useM(view.series.currency);
  const rows = (view.tables.warehouse?.rows ?? []).filter((r) => r.current !== 0 || r.previous !== 0).sort((a, b) => b.current - a.current);
  if (rows.length < 2) return null;
  const hasPrev = view.comparable;
  const data = rows.map((r) => ({ key: r.key, name: r.label, current: r.current, previous: r.previous }));
  return (
    <ChartCard id="warehouses" title={t('ich.warehouses')} subtitle={view.asOf.current ? t('inv.position', { date: fmtDate(view.asOf.current, lang) }) : undefined} unit={t('ch.unit', { currency: view.series.currency })} note={t('ch.clickHint')}
      alt={{ headers: [t('sl.warehouses'), t('ich.current'), ...(hasPrev ? [t('ich.previous')] : []), t('tbl.share')], rows: rows.map((r) => [r.label, m(r.current), ...(hasPrev ? [m(r.previous)] : []), pct(r.share, lang)]) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={short} width={52} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v, n) => [m(Number(v)), n === 'current' ? t('ich.current') : t('ich.previous')]} />
          <Legend formatter={(v) => (v === 'current' ? t('ich.current') : t('ich.previous'))} />
          {hasPrev && <Bar dataKey="previous" fill={COLORS.prev} isAnimationActive={false} />}
          <Bar dataKey="current" fill={COLORS.cur} isAnimationActive={false} cursor="pointer" onClick={(d) => onFilter('warehouse', (d as unknown as { key: string }).key)} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ───────── receipts and issues over time ─────────
export function MovementChart({ view }: { view: InventoryView }) {
  const { t, m, short, lang } = useM(view.series.currency);
  const mt = view.movementTrend;
  if (!mt) return null;
  const value = mt.unit === 'value';
  const f = (n: number) => (value ? m(n) : num(n, lang));
  const data = mt.points.map((p) => ({ name: p.start, receipts: p.receipts, issues: p.issues }));
  return (
    <ChartCard id="movements" title={t('ich.movements')} subtitle={view.movementSpan ? dateRange(view.movementSpan.from, view.movementSpan.to, lang) : undefined} unit={value ? t('ch.unit', { currency: view.series.currency }) : t('ich.unitQty')} note={t('ich.movementNote')}
      alt={{ headers: [t('ch.date'), t('ich.receipts'), t('ich.issues')], rows: data.map((d) => [fmtDate(d.name, lang), f(d.receipts), f(d.issues)]) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="name" tickFormatter={(v: string) => fmtDate(v, lang).slice(0, 5)} tick={{ fontSize: 11 }} minTickGap={24} />
          <YAxis tickFormatter={short} width={52} tick={{ fontSize: 11 }} />
          <Tooltip labelFormatter={(v) => fmtDate(String(v), lang)} formatter={(v, n) => [f(Number(v)), n === 'receipts' ? t('ich.receipts') : t('ich.issues')]} />
          <Legend formatter={(v) => (v === 'receipts' ? t('ich.receipts') : t('ich.issues'))} />
          <Bar dataKey="receipts" fill={COLORS.up} isAnimationActive={false} />
          <Bar dataKey="issues" fill={COLORS.down} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ───────── ABC classes ─────────
export function AbcCard({ view }: { view: InventoryView }) {
  const { t, m, lang } = useM(view.series.currency);
  const a = view.abc;
  if (!a) return null;
  const rows = (['a', 'b', 'c'] as const).map((k) => ({ k, ...a[k] }));
  return (
    <Card className="space-y-3" data-testid="abc-card">
      <CardTitle>{t('ich.abc')}</CardTitle>
      <div className="flex h-6 w-full overflow-hidden rounded-md" role="img" aria-label={t('ich.abc')}>
        {rows.map((r) => <div key={r.k} style={{ width: `${Math.max(r.share * 100, 0.5)}%`, background: COLORS[r.k] }} title={`${t(`abc.${r.k}` as MessageKey)}: ${pct(r.share, lang)}`} />)}
      </div>
      <table className="w-full text-left text-sm">
        <thead><tr className="text-xs text-slate-500"><th className="px-2 py-1" /><th className="px-2 py-1 text-right">{t('abc.items')}</th><th className="px-2 py-1 text-right">{t('abc.value')}</th><th className="px-2 py-1 text-right">{t('abc.share')}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} className="border-t border-slate-100 dark:border-slate-800" data-testid={`abc-${r.k}`}>
              <td className="px-2 py-1"><span className="mr-2 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: COLORS[r.k] }} />{t(`abc.${r.k}` as MessageKey)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{r.count}</td><td className="px-2 py-1 text-right tabular-nums">{m(r.value)}</td><td className="px-2 py-1 text-right tabular-nums">{pct(r.share, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-500">{t('abc.note')}</p>
    </Card>
  );
}

// ───────── slow-moving / non-moving ─────────
export function SlowTable({ view, why, onDrill }: { view: InventoryView; why?: string; onDrill: (label: string, pk: string) => void }) {
  const { t, m, lang } = useM(view.series.currency);
  return (
    <Card className="space-y-2" data-testid="slow-table">
      <CardTitle>{t('sl.title')}</CardTitle>
      {why ? <p className="text-sm text-slate-500" data-testid="slow-unavailable">{t('sl.unavailable', { reason: why })}</p> : (
        <>
          <p className="text-xs text-slate-500">{t('sl.note', { days: view.thresholds.days ?? 0, slow: view.thresholds.slow })}</p>
          {view.excessValue !== null && <p className="text-sm" data-testid="excess-value">{t('sl.excess', { target: view.thresholds.target })}: <b>{m(view.excessValue)}</b></p>}
          {view.slow.length === 0 ? <p className="text-sm text-slate-500">{t('inv.none')}</p> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white dark:bg-slate-950"><tr className="text-slate-500"><th className="px-2 py-1">{t('sl.item')}</th><th className="px-2 py-1">{t('sl.state')}</th><th className="px-2 py-1 text-right">{t('sl.stock')}</th><th className="px-2 py-1 text-right">{t('sl.value')}</th><th className="px-2 py-1 text-right">{t('sl.cover')}</th><th className="px-2 py-1 text-right">{t('sl.perDay')}</th><th className="px-2 py-1">{t('sl.lastIssue')}</th><th className="px-2 py-1">{t('sl.warehouses')}</th></tr></thead>
                <tbody>
                  {view.slow.map((i) => (
                    <tr key={i.gk} className="border-t border-slate-100 dark:border-slate-800" data-testid="slow-row" data-state={i.state}>
                      <td className="px-2 py-1"><button className="text-left text-indigo-700 underline dark:text-indigo-300" onClick={() => onDrill(i.label, i.pk)}>{i.label}</button>{i.unit && <span className="text-slate-500"> ({i.unit})</span>}{i.identity === 'name' && <Badge tone="warn" className="ml-1">{t('pv.nameOnly')}</Badge>}</td>
                      <td className="px-2 py-1"><Badge tone={i.state === 'non_moving' ? 'risk' : 'warn'}>{t(`st.${i.state}` as MessageKey)}</Badge></td>
                      <td className="px-2 py-1 text-right tabular-nums">{num(i.stockQty, lang)}</td><td className="px-2 py-1 text-right tabular-nums">{i.stockValue !== null ? m(i.stockValue) : '–'}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{i.coverDays !== null ? num(Math.round(i.coverDays), lang) : '–'}</td><td className="px-2 py-1 text-right tabular-nums">{i.perDay > 0 ? num(i.perDay, lang) : '0'}</td>
                      <td className="px-2 py-1">{i.lastIssue ? fmtDate(i.lastIssue, lang) : '–'}</td><td className="px-2 py-1">{i.warehouses.join(', ') || '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {view.slowTotal > view.slow.length && <p className="text-xs text-slate-500">{t('inv.moreRows', { n: view.slow.length, total: view.slowTotal })}</p>}
        </>
      )}
    </Card>
  );
}

// ───────── stockout risk ─────────
export function RiskTable({ view, available, onDrill }: { view: InventoryView; available: boolean; onDrill: (label: string, pk: string) => void }) {
  const { t, lang } = useM(view.series.currency);
  return (
    <Card className="space-y-2" data-testid="risk-table">
      <CardTitle>{t('rk.title')}</CardTitle>
      {!available ? <p className="text-sm text-slate-500" data-testid="risk-unavailable">{t('rk.unavailable')}</p> : (
        <>
          <p className="text-xs text-slate-500">{t('rk.note', { risk: view.thresholds.risk })}</p>
          {view.risk.length === 0 ? <p className="text-sm text-slate-500">{t('inv.none')}</p> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white dark:bg-slate-950"><tr className="text-slate-500"><th className="px-2 py-1">{t('rk.item')}</th><th className="px-2 py-1">{t('rk.reason')}</th><th className="px-2 py-1">{t('rk.warehouse')}</th><th className="px-2 py-1 text-right">{t('rk.stock')}</th><th className="px-2 py-1 text-right">{t('rk.min')}</th><th className="px-2 py-1 text-right">{t('rk.cover')}</th><th className="px-2 py-1 text-right">{t('rk.perDay')}</th></tr></thead>
                <tbody>
                  {view.risk.map((r, n) => (
                    <tr key={`${r.gk}|${r.warehouse ?? ''}|${n}`} className="border-t border-slate-100 dark:border-slate-800" data-testid="risk-row" data-reason={r.reason}>
                      <td className="px-2 py-1"><button className="text-left text-indigo-700 underline dark:text-indigo-300" onClick={() => onDrill(r.label, r.pk)}>{r.label}</button>{r.unit && <span className="text-slate-500"> ({r.unit})</span>}</td>
                      <td className="px-2 py-1"><Badge tone={r.reason === 'low_cover' ? 'warn' : 'risk'}>{t(`rk.${r.reason}` as MessageKey)}</Badge></td>
                      <td className="px-2 py-1">{r.warehouse ?? '–'}</td><td className="px-2 py-1 text-right tabular-nums">{num(r.qty, lang)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.minStock !== undefined ? num(r.minStock, lang) : '–'}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.coverDays !== undefined ? num(Math.round(r.coverDays * 10) / 10, lang) : '–'}</td><td className="px-2 py-1 text-right tabular-nums">{r.perDay !== undefined ? num(r.perDay, lang) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {view.riskTotal > view.risk.length && <p className="text-xs text-slate-500">{t('inv.moreRows', { n: view.risk.length, total: view.riskTotal })}</p>}
        </>
      )}
    </Card>
  );
}

// ───────── flows of the period ─────────
export function FlowsCard({ view, onDrill }: { view: InventoryView; onDrill: (title: string, types: string[]) => void }) {
  const { t, m } = useM(view.series.currency);
  const f = view.flows;
  if (!f) return null;
  const row = (id: string, label: string, lines: number, value: number | null, types: string[]) => (
    <tr key={id} className="border-t border-slate-100 dark:border-slate-800" data-testid={`flow-${id}`}>
      <td className="px-2 py-1">{label}</td><td className="px-2 py-1 text-right tabular-nums">{t('fl.lines', { n: lines })}</td><td className="px-2 py-1 text-right tabular-nums">{value !== null ? m(value) : '–'}</td>
      <td className="px-2 py-1 text-right"><button className="text-indigo-700 underline dark:text-indigo-300" onClick={() => onDrill(label, types)}>{t('kpi.viewRecords')}</button></td>
    </tr>
  );
  return (
    <Card className="space-y-2" data-testid="flows-card">
      <CardTitle>{t('fl.title')}</CardTitle>
      <table className="w-full text-left text-sm"><tbody>
        {row('receipts', t('fl.receipts'), f.receiptLines, f.receiptValueCoverage >= 0.8 ? f.receiptValue : null, ['receipt', 'return'])}
        {row('issues', t('fl.issues'), f.issueLines, f.issueValueCoverage >= 0.8 || f.issueLines === 0 ? f.netIssueValue : null, ['issue', 'return'])}
        {row('transfers', t('fl.transfers'), f.transferLines, null, ['transfer'])}
        {row('adjustments', t('fl.adjustments'), f.adjustmentLines, f.adjustmentLines ? f.adjustmentValue : null, ['adjustment'])}
        {f.unknownLines > 0 && row('unknown', t('fl.unknown'), f.unknownLines, null, ['unknown'])}
      </tbody></table>
      <p className="text-xs text-slate-500">{t('fl.transferNote')}</p>
    </Card>
  );
}

// ───────── snapshots vs movements ─────────
export function ReconTable({ view }: { view: InventoryView }) {
  const { t, lang } = useM(view.series.currency);
  if (view.recon.length === 0) return null;
  return (
    <Card className="space-y-2" data-testid="recon-table">
      <CardTitle>{t('rc.title')}</CardTitle>
      <p className="text-xs text-slate-500">{t('rc.note')}</p>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-white dark:bg-slate-950"><tr className="text-slate-500"><th className="px-2 py-1">{t('rc.item')}</th><th className="px-2 py-1">{t('rc.warehouse')}</th><th className="px-2 py-1 text-right">{t('rc.opening')}</th><th className="px-2 py-1 text-right">{t('rc.movements')}</th><th className="px-2 py-1 text-right">{t('rc.expected')}</th><th className="px-2 py-1 text-right">{t('rc.actual')}</th><th className="px-2 py-1 text-right">{t('rc.diff')}</th></tr></thead>
          <tbody>
            {view.recon.map((r, i) => (
              <tr key={i} className="border-t border-slate-100 dark:border-slate-800" data-testid="recon-row">
                <td className="px-2 py-1">{r.label}</td><td className="px-2 py-1">{r.warehouse || '–'}</td>
                <td className="px-2 py-1 text-right tabular-nums">{num(r.opening, lang)}</td><td className="px-2 py-1 text-right tabular-nums">{num(r.movements, lang)}</td><td className="px-2 py-1 text-right tabular-nums">{num(r.expected, lang)}</td><td className="px-2 py-1 text-right tabular-nums">{num(r.actual, lang)}</td>
                <td className="px-2 py-1 text-right tabular-nums text-red-700 dark:text-red-400">{num(r.diff, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
