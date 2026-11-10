import { addDays } from '../analytics/dates';
import { counterpartyKeyOf, productKeyOf, type EntityLink } from '../entities/links';
import { listSnapshots, pickSnapshot, positionOf } from '../finance/ledger';
import type { CrossDisclosure, FinanceRecord, InventoryRecord, Insight, PurchaseRecord, SalesRecord } from '../types';

export const WINDOW_DAYS = 90;
export const COVER_LOW_DAYS = 14;
export const COVER_EXCESS_DAYS = 180;
export const STALE_SNAPSHOT_DAYS = 45;
export const MIN_SALES_COVERAGE_DAYS = 60;
export const MARGIN_DROP_PP = 3;
export const COST_RISE_PCT = 3;
export const STOCK_MONTHS_FLAG = 6;
export const CUSTOMER_SHARE_FLAG = 0.2;

export type CrossReason = 'unit_mismatch' | 'no_links' | 'no_data' | 'currency_mismatch' | 'basis_mismatch' | 'stale_snapshot' | 'short_coverage' | 'nothing_found' | 'no_value' | 'no_position' | 'no_due_dates';
export interface CrossInput { sales: SalesRecord[]; purchases: PurchaseRecord[]; inventory: InventoryRecord[]; finance: FinanceRecord[]; links: EntityLink[] }
export interface CrossResult { insights: Insight[]; unavailable: { rule: string; reason: CrossReason }[] }

/** Units of one product in one module: exactly one unit, none stated, or several (several = not comparable). Packaging units never convert into pieces. */
const unitsOf = (us: (string | undefined)[]): { unit?: string; mixed: boolean } => { const k = [...new Set(us.filter((x): x is string => !!x))]; return k.length > 1 ? { mixed: true } : { unit: k[0], mixed: false }; };
/** 'mismatch' only when BOTH sides state a unit and the units differ (or either side mixes units); an unstated unit stays an assumption */
const unitsCompatible = (a: { unit?: string; mixed: boolean }, b: { unit?: string; mixed: boolean }) => !a.mixed && !b.mixed && (!a.unit || !b.unit || a.unit === b.unit);

const lastDate = (xs: { date: string }[]) => xs.reduce((m, r) => (r.date > m ? r.date : m), '');
const firstDate = (xs: { date: string }[]) => xs.reduce((m, r) => (m === '' || r.date < m ? r.date : m), '');
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const cur0 = (xs: string[]) => [...new Set(xs)];

type Pair = { a: string; b: string; link: EntityLink };
/** Confirmed links between two modules, as (key in module A, key in module B). Proposed, rejected and name-only candidates never appear. */
function confirmedPairs(links: EntityLink[], kind: 'product' | 'counterparty', ma: string, mb: string): Pair[] {
  const out: Pair[] = [];
  for (const l of links) {
    if (l.status !== 'confirmed' || l.kind !== kind) continue;
    if (l.a.module === ma && l.b.module === mb) out.push({ a: l.a.key, b: l.b.key, link: l });
    else if (l.b.module === ma && l.a.module === mb) out.push({ a: l.b.key, b: l.a.key, link: l });
  }
  return out;
}
const linkInfo = (ps: Pair[]) => ps.map((p) => ({ id: p.link.id, kind: p.link.kind, a: p.link.a.label, b: p.link.b.label, basis: p.link.basis }));

const mk = (d: Omit<Insight, 'score' | 'module' | 'actionable' | 'topic' | 'group'> & { topic: string; group: string }): Insight => ({ ...d, module: 'cross', actionable: true, score: 0 });

