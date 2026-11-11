import { describe, expect, it } from 'vitest';
import { DICTS } from '@/i18n';

const keys = Object.keys(DICTS.en) as (keyof typeof DICTS.en)[];
const words = (v: string) => v.replace(/\{\w+\}/g, ''); // placeholders such as {loss} are internal names, not text
const salesText = (lang: 'lt' | 'pl' | 'en') => keys.filter((k) => /^(sales\.|metric\.|explain\.|mgr\.|tbl\.|mu\.|lim\.)/.test(k)).map((k) => [k, DICTS[lang][k]] as const);

describe('O1 / T1 / T2 – financial terms say what the number is', () => {
  it('"orders" are called sales documents (the number of distinct document numbers), in every language', () => {
    expect(DICTS.lt['metric.orders']).toBe('Pardavimo dokumentai');
    expect(DICTS.lt['metric.aov']).toBe('Vidutinė dokumento vertė');
    expect(DICTS.en['metric.orders']).toBe('Sales documents');
    expect(DICTS.en['metric.aov']).toBe('Average document value');
    expect(DICTS.pl['metric.orders']).toBe('Dokumenty sprzedaży');
    expect(DICTS.pl['metric.aov']).toBe('Średnia wartość dokumentu');
    for (const lang of ['lt', 'pl', 'en'] as const) for (const k of ['metric.orders', 'metric.aov', 'explain.aov', 'tbl.orders', 'mu.no_orders'] as const) expect(words(DICTS[lang][k]), `${lang}:${k}`).not.toMatch(/užsakym|zamówien|\borders?\b/i);
    // the explanation may mention orders only to say that this is NOT a count of customer orders
    expect(DICTS.en['explain.orders']).toMatch(/not customer orders/);
    expect(DICTS.lt['explain.orders']).toMatch(/o ne klientų užsakymai/);
    expect(DICTS.pl['explain.orders']).toMatch(/a nie zamówienia klientów/);
  });
  it('a fall in sales is never described as something "lost" or as a loss (no sales text uses prarad / lost / strac / nuostol / loss)', () => {
    for (const lang of ['lt', 'pl', 'en'] as const)
      for (const [k, v] of salesText(lang)) {
        if (!/^(sales\.|mgr\.)/.test(k)) continue;
        if (k === 'sales.customer_concentration.why') continue; // hypothetical ("losing one customer would remove …"), not a statement about a decline that happened
        expect(words(v), `${lang}:${k}`).not.toMatch(/prarad|prarast|nuostol|\blost\b|\bloss|straci|utrac|strat[ay]\b/i);
      }
  });
  it('the sales findings that remain say "fell / sumažėjo / spadła" and state that the data does not give the reason', () => {
    expect(DICTS.lt['sales.product_decline.body']).toBe('Per {days} d. šių prekių pardavimai sumažėjo {loss}. Didžiausias kritimas: „{name}“.');
    expect(DICTS.en['sales.product_decline.body']).toMatch(/sales of these products fell by/);
    expect(DICTS.pl['sales.product_decline.body']).toMatch(/sprzedaż tych towarów spadła o/);
    for (const lang of ['lt', 'pl', 'en'] as const) expect(DICTS[lang]['sales.customers_declined.why']).toMatch(lang === 'lt' ? /laiko poslinkis/ : lang === 'pl' ? /przesunięcie w czasie/ : /timing/);
  });
  it('the generic amount label no longer says "impact" (a sales amount is revenue, not a financial effect)', () => {
    expect(DICTS.en['ins.impact']).toBe('Amount involved');
    expect(DICTS.lt['ins.impact']).toBe('Susijusi suma');
    expect(DICTS.pl['ins.impact']).toBe('Kwota, której dotyczy');
  });
  it('the margin explanation separates "whole turnover" from "costed sales only" in every language', () => {
    expect(DICTS.en['explain.margin']).toMatch(/not of the whole turnover/);
    expect(DICTS.lt['explain.margin']).toMatch(/ne visos apyvartos/);
    expect(DICTS.pl['explain.margin']).toMatch(/nie całego obrotu/);
    for (const lang of ['lt', 'pl', 'en'] as const) expect(DICTS[lang]['lim.margin_partial']).toContain('{pct}');
  });
});
