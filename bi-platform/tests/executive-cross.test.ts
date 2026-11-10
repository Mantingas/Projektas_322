import { describe, expect, it } from 'vitest';
import { customerLink, link, makeExecutive, productLinks } from './fixtures/executive';
import { crossInsights } from '@/engine/executive/cross';
import { linkWorkflow } from '@/engine/executive/linking';
import { confirmedCounterpart } from '@/engine/entities/links';
import { snapLines, END, diff } from './fixtures/finance';
import type { Insight } from '@/engine/types';

const d = makeExecutive();
const run = (o: Partial<Parameters<typeof crossInsights>[0]> = {}) => crossInsights({ sales: d.sales, purchases: d.purchases, inventory: d.inventory, finance: d.finance, links: [...productLinks(), customerLink()], ...o });
const by = (r: ReturnType<typeof run>, id: string) => r.insights.find((i) => i.id === id) as Insight | undefined;
const money = (i: Insight, k: string) => (i.params[k] as { money: number }).money;
const why = (r: ReturnType<typeof run>) => Object.fromEntries(r.unavailable.map((u) => [u.rule, u.reason]));

describe('links are proposed only from equal identifiers', () => {
  const wf = linkWorkflow({ sales: d.sales, purchases: d.purchases, inventory: d.inventory, finance: d.finance }, []);
  it('equal product codes and customer ids are proposed, with both names shown', () => {
    const prod = wf.proposed.filter((p) => p.kind === 'product');
    expect(prod.map((p) => p.a.key).sort()).toEqual(['sku:p01', 'sku:p01', 'sku:p01', 'sku:p02', 'sku:p02', 'sku:p02', 'sku:p03', 'sku:p03', 'sku:p03']);
    expect(new Set(prod.map((p) => `${p.a.module}-${p.b.module}`))).toEqual(new Set(['sales-purchasing', 'sales-inventory', 'purchasing-inventory']));
    expect(prod.every((p) => p.status === 'proposed' && p.basis === 'identifier_equal' && !p.namesDiffer)).toBe(true);
    const cp = wf.proposed.filter((p) => p.kind === 'counterparty');
    expect(cp.filter((p) => p.a.module === 'sales').length).toBe(new Set(d.sales.map((x) => x.customerId)).size); // every customer id that appears in sales AND in receivables
    expect(cp.some((p) => p.a.module === 'sales' && p.b.module === 'finance' && p.a.key === 'cp:c06')).toBe(true);
    expect(cp.filter((p) => p.a.module === 'purchasing' && p.b.module === 'finance').map((p) => p.a.key)).toEqual(['cp:s01']); // the one supplier id that also exists in payables
  });
  it('the same NAME without a shared code is only a candidate, never a proposal', () => {
    expect(wf.proposed.some((p) => p.a.label === 'Sprocket' || p.b.label === 'Sprocket')).toBe(false);
    expect(wf.nameOnly.some((c) => c.a.label === 'Sprocket' && c.b.label === 'Sprocket')).toBe(true);
    // and a name-only candidate resolves to nothing until the user confirms it
    expect(confirmedCounterpart([], { module: 'sales', key: 'name:sprocket', label: 'Sprocket' }, 'inventory')).toBeUndefined();
  });
  it('a code that stands for two different names is ambiguous and never proposed', () => {
    const sales = [...d.sales, { ...d.sales[0]!, key: 'x', productId: 'P01', productName: 'Widget DELUXE' }];
    const w = linkWorkflow({ sales, purchases: d.purchases, inventory: d.inventory, finance: d.finance }, []);
    expect(w.ambiguous.some((a) => a.module === 'sales' && a.code === 'p01')).toBe(true);
    expect(w.proposed.some((p) => (p.a.module === 'sales' || p.b.module === 'sales') && (p.a.key === 'sku:p01'))).toBe(false);
  });
  it('decided links are not asked again; rejected ones stay rejected', () => {
    const decided = [link('product', ['sales', 'sku:p01', 'Widget'], ['purchasing', 'sku:p01', 'Widget'], 'rejected')];
    const w = linkWorkflow({ sales: d.sales, purchases: d.purchases, inventory: d.inventory, finance: d.finance }, decided);
    expect(w.proposed.some((p) => p.id === decided[0]!.id)).toBe(false);
    expect(w.decided).toHaveLength(1);
  });
});