export function crossInsights(inp: CrossInput): CrossResult {
  const out: Insight[] = [];
  const unavailable: CrossResult['unavailable'] = [];
  const skip = (rule: string, reason: CrossReason) => unavailable.push({ rule, reason });
  const salesKey = (r: SalesRecord) => productKeyOf(r);
  const purchKey = (r: PurchaseRecord) => productKeyOf(r);
  const invKey = (r: InventoryRecord) => productKeyOf(r);

  // ───────────────── 1. sales demand vs stock cover (sales ↔ inventory, product links) ─────────────────
  const si = confirmedPairs(inp.links, 'product', 'sales', 'inventory');
  const snaps = inp.inventory.filter((r) => r.kind === 'snapshot' && r.quantity !== undefined);
  if (!si.length) skip('stock_cover', 'no_links');
  else if (!inp.sales.length || !snaps.length) skip('stock_cover', 'no_data');
  else {
    const invDate = lastDate(snaps);
    const salesEnd = lastDate(inp.sales);
    const end = invDate < salesEnd ? invDate : salesEnd;
    const start = addDays(end, -(WINDOW_DAYS - 1));
    const lag = Math.abs((Date.parse(invDate) - Date.parse(salesEnd)) / 86400000);
    if (lag > STALE_SNAPSHOT_DAYS) skip('stock_cover', 'stale_snapshot');
    else if (firstDate(inp.sales) > addDays(end, -(MIN_SALES_COVERAGE_DAYS - 1))) skip('stock_cover', 'short_coverage');
    else {
      const rows: { label: string; demandPerDay: number; onHand: number; cover: number; value: number | null; qty90: number; cur?: string }[] = [];
      const used: Pair[] = [];
      let unitExcluded = 0;
      const ipPairs = confirmedPairs(inp.links, 'product', 'inventory', 'purchasing');
      for (const p of si) {
        const sales = inp.sales.filter((r) => salesKey(r) === p.a && r.date >= start && r.date <= end && r.quantity !== undefined);
        const stock = snaps.filter((r) => invKey(r) === p.b && r.date === invDate);
        if (!sales.length || !stock.length) continue;
        // the stock must be counted in one unit, and in the unit the purchasing file uses for the same confirmed product
        const invUnit = unitsOf(stock.map((r) => r.unit));
        const buyPair = ipPairs.find((x) => x.a === p.b);
        const buyUnit = unitsOf(buyPair ? inp.purchases.filter((r) => purchKey(r) === buyPair.b).map((r) => r.unit) : []);
        if (!unitsCompatible(invUnit, buyUnit)) { unitExcluded++; continue; }
        const qty = sum(sales.map((r) => r.quantity!));
        if (qty <= 0) continue;
        const onHand = sum(stock.map((r) => r.quantity!));
        const vals = stock.map((r) => r.value ?? (r.unitCost !== undefined ? r.unitCost * r.quantity! : null));
        const value = vals.every((v) => v !== null) ? sum(vals as number[]) : null;
        const d = qty / WINDOW_DAYS;
        rows.push({ label: p.link.a.label, demandPerDay: d, onHand, cover: onHand / d, value, qty90: qty, cur: stock[0]!.currency });
        used.push(p);
      }
      if (!rows.length && unitExcluded) skip('stock_cover', 'unit_mismatch');
      const disc = (ps: Pair[]): CrossDisclosure => ({
        sources: [{ module: 'sales', from: firstDate(inp.sales), to: salesEnd, lines: inp.sales.length }, { module: 'inventory', from: firstDate(snaps), to: invDate, lines: snaps.length, note: 'snapshot' }],
        links: linkInfo(ps), period: { from: start, to: end }, methodKey: 'cross.m.stock_cover', limits: ['cross.l.units_assumed', ...(used.length && ipPairs.length ? ['cross.l.units_checked'] : []), 'cross.l.no_lead_time', 'cross.l.snapshot_date'], confidenceKey: lag <= 14 ? 'cross.c.medium_fresh' : 'cross.c.low_lag',
      });
      const low = rows.filter((r) => r.cover < COVER_LOW_DAYS && r.onHand >= 0).sort((a, b) => b.demandPerDay - a.demandPerDay);
      const high = rows.filter((r) => r.cover > COVER_EXCESS_DAYS && r.onHand > 0).sort((a, b) => (b.value ?? b.onHand) - (a.value ?? a.onHand));
      if (low.length) {
        out.push(mk({
          id: 'cross.stock_cover_low', topic: 'cross.stock_cover_low', group: 'stockout', severity: 'risk', certainty: 'indicator', titleKey: 'cross.stock_cover_low.title', bodyKey: 'cross.stock_cover_low.body', actionKey: 'cross.stock_cover_low.action', whyKey: 'cross.stock_cover_low.why',
          params: { count: low.length, name: low[0]!.label, days: Math.round(low[0]!.cover), asof: { date: invDate }, window: WINDOW_DAYS }, reliability: lag <= 14 ? 'medium' : 'low', reliabilityReasonKey: 'cross.rel.confirmed_links',
          impact: { value: low.length, unit: 'qty' }, evidence: low.slice(0, 5).map((r) => ({ key: r.label, label: r.label, current: Math.round(r.cover * 10) / 10, unit: 'qty' as const })), cross: disc(used),
        }));
      } else skip('stock_cover_low', 'nothing_found');
      if (high.length) {
        const withValue = high.filter((r) => r.value !== null);
        const tied = withValue.length === high.length ? sum(high.map((r) => r.value!)) : null;
        out.push(mk({
          id: 'cross.stock_excess_vs_demand', topic: 'cross.stock_excess', group: 'overstock', severity: 'opportunity', certainty: 'possible', titleKey: 'cross.stock_excess.title', bodyKey: tied !== null ? 'cross.stock_excess.body_value' : 'cross.stock_excess.body', actionKey: 'cross.stock_excess.action', whyKey: 'cross.stock_excess.why',
          params: { count: high.length, name: high[0]!.label, days: Math.round(high[0]!.cover), asof: { date: invDate }, window: WINDOW_DAYS, ...(tied !== null ? { amount: { money: tied } } : {}) }, reliability: lag <= 14 ? 'medium' : 'low', reliabilityReasonKey: 'cross.rel.confirmed_links',
          impact: tied !== null ? { value: tied, unit: 'money' } : { value: high.length, unit: 'qty' },
          evidence: high.slice(0, 5).map((r) => ({ key: r.label, label: r.label, current: r.value ?? r.onHand, unit: r.value !== null ? ('money' as const) : ('qty' as const) })), cross: disc(used),
        }));
      } else skip('stock_excess_vs_demand', 'nothing_found');
    }
  }

  // ───────────────── 2. purchase cost vs sales price margin proxy (purchasing ↔ sales, product links) ─────────────────
  const ps = confirmedPairs(inp.links, 'product', 'purchasing', 'sales');
  if (!ps.length) skip('margin_squeeze', 'no_links');
  else if (!inp.sales.length || !inp.purchases.length) skip('margin_squeeze', 'no_data');
  else {
    const cs = cur0(inp.sales.map((r) => r.currency));
    const cp = cur0(inp.purchases.map((r) => r.currency));
    const common = cs.filter((c) => cp.includes(c));
    if (!common.length) skip('margin_squeeze', 'currency_mismatch');
    else {
      const cur = common[0]!;
      const sBasis = inp.sales.filter((r) => r.currency === cur);
      const pBasis = inp.purchases.filter((r) => r.currency === cur);
      if (!sBasis.some((r) => r.basis === 'net') || !pBasis.some((r) => r.basis === 'net')) skip('margin_squeeze', 'basis_mismatch');
      else {
        const sN = sBasis.filter((r) => r.basis === 'net'), pN = pBasis.filter((r) => r.basis === 'net');
        const end = lastDate(sN) < lastDate(pN) ? lastDate(sN) : lastDate(pN);
        const w1 = { from: addDays(end, -(WINDOW_DAYS - 1)), to: end }, w0 = { from: addDays(end, -(2 * WINDOW_DAYS - 1)), to: addDays(end, -WINDOW_DAYS) };
        const inW = (d: string, w: { from: string; to: string }) => d >= w.from && d <= w.to;
        const unit = (rs: { quantity?: number; amount: number }[]) => { const q = sum(rs.map((r) => r.quantity ?? 0)); return q > 0 ? sum(rs.map((r) => r.amount)) / q : null; };
        const found: { label: string; cost0: number; cost1: number; m0: number; m1: number; extra: number }[] = [];
        const used: Pair[] = [];
        let marginUnitExcluded = 0;
        for (const p of ps) {
          const pr = pN.filter((r) => purchKey(r) === p.a && r.quantity !== undefined && r.quantity > 0 && r.amount > 0);
          const sr = sN.filter((r) => salesKey(r) === p.b && r.quantity !== undefined && r.quantity > 0 && r.amount > 0);
          if (new Set(pr.map((r) => r.unit ?? '')).size > 1) continue; // several units: cost per unit is not comparable
          // a purchase unit that differs from the unit the stock is counted in (box vs piece) makes cost per unit incomparable with the sales price
          const mInv = confirmedPairs(inp.links, 'product', 'inventory', 'purchasing').find((x) => x.b === p.a);
          const stockUnit = unitsOf(mInv ? snaps.filter((r) => invKey(r) === mInv.a).map((r) => r.unit) : []);
          if (!unitsCompatible(unitsOf(pr.map((r) => r.unit)), stockUnit)) { marginUnitExcluded++; continue; }
          const [p0, p1] = [pr.filter((r) => inW(r.date, w0)), pr.filter((r) => inW(r.date, w1))];
          const [s0, s1] = [sr.filter((r) => inW(r.date, w0)), sr.filter((r) => inW(r.date, w1))];
          if ([p0, p1, s0, s1].some((x) => x.length < 2)) continue;
          const [c0, c1, pr0, pr1] = [unit(p0)!, unit(p1)!, unit(s0)!, unit(s1)!];
          if (pr0 <= 0 || pr1 <= 0) continue;
          const m0 = ((pr0 - c0) / pr0) * 100, m1 = ((pr1 - c1) / pr1) * 100;
          if (m0 - m1 >= MARGIN_DROP_PP && ((c1 - c0) / c0) * 100 >= COST_RISE_PCT) {
            found.push({ label: p.link.a.label, cost0: c0, cost1: c1, m0, m1, extra: (c1 - c0) * sum(s1.map((r) => r.quantity!)) });
            used.push(p);
          }
        }
        if (found.length) {
          found.sort((a, b) => b.extra - a.extra);
          out.push(mk({
            id: 'cross.margin_squeeze', topic: 'cross.margin_squeeze', group: 'margin', severity: 'risk', certainty: 'indicator', titleKey: 'cross.margin_squeeze.title', bodyKey: 'cross.margin_squeeze.body', actionKey: 'cross.margin_squeeze.action', whyKey: 'cross.margin_squeeze.why',
            params: { count: found.length, name: found[0]!.label, m0: { pct: found[0]!.m0 / 100 }, m1: { pct: found[0]!.m1 / 100 }, amount: { money: sum(found.map((f) => f.extra)) } }, reliability: 'medium', reliabilityReasonKey: 'cross.rel.confirmed_links',
            impact: { value: sum(found.map((f) => f.extra)), unit: 'money' }, evidence: found.slice(0, 5).map((f) => ({ key: f.label, label: f.label, current: f.m1 / 100, previous: f.m0 / 100, unit: 'pct' as const })),
            cross: {
              sources: [{ module: 'purchasing', currency: cur, from: firstDate(pN), to: lastDate(pN), lines: pN.length, note: 'net' }, { module: 'sales', currency: cur, from: firstDate(sN), to: lastDate(sN), lines: sN.length, note: 'net' }],
              links: linkInfo(used), period: { from: w0.from, to: w1.to }, methodKey: 'cross.m.margin_squeeze', limits: ['cross.l.units_assumed', 'cross.l.proxy_margin', 'cross.l.no_freight'], confidenceKey: 'cross.c.medium',
            },
          }));
        } else skip('margin_squeeze', marginUnitExcluded ? 'unit_mismatch' : 'nothing_found');
      }
    }
  }

  // ───────────────── 3. sales concentration vs receivables risk (customer ↔ debtor, counterparty links) ─────────────────
  const cl = confirmedPairs(inp.links, 'counterparty', 'sales', 'finance');
  const ar = inp.finance.filter((r) => r.side === 'receivable');
  if (!cl.length) skip('customer_exposure', 'no_links');
  else if (!inp.sales.length || !ar.length) skip('customer_exposure', 'no_data');
  else {
    const cs = cur0(inp.sales.map((r) => r.currency));
    const cf = cur0(ar.map((r) => r.currency));
    const common = cs.filter((c) => cf.includes(c));
    if (!common.length) skip('customer_exposure', 'currency_mismatch');
    else {
      const cur = common[0]!;
      const sales = inp.sales.filter((r) => r.currency === cur);
      const snap = pickSnapshot(listSnapshots(ar.filter((r) => r.currency === cur)), '9999-12-31');
      if (!snap) skip('customer_exposure', 'no_position');
      else {
        const pos = positionOf(snap, snap.date);
        if (pos.overdue === null) skip('customer_exposure', 'no_due_dates');
        else {
          const end = lastDate(sales) < snap.date ? lastDate(sales) : snap.date;
          const win = sales.filter((r) => r.date >= addDays(end, -(WINDOW_DAYS - 1)) && r.date <= end && r.basis !== 'unknown');
          const totalSales = sum(win.map((r) => r.amount));
          const rows: { label: string; share: number; overdue: number; outstanding: number }[] = [];
          const used: Pair[] = [];
          for (const p of cl) {
            const mine = win.filter((r) => counterpartyKeyOf({ id: r.customerId, name: r.customerName }) === p.a);
            const key = p.b.replace(/^cp:/, '').replace(/^cpname:/, '');
            const f = pos.byCp.get(key);
            if (!mine.length || !f || f.overdue === null) continue;
            const share = totalSales > 0 ? sum(mine.map((r) => r.amount)) / totalSales : 0;
            rows.push({ label: p.link.a.label, share, overdue: f.overdue, outstanding: f.outstanding });
            used.push(p);
          }
          const flagged = rows.filter((r) => r.share >= CUSTOMER_SHARE_FLAG && r.overdue > 0).sort((a, b) => b.overdue - a.overdue);
          if (flagged.length) {
            const f = flagged[0]!;
            out.push(mk({
              id: 'cross.customer_exposure', topic: 'cross.customer_exposure', group: 'customer_risk', severity: 'risk', certainty: 'fact', titleKey: 'cross.customer_exposure.title', bodyKey: 'cross.customer_exposure.body', actionKey: 'cross.customer_exposure.action', whyKey: 'cross.customer_exposure.why',
              params: { count: flagged.length, name: f.label, share: { pct: f.share }, amount: { money: f.overdue }, asof: { date: snap.date } }, reliability: 'medium', reliabilityReasonKey: 'cross.rel.confirmed_links',
              impact: { value: sum(flagged.map((x) => x.overdue)), unit: 'money' }, evidence: flagged.slice(0, 5).map((x) => ({ key: x.label, label: x.label, current: x.overdue, unit: 'money' as const })),
              cross: {
                sources: [{ module: 'sales', currency: cur, from: firstDate(sales), to: lastDate(sales), lines: sales.length }, { module: 'finance', currency: cur, from: snap.date, to: snap.date, lines: snap.records.length, note: snap.kind }],
                links: linkInfo(used), period: { from: addDays(end, -(WINDOW_DAYS - 1)), to: end }, methodKey: 'cross.m.customer_exposure', limits: ['cross.l.vat_basis_shares', 'cross.l.snapshot_date', 'cross.l.not_summed'], confidenceKey: 'cross.c.medium',
              },
            }));
          } else skip('customer_exposure', 'nothing_found');
        }
      }
    }
  }

  // ───────────────── 4. inventory value vs purchasing pattern (inventory ↔ purchasing, product links) ─────────────────
  const ip = confirmedPairs(inp.links, 'product', 'inventory', 'purchasing');
  if (!ip.length) skip('stock_vs_purchasing', 'no_links');
  else if (!inp.purchases.length || !snaps.length) skip('stock_vs_purchasing', 'no_data');
  else {
    const invDate = lastDate(snaps);
    const pEnd = lastDate(inp.purchases);
    const end = invDate < pEnd ? invDate : pEnd;
    const start = addDays(end, -(WINDOW_DAYS - 1));
    const recent = addDays(end, -29);
    const rows: { label: string; months: number; value: number; spend: number; recentSpend: number; cur: string }[] = [];
    const used: Pair[] = [];
    let currencyClash = false, noValue = false;
    for (const p of ip) {
      const stock = snaps.filter((r) => invKey(r) === p.a && r.date === invDate);
      const buys = inp.purchases.filter((r) => purchKey(r) === p.b && r.basis === 'net' && r.date >= start && r.date <= end);
      if (!stock.length || !buys.length) continue;
      const cur = stock[0]!.currency;
      if (buys.some((b) => b.currency !== cur)) { currencyClash = true; continue; }
      const vals = stock.map((r) => r.value ?? (r.unitCost !== undefined && r.quantity !== undefined ? r.unitCost * r.quantity : null));
      if (vals.some((v) => v === null)) { noValue = true; continue; }
      const value = sum(vals as number[]);
      const spend = sum(buys.map((b) => b.amount));
      if (spend <= 0 || value <= 0) continue;
      rows.push({ label: p.link.a.label, months: value / (spend / 3), value, spend, recentSpend: sum(buys.filter((b) => b.date >= recent).map((b) => b.amount)), cur });
      used.push(p);
    }
    const flagged = rows.filter((r) => r.months >= STOCK_MONTHS_FLAG && r.recentSpend > 0).sort((a, b) => b.value - a.value);
    if (flagged.length) {
      const f = flagged[0]!;
      out.push(mk({
        id: 'cross.stock_vs_purchasing', topic: 'cross.stock_excess', group: 'overstock', severity: 'opportunity', certainty: 'possible', titleKey: 'cross.stock_vs_purchasing.title', bodyKey: 'cross.stock_vs_purchasing.body', actionKey: 'cross.stock_vs_purchasing.action', whyKey: 'cross.stock_vs_purchasing.why',
        params: { count: flagged.length, name: f.label, months: Math.round(f.months * 10) / 10, amount: { money: sum(flagged.map((x) => x.value)) }, asof: { date: invDate } }, reliability: 'medium', reliabilityReasonKey: 'cross.rel.confirmed_links',
        impact: { value: sum(flagged.map((x) => x.value)), unit: 'money' }, evidence: flagged.slice(0, 5).map((x) => ({ key: x.label, label: x.label, current: x.value, unit: 'money' as const })),
        cross: {
          sources: [{ module: 'inventory', currency: f.cur, from: firstDate(snaps), to: invDate, lines: snaps.length, note: 'snapshot' }, { module: 'purchasing', currency: f.cur, from: firstDate(inp.purchases), to: pEnd, lines: inp.purchases.length, note: 'net' }],
          links: linkInfo(used), period: { from: start, to: end }, methodKey: 'cross.m.stock_vs_purchasing', limits: ['cross.l.not_loss', 'cross.l.snapshot_date', 'cross.l.not_summed'], confidenceKey: 'cross.c.medium',
        },
      }));
    } else skip('stock_vs_purchasing', currencyClash ? 'currency_mismatch' : noValue ? 'no_value' : 'nothing_found');
  }
  return { insights: out, unavailable };
}
