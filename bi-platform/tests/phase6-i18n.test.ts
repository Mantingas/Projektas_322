import { describe, expect, it } from 'vitest';
import { DICTS, type Lang } from '@/i18n';
import { UTYPES } from '@/engine/universal/types';

const langs: Lang[] = ['lt', 'pl', 'en'];
const D = (l: Lang) => DICTS[l] as Record<string, string>;
const has = (k: string) => langs.every((l) => (D(l)[k] ?? '').length > 0);

const REASONS = ['empty', 'flag01', 'flag', 'dateOrder', 'date', 'serialDate', 'percentSign', 'fraction', 'currencySymbol', 'idHeader', 'leadingZeros', 'uniqueInts', 'fewInts', 'yearLike', 'mixedNumbers', 'numbers', 'mixedText', 'longText', 'idPattern', 'manyDistinct', 'fewDistinct', 'moderateDistinct'];
const QUESTIONS = ['trend', 'ranking', 'concentration', 'distribution', 'relationship', 'composition', 'matrix'];
const CHART_REASONS = ['trend_day', 'trend_week', 'trend_month', 'ranking', 'pareto_skewed', 'composition', 'distribution', 'relationship', 'crosstab', 'corrMatrix'];
const SKIP = ['no_date', 'few_points', 'no_measure', 'no_dimension', 'no_meaningful_correlation', 'few_values', 'flat'];
const UNI_RULES = ['missing', 'duplicates', 'outliers', 'trend_change', 'concentration', 'correlation'];
const CROSS = ['stock_cover_low', 'stock_excess', 'margin_squeeze', 'customer_exposure', 'stock_vs_purchasing'];
const CROSS_REASONS = ['no_links', 'no_data', 'currency_mismatch', 'basis_mismatch', 'stale_snapshot', 'short_coverage', 'nothing_found', 'no_value', 'no_position', 'no_due_dates'];
const CROSS_RULES = ['stock_cover', 'stock_cover_low', 'stock_excess_vs_demand', 'margin_squeeze', 'customer_exposure', 'stock_vs_purchasing'];
const CMP = ['no_date', 'short_span', 'no_measure', 'few_rows'];
const L = ['units_assumed', 'no_lead_time', 'snapshot_date', 'proxy_margin', 'no_freight', 'vat_basis_shares', 'not_summed', 'not_loss'];

const dynamic = [
  ...UTYPES.map((u) => `utype.${u}`), ...REASONS.map((r) => `utype.why.${r}`), ...QUESTIONS.flatMap((q) => [`uch.${q}`, `uch.q.${q}`]), ...CHART_REASONS.map((r) => `uch.why.${r}`), ...SKIP.map((r) => `uch.skip.${r}`), ...CMP.map((r) => `uni.cmp.blocked.${r}`),
  ...UNI_RULES.flatMap((r) => ['title', 'body', 'action', 'why'].map((p) => `universal.${r}.${p}`)), 'uni.agg.sum', 'uni.agg.mean', 'uch.agg.sum', 'uch.agg.mean', 'rel.universal', 'mod.universal', 'mod.cross',
  ...CROSS.flatMap((r) => ['title', 'body', 'action', 'why'].map((p) => `cross.${r}.${p}`)), 'cross.stock_excess.body_value', ...CROSS_REASONS.map((r) => `cross.unavail.${r}`), ...CROSS_RULES.map((r) => `cross.rule.${r}`),
  ...['stock_cover', 'margin_squeeze', 'customer_exposure', 'stock_vs_purchasing'].map((r) => `cross.m.${r}`), ...L.map((r) => `cross.l.${r}`), ...['medium_fresh', 'low_lag', 'medium'].map((r) => `cross.c.${r}`), 'cross.rel.confirmed_links',
  ...['fact', 'risk', 'opportunity', 'scenario'].flatMap((c) => [`exe.class.${c}`, `exe.class.d.${c}`]), ...['materiality', 'confidence', 'urgency', 'actionability', 'novelty'].map((p) => `exe.rank.${p}`),
  ...['held', 'unknown_basis', 'other_series', 'stale'].map((f) => `exe.flag.${f}`), ...['sales', 'purchasing', 'inventory', 'finance.receivable', 'finance.payable'].map((x) => `exe.trend.${x}`),
  ...['duplicate', 'contradiction'].map((r) => `exe.supp.${r}`), ...['identifier_equal', 'user_confirmed'].map((b) => `lnk.basis.${b}`), ...['product', 'counterparty'].map((k) => `lnk.kind.${k}`), ...['confirmed', 'rejected'].map((s) => `lnk.status.${s}`),
  ...[1, 2, 3, 4, 5].map((n) => `exe.an.m${n}`), 'nav.overview', 'exe.noMix', 'exe.lastImport', 'exe.lastImport.none',
];

describe('phase 6 texts exist in LT, PL and EN', () => {
  it('every dynamically built key is defined in all three languages', () => {
    expect(dynamic.filter((k) => !has(k))).toEqual([]);
  });

  it('LT and PL are real translations, not the English text', () => {
    const re = /^(uni\.|utype\.|uch\.|universal\.|cross\.|exe\.|lnk\.)/;
    const keys = Object.keys(D('en')).filter((k) => re.test(k));
    expect(keys.length).toBeGreaterThan(300);
    for (const l of ['lt', 'pl'] as Lang[]) {
      const same = keys.filter((k) => D(l)[k] === D('en')[k]);
      expect(same.length / keys.length, `${l}: ${same.slice(0, 6).join(', ')}`).toBeLessThan(0.03);
    }
  });

  it('placeholders survive translation: every {param} of the English text is present in LT and PL', () => {
    const re = /^(uni\.|utype\.|uch\.|universal\.|cross\.|exe\.|lnk\.)/;
    const bad: string[] = [];
    for (const k of Object.keys(D('en')).filter((x) => re.test(x))) {
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      for (const l of ['lt', 'pl'] as Lang[]) if (ph(D(l)[k]!) !== ph(D('en')[k]!)) bad.push(`${l} ${k}`);
    }
    expect(bad).toEqual([]);
  });

  it('wording never turns tied-up capital into a loss or a possibility into a promise', () => {
    for (const l of langs) {
      for (const [k, v] of Object.entries(D(l))) {
        if (!/^(cross\.|exe\.class|exe\.an)/.test(k)) continue;
        expect(v, `${l} ${k}`).not.toMatch(/guaranteed saving|will save|garantuot\w* sutaupym|zagwarantowan\w* oszczędno/i);
      }
    }
    // the cautions are positively present
    expect(D('en')['cross.l.not_loss']).toMatch(/not a loss/);
    expect(D('en')['exe.class.d.opportunity']).toMatch(/never a guaranteed/);
    expect(D('en')['cross.stock_excess.body_value']).toMatch(/not a loss/);
  });

  it('no universal text names a business meaning the user never gave (revenue, profit, debt)', () => {
    for (const l of langs) {
      for (const [k, v] of Object.entries(D(l))) {
        if (!/^(universal\.|uni\.col|uch\.)/.test(k)) continue;
        expect(v, `${l} ${k}`).not.toMatch(/\b(revenue|profit|margin|debt|pajam|pelnas|skola|przychód|zysk|dług)\b/i);
      }
    }
  });
});