describe('cross-module findings use confirmed links only', () => {
  it('no confirmed links → nothing is joined, and every rule says why', () => {
    for (const links of [[], productLinks('rejected'), productLinks('proposed' as never)]) {
      const r = run({ links: [...links, customerLink('rejected')] });
      expect(r.insights).toEqual([]);
      expect(Object.values(why(r)).every((x) => x === 'no_links')).toBe(true);
    }
  });

  it('sales demand against stock: cover = on hand ÷ average daily sales (independent calculation)', () => {
    const r = run();
    const low = by(r, 'cross.stock_cover_low')!;
    expect(low.params.count).toBe(1);
    expect(low.params.name).toBe('Widget');
    const qty90 = d.sales.filter((s) => s.productId === 'P01' && s.date >= '2025-09-17').reduce((s, x) => s + x.quantity!, 0);
    expect(qty90).toBe(90);
    expect(low.params.days).toBe(Math.round(8 / (qty90 / 90))); // 8 days
    expect(low.certainty).toBe('indicator');
    const ex = by(r, 'cross.stock_excess_vs_demand')!;
    expect(ex.params.name).toBe('Gadget');
    expect(money(ex, 'amount')).toBe(2000);
    expect(ex.certainty).toBe('possible');
    expect(ex.severity).toBe('opportunity');
    // the normal product (cover 60 days) appears in neither list
    expect([...low.evidence, ...ex.evidence].some((e) => e.label === 'Gizmo')).toBe(false);
  });

  it('only the products whose link was confirmed take part', () => {
    const only = productLinks().filter((l) => !l.id.includes('p01'));
    const r = run({ links: only });
    expect(by(r, 'cross.stock_cover_low')).toBeUndefined();
    expect(why(r).stock_cover_low).toBe('nothing_found');
    expect(by(r, 'cross.stock_excess_vs_demand')).toBeDefined();
  });

  it('purchase price change against sales margin: margin proxy fell from 50 % to 45 %', () => {
    const i = by(run(), 'cross.margin_squeeze')!;
    expect(i.params.count).toBe(1);
    expect(i.params.name).toBe('Widget');
    expect((i.params.m0 as { pct: number }).pct).toBeCloseTo(0.5, 9);
    expect((i.params.m1 as { pct: number }).pct).toBeCloseTo(0.45, 9);
    expect(money(i, 'amount')).toBeCloseTo((11 - 10) * 90, 9); // extra cost on the 90 units sold in the latest window
    expect(i.certainty).toBe('indicator');
    expect(i.evidence[0]).toMatchObject({ unit: 'pct', previous: 0.5, current: 0.45 });
  });

  it('sales concentration against receivables: a big customer with an overdue balance', () => {
    const i = by(run(), 'cross.customer_exposure')!;
    const win = d.sales.filter((s) => s.date >= '2025-09-17');
    const total = win.reduce((s, x) => s + x.amount, 0);
    const c06 = win.filter((s) => s.customerId === 'C06').reduce((s, x) => s + x.amount, 0);
    expect(i.params.name).toBe('UAB Žalioji dirbtuvė');
    expect((i.params.share as { pct: number }).pct).toBeCloseTo(c06 / total, 9);
    expect(c06 / total).toBeGreaterThan(0.3);
    const overdue = snapLines(d.ar, END).filter((o) => o.cp === 'C06' && o.outstanding > 0 && diff(o.due, END) > 0).reduce((s, o) => s + o.outstanding, 0);
    expect(money(i, 'amount')).toBeCloseTo(overdue, 2);
    expect(i.certainty).toBe('fact');
    // a small customer with an overdue balance is not "major"
    expect(i.evidence.map((e) => e.label)).toEqual(['UAB Žalioji dirbtuvė']);
  });

  it('inventory value against purchasing: months of purchases held in stock', () => {
    const i = by(run(), 'cross.stock_vs_purchasing')!;
    expect(i.params.name).toBe('Gadget');
    const spend = d.purchases.filter((p) => p.productId === 'P02').reduce((s, p) => s + p.amount, 0);
    expect(spend).toBe(300);
    expect(i.params.months).toBeCloseTo(Math.round((2000 / (spend / 3)) * 10) / 10, 9);
    expect(money(i, 'amount')).toBe(2000);
    expect(i.certainty).toBe('possible');
  });

  it('every cross-module finding discloses sources, confirmed links, period, method, confidence and limits', () => {
    const r = run();
    expect(r.insights.length).toBe(5);
    for (const i of r.insights) {
      const c = i.cross!;
      expect(c.sources.length).toBeGreaterThanOrEqual(2);
      expect(c.sources.every((s) => s.from && s.to && s.lines > 0)).toBe(true);
      expect(c.links.length).toBeGreaterThan(0);
      expect(c.links.every((l) => l.id && (l.basis === 'identifier_equal' || l.basis === 'user_confirmed'))).toBe(true);
      expect(c.period.from < c.period.to).toBe(true);
      expect(c.methodKey).toMatch(/^cross\.m\./);
      expect(c.limits.length).toBeGreaterThan(0);
      expect(c.confidenceKey).toMatch(/^cross\.c\./);
      expect(i.module).toBe('cross');
    }
    // a link the user confirmed on the NAME alone is labelled as such
    const named = productLinks().map((l) => (l.id.includes('p01') ? { ...l, basis: 'user_confirmed' as const } : l));
    expect(by(run({ links: [...named, customerLink()] }), 'cross.stock_cover_low')!.cross!.links[0]!.basis).toBe('user_confirmed');
  });

  it('currency and VAT-basis incompatibility withhold the finding instead of mixing units', () => {
    const eurVsPln = makeExecutive({ salesCurrency: 'PLN' });
    const r1 = crossInsights({ ...eurVsPln, links: [...productLinks(), customerLink()] });
    expect(why(r1).margin_squeeze).toBe('currency_mismatch');
    expect(why(r1).customer_exposure).toBe('currency_mismatch');
    expect(by(r1, 'cross.margin_squeeze')).toBeUndefined();
    const gross = makeExecutive({ salesBasis: 'gross' });
    const r2 = crossInsights({ ...gross, links: [...productLinks(), customerLink()] });
    expect(why(r2).margin_squeeze).toBe('basis_mismatch');
    // quantities do not depend on currency or VAT, so the stock-cover finding survives both
    expect(by(r1, 'cross.stock_cover_low')).toBeDefined();
    expect(by(r2, 'cross.stock_cover_low')).toBeDefined();
  });

  it('a stale stock snapshot is withheld; short sales history is withheld', () => {
    const stale = makeExecutive({ inventoryDate: '2025-08-01' });
    const r = crossInsights({ ...stale, links: productLinks() });
    expect(why(r).stock_cover).toBe('stale_snapshot');
    const shortSales = { ...d, sales: d.sales.filter((s) => s.date >= '2025-11-20') };
    expect(why(crossInsights({ ...shortSales, links: productLinks() })).stock_cover).toBe('short_coverage');
  });

  it('no duplicated records and no sum across modules: impacts stay in their own units', () => {
    const r = run();
    expect(new Set(r.insights.map((i) => i.id)).size).toBe(r.insights.length);
    expect(r.insights.find((i) => i.id === 'cross.stock_cover_low')!.impact.unit).toBe('qty');
  });
});
