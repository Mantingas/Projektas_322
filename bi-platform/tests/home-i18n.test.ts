import { describe, expect, it } from 'vitest';
import en from '@/i18n/home.en';
import lt from '@/i18n/home.lt';
import pl from '@/i18n/home.pl';
import { DICTS as messages } from '@/i18n';

const LANGS = { en, lt, pl } as Record<string, Record<string, string>>;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('landing page and demo texts (LT / PL / EN)', () => {
  it('every key exists in every language, none is empty', () => {
    for (const [lang, d] of Object.entries(LANGS)) {
      expect(Object.keys(d).sort(), lang).toEqual(Object.keys(en).sort());
      for (const [k, v] of Object.entries(d)) expect(v.trim().length, `${lang}:${k}`).toBeGreaterThan(0);
    }
  });
  it('the same placeholders are used in every language (no different promises or missing values)', () => {
    for (const k of Object.keys(en)) for (const lang of ['lt', 'pl']) expect(placeholders(LANGS[lang]![k]!), `${lang}:${k}`).toBe(placeholders((en as Record<string, string>)[k]!));
  });
  it('translations differ from English where they must (nothing left untranslated)', () => {
    for (const k of Object.keys(en)) for (const lang of ['lt', 'pl']) if ((en as Record<string, string>)[k]!.length > 25) expect(LANGS[lang]![k], `${lang}:${k}`).not.toBe((en as Record<string, string>)[k]);
  });
  it('makes no savings, ROI, price or pilot-result promises in any language', () => {
    const all = Object.entries(LANGS).flatMap(([lang, d]) => Object.entries(d).map(([k, v]) => [`${lang}:${k}`, v] as const));
    for (const [id, v] of all) {
      expect(v, id).not.toMatch(/\bROI\b/i);
      expect(v, id).not.toMatch(/\d+[.,]?\d*\s*(€|eur|pln|zł)/i);
      expect(v, id).not.toMatch(/guarantee|garantuo|gwarantuj|sutaupys\s+\d|save up to|oszczędz\w+ do/i);
    }
  });
  it('states the product stage and that the example is synthetic, in every language', () => {
    expect(en['home.stage.body']).toMatch(/synthetic/i); expect(en['home.stage.body']).toMatch(/no pilots/i);
    expect(lt['home.stage.body']).toMatch(/sintetin/i); expect(lt['home.stage.body']).toMatch(/dar nebuvo/i);
    expect(pl['home.stage.body']).toMatch(/syntetyczn/i); expect(pl['home.stage.body']).toMatch(/jeszcze się nie odbyły/i);
    expect(en['home.ex.label']).toMatch(/synthetic/i); expect(lt['home.ex.label']).toMatch(/sintetin/i); expect(pl['home.ex.label']).toMatch(/syntetyczn/i);
  });
  it('the hero names the question, not a technology, and keeps "possible" wording', () => {
    expect(en['home.hero.sub']).toMatch(/possible/i);
    expect(lt['home.hero.sub']).toMatch(/galim/i);
    expect(pl['home.hero.sub']).toMatch(/możliw/i);
  });
  it('the old hypothetical price block and the repeated "works with demo data" badge are gone', () => {
    const merged = messages.lt as Record<string, string>;
    expect(Object.keys(merged).filter((k) => k.startsWith('pricing.') || k === 'module.available')).toEqual([]);
  });
  it('the merged dictionaries expose the new keys', () => {
    for (const lang of ['en', 'lt', 'pl'] as const) expect((messages[lang] as Record<string, string>)['home.hero.title']).toBeTruthy();
  });
});
